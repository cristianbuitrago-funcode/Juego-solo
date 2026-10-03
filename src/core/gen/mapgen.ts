import { fbm } from '../noise';
import { Rng } from '../rng';

/**
 * Generación procedural del mapa: una isla con forma irregular dividida en
 * regiones (diagrama de Voronoi deformado con ruido). La asignación de un
 * punto a una región es una función pura de la semilla, así que el
 * renderizador puede reconstruir el mapa a cualquier resolución sin guardarlo.
 */
export const WORLD_W = 1000;
export const WORLD_H = 1500;

export interface Site {
  x: number;
  y: number;
}

export function isLand(x: number, y: number, seed: number): boolean {
  const nx = (x - WORLD_W / 2) / (WORLD_W * 0.5);
  const ny = (y - WORLD_H / 2) / (WORLD_H * 0.5);
  const d = Math.sqrt(nx * nx * 0.95 + ny * ny * 1.0);
  const n = fbm(x / 260, y / 260, seed, 4);
  return n * 0.75 + 0.62 - d * 0.78 > 0.5;
}

/** Desplaza el punto con ruido para que las fronteras parezcan dibujadas a mano. */
function warp(x: number, y: number, seed: number): [number, number] {
  const wx = x + (fbm(x / 170, y / 170, seed + 101, 3) - 0.5) * 190;
  const wy = y + (fbm(x / 170, y / 170, seed + 202, 3) - 0.5) * 190;
  return [wx, wy];
}

/** Región en un punto del mundo, o -1 si es mar. */
export function regionAt(x: number, y: number, seed: number, sites: Site[]): number {
  if (!isLand(x, y, seed)) return -1;
  const [wx, wy] = warp(x, y, seed);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const dx = sites[i].x - wx;
    const dy = sites[i].y - wy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface MapLayout {
  sites: Site[];
  centers: Site[];
  neighbors: number[][];
  coastal: boolean[];
  river: number[]; // regiones por las que pasa el río, desde su nacimiento
  borderWeight: Map<string, number>;
}

const CELL = 10;

export function generateLayout(seed: number, count: number): MapLayout {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const gw = Math.floor(WORLD_W / CELL);
  const gh = Math.floor(WORLD_H / CELL);

  // 1) Máscara de tierra y su componente conexa más grande.
  const land = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) land[j * gw + i] = isLand(i * CELL + CELL / 2, j * CELL + CELL / 2, seed) ? 1 : 0;
  const comp = new Int32Array(gw * gh).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  let compId = 0;
  for (let k = 0; k < land.length; k++) {
    if (!land[k] || comp[k] >= 0) continue;
    const stack = [k];
    comp[k] = compId;
    let size = 0;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const ci = c % gw;
      const cj = Math.floor(c / gw);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const nk = nj * gw + ni;
        if (land[nk] && comp[nk] < 0) {
          comp[nk] = compId;
          stack.push(nk);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestComp = compId;
    }
    compId++;
  }

  // 2) Sitios de región: muestreo con distancia mínima sobre la isla principal.
  const sites: Site[] = [];
  let minDist = 300;
  for (let attempt = 0; sites.length < count && attempt < 6000; attempt++) {
    if (attempt % 1000 === 999) minDist *= 0.85;
    const i = rng.int(0, gw - 1);
    const j = rng.int(0, gh - 1);
    if (comp[j * gw + i] !== bestComp) continue;
    const x = i * CELL + CELL / 2;
    const y = j * CELL + CELL / 2;
    if (sites.every((s) => (s.x - x) ** 2 + (s.y - y) ** 2 > minDist * minDist)) sites.push({ x, y });
  }

  // 3) Asignación de celdas, vecindad, costa y centros.
  const owner = new Int32Array(gw * gh).fill(-1);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      if (comp[k] !== bestComp) continue;
      owner[k] = regionAt(i * CELL + CELL / 2, j * CELL + CELL / 2, seed, sites);
    }
  const n = sites.length;
  const border = new Map<string, number>();
  const coastal = new Array(n).fill(false);
  const sumX = new Array(n).fill(0);
  const sumY = new Array(n).fill(0);
  const cnt = new Array(n).fill(0);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const a = owner[j * gw + i];
      if (a < 0) continue;
      sumX[a] += i * CELL;
      sumY[a] += j * CELL;
      cnt[a]++;
      for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        const b = ni < 0 || nj < 0 || ni >= gw || nj >= gh ? -1 : owner[nj * gw + ni];
        if (b < 0) coastal[a] = true;
        else if (b !== a && (di > 0 || dj > 0)) {
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          border.set(key, (border.get(key) ?? 0) + 1);
        }
      }
    }
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [key, w] of border) {
    if (w < 3) continue;
    const [a, b] = key.split('-').map(Number);
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  ensureConnected(neighbors, border);

  // Centro visual: la celda de la región más cercana a su centroide.
  const centers: Site[] = sites.map((s, r) => {
    if (!cnt[r]) return { ...s };
    const cx = sumX[r] / cnt[r];
    const cy = sumY[r] / cnt[r];
    let best = { x: s.x, y: s.y };
    let bd = Infinity;
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        if (owner[j * gw + i] !== r) continue;
        const d = (i * CELL - cx) ** 2 + (j * CELL - cy) ** 2;
        if (d < bd) {
          bd = d;
          best = { x: i * CELL + CELL / 2, y: j * CELL + CELL / 2 };
        }
      }
    return best;
  });

  return { sites, centers, neighbors, coastal, river: makeRiver(neighbors, coastal, rng), borderWeight: border };
}

