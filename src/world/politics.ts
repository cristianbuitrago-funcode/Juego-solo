import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx } from '../core/world';
import { record } from '../core/chronicle';
import { CULTURES } from '../core/content/cultures';
import { foodDays, marketOf } from './economy';
import { seedRumor } from './gossip';
import { chanceOf, gain, levelOf, story, syncAuthority, type GainNote } from './identity';
import { migrate } from './arcs';
import { folkById, kinOf, logEvent, memorize, NEEDS, playerRegion, trait } from './society';
import type { Folk } from './types';
import { seasonOf } from './clock';
import { adjustRep, ensureOrgs, joinOrg, expulsionCheck, gainOf, growOrg, invalidateOrgIndex, orgById, orgDay, orgsOf, orgsOfFolk, refreshOrgs, representativeCheck, repOf, rivalry } from './orgs';
import { diplomacyDay } from './diplomacy';
import { intrigueDay } from './intrigue';
import { warDay } from './war';
import { forecastDay } from './forecast';
import { GOV, LAWS, nid, polOf, SCALES, type Gov, type GovSystem, type LawId, type Laws, type Org, type Pressure, type Proposal, type Scale } from './polstate';

/**
 * La política como sistema. Cada pueblo tiene su forma de gobierno (que
 * decide de verdad de otra manera), unas pocas leyes que mueven la economía
 * y la vida diaria, y grupos que empujan en un sentido u otro. Las leyes no
 * se cambian solas: alguien las propone, otros votan según sus intereses,
 * y el jugador puede convencer, negociar, cambiar favores, usar lo que sabe…
 * o perder. Las consecuencias llegan después, encadenadas:
 *
 *   SUBEN LOS IMPUESTOS → LOS COMERCIANTES GANAN MENOS → CIERRAN PUESTOS
 *   → HAY MENOS TRABAJO → LA GENTE SE VA → SE RECAUDA MENOS
 */

// ---------------------------------------------------------------------------
// Acceso y creación
// ---------------------------------------------------------------------------
export function govOf(w: WorldState, regionId: number): Gov {
  const pol = polOf(w);
  return (pol.govs[regionId] ??= initGov(w, regionId));
}

export const lawsOf = (w: WorldState, regionId: number): Laws => govOf(w, regionId).laws;

function initGov(w: WorldState, regionId: number): Gov {
  const r = w.regions[regionId];
  const rng = new Rng(hashString(`gov:${w.seed}:${regionId}`));
  const tr = CULTURES.find((c) => c.id === r.culture)?.traits ?? { curiosity: 0.5, pride: 0.5, mercantile: 0.5, caution: 0.5, spirituality: 0.5 };
  const system: GovSystem = r.isHome ? 'consejo' : rng.weighted(['consejo', 'alcalde', 'monarquia', 'republica', 'familias'] as GovSystem[], (s) => (s === 'consejo' ? 0.8 : s === 'alcalde' ? 0.5 + tr.caution * 0.5 : s === 'monarquia' ? 0.2 + tr.pride * 0.9 : s === 'republica' ? 0.2 + tr.curiosity * 0.5 : 0.2 + tr.mercantile * 0.8))!;
  const laws: Laws = {
    impuestos: 'medio',
    comercio: tr.mercantile > 0.6 ? 'libre' : rng.chance(0.4) ? 'aranceles' : 'libre',
    propiedad: rng.chance(0.5) ? 'comunal' : 'privada',
    agricultura: rng.chance(0.25) ? 'granero' : 'libre',
    trabajo: rng.chance(0.35) ? 'gremios' : 'libre',
    seguridad: tr.caution > 0.65 ? 'alta' : 'normal',
    migracion: !r.isHome && tr.pride > 0.7 && rng.chance(0.5) ? 'cerrada' : 'abierta',
    educacion: tr.curiosity > 0.65 && rng.chance(0.5) ? 'escuela' : 'ninguna',
    recursos: 'libre',
  };
  if (system === 'familias') laws.propiedad = 'privada';
  const g: Gov = { system, council: [], since: w.day - 300, legitimacy: 0.62, repression: 0, laws, history: [] };
  if (GOV[system].elections) g.nextElection = w.day + 25 + rng.int(0, 20);
  return g;
}

/** Crea gobiernos y grupos la primera vez (partidas nuevas y antiguas). */
export function ensurePolitics(w: WorldState): void {
  if (!w.life?.society) return;
  const pol = polOf(w);
  (w.sim ??= {}).worldPolitics = true;
  ensureOrgs(w);
  for (const r of w.regions) {
    const g = govOf(w, r.id);
    if (!g.ruler || (g.ruler !== 'jugador' && !folkById(w, g.ruler)?.alive)) g.ruler = pickRuler(w, r.id, g);
    if (!g.council.length) g.council = councilOf(w, r.id);
    pol.owner[r.id] ??= r.id;
  }
}

function pickRuler(w: WorldState, regionId: number, g: Gov): string | undefined {
  const adults = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 18 && f.p);
  if (g.system === 'militar') {
    const guard = orgsOf(w, regionId).find((o) => o.kind === 'guardia');
    if (guard?.leader && guard.leader !== 'jugador') return guard.leader;
  }
  const lider = adults.find((f) => f.role === 'lider');
  if (lider) return lider.id;
  return [...adults].sort((a, b) => trait(b, 'ambicioso') + b.age * 0.4 + (b.p!.coins ?? 0) * 0.3 - (trait(a, 'ambicioso') + a.age * 0.4 + (a.p!.coins ?? 0) * 0.3))[0]?.id;
}

/** ¿Tiene el jugador asiento en el órgano que decide? */
export function playerSeat(w: WorldState, regionId: number): boolean {
  const id = w.life!.identity!;
  const g = govOf(w, regionId);
  if (g.ruler === 'jugador') return true;
  if ((id.rank[regionId] ?? 0) >= 5) return true;
  if (g.system === 'republica') return (id.standing[regionId] ?? 0) >= 2;
  if (g.system === 'consejo' || g.system === 'federacion' || g.system === 'familias') return orgsOf(w, regionId).some((o) => o.player.rank >= 3 && seatOrgs(w, regionId).includes(o));
  return false;
}

/** ¿Es el jugador consejero de quien gobierna? */
export const isAdviser = (w: WorldState, regionId: number) => (w.life!.identity!.rank[regionId] ?? 0) >= 4 || polOf(w).roles.some((r) => r.kind === 'consejero' && r.regionId === regionId && !r.lost);

const seatOrgs = (w: WorldState, regionId: number) => orgsOf(w, regionId).filter((o) => !o.hidden && o.members.length >= 2).sort((a, b) => b.standing - a.standing).slice(0, 5);

/** Quiénes votan o aconsejan, según el sistema. */
export function councilOf(w: WorldState, regionId: number): string[] {
  const g = govOf(w, regionId);
  const out = new Set<string>();
  if (g.ruler) out.add(g.ruler);
  const adults = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 18 && f.p);
  switch (g.system) {
    case 'consejo':
    case 'federacion':
      for (const o of seatOrgs(w, regionId)) {
        const rep = o.player.rank >= 3 ? 'jugador' : o.leader;
        if (rep) out.add(rep);
      }
      break;
    case 'familias':
      for (const f of [...adults].sort((a, b) => b.p!.coins - a.p!.coins).slice(0, 5)) out.add(f.id);
      for (const o of seatOrgs(w, regionId)) if (o.player.rank >= 3 && o.kind === 'familias') out.add('jugador');
      break;
    case 'alcalde':
      for (const o of seatOrgs(w, regionId).slice(0, 3)) if (o.leader && o.leader !== 'jugador') out.add(o.leader);
      break;
    case 'monarquia':
      for (const o of orgsOf(w, regionId).filter((x) => x.kind === 'familias' || x.kind === 'guardia')) if (o.leader && o.leader !== 'jugador') out.add(o.leader);
      break;
    case 'militar':
      for (const o of orgsOf(w, regionId).filter((x) => x.kind === 'guardia')) for (const m of o.members.slice(0, 3)) out.add(m);
      break;
    case 'republica':
      for (const o of seatOrgs(w, regionId).slice(0, 3)) if (o.leader && o.leader !== 'jugador') out.add(o.leader);
      break;
  }
  if ((w.life!.identity!.rank[regionId] ?? 0) >= 5 && g.system !== 'monarquia' && g.system !== 'militar') out.add('jugador');
  return [...out];
}

