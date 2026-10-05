import { Rng, hashString } from '../core/rng';
import type { Relation, WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx } from '../core/world';
import { record } from '../core/chronicle';
import { startWar } from '../core/systems/conflict';
import { CULTURES } from '../core/content/cultures';
import { FOODS, GOOD, foodDays, marketOf, specialtyOf, type Good } from './economy';
import { gain, levelOf, reputation, story, type GainNote } from './identity';
import { folkById, logEvent, memorize, trait } from './society';
import { tradeOf } from './trade';
import { playerEco } from './business';
import { changeGov, govOf, recordDecision } from './politics';
import { influenceLevel } from './influence';
import { nid, polOf, TREATY, type DipRole, type Stance, type Treaty, type TreatyKind } from './polstate';

/**
 * Diplomacia entre pueblos: amistad, neutralidad, tensión, rivalidad,
 * alianza o guerra no son etiquetas que se ponen, sino lo que resulta del
 * comercio, los agravios, los tratados, el hambre y lo que hacen sus
 * gobernantes. Los tratados se negocian: cada parte mira sus intereses, la
 * reputación de quien negocia, lo que sabe, lo que se le ofrece y su propio
 * carácter.
 */
const blank = (): Relation => ({ opinion: 0, grievance: 0, allied: false, war: false, tension: 0.1 });

export function relOf(w: WorldState, a: number, b: number): Relation {
  return (w.regions[a].relations[b] ??= blank());
}

const pairs = (w: WorldState) => {
  const out: [number, number][] = [];
  for (const r of w.regions) for (const id of Object.keys(r.relations).map(Number)) if (id > r.id) out.push([r.id, id]);
  return out;
};

export function stanceOf(w: WorldState, a: number, b: number): Stance {
  const ra = w.regions[a].relations[b];
  const rb = w.regions[b].relations[a];
  if (!ra || !rb) return 'neutralidad';
  if (ra.war || rb.war) return 'guerra';
  if (ra.allied || hasTreaty(w, a, b, 'alianza')) return 'alianza';
  const op = (ra.opinion + rb.opinion) / 2;
  const tension = Math.max(ra.tension, rb.tension);
  if (tension > 0.55) return op < -0.3 || ra.grievance + rb.grievance > 0.6 ? 'rivalidad' : 'tension';
  if (op > 0.35) return 'amistad';
  if (op < -0.35) return 'rivalidad';
  return tension > 0.38 ? 'tension' : 'neutralidad';
}

export const STANCE_WORD: Record<Stance, string> = { amistad: 'amistad', neutralidad: 'ni amigos ni enemigos', tension: 'tensión', rivalidad: 'rivalidad abierta', alianza: 'alianza', guerra: 'guerra' };

export function treatiesOf(w: WorldState, regionId?: number): Treaty[] {
  return polOf(w).treaties.filter((t) => !t.broken && t.until >= w.day && (regionId === undefined || t.a === regionId || t.b === regionId));
}

export function hasTreaty(w: WorldState, a: number, b: number, kind?: TreatyKind): boolean {
  return treatiesOf(w).some((t) => (!kind || t.kind === kind) && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}

export function signTreaty(w: WorldState, kind: TreatyKind, a: number, b: number, by: Treaty['by'], terms?: Treaty['terms']): Treaty {
  const pol = polOf(w);
  for (const t of treatiesOf(w)) if (t.kind === kind && ((t.a === a && t.b === b) || (t.a === b && t.b === a))) t.until = w.day - 1;
  const t: Treaty = { id: nid(w, 'tr'), kind, a, b, day: w.day, until: w.day + TREATY[kind].days, by, terms };
  pol.treaties.push(t);
  const A = w.regions[a];
  const B = w.regions[b];
  const text = `${A.name} y ${B.name} firman un ${TREATY[kind].name}${by === 'jugador' ? ` negociado por ${w.life!.player.name}` : ''}.`;
  relOf(w, a, b).opinion = clamp(relOf(w, a, b).opinion + 0.15, -1, 1);
  relOf(w, b, a).opinion = clamp(relOf(w, b, a).opinion + 0.15, -1, 1);
  if (kind === 'alianza' || kind === 'defensa') relOf(w, a, b).allied = relOf(w, b, a).allied = kind === 'alianza' || relOf(w, a, b).allied;
  if (kind === 'fronteras') pol.claims = pol.claims.filter((c) => !((c.a === a && c.b === b) || (c.a === b && c.b === a)));
  if (kind === 'paz') {
    A.flags[`paz_${b}`] = { since: w.day, data: { until: t.until } };
    B.flags[`paz_${a}`] = { since: w.day, data: { until: t.until } };
  }
  logEvent(w, a, 'tratado', text, []);
  logEvent(w, b, 'tratado', text, []);
  pol.log.push({ day: w.day, regionId: a, kind: 'tratado', text });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'diplomacia', text, regions: [a, b], importance: 2, byPlayer: by === 'jugador', known: by === 'jugador' || A.isHome || B.isHome || w.intel[a].level > 0 || w.intel[b].level > 0 });
  commitCtx(ctx);
  if (by === 'jugador') {
    story(w, `Negoció un ${TREATY[kind].name} entre ${A.name} y ${B.name}.`, 'logro');
    pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: kind === 'paz' ? 'paz' : 'tratado', regionId: a, text, ref: t.id });
    recordDecision(w, 'territorio', a, text);
  }
  return t;
}

