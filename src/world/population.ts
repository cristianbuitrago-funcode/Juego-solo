import { record } from '../core/chronicle';
import type { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx, routesOf } from '../core/world';
import { changeJob, migrate } from './arcs';
import { foodDays, marketOf, working } from './economy';
import { farmOf, nearTiles, waterOf } from './farming';
import { folkTarget, makeFolk, ROLE_TITLE } from './folk';
import { seedRumor } from './gossip';
import { ensurePeople, logEvent, societyOf, trait } from './society';
import type { Folk, FolkRole } from './types';
import { T } from './types';
import { lawFx } from './politics';

const CRAFTS: FolkRole[] = ['artesano', 'carpintero', 'tejedor'];
const bordersClosed = (w: WorldState, id: number) => !!w.life!.politics && lawFx(w, id).closedBorders;
const guilds = (w: WorldState, id: number) => !!w.life!.politics && lawFx(w, id).guilds;

/**
 * Población, vivienda, migraciones y oficios. La gente nace, muere, se va
 * a donde se vive mejor y vuelve cuando su tierra se recupera. Cada vecino
 * con nombre representa a unas decenas de personas del motor: cuando sale
 * mucha gente de un pueblo, alguna familia conocida se va también.
 */

/** Lo atractivo que es un pueblo para vivir (interno). */
/** Tierra con semilla y sin manos que la trabajen: una oportunidad para quien sabe del campo. */
export function landOpportunity(w: WorldState, regionId: number): number {
  const f = farmOf(w, regionId);
  const farmers = w.life!.folk.filter((x) => x.alive && x.regionId === regionId && x.role === 'campesino').length;
  if (f.seeds < f.plots * 0.4) return 0;
  return clamp((f.plots - farmers * 5) / Math.max(1, f.plots)) * 0.3;
}

export function attraction(w: WorldState, regionId: number, folk?: Folk): number {
  const farmer = folk && (folk.role === 'campesino' || folk.p?.jobs.some((j) => j.role === 'campesino'));
  const bonus = farmer ? landOpportunity(w, regionId) : 0;
  const r = w.regions[regionId];
  const m = marketOf(w, regionId);
  const t = w.life!.towns[regionId];
  const crowd = t ? Math.max(0, r.population / (Math.max(1, t.houses) * 60) - 1.05) : 0;
  // Las leyes también pesan: con impuestos altos, a los comerciantes no les sale a cuenta quedarse.
  const fx = w.life!.politics ? lawFx(w, regionId) : undefined;
  const taxed = fx && folk && (folk.role === 'comerciante' || folk.role === 'posadero') ? (fx.tax - 0.06) * 4 : 0;
  const closed = fx?.closedBorders && folk && folk.regionId !== regionId ? 0.6 : 0;
  // Nadie se muda a donde se pasa hambre (la noticia corre por los caminos).
  const folkHere = Math.max(1, w.life!.folk.filter((f) => f.alive && f.regionId === regionId).length);
  const hunger = clamp(m.hungry / folkHere) * 0.6;
  return m.prosperity + bonus - (r.flags.guerra ? 0.35 : 0) - crowd * 0.4 - (r.flags.fiebre ? 0.1 : 0) - taxed - closed - hunger;
}

/** Un día de vida demográfica en un pueblo: nacimientos y muertes del motor. */
export function demographyDay(w: WorldState, regionId: number): void {
  const r = w.regions[regionId];
  const m = marketOf(w, regionId);
  const t = w.life!.towns[regionId];
  const people = Math.max(1, w.life!.folk.filter((f) => f.alive && f.regionId === regionId).length);
  const days = foodDays(w, regionId);
  const room = t ? Math.max(0, Math.max(1, t.houses) * 60 - r.population) : 50;
  // Con casas vacías y tierra libre nacen más niños (el pueblo se recupera tras una mala época).
  const vacancy = t ? clamp(room / Math.max(60, t.houses * 60)) : 0;
  const hungry = m.hungry / people;
  // Con hambre en las casas nacen menos niños.
  const births = r.population * 0.0018 * (days > 3 ? 1 : 0.3) * (room > 10 ? 1 + vacancy * 1.5 : 0.35) * (1 - clamp(hungry * 1.5, 0, 0.8));
  // El hambre mata de verdad cuando falta comida; si la hay, a los pobres les llega algo (vecinos, sopa del templo).
  const deaths = r.population * (0.0011 + hungry * 0.008 * (days < 3 ? 1 : 0.35) + (r.flags.fiebre ? 0.002 : 0));
  r.population = Math.max(40, Math.round((r.population + births - deaths) * 10) / 10);
}