// ---------------------------------------------------------------------------
// Efectos de las leyes en la economía (se leen en economy.ts, trade.ts, population.ts)
// ---------------------------------------------------------------------------
export interface LawFx {
  tax: number;
  tariff: number;
  closed: boolean;
  aid: number; // umbral de ayuda del granero (fracción de lo que necesita una casa)
  effort: number;
  craft: number;
  extract: number;
  guard: number;
  guilds: boolean;
  closedBorders: boolean;
}

export function lawFx(w: WorldState, regionId: number): LawFx {
  const life = w.life;
  if (!life?.politics?.govs[regionId]) return { tax: 0.06, tariff: 0, closed: false, aid: 0.65, effort: 1, craft: 1, extract: 1, guard: 1, guilds: false, closedBorders: false };
  const l = lawsOf(w, regionId);
  const g = govOf(w, regionId);
  const schoolDays = l.educacion === 'escuela' ? w.day - (g.history.filter((h) => h.text.includes('escuela')).pop()?.day ?? g.since) : 0;
  return {
    tax: l.impuestos === 'bajo' ? 0.03 : l.impuestos === 'alto' ? 0.13 : 0.06,
    tariff: l.comercio === 'aranceles' ? 0.18 : 0,
    closed: l.comercio === 'cerrado',
    // (Los valores «de siempre» son los de la Fase 3: la ley solo cambia algo cuando se aleja de ellos.)
    aid: l.propiedad === 'comunal' ? 0.8 : 0.65,
    effort: (l.propiedad === 'comunal' ? 0.95 : 1) * (schoolDays > 20 ? 1.05 : 1),
    craft: l.trabajo === 'gremios' ? 1.15 : 1,
    extract: l.recursos === 'protegidos' ? 0.6 : 1,
    guard: l.seguridad === 'alta' ? 1.7 : l.seguridad === 'baja' ? 0.45 : 1,
    guilds: l.trabajo === 'gremios',
    closedBorders: l.migracion === 'cerrada',
  };
}

/** ¿Puede entrar una caravana de `from` en el mercado de `to`? */
export function tradeAllowed(w: WorldState, from: number, to: number): boolean {
  if (!w.life?.politics) return true;
  if (!lawFx(w, to).closed) return true;
  return polOf(w).treaties.some((t) => !t.broken && t.until >= w.day && (t.kind === 'comercio' || t.kind === 'alianza') && ((t.a === from && t.b === to) || (t.a === to && t.b === from)));
}

/** Arancel que paga lo que llega de `from` a `to` (0 con tratado de comercio). */
export function tariffOf(w: WorldState, from: number, to: number): number {
  if (!w.life?.politics) return 0;
  if (polOf(w).treaties.some((t) => !t.broken && t.until >= w.day && (t.kind === 'comercio' || t.kind === 'alianza') && ((t.a === from && t.b === to) || (t.a === to && t.b === from)))) return 0;
  return lawFx(w, to).tariff;
}

