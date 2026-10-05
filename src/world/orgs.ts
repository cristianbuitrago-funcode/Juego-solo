import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx } from '../core/world';
import { record } from '../core/chronicle';
import { FOODS, GOOD, foodDays, marketOf, type Good } from './economy';
import { seedRumor } from './gossip';
import { addScore, deed, gain, story, type GainNote } from './identity';
import { playerEco } from './business';
import { folkById, logEvent, memorize, NEEDS, playerRegion, trait } from './society';
import type { Folk } from './types';
import { getLayout } from './layout';
import { govOf, lawsOf, propose, recordDecision } from './politics';
import { LAWS, LAW_IDS, nid, ORG, ORG_RANK, polOf, type LawId, type Org, type OrgKind, type OrgTask } from './polstate';

/**
 * Organizaciones: gremios, labradores, guardia, sabios, viejas familias,
 * asamblea de vecinos y grupos clandestinos. Cada una tiene miembros de
 * carne y hueso, un líder, dinero, intereses (qué leyes le convienen),
 * relaciones con las demás y una opinión propia del jugador. Cuando sus
 * intereses chocan con lo que se decide, se enfada; si el enfado dura,
 * protesta, para de trabajar, cierra sus puestos o se amotina.
 */
const KINDS: OrgKind[] = ['comerciantes', 'agricultores', 'artesanos', 'guardia', 'sabios', 'familias', 'comunidad'];

const orgIndex = new WeakMap<Org[], { n: number; day: number; byFolk: Map<string, Org[]> }>();

export function orgsOf(w: WorldState, regionId?: number, all = false): Org[] {
  const list = polOf(w).orgs.filter((o) => !o.dissolved || all);
  return regionId === undefined ? list : list.filter((o) => o.regionId === regionId);
}

export const orgById = (w: WorldState, id: string | undefined) => (id ? polOf(w).orgs.find((o) => o.id === id) : undefined);

/** Los grupos a los que pertenece un vecino (índice en memoria, se rehace cada día). */
export function orgsOfFolk(w: WorldState, folkId: string): Org[] {
  const orgs = polOf(w).orgs;
  let idx = orgIndex.get(orgs);
  if (!idx || idx.day !== w.day || idx.n !== orgs.length) {
    idx = { n: orgs.length, day: w.day, byFolk: new Map() };
    for (const o of orgs) if (!o.dissolved) for (const m of o.members) (idx.byFolk.get(m) ?? idx.byFolk.set(m, []).get(m)!).push(o);
    orgIndex.set(orgs, idx);
  }
  return idx.byFolk.get(folkId) ?? [];
}

export const invalidateOrgIndex = (w: WorldState) => orgIndex.delete(polOf(w).orgs);

const adultsOf = (w: WorldState, regionId: number) => w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 16 && f.p);
const wealth = (w: WorldState, f: Folk) => f.p?.coins ?? 0;

function membersFor(w: WorldState, kind: OrgKind, regionId: number): string[] {
  const adults = adultsOf(w, regionId);
  if (kind === 'familias') {
    const rich = [...adults].sort((a, b) => wealth(w, b) - wealth(w, a)).filter((f) => wealth(w, f) > 12);
    return rich.slice(0, Math.max(2, Math.round(adults.length / 6))).map((f) => f.id);
  }
  if (kind === 'comunidad') {
    const taken = new Set(orgsOf(w, regionId).filter((o) => o.kind !== 'comunidad' && o.kind !== 'clandestino').flatMap((o) => o.members));
    return adults.filter((f) => !taken.has(f.id) || (f.p!.coins < 6 && f.role !== 'lider')).map((f) => f.id);
  }
  if (kind === 'clandestino') return [];
  if (kind === 'sabios') return adults.filter((f) => ORG.sabios.roles.includes(f.role) && (f.role !== 'anciano' || trait(f, 'curioso') > 45)).map((f) => f.id);
  return adults.filter((f) => ORG[kind].roles.includes(f.role)).map((f) => f.id);
}

function pickLeader(w: WorldState, members: string[]): string | undefined {
  let best: string | undefined;
  let bv = -Infinity;
  for (const id of members) {
    const f = folkById(w, id);
    if (!f?.alive || !f.p) continue;
    const v = trait(f, 'ambicioso') + trait(f, 'sociable') * 0.6 + trait(f, 'orgulloso') * 0.3 + Math.min(f.age, 60) * 0.5 + (f.charId ? 25 : 0) + wealth(w, f) * 0.2;
    if (v > bv) (bv = v), (best = id);
  }
  return best;
}