/**
 * Migraciones entre pueblos unidos por un camino abierto: la gente va de
 * donde se vive peor a donde se vive mejor. Alguna familia conocida se va
 * con ellos (y quien se fue puede volver cuando su tierra se recupere).
 */
export function migrationDay(w: WorldState, rng: Rng): string[] {
  const s = societyOf(w) as ReturnType<typeof societyOf> & { flows?: Record<string, number> };
  const flows = (s.flows ??= {});
  const out: string[] = [];
  const A = w.regions.map((r) => attraction(w, r.id));
  const outflow = new Array(w.regions.length).fill(0);
  for (const route of w.routes) {
    if (route.status !== 'abierta') continue;
    for (const [a, b] of [[route.a, route.b], [route.b, route.a]] as const) {
      const ra = w.regions[a];
      const rb = w.regions[b];
      // El hambre empuja: con hambre la gente se va aunque fuera no se viva mucho mejor.
      const folkA = Math.max(1, w.life!.folk.filter((f) => f.alive && f.regionId === a).length);
      const push = clamp(marketOf(w, a).hungry / folkA) * 0.14;
      const diff = A[b] - A[a] + push;
      if (diff < 0.1 || A[b] < 0.35 || bordersClosed(w, b)) continue;
      const n = Math.min(ra.population * 0.012, ra.population * 0.0016 * (diff - 0.1) * 10 * (0.5 + route.traffic));
      if (n < 0.3) continue;
      ra.population -= n;
      rb.population += n;
      outflow[a] += n;
      const key = `${a}>${b}`;
      flows[key] = (flows[key] ?? 0) + n;
      // Cada vecino con nombre representa a unas decenas de personas.
      const folk = w.life!.folk.filter((f) => f.alive && f.regionId === a);
      const unit = ra.population / Math.max(1, folk.length);
      if (flows[key] >= unit && folk.length > 4) {
        const cand = folk.filter((f) => f.age >= 18 && f.role !== 'lider' && !f.charId && f.p && w.day - ((f.p as { moved?: number }).moved ?? -99) >= 30).sort((x, y) => needSum(x) - needSum(y) + (trait(y, 'reservado') - trait(x, 'reservado')) / 400)[0];
        if (cand) {
          const gone = migrate(w, cand, b, false);
          flows[key] -= unit * gone.length;
          const why = whyLeave(w, a);
          logEvent(w, a, 'migracion', `${cand.name}${gone.length > 1 ? ' y su familia' : ''} se ha${gone.length > 1 ? 'n' : ''} ido a ${rb.name}${why ? `: ${why}` : ''}.`, gone.map((g) => g.id));
          seedRumor(w, { regionId: a, kind: 'viaje', subject: cand.id, witnesses: folk.filter(() => rng.chance(0.4)).map((f) => f.id), extra: { region: rb.name } });
          out.push(`${cand.name} se fue de ${ra.name} a ${rb.name}`);
          if (cand.lastMet >= 0) {
            const ctx = makeCtx(w);
            record(ctx, { kind: 'migracion', text: `${cand.name} se fue de ${ra.name} a ${rb.name}${why ? ` (${why})` : ''}.`, regions: [a, b], known: true });
            commitCtx(ctx);
          }
        }
      }
    }
  }
  // La bandera de emigración del motor (refugiados en los caminos) sigue a los flujos reales.
  for (const r of w.regions) {
    const big = outflow[r.id] > r.population * 0.004;
    if (big && !r.flags.emigrando) {
      const to = w.routes.filter((x) => x.status === 'abierta' && (x.a === r.id || x.b === r.id)).map((x) => (x.a === r.id ? x.b : x.a)).sort((x, y) => A[y] - A[x])[0];
      if (to !== undefined) r.flags.emigrando = { since: w.day, data: { to } };
    } else if (!big && r.flags.emigrando && outflow[r.id] < r.population * 0.001) delete r.flags.emigrando;
  }
  // Volver a casa: quien se fue regresa cuando su tierra vuelve a ofrecer algo.
  for (const f of w.life!.folk) {
    if (!f.alive || f.origin === undefined || f.origin === f.regionId || !f.p || f.age < 18) continue;
    if (w.day - ((f.p as { moved?: number }).moved ?? -99) < 30) continue;
    if (attraction(w, f.origin, f) > attraction(w, f.regionId, f) + 0.12 && rng.chance(0.035) && routesOf(w, f.regionId).some((x) => x.status === 'abierta' && (x.a === f.origin || x.b === f.origin))) {
      const from = f.regionId;
      const home = f.origin;
      const gone = migrate(w, f, home, false);
      for (const g of gone) delete g.origin;
      // Quien vuelve por la tierra, vuelve a trabajarla.
      if (landOpportunity(w, home) > 0 && f.role !== 'campesino' && f.p?.jobs.some((j) => j.role === 'campesino')) changeJob(w, f, 'campesino', 'para volver a sembrar su tierra');
      const unit = w.regions[home].population / Math.max(1, w.life!.folk.filter((x) => x.alive && x.regionId === home).length);
      w.regions[from].population = Math.max(40, w.regions[from].population - unit * gone.length * 0.5);
      w.regions[home].population += unit * gone.length * 0.5;
      logEvent(w, home, 'regreso', `${f.name}${gone.length > 1 ? ' y su familia han' : ' ha'} vuelto a ${w.regions[home].name}. Dicen que las cosas aquí van mejor.`, gone.map((g) => g.id));
      out.push(`${f.name} volvió a ${w.regions[home].name}`);
    }
  }
  return out;
}