function breakTreaty(w: WorldState, t: Treaty, why: string, by?: number): void {
  t.broken = w.day;
  const text = `Se rompe el ${TREATY[t.kind].name} entre ${w.regions[t.a].name} y ${w.regions[t.b].name}: ${why}.`;
  if (by !== undefined) {
    const victim = by === t.a ? t.b : t.a;
    relOf(w, victim, by).grievance = clamp(relOf(w, victim, by).grievance + 0.35);
    relOf(w, victim, by).opinion = clamp(relOf(w, victim, by).opinion - 0.3, -1, 1);
  }
  if (t.kind === 'alianza') relOf(w, t.a, t.b).allied = relOf(w, t.b, t.a).allied = false;
  logEvent(w, t.a, 'tratado', text, []);
  logEvent(w, t.b, 'tratado', text, []);
  polOf(w).log.push({ day: w.day, regionId: t.a, kind: 'tratado', text });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'diplomacia', text, regions: [t.a, t.b], importance: 2 });
  commitCtx(ctx);
}

// ---------------------------------------------------------------------------
// Un día de diplomacia
// ---------------------------------------------------------------------------
export function diplomacyDay(w: WorldState, rng: Rng): string[] {
  const out: string[] = [];
  const pol = polOf(w);
  const home = w.player.home;
  const vol = tradeOf(w).volume;
  // Las relaciones del pueblo del jugador (el motor solo mueve las de los demás).
  for (const [a, b] of pairs(w)) {
    if (a !== home && b !== home) continue;
    const other = a === home ? b : a;
    for (const [x, y] of [[home, other], [other, home]] as const) {
      const rel = relOf(w, x, y);
      const traded = (vol[`${Math.min(x, y)}-${Math.max(x, y)}`] ?? 0) - ((pol as { lastVol?: Record<string, number> }).lastVol?.[`${x}>${y}`] ?? 0);
      ((pol as { lastVol?: Record<string, number> }).lastVol ??= {})[`${x}>${y}`] = vol[`${Math.min(x, y)}-${Math.max(x, y)}`] ?? 0;
      let drift = Math.min(0.01, Math.max(0, traded) * 0.0008) - rel.grievance * 0.005 + (0 - rel.opinion) * 0.002;
      if (foodDays(w, x) < 1.5 && foodDays(w, y) > 6) drift -= 0.008;
      rel.opinion = clamp(rel.opinion + drift, -1, 1);
      rel.grievance = clamp(rel.grievance - 0.0015);
      let target = Math.max(0, -rel.opinion) * 0.85 + rel.grievance * 0.3 + (foodDays(w, x) < 1.5 && foodDays(w, y) > 6 ? 0.25 : 0) + (pol.claims.some((c) => (c.a === x && c.b === y) || (c.a === y && c.b === x)) ? 0.2 : 0) - 0.06;
      if (rel.allied) target *= 0.3;
      if (rel.war) target = 1;
      rel.tension = clamp(rel.tension + (target - rel.tension) * 0.1);
    }
  }
  // Tratados en vigor: lo que hacen cada día.
  for (const t of treatiesOf(w)) {
    const ra = relOf(w, t.a, t.b);
    const rb = relOf(w, t.b, t.a);
    ra.tension = clamp(ra.tension - 0.004);
    rb.tension = clamp(rb.tension - 0.004);
    if (t.kind === 'comercio' || t.kind === 'alianza') (ra.opinion = clamp(ra.opinion + 0.002, -1, 1)), (rb.opinion = clamp(rb.opinion + 0.002, -1, 1));
    if (t.kind === 'recursos' && t.terms?.give && t.terms.take) {
      // Cada pueblo manda al otro lo que le sobra.
      const ma = marketOf(w, t.a);
      const mb = marketOf(w, t.b);
      const n = t.terms.n ?? 1.5;
      const ga = Math.min(n, ma.stock[t.terms.give] * 0.1);
      const gb = Math.min(n, mb.stock[t.terms.take] * 0.1);
      ma.stock[t.terms.give] -= ga;
      mb.stock[t.terms.give] += ga;
      mb.stock[t.terms.take] -= gb;
      ma.stock[t.terms.take] += gb;
    }
    if (t.terms?.tribute && t.terms.payer !== undefined) {
      const payer = marketOf(w, t.terms.payer);
      const to = marketOf(w, t.terms.payer === t.a ? t.b : t.a);
      const n = Math.min(payer.treasury, t.terms.tribute);
      payer.treasury -= n;
      to.treasury += n;
    }
    // Un tratado se rompe si la relación se pudre (o si uno ataca al otro).
    if (ra.war || rb.war) breakTreaty(w, t, 'han entrado en guerra', ra.war ? t.a : t.b);
    else if ((ra.opinion < -0.45 || rb.opinion < -0.45) && rng.chance(0.08)) breakTreaty(w, t, 'ya no se fían el uno del otro', ra.opinion < rb.opinion ? t.a : t.b);
  }
  for (const r of w.regions) for (const k of Object.keys(r.flags)) if (k.startsWith('paz_') && Number(r.flags[k].data?.until ?? 0) < w.day) delete r.flags[k];
  // Tratados que surgen solos: cuando los intereses coinciden.
  if (w.day % 3 === 0) {
    for (const [a, b] of pairs(w)) {
      const ra = relOf(w, a, b);
      const rb = relOf(w, b, a);
      if (ra.war || rb.war) continue;
      const v = vol[`${Math.min(a, b)}-${Math.max(a, b)}`] ?? 0;
      if (!hasTreaty(w, a, b, 'comercio') && v > 60 && ra.opinion > 0.25 && rb.opinion > 0.25 && rng.chance(0.06)) {
        signTreaty(w, 'comercio', a, b, 'mundo');
        if (a === home || b === home) out.push(`${w.regions[a].name} y ${w.regions[b].name} firman un tratado de comercio.`);
      }
      const threat = commonThreat(w, a, b);
      if (threat !== undefined && !hasTreaty(w, a, b, 'defensa') && !hasTreaty(w, a, b, 'alianza') && ra.opinion > 0.2 && rb.opinion > 0.2 && rng.chance(0.05)) signTreaty(w, 'defensa', a, b, 'mundo');
      if (!hasTreaty(w, a, b, 'recursos') && rng.chance(0.03)) {
        const deal = resourceDeal(w, a, b);
        if (deal && ra.opinion > 0 && rb.opinion > 0) signTreaty(w, 'recursos', a, b, 'mundo', deal);
      }
    }
  }
  // La guerra que el motor no ve: contra el pueblo del jugador (por hambre, agravios o tierra).
  for (const [a, b] of pairs(w)) {
    if (a !== home && b !== home) continue;
    const other = a === home ? b : a;
    const R = w.regions[other];
    const rel = relOf(w, other, home);
    if (rel.war || R.flags[`paz_${home}`] || hasTreaty(w, home, other, 'alianza')) continue;
    const g = govOf(w, other);
    const ruler = g.ruler && g.ruler !== 'jugador' ? folkById(w, g.ruler) : undefined;
    const hawk = ruler ? (trait(ruler, 'ambicioso') + trait(ruler, 'orgulloso') - trait(ruler, 'cobarde')) / 200 : 0.4;
    const desperate = foodDays(w, other) < 1 && foodDays(w, home) > 5;
    if (rel.tension > 0.75 && rel.opinion < -0.3 && R.militancy > 0.55 && rng.chance(0.04 + hawk * 0.06 + (desperate ? 0.05 : 0))) {
      const ctx = makeCtx(w);
      startWar(ctx, R, w.regions[home]);
      commitCtx(ctx);
      out.push(`${R.name} declara la guerra a ${w.regions[home].name}.`);
    }
  }
  // Federaciones: aliados de muchos días con gobiernos que se parecen.
  if (w.day % 7 === 0) for (const t of treatiesOf(w).filter((x) => x.kind === 'alianza' && w.day - x.day > 30)) maybeFederate(w, rng, t, false);
  claimsDay(w, rng);
  // Ofertas de cargos diplomáticos a quien se lo ha ganado.
  offerRoles(w);
  return out;
}