/** Lo que las leyes cuestan o hacen cada día (granero, escuela, guardia, bosques). */
function lawsDay(w: WorldState, rng: Rng, regionId: number): string[] {
  const out: string[] = [];
  const l = lawsOf(w, regionId);
  const m = marketOf(w, regionId);
  const r = w.regions[regionId];
  const pol = polOf(w);
  const fx = lawFx(w, regionId);
  m.law = { tax: fx.tax, effort: fx.effort, craft: fx.craft, extract: fx.extract, aid: fx.aid, guard: fx.guard };
  if (l.agricultura === 'granero') {
    const season = seasonOf(w.day);
    const store = pol.granary[regionId] ?? 0;
    const days = foodDays(w, regionId);
    if ((season === 'otoño' || days > 7) && m.stock.trigo > 10 && m.treasury > 2 && store < 80) {
      const n = Math.min(m.stock.trigo * 0.08, m.treasury / Math.max(0.3, m.price.trigo), 6);
      m.stock.trigo -= n;
      m.treasury -= n * m.price.trigo * 0.8;
      pol.granary[regionId] = store + n;
    } else if (days < 1.8 && store > 1) {
      const n = Math.min(store, 8);
      m.stock.trigo += n;
      pol.granary[regionId] = store - n;
      if (store > 6 && rng.chance(0.4)) {
        const text = `${r.name} abre el granero común: sale grano de las reservas.`;
        logEvent(w, regionId, 'politica', text, []);
        if (playerRegion(w) === regionId) out.push(text);
      }
    }
  }
  if (l.educacion === 'escuela') m.treasury = Math.max(0, m.treasury - 0.5);
  if (l.seguridad === 'alta') {
    m.treasury = Math.max(0, m.treasury - 0.4);
    if (r.flags.bandidos && rng.chance(0.12)) {
      delete r.flags.bandidos;
      const text = `La guardia de ${r.name} limpia los caminos de bandidos.`;
      logEvent(w, regionId, 'politica', text, []);
      if (playerRegion(w) === regionId) out.push(text);
    }
  }
  if (l.recursos === 'protegidos') {
    r.pressure = clamp(r.pressure - 0.004);
    r.ecology = clamp(r.ecology + 0.0015);
  }
  if (r.isHome) {
    w.player.laws.hospitalidad = l.migracion === 'abierta';
    w.player.laws.racionamiento = l.agricultura === 'granero';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Propuestas, votos y presión
// ---------------------------------------------------------------------------
export function propose(w: WorldState, regionId: number, law: LawId, value: string, from: string, days = 3): Proposal | null {
  const pol = polOf(w);
  const g = govOf(w, regionId);
  if (g.laws[law] === value) return null;
  if (pol.proposals.some((p) => p.regionId === regionId && p.law === law && (p.status === 'abierta' || w.day - p.voteDay < 8))) return null;
  // La guardia en el poder nunca baja la seguridad.
  if (g.system === 'militar' && law === 'seguridad' && value !== 'alta') return null;
  const fed = g.system === 'federacion' && (law === 'comercio' || law === 'seguridad' || law === 'migracion') ? g.federation : undefined;
  const p: Proposal = { id: nid(w, 'p'), regionId, law, value, from, day: w.day, voteDay: w.day + days, status: 'abierta', sway: {}, pressure: {}, heard: [], federal: fed };
  pol.proposals.push(p);
  if (pol.proposals.length > 120) pol.proposals = pol.proposals.filter((x) => x.status === 'abierta' || w.day - x.voteDay < 40);
  const who = from === 'jugador' ? 'Se ha propuesto' : from === 'gobierno' ? 'El gobierno propone' : `${orgById(w, from)?.name ?? 'Alguien'} propone`;
  logEvent(w, regionId, 'propuesta', `${who} ${LAWS[law].label[value]}. Se votará pronto.`, []);
  return p;
}

/** Quién vota y cuánto pesa su voto, según el sistema. */
export function votersOf(w: WorldState, p: Proposal): { id: string; weight: number }[] {
  const g = govOf(w, p.regionId);
  if (p.federal) {
    const fed = polOf(w).federations.find((f) => f.id === p.federal);
    if (fed) return fed.members.map((m) => govOf(w, m).ruler).filter((x): x is string => !!x).map((id) => ({ id, weight: 1 }));
  }
  const council = g.council.filter((id) => id === 'jugador' || folkById(w, id)?.alive);
  switch (g.system) {
    case 'consejo':
    case 'federacion':
      return council.map((id) => ({ id, weight: 1 }));
    case 'familias':
      return council.map((id) => ({ id, weight: id === 'jugador' ? 1.5 : 1 + (folkById(w, id)?.p?.coins ?? 0) / 30 }));
    case 'alcalde':
      return council.map((id) => ({ id, weight: id === g.ruler ? 3 : 0.5 }));
    case 'monarquia':
    case 'militar':
      return council.map((id) => ({ id, weight: id === g.ruler ? 5 : 0.35 }));
    case 'republica': {
      const all = w.life!.folk.filter((f) => f.alive && f.regionId === p.regionId && f.age >= 18 && f.p).map((f) => ({ id: f.id, weight: 1 }));
      if (playerSeat(w, p.regionId)) all.push({ id: 'jugador', weight: 1 });
      return all;
    }
  }
}

/** Lo que piensa un votante de una propuesta (positivo: a favor). */
export function leanOf(w: WorldState, voterId: string, p: Proposal): number {
  if (voterId === 'jugador') return p.playerVote === 'si' ? 1 : p.playerVote === 'no' ? -1 : 0;
  const f = folkById(w, voterId);
  if (!f?.p) return 0;
  const orgs = orgsOfFolk(w, f.id);
  let interest = 0;
  if (orgs.length) {
    // Pesa más el grupo al que más pertenece (el primero que no es la asamblea).
    const main = orgs.find((o) => o.kind !== 'comunidad') ?? orgs[0];
    interest = gainOf(w, main, p.law, p.value) * 0.7 + orgs.reduce((s, o) => s + gainOf(w, o, p.law, p.value), 0) / orgs.length * 0.3;
  }
  const n = f.p.needs;
  let personal = 0;
  if (p.law === 'agricultura' && p.value === 'granero' && n.comida < 0.5) personal += 0.3;
  if (p.law === 'impuestos') personal += (p.value === 'bajo' ? 1 : p.value === 'alto' ? -1 : 0) * (n.dinero < 0.4 ? 0.2 : 0.05);
  if (p.law === 'seguridad' && p.value === 'alta' && n.seguridad < 0.45) personal += 0.25;
  if (p.law === 'migracion' && p.value === 'cerrada') personal += (trait(f, 'desconfiado') - 50) / 200;
  if (p.law === 'educacion' && p.value === 'escuela') personal += (trait(f, 'curioso') - 50) / 250;
  personal += p.law === 'propiedad' ? (p.value === 'comunal' ? 1 : -1) * (trait(f, 'generoso') - trait(f, 'egoista')) / 300 : 0;
  const statusQuo = -0.16 - trait(f, 'desconfiado') / 500;
  let sponsor = 0;
  if (p.from === 'jugador' && f.lastMet >= 0) sponsor = (f.trust - 0.5) * 0.5 + f.gratitude * 0.35 - f.resentment * 0.6;
  else if (p.from !== 'gobierno') {
    const so = orgById(w, p.from);
    if (so) sponsor = orgs.includes(so) ? 0.25 : -0.12 * Math.max(...orgs.map((o) => rivalry(w, o, so)), 0);
  }
  // Los consejeros miran de reojo a quien gobierna (y el gobernante, a su consejero de confianza).
  const g = govOf(w, p.regionId);
  if (g.ruler === f.id && g.advice?.[p.law]) sponsor += g.advice[p.law] === p.value ? 0.3 : -0.2;
  return interest + personal + statusQuo + sponsor + (p.sway[f.id] ?? 0);
}

/** Recuento: ¿saldría hoy? */
export function tally(w: WorldState, p: Proposal): { yes: number; no: number; votes: Record<string, boolean> } {
  let yes = 0;
  let no = 0;
  const votes: Record<string, boolean> = {};
  for (const v of votersOf(w, p)) {
    if (v.id === 'jugador' && (!p.playerVote || p.playerVote === 'abstencion')) continue;
    const l = leanOf(w, v.id, p);
    votes[v.id] = l > 0;
    if (l > 0) yes += v.weight;
    else no += v.weight;
  }
  return { yes, no, votes };
}

/** La votación llega: se cuenta, se cambia la ley (o no) y todo el mundo lo recuerda. */
function resolve(w: WorldState, p: Proposal): string[] {
  const out: string[] = [];
  const g = govOf(w, p.regionId);
  const r = w.regions[p.regionId];
  const id = w.life!.identity!;
  // Si gobierna el jugador en solitario, decide él (y si no decide, la propuesta muere).
  const solo = g.ruler === 'jugador' && (g.system === 'alcalde' || g.system === 'monarquia' || g.system === 'militar');
  let pass: boolean;
  let votes: Record<string, boolean> = {};
  if (solo) {
    pass = p.playerVote === 'si';
    if (!p.playerVote) p.why = 'nadie respondió';
  } else {
    const t = tally(w, p);
    votes = t.votes;
    pass = t.yes > t.no;
    p.why = `${Math.round(t.yes * 10) / 10} a favor, ${Math.round(t.no * 10) / 10} en contra`;
  }
  p.votes = votes;
  p.status = pass ? 'aprobada' : 'rechazada';
  const label = LAWS[p.law].label[p.value];
  const text = pass ? `${r.name} aprueba ${label}.` : `${r.name} rechaza ${label}.`;
  logEvent(w, p.regionId, 'ley', text, Object.keys(votes).filter((x) => x !== 'jugador').slice(0, 6));
  polOf(w).log.push({ day: w.day, regionId: p.regionId, kind: 'ley', text });
  if (pass) setLaw(w, p.regionId, p.law, p.value, p.from === 'jugador' ? 'jugador' : undefined);
  else if (p.from !== 'jugador' && p.from !== 'gobierno') {
    const o = orgById(w, p.from);
    if (o) o.discontent = clamp(o.discontent + 0.06);
  }
  // Las votaciones dejan huella: quién votó qué y quién lo empujó.
  const involved = p.from === 'jugador' || (p.playerVote && p.playerVote !== 'abstencion') || Object.keys(p.pressure).length > 0;
  if (involved) {
    const side = p.from === 'jugador' ? 'si' : p.playerVote ?? (Object.values(p.sway).reduce((a, b) => a + b, 0) > 0 ? 'si' : 'no');
    for (const o of orgsOf(w, p.regionId)) {
      const gn = gainOf(w, o, p.law, pass ? (side === 'si' ? p.value : g.laws[p.law]) : p.value);
      const sign = side === 'si' ? 1 : side === 'no' ? -1 : 0;
      const towards = gainOf(w, o, p.law, p.value) * sign;
      if (Math.abs(towards) > 0.15) adjustRep(w, o, clamp(towards, -0.6, 0.6) * 0.25);
      void gn;
      const out2 = expulsionCheck(w, o);
      if (out2) out.push(out2);
    }
    const won = (side === 'si') === pass;
    recordDecision(w, 'pueblo', p.regionId, `${won ? 'Ganó' : 'Perdió'} la votación sobre ${label}.`);
    story(w, won ? `${p.from === 'jugador' ? 'Consiguió' : 'Ayudó a decidir'} que ${r.name} ${pass ? 'aprobara' : 'rechazara'} ${label}.` : `Perdió la votación sobre ${label} en ${r.name}.`, won ? 'decision' : 'error');
    if (p.from === 'jugador' && pass) polOf(w).legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'ley', regionId: p.regionId, text: `Logró ${label} en ${r.name}.`, ref: p.law });
    (id.inbox ??= []).push(text);
  }
  if (playerRegion(w) === p.regionId || involved) out.push(text);
  // Promesas cumplidas.
  for (const pr of polOf(w).promises) if (!pr.kept && pass && pr.law === p.law && pr.value === p.value && orgById(w, pr.orgId)?.regionId === p.regionId) pr.kept = true;
  return out;
}

/** Cambia una ley y deja la cadena de causas en la crónica. */
export function setLaw(w: WorldState, regionId: number, law: LawId, value: string, by?: 'jugador'): void {
  const g = govOf(w, regionId);
  const old = g.laws[law];
  if (old === value) return;
  g.laws[law] = value;
  const r = w.regions[regionId];
  const text = `${r.name} cambia de ley: ${LAWS[law].label[value]} (antes, ${LAWS[law].label[old]}).`;
  g.history.push({ day: w.day, text: value === 'escuela' ? `${text} Se abre la escuela.` : text });
  if (g.history.length > 40) g.history.shift();
  const ctx = makeCtx(w);
  record(ctx, { kind: 'accion', text, regions: [regionId], importance: 2, byPlayer: by === 'jugador', known: r.isHome || playerRegion(w) === regionId || by === 'jugador' });
  commitCtx(ctx);
  // Consecuencias que se notarán más tarde (se comprueban de verdad cuando llegan).
  const pol = polOf(w);
  const m = marketOf(w, regionId);
  const merchants = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.role === 'comerciante').length;
  pol.delayed.push({ day: w.day + 6, kind: 'eco', regionId, data: { law, value, old, cash: m.cash, treasury: m.treasury, closed: m.closedStalls, merchants, pop: r.population } });
  pol.delayed.push({ day: w.day + 18, kind: 'eco', regionId, data: { law, value, old, cash: m.cash, treasury: m.treasury, closed: m.closedStalls, merchants, pop: r.population, late: 1 } });
}

