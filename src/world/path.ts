import type { WorldState } from '../core/types';
import { getLayout, Heap, type Layout } from './layout';
import { idx, inside, walkable } from './terrain';
import { TW } from './types';

/**
 * Colisiones y búsqueda de caminos sobre teselas. Las barreras de los
 * puestos fronterizos cerrados o bloqueados por la guerra cortan el camino
 * (aunque siempre se puede intentar rodear por el monte).
 */
const barrierCache = new Map<string, Set<number>>();

export function barriers(w: WorldState): Set<number> {
  const key = `${w.seed}:${w.day}:${w.routes.map((r) => r.status[0]).join('')}`;
  const hit = barrierCache.get(key);
  if (hit) return hit;
  const l = getLayout(w);
  const set = new Set<number>();
  for (const p of l.posts) {
    const route = w.routes[p.routeId];
    if (route.status === 'abierta') continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set.add(idx(Math.round(p.x) + dx, Math.round(p.y) + dy));
  }
  barrierCache.clear();
  barrierCache.set(key, set);
  return set;
}

export function passable(w: WorldState, l: Layout, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!inside(tx, ty)) return false;
  const k = idx(tx, ty);
  return walkable(l.terrain.tiles[k]) && !l.blocked[k] && !barriers(w).has(k);
}

/** A* acotado. Devuelve puntos (centros de tesela) o [] si no hay camino cercano. */
export function findPath(w: WorldState, sx: number, sy: number, gx: number, gy: number, maxNodes = 6000): { x: number; y: number }[] {
  const l = getLayout(w);
  const start = idx(Math.floor(sx), Math.floor(sy));
  let goal = idx(Math.floor(gx), Math.floor(gy));
  if (!passable(w, l, gx, gy)) {
    // Acércate al punto más próximo que se pueda pisar.
    let found = -1;
    for (let r = 1; r < 4 && found < 0; r++)
      for (let dy = -r; dy <= r && found < 0; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (passable(w, l, gx + dx, gy + dy)) {
            found = idx(Math.floor(gx + dx), Math.floor(gy + dy));
            break;
          }
    if (found < 0) return [];
    goal = found;
  }
  const g = new Map<number, number>([[start, 0]]);
  const from = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new Heap();
  heap.push(start, 0);
  const gxT = goal % TW;
  const gyT = (goal / TW) | 0;
  let n = 0;
  while (heap.size && n++ < maxNodes) {
    const c = heap.pop();
    if (closed.has(c)) continue;
    closed.add(c);
    if (c === goal) break;
    const cx = c % TW;
    const cy = (c / TW) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!passable(w, l, nx, ny)) continue;
        if (dx && dy && (!passable(w, l, cx + dx, cy) || !passable(w, l, cx, cy + dy))) continue;
        const nk = idx(nx, ny);
        const ng = (g.get(c) ?? 0) + (dx && dy ? 1.414 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          from.set(nk, c);
          heap.push(nk, ng + Math.hypot(nx - gxT, ny - gyT));
        }
      }
  }
  if (!from.has(goal) && goal !== start) return [];
  const out: { x: number; y: number }[] = [];
  for (let c: number | undefined = goal; c !== undefined && c !== start; c = from.get(c)) out.push({ x: (c % TW) + 0.5, y: ((c / TW) | 0) + 0.5 });
  return out.reverse();
}
