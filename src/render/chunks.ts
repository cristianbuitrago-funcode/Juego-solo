import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import type { WorldState } from '../core/types';
import type { Season } from '../world/clock';
import type { Layout } from '../world/layout';
import { idx, inside } from '../world/terrain';
import { T, TH, TILE, TW } from '../world/types';

/**
 * Suelo del mundo dibujado por fragmentos (24×24 teselas) que se guardan en
 * caché. Solo se vuelven a pintar cuando cambia la estación o el estado de
 * los campos (hambre, abandono). Los árboles, rocas y montañas son objetos
 * aparte para poder ordenarlos en profundidad con las personas.
 */
export const CHUNK = 24;

/** Ruido fino para dar textura al suelo (64×64, se repite). */
const NOISE = (() => {
  const n = new Uint8Array(64 * 64);
  let s = 1234567;
  for (let i = 0; i < n.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    n[i] = (s >>> 24) % 17;
  }
  // Suavizado ligero para que no parezca nieve de televisor.
  const m = new Uint8Array(n.length);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += n[((y + dy) & 63) * 64 + ((x + dx) & 63)];
      m[y * 64 + x] = Math.round(sum / 9);
    }
  return m;
})();
const CPX = CHUNK * TILE;

export interface StaticObject {
  x: number; // píxeles de mundo (pies)
  y: number;
  kind: 'arbol' | 'roca' | 'pico' | 'junco' | 'arbusto' | 'mojon' | 'hierba' | 'flores';
  tree?: 'roble' | 'pino' | 'abedul' | 'sauce' | 'frutal';
  v: number;
  region: number;
}