/** Crea los grupos de cada pueblo según quién vive allí. */
export function ensureOrgs(w: WorldState): void {
  const pol = polOf(w);
  for (const r of w.regions) {
    if (pol.orgs.some((o) => o.regionId === r.id)) continue;
    for (const kind of KINDS) {
      const members = membersFor(w, kind, r.id);
      if (members.length < (kind === 'guardia' || kind === 'comerciantes' ? 1 : 2)) continue;
      const o: Org = {
        id: nid(w, 'o'), regionId: r.id, kind, name: `${kind === 'guardia' ? `La guardia de ${r.name}` : ORG[kind].title}`, members, leader: pickLeader(w, members), founded: w.day - 200,
        funds: 5 + members.length, standing: clamp(0.25 + members.length / 25 + (kind === 'familias' ? 0.2 : 0)), discontent: 0.25, hot: 0, hidden: false, known: r.isHome && (kind === 'comunidad' || kind === 'comerciantes'), player: { rep: 0, rank: 0, tasks: 0 }, history: [],
      };
      pol.orgs.push(o);
    }
  }
  invalidateOrgIndex(w);
}

/** Cada pocos días: altas, bajas, nuevo líder si el anterior murió o se fue. */
export function refreshOrgs(w: WorldState, regionId: number): string[] {
  const out: string[] = [];
  for (const o of orgsOf(w, regionId)) {
    const alive = o.members.filter((id) => {
      const f = folkById(w, id);
      return f?.alive && f.regionId === regionId;
    });
    let members = alive;
    if (o.kind !== 'clandestino' && !o.founder) {
      const fresh = membersFor(w, o.kind, regionId).filter((id) => !alive.includes(id));
      members = o.kind === 'familias' ? membersFor(w, o.kind, regionId) : [...alive, ...fresh];
    }
    o.members = members;
    if (o.leader !== 'jugador' && (!o.leader || !members.includes(o.leader))) {
      const old = o.leader ? folkById(w, o.leader) : undefined;
      // Si el jugador ya es de los suyos y le aprecian, le ofrecen dirigir el grupo.
      if (o.player.rank >= 2 && repOf(w, o) > 0.45) {
        polOf(w).offers.push({ kind: 'liderazgo', regionId, orgId: o.id, day: w.day });
        out.push(`${o.name} se ha quedado sin cabeza${old ? ` (${old.name} ya no está)` : ''}. Algunos dicen tu nombre.`);
      }
      o.leader = pickLeader(w, members);
      if (old && o.leader) o.history.push({ day: w.day, text: `${folkById(w, o.leader)?.name} pasa a dirigir el grupo.` });
    }
    if (!members.length && o.player.rank < 2) {
      o.dissolved = w.day;
      logEvent(w, regionId, 'politica', `${o.name} ya no existe: no le queda nadie.`, []);
    }
  }
  invalidateOrgIndex(w);
  return out;
}

// ---------------------------------------------------------------------------
// Intereses: lo que le conviene a cada grupo, según su naturaleza y lo que pasa
// ---------------------------------------------------------------------------
const hungerMemo = new Map<string, boolean>();
const hungryNow = (w: WorldState, regionId: number) => {
  const k = `${w.seed}:${w.day}:${regionId}`;
  let v = hungerMemo.get(k);
  if (v === undefined) {
    if (hungerMemo.size > 200) hungerMemo.clear();
    hungerMemo.set(k, (v = foodDays(w, regionId) < 2.5));
  }
  return v;
};

export function interestOf(w: WorldState, o: Org, law: LawId, value: string): number {
  let v = ORG[o.kind].interests[law]?.[value] ?? 0;
  const r = w.regions[o.regionId];
  const hungry = hungryNow(w, o.regionId);
  const laws = lawsOf(w, o.regionId);
  if (hungry && law === 'agricultura' && value === 'granero' && (o.kind === 'comunidad' || o.kind === 'agricultores')) v += 0.5;
  if (hungry && law === 'comercio' && (o.kind === 'comunidad' || o.kind === 'sabios')) v += value === 'libre' ? 0.5 : value === 'cerrado' ? -0.6 : -0.2;
  if (hungry && law === 'impuestos' && o.kind === 'comunidad') v += value === 'bajo' ? 0.3 : value === 'alto' ? -0.3 : 0;
  if (r.flags.bandidos && law === 'seguridad' && (o.kind === 'comerciantes' || o.kind === 'agricultores')) v += value === 'alta' ? 0.6 : value === 'baja' ? -0.5 : 0;
  if (marketOf(w, o.regionId).treasury < 5 && law === 'impuestos' && o.kind === 'guardia') v += value === 'alto' ? 0.4 : value === 'bajo' ? -0.3 : 0;
  if (r.flags.guerra && law === 'seguridad') v += value === 'alta' ? 0.3 : value === 'baja' ? -0.3 : 0;
  if (r.ecology < 0.35 && law === 'recursos' && (o.kind === 'sabios' || o.kind === 'agricultores')) v += value === 'protegidos' ? 0.4 : -0.2;
  if (o.cause && o.cause.law === law) v += o.cause.value === value ? 1 : -0.5;
  if (o.kind === 'clandestino' && law !== 'seguridad') v += value !== laws[law] ? 0.25 : -0.2;
  return clamp(v, -1.5, 1.5);
}

/** Lo que el grupo ganaría o perdería si una ley cambia a ese valor. */
export const gainOf = (w: WorldState, o: Org, law: LawId, value: string) => interestOf(w, o, law, value) - interestOf(w, o, law, lawsOf(w, o.regionId)[law]);