const needSum = (f: Folk) => (f.p ? f.p.needs.comida + f.p.needs.dinero + f.p.needs.trabajo + f.p.needs.seguridad : 4);

function whyLeave(w: WorldState, regionId: number): string {
  const r = w.regions[regionId];
  const m = marketOf(w, regionId);
  if (r.flags.guerra) return 'huyen de la guerra';
  if (m.hungry > 2 || foodDays(w, regionId) < 1.5) return 'aquí ya no había qué comer';
  if (m.prosperity < 0.4) return 'aquí ya no había trabajo';
  return '';
}

/** Cuando la gente crece y faltan caras en el pueblo, llegan nuevos vecinos (trabajadores, familias). */
export function arrivals(w: WorldState, rng: Rng, regionId: number): string | null {
  const r = w.regions[regionId];
  const life = w.life!;
  const here = life.folk.filter((f) => f.alive && f.regionId === regionId);
  const want = folkTarget(r.population, r.isHome);
  const s = societyOf(w) as ReturnType<typeof societyOf> & { lastArrival?: Record<number, number> };
  const last = (s.lastArrival ??= {});
  const land = landOpportunity(w, regionId) > 0.1;
  if (bordersClosed(w, regionId)) return null;
  if ((here.length >= want - 2 && !land) || !rng.chance(land ? 0.15 : 0.08) || (attraction(w, regionId) < 0.5 && !land) || w.day - (last[regionId] ?? -99) < 6) return null;
  last[regionId] = w.day;
  const role = land ? 'campesino' : mostWanted(w, regionId, here);
  const from = r.neighbors.filter((n) => w.regions[n]).sort((a, b) => attraction(w, a) - attraction(w, b))[0];
  const used = new Set(life.folk.map((f) => f.name));
  const f = makeFolk(life, w, rng, regionId, role, rng.int(19, 45), used, { origin: from });
  f.house = rng.int(0, Math.max(0, (life.towns[regionId]?.houses ?? 3) - 1));
  life.folk.push(f);
  ensurePeople(w);
  const text = `Ha llegado ${f.name}, de ${w.regions[from]?.name ?? 'lejos'}, buscando trabajo de ${ROLE_TITLE[role]}.`;
  logEvent(w, regionId, 'llegada', text, [f.id]);
  return text;
}

// ---------------------------------------------------------------------------
// Oficios: la gente va a donde se gana la vida
// ---------------------------------------------------------------------------
const CAN_DO: FolkRole[] = ['campesino', 'pastor', 'pescador', 'minero', 'lenador', 'carpintero', 'artesano', 'tejedor', 'comerciante', 'posadero'];