function commonThreat(w: WorldState, a: number, b: number): number | undefined {
  for (const [id, ra] of Object.entries(w.regions[a].relations)) {
    const rb = w.regions[b].relations[Number(id)];
    if (rb && ra.tension > 0.45 && rb.tension > 0.45) return Number(id);
  }
  return undefined;
}

/** ¿Qué podrían cambiarse dos pueblos? (lo que a uno le sobra y al otro le falta) */
export function resourceDeal(w: WorldState, a: number, b: number): Treaty['terms'] | undefined {
  const ma = marketOf(w, a);
  const mb = marketOf(w, b);
  const pick = (from: typeof ma, to: typeof mb, own: Good[]): Good | undefined => [...own, ...FOODS].filter((g) => from.stock[g] > from.demand[g] * 6 + 3 && to.price[g] > from.price[g] * 1.3).sort((x, y) => to.price[y] / from.price[y] - to.price[x] / from.price[x])[0];
  const give = pick(ma, mb, specialtyOf(w, a));
  const take = pick(mb, ma, specialtyOf(w, b));
  return give && take && give !== take ? { give, take, n: 1.5 } : undefined;
}

function maybeFederate(w: WorldState, rng: Rng, t: Treaty, byPlayer: boolean): string | null {
  const pol = polOf(w);
  const ga = govOf(w, t.a);
  const gb = govOf(w, t.b);
  if (ga.federation || gb.federation) return null;
  const civic = (s: string) => s === 'consejo' || s === 'republica' || s === 'alcalde' || s === 'federacion';
  if (!civic(ga.system) || !civic(gb.system)) return null;
  if (!byPlayer && !rng.chance(0.08)) return null;
  const name = `Federación de ${w.regions[t.a].name} y ${w.regions[t.b].name}`;
  const fed = { id: nid(w, 'f'), name, members: [t.a, t.b], since: w.day, laws: { comercio: 'libre' } };
  pol.federations.push(fed);
  for (const id of fed.members) {
    changeGov(w, id, 'federacion', govOf(w, id).ruler, `al unirse a la ${name}`);
    govOf(w, id).federation = fed.id;
    govOf(w, id).laws.comercio = 'libre';
  }
  if (byPlayer) {
    story(w, `Impulsó la ${name}.`, 'logro');
    pol.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'gobierno', regionId: t.a, text: `Impulsó la ${name}.` });
    recordDecision(w, 'mundo', t.a, `Impulsó la ${name}.`);
  }
  return `Nace la ${name}.`;
}

