import { Rng } from './rng';
import type { Character, Entry, EntryId, Region, RegionId, Relation, Route, WorldState } from './types';
import { clamp } from './util';

/**
 * Contexto de simulación: el estado del mundo y el generador aleatorio.
 * Todos los sistemas reciben un Ctx para que la simulación sea determinista.
 */
export interface Ctx {
  w: WorldState;
  rng: Rng;
  /** Entradas creadas durante este paso (para el resumen del día). */
  fresh: Entry[];
}

export function makeCtx(w: WorldState): Ctx {
  return { w, rng: new Rng(w.rngState), fresh: [] };
}

/** Guarda el estado del generador aleatorio en el mundo. */
export function commitCtx(ctx: Ctx): void {
  ctx.w.rngState = ctx.rng.state;
}

export function nextId(w: WorldState, prefix: string): string {
  w.counters[prefix] = (w.counters[prefix] ?? 0) + 1;
  return `${prefix}${w.counters[prefix]}`;
}

export const region = (w: WorldState, id: RegionId): Region => w.regions[id];

export const home = (w: WorldState): Region => w.regions[w.player.home];

export const others = (w: WorldState): Region[] => w.regions.filter((r) => !r.isHome);

export function rel(w: WorldState, a: RegionId, b: RegionId): Relation | undefined {
  return w.regions[a].relations[b];
}

/** Modifica la relación en ambos sentidos (simétrica salvo que se indique). */
export function adjustRel(w: WorldState, a: RegionId, b: RegionId, opinion: number, tension = 0, grievance = 0): void {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const r = w.regions[x].relations[y];
    if (!r) continue;
    r.opinion = clamp(r.opinion + opinion, -1, 1);
    r.tension = clamp(r.tension + tension);
    r.grievance = clamp(r.grievance + grievance);
  }
}

export function routeBetween(w: WorldState, a: RegionId, b: RegionId): Route | undefined {
  return w.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
}

export function routesOf(w: WorldState, id: RegionId): Route[] {
  return w.routes.filter((r) => r.a === id || r.b === id);
}

export const otherEnd = (route: Route, id: RegionId): RegionId => (route.a === id ? route.b : route.a);

export function charactersOf(w: WorldState, id: RegionId, aliveOnly = true): Character[] {
  return w.characters.filter((c) => c.regionId === id && (!aliveOnly || c.alive));
}

export function leaderOf(w: WorldState, id: RegionId): Character | undefined {
  return charactersOf(w, id).find((c) => c.role === 'lider') ?? charactersOf(w, id)[0];
}

export function entry(w: WorldState, id: EntryId | undefined): Entry | undefined {
  if (!id) return undefined;
  return w.entries.find((e) => e.id === id);
}

/** Recorre la cadena causal hacia atrás hasta la raíz. */
export function rootOf(w: WorldState, id: EntryId | undefined): Entry | undefined {
  let cur = entry(w, id);
  let guard = 0;
  while (cur?.causeId && guard++ < 50) {
    const parent = entry(w, cur.causeId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/** Devuelve la causa más reciente entre las condiciones activas indicadas. */
export function causeFor(r: Region, flags: string[]): EntryId | undefined {
  let best: { since: number; id?: EntryId } | undefined;
  for (const f of flags) {
    const fl = r.flags[f];
    if (fl?.causeId && (!best || fl.since > best.since)) best = { since: fl.since, id: fl.causeId };
  }
  return best?.id;
}

/** Distancias en saltos desde una región (BFS sobre la vecindad). */
export function hops(w: WorldState, from: RegionId): number[] {
  const d = new Array(w.regions.length).fill(Infinity);
  d[from] = 0;
  const q = [from];
  while (q.length) {
    const c = q.shift()!;
    for (const n of w.regions[c].neighbors) if (d[n] > d[c] + 1) (d[n] = d[c] + 1), q.push(n);
  }
  return d;
}

/** Dirección cardinal desde tu hogar hacia una región. */
export function direction(w: WorldState, id: RegionId): string {
  const h = home(w).center;
  const t = w.regions[id].center;
  const dx = t.x - h.x;
  const dy = t.y - h.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 'centro';
  const ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const dirs = ['este', 'noreste', 'norte', 'noroeste', 'oeste', 'suroeste', 'sur', 'sureste'];
  return dirs[Math.round(((ang + 360) % 360) / 45) % 8];
}

/** Influencia del jugador en una región (la autonomía y el abandono la reducen). */
export function influence(r: Region): number {
  return (r.autonomous ? 0.6 : 1) * (r.abandoned ? 0.3 : 1);
}

export function totalTraffic(w: WorldState, id: RegionId): number {
  return routesOf(w, id).reduce((s, r) => s + (r.status === 'abierta' ? r.traffic : 0), 0);
}
