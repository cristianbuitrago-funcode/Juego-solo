import type { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { GOODS, marketOf } from './economy';
import { tradeOf } from './trade';
import { geoOf } from './geography';
import { logEvent, playerRegion } from './society';
import { recordHist } from './history';
import { atlasOf, type Road } from './atlas';

/**
 * Caminos vivos: el que se usa mucho se ensancha y se empedra (sendero →
 * camino → calzada); el que nadie usa se cubre de maleza y acaba
 * perdiéndose. Los pueblos de la costa levantan puertos, y entre puertos el
 * comercio va por mar. Así aparecen centros nuevos y otros se apagan.
 */
export function roadOf(w: WorldState, routeId: number): Road {
  return (atlasOf(w).roads[routeId] ??= { quality: 0.4, used: 0 });
}

export const roadLevel = (q: number) => (q < 0.3 ? 'sendero' : q < 0.7 ? 'camino' : 'calzada');

/** Lo que el estado del camino hace al viaje (riesgo y tiempo). */
export function roadFactor(w: WorldState, a: number, b: number): { risk: number; speed: number } {
  if (!w.life?.atlas) return { risk: 1, speed: 1 };
  const route = w.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  const q = route ? roadOf(w, route.id).quality : 0.4;
  const rough = (geoOf(w, a).rough + geoOf(w, b).rough) / 2;
  return { risk: 1.2 - q * 0.5, speed: (0.8 + q * 0.4) * (1.1 - rough * 0.3) };
}

export function roadsDay(w: WorldState, rng: Rng): string[] {
  const out: string[] = [];
  const vol = tradeOf(w).volume;
  for (const route of w.routes) {
    const road = roadOf(w, route.id);
    const key = `${Math.min(route.a, route.b)}-${Math.max(route.a, route.b)}`;
    const v = vol[key] ?? 0;
    const delta = Math.max(0, v - (road.last ?? v));
    road.last = v;
    road.used = road.used * 0.97 + delta * 0.03;
    const before = roadLevel(road.quality);
    // Se mejora con el uso (y si hay arcas para empedrar); se pierde sin él.
    const target = clamp(0.12 + Math.min(0.88, road.used / 2.2));
    const pay = marketOf(w, route.a).treasury + marketOf(w, route.b).treasury > 40;
    road.quality = clamp(road.quality + (target - road.quality) * (target > road.quality ? (pay ? 0.01 : 0.004) : 0.006));
    const after = roadLevel(road.quality);
    if (before !== after) {
      const A = w.regions[route.a].name;
      const B = w.regions[route.b].name;
      const up = road.quality > 0.5;
      const text = up ? `El paso entre ${A} y ${B} ya es ${after === 'calzada' ? 'una calzada empedrada' : 'un camino ancho'}.` : `El camino entre ${A} y ${B} ${after === 'sendero' ? 'se ha convertido en un sendero de maleza' : 'se estrecha: ya casi nadie lo usa'}.`;
      logEvent(w, route.a, 'ruta', text, []);
      if (after === 'calzada' || after === 'sendero') recordHist(w, { kind: 'pueblo', regionId: route.a, text, importance: 1, fame: 0.25, witnessed: playerRegion(w) === route.a || playerRegion(w) === route.b });
      if (playerRegion(w) === route.a || playerRegion(w) === route.b) out.push(text);
    }
  }
  portsDay(w, rng, out);
  return out;
}

/** Puertos: la costa con gente y madera levanta un muelle; entre muelles, el comercio va por mar. */
function portsDay(w: WorldState, rng: Rng, out: string[]): void {
  const a = atlasOf(w);
  if (w.day % 4 !== 0) return;
  for (const r of w.regions) {
    if (a.ports[r.id] !== undefined || !geoOf(w, r.id).coast) continue;
    const m = marketOf(w, r.id);
    // Lo pagan las arcas o, si están vacías, los comerciantes del pueblo (a quienes más les interesa).
    const fund = m.treasury + m.cash * 0.3;
    if (fund >= 12 && r.population > 250 && rng.chance(0.04)) {
      const fromTreasury = Math.min(m.treasury, 10);
      m.treasury -= fromTreasury;
      m.cash -= 10 - fromTreasury;
      m.stock.madera = Math.max(0, m.stock.madera - 6);
      a.ports[r.id] = w.day;
      const text = `${r.name} levanta un puerto: llegan barcas de toda la costa.`;
      logEvent(w, r.id, 'pueblo', text, []);
      recordHist(w, { kind: 'fundacion', regionId: r.id, text, importance: 2, fame: 0.45, witnessed: playerRegion(w) === r.id || r.isHome });
      out.push(text);
      // Rutas por mar con los demás puertos.
      for (const other of Object.keys(a.ports).map(Number)) if (other !== r.id && !a.seaRoutes.some((s) => (s.a === r.id && s.b === other) || (s.a === other && s.b === r.id))) a.seaRoutes.push({ a: r.id, b: other, since: w.day });
    }
  }
  // Comercio por mar (abstracto: barcas que no se ven, pero mueven mercancía de verdad).
  for (const sr of a.seaRoutes) {
    const A = marketOf(w, sr.a);
    const B = marketOf(w, sr.b);
    for (const g of GOODS) {
      const diff = A.price[g] - B.price[g];
      if (Math.abs(diff) < 0.4) continue;
      const [from, to] = diff > 0 ? [B, A] : [A, B];
      const n = Math.min(from.stock[g] * 0.05, 4);
      if (n < 0.5) continue;
      from.stock[g] -= n;
      to.stock[g] += n;
      const value = n * Math.min(A.price[g], B.price[g]);
      to.cash -= Math.min(to.cash, value);
      from.cash += value;
      const key = `${Math.min(sr.a, sr.b)}-${Math.max(sr.a, sr.b)}`;
      tradeOf(w).volume[key] = Math.round(((tradeOf(w).volume[key] ?? 0) + value) * 10) / 10;
    }
  }
}

export function describeRoads(w: WorldState, regionId: number): string[] {
  const out: string[] = [];
  for (const route of w.routes.filter((r) => r.a === regionId || r.b === regionId)) {
    const other = route.a === regionId ? route.b : route.a;
    if (w.intel[other].level === 0 && !w.regions[other].isHome) continue;
    out.push(`Hacia ${w.regions[other].name}: ${roadLevel(roadOf(w, route.id).quality)}${route.status !== 'abierta' ? ' (cortado)' : ''}.`);
  }
  const a = atlasOf(w);
  if (a.ports[regionId] !== undefined) out.push(`Tiene puerto${a.seaRoutes.some((s) => s.a === regionId || s.b === regionId) ? ', con barcas a otros puertos' : ''}.`);
  return out;
}