/** El jugador presiona a un votante. Devuelve lo que pasa (sin cifras). */
export function lobby(w: WorldState, voterId: string, propId: string, how: Pressure, extra: { coins?: number; secret?: string } = {}): { ok: boolean; lines: string[]; notes: GainNote[] } {
  const pol = polOf(w);
  const p = pol.proposals.find((x) => x.id === propId);
  const f = folkById(w, voterId);
  const id = w.life!.identity!;
  if (!p || !f?.p || p.status !== 'abierta') return { ok: false, lines: ['Ya no hay nada que hablar.'], notes: [] };
  const label = LAWS[p.law].label[p.value];
  const rng = new Rng(hashString(`${voterId}:${propId}:${how}:${w.day}`));
  const before = leanOf(w, voterId, p);
  const lines: string[] = [];
  let notes: GainNote[] = [];
  const add = (d: number) => (p.sway[voterId] = (p.sway[voterId] ?? 0) + d);
  (p.pressure[voterId] ??= []).push(how);
  if (!p.heard.includes(voterId)) p.heard.push(voterId);
  switch (how) {
    case 'argumento': {
      // Convencer con razones: cuenta lo que sabes (economía, política, lo que has visto).
      const know = levelOf(id, 'k:economia') * 0.06 + levelOf(id, 'k:politica') * 0.06 + (pol.forecasts.some((x) => x.regionId === p.regionId && x.result === 'acierto') ? 0.1 : 0);
      const odds = chanceOf(id, 'persuasion', 1) + know + (trait(f, 'curioso') - 50) / 250 - (trait(f, 'desconfiado') - 50) / 200 - (trait(f, 'orgulloso') - 50) / 300 + (f.trust - 0.5) * 0.4;
      if (rng.chance(clamp(odds, 0.05, 0.92))) {
        add(0.22 + know);
        lines.push(rng.pick(['«Visto así… quizá tengas razón.»', '«No lo había pensado de esa manera.»', '«Bueno. Lo pensaré con calma, pero me has dado que pensar.»']));
      } else {
        add(-0.04);
        lines.push(rng.pick(['«Hablas bien, pero no me convences.»', '«Eso lo dices porque te conviene.»', '«Ya veremos.» No parece muy convencido.']));
      }
      notes = gain(w, 'persuasion', 0.5);
      break;
    }
    case 'favor': {
      // Prometer apoyo a lo que quiere su grupo: funciona, pero obliga.
      const o = orgsOfFolk(w, f.id).find((x) => x.goal) ?? orgsOfFolk(w, f.id)[0];
      if (!o?.goal) {
        lines.push('«No necesito nada de ti ahora mismo.»');
        break;
      }
      pol.promises.push({ orgId: o.id, law: o.goal.law, value: o.goal.value, until: w.day + 30, folk: f.id });
      add(0.38);
      lines.push(`«Si me apoyas cuando pidamos ${LAWS[o.goal.law].label[o.goal.value]}, yo te apoyo en esto.» Os dais la mano.`, '(Has dado tu palabra. Lo recordarán.)');
      notes = gain(w, 'diplomacia', 0.4);
      break;
    }
    case 'cobro': {
      const owed = pol.favors[f.id] ?? 0;
      if (owed <= 0) {
        lines.push('«¿Que te debo algo? No recuerdo ningún favor.»');
        add(-0.05);
        break;
      }
      pol.favors[f.id] = owed - 1;
      add(0.42);
      lines.push('«Está bien. Te lo debo.» Asiente despacio.');
      break;
    }
    case 'informacion': {
      const s = pol.secrets.find((x) => x.id === extra.secret && x.known);
      if (!s) {
        lines.push('No tienes nada que contarle que le haga cambiar de idea.');
        break;
      }
      s.used.push('negociar');
      if (!s.holders.includes(f.id)) s.holders.push(f.id);
      const relevant = s.regionId === p.regionId;
      add(relevant ? 0.32 : 0.12);
      lines.push(`Le cuentas lo que sabes: ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}`, relevant ? '«Eso lo cambia todo.» Se queda callado un rato.' : '«Interesante… pero no veo qué tiene que ver.»');
      notes = gain(w, 'investigacion', 0.3);
      break;
    }
    case 'chantaje': {
      const s = pol.secrets.find((x) => x.id === extra.secret && x.known && x.about === f.id);
      if (!s) {
        lines.push('No sabes nada de esta persona con lo que apretarle.');
        break;
      }
      s.used.push('chantajear');
      add(0.9);
      f.resentment = Math.min(1, f.resentment + 0.45);
      f.fear = Math.min(1, f.fear + 0.3);
      memorize(w, f, { kind: 'chantaje', about: 'jugador', text: 'Me chantajeó. No lo olvidaré.', w: -0.9, src: 'propio' });
      lines.push('Se pone pálido. «Está bien. Votaré lo que quieras.» Pero sus ojos dicen otra cosa.');
      pol.delayed.push({ day: w.day + 10 + rng.int(0, 12), kind: 'venganza', regionId: f.regionId, data: { folk: f.id, secret: s.id } });
      notes = gain(w, 'sigilo', 0.4);
      break;
    }
    case 'soborno': {
      const c = Math.min(extra.coins ?? 0, id.needs.coins);
      if (c <= 0) break;
      const greedy = (trait(f, 'egoista') + trait(f, 'ambicioso')) / 200;
      if (f.honesty > 0.75 && greedy < 0.55) {
        f.resentment = Math.min(1, f.resentment + 0.25);
        add(-0.2);
        lines.push('«¿Me tomas por alguien que se vende?» Te devuelve las monedas con desprecio.');
        seedRumor(w, { regionId: f.regionId, kind: 'politica', subject: 'jugador', target: f.id, witnesses: [f.id], versions: [`El forastero intentó comprar el voto de ${f.name}.`, 'Dicen que el forastero compra votos.'], tone: -0.6 });
      } else {
        id.needs.coins -= c;
        f.p.coins += c;
        add(c / 12 * (0.5 + greedy));
        lines.push('Las monedas desaparecen en su bolsillo. «Veré qué puedo hacer.»');
      }
      break;
    }
  }
  const after = leanOf(w, voterId, p);
  if (Math.sign(after) !== Math.sign(before) && after > 0) lines.push(`(Parece que ahora votará a favor de ${label}.)`);
  w.life!.clock += 30;
  return { ok: true, lines, notes };
}

/** Lo que el jugador cree que votará cada uno (solo de quienes le han hablado). */
export function leanWord(l: number): string {
  return l > 0.35 ? 'lo apoya sin dudar' : l > 0.06 ? 'se inclina a favor' : l > -0.06 ? 'duda' : l > -0.35 ? 'se inclina en contra' : 'está en contra';
}

export function supportReading(w: WorldState, p: Proposal): string[] {
  const lines: string[] = [];
  const voters = votersOf(w, p);
  const known = voters.filter((v) => v.id !== 'jugador' && p.heard.includes(v.id));
  for (const v of known.slice(0, 7)) {
    const f = folkById(w, v.id);
    const org = orgsOfFolk(w, v.id).find((o) => o.kind !== 'comunidad');
    lines.push(`${f?.name}${org ? ` (${org.name})` : ''}: ${leanWord(leanOf(w, v.id, p))}.`);
  }
  // Un pálpito general, si has hablado con bastante gente o escuchado en la posada.
  if (known.length >= Math.min(3, voters.length) || p.heard.includes('posada')) {
    const t = tally(w, p);
    const margin = (t.yes - t.no) / Math.max(1, t.yes + t.no);
    lines.push(margin > 0.3 ? 'En el pueblo se da por hecho que saldrá.' : margin > 0.05 ? 'Parece que saldrá, pero por poco.' : margin > -0.05 ? 'Está muy reñido.' : margin > -0.3 ? 'Parece que no saldrá.' : 'Casi nadie la apoya.');
  } else lines.push('No sabes aún qué piensa la mayoría. Habla con quienes votan, o escucha en la posada.');
  return lines;
}

