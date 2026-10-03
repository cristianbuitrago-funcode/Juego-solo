import type { Ctx } from './world';
import { nextId } from './world';
import type { Entry, EntryId, EntryKind, RegionId, WorldState } from './types';

/**
 * La memoria del mundo. Cada acontecimiento importante se registra con su
 * causa. Así se forman las cadenas de consecuencias que el jugador explora
 * en el historial, y que los sistemas consultan para decidir el futuro.
 */
export interface RecordOpts {
  kind: EntryKind;
  text: string;
  regions: RegionId[];
  causeId?: EntryId;
  known?: boolean;
  importance?: 1 | 2 | 3;
  byPlayer?: boolean;
}

export function record(ctx: Ctx, o: RecordOpts): Entry {
  const e: Entry = {
    id: nextId(ctx.w, 'e'),
    day: ctx.w.day,
    kind: o.kind,
    text: o.text,
    regions: o.regions,
    causeId: o.causeId,
    known: o.known ?? isVisible(ctx.w, o.regions),
    importance: o.importance ?? 1,
    byPlayer: o.byPlayer,
  };
  ctx.w.entries.push(e);
  ctx.fresh.push(e);
  return e;
}

/** Por defecto el jugador se entera de lo que ocurre en regiones que observa de cerca. */
export function isVisible(w: WorldState, regions: RegionId[]): boolean {
  return regions.some((id) => {
    const r = w.regions[id];
    const intel = w.intel[id];
    return r.isHome || intel.observerStationed || intel.level >= 3 || (intel.level >= 2 && w.day - intel.lastObserved < 4);
  });
}

/**
 * Descubre lo ocurrido en una región desde cierto día. Devuelve las entradas
 * reveladas: es la recompensa de investigar.
 */
export function revealRegionHistory(w: WorldState, id: RegionId, sinceDay: number, max = 6): Entry[] {
  const hidden = w.entries.filter((e) => !e.known && e.day >= sinceDay && e.regions.includes(id));
  const revealed = hidden.slice(-max);
  for (const e of revealed) e.known = true;
  return revealed;
}

/** Entradas hijas directas (consecuencias) de una entrada. */
export function childrenOf(w: WorldState, id: EntryId): Entry[] {
  return w.entries.filter((e) => e.causeId === id);
}

/** Raíces de cadenas: entradas sin causa que tienen al menos una consecuencia. */
export function chainRoots(w: WorldState): Entry[] {
  const hasChild = new Set(w.entries.map((e) => e.causeId).filter(Boolean));
  return w.entries.filter((e) => !e.causeId && hasChild.has(e.id));
}

export function chainSize(w: WorldState, id: EntryId): number {
  let n = 1;
  for (const c of childrenOf(w, id)) n += chainSize(w, c.id);
  return n;
}