/** Cuando el pueblo confía en ti, te pide que lleves su voz fuera. */
function offerRoles(w: WorldState): void {
  const pol = polOf(w);
  const id = w.life!.identity!;
  const home = w.player.home;
  const stand = id.standing[home] ?? 0;
  const has = (k: DipRole['kind']) => pol.roles.some((r) => r.kind === k && r.regionId === home && !r.lost) || pol.offers.some((o) => o.kind === k && o.regionId === home);
  const lv = influenceLevel(w);
  if (stand >= 3 && lv >= 2 && !has('emisario') && !has('diplomatico') && w.day % 5 === 0) {
    const target = bestPartner(w, home);
    if (target) {
      pol.offers.push({ kind: 'emisario', regionId: home, day: w.day, mission: { to: target.to, treaty: target.kind, until: w.day + 20 } });
      (id.inbox ??= []).push(`El consejo de ${w.regions[home].name} busca a alguien que lleve una propuesta a ${w.regions[target.to].name}: un ${TREATY[target.kind].name}. Han pensado en ti.`);
    }
  }
  const done = pol.treaties.filter((t) => t.by === 'jugador').length;
  if ((stand >= 4 || done >= 1) && lv >= 3 && !has('diplomatico') && w.day % 6 === 0) {
    pol.offers.push({ kind: 'diplomatico', regionId: home, day: w.day });
    (id.inbox ??= []).push(`En ${w.regions[home].name} quieren que negocies en su nombre con los demás pueblos.`);
  }
  if (stand >= 3 && lv >= 2 && !has('consejero') && (id.rank[home] ?? 0) < 4 && w.day % 7 === 0 && govOf(w, home).system !== 'consejo') {
    pol.offers.push({ kind: 'consejero', regionId: home, day: w.day });
  }
}