// ---------------------------------------------------------------------------
// Elecciones, sucesión y cambios de gobierno
// ---------------------------------------------------------------------------
function candidateScore(w: WorldState, voter: Folk, cand: string, g: Gov): number {
  const sat = NEEDS.reduce((s, k) => s + voter.p!.needs[k], 0) / NEEDS.length;
  const myOrgs = orgsOfFolk(w, voter.id);
  if (cand === 'jugador') {
    const known = voter.lastMet >= 0 ? (voter.trust - 0.5) * 1.2 + voter.gratitude - voter.resentment * 1.4 : -0.3;
    const groups = myOrgs.reduce((s, o) => s + repOf(w, o), 0) / Math.max(1, myOrgs.length);
    const comrade = myOrgs.some((o) => o.kind !== 'comunidad' && o.player.rank >= 2) ? 0.3 : 0;
    return known + groups * 0.6 + comrade + (g.ruler === 'jugador' ? (sat - 0.55) * 1.5 : 0);
  }
  const c = folkById(w, cand);
  if (!c?.p) return -9;
  const t = w.life!.society!.ties[voter.id < cand ? `${voter.id}|${cand}` : `${cand}|${voter.id}`];
  const theirOrgs = orgsOfFolk(w, cand);
  const shared = myOrgs.some((o) => o.kind !== 'comunidad' && theirOrgs.includes(o)) ? 0.3 : 0;
  const incumbent = g.ruler === cand ? (sat - 0.55) * 1.6 + 0.1 : 0;
  return (t ? t.aff / 120 : 0) + shared + incumbent + trait(c, 'sociable') / 400;
}

function election(w: WorldState, rng: Rng, regionId: number): string[] {
  const g = govOf(w, regionId);
  const r = w.regions[regionId];
  const pol = polOf(w);
  const out: string[] = [];
  g.nextElection = w.day + 40;
  const cands = new Set<string>();
  if (g.ruler) cands.add(g.ruler);
  const angry = orgsOf(w, regionId).filter((o) => !o.hidden && o.leader && o.leader !== 'jugador').sort((a, b) => b.discontent * b.standing - a.discontent * a.standing)[0];
  if (angry?.leader) cands.add(angry.leader);
  if (pol.candidacy[regionId]) cands.add('jugador');
  if (cands.size < 2) {
    const alt = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 25 && f.p && !cands.has(f.id)).sort((a, b) => trait(b, 'ambicioso') - trait(a, 'ambicioso'))[0];
    if (alt) cands.add(alt.id);
  }
  const list = [...cands];
  const count: Record<string, number> = Object.fromEntries(list.map((c) => [c, 0]));
  const voters = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 18 && f.p && !cands.has(f.id));
  for (const v of voters) {
    let best = list[0];
    let bv = -Infinity;
    for (const c of list) {
      const s = candidateScore(w, v, c, g) + rng.range(-0.15, 0.15);
      if (s > bv) (bv = s), (best = c);
    }
    count[best]++;
  }
  const winner = list.sort((a, b) => count[b] - count[a])[0];
  const name = (id: string) => (id === 'jugador' ? w.life!.player.name : folkById(w, id)?.name ?? 'alguien');
  const changed = winner !== g.ruler;
  const prev = g.ruler;
  g.ruler = winner;
  g.council = councilOf(w, regionId);
  const text = changed ? `Elecciones en ${r.name}: gana ${name(winner)}${prev ? `; ${name(prev)} deja el cargo` : ''}.` : `Elecciones en ${r.name}: ${name(winner)} sigue al frente.`;
  logEvent(w, regionId, 'eleccion', text, list.filter((x) => x !== 'jugador'));
  g.history.push({ day: w.day, text });
  pol.log.push({ day: w.day, regionId, kind: 'eleccion', text });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'evento', text, regions: [regionId], importance: 2, known: r.isHome || pol.candidacy[regionId] || playerRegion(w) === regionId });
  commitCtx(ctx);
  if (changed) g.legitimacy = clamp(g.legitimacy * 0.5 + 0.35);
  const id = w.life!.identity!;
  if (pol.candidacy[regionId]) {
    pol.candidacy[regionId] = false;
    const votes = `(${count.jugador} de ${voters.length} votos)`;
    if (winner === 'jugador') {
      id.rank[regionId] = 6;
      id.standing[regionId] = 6;
      story(w, `Ganó las elecciones de ${r.name} ${votes}.`, 'cargo');
      pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'cargo', regionId, text: `Elegido para gobernar ${r.name}.` });
      recordDecision(w, 'region', regionId, `Ganó las elecciones de ${r.name}.`);
      (id.inbox ??= []).push(`Has ganado las elecciones de ${r.name}. Ahora gobiernas.`);
    } else {
      story(w, `Perdió las elecciones de ${r.name} ${votes}. Ganó ${name(winner)}.`, 'error');
      pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'derrota', regionId, text: `Perdió las elecciones de ${r.name}.` });
      (id.inbox ??= []).push(`Has perdido las elecciones de ${r.name}. Ganó ${name(winner)}.`);
    }
    syncAuthority(w);
  } else if (prev === 'jugador' && winner !== 'jugador') {
    id.rank[regionId] = Math.min(id.rank[regionId] ?? 0, 5);
    story(w, `Perdió el gobierno de ${r.name} en las elecciones.`, 'error');
    pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'derrota', regionId, text: `Perdió el gobierno de ${r.name}.` });
    syncAuthority(w);
  }
  if (playerRegion(w) === regionId || pol.candidacy[regionId]) out.push(text);
  return out;
}

/** El gobierno cambia de forma (revuelta, golpe, federación…). */
export function changeGov(w: WorldState, regionId: number, system: GovSystem, ruler: string | undefined, why: string): void {
  const g = govOf(w, regionId);
  const r = w.regions[regionId];
  const old = g.system;
  g.system = system;
  g.ruler = ruler;
  g.since = w.day;
  g.legitimacy = 0.45;
  g.repression = system === 'militar' ? 0.3 : 0;
  g.nextElection = GOV[system].elections ? w.day + 30 : undefined;
  if (system === 'militar') g.laws.seguridad = 'alta';
  g.council = councilOf(w, regionId);
  const text = `${r.name} cambia de gobierno: de ${GOV[old].name} a ${GOV[system].name}${why ? `, ${why}` : ''}.`;
  g.history.push({ day: w.day, text });
  logEvent(w, regionId, 'gobierno', text, ruler && ruler !== 'jugador' ? [ruler] : []);
  polOf(w).log.push({ day: w.day, regionId, kind: 'gobierno', text });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'evento', text, regions: [regionId], importance: 3, known: true });
  commitCtx(ctx);
  const id = w.life!.identity!;
  if (ruler === 'jugador') {
    id.rank[regionId] = 6;
    id.standing[regionId] = 6;
    syncAuthority(w);
  } else if ((id.rank[regionId] ?? 0) >= 6) {
    id.rank[regionId] = 4;
    story(w, `Perdió el gobierno de ${r.name}: ${why}.`, 'error');
    syncAuthority(w);
  }
}

