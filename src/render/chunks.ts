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
const CPX = CHUNK * TILE;

export interface StaticObject {
  x: number; // píxeles de mundo (pies)
  y: number;
  kind: 'arbol' | 'roca' | 'pico' | 'junco' | 'arbusto' | 'mojon';
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

  private paint(canvas: HTMLCanvasElement, cx: number, cy: number, season: Season): void {
    const g = canvas.getContext('2d')!;
    const { tiles, region, variant, elev } = this.l.terrain;
    const w = this.w;
    const autumn = season === 'otoño';
    const winter = season === 'invierno';
    for (let j = 0; j < CHUNK; j++)
      for (let i = 0; i < CHUNK; i++) {
        const tx = cx * CHUNK + i;
        const ty = cy * CHUNK + j;
        const px = i * TILE;
        const py = j * TILE;
        if (!inside(tx, ty)) {
          g.fillStyle = '#2f5468';
          g.fillRect(px, py, TILE, TILE);
          continue;
        }
        const k = idx(tx, ty);
        const t = tiles[k];
        const v = variant[k];
        const reg = region[k];
        const r = reg >= 0 ? w.regions[reg] : undefined;
        const jitter = 0.94 + (v & 15) / 120;
        let base: [number, number, number];
        switch (t) {
          case T.Deep:
            base = [47, 84, 104];
            break;
          case T.Sea:
            base = [63, 111, 134];
            break;
          case T.River:
            base = [78, 134, 160];
            break;
          case T.Sand:
            base = [227, 211, 161];
            break;
          case T.Salt:
            base = [233, 230, 220];
            break;
          case T.Clay:
            base = [185, 119, 78];
            break;
          case T.Rock:
            base = [156, 150, 138];
            break;
          case T.Mountain:
            base = [125, 119, 111];
            break;
          case T.Marsh:
            base = [111, 138, 98];
            break;
          case T.Road:
            base = [196, 169, 121];
            break;
          case T.Bridge:
            base = [138, 106, 68];
            break;
          case T.Plaza:
            base = [205, 189, 152];
            break;
          case T.Forest:
            base = r ? (this.grass[reg].map((c) => c * 0.72) as [number, number, number]) : [80, 120, 70];
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
        if (autumn && (t === T.Grass || t === T.Meadow || t === T.Forest)) base = [base[0] * 1.12, base[1] * 0.98, base[2] * 0.8];
        if (winter && (t === T.Grass || t === T.Meadow || t === T.Forest)) base = [base[0] * 0.92 + 20, base[1] * 0.9 + 18, base[2] * 0.9 + 26];
        if (r && r.ecology < 0.42 && (t === T.Grass || t === T.Meadow || t === T.Forest)) base = [base[0] * 1.05 + 12, base[1] * 0.92, base[2] * 0.88];
        g.fillStyle = rgb(base, jitter);
        g.fillRect(px, py, TILE, TILE);
        this.detail(g, t, px, py, v, season, base, k, tx, ty, elev[k], r?.flags.hambre ? 1 : 0);
      }
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
        if (!water(tx, ty - 1)) g.fillRect(px, py, TILE, 2);
        if (!water(tx, ty + 1)) g.fillRect(px, py + TILE - 2, TILE, 2);
        if (!water(tx - 1, ty)) g.fillRect(px, py, 2, TILE);
        if (!water(tx + 1, ty)) g.fillRect(px + TILE - 2, py, 2, TILE);
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
        if (t === T.Mountain && e > 200) (g.fillStyle = 'rgba(240,244,248,0.7)'), g.fillRect(px + 2, py + 2, 12, 12);
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
        if (t === T.Forest && p < 0.62) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg });
        else if ((t === T.Grass || t === T.Meadow) && p < 0.035) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg });
        else if ((t === T.Grass || t === T.Meadow) && p > 0.95) out.push({ x: ox, y: oy, kind: 'arbusto', v, region: reg });
        else if (t === T.Rock && p < 0.13) out.push({ x: ox, y: oy, kind: 'roca', v, region: reg });
        else if (t === T.Mountain && tx % 3 === 0 && ty % 2 === 0) out.push({ x: tx * TILE + 8, y: ty * TILE + 16, kind: 'pico', v, region: reg });
        else if (t === T.Marsh && p < 0.25) out.push({ x: ox, y: oy, kind: 'junco', v, region: reg });
        // Mojones en las fronteras (sin líneas: piedras viejas que marcan el límite).
        if (reg >= 0 && v < 30 && (t === T.Grass || t === T.Meadow)) {
          const right = tx + 1 < TW ? region[idx(tx + 1, ty)] : reg;
          const down = ty + 1 < TH ? region[idx(tx, ty + 1)] : reg;
          if ((right >= 0 && right !== reg) || (down >= 0 && down !== reg)) out.push({ x: tx * TILE + 8, y: ty * TILE + 12, kind: 'mojon', v, region: reg });
        }
      }
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