/** Si el grafo de vecindad quedó partido, une los trozos por su frontera más larga. */
function ensureConnected(neighbors: number[][], border: Map<string, number>): void {
  const n = neighbors.length;
  for (;;) {
    const seen = new Array(n).fill(false);
    const stack = [0];
    seen[0] = true;
    while (stack.length) {
      const c = stack.pop()!;
      for (const nb of neighbors[c]) if (!seen[nb]) (seen[nb] = true), stack.push(nb);
    }
    if (seen.every(Boolean)) return;
    let bestKey = '';
    let bestW = -1;
    for (const [key, w] of border) {
      const [a, b] = key.split('-').map(Number);
      if (seen[a] !== seen[b] && w > bestW) (bestW = w), (bestKey = key);
    }
    if (!bestKey) {
      // Sin frontera: une con el primero no visitado (puente marítimo).
      const a = 0;
      const b = seen.indexOf(false);
      neighbors[a].push(b);
      neighbors[b].push(a);
      continue;
    }
    const [a, b] = bestKey.split('-').map(Number);
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
}

/** El río nace en la región más interior y baja hasta la costa. */
function makeRiver(neighbors: number[][], coastal: boolean[], rng: Rng): number[] {
  const n = neighbors.length;
  const distCoast = new Array(n).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (coastal[i]) (distCoast[i] = 0), queue.push(i);
  while (queue.length) {
    const c = queue.shift()!;
    for (const nb of neighbors[c]) if (distCoast[nb] > distCoast[c] + 1) (distCoast[nb] = distCoast[c] + 1), queue.push(nb);
  }
  let start = 0;
  for (let i = 0; i < n; i++) if (distCoast[i] > distCoast[start] || (distCoast[i] === distCoast[start] && rng.chance(0.4))) start = i;
  const path = [start];
  let cur = start;
  // Baja por vecinos más cercanos a la costa; garantiza al menos 3 regiones.
  while (path.length < 4) {
    const options = neighbors[cur].filter((x) => !path.includes(x));
    if (!options.length) break;
    options.sort((a, b) => distCoast[a] - distCoast[b] || (rng.chance(0.5) ? 1 : -1));
    cur = distCoast[cur] === 0 && path.length >= 3 ? -1 : options[0];
    if (cur < 0) break;
    path.push(cur);
    if (coastal[cur] && path.length >= 3) break;
  }
  return path;
}