/** Si muere o se va quien gobierna, alguien ocupa su lugar (según el sistema). */
function succession(w: WorldState, regionId: number): string[] {
  const g = govOf(w, regionId);
  if (!g.ruler || g.ruler === 'jugador') return [];
  const f = folkById(w, g.ruler);
  if (f?.alive && f.regionId === regionId) return [];
  let next: string | undefined;
  if (g.system === 'monarquia' && f) next = kinOf(w, f.id).map((k) => folkById(w, k.id)).find((x) => x?.alive && x.age >= 16 && x.regionId === regionId)?.id;
  next ??= pickRuler(w, regionId, { ...g, ruler: undefined });
  const name = f?.name ?? 'quien gobernaba';
  g.ruler = next;
  g.council = councilOf(w, regionId);
  if (g.system === 'alcalde' || g.system === 'republica') g.nextElection = Math.min(g.nextElection ?? w.day + 6, w.day + 6);
  const text = `${w.regions[regionId].name} se queda sin ${name}. ${next ? `${folkById(w, next)?.name} ocupa su lugar${g.system === 'monarquia' ? ' por herencia' : ' de momento'}.` : 'Nadie sabe quién mandará.'}`;
  logEvent(w, regionId, 'gobierno', text, next ? [next] : []);
  g.history.push({ day: w.day, text });
  g.legitimacy = clamp(g.legitimacy - 0.08);
  return playerRegion(w) === regionId ? [text] : [];
}

// ---------------------------------------------------------------------------
// Rebelión: solo llega tras una cadena de causas (y se puede cortar en cada eslabón)
// ---------------------------------------------------------------------------
export const REBEL_STAGE = ['calma', 'descontento extendido', 'una oposición que se organiza', 'una conspiración', 'un levantamiento'];

function rebellionDay(w: WorldState, rng: Rng, regionId: number): string[] {
  const pol = polOf(w);
  const g = govOf(w, regionId);
  const r = w.regions[regionId];
  const reb = (pol.rebellions[regionId] ??= { stage: 0, since: w.day });
  const out: string[] = [];
  if (reb.outcome && w.day - reb.outcome.day < 25) return out;
  if (g.ruler === 'jugador' && reb.stage === 0 && g.legitimacy > 0.4) return out;
  const orgs = orgsOf(w, regionId).filter((o) => o.kind !== 'clandestino');
  const angry = orgs.filter((o) => o.discontent > 0.6);
  const days = w.day - reb.since;
  const step = (stage: number, text: string) => {
    reb.stage = stage;
    reb.since = w.day;
    logEvent(w, regionId, 'rebelion', text, reb.leader ? [reb.leader] : []);
    pol.log.push({ day: w.day, regionId, kind: 'rebelion', text });
    if (playerRegion(w) === regionId) out.push(text);
  };
  // Si el descontento se apaga, la cadena se rompe.
  if (reb.stage > 0 && angry.length === 0 && g.legitimacy > 0.45 && days >= 4) {
    const clan = orgById(w, reb.orgId);
    if (reb.stage >= 3 && clan) clan.dissolved = w.day;
    step(Math.max(0, reb.stage - 1), reb.stage >= 2 ? `En ${r.name} se calman los ánimos: la oposición pierde apoyos.` : `${r.name} parece más tranquilo.`);
    return out;
  }
  switch (reb.stage) {
    case 0:
      if (angry.length >= 2 && g.legitimacy < 0.52) step(1, `En ${r.name} el malestar se extiende: ${angry.map((o) => o.name).join(' y ')} están hartos.`);
      break;
    case 1:
      if (days >= 4 && angry.length >= 2) {
        const pool = angry.flatMap((o) => o.members).map((id) => folkById(w, id)).filter((f): f is Folk => !!f?.p && f.id !== g.ruler && f.age >= 20);
        const lead = pool.sort((a, b) => trait(b, 'ambicioso') + trait(b, 'valiente') + b.p!.emo.enojo * 60 - (trait(a, 'ambicioso') + trait(a, 'valiente') + a.p!.emo.enojo * 60))[0];
        if (lead) {
          reb.leader = lead.id;
          reb.cause = angry[0].grievance;
          step(2, `${lead.name} habla abiertamente contra quien gobierna ${r.name}. Cada vez le escucha más gente.`);
        }
      }
      break;
    case 2:
      if (days >= 5 && reb.leader) {
        const lead = folkById(w, reb.leader);
        if (!lead?.alive) {
          step(1, `La oposición de ${r.name} se queda sin cabeza.`);
          break;
        }
        const members = [...new Set(angry.flatMap((o) => o.members))].filter((id) => {
          const f = folkById(w, id);
          return f?.p && (f.p.emo.enojo > 0.25 || trait(f, 'valiente') > 55) && id !== g.ruler;
        });
        for (const old of orgsOf(w, regionId).filter((o) => o.kind === 'clandestino')) old.dissolved = w.day;
        const name = SECRET(w, regionId);
        const clan: Org = { id: nid(w, 'o'), regionId, kind: 'clandestino', name, members: [reb.leader, ...members.filter((x) => x !== reb.leader)].slice(0, 14), leader: reb.leader, founded: w.day, funds: 3, standing: 0.2, discontent: 0.8, hot: 0, hidden: true, known: false, player: { rep: 0, rank: 0, tasks: 0 }, history: [] };
        pol.orgs.push(clan);
        invalidateOrgIndex(w);
        reb.orgId = clan.id;
        step(3, `En ${r.name} hay reuniones de noche. Algo se prepara.`);
        pol.secrets.push({ id: nid(w, 's'), kind: 'conspiracion', regionId, about: clan.id, day: w.day, text: `${lead.name} y ${name} preparan un levantamiento contra quien gobierna ${r.name}.`, hint: `En ${r.name} hay quien se reúne de noche, lejos de la plaza.`, holders: clan.members.slice(), testimonies: [], known: false, suspected: false, used: [], public: false, expires: w.day + 60 });
      }
      break;
    case 3: {
      const clan = orgById(w, reb.orgId);
      if (!clan || clan.dissolved) {
        step(1, `La conspiración de ${r.name} se ha deshecho.`);
        break;
      }
      growOrg(w, rng, { ...clan, cause: clan.goal ?? undefined } as Org);
      const adults = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 16).length;
      const guard = orgs.find((o) => o.kind === 'guardia');
      const ready = g.legitimacy < 0.34 && (clan.members.length >= adults * 0.22 || (guard?.discontent ?? 0) > 0.55 || reb.joined);
      if (days >= 5 && ready && rng.chance(0.35)) out.push(...uprising(w, rng, regionId, clan, guard));
      break;
    }
  }
  return out;
}

function SECRET(w: WorldState, regionId: number): string {
  const names = ['Los del pozo', 'La mano abierta', 'Los sin tierra', 'El fuego de abajo', 'Los de la noche'];
  return names[(hashString(`${w.seed}:${regionId}:${w.day}`) >>> 0) % names.length];
}

