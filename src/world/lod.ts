import { hashString } from '../core/rng';
import type { WorldState } from '../core/types';

/**
 * Simulación por niveles (para que el mundo entero siga vivo en un móvil):
 *  1 — donde está el protagonista (y su casa): todo, cada día, con detalle.
 *  2 — pueblos ya visitados: economía y personas cada día, menos escenas.
 *  3 — vecinos de donde está: economía cada día; personas, a grandes rasgos.
 *  4 — lo lejano: economía cada día; cada persona, uno de cada tres días.
 * Más allá (asentamientos nuevos, tierras lejanas) la gente es una cifra:
 * nacen, mueren, emigran y comercian como población abstracta.
 */
export type SimTier = 1 | 2 | 3 | 4;

export function simTier(w: WorldState, regionId: number, here: number): SimTier {
  const r = w.regions[regionId];
  if (regionId === here || r.isHome) return 1;
  if (w.life?.visited[regionId] !== undefined) return 2;
  if (here >= 0 && w.regions[here]?.neighbors.includes(regionId)) return 3;
  return 4;
}

/** ¿Toca hoy actualizar a esta persona? (en el nivel 4, por turnos) */
export function folkTurn(w: WorldState, tier: SimTier, folkId: string): boolean {
  return tier < 4 || (hashString(folkId) + w.day) % 3 === 0;
}