/** El tratado que más le convendría ahora al pueblo con alguno de sus vecinos. */
export function bestPartner(w: WorldState, from: number): { to: number; kind: TreatyKind; score: number } | undefined {
  let best: { to: number; kind: TreatyKind; score: number } | undefined;
  for (const to of Object.keys(w.regions[from].relations).map(Number)) {
    if (relOf(w, from, to).war) {
      const s = interest(w, from, to, 'paz');
      if (!best || s > best.score) best = { to, kind: 'paz', score: s };
      continue;
    }
    for (const kind of ['comercio', 'recursos', 'defensa'] as TreatyKind[]) {
      if (hasTreaty(w, from, to, kind)) continue;
      const s = interest(w, from, to, kind) + interest(w, to, from, kind);
      if (s > 0.3 && (!best || s > best.score)) best = { to, kind, score: s };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Negociar
// ---------------------------------------------------------------------------
/** Cuánto le interesa a `who` un tratado con `other` (por sus propias razones). */
export function interest(w: WorldState, who: number, other: number, kind: TreatyKind): number {
  const R = w.regions[who];
  const tr = CULTURES.find((c) => c.id === R.culture)?.traits;
  const m = marketOf(w, who);
  const rel = relOf(w, who, other);
  switch (kind) {
    case 'comercio': {
      const mo = marketOf(w, other);
      const gap = FOODS.concat(['hierro', 'herramientas', 'ropa', 'sal'] as Good[]).reduce((s, g) => s + Math.max(0, m.price[g] - mo.price[g]) / GOOD[g].base, 0) / 9;
      return 0.1 + (tr?.mercantile ?? 0.5) * 0.3 + Math.min(0.4, gap) + (m.prosperity < 0.5 ? 0.1 : 0) - (govOf(w, who).laws.comercio === 'cerrado' ? 0.25 : 0);
    }
    case 'recursos':
      return resourceDeal(w, other, who) ? 0.35 + (foodDays(w, who) < 3 ? 0.35 : 0) : -0.2;
    case 'defensa':
    case 'alianza': {
      const threat = commonThreat(w, who, other);
      return (threat !== undefined ? 0.55 : -0.05) + (kind === 'alianza' ? rel.opinion * 0.4 - 0.15 : 0) + (tr?.caution ?? 0.5) * 0.2;
    }
    case 'paz': {
      if (!rel.war) return -0.2;
      const war = polOf(w).wars.find((x) => x.status === 'activa' && ((x.a === who && x.b === other) || (x.a === other && x.b === who)));
      const army = war?.armies[who];
      const losing = war ? war.occupied.includes(who) : false;
      return 0.2 + (army ? (1 - army.morale) * 0.5 + (army.supply < 3 ? 0.2 : 0) : 0.2) + (losing ? 0.3 : 0) - (war && war.occupied.includes(other) ? 0.35 : 0);
    }
    case 'fronteras':
      return polOf(w).claims.some((c) => (c.a === who && c.b === other) || (c.a === other && c.b === who)) ? 0.45 : 0.05;
  }
}

export interface Offer {
  coins?: number;
  good?: Good;
  n?: number;
  secret?: string; // información con la que presionar
}

export interface NegotiationResult {
  status: 'acepta' | 'contraoferta' | 'rechaza';
  lines: string[];
  ask?: { coins?: number; good?: Good; n?: number };
  treaty?: Treaty;
  notes: GainNote[];
}

/** ¿En nombre de quién puede negociar el jugador? */
export function canRepresent(w: WorldState, regionId: number): boolean {
  const pol = polOf(w);
  const id = w.life!.identity!;
  if (govOf(w, regionId).ruler === 'jugador' || (id.rank[regionId] ?? 0) >= 5) return true;
  return pol.roles.some((r) => r.regionId === regionId && !r.lost && (r.kind === 'diplomatico' || r.kind === 'emisario'));
}

/**
 * El jugador negocia con quien gobierna `to` en nombre de `from` (o como
 * mediador, si `from` no es suyo: solo para la paz).
 */
export function negotiate(w: WorldState, from: number, to: number, kind: TreatyKind, offer: Offer = {}): NegotiationResult {
  const pol = polOf(w);
  const id = w.life!.identity!;
  const g = govOf(w, to);
  const ruler = g.ruler && g.ruler !== 'jugador' ? folkById(w, g.ruler) : undefined;
  const rng = new Rng(hashString(`neg:${from}:${to}:${kind}:${w.day}:${JSON.stringify(offer)}`));
  const rel = relOf(w, to, from);
  const official = canRepresent(w, from);
  const lines: string[] = [];
  const parts: { why: string; v: number }[] = [];
  const own = interest(w, to, from, kind);
  parts.push({ why: own > 0.3 ? 'les conviene' : 'no lo necesitan', v: own });
  parts.push({ why: rel.opinion > 0 ? 'se llevan bien' : 'no se fían de vosotros', v: rel.opinion * 0.45 - rel.tension * 0.25 });
  const rep = clamp(reputation(w, to) / 45, -0.3, 0.4);
  parts.push({ why: rep > 0 ? 'te conocen y te respetan' : 'no saben quién eres', v: rep });
  parts.push({ why: 'hablas en nombre de tu pueblo', v: official ? 0.15 : -0.1 });
  parts.push({ why: 'sabes negociar', v: levelOf(id, 'diplomacia') * 0.07 + levelOf(id, 'k:culturas') * 0.04 + levelOf(id, 'k:idiomas') * 0.03 });
  if (ruler) {
    parts.push({ why: 'su carácter', v: -(trait(ruler, 'desconfiado') - 50) / 220 - (trait(ruler, 'orgulloso') - 50) / 260 + (trait(ruler, 'generoso') - 50) / 300 + (ruler.trust - 0.5) * 0.3 - ruler.resentment * 0.4 });
  }
  const pe = playerEco(w);
  let value = 0;
  if (offer.coins) value += Math.min(offer.coins, id.needs.coins) / 25;
  if (offer.good && offer.n) value += Math.min(offer.n, pe.cargo[offer.good] ?? 0) * marketOf(w, to).price[offer.good] / 25;
  if (value) parts.push({ why: 'lo que ofreces', v: Math.min(0.5, value) });
  const leverage = offer.secret ? pol.secrets.find((s) => s.id === offer.secret && s.known && (s.regionId === to || s.about === g.ruler)) : undefined;
  if (leverage) parts.push({ why: 'lo que sabes', v: 0.4 });
  const score = parts.reduce((s, p) => s + p.v, 0) + rng.range(-0.06, 0.06);
  const ambitious = ruler ? trait(ruler, 'ambicioso') > 60 : false;
  const notes = gain(w, 'diplomacia', 0.8);
  const name = ruler?.name ?? `el gobierno de ${w.regions[to].name}`;
  if (score >= 0.5) {
    // Lo ofrecido se entrega.
    if (offer.coins) id.needs.coins -= Math.min(offer.coins, id.needs.coins);
    if (offer.good && offer.n) {
      const n = Math.min(offer.n, pe.cargo[offer.good] ?? 0);
      pe.cargo[offer.good] = (pe.cargo[offer.good] ?? 0) - n;
      if (!pe.cargo[offer.good]) delete pe.cargo[offer.good];
      marketOf(w, to).stock[offer.good] += n;
    }
    if (leverage) {
      leverage.used.push('negociar');
      if (ruler) {
        ruler.resentment = Math.min(1, ruler.resentment + 0.2);
        memorize(w, ruler, { kind: 'presion', about: 'jugador', text: 'Me apretó con lo que sabía. Firmé, pero no me gustó.', w: -0.4, src: 'propio' });
      }
    }
    const terms = kind === 'recursos' ? resourceDeal(w, from, to) ?? { give: 'trigo' as Good, take: 'madera' as Good, n: 1 } : undefined;
    const t = official || kind === 'paz' ? signTreaty(w, kind, from, to, 'jugador', terms) : undefined;
    if (ruler) {
      ruler.trust = Math.min(1, ruler.trust + 0.08);
      memorize(w, ruler, { kind: 'tratado', about: 'jugador', text: `Negociamos un ${TREATY[kind].name} con el forastero.`, w: 0.35, src: 'propio' });
    }
    lines.push(rng.pick([`${name} asiente. «Trato hecho.»`, `${name} lo piensa un momento y te tiende la mano.`, `«Está bien. Que se escriba.»`]));
    if (!t) lines.push('(Pero no hablas en nombre de nadie: sin un cargo, es solo una promesa de palabra.)');
    for (const r of pol.roles) if (r.mission && r.mission.to === to && r.mission.treaty === kind) r.mission = undefined;
    return { status: 'acepta', lines, treaty: t, notes };
  }
  if (score >= 0.3 || (ambitious && score >= 0.2)) {
    const ask = rng.chance(0.5) || !Object.keys(pe.cargo).length ? { coins: Math.round(8 + (0.5 - score) * 40) } : { good: (Object.keys(pe.cargo)[0] as Good), n: 2 };
    lines.push(`«No está mal, pero no basta.» ${name} se inclina hacia ti. «${ask.coins ? `Añade ${ask.coins} monedas` : `Añade algo de ${GOOD[ask.good!].name}`} y hablamos.»`);
    return { status: 'contraoferta', lines, ask, notes };
  }
  const worst = [...parts].sort((a, b) => a.v - b.v)[0];
  lines.push(rng.pick([`«No.» ${name} ni siquiera lo piensa.`, `«Agradezco la visita, pero no.»`, `${name} niega con la cabeza.`]), `(Lo que más pesa en contra: ${worst.why}.)`);
  if (ruler && rel.tension > 0.5) ruler.resentment = Math.min(1, ruler.resentment + 0.03);
  return { status: 'rechaza', lines, notes };
}

/** Impulsar una federación entre aliados (lo propone el jugador). */
export function proposeFederation(w: WorldState, a: number, b: number): string {
  const t = treatiesOf(w).find((x) => x.kind === 'alianza' && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  if (!t) return 'Para federarse, primero tienen que ser aliados.';
  return maybeFederate(w, new Rng(w.day), t, true) ?? 'No quieren: sus gobiernos son demasiado distintos, o ya pertenecen a otra unión.';
}

/** Cómo se lleva un pueblo con los demás, en palabras. */
export function describeRelations(w: WorldState, regionId: number): string[] {
  const out: string[] = [];
  for (const id of Object.keys(w.regions[regionId].relations).map(Number)) {
    if (w.intel[id].level === 0 && !w.regions[id].isHome) continue;
    const st = stanceOf(w, regionId, id);
    const tr = treatiesOf(w, regionId).filter((t) => t.a === id || t.b === id).map((t) => TREATY[t.kind].name);
    out.push(`Con ${w.regions[id].name}: ${STANCE_WORD[st]}${tr.length ? ` (${tr.join(', ')})` : ''}.`);
  }
  return out;
}

/** Disputas por tierra: aparecen cuando un pueblo crece y el vecino tiene lo que le falta. */
export function claimsDay(w: WorldState, rng: Rng): void {
  const pol = polOf(w);
  if (w.day % 4 !== 0) return;
  for (const [a, b] of pairs(w)) {
    if (pol.claims.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)) || hasTreaty(w, a, b, 'fronteras')) continue;
    const A = w.regions[a];
    const B = w.regions[b];
    const crowdA = A.population / Math.max(1, (w.life!.towns[a]?.houses ?? 4) * 60);
    if (crowdA > 1.15 && B.population < A.population * 0.7 && rng.chance(0.05)) {
      pol.claims.push({ a, b, since: w.day, why: `${A.name} reclama tierras de ${B.name}: les falta sitio` });
      logEvent(w, a, 'politica', `${A.name} reclama las tierras de la linde con ${B.name}.`, []);
    }
  }
}
