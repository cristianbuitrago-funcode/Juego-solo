import { regionAt } from '../core/gen/mapgen';
import { fbm } from '../core/noise';
import type { WorldState } from '../core/types';
import { T, TH, TW, WORLD_SCALE } from './types';

/**
 * Terreno real generado desde la semilla del mapa estratégico. Cada tesela
 * pertenece a una región (la misma que en el motor) y su tipo depende del
 * recurso y la cultura de la región: Fenmor puede ser un bosque profundo,
 * Praera campos abiertos, una región minera montañas y roca…
 * Es determinista: no se guarda, se reconstruye al cargar.
 */
export interface Terrain {
  seed: number;
  tiles: Uint8Array;
  region: Int8Array;
  elev: Uint8Array;
  variant: Uint8Array;
  river: { x: number; y: number }[];
  /** Teselas tal como salieron de la generación, antes de que el trazado de pueblos ponga plazas y caminos. */
  natural?: Uint8Array;
}

const cache = new Map<number, Terrain>();

export const idx = (x: number, y: number) => y * TW + x;
export const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < TW && y < TH;

/** Umbrales de bioma por recurso: cuánta montaña, bosque, prado o marisma tiene una región. */
const BIOME: Record<string, { forest: number; rock: number; mountain: number; meadow: number; marsh: number }> = {
  pesca: { forest: 0.66, rock: 0.62, mountain: 0.72, meadow: 0.55, marsh: 0.6 },
  grano: { forest: 0.7, rock: 0.64, mountain: 0.74, meadow: 0.5, marsh: 0.75 },
  sal: { forest: 0.72, rock: 0.6, mountain: 0.72, meadow: 0.6, marsh: 0.52 },
  hierbas: { forest: 0.4, rock: 0.62, mountain: 0.72, meadow: 0.62, marsh: 0.62 },
  hierro: { forest: 0.58, rock: 0.48, mountain: 0.58, meadow: 0.66, marsh: 0.75 },
  lana: { forest: 0.7, rock: 0.62, mountain: 0.72, meadow: 0.38, marsh: 0.75 },
  arcilla: { forest: 0.62, rock: 0.64, mountain: 0.74, meadow: 0.58, marsh: 0.5 },
  ambar: { forest: 0.44, rock: 0.62, mountain: 0.7, meadow: 0.62, marsh: 0.66 },
};

export function getTerrain(w: WorldState): Terrain {
  const hit = cache.get(w.seed);
  if (hit) return hit;
  const t = buildTerrain(w);
  cache.set(w.seed, t);
  if (cache.size > 2) cache.delete(cache.keys().next().value!);
  return t;
}