/** El mejor cambio para el grupo ahora mismo (su objetivo político). */
export function bestGoal(w: WorldState, o: Org): { law: LawId; value: string; gain: number } | undefined {
  let best: { law: LawId; value: string; gain: number } | undefined;
  for (const law of LAW_IDS) for (const value of LAWS[law].options) {
    const g = gainOf(w, o, law, value);
    if (g > 0.35 && (!best || g > best.gain)) best = { law, value, gain: g };
  }
  return best;
}

/** Lo que el grupo piensa del jugador: lo que ha hecho por él + cómo le ven sus miembros. */
export function repOf(w: WorldState, o: Org): number {
  if (o.player.rank === 4 && o.leader === 'jugador') return clamp(o.player.rep * 0.6 + 0.4, -1, 1);
  let s = 0;
  let n = 0;
  for (const id of o.members) {
    const f = folkById(w, id);
    if (!f || f.lastMet < 0) continue;
    s += (f.trust - 0.5) * 1.2 + f.gratitude * 0.8 - f.resentment * 1.2;
    n++;
  }
  const people = n ? clamp(s / n, -1, 1) * Math.min(1, n / Math.max(2, o.members.length * 0.6)) : 0;
  return clamp(o.player.rep * 0.6 + people * 0.4, -1, 1);
}

export function adjustRep(w: WorldState, o: Org, d: number): void {
  o.player.rep = clamp(o.player.rep + d, -1, 1);
}

/** Cómo te ve un grupo, en palabras. */
export function repWord(w: WorldState, o: Org): string {
  const r = repOf(w, o);
  if (o.player.rank === 4) return o.founder === 'jugador' ? 'lo fundaste y lo diriges' : 'lo diriges';
  if (o.player.expelled) return 'te expulsaron';
  if (r < -0.4) return 'te consideran su rival';
  if (r < -0.15) return 'desconfían de ti';
  if (o.player.rank === 3) return 'hablas en su nombre';
  if (o.player.rank === 2) return 'eres de los suyos';
  if (r > 0.45) return 'te tienen en mucha estima';
  if (r > 0.15) return 'te ven con buenos ojos';
  if (o.player.rank === 1) return 'les has echado una mano';
  return 'apenas te conocen';
}

// ---------------------------------------------------------------------------
// Descontento y acción colectiva
// ---------------------------------------------------------------------------
const hardshipOf = (w: WorldState, o: Org) => {
  let s = 0;
  let n = 0;
  for (const id of o.members) {
    const f = folkById(w, id);
    if (!f?.p) continue;
    s += (1 - f.p.needs.comida) * 0.6 + (1 - f.p.needs.dinero) * 0.3 + (1 - f.p.needs.seguridad) * 0.2 + (1 - f.p.needs.trabajo) * 0.15;
    n++;
  }
  return n ? s / n : 0.3;
};

/** La queja principal del grupo (para contarla con palabras). */
function grievanceOf(w: WorldState, o: Org): string | undefined {
  const laws = lawsOf(w, o.regionId);
  let worst: { law: LawId; v: number } | undefined;
  for (const law of LAW_IDS) {
    const v = interestOf(w, o, law, laws[law]);
    if (v < -0.25 && (!worst || v < worst.v)) worst = { law, v };
  }
  const hard = hardshipOf(w, o);
  if (hard > 0.45 && foodDays(w, o.regionId) < 2) return 'pasan hambre y nadie hace nada';
  if (worst) return `no soportan ${LAWS[worst.law].label[laws[worst.law]]}`;
  if (hard > 0.4) return 'no llegan a fin de mes';
  if (o.kind === 'clandestino') return 'quieren otro gobierno';
  return undefined;
}

