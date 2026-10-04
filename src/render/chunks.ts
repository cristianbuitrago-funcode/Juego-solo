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
      const shift = ((hue % 60) - 30) * 0.25;
      return hsl(88 + shift, 34 + (r.ecology - 0.6) * 20, 55);
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
   * Pinta un fragmento: el color de cada tesela se mezcla con el de sus
   * vecinas (sin cuadrícula visible), con ruido fino y relieve según la
   * elevación (la luz viene del noroeste). Después se añaden detalles.
   */
  private paint(canvas: HTMLCanvasElement, cx: number, cy: number, season: Season): void {
    const g = canvas.getContext('2d')!;
    const { tiles, region, variant, elev } = this.l.terrain;
    const N = CHUNK + 2;
    const col = new Float32Array(N * N * 3);
    const tx0 = cx * CHUNK - 1;
    const ty0 = cy * CHUNK - 1;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const tx = Math.max(0, Math.min(TW - 1, tx0 + i));
        const ty = Math.max(0, Math.min(TH - 1, ty0 + j));
        const c = this.tileColor(tx, ty, season);
        // Relieve: sombreado por la pendiente.
        const k = idx(tx, ty);
        const t = tiles[k];
        let lit = 1;
        if (t !== T.Deep && t !== T.Sea && t !== T.River) {
          const ex = elev[idx(Math.max(0, tx - 1), ty)] - elev[idx(Math.min(TW - 1, tx + 1), ty)];
          const ey = elev[idx(tx, Math.max(0, ty - 1))] - elev[idx(tx, Math.min(TH - 1, ty + 1))];
          lit = 1 + Math.max(-0.16, Math.min(0.16, (ex + ey) * (t === T.Mountain || t === T.Rock ? 0.022 : 0.012)));
        }
        const o = (j * N + i) * 3;
        col[o] = c[0] * lit;
        col[o + 1] = c[1] * lit;
        col[o + 2] = c[2] * lit;
        void region;
        void variant;
      }
    const img = g.createImageData(CPX, CPX);
    const d = img.data;
    const sm = (t: number) => {
      const u = Math.max(0, Math.min(1, (t - 0.2) / 0.6));
      return u * u * (3 - 2 * u);
    };
    for (let py = 0; py < CPX; py++) {
      const fy = py / TILE + 0.5;
      const j = Math.floor(fy);
      const vy = sm(fy - j);
      for (let px = 0; px < CPX; px++) {
        const fx = px / TILE + 0.5;
        const i = Math.floor(fx);
        const vx = sm(fx - i);
        const o00 = (j * N + i) * 3;
        const o10 = o00 + 3;
        const o01 = o00 + N * 3;
        const o11 = o01 + 3;
        const n = NOISE[((py & 63) << 6) | (px & 63)] - 8;
        const q = (py * CPX + px) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = col[o00 + ch] + (col[o10 + ch] - col[o00 + ch]) * vx;
          const bot = col[o01 + ch] + (col[o11 + ch] - col[o01 + ch]) * vx;
          d[q + ch] = top + (bot - top) * vy + n;
        }
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
    const { tiles, region, variant } = this.l.terrain;
    const k = idx(tx, ty);
    const t = tiles[k];
    const reg = region[k];
    const r = reg >= 0 ? this.w.regions[reg] : undefined;
    const jitter = 0.95 + (variant[k] & 15) / 160;
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
    const tiles = this.l.terrain.tiles;
    const water = (x: number, y: number) => {
      if (!inside(x, y)) return true;
      const tt = tiles[idx(x, y)];
      return tt === T.Sea || tt === T.Deep || tt === T.River;
    };
    switch (t) {
      case T.Grass:
      case T.Meadow:
        g.fillStyle = rgb(base, 0.82);
        for (let n = 0; n < 3; n++) g.fillRect(px + ((v * (n + 3)) % 14), py + ((v * (n + 7)) % 13), 1, 3);
        if (season === 'primavera' && v % 9 === 0) for (let n = 0; n < 3; n++) (g.fillStyle = ['#f3e27a', '#f0b8cf', '#ffffff'][n]), g.fillRect(px + ((v + n * 5) % 13), py + ((v * 3 + n * 4) % 13), 2, 2);
        break;
      case T.Forest:
        g.fillStyle = rgb(base, 0.8);
        g.fillRect(px + (v % 10), py + ((v >> 3) % 10), 4, 3);
        break;
      case T.Field: {
        // Surcos. Abandonados: malas hierbas y tierra seca.
        g.fillStyle = rgb(base, 0.78);
        for (let y = 2; y < TILE; y += 4) g.fillRect(px, py + y, TILE, 1.4);
        if (hungry) (g.fillStyle = '#7c8a4a'), g.fillRect(px + (v % 12), py + ((v >> 2) % 12), 3, 2);
        else if (season === 'verano' || season === 'otoño') {
          g.fillStyle = season === 'verano' ? '#e6c45a' : '#d2a24a';
          for (let y = 1; y < TILE; y += 4) for (let x = 1; x < TILE; x += 3) g.fillRect(px + x, py + y, 1.4, 2.2);
        } else if (season === 'primavera') {
          g.fillStyle = '#7fb24f';
          for (let y = 1; y < TILE; y += 4) for (let x = 2; x < TILE; x += 4) g.fillRect(px + x, py + y, 1.6, 1.6);
        }
        break;
      }
      case T.Sea:
      case T.Deep:
      case T.River: {
        g.fillStyle = 'rgba(255,255,255,0.08)';
        if (v % 5 === 0) g.fillRect(px + (v % 10), py + ((v >> 4) % 12), 6, 1);
        // Orilla: espuma clara junto a tierra.
        g.fillStyle = t === T.River ? 'rgba(220,235,240,0.35)' : 'rgba(235,240,230,0.45)';
        // Espuma suave donde el agua toca tierra.
        if (!water(tx, ty - 1)) (g.beginPath(), g.ellipse(px + 8, py + 1, 9, 2.2, 0, 0, Math.PI * 2), g.fill());
        if (!water(tx, ty + 1)) (g.beginPath(), g.ellipse(px + 8, py + TILE - 1, 9, 2.2, 0, 0, Math.PI * 2), g.fill());
        if (!water(tx - 1, ty)) (g.beginPath(), g.ellipse(px + 1, py + 8, 2.2, 9, 0, 0, Math.PI * 2), g.fill());
        if (!water(tx + 1, ty)) (g.beginPath(), g.ellipse(px + TILE - 1, py + 8, 2.2, 9, 0, 0, Math.PI * 2), g.fill());
        break;
      }
      case T.Road: {
        g.fillStyle = 'rgba(120,95,60,0.25)';
        g.fillRect(px + (v % 12), py + ((v >> 3) % 12), 3, 2);
        break;
      }
      case T.Bridge: {
        g.fillStyle = '#6b4e30';
        for (let x = 0; x < TILE; x += 4) g.fillRect(px + x, py, 1, TILE);
        g.fillStyle = '#4a3420';
        g.fillRect(px, py, TILE, 1.5);
        g.fillRect(px, py + TILE - 1.5, TILE, 1.5);
        break;
      }
      case T.Plaza: {
        g.strokeStyle = 'rgba(120,100,70,0.3)';
        g.lineWidth = 0.8;
        g.strokeRect(px + 0.5, py + 0.5, 7.5, 7.5);
        g.strokeRect(px + 8.5, py + 8.5, 7, 7);
        break;
      }
      case T.Mountain:
      case T.Rock: {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(px + (v % 9), py + ((v >> 2) % 9), 5, 2);
        if (t === T.Mountain && e > 200) (g.fillStyle = 'rgba(240,244,248,0.55)'), g.beginPath(), g.ellipse(px + 8, py + 8, 10, 8, 0, 0, Math.PI * 2), g.fill();
        break;
      }
      case T.Marsh:
        g.fillStyle = 'rgba(70,110,120,0.55)';
        if (v % 3 === 0) g.fillRect(px + (v % 8), py + ((v >> 3) % 8), 7, 4);
        break;
      case T.Salt:
        g.strokeStyle = 'rgba(160,150,130,0.4)';
        g.lineWidth = 0.6;
        g.strokeRect(px + 1, py + 1, 14, 14);
        break;
      case T.Sand:
        if (v % 11 === 0) (g.fillStyle = '#f6efe0'), g.fillRect(px + (v % 12), py + 6, 2, 2);
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
        if (t === T.Forest && p < 0.34) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg, tree: kindOf() });
        else if ((t === T.Grass || t === T.Meadow) && p < 0.018) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg, tree: this.nearVillage(tx, ty) ? 'frutal' : kindOf() });
        else if ((t === T.Grass || t === T.Meadow) && p > 0.965) out.push({ x: ox, y: oy, kind: 'arbusto', v, region: reg });
        else if ((t === T.Grass || t === T.Meadow) && p > 0.9) out.push({ x: ox, y: oy, kind: v % 3 ? 'hierba' : 'flores', v, region: reg });
        else if (t === T.Forest && p > 0.9) out.push({ x: ox, y: oy, kind: 'arbusto', v, region: reg });
        else if (t === T.Rock && p < 0.08) out.push({ x: ox, y: oy, kind: 'roca', v, region: reg });
        else if (t === T.Mountain && tx % 5 === 0 && ty % 4 === (tx % 10 === 0 ? 0 : 2)) out.push({ x: tx * TILE + 8, y: ty * TILE + 16, kind: 'pico', v, region: reg });
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