function buildTerrain(w: WorldState): Terrain {
  const seed = w.seed;
  const sites = w.regions.map((r) => r.site);
  const n = TW * TH;
  const tiles = new Uint8Array(n);
  const region = new Int8Array(n);
  const elev = new Uint8Array(n);
  const variant = new Uint8Array(n);

  for (let y = 0; y < TH; y++)
    for (let x = 0; x < TW; x++) {
      const k = idx(x, y);
      const r = regionAt(x * WORLD_SCALE + 1, y * WORLD_SCALE + 1, seed, sites);
      region[k] = r;
      const h = (Math.imul(x * 73856093 ^ y * 19349663, 83492791) ^ seed) >>> 0;
      variant[k] = h & 255;
      if (r < 0) {
        tiles[k] = T.Deep;
        continue;
      }
      const e = fbm(x / 70, y / 70, seed + 51, 4);
      elev[k] = Math.round(e * 255);
      const m = fbm(x / 46, y / 46, seed + 77, 3);
      const b = BIOME[w.regions[r].resource] ?? BIOME.grano;
      let tile: T = T.Grass;
      if (e > b.mountain) tile = T.Mountain;
      else if (e > b.rock) tile = T.Rock;
      else if (m > b.forest) tile = T.Forest;
      else if (m > b.marsh && e < 0.45 && (w.regions[r].resource === 'arcilla' || w.regions[r].resource === 'sal' || w.regions[r].resource === 'pesca')) tile = T.Marsh;
      else if (m < 1 - b.meadow) tile = T.Meadow;
      tiles[k] = tile;
    }

  // Costa: aguas someras y playas.
  const dist = new Uint8Array(n).fill(255);
  const queue: number[] = [];
  for (let k = 0; k < n; k++) if (tiles[k] !== T.Deep) (dist[k] = 0), queue.push(k);
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    if (dist[k] >= 4) continue;
    const x = k % TW;
    const y = (k / TW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny)) continue;
      const nk = idx(nx, ny);
      if (dist[nk] > dist[k] + 1) (dist[nk] = dist[k] + 1), queue.push(nk);
    }
  }
  for (let k = 0; k < n; k++) if (tiles[k] === T.Deep && dist[k] <= 3) tiles[k] = T.Sea;
  for (let y = 1; y < TH - 1; y++)
    for (let x = 1; x < TW - 1; x++) {
      const k = idx(x, y);
      if (tiles[k] === T.Sea || tiles[k] === T.Deep || tiles[k] === T.Mountain) continue;
      let shore = false;
      for (let dy = -2; dy <= 2 && !shore; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const s = tiles[idx(x + dx, y + dy)];
          if (s === T.Sea || s === T.Deep) {
            shore = Math.abs(dx) + Math.abs(dy) <= 2;
            if (shore) break;
          }
        }
      if (shore) {
        const res = w.regions[region[k]].resource;
        tiles[k] = res === 'sal' && variant[k] < 140 ? T.Salt : T.Sand;
      }
    }

  // El río, y arcilla roja en las orillas de las regiones alfareras.
  const river = buildRiver(w, tiles);
  for (const p of river) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.round(p.x) + dx;
        const y = Math.round(p.y) + dy;
        if (!inside(x, y)) continue;
        const k = idx(x, y);
        if (tiles[k] === T.Deep || tiles[k] === T.Sea) continue;
        if (Math.hypot(x - p.x, y - p.y) <= 1.35) tiles[k] = T.River;
      }
  }
  for (const p of river)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = Math.round(p.x) + dx;
        const y = Math.round(p.y) + dy;
        if (!inside(x, y)) continue;
        const k = idx(x, y);
        if (region[k] >= 0 && w.regions[region[k]].resource === 'arcilla' && (tiles[k] === T.Grass || tiles[k] === T.Meadow)) tiles[k] = T.Clay;
      }

  return { seed, tiles, region, elev, variant, river };
}

/** El río del motor, trazado sobre teselas desde su nacimiento hasta el mar. */
function buildRiver(w: WorldState, tiles: Uint8Array): { x: number; y: number }[] {
  const pts = w.river.map((id) => ({ x: w.regions[id].center.x / WORLD_SCALE, y: w.regions[id].center.y / WORLD_SCALE }));
  if (!pts.length) return [];
  const last = pts[pts.length - 1];
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (let y = 0; y < TH; y += 2)
    for (let x = 0; x < TW; x += 2) {
      if (tiles[idx(x, y)] !== T.Sea) continue;
      const d = (x - last.x) ** 2 + (y - last.y) ** 2;
      if (d < bd) (bd = d), (best = { x, y });
    }
  if (best) pts.push(best);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const steps = Math.ceil(len * 1.5);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const wob = (Math.sin((i * 10 + t * 10) * 1.7 + w.seed) * 9 + Math.sin(t * 31 + i) * 2) * Math.sin(t * Math.PI);
      out.push({ x: a.x + (b.x - a.x) * t + (-(b.y - a.y) / len) * wob, y: a.y + (b.y - a.y) * t + ((b.x - a.x) / len) * wob });
    }
  }
  return out;
}

/** ¿Se puede caminar por esta tesela? (sin contar edificios) */
export function walkable(t: number): boolean {
  return t !== T.Deep && t !== T.Sea && t !== T.River && t !== T.Mountain;
}

/** Multiplicador de velocidad al caminar. */
export function speedOf(t: number): number {
  switch (t) {
    case T.Road:
    case T.Bridge:
    case T.Plaza:
      return 1.15;
    case T.Forest:
      return 0.72;
    case T.Marsh:
      return 0.6;
    case T.Rock:
    case T.Sand:
    case T.Salt:
      return 0.85;
    default:
      return 1;
  }
}