export function orgDay(w: WorldState, rng: Rng, regionId: number): string[] {
  const out: string[] = [];
  const gov = govOf(w, regionId);
  const laws = lawsOf(w, regionId);
  const here = playerRegion(w) === regionId;
  const rej = (o: Org) => polOf(w).proposals.filter((p) => p.from === o.id && p.status === 'rechazada' && w.day - p.voteDay < 20).length;
  for (const o of orgsOf(w, regionId)) {
    let fit = 0;
    let k = 0;
    for (const law of LAW_IDS) {
      if (!ORG[o.kind].interests[law] && o.cause?.law !== law && o.kind !== 'clandestino') continue;
      fit += interestOf(w, o, law, laws[law]);
      k++;
    }
    fit = k ? fit / k : 0;
    // El enfado sale de lo que duele de verdad: leyes contrarias, hambre, pobreza, palos, peticiones ignoradas.
    const target = clamp(0.22 - fit * 0.35 + Math.max(0, hardshipOf(w, o) - 0.25) * 1.1 + gov.repression * 0.3 + rej(o) * 0.06 - (gov.legitimacy - 0.5) * 0.2 + (o.kind === 'clandestino' ? 0.3 : 0));
    o.discontent = clamp(o.discontent + (target - o.discontent) * 0.12);
    o.hot = o.discontent > 0.6 ? o.hot + 1 : Math.max(0, o.hot - 1);
    o.grievance = grievanceOf(w, o);
    const goal = bestGoal(w, o);
    o.goal = goal ? { law: goal.law, value: goal.value } : undefined;
    o.funds = Math.round((o.funds + o.members.length * 0.04) * 100) / 100;
    // Peso público: crece con los miembros y el dinero; cae si está en contra de todo.
    o.standing = clamp(o.standing + ((0.2 + o.members.length / 22 + Math.min(0.2, o.funds / 120) + (o.kind === 'familias' ? 0.15 : 0) - (o.hidden ? 0.15 : 0)) - o.standing) * 0.05);
    // Acciones colectivas: cuando el enfado dura, se hace notar.
    if (o.action && o.action.until < w.day) {
      endAction(w, o, 'se cansan');
    } else if (!o.action && !o.hidden && o.hot >= 3 && o.members.length >= 2 && rng.chance(0.2 + (o.discontent - 0.6))) {
      out.push(...startAction(w, rng, o, here));
    } else if (o.action && !o.action.answered && w.day - o.action.since >= 1) {
      out.push(...answerAction(w, rng, o));
    }
    // Las organizaciones piden cambios por los cauces normales.
    // (Con calma: un grupo no pide lo mismo cada semana, y solo si de verdad le duele.)
    const lastAsk = polOf(w).proposals.filter((p) => p.from === o.id).reduce((d, p) => Math.max(d, p.day), -99);
    if (o.goal && !o.hidden && w.day - lastAsk >= 15 && (o.discontent > 0.5 || (o.discontent > 0.38 && rng.chance(0.15))) && rng.chance(0.08)) {
      const p = propose(w, regionId, o.goal.law, o.goal.value, o.id);
      if (p && here) out.push(`${o.name} pide ${LAWS[p.law].label[p.value]}. Se votará en unos días.`);
    }
  }
  return out;
}

function startAction(w: WorldState, rng: Rng, o: Org, here: boolean): string[] {
  const hungry = foodDays(w, o.regionId) < 1.5;
  const kind: NonNullable<Org['action']>['kind'] = o.kind === 'agricultores' || o.kind === 'artesanos' ? 'huelga' : o.kind === 'comerciantes' ? 'boicot' : o.kind === 'guardia' ? 'desobediencia' : hungry && o.kind === 'comunidad' && o.discontent > 0.75 ? 'motin' : 'protesta';
  const r = w.regions[o.regionId];
  o.action = { kind, since: w.day, until: w.day + rng.int(2, 5) };
  const lead = folkById(w, o.leader ?? '');
  const why = o.grievance ? `: ${o.grievance}` : '';
  const text = {
    protesta: `${o.name} protesta en la plaza de ${r.name}${why}.`,
    huelga: `${o.name} deja de trabajar${why}. Los campos y talleres se quedan quietos.`,
    boicot: `Los comerciantes de ${r.name} cierran sus puestos${why}.`,
    motin: `Motín en ${r.name}: la gente asalta el almacén${why}.`,
    desobediencia: `La guardia de ${r.name} se niega a patrullar${why}.`,
  }[kind];
  logEvent(w, o.regionId, kind, text, o.members.slice(0, 6));
  o.history.push({ day: w.day, text });
  polOf(w).log.push({ day: w.day, regionId: o.regionId, kind, text });
  seedRumor(w, { regionId: o.regionId, kind: 'politica', subject: lead?.id ?? o.members[0], witnesses: adultsOf(w, o.regionId).filter(() => rng.chance(0.5)).map((f) => f.id), versions: [text, `Dicen que ${o.name} está dispuesto a todo.`, `Dicen que ${r.name} está al borde de la revuelta.`], tone: -0.2 });
  // Lo que se ve: los miembros en la plaza (protesta, motín) o sin trabajar.
  const v = getLayout(w).villages[o.regionId];
  for (const id of o.members) {
    const f = folkById(w, id);
    if (!f?.p) continue;
    if (kind === 'huelga' || kind === 'desobediencia') f.p.strike = o.action.until;
    if (kind === 'protesta' || kind === 'motin') {
      const a = (hashString(id) % 628) / 100;
      f.p.plans.push({ day: w.day, from: 10, to: 13, x: v.cx + 0.5 + Math.cos(a) * (v.plazaR - 1.4), y: v.cy + 0.5 + Math.sin(a) * (v.plazaR - 1.4), activity: kind === 'motin' ? 'grita contra el gobierno' : 'protesta en la plaza', event: kind });
    }
    memorize(w, f, { kind, text: kind === 'motin' ? 'Asaltamos el almacén. No teníamos otra.' : 'Salimos a protestar.', w: -0.2, src: 'propio' });
  }
  const m = marketOf(w, o.regionId);
  if (kind === 'boicot') r.flags.boicot = { since: w.day, data: { until: o.action.until, org: o.id } };
  if (kind === 'motin') {
    for (const g of FOODS) m.stock[g] *= 0.75;
    m.treasury *= 0.6;
    r.stability = clamp(r.stability - 0.08);
    const t = w.life!.towns[o.regionId];
    if (t && t.houses > 3 && rng.chance(0.4) && !t.burned.includes(t.houses - 1)) t.burned.push(t.houses - 1);
  } else r.stability = clamp(r.stability - 0.02);
  if (r.isHome || here) {
    const ctx = makeCtx(w);
    record(ctx, { kind: 'evento', text, regions: [o.regionId], importance: kind === 'motin' ? 2 : 1, known: true });
    commitCtx(ctx);
  }
  return here ? [text] : [];
}