interface ChunkEntry {
  key: string;
  canvas: HTMLCanvasElement;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const rgb = (c: [number, number, number], k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;

export class ChunkCache {
  private chunks = new Map<string, ChunkEntry>();
  private objects = new Map<string, StaticObject[]>();
  private grass: [number, number, number][] = [];
  constructor(private w: WorldState, private l: Layout) {
    // Cada región tiñe ligeramente su vegetación: las fronteras se notan sin dibujar líneas.
    this.grass = w.regions.map((r) => {
      const hue = (r.isHome ? PLAYER_CULTURE : CULTURES.find((c) => c.id === r.culture) ?? PLAYER_CULTURE).hue;
      const shift = ((hue % 60) - 30) * 0.12;
      // Verde vivo de pixel art; una tierra degradada amarillea.
      return hsl(96 + shift - (r.ecology < 0.5 ? 14 : 0), Math.max(26, Math.min(58, 48 + (r.ecology - 0.6) * 30)), 47);
    });
  }

  private nearVillage(tx: number, ty: number): boolean {
    return this.l.villages.some((v) => Math.hypot(v.cx - tx, v.cy - ty) < v.plazaR + 30);
  }

  setWorld(w: WorldState): void {
    this.w = w;
  }

  /** Clave del estado visual de un fragmento: estación y campos con hambre. */
  stateKey(season: Season): string {
    const hungry = this.w.regions.map((r) => (r.flags.hambre ? 1 : 0) + (r.ecology < 0.42 ? 2 : 0)).join('');
    return `${season}:${hungry}`;
  }

  get(cx: number, cy: number, season: Season, stateKey: string): HTMLCanvasElement {
    const id = `${cx},${cy}`;
    const hit = this.chunks.get(id);
    if (hit && hit.key === stateKey) return hit.canvas;
    const canvas = hit?.canvas ?? document.createElement('canvas');
    canvas.width = CPX;
    canvas.height = CPX;
    this.paint(canvas, cx, cy, season);
    this.chunks.set(id, { key: stateKey, canvas });
    if (this.chunks.size > 36) {
      const first = this.chunks.keys().next().value!;
      if (first !== id) this.chunks.delete(first);
    }
    return canvas;
  }

  /**
   * Pinta un fragmento en pixel art. Cada píxel toma el color de su tesela,
   * pero el límite entre teselas se desplaza con ruido: los bordes entre
   * hierba, tierra, agua o roca quedan dentados y orgánicos, sin cuadrícula.
   * Cada material tiene su textura (matas de hierba, guijarros, adoquines,
   * reflejos del agua, surcos, grietas) con 3–4 tonos por color, y el
   * relieve se marca en escalones de luz.
   */
  private paint(canvas: HTMLCanvasElement, cx: number, cy: number, season: Season): void {
    const g = canvas.getContext('2d')!;
    const { tiles, region, variant, elev } = this.l.terrain;
    const N = CHUNK + 2;
    const col = new Float32Array(N * N * 3);
    const typ = new Uint8Array(N * N);
    const lit = new Float32Array(N * N);
    const high = new Uint8Array(N * N);
    const tx0 = cx * CHUNK - 1;
    const ty0 = cy * CHUNK - 1;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const tx = Math.max(0, Math.min(TW - 1, tx0 + i));
        const ty = Math.max(0, Math.min(TH - 1, ty0 + j));
        const c = this.tileColor(tx, ty, season);
        const k = idx(tx, ty);
        const t = tiles[k];
        let l = 1;
        if (t !== T.Deep && t !== T.Sea && t !== T.River) {
          const ex = elev[idx(Math.max(0, tx - 1), ty)] - elev[idx(Math.min(TW - 1, tx + 1), ty)];
          const ey = elev[idx(tx, Math.max(0, ty - 1))] - elev[idx(tx, Math.min(TH - 1, ty + 1))];
          const raw = (ex + ey) * (t === T.Mountain || t === T.Rock ? 0.022 : 0.012);
          l = raw > 0.05 ? 1.07 : raw < -0.05 ? 0.9 : 1;
        }
        const o = j * N + i;
        col[o * 3] = c[0];
        col[o * 3 + 1] = c[1];
        col[o * 3 + 2] = c[2];
        typ[o] = t;
        lit[o] = l;
        high[o] = t === T.Mountain && elev[k] > 200 ? 1 : 0;
      }
    const img = g.createImageData(CPX, CPX);
    const d = img.data;
    const isWater = (t: number) => t === T.Sea || t === T.Deep || t === T.River;
    const wx0 = cx * CPX;
    const wy0 = cy * CPX;
    // Tesela (en la rejilla con margen) que "posee" un píxel de mundo, con borde dentado.
    const owner = (wx: number, wy: number): number => {
      const jx = (NOISE[(((wy >> 2) + 11) & 63) * 64 + (((wx >> 2) + 37) & 63)] - 8) * 1.1 + (NOISE[((wy + 3) & 63) * 64 + ((wx + 29) & 63)] - 8) * 0.35;
      const jy = (NOISE[(((wy >> 2) + 41) & 63) * 64 + (((wx >> 2) + 5) & 63)] - 8) * 1.1 + (NOISE[((wy + 17) & 63) * 64 + ((wx + 3) & 63)] - 8) * 0.35;
      const i = Math.floor((wx + jx) / TILE) - tx0;
      const j = Math.floor((wy + jy) / TILE) - ty0;
      return Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i));
    };
    for (let py = 0; py < CPX; py++) {
      const wy = wy0 + py;
      for (let px = 0; px < CPX; px++) {
        const wx = wx0 + px;
        const o = owner(wx, wy);
        const t = typ[o];
        let r = col[o * 3];
        let gg = col[o * 3 + 1];
        let b = col[o * 3 + 2];
        const h = (Math.imul(wx, 73856093) ^ Math.imul(wy, 19349663) ^ (wx * wy)) >>> 0;
        const v = h & 255;
        const n = NOISE[((wy >> 2) & 63) * 64 + ((wx >> 2) & 63)]; // manchas grandes 0..16
        let k = n < 6 ? 0.94 : n > 11 ? 1.05 : 1; // manchas de color
        let cool = 0; // desplazamiento a violeta de las sombras
        switch (t) {
          case T.Grass:
          case T.Meadow:
          case T.Forest:
            if (v < (t === T.Forest ? 34 : 20)) (k *= 0.8), (cool = 1);
            else if (v > 247) k *= 1.14;
            break;
          case T.Road:
          case T.Clay:
            if (v < 16) (k *= 0.8), (cool = 1);
            else if (v > 242) k *= 1.12;
            break;
          case T.Sand:
          case T.Salt:
            if (v < 10) k *= 0.88;
            else if (v > 236) k *= 1.08;
            break;
          case T.Plaza: {
            // Adoquines de 6×5 en hileras alternas.
            const row = Math.floor(wy / 5);
            const off = (row & 1) * 3;
            const sx = (wx + off) % 6;
            const sy = wy % 5;
            const stone = ((Math.imul(Math.floor((wx + off) / 6), 2654435761) ^ Math.imul(row, 40503)) >>> 0) & 7;
            if (sx === 0 || sy === 0) (k = 0.74), (cool = 1);
            else if (sx === 1 && sy === 1) k = 1.12;
            else k = 0.94 + stone * 0.018;
            break;
          }
          case T.Bridge:
            if (wx % 4 === 0) (k = 0.72), (cool = 1);
            else if (wx % 4 === 1) k = 1.1;
            break;
          case T.Field:
            if (wy % 4 === 0) (k *= 0.78), (cool = 1);
            else if (wy % 4 === 1) k *= 1.06;
            break;
          case T.Mountain:
          case T.Rock:
            if (v < 22) (k *= 0.76), (cool = 1);
            else if (v > 238) k *= 1.12;
            if (high[o]) (r = 228), (gg = 234), (b = 242), (k = v < 30 ? 0.86 : 1);
            break;
          case T.Marsh:
            if (n < 5) (r = 78), (gg = 120), (b = 128);
            else if (v < 24) k *= 0.82;
            break;
          case T.Sea:
          case T.Deep:
          case T.River: {
            // Reflejos: rayas cortas horizontales.
            const band = (wy + (n >> 2)) % (t === T.River ? 7 : 9);
            if (band === 0 && (v & 7) < 5) k = 1.16;
            else if (band === 1 && (v & 7) < 3) k = 1.07;
            else if (n < 5) k = 0.92;
            // Espuma donde toca tierra; orilla mojada al otro lado.
            if (!isWater(typ[owner(wx, wy - 2)]) || !isWater(typ[owner(wx, wy + 2)]) || !isWater(typ[owner(wx - 2, wy)]) || !isWater(typ[owner(wx + 2, wy)])) (r = 214), (gg = 232), (b = 236), (k = v < 60 ? 0.94 : 1);
            break;
          }
        }
        if (!isWater(t) && t !== T.Plaza && t !== T.Bridge) {
          k *= lit[o];
          if (isWater(typ[owner(wx, wy - 2)]) || isWater(typ[owner(wx, wy + 2)]) || isWater(typ[owner(wx - 2, wy)]) || isWater(typ[owner(wx + 2, wy)])) (k *= 0.84), (cool = 1);
        }
        const q = (py * CPX + px) * 4;
        d[q] = r * k - cool * 8;
        d[q + 1] = gg * k - cool * 4;
        d[q + 2] = b * k + cool * 10;
        d[q + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    for (let j = 0; j < CHUNK; j++)
      for (let i = 0; i < CHUNK; i++) {
        const tx = cx * CHUNK + i;
        const ty = cy * CHUNK + j;
        if (!inside(tx, ty)) continue;
        const k = idx(tx, ty);
        const reg = region[k];
        const c = this.tileColor(tx, ty, season);
        this.detail(g, tiles[k], i * TILE, j * TILE, variant[k], season, c, k, tx, ty, elev[k], reg >= 0 && this.w.regions[reg].flags.hambre ? 1 : 0);
      }
  }

  private tileColor(tx: number, ty: number, season: Season): [number, number, number] {
    const { tiles, region } = this.l.terrain;
    const k = idx(tx, ty);
    const t = tiles[k];
    const reg = region[k];
    const r = reg >= 0 ? this.w.regions[reg] : undefined;
    const jitter = 1; // la variación viene del ruido por píxel, no por tesela (sin cuadros)
    let base: [number, number, number];
    switch (t) {
      case T.Deep:
        base = [44, 80, 102];
        break;
      case T.Sea:
        base = [62, 112, 136];
        break;
      case T.River:
        base = [76, 132, 158];
        break;
      case T.Sand:
        base = [222, 205, 156];
        break;
      case T.Salt:
        base = [232, 228, 216];
        break;
      case T.Clay:
        base = [181, 118, 80];
        break;
      case T.Rock:
        base = [150, 144, 132];
        break;
      case T.Mountain:
        base = [118, 112, 104];
        break;
      case T.Marsh:
        base = [104, 132, 96];
        break;
      case T.Road:
        base = [182, 156, 112];
        break;
      case T.Bridge:
        base = [132, 100, 64];
        break;
      case T.Plaza:
        base = [196, 182, 150];
        break;
      case T.Forest:
        base = r ? (this.grass[reg].map((c) => c * 0.7) as [number, number, number]) : [80, 120, 70];
        break;
      case T.Meadow:
        base = r ? (this.grass[reg].map((c, n) => c * (n === 1 ? 1.06 : 1.02)) as [number, number, number]) : [160, 185, 110];
        break;
      case T.Field:
        base = fieldColor(season, !!r?.flags.hambre);
        break;
      default:
        base = r ? this.grass[reg] : [143, 178, 106];
    }
    const greenish = t === T.Grass || t === T.Meadow || t === T.Forest;
    if (season === 'otoño' && greenish) base = [base[0] * 1.12, base[1] * 0.97, base[2] * 0.78];
    if (season === 'invierno' && greenish) base = [base[0] * 0.9 + 22, base[1] * 0.88 + 20, base[2] * 0.9 + 28];
    if (r && r.ecology < 0.42 && greenish) base = [base[0] * 1.05 + 12, base[1] * 0.9, base[2] * 0.86];
    return [base[0] * jitter, base[1] * jitter, base[2] * jitter];
  }

  private detail(g: CanvasRenderingContext2D, t: number, px: number, py: number, v: number, season: Season, base: [number, number, number], k: number, tx: number, ty: number, e: number, hungry: number): void {
    void tx;
    void ty;
    void e;
    const P = (x: number, y: number, c: string, w = 1, h = 1) => ((g.fillStyle = c), g.fillRect(px + x, py + y, w, h));
    switch (t) {
      case T.Grass:
      case T.Meadow: {
        // Matas de hierba en forma de «v» y, en primavera, florecillas.
        const dark = rgb(base, 0.74);
        const light = rgb(base, 1.12);
        for (let n = 0; n < (t === T.Meadow ? 3 : 2); n++) {
          const x = (v * (n * 5 + 3)) % 13;
          const y = (v * (n * 3 + 7)) % 12 + 2;
          P(x, y, dark);
          P(x + 2, y, dark);
          P(x + 1, y + 1, dark);
          P(x + 1, y - 1, light);
        }
        if ((season === 'primavera' || season === 'verano') && v % 7 === 0) {
          const fc = ['#f3e27a', '#f0b8cf', '#ffffff', '#b8a0e8'][v % 4];
          const x = (v * 3) % 13;
          const y = (v * 5) % 12 + 2;
          P(x, y, fc);
          P(x + 1, y + 1, rgb(base, 0.7));
        }
        if (season === 'otoño' && v % 5 === 0) P((v * 7) % 14, (v * 3) % 14, ['#d9733a', '#e8b03a', '#b8462a'][v % 3]);
        break;
      }
      case T.Forest:
        P(v % 12, (v >> 3) % 12, rgb(base, 0.7), 3, 1);
        P((v * 3) % 13, (v * 7) % 13, season === 'otoño' ? '#c9702a' : rgb(base, 1.15));
        break;
      case T.Field: {
        if (hungry) {
          P(v % 12, (v >> 2) % 12, '#7c8a4a', 2, 2);
          P((v * 5) % 12, (v * 3) % 12, '#9a8a5a');
        } else if (season === 'verano' || season === 'otoño') {
          const c1 = season === 'verano' ? '#e6c45a' : '#d2a24a';
          const c2 = season === 'verano' ? '#b8963a' : '#a87a32';
          for (let y = 1; y < TILE; y += 4)
            for (let x = 1; x < TILE; x += 3) {
              P(x, y, c1, 1, 2);
              P(x, y + 2, c2);
            }
        } else if (season === 'primavera') {
          for (let y = 1; y < TILE; y += 4)
            for (let x = 2; x < TILE; x += 4) {
              P(x, y, '#7fb24f');
              P(x + 1, y, '#5f923a');
            }
        }
        break;
      }
      case T.Bridge:
        P(0, 0, '#4a3420', TILE, 1);
        P(0, TILE - 1, '#4a3420', TILE, 1);
        break;
      case T.Road:
        if (v % 3 === 0) P(v % 13, (v >> 3) % 13, '#d8c49a', 2, 1), P(v % 13, ((v >> 3) % 13) + 1, '#8a6e48', 2, 1);
        break;
      case T.Sand:
        if (v % 9 === 0) P(v % 12, 6, '#f6efe0'), P((v % 12) + 1, 7, '#c8b080');
        break;
    }
    void k;
  }

  /** Objetos estáticos (árboles, rocas, montañas, juncos, mojones) de un fragmento. */
  objectsOf(cx: number, cy: number): StaticObject[] {
    const id = `${cx},${cy}`;
    const hit = this.objects.get(id);
    if (hit) return hit;
    const out: StaticObject[] = [];
    const { tiles, region, variant } = this.l.terrain;
    for (let j = 0; j < CHUNK; j++)
      for (let i = 0; i < CHUNK; i++) {
        const tx = cx * CHUNK + i;
        const ty = cy * CHUNK + j;
        if (!inside(tx, ty)) continue;
        const k = idx(tx, ty);
        if (this.l.blocked[k]) continue;
        const t = tiles[k];
        const v = variant[k];
        const reg = region[k];
        const ox = tx * TILE + 3 + (v % 10);
        const oy = ty * TILE + 4 + ((v >> 4) % 10);
        const p = v / 255;
        // Variedad: el tipo de árbol depende de la región y de lo que hay cerca.
        const nearWater = tiles[idx(Math.min(TW - 1, tx + 2), ty)] === T.River || tiles[idx(Math.max(0, tx - 2), ty)] === T.River || tiles[idx(tx, Math.min(TH - 1, ty + 2))] === T.River;
        const res = reg >= 0 ? this.w.regions[reg].resource : 'grano';
        const v2 = (v * 7) & 255;
        const kindOf = (): StaticObject['tree'] =>
          nearWater && v2 < 120 ? 'sauce' : res === 'hierro' || res === 'ambar' ? (v2 % 3 ? 'pino' : 'roble') : res === 'hierbas' ? (v2 % 4 === 0 ? 'abedul' : 'roble') : v2 % 6 === 0 ? 'abedul' : v2 % 9 === 0 ? 'pino' : 'roble';
        if (t === T.Forest && p < 0.24) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg, tree: kindOf() });
        else if ((t === T.Grass || t === T.Meadow) && p < 0.018) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg, tree: this.nearVillage(tx, ty) ? 'frutal' : kindOf() });
        else if ((t === T.Grass || t === T.Meadow) && p > 0.965) out.push({ x: ox, y: oy, kind: 'arbusto', v, region: reg });
        else if ((t === T.Grass || t === T.Meadow) && p > 0.9) out.push({ x: ox, y: oy, kind: v % 3 ? 'hierba' : 'flores', v, region: reg });
        else if (t === T.Forest && p > 0.9) out.push({ x: ox, y: oy, kind: 'arbusto', v, region: reg });
        else if (t === T.Rock && p < 0.08) out.push({ x: ox, y: oy, kind: 'roca', v, region: reg });
        else if (t === T.Mountain && (tx + (ty % 2) * 2) % 4 === 0 && ty % 3 === 0 && v > 70) out.push({ x: tx * TILE + (v % 32) - 8, y: ty * TILE + 4 + ((v >> 3) % 16), kind: 'pico', v: (v * 13) >> 2, region: reg });
        else if (t === T.Marsh && p < 0.22) out.push({ x: ox, y: oy, kind: 'junco', v, region: reg });
        // Mojones en las fronteras (sin líneas: piedras viejas que marcan el límite).
        if (reg >= 0 && v < 30 && (t === T.Grass || t === T.Meadow)) {
          const right = tx + 1 < TW ? region[idx(tx + 1, ty)] : reg;
          const down = ty + 1 < TH ? region[idx(tx, ty + 1)] : reg;
          if ((right >= 0 && right !== reg) || (down >= 0 && down !== reg)) out.push({ x: tx * TILE + 8, y: ty * TILE + 12, kind: 'mojon', v, region: reg });
        }
      }
    out.sort((a, b) => a.y - b.y);
    this.objects.set(id, out);
    if (this.objects.size > 80) this.objects.delete(this.objects.keys().next().value!);
    return out;
  }
}

function fieldColor(season: Season, hungry: boolean): [number, number, number] {
  if (hungry) return [150, 118, 82];
  switch (season) {
    case 'primavera':
      return [128, 98, 66];
    case 'verano':
      return [190, 160, 84];
    case 'otoño':
      return [172, 128, 70];
    default:
      return [150, 128, 104];
  }
}
