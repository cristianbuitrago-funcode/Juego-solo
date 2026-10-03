import { CULTURES, PLAYER_CULTURE } from '../../core/content/cultures';
import type { WorldState } from '../../core/types';

/**
 * Color de una región en el mapa. Refleja lo que el JUGADOR sabe (no la
 * verdad): una región puede parecer tranquila porque tu información es vieja.
 */
function hsl(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export type RegionStatus = 'desconocida' | 'hogar' | 'guerra' | 'tension' | 'hambre' | 'degradada' | 'estable';

export function regionStatus(w: WorldState, id: number): RegionStatus {
  const r = w.regions[id];
  if (r.isHome) return 'hogar';
  const intel = w.intel[id];
  if (intel.level === 0) return 'desconocida';
  const f = intel.facts;
  if (f.tension?.value === 'en guerra') return 'guerra';
  if (f.tension && f.tension.level >= 3) return 'tension';
  if (f.alimento && f.alimento.level <= 1) return 'hambre';
  if (f.ecologia && f.ecologia.level <= 1) return 'degradada';
  return 'estable';
}

export function regionColor(w: WorldState, id: number, selected: boolean): [number, number, number] {
  const r = w.regions[id];
  const culture = r.isHome ? PLAYER_CULTURE : CULTURES.find((c) => c.id === r.culture) ?? PLAYER_CULTURE;
  const status = regionStatus(w, id);
  let c: [number, number, number];
  switch (status) {
    case 'hogar':
      c = hsl(40, 62, 70);
      break;
    case 'desconocida':
      c = hsl(35, 8, 62);
      break;
    case 'guerra':
      c = hsl(4, 55, 58);
      break;
    case 'tension':
      c = hsl(18, 58, 64);
      break;
    case 'hambre':
      c = hsl(38, 45, 58);
      break;
    case 'degradada':
      c = hsl(30, 18, 55);
      break;
    default:
      c = hsl(culture.hue, 32, 72);
  }
  if (selected) c = c.map((v) => Math.min(255, v * 1.12 + 12)) as [number, number, number];
  return c;
}

export const STATUS_LABEL: Record<RegionStatus, string> = {
  desconocida: 'Sin explorar',
  hogar: 'Tu hogar',
  guerra: 'En guerra',
  tension: 'Tensión',
  hambre: 'Escasez',
  degradada: 'Tierra degradada',
  estable: 'Sin alarmas conocidas',
};