function endAction(w: WorldState, o: Org, why: string): void {
  if (!o.action) return;
  const r = w.regions[o.regionId];
  if (o.action.kind === 'boicot') delete r.flags.boicot;
  for (const id of o.members) {
    const f = folkById(w, id);
    if (f?.p?.strike) delete f.p.strike;
  }
  o.history.push({ day: w.day, text: `Termina ${o.action.kind === 'huelga' ? 'la huelga' : o.action.kind === 'boicot' ? 'el cierre de puestos' : o.action.kind === 'motin' ? 'el motín' : 'la protesta'}: ${why}.` });
  o.action = undefined;
  o.hot = 0;
}

/** Quien gobierna responde: cede, ignora o reprime. Cada camino tiene su precio. */
function answerAction(w: WorldState, rng: Rng, o: Org): string[] {
  const gov = govOf(w, o.regionId);
  const r = w.regions[o.regionId];
  const ruler = gov.ruler && gov.ruler !== 'jugador' ? folkById(w, gov.ruler) : undefined;
  if (gov.ruler === 'jugador') {
    // Si gobierna el jugador, le toca decidir a él (lo verá en el salón).
    o.action!.answered = 'pendiente';
    (w.life!.identity!.inbox ??= []).push(`${o.name} espera tu respuesta en ${r.name}: ${o.grievance ?? 'quieren que se les escuche'}.`);
    return [];
  }
  const hard = gov.system === 'militar' || lawsOf(w, o.regionId).seguridad === 'alta';
  const pride = ruler ? (trait(ruler, 'orgulloso') + trait(ruler, 'desconfiado')) / 200 : 0.5;
  const soft = ruler ? (trait(ruler, 'amable') + trait(ruler, 'generoso')) / 200 : 0.5;
  const fear = o.action!.kind === 'motin' || o.action!.kind === 'desobediencia' ? 0.25 : 0;
  const choice = rng.weighted(['ceder', 'ignorar', 'reprimir'] as const, (c) => (c === 'ceder' ? 0.3 + soft + fear + (1 - gov.legitimacy) * 0.3 : c === 'ignorar' ? 0.5 : (hard ? 0.7 : 0.1) + pride * 0.6 - (o.kind === 'guardia' ? 1 : 0)))!;
  return respondTo(w, o, choice, ruler?.name ?? 'el gobierno');
}

export function respondTo(w: WorldState, o: Org, choice: 'ceder' | 'ignorar' | 'reprimir', who: string): string[] {
  const gov = govOf(w, o.regionId);
  const r = w.regions[o.regionId];
  o.action && (o.action.answered = choice);
  let text: string;
  if (choice === 'ceder' && o.goal) {
    const p = propose(w, o.regionId, o.goal.law, o.goal.value, 'gobierno', 1);
    if (p) for (const v of gov.council) p.sway[v] = (p.sway[v] ?? 0) + 0.25;
    text = `${cap(who)} promete a ${o.name} estudiar ${LAWS[o.goal.law].label[o.goal.value]}.`;
    o.discontent = clamp(o.discontent - 0.15);
    endAction(w, o, 'les han escuchado');
  } else if (choice === 'reprimir') {
    text = `${cap(who)} manda a la guardia contra ${o.name}. Hay heridos.`;
    gov.repression = clamp(gov.repression + 0.25);
    gov.legitimacy = clamp(gov.legitimacy - 0.06);
    r.stability = clamp(r.stability - 0.03);
    for (const id of o.members.slice(0, 4)) {
      const f = folkById(w, id);
      if (f?.p) {
        memorize(w, f, { kind: 'represion', text: 'Nos echaron a palos de la plaza.', w: -0.7, src: 'propio' });
        f.p.emo.enojo = clamp(f.p.emo.enojo + 0.3);
      }
    }
    endAction(w, o, 'la guardia los disuelve');
    o.discontent = clamp(o.discontent + 0.1);
  } else {
    text = `${cap(who)} no responde a ${o.name}. La protesta sigue.`;
    gov.legitimacy = clamp(gov.legitimacy - 0.02);
  }
  logEvent(w, o.regionId, 'politica', text, o.members.slice(0, 4));
  polOf(w).log.push({ day: w.day, regionId: o.regionId, kind: 'respuesta', text });
  gov.history.push({ day: w.day, text });
  return playerRegion(w) === o.regionId ? [text] : [];
}

