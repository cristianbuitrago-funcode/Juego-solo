import type { WorldState } from '../core/types';
import { getLayout } from './layout';

/**
 * Red de caminos: camino completo (en teselas) entre dos pueblos siguiendo
 * las rutas. Lo usan las caravanas, los refugiados, los soldados y el viaje.
 */
const cache = new Map<string, { x: number; y: number }[]>();

export function roadPath(w: WorldState, from: number, to: number, openOnly = false): { x: number; y: number }[] {
  const key = `${w.seed}:${from}:${to}:${openOnly ? w.routes.map((r) => r.status[0]).join('') : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const l = getLayout(w);
  const prev = new Map<number, { region: number; road: number }>();
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const c = q.shift()!;
    if (c === to) break;
    l.roads.forEach((road, i) => {
      if (openOnly && w.routes[road.routeId].status !== 'abierta') return;
      const n = road.a === c ? road.b : road.b === c ? road.a : -1;
      if (n < 0 || seen.has(n)) return;
      seen.add(n);
      prev.set(n, { region: c, road: i });
      q.push(n);
    });
  }
  if (!seen.has(to) || from === to) return [];
  const segs: { x: number; y: number }[][] = [];
  for (let c = to; c !== from; ) {
    const p = prev.get(c)!;
    const road = l.roads[p.road];
    segs.unshift(road.a === p.region ? road.path : [...road.path].reverse());
    c = p.region;
  }
  const out = segs.flat();
  cache.set(key, out);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return out;
}

/** Punto a una fracción t (0..1) del recorrido, y dirección del movimiento. */
export function along(path: { x: number; y: number }[], t: number): { x: number; y: number; dx: number; dy: number } {
  if (!path.length) return { x: 0, y: 0, dx: 1, dy: 0 };
  const f = Math.max(0, Math.min(0.9999, t)) * (path.length - 1);
  const i = Math.floor(f);
  const a = path[i];
  const b = path[Math.min(path.length - 1, i + 1)];
  const k = f - i;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: b.x - a.x, dy: b.y - a.y };
}
