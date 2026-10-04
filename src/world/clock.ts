import type { WorldState } from '../core/types';
import { DAY_MINUTES, DAYS_PER_SEASON, DAYS_PER_YEAR } from './types';

/**
 * Tiempo del mundo. El reloj es continuo: un día del motor empieza a las
 * 06:00. Los años tienen cuatro estaciones de cinco días.
 */
export const SECONDS_PER_MINUTE = 0.25; // 6 minutos reales por día

/** Hora del día (0..24) a partir del reloj absoluto. */
export function hourOf(clock: number): number {
  return (6 + clock / 60) % 24;
}

export function dayOf(clock: number): number {
  return Math.floor(clock / DAY_MINUTES) + 1;
}

export function clockText(clock: number): string {
  const h = hourOf(clock);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm - (mm % 10)).padStart(2, '0')}`;
}

export const SEASONS = ['primavera', 'verano', 'otoño', 'invierno'] as const;
export type Season = (typeof SEASONS)[number];

export function seasonOf(day: number): Season {
  return SEASONS[Math.floor(((day - 1) % DAYS_PER_YEAR) / DAYS_PER_SEASON)];
}

export function yearOf(day: number): number {
  return Math.floor((day - 1) / DAYS_PER_YEAR) + 1;
}

export type Weather = 'despejado' | 'nublado' | 'lluvia' | 'tormenta' | 'viento' | 'niebla' | 'nieve';

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x85ebca6b, 2246822519);
  h ^= h >>> 15;
  h = Math.imul(h, 2654435761);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Tiempo atmosférico del día: depende de la estación y del invierno largo. */
export function weatherOf(w: WorldState, day: number): Weather {
  if (w.regions.some((r) => r.flags.invierno)) return hash(w.seed, day) < 0.75 ? 'nieve' : 'niebla';
  const s = seasonOf(day);
  const r = hash(w.seed, day);
  if (s === 'invierno') return r < 0.35 ? 'nieve' : r < 0.55 ? 'nublado' : r < 0.65 ? 'niebla' : 'despejado';
  if (s === 'otoño') return r < 0.22 ? 'lluvia' : r < 0.3 ? 'tormenta' : r < 0.42 ? 'viento' : r < 0.52 ? 'niebla' : r < 0.68 ? 'nublado' : 'despejado';
  if (s === 'primavera') return r < 0.22 ? 'lluvia' : r < 0.32 ? 'viento' : r < 0.45 ? 'nublado' : 'despejado';
  return r < 0.07 ? 'lluvia' : r < 0.13 ? 'tormenta' : r < 0.22 ? 'nublado' : 'despejado';
}

/** Oscuridad de la noche (0 día pleno, ~0.75 medianoche). */
export function darkness(clock: number): number {
  const h = hourOf(clock);
  if (h >= 7 && h <= 18.5) return 0;
  if (h > 18.5 && h < 21) return ((h - 18.5) / 2.5) * 0.62;
  if (h >= 21 || h < 4.5) return 0.62;
  return ((7 - h) / 2.5) * 0.62;
}