// ---------------------------------------------------------------------------
// El jugador dentro de los grupos: ayudar, entrar, representar, dirigir, fundar
// ---------------------------------------------------------------------------
/** Un encargo del grupo, según lo que necesita ahora mismo. */
export function offerTask(w: WorldState, o: Org): OrgTask | undefined {
  if (o.player.task && o.player.task.until >= w.day) return o.player.task;
  const rng = new Rng(hashString(`${o.id}:${w.day}`));
  const m = marketOf(w, o.regionId);
  const missing = (gs: Good[]) => gs.filter((g) => m.stock[g] < Math.max(1, m.demand[g] * 2)).sort((a, b) => m.stock[a] - m.stock[b])[0];
  const prop = polOf(w).proposals.find((p) => p.regionId === o.regionId && p.status === 'abierta' && gainOf(w, o, p.law, p.value) > 0.2);
  let t: OrgTask | undefined;
  const until = w.day + 8;
  if (prop && rng.chance(0.6)) {
    const voters = govOf(w, o.regionId).council.filter((v) => v !== 'jugador' && !orgsOfFolk(w, v).includes(o));
    const target = voters.length ? rng.pick(voters) : undefined;
    if (target) t = { id: nid(w, 't'), kind: 'convencer', target, until: prop.voteDay, text: `Convence a ${folkById(w, target)?.name} de votar a favor de ${LAWS[prop.law].label[prop.value]}.` };
  }
  if (!t) {
    const want: Partial<Record<OrgKind, Good[]>> = { comerciantes: ['sal', 'ropa', 'herramientas', 'medicinas'], agricultores: ['semillas', 'herramientas'], artesanos: ['hierro', 'madera', 'lana'], comunidad: ['trigo', 'verdura', 'medicinas'], sabios: ['medicinas'], familias: ['muebles', 'ambar'], guardia: ['armas'] };
    const g = missing(want[o.kind] ?? ['trigo']) ?? (want[o.kind] ?? ['trigo'])[0];
    if (o.kind === 'guardia' && rng.chance(0.6)) t = { id: nid(w, 't'), kind: 'patrullar', until, text: 'Haz una ronda con la guardia por los caminos.' };
    else if (o.kind === 'familias' && rng.chance(0.4)) t = { id: nid(w, 't'), kind: 'aportar', n: 8, until, text: 'Aporta unas monedas a la caja del grupo.' };
    else t = { id: nid(w, 't'), kind: 'entregar', good: g, n: GOOD[g].base > 4 ? 1 : 3, until, text: `Trae ${GOOD[g].base > 4 ? 1 : 3} de ${GOOD[g].name}: hace falta.` };
  }
  o.player.task = t;
  return t;
}

/** Cumplir el encargo (si se puede). */
export function completeTask(w: WorldState, o: Org): { ok: boolean; text: string; notes: GainNote[] } {
  const t = o.player.task;
  if (!t) return { ok: false, text: 'No te han pedido nada.', notes: [] };
  const id = w.life!.identity!;
  const pe = playerEco(w);
  let notes: GainNote[] = [];
  switch (t.kind) {
    case 'entregar': {
      const have = Math.floor(pe.cargo[t.good!] ?? 0);
      if (have < t.n!) return { ok: false, text: `Te faltan ${t.n! - have} de ${GOOD[t.good!].name}.`, notes: [] };
      pe.cargo[t.good!] = have - t.n!;
      if (!pe.cargo[t.good!]) delete pe.cargo[t.good!];
      marketOf(w, o.regionId).stock[t.good!] += t.n!;
      notes = gain(w, 'comercio', 0.3);
      break;
    }
    case 'aportar':
      if (id.needs.coins < t.n!) return { ok: false, text: 'No te llega el dinero.', notes: [] };
      id.needs.coins -= t.n!;
      o.funds += t.n!;
      break;
    case 'patrullar':
      notes = gain(w, 'combate', 0.6);
      id.needs.fatigue = Math.min(1, id.needs.fatigue + 0.25);
      if (w.regions[o.regionId].flags.bandidos) delete w.regions[o.regionId].flags.bandidos;
      break;
    case 'convencer': {
      const p = polOf(w).proposals.find((x) => x.regionId === o.regionId && x.status !== 'retirada' && x.sway[t.target!] !== undefined && x.sway[t.target!] > 0.15);
      if (!p) return { ok: false, text: `Aún no has convencido a ${folkById(w, t.target!)?.name}.`, notes: [] };
      notes = gain(w, 'persuasion', 0.4);
      break;
    }
    case 'investigar': {
      const s = polOf(w).secrets.find((x) => x.id === t.secret);
      if (!s?.known) return { ok: false, text: 'Aún no has averiguado lo que te pidieron.', notes: [] };
      break;
    }
  }
  o.player.task = undefined;
  o.player.tasks++;
  o.player.lastHelp = w.day;
  adjustRep(w, o, 0.16);
  if (o.player.rank < 1) o.player.rank = 1;
  addScore(w, o.regionId, 2);
  deed(id, 'organizacion');
  const lead = folkById(w, o.leader ?? '');
  if (lead) {
    lead.trust = Math.min(1, lead.trust + 0.06);
    polOf(w).favors[lead.id] = (polOf(w).favors[lead.id] ?? 0) + 1;
    memorize(w, lead, { kind: 'ayuda_grupo', about: 'jugador', text: `Hizo lo que le pedimos para ${o.name}.`, w: 0.4, src: 'propio' });
  }
  recordDecision(w, 'familia', o.regionId, `Hizo un encargo para ${o.name}.`);
  // Tras varios encargos, la invitación a entrar.
  if (o.player.rank === 1 && o.player.tasks >= 2 && repOf(w, o) > 0.3 && !o.player.invited) {
    o.player.invited = w.day;
    polOf(w).offers.push({ kind: 'miembro', regionId: o.regionId, orgId: o.id, day: w.day });
    return { ok: true, text: `«Gracias. Has hecho más que muchos de los nuestros.» ${lead?.name ?? 'Alguien'} te mira un momento. «¿Por qué no te unes a nosotros?»`, notes };
  }
  return { ok: true, text: '«Bien hecho. No lo olvidaremos.»', notes };
}

