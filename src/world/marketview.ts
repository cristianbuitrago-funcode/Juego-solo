import type { WorldState } from '../core/types';
import { hourOf } from './clock';
import { amountWord, FOODS, foodDays, GOOD, GOODS, marketOf, priceWord, type Good } from './economy';
import { fieldLook } from './farming';
import { playerEco } from './business';
import { tradeOf } from './trade';

/**
 * Lo que se ve de la economía sin mirar números: puestos llenos o vacíos,
 * qué se vende en cada uno, qué falta, qué está caro, quién cierra, qué
 * caravanas llegan. Los números solo aparecen si el jugador pregunta.
 */
export const GOOD_COLOR: Record<Good, string> = {
  trigo: '#d9a441', verdura: '#6a9a3a', fruta: '#d9473a', carne: '#a8443a', pescado: '#8ab0c8',
  madera: '#8a6440', piedra: '#9a9a9a', hierro: '#5a5a62', herramientas: '#7a7a82', ropa: '#8a4a8a',
  armas: '#9aa0a8', muebles: '#a07a4e', medicinas: '#6a9a6a', semillas: '#c9b36a', lana: '#e8e0d0',
  sal: '#f0f0f0', ambar: '#e09a3a',
};

const cache = new Map<string, { stalls: (string[] | undefined)[] }>();

/** Los puestos del mercado de un pueblo: qué colores (mercancías) se ven en cada uno. */
export function marketLook(w: WorldState, regionId: number): { stalls: (string[] | undefined)[] } {
  const life = w.life;
  if (!life?.society) return { stalls: [['#d9a441'], ['#6a9a3a']] };
  const hour = Math.floor(hourOf(life.clock));
  const key = `${regionId}:${w.day}:${hour}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 60) cache.clear();
  const m = marketOf(w, regionId);
  const merchants = life.folk.filter((f) => f.alive && f.regionId === regionId && f.role === 'comerciante');
  const present = merchants.filter((f) => !(f.p?.away && f.p.away.back > w.day) && !((f.p?.sick ?? -1) >= w.day));
  const player = playerEco(w).businesses.find((b) => b.kind === 'puesto' && b.regionId === regionId);
  const openHours = hour >= 8 && hour < 19;
  const goodsHere = GOODS.filter((g) => m.stock[g] >= 1).sort((a, b) => m.stock[b] / GOOD[b].base - m.stock[a] / GOOD[a].base);
  const foods = goodsHere.filter((g) => FOODS.includes(g));
  const rest = goodsHere.filter((g) => !FOODS.includes(g));
  const total = Math.min(6, Math.max(2, merchants.length + m.closedStalls + (player ? 1 : 0)));
  const stalls: (string[] | undefined)[] = [];
  const groups = [foods.slice(0, 3), rest.slice(0, 3), [...foods.slice(3), ...rest.slice(3, 5)], rest.slice(5, 8), foods.slice(0, 2), rest.slice(1, 4)];
  for (let i = 0; i < total; i++) {
    const open = openHours && i < present.length - m.closedStalls;
    if (player && i === total - 1) {
      stalls.push(openHours ? Object.keys(player.stock).slice(0, 3).map((g) => GOOD_COLOR[g as Good]) : []);
      continue;
    }
    const goods = groups[i % groups.length].map((g) => GOOD_COLOR[g]);
    stalls.push(open && goods.length ? goods : []);
  }
  // Si no queda ningún comerciante, al menos un puesto viejo y vacío.
  const res = { stalls: stalls.length ? stalls : [[], undefined] };
  cache.set(key, res);
  return res;
}

/** Lo que el jugador nota al mirar los puestos (sin cifras). */
export function describeMarket(w: WorldState, regionId: number): string[] {
  const m = marketOf(w, regionId);
  const life = w.life!;
  const lines: string[] = [];
  const days = foodDays(w, regionId);
  lines.push(days > 6 ? 'Los puestos rebosan: sacos de grano, cestas de verdura, fruta apilada.' : days > 2 ? 'Hay de comer, aunque los puestos no están llenos.' : days > 0.5 ? 'Los puestos de comida están medio vacíos. La gente compra poco y mira mucho.' : 'Los puestos de comida están vacíos. Alguien barre un mostrador sin nada encima.');
  const plenty = GOODS.filter((g) => amountWord(m, g) === 'mucho').slice(0, 3);
  const missing = GOODS.filter((g) => m.stock[g] < 0.5 && m.demand[g] > 0.05).slice(0, 3);
  const pricey = GOODS.filter((g) => m.stock[g] >= 0.5 && priceWord(m, g) === 'carísimo').slice(0, 2);
  const cheap = GOODS.filter((g) => m.stock[g] >= 2 && priceWord(m, g) === 'barato').slice(0, 2);
  if (plenty.length) lines.push(`Hay mucho de esto: ${list(plenty)}.`);
  if (missing.length) lines.push(`No hay ${missing.map((g) => GOOD[g].name).join(', ni ')}.`);
  if (pricey.length) lines.push(`Está carísimo: ${list(pricey)}. La gente se queja en voz alta.`);
  if (cheap.length) lines.push(`Se vende barato: ${list(cheap)}.`);
  if (m.closedStalls > 0) lines.push(m.closedStalls > 1 ? 'Hay puestos cerrados con tablas.' : 'Un puesto está cerrado con tablas.');
  const arriving = tradeOf(w).convoys.filter((c) => c.to === regionId && c.status === 'viaje').length;
  const leaving = tradeOf(w).convoys.filter((c) => c.from === regionId && c.status === 'viaje').length;
  if (arriving) lines.push(arriving > 1 ? 'Se esperan varias caravanas.' : 'Dicen que viene una caravana.');
  if (leaving) lines.push('Han salido carretas cargadas hacia otros pueblos.');
  const busy = life.folk.filter((f) => f.alive && f.regionId === regionId && (f.p?.emo.estres ?? 0) > 0.55).length;
  if (busy >= 3) lines.push('Se ven caras de preocupación entre los vendedores.');
  lines.push(fieldLook(w, regionId));
  return lines;
}

const list = (g: Good[]) => (g.length === 1 ? GOOD[g[0]].name : `${g.slice(0, -1).map((x) => GOOD[x].name).join(', ')} y ${GOOD[g[g.length - 1]].name}`);
