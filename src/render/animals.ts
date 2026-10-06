import type { WorldState } from '../core/types';
import { ensureLife } from '../world/life';
import type { Layout } from '../world/layout';
import { passable } from '../world/path';
import { idx } from '../world/terrain';
import type { Furniture } from './furniture';
import { hash } from './poses';
import type * as S from './sprites';

/**
 * Animales de los pueblos cercanos: rebaños según la comida y la tierra, caballos
 * junto al establo, perros por las calles y patos en el agua. Aparecen al acercarse
 * el jugador y se olvidan al alejarse.
 */
export interface Animal {
  kind: S.AnimalKind;
  x: number;
  y: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  flip: boolean;
  anim: number;
  water?: boolean; // patos: solo nadan
  v: number;
}

export interface AnimalsHost {
  w: WorldState;
  l: Layout;
  furniture: Furniture;
  animals: Map<number, Animal[]>;
}

export function moveAnimals(s: AnimalsHost, dt: number): void {
  const me = ensureLife(s.w).player;
  for (const v of s.l.villages) {
    const far = Math.hypot(v.cx - me.x, v.cy - me.y) > 60;
    if (far) {
      s.animals.delete(v.regionId);
      continue;
    }
    let list = s.animals.get(v.regionId);
    if (!list) {
      list = spawnAnimals(s, v.regionId);
      s.animals.set(v.regionId, list);
    }
    for (const a of list) {
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (d < 0.2) {
        if (Math.random() < dt * (a.kind === 'perro' ? 0.8 : 0.3)) {
          const R = a.kind === 'perro' ? 14 : a.kind === 'caballo' ? 4 : a.water ? 3 : 8;
          a.tx = a.hx + (Math.random() - 0.5) * R;
          a.ty = a.hy + (Math.random() - 0.5) * R * 0.75;
          const tt = s.l.terrain.tiles[idx(Math.floor(a.tx), Math.floor(a.ty))];
          const ok = a.water ? tt === 2 || tt === 1 || tt === 10 : passable(s.w, s.l, a.tx, a.ty) && !animalBlocked(s, a.kind, a.tx, a.ty);
          if (!ok) (a.tx = a.x), (a.ty = a.y);
        }
        continue;
      }
      const sp = Math.min(d, ({ ciervo: 1.6, perro: 2.2, caballo: 0.8, pato: 0.5 } as Record<string, number>)[a.kind] ?? 0.7) * dt;
      const nx = a.x + ((a.tx - a.x) / d) * sp;
      const ny = a.y + ((a.ty - a.y) / d) * sp;
      // Los animales no atraviesan vallas, fuentes ni casas: si el paso está cortado, se paran.
      // (si ya estaba encajado, se le deja salir)
      if (!a.water && (!passable(s.w, s.l, nx, ny) || (animalBlocked(s, a.kind, nx, ny) && !animalBlocked(s, a.kind, a.x, a.y)))) {
        a.tx = a.x;
        a.ty = a.y;
        continue;
      }
      a.flip = a.tx < a.x;
      a.x = nx;
      a.y = ny;
      a.anim += dt * 6;
    }
  }
}

/** El cuerpo de un animal es más ancho que un punto: no se planta con un farol o un poste atravesándolo. */
function animalBlocked(s: AnimalsHost, kind: Animal['kind'], x: number, y: number): boolean {
  const half = kind === 'caballo' || kind === 'vaca' ? 0.8 : kind === 'gallina' || kind === 'pato' ? 0.25 : 0.55;
  return s.furniture.solidAt(x, y) || s.furniture.solidAt(x - half, y) || s.furniture.solidAt(x + half, y);
}

/** Los rebaños crecen o menguan con la comida y la salud de la tierra. */
function spawnAnimals(s: AnimalsHost, regionId: number): Animal[] {
  const w = s.w;
  const r = w.regions[regionId];
  const v = s.l.villages[regionId];
  const food = r.isHome ? w.player.reserves / 5 : r.food;
  const plenty = r.flags.hambre ? 0.25 : Math.min(1.2, 0.4 + food / 20) * (0.5 + r.ecology * 0.6);
  const out: Animal[] = [];
  const herd = (kind: Animal['kind'], n: number, cx: number, cy: number) => {
    for (let i = 0; i < Math.round(n * plenty); i++) {
      const x = cx + (hash(`${regionId}${kind}`, i) - 0.5) * 6;
      const y = cy + (hash(`${regionId}${kind}`, i + 50) - 0.5) * 5;
      if (!passable(w, s.l, x, y) || animalBlocked(s, kind, x, y)) continue;
      out.push({ kind, x, y, hx: cx, hy: cy, tx: x, ty: y, flip: hash(`${regionId}${kind}`, i + 9) < 0.5, anim: i, v: i });
    }
  };
  const field = v.fields[0] ?? { x: v.cx + 10, y: v.cy + 8, w: 4, h: 4 };
  const pasture = { x: field.x + field.w + 4, y: field.y + 2 };
  if (r.resource === 'lana') herd('oveja', 12, pasture.x, pasture.y);
  else if (r.resource === 'grano' || r.isHome) herd('vaca', 4, pasture.x, pasture.y);
  else herd('vaca', 2, pasture.x, pasture.y);
  herd('gallina', 5, v.cx + v.plazaR + 3, v.cy + v.plazaR + 1);
  if ((r.resource === 'hierbas' || r.resource === 'ambar') && r.ecology > 0.55) herd('ciervo', 3, v.cx + 26, v.cy - 18);
  // Caballos junto al establo y perros por las calles.
  const stable = v.keys.find((k) => k.kind === 'establo');
  if (stable) herd('caballo', 2.6, stable.x + stable.w / 2, stable.y + stable.h + 2);
  for (let i = 0; i < (r.population > 700 ? 2 : 1); i++) {
    const x = v.cx + 0.5 + (hash(`${regionId}perro`, i) - 0.5) * 8;
    const y = v.cy + v.plazaR + 1.5;
    if (passable(w, s.l, x, y) && !animalBlocked(s, 'perro', x, y)) out.push({ kind: 'perro', x, y, hx: v.cx + 0.5, hy: v.cy + 0.5, tx: x, ty: y, flip: false, anim: i, v: i });
  }
  // Patos donde hay agua cerca.
  for (let k = 0; k < 40; k++) {
    const x = v.cx + 0.5 + (hash(`${regionId}pato`, k) - 0.5) * 50;
    const y = v.cy + 0.5 + (hash(`${regionId}pato`, k + 99) - 0.5) * 50;
    const tt = s.l.terrain.tiles[idx(Math.floor(x), Math.floor(y))];
    if (tt !== 2 && tt !== 10) continue;
    for (let i = 0; i < 3; i++) out.push({ kind: 'pato', x: x + i * 0.4, y: y + (i % 2) * 0.3, hx: x, hy: y, tx: x, ty: y, flip: i % 2 === 0, anim: i, water: true, v: i });
    break;
  }
  return out;
}
