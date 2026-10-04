import { MIN_SAVE_VERSION, SAVE_VERSION } from './gen/worldgen';
import { storage } from './storage';
import type { WorldState } from './types';

/**
 * Guardado y carga. Una partida es un objeto JSON: el mapa se reconstruye
 * a partir de la semilla, y el generador aleatorio guarda su estado.
 */
export const SLOTS = ['auto', 'ranura1', 'ranura2', 'ranura3'] as const;
export type Slot = (typeof SLOTS)[number];

export interface SlotInfo {
  slot: Slot;
  day: number;
  savedAt: number;
  home: string;
  seed: number;
}

const key = (s: Slot) => `ecos_partida_${s}`;

export function saveGame(w: WorldState, slot: Slot): void {
  storage.set(key(slot), JSON.stringify({ savedAt: Date.now(), world: w }));
}

export function loadGame(slot: Slot): WorldState | null {
  const raw = storage.get(key(slot));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { world: WorldState };
    return migrate(data.world);
  } catch {
    return null;
  }
}

export function slotInfo(slot: Slot): SlotInfo | null {
  const raw = storage.get(key(slot));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { savedAt: number; world: WorldState };
    const w = data.world;
    return { slot, day: w.day, savedAt: data.savedAt, home: w.regions[w.player.home].name, seed: w.seed };
  } catch {
    return null;
  }
}

/** Las partidas antiguas siguen siendo jugables: la capa de vida se crea al cargarlas. */
function migrate(w: WorldState): WorldState | null {
  if (!w || typeof w.version !== 'number' || w.version < MIN_SAVE_VERSION || w.version > SAVE_VERSION) return null;
  w.version = SAVE_VERSION;
  return w;
}

export function deleteSave(slot: Slot): void {
  storage.remove(key(slot));
}

/** Exportar/importar como texto (para copiar una partida entre dispositivos). */
export function exportGame(w: WorldState): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(w))));
}

export function importGame(text: string): WorldState | null {
  try {
    const w = JSON.parse(decodeURIComponent(escape(atob(text.trim())))) as WorldState;
    return migrate(w);
  } catch {
    return null;
  }
}