export function joinOrg(w: WorldState, o: Org): string {
  o.player.rank = Math.max(o.player.rank, 2);
  o.player.joined = w.day;
  polOf(w).offers = polOf(w).offers.filter((x) => !(x.kind === 'miembro' && x.orgId === o.id));
  story(w, `Entró en ${o.name} de ${w.regions[o.regionId].name}.`, 'cargo');
  adjustRep(w, o, 0.1);
  // Unirse a unos es alejarse de sus rivales.
  for (const x of orgsOf(w, o.regionId)) if (x !== o && rivalry(w, o, x) > 0.4) adjustRep(w, x, -0.08);
  recordDecision(w, 'pueblo', o.regionId, `Se unió a ${o.name}.`);
  return `Desde hoy eres de ${o.name}. Te presentan a todos; algunos te dan la mano con ganas, otros con recelo.`;
}

/** Lo enfrentados que están dos grupos (por sus intereses). */
export function rivalry(w: WorldState, a: Org, b: Org): number {
  let d = 0;
  let n = 0;
  for (const law of LAW_IDS) for (const v of LAWS[law].options) {
    const x = ORG[a.kind].interests[law]?.[v];
    const y = ORG[b.kind].interests[law]?.[v];
    if (x === undefined || y === undefined) continue;
    d += Math.abs(x - y);
    n++;
  }
  return n ? clamp(d / n) : 0.2;
}

/** Los miembros eligen a quien les representa en el consejo. */
export function representativeCheck(w: WorldState, o: Org): boolean {
  if (o.player.rank !== 2 || repOf(w, o) < 0.5 || w.day - (o.player.joined ?? w.day) < 10) return false;
  const lead = folkById(w, o.leader ?? '');
  const fans = o.members.filter((id) => {
    const f = folkById(w, id);
    return f && f.lastMet >= 0 && f.trust > 0.6;
  }).length;
  if (fans < Math.max(2, o.members.length * 0.35) || polOf(w).offers.some((x) => x.orgId === o.id)) return false;
  polOf(w).offers.push({ kind: 'representante', regionId: o.regionId, orgId: o.id, day: w.day });
  (w.life!.identity!.inbox ??= []).push(`En ${o.name} quieren que seas tú quien hable por ellos en el consejo${lead ? `, en lugar de ${lead.name}` : ''}.`);
  return true;
}

/** Si actúas contra el grupo siendo de los suyos, te echan. */
export function expulsionCheck(w: WorldState, o: Org): string | null {
  if (o.player.rank < 2 || o.player.rank === 4 && o.founder === 'jugador') return null;
  if (repOf(w, o) > -0.2) return null;
  o.player.rank = 0;
  o.player.expelled = w.day;
  if (o.leader === 'jugador') o.leader = pickLeader(w, o.members);
  const text = `${o.name} te ha expulsado. Dicen que les diste la espalda.`;
  story(w, `Fue expulsado de ${o.name}.`, 'error');
  polOf(w).legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'derrota', regionId: o.regionId, text: `Expulsado de ${o.name}.` });
  for (const id of o.members) {
    const f = folkById(w, id);
    if (f) memorize(w, f, { kind: 'expulsion', about: 'jugador', text: 'Le echamos del grupo. Nos traicionó.', w: -0.5, src: 'oido' });
  }
  return text;
}

/**
 * Fundar un grupo propio: hace falta ser alguien (respetado), algo de dinero
 * y gente que comparta la causa. El grupo empieza pequeño y crece si la
 * causa tiene sentido para los vecinos.
 */