function uprising(w: WorldState, rng: Rng, regionId: number, clan: Org, guard: Org | undefined): string[] {
  const pol = polOf(w);
  const g = govOf(w, regionId);
  const r = w.regions[regionId];
  const reb = pol.rebellions[regionId];
  const sympathetic = orgsOf(w, regionId).filter((o) => o !== clan && o.discontent > 0.55);
  const guardRebel = (guard?.discontent ?? 0) > 0.55;
  const rebels = clan.members.length + sympathetic.reduce((s, o) => s + o.members.length * 0.35, 0) + (guardRebel ? (guard?.members.length ?? 0) * 2 : 0) + (reb.joined ? 3 + levelOf(w.life!.identity!, 'liderazgo') : 0);
  const loyal = (guardRebel ? 0 : (guard?.members.length ?? 1) * 2.2) + (g.laws.seguridad === 'alta' ? 3 : 0) + (reb.warned ? 4 : 0) + g.legitimacy * 6;
  const won = rebels * rng.range(0.7, 1.3) > loyal;
  const lead = folkById(w, reb.leader ?? '');
  r.stability = clamp(r.stability - 0.15);
  let text: string;
  if (won) {
    const kinds = new Set([...sympathetic.map((o) => o.kind), guardRebel ? 'guardia' : '']);
    const system: GovSystem = guardRebel ? 'militar' : kinds.has('comunidad') || kinds.has('agricultores') ? 'republica' : kinds.has('familias') ? 'familias' : g.system === 'consejo' ? 'alcalde' : 'consejo';
    const ruler = reb.joined && rebels > loyal * 1.6 && levelOf(w.life!.identity!, 'liderazgo') >= 2 ? 'jugador' : lead?.id;
    changeGov(w, regionId, system, ruler, `tras un levantamiento${lead ? ` encabezado por ${lead.name}` : ''}`);
    for (const o of sympathetic) if (o.goal) setLaw(w, regionId, o.goal.law, o.goal.value);
    clan.hidden = false;
    clan.known = true;
    text = `Levantamiento en ${r.name}: ${lead?.name ?? 'los rebeldes'} toman el salón. Cae quien gobernaba.`;
    reb.outcome = { day: w.day, text, won: true };
    if (reb.joined) {
      story(w, `Luchó en el levantamiento de ${r.name}, que triunfó.`, 'decision');
      pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'gobierno', regionId, text: `Participó en el levantamiento que cambió el gobierno de ${r.name}.` });
      recordDecision(w, 'region', regionId, `Ayudó a derribar al gobierno de ${r.name}.`);
    }
  } else {
    g.repression = clamp(g.repression + 0.5);
    g.legitimacy = clamp(g.legitimacy - 0.05);
    clan.dissolved = w.day;
    text = `Levantamiento en ${r.name}: la guardia lo aplasta. ${lead ? `${lead.name} huye del pueblo.` : ''}`;
    reb.outcome = { day: w.day, text, won: false };
    if (lead && lead.age >= 16) {
      const to = r.neighbors.find((n) => n !== regionId) ?? r.neighbors[0];
      if (to !== undefined) migrate(w, lead, to, true);
    }
    for (const id of clan.members) {
      const f = folkById(w, id);
      if (f) memorize(w, f, { kind: 'derrota', text: 'Perdimos. Nos aplastaron.', w: -0.8, src: 'propio' });
    }
    if (reb.joined) {
      story(w, `Luchó en el levantamiento de ${r.name}, que fracasó.`, 'error');
      w.life!.identity!.score[regionId] = (w.life!.identity!.score[regionId] ?? 0) - 15;
      pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'derrota', regionId, text: `Se unió a un levantamiento fracasado en ${r.name}.` });
    }
  }
  reb.stage = 0;
  reb.since = w.day;
  logEvent(w, regionId, 'rebelion', text, clan.members.slice(0, 6));
  pol.log.push({ day: w.day, regionId, kind: 'rebelion', text });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'conflicto', text, regions: [regionId], importance: 3, known: true });
  commitCtx(ctx);
  return [text];
}

// ---------------------------------------------------------------------------
// Consecuencias que tardan en llegar
// ---------------------------------------------------------------------------
function delayedDay(w: WorldState): string[] {
  const pol = polOf(w);
  const out: string[] = [];
  const due = pol.delayed.filter((d) => d.day <= w.day);
  pol.delayed = pol.delayed.filter((d) => d.day > w.day);
  for (const d of due) {
    const r = w.regions[d.regionId];
    if (d.kind === 'eco') {
      // Lo que de verdad ha cambiado desde que se aprobó la ley (si algo ha cambiado).
      const m = marketOf(w, d.regionId);
      const merchants = w.life!.folk.filter((f) => f.alive && f.regionId === d.regionId && f.role === 'comerciante').length;
      const notes: string[] = [];
      if (merchants < Number(d.data.merchants)) notes.push('hay menos comerciantes que antes');
      if (m.closedStalls > Number(d.data.closed)) notes.push('han cerrado puestos');
      if (m.treasury > Number(d.data.treasury) * 1.4 + 3) notes.push('las arcas están más llenas');
      else if (m.treasury < Number(d.data.treasury) * 0.6 - 2) notes.push('las arcas están más vacías');
      if (r.population < Number(d.data.pop) * 0.95) notes.push('se ha ido gente');
      else if (r.population > Number(d.data.pop) * 1.05) notes.push('ha llegado gente nueva');
      if (!notes.length) continue;
      const label = LAWS[d.data.law as LawId].label[String(d.data.value)];
      const text = `${d.data.late ? 'Tiempo después' : 'Días después'} de ${label} en ${r.name}: ${notes.join(', ')}.`;
      logEvent(w, d.regionId, 'consecuencia', text, []);
      pol.log.push({ day: w.day, regionId: d.regionId, kind: 'consecuencia', text });
      if (playerRegion(w) === d.regionId || pol.legacy.some((l) => l.kind === 'ley' && l.regionId === d.regionId && l.ref === d.data.law)) out.push(text);
    } else if (d.kind === 'venganza') {
      // Quien fue chantajeado se cobra la deuda: lo cuenta.
      const f = folkById(w, String(d.data.folk));
      if (!f?.alive || f.resentment < 0.3) continue;
      seedRumor(w, { regionId: d.regionId, kind: 'politica', subject: 'jugador', target: f.id, witnesses: w.life!.folk.filter((x) => x.alive && x.regionId === d.regionId).slice(0, 8).map((x) => x.id), versions: [`${f.name} cuenta que el forastero le chantajeó para que votara.`, 'Dicen que el forastero chantajea a la gente del consejo.', 'Dicen que el forastero tiene a medio consejo comprado o amenazado.'], tone: -0.8, heat: 1.1 });
      w.life!.identity!.score[d.regionId] = (w.life!.identity!.score[d.regionId] ?? 0) - 10;
      for (const o of orgsOfFolk(w, f.id)) adjustRep(w, o, -0.25);
      const text = `${f.name} ha contado a todo ${r.name} que le chantajeaste.`;
      story(w, `Su chantaje a ${f.name} salió a la luz.`, 'error');
      pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'traicion', regionId: d.regionId, text: `Se supo que chantajeó a ${f.name}.` });
      out.push(text);
    }
  }
  // Promesas incumplidas: se recuerdan como traición.
  for (const pr of pol.promises) {
    if (pr.kept || pr.until > w.day || pr.kept === false) continue;
    pr.kept = false;
    const o = orgById(w, pr.orgId);
    const f = folkById(w, pr.folk);
    if (o) adjustRep(w, o, -0.3);
    if (f) {
      f.resentment = Math.min(1, f.resentment + 0.3);
      memorize(w, f, { kind: 'promesa_rota', about: 'jugador', text: `Nos prometió apoyar ${LAWS[pr.law].label[pr.value]} y no hizo nada.`, w: -0.6, src: 'propio' });
    }
    story(w, `Incumplió su promesa a ${o?.name ?? 'un grupo'}.`, 'error');
    out.push(`${f?.name ?? 'Alguien'} no olvida que prometiste apoyar ${LAWS[pr.law].label[pr.value]} y no lo hiciste.`);
  }
  pol.promises = pol.promises.filter((p) => p.kept === undefined || w.day - p.until < 40);
  return out;
}

// ---------------------------------------------------------------------------
// Legitimidad y decisiones del jugador
// ---------------------------------------------------------------------------
function legitimacyDay(w: WorldState, regionId: number): void {
  const g = govOf(w, regionId);
  const r = w.regions[regionId];
  const people = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.p);
  const sat = people.length ? people.reduce((s, f) => s + NEEDS.reduce((t, k) => t + f.p!.needs[k], 0) / NEEDS.length, 0) / people.length : 0.6;
  const angry = orgsOf(w, regionId).filter((o) => o.discontent > 0.6).length;
  let target = 0.15 + sat * 0.6 + marketOf(w, regionId).prosperity * 0.15 - g.repression * 0.3 - angry * 0.05;
  if (g.system === 'monarquia') target += 0.08;
  if (g.system === 'militar') target += r.flags.guerra || r.flags.bandidos ? 0.05 : -0.1;
  g.legitimacy = clamp(g.legitimacy + (target - g.legitimacy) * 0.04);
  g.repression = clamp(g.repression - 0.012);
  // El motor nota la estabilidad política.
  r.stability = clamp(r.stability + ((0.3 + g.legitimacy * 0.6) - r.stability) * 0.01);
}

export function recordDecision(w: WorldState, scale: Scale, regionId: number, text: string): void {
  const pol = polOf(w);
  pol.decisions.push({ day: w.day, scale, regionId, text });
  if (pol.decisions.length > 120) pol.decisions.shift();
}