/** Lo que podría ganar cada oficio aquí (si no hay nadie, se estima por el precio de lo que produciría). */
export function wageOf(w: WorldState, regionId: number, role: FolkRole): number {
  const m = marketOf(w, regionId);
  // El campo se cobra con la cosecha: no se juzga por lo ganado esta semana, sino por lo que vale el grano.
  const real = role === 'campesino' ? undefined : m.wages[role];
  const r = w.regions[regionId];
  const est: Partial<Record<FolkRole, number>> = {
    campesino: m.price.trigo * 1.6 + landOpportunity(w, regionId) * 8,
    pescador: waterOf(w, regionId) > 0.4 ? m.price.pescado * 1.5 * clamp(r.ecology + 0.3) : 0.1,
    pastor: m.price.carne * 0.4 + m.price.lana * 0.6,
    minero: (r.resource === 'hierro' ? m.price.hierro * 0.9 : m.price.hierro * 0.3) + m.price.piedra * 0.5,
    lenador: nearTiles(w, regionId, (t) => t === T.Forest) > 8 ? m.price.madera * 1.4 : 0.2,
    carpintero: m.price.muebles * 0.35 - m.price.madera * 0.5 + 0.3,
    artesano: m.price.herramientas * 0.7 - m.price.hierro * 0.6 + 0.4,
    tejedor: m.price.ropa * 0.6 - m.price.lana * 0.6 + 0.3,
    comerciante: m.cash > 60 ? 1.6 : 0.5,
    posadero: 0.8,
  };
  const e = Math.max(0, (est[role] ?? 0.5) * 0.72);
  return real !== undefined ? real * 0.7 + e * 0.3 : e;
}

function mostWanted(w: WorldState, regionId: number, here: Folk[]): FolkRole {
  let best: FolkRole = 'campesino';
  let bw = -1;
  for (const role of CAN_DO) {
    if (guilds(w, regionId) && CRAFTS.includes(role)) continue; // los gremios no dejan entrar a nadie de fuera
    const n = here.filter((f) => f.role === role).length;
    const v = wageOf(w, regionId, role) / (1 + n * 0.5);
    if (v > bw) (bw = v), (best = role);
  }
  return best;
}

/** Una vez al día, como mucho una persona del pueblo cambia de oficio porque en lo suyo ya no se gana la vida. */
export function careerDay(w: WorldState, rng: Rng, regionId: number, people: Folk[]): string | null {
  const adults = people.filter((f) => working(w, f) && f.role !== 'lider' && !f.charId && f.p && CAN_DO.includes(f.role));
  if (!adults.length || !rng.chance(0.35)) return null;
  for (const f of rng.shuffle([...adults])) {
    const mine = wageOf(w, regionId, f.role);
    const p = f.p!;
    const since = p.jobs[p.jobs.length - 1]?.from ?? 0;
    if (w.day - since < 15) continue;
    let best: FolkRole | null = null;
    let bw = mine * 1.7 + 0.35;
    for (const role of CAN_DO) {
      if (role === f.role) continue;
      if (role === 'comerciante' && p.coins < 12) continue;
      if (CRAFTS.includes(role) && guilds(w, regionId)) continue;
      const others = people.filter((o) => o.role === role).length;
      const v = wageOf(w, regionId, role) / (1 + others * 0.25);
      if (v > bw) (bw = v), (best = role);
    }
    const restless = (trait(f, 'curioso') + trait(f, 'ambicioso')) / 200;
    if (!best || !rng.chance(0.25 + restless * 0.5 + (p.needs.dinero < 0.3 ? 0.2 : 0))) continue;
    const from = f.role;
    const why = from === 'pescador' && waterOf(w, regionId) < 0.4 ? 'porque ya no se puede pescar' : `porque de ${ROLE_TITLE[from]} ya no se gana la vida`;
    changeJob(w, f, best, why);
    logEvent(w, regionId, 'oficio', `${f.name} ha dejado de ser ${ROLE_TITLE[from]} y ahora trabaja de ${ROLE_TITLE[best]}, ${why}.`, [f.id]);
    seedRumor(w, { regionId, kind: 'oficio', subject: f.id, witnesses: people.filter(() => rng.chance(0.2)).map((x) => x.id), extra: { role: ROLE_TITLE[best] } });
    return f.id;
  }
  return null;
}