export function canFound(w: WorldState, regionId: number, law: LawId, value: string): { ok: boolean; why: string; who: Folk[] } {
  const id = w.life!.identity!;
  const lv = (id.standing[regionId] ?? 0);
  if (lv < 2) return { ok: false, why: 'Aquí aún no te conocen lo bastante para que te sigan.', who: [] };
  if (id.needs.coins < 15) return { ok: false, why: 'Hace falta algo de dinero para empezar (unas quince monedas).', who: [] };
  if (lawsOf(w, regionId)[law] === value) return { ok: false, why: 'Eso ya es ley aquí.', who: [] };
  const who = adultsOf(w, regionId).filter((f) => {
    if (f.lastMet < 0 || f.trust < 0.5 || f.resentment > 0.3) return false;
    const mine = orgsOfFolk(w, f.id);
    const likes = mine.some((o) => gainOf(w, o, law, value) > 0.15) || (f.p!.needs.comida < 0.5 && law === 'agricultura' && value === 'granero');
    return likes || (trait(f, 'curioso') > 60 && f.trust > 0.65);
  });
  if (who.length < 3) return { ok: false, why: `No hay bastante gente de tu parte para esa causa (${who.length ? 'apenas un par' : 'nadie'}).`, who };
  return { ok: true, why: '', who };
}

export function foundOrg(w: WorldState, regionId: number, law: LawId, value: string, name: string): { ok: boolean; text: string; org?: Org } {
  const c = canFound(w, regionId, law, value);
  if (!c.ok) return { ok: false, text: c.why };
  const id = w.life!.identity!;
  id.needs.coins -= 15;
  const kind: OrgKind = law === 'trabajo' ? 'artesanos' : law === 'agricultura' || law === 'propiedad' ? 'comunidad' : law === 'comercio' || law === 'impuestos' ? 'comerciantes' : law === 'educacion' || law === 'recursos' ? 'sabios' : 'comunidad';
  const o: Org = {
    id: nid(w, 'o'), regionId, kind, name, members: c.who.map((f) => f.id), leader: 'jugador', founded: w.day, founder: 'jugador', funds: 15, standing: 0.25, discontent: 0.4, hot: 0, hidden: false, known: true,
    cause: { law, value }, player: { rep: 0.5, rank: 4, tasks: 0, joined: w.day }, history: [{ day: w.day, text: `Fundado por ${w.life!.player.name} para conseguir ${LAWS[law].label[value]}.` }],
  };
  polOf(w).orgs.push(o);
  invalidateOrgIndex(w);
  story(w, `Fundó ${name} en ${w.regions[regionId].name}, para conseguir ${LAWS[law].label[value]}.`, 'logro');
  polOf(w).legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'organizacion', regionId, text: `Fundó ${name}.`, ref: o.id });
  recordDecision(w, 'pueblo', regionId, `Fundó ${name}.`);
  logEvent(w, regionId, 'politica', `Nace ${name}: quieren ${LAWS[law].label[value]}.`, o.members);
  for (const f of c.who) memorize(w, f, { kind: 'grupo', about: 'jugador', text: `Nos juntamos con el forastero para pedir ${LAWS[law].label[value]}.`, w: 0.3, src: 'propio' });
  return { ok: true, text: `${c.who.map((f) => f.name).slice(0, 4).join(', ')} se reúnen contigo en la posada. Así nace ${name}.`, org: o };
}

/** El grupo crece si su causa le sirve a la gente (los fundados por el jugador también). */
export function growOrg(w: WorldState, rng: Rng, o: Org): void {
  if (!o.cause || !rng.chance(0.15)) return;
  const cand = adultsOf(w, o.regionId).filter((f) => !o.members.includes(f.id) && orgsOfFolk(w, f.id).some((x) => gainOf(w, x, o.cause!.law, o.cause!.value) > 0.25));
  const f = cand.length ? rng.pick(cand) : undefined;
  if (f) o.members.push(f.id), invalidateOrgIndex(w);
}

/** Lo que se sabe de un grupo, en palabras. */
export function describeOrg(w: WorldState, o: Org): string[] {
  const lines: string[] = [];
  const lead = o.leader === 'jugador' ? 'tú' : folkById(w, o.leader ?? '')?.name;
  lines.push(`${o.members.length > 12 ? 'Muchos' : o.members.length > 5 ? 'Bastantes' : 'Unos pocos'} vecinos${lead ? `; lo dirige ${lead}` : ''}. Quieren ${ORG[o.kind].objective}.`);
  if (o.cause) lines.push(`Su causa: ${LAWS[o.cause.law].label[o.cause.value]}.`);
  if (o.action) lines.push(o.action.kind === 'huelga' ? 'Ahora mismo están de huelga.' : o.action.kind === 'boicot' ? 'Tienen los puestos cerrados en protesta.' : o.action.kind === 'motin' ? 'Están amotinados.' : 'Están protestando.');
  else if (o.discontent > 0.62) lines.push(`Están muy enfadados${o.grievance ? `: ${o.grievance}` : ''}.`);
  else if (o.discontent > 0.45) lines.push(`Se quejan${o.grievance ? `: ${o.grievance}` : ''}.`);
  else lines.push('Están conformes, más o menos.');
  if (o.goal) lines.push(`Lo que piden ahora: ${LAWS[o.goal.law].label[o.goal.value]}.`);
  lines.push(`De ti: ${repWord(w, o)}${o.player.rank >= 2 ? ` (${ORG_RANK[o.player.rank]})` : ''}.`);
  return lines;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export { NEEDS };