/** La escala más alta en la que el jugador ha influido. */
export function topScale(w: WorldState): Scale {
  const pol = polOf(w);
  let best = 0;
  for (const d of pol.decisions) best = Math.max(best, SCALES.indexOf(d.scale));
  return SCALES[best];
}

/** El jugador propone una ley (si tiene un sitio desde el que hacerlo). */
export function canPropose(w: WorldState, regionId: number): { ok: boolean; why: string } {
  const id = w.life!.identity!;
  const g = govOf(w, regionId);
  if (playerSeat(w, regionId)) return { ok: true, why: '' };
  if (isAdviser(w, regionId)) return { ok: true, why: 'Como consejero, puedes llevar una propuesta a quien gobierna.' };
  const ally = orgsOf(w, regionId).find((o) => o.player.rank >= 2 && repOf(w, o) > 0.3);
  if (ally) return { ok: true, why: `${ally.name} puede presentarla por ti.` };
  if (g.system === 'republica' && (id.standing[regionId] ?? 0) >= 2) return { ok: true, why: 'En la asamblea cualquier vecino conocido puede proponer.' };
  return { ok: false, why: 'Aún no tienes un sitio desde el que proponer nada: ni asiento en el consejo, ni un grupo que te respalde.' };
}

export function playerPropose(w: WorldState, regionId: number, law: LawId, value: string): { ok: boolean; text: string } {
  const c = canPropose(w, regionId);
  if (!c.ok) return { ok: false, text: c.why };
  const p = propose(w, regionId, law, value, 'jugador', 4);
  if (!p) return { ok: false, text: 'Ya se está debatiendo algo sobre eso, o acaba de votarse.' };
  if (playerSeat(w, regionId)) p.playerVote = 'si';
  story(w, `Propuso ${LAWS[law].label[value]} en ${w.regions[regionId].name}.`, 'decision');
  recordDecision(w, 'pueblo', regionId, `Propuso ${LAWS[law].label[value]}.`);
  return { ok: true, text: `Tu propuesta —${LAWS[law].label[value]}— se votará en unos días. Hasta entonces, habla con quienes votan.` };
}

/** Aceptar una oferta (entrar en un grupo, representar, dirigir, ser emisario…). */
export function answerPolOffer(w: WorldState, index: number, accept: boolean): string {
  const pol = polOf(w);
  const o = pol.offers[index];
  if (!o) return 'Ya no hay nada que responder.';
  pol.offers.splice(index, 1);
  const org = orgById(w, o.orgId);
  const r = w.regions[o.regionId];
  if (!accept) {
    story(w, `Rechazó ${o.kind === 'miembro' ? `entrar en ${org?.name}` : o.kind === 'representante' ? `representar a ${org?.name}` : o.kind === 'liderazgo' ? `dirigir ${org?.name}` : `ser ${o.kind} de ${r.name}`}.`, 'decision');
    return 'Les das las gracias, pero no.';
  }
  switch (o.kind) {
    case 'miembro':
      return org ? joinOrg(w, org) : '';
    case 'representante':
      if (!org) return '';
      org.player.rank = 3;
      govOf(w, o.regionId).council = councilOf(w, o.regionId);
      story(w, `Pasó a representar a ${org.name} en ${r.name}.`, 'cargo');
      recordDecision(w, 'pueblo', o.regionId, `Representa a ${org.name}.`);
      return `Ahora hablas por ${org.name}. Si hay consejo, tienes asiento.`;
    case 'liderazgo':
      if (!org) return '';
      org.player.rank = 4;
      org.leader = 'jugador';
      govOf(w, o.regionId).council = councilOf(w, o.regionId);
      story(w, `Pasó a dirigir ${org.name} en ${r.name}.`, 'cargo');
      pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'cargo', regionId: o.regionId, text: `Dirigió ${org.name}.` });
      return `Desde hoy diriges ${org.name}.`;
    case 'candidatura':
      pol.candidacy[o.regionId] = true;
      return 'Te presentarás a las próximas elecciones.';
    default:
      pol.roles.push({ kind: o.kind, regionId: o.regionId, since: w.day, mission: o.mission });
      story(w, `Aceptó ser ${o.kind === 'diplomatico' ? 'diplomático' : o.kind} de ${r.name}.`, 'cargo');
      recordDecision(w, 'territorio', o.regionId, `Aceptó ser ${o.kind} de ${r.name}.`);
      return o.kind === 'emisario' ? `Llevarás la voz de ${r.name} a ${o.mission ? w.regions[o.mission.to].name : 'otros pueblos'}.` : o.kind === 'diplomatico' ? `Ahora negocias en nombre de ${r.name}.` : `Quien gobierna ${r.name} te pedirá consejo.`;
  }
}


/** El jugador se presenta a las elecciones (si las hay y le conocen). */
export function declareCandidacy(w: WorldState, regionId: number): { ok: boolean; text: string } {
  const g = govOf(w, regionId);
  const id = w.life!.identity!;
  if (!GOV[g.system].elections) return { ok: false, text: `En ${w.regions[regionId].name} no se elige a nadie: ${GOV[g.system].how.toLowerCase()}` };
  if ((id.standing[regionId] ?? 0) < 2) return { ok: false, text: 'Nadie votaría a alguien a quien apenas conoce.' };
  polOf(w).candidacy[regionId] = true;
  story(w, `Se presentó a las elecciones de ${w.regions[regionId].name}.`, 'decision');
  return { ok: true, text: `Te presentas. Las elecciones son ${g.nextElection! - w.day <= 1 ? 'mañana' : `dentro de ${g.nextElection! - w.day} días`}. Habla con la gente: cada vecino vota a quien conoce y en quien confía.` };
}

// ---------------------------------------------------------------------------
// Un día de política en todo el mundo
// ---------------------------------------------------------------------------
export function politicsDay(w: WorldState): string[] {
  if (!w.life?.society) return [];
  ensurePolitics(w);
  const pol = polOf(w);
  const rng = new Rng(w.seed ^ Math.imul(w.day, 0x51ed27) ^ 0xb0b);
  const out: string[] = [];
  for (const r of w.regions) {
    const g = govOf(w, r.id);
    if ((w.day + r.id) % 5 === 0) out.push(...refreshOrgs(w, r.id));
    out.push(...succession(w, r.id));
    if ((w.day + r.id) % 4 === 0 || !g.council.length) g.council = councilOf(w, r.id);
    out.push(...lawsDay(w, rng, r.id));
    out.push(...orgDay(w, rng, r.id));
    legitimacyDay(w, r.id);
    out.push(...rebellionDay(w, rng, r.id));
    if (g.nextElection !== undefined && g.nextElection <= w.day) out.push(...election(w, rng, r.id));
    for (const o of orgsOf(w, r.id)) {
      if (o.founder === 'jugador') growOrg(w, rng, o);
      if ((w.day + r.id) % 3 === 0) representativeCheck(w, o);
    }
    // Ofertas de candidatura cuando el pueblo te conoce.
    if (GOV[g.system].elections && g.nextElection! - w.day === 8 && (w.life!.identity!.standing[r.id] ?? 0) >= 3 && g.ruler !== 'jugador' && !pol.candidacy[r.id] && !pol.offers.some((o) => o.kind === 'candidatura' && o.regionId === r.id)) {
      pol.offers.push({ kind: 'candidatura', regionId: r.id, day: w.day });
      (w.life!.identity!.inbox ??= []).push(`En ${r.name} hay quien te anima a presentarte a las elecciones.`);
    }
  }
  for (const p of pol.proposals) if (p.status === 'abierta' && p.voteDay <= w.day) out.push(...resolve(w, p));
  out.push(...delayedDay(w));
  out.push(...diplomacyDay(w, rng));
  out.push(...intrigueDay(w, rng));
  out.push(...warDay(w, rng));
  out.push(...forecastDay(w));
  pol.offers = pol.offers.filter((o) => w.day - o.day < 15);
  if (pol.log.length > 200) pol.log.splice(0, pol.log.length - 200);
  return out;
}

export { REBEL_STAGE as REBELLION_STAGES };
