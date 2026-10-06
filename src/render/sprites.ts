/**
 * Arte procedural del mundo: vegetación, edificios de cada cultura,
 * mobiliario urbano, campamentos y animales. Se dibuja una vez en lienzos y
 * se reutiliza (atlas en memoria). Escala de referencia: una persona adulta
 * mide 48 px; una puerta, ~40 px; una casa, ~95 px de alto; un roble, ~95 px;
 * un caballo es más grande que una persona.
 */
import { Painter, tone } from './pixel';
import { VQ } from '../visual/quality';

export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

const cache = new Map<string, Sprite>();
/** Al cambiar de nivel gráfico se repinta todo a la nueva resolución. */
export function clearSprites(): void {
  cache.clear();
}
const M = 2; // margen para el contorno

/**
 * Cada sprite se dibuja una vez a resolución 1:1 (un píxel de arte por
 * píxel de mundo) y se convierte en pixel art (`pixelize`): colores sólidos,
 * alfa todo o nada y contorno oscuro.
 */
function make(key: string, w: number, h: number, ax: number, ay: number, draw: (g: CanvasRenderingContext2D) => void, outline = true): Sprite {
  // Fase visual: se pinta a la resolución del nivel gráfico, con suavizado (sin pixelizar).
  const res = VQ().spriteRes;
  const k = `${key}@${res}`;
  const hit = cache.get(k);
  if (hit) return hit;
  void outline;
  const W = Math.ceil(w) + M * 2;
  const H = Math.ceil(h) + M * 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * res);
  c.height = Math.ceil(H * res);
  const g = c.getContext('2d')!;
  g.scale(res, res);
  g.translate(M, M);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  const s = { canvas: c, w: W, h: H, ax: ax + M, ay: ay + M };
  cache.set(k, s);
  return s;
}

/** Igual que `make`, pero dibuja el diseño original reducido por `k` (escala coherente con las personas). */
function makeK(key: string, w: number, h: number, ax: number, ay: number, k: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  return make(key, w * k, h * k, ax * k, ay * k, (g) => {
    g.scale(k, k);
    draw(g);
  });
}

export function drawSprite(g: CanvasRenderingContext2D, s: Sprite, x: number, y: number, alpha = 1): void {
  if (alpha !== 1) g.globalAlpha = alpha;
  g.drawImage(s.canvas, x - s.ax, y - s.ay, s.w, s.h);
  if (alpha !== 1) g.globalAlpha = 1;
}

let g0: CanvasRenderingContext2D;
const E = (x: number, y: number, rx: number, ry: number, fill: string, g = g0) => {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
  g.fill();
};
const R = (x: number, y: number, w: number, h: number, fill: string, g = g0) => {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
};
const Ln = (x1: number, y1: number, x2: number, y2: number, w: number, c: string, g = g0) => {
  g.strokeStyle = c;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
};
const poly = (pts: number[], fill: string, g = g0) => {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fill();
};

export function shade(c: string, k: number): string {
  let r: number;
  let gg: number;
  let b: number;
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    r = (n >> 16) & 255;
    gg = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = c.match(/\d+/g)!.map(Number);
    [r, gg, b] = m;
  }
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(gg)},${f(b)})`;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

// ---------------------------------------------------------------------------
// Vegetación
// ---------------------------------------------------------------------------
export type TreeKind = 'roble' | 'pino' | 'abedul' | 'muerto' | 'arbusto' | 'junco' | 'sauce' | 'frutal' | 'flores' | 'hierba';
export type SeasonLook = 'primavera' | 'verano' | 'otoño' | 'invierno';

const LEAF: Record<SeasonLook, [string, string, string]> = {
  primavera: ['#6aa24f', '#4d8640', '#9ccf72'],
  verano: ['#4f8c3c', '#3a6c2e', '#7fb45a'],
  otoño: ['#c9822f', '#9a5624', '#e7ad55'],
  invierno: ['#6d866a', '#53695a', '#e6eef2'],
};

function canopy(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, cols: [string, string, string], v: number, puffs = 7): void {
  // Copa en racimos: sombra abajo a la derecha, luz arriba a la izquierda.
  E(cx + r * 0.12, cy + r * 0.18, r * 1.02, r * 0.9, shade(cols[1], 0.85), g);
  for (let i = 0; i < puffs; i++) {
    const a = (i / puffs) * Math.PI * 2 + v;
    E(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.45, r * 0.52, r * 0.48, cols[1], g);
  }
  E(cx - r * 0.1, cy - r * 0.08, r * 0.78, r * 0.68, cols[0], g);
  for (let i = 0; i < 4; i++) E(cx - r * 0.35 + i * r * 0.18, cy - r * 0.42 + (i % 2) * r * 0.12, r * 0.28, r * 0.22, cols[2], g);
  // Textura de hojas en racimos (pixel art): grumos claros arriba a la
  // izquierda y oscuros abajo a la derecha, para que la copa no sea una mancha plana.
  const n = Math.round(r * 2.2);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + v;
    const d = Math.sqrt((i + 0.5) / n) * r * 0.86;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.86;
    const lightSide = x - cx + (y - cy) < -r * 0.15;
    const darkSide = x - cx + (y - cy) > r * 0.35;
    const cr = Math.max(1.6, r * 0.13);
    if (lightSide) {
      E(x, y + 0.6, cr, cr * 0.8, shade(cols[0], 0.82), g);
      E(x - 0.4, y - 0.3, cr * 0.8, cr * 0.62, cols[2], g);
    } else if (darkSide) {
      E(x, y, cr, cr * 0.8, shade(cols[1], 0.78), g);
      E(x - 0.5, y - 0.5, cr * 0.7, cr * 0.5, cols[1], g);
    } else if (i % 2) {
      E(x, y + 0.5, cr, cr * 0.75, cols[1], g);
      E(x - 0.3, y - 0.3, cr * 0.8, cr * 0.6, cols[0], g);
    }
  }
}

export function tree(kind: TreeKind, season: SeasonLook, v: number): Sprite {
  const vv = v % 3;
  const key = `t:${kind}:${season}:${vv}`;
  const cols = LEAF[season];
  const winter = season === 'invierno';
  switch (kind) {
    case 'pino':
      return makeK(key, 56, 104, 28, 100, 0.74, (g) => {
        g0 = g;
        E(30, 100, 18, 5, 'rgba(0,0,0,0.22)');
        R(25, 80, 6, 21, '#5b3d25');
        const green = winter ? '#3d5e50' : season === 'otoño' ? '#3e5d46' : '#2e5c3c';
        for (let i = 0; i < 5; i++) {
          const y = 8 + i * 15;
          const half = 9 + i * 4.2 + vv;
          poly([28, y - 10, 28 + half, y + 16, 28 - half, y + 16], shade(green, 0.9 + i * 0.03));
          poly([28, y - 10, 28 + half, y + 16, 28 + half * 0.15, y + 16], shade(green, 0.72));
          if (winter) poly([28, y - 10, 28 + half * 0.6, y + 3, 28 - half * 0.6, y + 3], '#eef4f6');
        }
      });
    case 'abedul':
      return makeK(key, 50, 92, 25, 88, 0.74, (g) => {
        g0 = g;
        E(26, 88, 14, 4, 'rgba(0,0,0,0.2)');
        R(23, 40, 5, 49, '#ede7da');
        for (let y = 44; y < 88; y += 6) R(23, y, 3, 1.4, '#3a3330');
        Ln(25, 52, 15, 38, 1.6, '#d8d2c4');
        Ln(26, 46, 36, 32, 1.6, '#d8d2c4');
        if (!winter) canopy(g, 25, 30, 20, cols, vv, 6);
        else for (const [x, y] of [[12, 22], [38, 24], [25, 10], [18, 14], [32, 12]]) Ln(25, 45, x, y, 1.2, '#7a6d60');
      });
    case 'sauce':
      return makeK(key, 84, 90, 42, 86, 0.74, (g) => {
        g0 = g;
        E(44, 86, 26, 6, 'rgba(0,0,0,0.22)');
        R(38, 50, 8, 37, '#5a4430');
        canopy(g, 42, 36, 30, cols, vv, 8);
        g.strokeStyle = shade(cols[1], 0.9);
        g.lineWidth = 1.4;
        for (let i = 0; i < 16; i++) {
          const x = 16 + i * 3.4;
          g.beginPath();
          g.moveTo(x, 34 + (i % 3) * 3);
          g.quadraticCurveTo(x - 2, 56, x + 1, 74 - (i % 4) * 3);
          g.stroke();
        }
      });
    case 'frutal':
      return makeK(key, 60, 74, 30, 70, 0.74, (g) => {
        g0 = g;
        E(31, 70, 18, 5, 'rgba(0,0,0,0.22)');
        R(27, 44, 6, 27, '#6b4a30');
        if (!winter) {
          canopy(g, 30, 30, 22, cols, vv, 7);
          const fruit = season === 'primavera' ? '#f4d6e2' : season === 'verano' ? '#c63a2a' : '#e0a030';
          for (let i = 0; i < 9; i++) E(14 + ((i * 13) % 32), 18 + ((i * 7) % 26), 2.2, 2.2, fruit);
        } else for (const [x, y] of [[10, 22], [50, 22], [30, 8]]) Ln(30, 48, x, y, 2, '#6b5a4a');
      });
    case 'muerto':
      return makeK(key, 64, 88, 32, 84, 0.74, (g) => {
        g0 = g;
        E(33, 84, 16, 4, 'rgba(0,0,0,0.2)');
        g.strokeStyle = '#5e5248';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(32, 84);
        g.lineTo(31, 34);
        g.stroke();
        g.lineWidth = 3;
        for (const [a, b, c, d] of [[31, 52, 14, 30], [31, 44, 50, 20], [31, 62, 46, 50], [31, 38, 24, 14], [14, 30, 8, 22]]) Ln(a, b, c, d, 3, '#5e5248');
      });
    case 'arbusto':
      return makeK(key, 34, 26, 17, 23, 0.8, (g) => {
        g0 = g;
        E(17, 23, 15, 4, 'rgba(0,0,0,0.2)');
        canopy(g, 17, 14, 11, cols, vv, 5);
        if (season === 'primavera' && vv) for (const [x, y] of [[10, 10], [22, 8], [17, 16]]) E(x, y, 1.6, 1.6, '#f3d9e4');
      });
    case 'junco':
      return makeK(key, 22, 28, 11, 26, 0.7, (g) => {
        g.strokeStyle = winter ? '#9a9478' : '#6f8a45';
        g.lineWidth = 1.5;
        for (let i = 0; i < 7; i++) {
          g.beginPath();
          g.moveTo(5 + i * 2, 26);
          g.quadraticCurveTo(3 + i * 2.6, 14, 2 + i * 3, 3 + (i % 3) * 3);
          g.stroke();
        }
        g0 = g;
        R(9, 3, 2.4, 6, '#6b4a2a');
        R(15, 6, 2.4, 6, '#6b4a2a');
      });
    case 'flores':
      return make(key, 26, 14, 13, 12, (g) => {
        g0 = g;
        const cs = ['#f3e27a', '#f0b8cf', '#ffffff', '#c86ad0', '#f08a4a'];
        for (let i = 0; i < 9; i++) {
          const x = 3 + ((i * 7) % 20);
          const y = 3 + ((i * 5) % 8);
          Ln(x, y + 3, x, y + 7, 0.8, '#5a8a3a');
          E(x, y + 2, 2, 2, cs[(i + vv) % cs.length]);
        }
      });
    case 'hierba':
    default:
      return make(key, 20, 14, 10, 12, (g) => {
        g.strokeStyle = winter ? '#a8a890' : season === 'otoño' ? '#b8a050' : '#5f9a42';
        g.lineWidth = 1.2;
        for (let i = 0; i < 8; i++) {
          g.beginPath();
          g.moveTo(4 + i * 1.6, 12);
          g.lineTo(2 + i * 2.2, 2 + (i % 3) * 2);
          g.stroke();
        }
      });
    case 'roble':
      return makeK(key, 80, 100, 40, 96, 0.74, (g) => {
        g0 = g;
        E(43, 96, 26, 7, 'rgba(0,0,0,0.24)');
        // Tronco con raíces.
        poly([33, 97, 47, 97, 44, 54, 36, 54], '#5b3d25');
        poly([40, 97, 47, 97, 44, 54, 41, 54], '#4a301c');
        Ln(36, 60, 24, 46, 4, '#5b3d25');
        Ln(44, 58, 56, 44, 4, '#5b3d25');
        if (winter) {
          for (const [x, y] of [[14, 30], [66, 28], [40, 8], [26, 16], [54, 14]]) Ln(40, 56, x, y, 2.4, '#5b4a3c');
          E(40, 30, 28, 16, 'rgba(240,244,248,0.4)');
          return;
        }
        canopy(g, 40, 38, 32, cols, vv, 8);
        if (season === 'otoño') for (let i = 0; i < 5; i++) E(14 + i * 12, 90 + (i % 2) * 3, 3, 1.4, '#c9822f');
      });
  }
}

export function rock(v: number, snow = false): Sprite {
  return make(`r:${v % 4}:${snow}`, 36, 26, 18, 23, (g) => {
    g0 = g;
    E(18, 23, 16, 4, 'rgba(0,0,0,0.22)');
    const base = ['#8d8a83', '#7c786f', '#9a958a', '#87827a'][v % 4];
    poly([3, 22, 6, 11, 14, 4, 26, 6, 33, 14, 34, 22], base);
    poly([18, 22, 26, 6, 33, 14, 34, 22], shade(base, 0.8));
    poly([6, 11, 14, 4, 18, 9, 10, 14], 'rgba(255,255,255,0.2)');
    Ln(14, 13, 20, 18, 0.8, 'rgba(0,0,0,0.25)');
    if (v % 2) E(8, 20, 4, 2, '#6f8a45');
    if (snow) E(18, 8, 10, 3.4, '#f4f7f9');
  });
}

/**
 * Montaña en pixel art, generada píxel a píxel: silueta con una o dos
 * cumbres, cara iluminada (noroeste) y cara en sombra violácea, estratos y
 * grietas, nieve con borde dentado y pinos diminutos al pie. Seis
 * variantes de tamaño y forma para que la cordillera no se repita.
 */
export function peak(v: number, snowy = true): Sprite {
  const vv = v % 6;
  const key = `pk2:${vv}:${snowy}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let seed = 977 * (vv + 1);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const W = [96, 80, 110, 72, 88, 104][vv];
  const Hh = [78, 64, 92, 56, 70, 84][vv];
  const P = new Painter(W + 6, Hh + 8, Math.round(W / 2) + 3, Hh + 4);
  const half = W / 2;
  // Cumbres: una principal y, a veces, una secundaria.
  const peaks: [number, number][] = [[(rnd() - 0.5) * W * 0.22, Hh]];
  if (vv % 2 === 0) peaks.push([(rnd() > 0.5 ? 1 : -1) * W * (0.22 + rnd() * 0.12), Hh * (0.55 + rnd() * 0.15)]);
  const noise: number[] = [];
  for (let x = 0; x <= W; x++) noise.push((rnd() - 0.5) * 2.2);
  const heightAt = (x: number): number => {
    let h = 0;
    for (const [px, ph] of peaks) {
      const d = Math.abs(x - px) / half;
      h = Math.max(h, ph * Math.max(0, 1 - d * (1.05 + (x < px ? 0 : 0.08))));
    }
    return h + noise[Math.round(x + half)] * (h > 6 ? 1 : 0);
  };
  const [mx] = peaks[0];
  const rock = { lit: '#a29d93', mid: '#858077', dark: '#635f68', deep: '#4c4855' };
  const snowL = '#f4f7fb';
  const snowS = '#c4cde0';
  const snowLine = Hh * (0.6 - (vv % 3) * 0.05);
  P.shadow(0, -1, half * 0.95, 4, 0.25);
  for (let x = Math.ceil(-half); x <= Math.floor(half); x++) {
    const h = Math.round(heightAt(x));
    if (h <= 0) continue;
    for (let y = 0; y < h; y++) {
      const yy = -1 - y; // fila (hacia arriba)
      // La arista baja de la cumbre en diagonal: a su izquierda, la cara iluminada.
      const ridge = mx + (y - Hh) * -0.18 + noise[Math.round(x + half)] * 0.6;
      const lit = x < ridge;
      let c = lit ? rock.lit : rock.dark;
      const band = (y + Math.round(noise[(Math.round(x + half) * 7) % noise.length] * 2)) % 9;
      if (band === 0) c = lit ? rock.mid : rock.deep;
      else if (band === 1 && lit) c = tone(rock.lit, 1.06);
      if (lit && x > ridge - 3) c = rock.mid; // canto junto a la arista
      // Grietas en diagonal.
      if (((x * 3 + y * 5 + vv * 11) % 37 === 0 || (x * 5 - y * 3 + vv) % 41 === 0) && y < h - 2) c = lit ? rock.mid : rock.deep;
      // Nieve: por encima de la línea, con borde dentado; se acumula en los salientes.
      const jag = Math.round(noise[(Math.round(x + half) * 3) % noise.length] * 2.5 + Math.sin(x * 0.7) * 1.5);
      if (snowy && y > snowLine + jag) c = lit ? snowL : snowS;
      else if (snowy && y > snowLine + jag - 2 && (x + y) % 3 === 0) c = lit ? '#dfe5ee' : '#a8b0c4';
      // Pie de la montaña: canchal y algo de hierba.
      if (y < 3 && (x * 7 + y) % 5 === 0) c = y === 0 ? '#6f8a4a' : rock.mid;
      P.px(x, yy, c);
    }
    // Filo superior iluminado.
    if (h > 3) P.px(x, -h, x < mx ? (snowy && h > snowLine ? '#ffffff' : '#b8b2a8') : rock.dark);
  }
  // Pinos diminutos al pie (dan escala).
  const pines = 2 + (vv % 3);
  for (let i = 0; i < pines; i++) {
    const px = Math.round((rnd() - 0.5) * W * 0.8);
    const base = -1 - Math.round(rnd() * 3);
    if (heightAt(px) < 10) continue;
    P.rect(px, base - 1, 1, 2, '#4a3220');
    for (let k = 0; k < 5; k++) P.rect(px - Math.floor((5 - k) / 2), base - 2 - k, ((5 - k) >> 1) * 2 + 1, 1, k % 2 ? '#2f5c3c' : '#3d6e48');
  }
  const canvas = P.toCanvas();
  const sp: Sprite = { canvas, w: canvas.width, h: canvas.height, ax: P.ax, ay: P.ay };
  cache.set(key, sp);
  return sp;
}

export function boundaryStone(): Sprite {
  return make('mojon', 14, 24, 7, 22, (g) => {
    g0 = g;
    E(7, 22, 6, 2, 'rgba(0,0,0,0.2)');
    g.fillStyle = '#b9b2a2';
    g.beginPath();
    g.roundRect(2, 4, 10, 18, [5, 5, 1, 1]);
    g.fill();
    R(2, 4, 10, 3, '#a39c8c');
    Ln(5, 10, 9, 10, 0.8, '#7a7466');
  });
}

// ---------------------------------------------------------------------------
// Arquitectura: cada cultura construye a su manera
// ---------------------------------------------------------------------------
export interface Style {
  wall: string;
  roof: string;
  trim: string;
  shape: 'dos-aguas' | 'plano' | 'redondo' | 'alto';
}

export function styleFor(cultureId: string, hue: number): Style {
  const styles: Record<string, Style> = {
    eco: { wall: '#e8d6b2', roof: '#9c5b34', trim: '#6b4428', shape: 'dos-aguas' },
    velmari: { wall: '#ece7da', roof: '#3f6f8f', trim: '#2c4b61', shape: 'alto' },
    orunde: { wall: '#cf9a6c', roof: '#8a4a2c', trim: '#5a2a1a', shape: 'plano' },
    saelith: { wall: '#dcd2ab', roof: '#8a7a3a', trim: '#4b5f33', shape: 'redondo' },
    kharu: { wall: '#a49e95', roof: '#4e4444', trim: '#3a3030', shape: 'alto' },
    imbra: { wall: '#f0dfb6', roof: '#b8743a', trim: '#7a5a20', shape: 'dos-aguas' },
    tovesh: { wall: '#ddd2e6', roof: '#6b4a8a', trim: '#4a3262', shape: 'alto' },
    marrow: { wall: '#d2c096', roof: '#8a7a40', trim: '#4f4526', shape: 'redondo' },
    quessa: { wall: '#efdcd8', roof: '#a84a5a', trim: '#6a2a44', shape: 'dos-aguas' },
    dunai: { wall: '#d8e2da', roof: '#3f7a6a', trim: '#2a5248', shape: 'plano' },
    yrth: { wall: '#b4bcc8', roof: '#3b4a6a', trim: '#26304a', shape: 'alto' },
  };
  return styles[cultureId] ?? { wall: '#ddd0b0', roof: hsl(hue, 35, 38), trim: '#4a3a2a', shape: 'dos-aguas' };
}

export type HouseState = 'normal' | 'quemada' | 'abandonada' | 'obra';

/** Ventanas de una casa (para encenderlas de noche), relativas al ancla. */
export function houseWindows(wTiles: number): { x: number; y: number; w: number; h: number }[] {
  const W = wTiles * 16;
  return [
    { x: -W / 2 + 10, y: -36, w: 12, h: 13 },
    { x: W / 2 - 22, y: -36, w: 12, h: 13 },
  ];
}

const WALL_H = 48;

function stoneBase(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g0 = g;
  R(x, y, w, h, '#8f877a');
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 0.7;
  for (let row = 0; row < h; row += 4) {
    Ln(x, y + row, x + w, y + row, 0.6, 'rgba(0,0,0,0.2)');
    for (let cx = x + (row % 8 ? 4 : 0); cx < x + w; cx += 8) Ln(cx, y + row, cx, y + row + 4, 0.6, 'rgba(0,0,0,0.2)');
  }
}

function windowAt(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, trim: string, state: HouseState, v: number): void {
  g0 = g;
  R(x - 1.5, y - 1.5, w + 3, h + 3, shade(trim, 0.85));
  if (state === 'abandonada') {
    R(x, y, w, h, '#2a2620');
    Ln(x - 1, y + 3, x + w + 1, y + 6, 2.2, '#7a6040');
    Ln(x - 1, y + h - 3, x + w + 1, y + h - 6, 2.2, '#7a6040');
    return;
  }
  R(x, y, w, h, state === 'quemada' ? '#151210' : '#3a4656');
  if (state === 'normal') {
    R(x + 1, y + 1, w / 2 - 1.5, h / 2 - 1.5, 'rgba(180,200,220,0.35)');
    Ln(x + w / 2, y, x + w / 2, y + h, 1, shade(trim, 0.8));
    Ln(x, y + h / 2, x + w, y + h / 2, 1, shade(trim, 0.8));
    // Contraventanas.
    R(x - 5, y - 1, 4, h + 2, trim);
    R(x + w + 1, y - 1, 4, h + 2, trim);
    R(x - 2, y + h + 1.5, w + 4, 2.5, shade(trim, 0.7));
    if (v % 2 === 0) for (let i = 0; i < 5; i++) E(x + 1 + i * (w / 4), y + h + 1, 1.7, 1.7, ['#d9473a', '#f3e27a', '#f0b8cf'][i % 3]);
  }
}

function doorAt(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, trim: string, state: HouseState): void {
  g0 = g;
  R(x - 2, y - 2, w + 4, h + 2, shade(trim, 0.8));
  g.fillStyle = state === 'quemada' ? '#151210' : state === 'abandonada' ? '#3a3026' : '#6b4a2e';
  g.beginPath();
  g.roundRect(x, y, w, h, [w / 2, w / 2, 0, 0]);
  g.fill();
  if (state === 'normal') {
    for (let k = x + 3; k < x + w; k += 3.5) Ln(k, y + 3, k, y + h, 0.6, 'rgba(0,0,0,0.25)');
    E(x + w - 3, y + h * 0.55, 1, 1, '#d9b860');
  }
  R(x - 3, y + h, w + 6, 2.5, '#9a9284');
}

/** Casa (3/4 de vista): muro con zócalo de piedra, entramado, ventanas, puerta y tejado. */
export function house(st: Style, state: HouseState, v: number, wTiles = 5): Sprite {
  const W = wTiles * 16;
  const H = 104;
  return make(`h:${st.wall}:${st.roof}:${st.shape}:${state}:${v % 3}:${wTiles}`, W + 16, H, W / 2 + 8, H - 4, (g) => {
    g0 = g;
    const x0 = 8;
    const base = H - 4;
    const wall = state === 'quemada' ? '#4f4640' : state === 'abandonada' ? shade(st.wall, 0.78) : st.wall;
    const roof = state === 'quemada' ? '#231e1a' : state === 'abandonada' ? shade(st.roof, 0.72) : st.roof;
    // Sombra proyectada.
    poly([x0 + 4, base, x0 + W + 8, base, x0 + W + 14, base - 8, x0 + W + 4, base - 8], 'rgba(0,0,0,0.22)');
    if (st.shape === 'redondo') {
      roundHut(g, x0, base, W, wall, roof, st, state, v);
      return;
    }
    const top = base - WALL_H;
    // Muro.
    R(x0, top, W, WALL_H, wall);
    g.fillStyle = 'rgba(0,0,0,0.1)';
    g.fillRect(x0 + W * 0.7, top, W * 0.3, WALL_H);
    stoneBase(g, x0, base - 8, W, 8);
    g0 = g;
    // Entramado de madera según la cultura.
    if (state !== 'quemada') {
      const t = st.trim;
      Ln(x0, top + 1, x0 + W, top + 1, 2.4, t);
      Ln(x0 + 1, top, x0 + 1, base - 8, 2.2, t);
      Ln(x0 + W - 1, top, x0 + W - 1, base - 8, 2.2, t);
      if (st.shape === 'dos-aguas') {
        Ln(x0, top + WALL_H / 2 - 4, x0 + W, top + WALL_H / 2 - 4, 1.6, t);
        Ln(x0 + W / 2 - 14, top, x0 + W / 2 - 4, top + WALL_H / 2 - 4, 1.4, t);
        Ln(x0 + W / 2 + 14, top, x0 + W / 2 + 4, top + WALL_H / 2 - 4, 1.4, t);
      } else if (st.shape === 'alto') {
        for (let k = x0 + 14; k < x0 + W - 6; k += 14) Ln(k, top, k, base - 8, 1.2, shade(t, 1.1));
      }
    }
    for (const wr of houseWindows(wTiles)) windowAt(g, x0 + W / 2 + wr.x, base + wr.y, wr.w, wr.h, st.trim, state, v);
    doorAt(g, x0 + W / 2 - 8, base - 38, 16, 30, st.trim, state);
    // Tejado.
    if (state === 'obra') {
      for (let k = 0; k <= W; k += 12) Ln(x0 + k, top, x0 + k + 2, top - 30, 2, '#8a6a44');
      Ln(x0 - 4, top - 6, x0 + W + 4, top - 6, 2.4, '#9a7a52');
      Ln(x0 - 4, top - 22, x0 + W + 4, top - 22, 2.4, '#9a7a52');
      R(x0 + W / 2 - 10, top - 12, 20, 3, '#c9a57a');
      return;
    }
    roofOf(g, x0, top, W, roof, st, state, v);
    if (state === 'abandonada') {
      E(x0 + 6, base - 2, 6, 3, '#6f8a45');
      E(x0 + W - 4, base - 1, 7, 3, '#7a9a4a');
    }
    if (state === 'quemada') {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x0 + W / 2, top + 10, W * 0.35, 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (state === 'normal' && v % 3 === 1) {
      // Leña junto a la casa.
      for (let i = 0; i < 4; i++) E(x0 + W - 6 + (i % 2) * 5, base - 3 - Math.floor(i / 2) * 4, 2.6, 2.2, '#8a6440');
    }
  });
}

function roofOf(g: CanvasRenderingContext2D, x0: number, top: number, W: number, roof: string, st: Style, state: HouseState, v: number): void {
  g0 = g;
  const tall = st.shape === 'alto' ? 46 : st.shape === 'plano' ? 14 : 38;
  if (st.shape === 'plano') {
    // Azotea con pretil y vigas que asoman.
    R(x0 - 3, top - tall, W + 6, tall, shade(roof, 1.05));
    R(x0 - 3, top - tall, W + 6, 3, shade(roof, 0.8));
    R(x0 + 4, top - tall + 4, W - 8, tall - 6, shade(roof, 1.18));
    for (let k = x0 + 6; k < x0 + W; k += 10) R(k, top - 1, 3, 4, '#6b4a2e');
    if (state === 'normal' && v % 2) for (let i = 0; i < 3; i++) E(x0 + 10 + i * 8, top - 6, 3, 2.4, '#b8774e');
    return;
  }
  const over = 6;
  poly([x0 - over, top + 2, x0 + W + over, top + 2, x0 + W - 6, top - tall, x0 + 6, top - tall], roof);
  // Hileras de tejas o pizarra.
  g.strokeStyle = shade(roof, 0.72);
  g.lineWidth = 0.9;
  for (let k = 1; k < 7; k++) {
    const y = top + 2 - (tall / 7) * k;
    const inset = (k / 7) * (over + 6);
    Ln(x0 - over + inset, y, x0 + W + over - inset, y, 0.9, shade(roof, 0.72));
    for (let xx = x0 - over + inset + (k % 2) * 4; xx < x0 + W + over - inset; xx += 8) Ln(xx, y, xx, y + tall / 7, 0.6, shade(roof, 0.8));
  }
  poly([x0 + W * 0.62, top + 2, x0 + W + over, top + 2, x0 + W - 6, top - tall, x0 + W * 0.62 - 4, top - tall], 'rgba(0,0,0,0.13)');
  Ln(x0 + 6, top - tall, x0 + W - 6, top - tall, 2.4, shade(roof, 0.65));
  Ln(x0 - over, top + 2, x0 + W + over, top + 2, 2, shade(roof, 0.6));
  // Chimenea.
  if (state !== 'quemada') {
    const cx = x0 + W - 22 - (v % 2) * 20;
    R(cx, top - tall - 8, 9, tall * 0.55, '#8f877a');
    R(cx - 1.5, top - tall - 10, 12, 3, '#7a7266');
  } else {
    poly([x0 + W * 0.3, top - tall * 0.2, x0 + W * 0.5, top - tall * 0.7, x0 + W * 0.65, top - tall * 0.1], '#0e0c0a');
    for (let k = 0; k < 4; k++) Ln(x0 + W * 0.32 + k * 7, top - tall * 0.2, x0 + W * 0.36 + k * 7, top - tall * 0.65, 1.6, '#3a2a1e');
  }
}

function roundHut(g: CanvasRenderingContext2D, x0: number, base: number, W: number, wall: string, roof: string, st: Style, state: HouseState, v: number): void {
  g0 = g;
  const cx = x0 + W / 2;
  const top = base - 40;
  g.fillStyle = wall;
  g.beginPath();
  g.moveTo(x0 + 2, top);
  g.lineTo(x0 + W - 2, top);
  g.lineTo(x0 + W - 2, base - 6);
  g.quadraticCurveTo(cx, base + 2, x0 + 2, base - 6);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(cx + W * 0.2, top, W * 0.3, 40);
  windowAt(g, x0 + 10, base - 32, 11, 11, st.trim, state, v);
  doorAt(g, cx - 8, base - 34, 16, 30, st.trim, state);
  if (state === 'obra') return;
  // Techo de paja cónico.
  g.fillStyle = roof;
  g.beginPath();
  g.moveTo(x0 - 6, top + 4);
  g.quadraticCurveTo(cx, top + 14, x0 + W + 6, top + 4);
  g.lineTo(cx + 4, top - 46);
  g.lineTo(cx - 4, top - 46);
  g.closePath();
  g.fill();
  g.strokeStyle = shade(roof, 0.75);
  g.lineWidth = 0.8;
  for (let k = -5; k <= 5; k++) Ln(cx + k * 0.8, top - 44, cx + k * (W / 10 + 1.4), top + 8 - Math.abs(k) * 0.6, 0.8, shade(roof, 0.75));
  for (let k = 1; k < 4; k++) {
    g.beginPath();
    g.moveTo(x0 - 6 + k * 9, top + 4 - k * 12);
    g.quadraticCurveTo(cx, top + 10 - k * 12, x0 + W + 6 - k * 9, top + 4 - k * 12);
    g.stroke();
  }
  if (state === 'quemada') E(cx, top - 10, 16, 12, 'rgba(10,8,6,0.7)');
}

/** Edificios principales del pueblo. */
export function keyBuilding(kind: string, st: Style, extra = ''): Sprite {
  const dims: Record<string, [number, number]> = { salon: [128, 140], almacen: [96, 116], posada: [96, 132], templo: [96, 140], forja: [80, 110], hogar: [80, 112], establo: [96, 92], granero: [80, 122] };
  const [W, H] = dims[kind] ?? [80, 104];
  return make(`k:${kind}:${st.roof}:${st.wall}:${st.shape}:${extra}`, W + 20, H, W / 2 + 10, H - 4, (g) => {
    g0 = g;
    const x0 = 10;
    const base = H - 4;
    poly([x0 + 4, base, x0 + W + 10, base, x0 + W + 18, base - 10, x0 + W + 6, base - 10], 'rgba(0,0,0,0.22)');
    switch (kind) {
      case 'salon': {
        const top = base - 62;
        R(x0, top, W, 62, st.wall);
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.fillRect(x0 + W * 0.72, top, W * 0.28, 62);
        stoneBase(g, x0, base - 12, W, 12);
        g0 = g;
        for (const cx of [x0 + 14, x0 + 44, x0 + W - 44, x0 + W - 14]) {
          R(cx - 4, top + 2, 8, 50, '#d8cfbc');
          R(cx - 6, top + 2, 12, 4, '#c0b6a2');
        }
        windowAt(g, x0 + 22, base - 48, 12, 16, st.trim, 'normal', 1);
        windowAt(g, x0 + W - 34, base - 48, 12, 16, st.trim, 'normal', 1);
        doorAt(g, x0 + W / 2 - 13, base - 46, 26, 34, st.trim, 'normal');
        // Escalinata.
        R(x0 + W / 2 - 22, base - 6, 44, 3, '#a8a090');
        R(x0 + W / 2 - 26, base - 3, 52, 3, '#9a9284');
        roofOf(g, x0, top, W, st.roof, { ...st, shape: 'dos-aguas' }, 'normal', 0);
        g0 = g;
        // Estandartes con el color de la región.
        for (const bx of [x0 + 30, x0 + W - 30]) {
          Ln(bx, top - 2, bx, top + 26, 1, '#5a3a22');
          poly([bx - 6, top, bx + 6, top, bx + 6, top + 22, bx, top + 18, bx - 6, top + 22], extra || '#a3362b');
        }
        break;
      }
      case 'almacen': {
        const top = base - 54;
        R(x0, top, W, 54, '#a8845a');
        for (let k = x0 + 6; k < x0 + W; k += 7) Ln(k, top, k, base, 1, 'rgba(0,0,0,0.18)');
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x0 + W * 0.7, top, W * 0.3, 54);
        // Portón grande.
        R(x0 + W / 2 - 18, base - 40, 36, 40, '#4a3420');
        Ln(x0 + W / 2 - 18, base - 40, x0 + W / 2 + 18, base, 2, '#6b4a2e');
        Ln(x0 + W / 2 + 18, base - 40, x0 + W / 2 - 18, base, 2, '#6b4a2e');
        R(x0 + W / 2 - 18, base - 42, 36, 3, '#6b4a2e');
        roofOf(g, x0, top, W, st.roof, { ...st, shape: 'dos-aguas' }, 'normal', 1);
        g0 = g;
        if (extra !== 'vacio') {
          for (const [sx, sy] of [[x0 - 4, base - 6], [x0 + 6, base - 4], [x0 + 1, base - 13], [x0 + W - 6, base - 5], [x0 + W + 3, base - 6], [x0 + W - 1, base - 13]]) {
            E(sx, sy, 6, 5, '#d9c08a');
            Ln(sx - 3, sy - 3, sx + 3, sy - 3, 0.8, '#a88a5a');
          }
        } else {
          R(x0 + 2, base - 8, 10, 8, '#7a5a3a');
          Ln(x0 + 2, base - 8, x0 + 12, base, 1, '#5a3a22');
        }
        break;
      }
      case 'posada': {
        const top = base - 72;
        R(x0, top, W, 72, st.wall);
        Ln(x0, top + 36, x0 + W, top + 36, 2.4, st.trim);
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.fillRect(x0 + W * 0.7, top, W * 0.3, 72);
        stoneBase(g, x0, base - 8, W, 8);
        g0 = g;
        for (const wx of [x0 + 12, x0 + W - 26]) {
          windowAt(g, wx, top + 12, 13, 14, st.trim, 'normal', 0);
          windowAt(g, wx, top + 46, 13, 14, st.trim, 'normal', 1);
        }
        doorAt(g, x0 + W / 2 - 9, base - 38, 18, 30, st.trim, 'normal');
        roofOf(g, x0, top, W, st.roof, { ...st, shape: st.shape === 'redondo' ? 'dos-aguas' : st.shape }, 'normal', 0);
        g0 = g;
        // Cartel con una jarra.
        Ln(x0 + W - 2, top + 30, x0 + W + 12, top + 30, 2, '#5b3d25');
        R(x0 + W + 3, top + 32, 14, 12, '#c9a05a');
        R(x0 + W + 6, top + 35, 6, 7, '#8a5a2a');
        for (const bx of [x0 - 4, x0 + 4]) {
          E(bx, base - 6, 5, 7, '#8a6440');
          Ln(bx - 5, base - 9, bx + 5, base - 9, 1, '#5a3a22');
        }
        break;
      }
      case 'templo': {
        const top = base - 60;
        R(x0 + 4, top, W - 8, 60, '#e2dacb');
        stoneBase(g, x0, base - 10, W, 10);
        g0 = g;
        for (let cx = x0 + 12; cx < x0 + W - 6; cx += 18) {
          R(cx - 3.5, top + 6, 7, 44, '#f0eadf');
          R(cx - 5, top + 4, 10, 3, '#cfc7b8');
          Ln(cx, top + 8, cx, top + 48, 0.8, 'rgba(0,0,0,0.12)');
        }
        doorAt(g, x0 + W / 2 - 10, base - 44, 20, 34, '#7a6a5a', 'normal');
        poly([x0 - 2, top + 4, x0 + W + 2, top + 4, x0 + W / 2, top - 18], '#cfc7b8');
        g.fillStyle = st.roof;
        g.beginPath();
        g.ellipse(x0 + W / 2, top - 16, W / 2 - 14, 28, 0, Math.PI, 0);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.beginPath();
        g.ellipse(x0 + W / 2 - 10, top - 26, 10, 12, 0, 0, Math.PI * 2);
        g.fill();
        R(x0 + W / 2 - 1.5, top - 60, 3, 18, '#e8c86a');
        E(x0 + W / 2, top - 62, 4, 4, '#e8c86a');
        break;
      }
      case 'forja': {
        const top = base - 46;
        R(x0, top, W, 46, '#8f877a');
        stoneBase(g, x0, top, W, 46);
        g0 = g;
        R(x0 + 14, base - 32, 40, 32, '#2a221c');
        E(x0 + 34, base - 10, 12, 7, '#e8743a');
        E(x0 + 34, base - 12, 7, 4, '#f6c45a');
        poly([x0 - 6, top + 4, x0 + W + 6, top + 4, x0 + W - 4, top - 26, x0 + 4, top - 26], shade(st.roof, 0.85));
        R(x0 + W - 22, top - 48, 14, 44, '#6f6860');
        R(x0 + W - 24, top - 50, 18, 4, '#5a544e');
        // Yunque fuera.
        poly([x0 + W - 14, base - 10, x0 + W + 6, base - 10, x0 + W + 2, base - 6, x0 + W - 10, base - 6], '#4a4c52');
        R(x0 + W - 6, base - 6, 5, 6, '#3a3c42');
        break;
      }
      case 'hogar': {
        const top = base - WALL_H;
        R(x0, top, W, WALL_H, '#efdcb6');
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.fillRect(x0 + W * 0.7, top, W * 0.3, WALL_H);
        stoneBase(g, x0, base - 8, W, 8);
        g0 = g;
        Ln(x0, top + 1, x0 + W, top + 1, 2.4, '#7a4a28');
        for (const wr of houseWindows(5)) windowAt(g, x0 + W / 2 + wr.x, base + wr.y, wr.w, wr.h, '#2f5f63', 'normal', 0);
        doorAt(g, x0 + W / 2 - 8, base - 38, 16, 30, '#2f5f63', 'normal');
        roofOf(g, x0, top, W, '#9c5b34', { wall: '#efdcb6', roof: '#9c5b34', trim: '#7a4a28', shape: 'dos-aguas' }, 'normal', 1);
        g0 = g;
        E(x0 + W / 2, top - 10, 5, 5, '#e9b44c');
        // Huerto con valla.
        for (let k = 0; k < 7; k++) R(x0 - 8 + k * 4, base - 10, 1.6, 10, '#9a7a52');
        Ln(x0 - 8, base - 7, x0 + 18, base - 7, 1, '#9a7a52');
        for (let k = 0; k < 4; k++) E(x0 - 4 + k * 6, base - 3, 2.6, 2, '#6aa24f');
        break;
      }
      case 'establo': {
        const top = base - 40;
        R(x0, top, W, 40, '#8a6440');
        for (let k = x0 + 5; k < x0 + W; k += 6) Ln(k, top, k, base, 1, 'rgba(0,0,0,0.2)');
        for (let i = 0; i < 3; i++) {
          const sx = x0 + 10 + i * 28;
          R(sx, base - 26, 20, 26, '#3a2a1c');
          R(sx, base - 14, 20, 3, '#6b4a2e');
          // Cabeza de caballo asomando.
          E(sx + 10, base - 22, 4, 6, ['#6b4a30', '#3a2a20', '#c9b08a'][i]);
        }
        poly([x0 - 6, top + 3, x0 + W + 6, top + 3, x0 + W - 6, top - 24, x0 + 6, top - 24], shade(st.roof, 0.9));
        break;
      }
      case 'granero': {
        const top = base - 60;
        R(x0, top, W, 60, '#9a4a36');
        for (let k = x0 + 5; k < x0 + W; k += 6) Ln(k, top, k, base, 1, 'rgba(0,0,0,0.18)');
        R(x0 + W / 2 - 14, base - 36, 28, 36, '#5a2a1e');
        Ln(x0 + W / 2 - 14, base - 36, x0 + W / 2 + 14, base, 2, '#e8dcc0');
        Ln(x0 + W / 2 + 14, base - 36, x0 + W / 2 - 14, base, 2, '#e8dcc0');
        R(x0 + W / 2 - 8, top + 8, 16, 12, '#3a1a14');
        E(x0 + W / 2, top + 16, 6, 3, '#e3c56a');
        poly([x0 - 6, top + 3, x0 + W + 6, top + 3, x0 + W / 2, top - 34], '#5a4a40');
        for (const hx of [x0 - 6, x0 + W + 4]) E(hx, base - 8, 9, 8, '#e3c56a');
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Mercado, campamentos, fronteras
// ---------------------------------------------------------------------------
export function stall(full: boolean, color: string, v = 0, goods?: string[]): Sprite {
  return makeK(`st:${full}:${color}:${v % 3}:${goods?.join(',') ?? ''}`, 46, 46, 23, 43, 0.8, (g) => {
    g0 = g;
    E(23, 43, 20, 4, 'rgba(0,0,0,0.22)');
    R(4, 14, 3, 29, '#7a5532');
    R(39, 14, 3, 29, '#7a5532');
    R(2, 28, 42, 12, '#9a7048');
    R(2, 28, 42, 2.5, '#b08458');
    // Toldo a rayas.
    for (let i = 0; i < 6; i++) poly([i * 7.7, 16, i * 7.7 + 7.7, 16, i * 7.7 + 6.5, 4, i * 7.7 + 1.2, 4], i % 2 ? color : '#f0e8d8');
    for (let i = 0; i < 6; i++) E(i * 7.7 + 3.8, 16, 3.8, 2.2, i % 2 ? shade(color, 0.85) : '#e0d8c8');
    if (full) {
      // Lo que se vende de verdad (o, si no se sabe, un surtido).
      const shown = goods?.length ? goods : [['#d9a441', '#c06a2a', '#e0c070'], ['#a8c25a', '#6a9a3a', '#d9473a'], ['#c0503a', '#8a4a8a', '#e8d8a0']][v % 3];
      const n = goods ? Math.min(6, goods.length * 2) : 6;
      for (let i = 0; i < n; i++) E(7 + i * 6.4, 26.5, 3.4, 2.8, shown[i % shown.length]);
      if (!goods || goods.length > 2) R(30, 18, 10, 9, '#a07a3e');
    } else {
      R(8, 22, 10, 6, '#6a4a2a');
      R(26, 23, 8, 5, '#5a3a22');
    }
  });
}

export function tent(color: string): Sprite {
  return make(`tn:${color}`, 56, 46, 28, 43, (g) => {
    g0 = g;
    E(28, 43, 26, 5, 'rgba(0,0,0,0.25)');
    poly([2, 42, 28, 4, 54, 42], color);
    poly([28, 4, 54, 42, 34, 42], shade(color, 0.78));
    poly([22, 42, 28, 18, 34, 42], 'rgba(0,0,0,0.4)');
    Ln(28, 4, 28, -2, 1.4, '#5b3d25');
    Ln(2, 42, -4, 44, 0.8, '#8a7a5a');
    Ln(54, 42, 60, 44, 0.8, '#8a7a5a');
  });
}

export function post(color: string, closed: boolean): Sprite {
  return make(`po:${color}:${closed}`, 96, 92, 34, 86, (g) => {
    g0 = g;
    E(34, 86, 30, 5, 'rgba(0,0,0,0.2)');
    // Garita.
    R(4, 40, 28, 46, '#9a7a52');
    for (let k = 6; k < 32; k += 5) Ln(k, 40, k, 86, 0.8, 'rgba(0,0,0,0.2)');
    R(12, 52, 12, 10, '#3a2a1a');
    poly([0, 42, 18, 24, 36, 42], '#6b4a2e');
    // Mástil y bandera.
    R(58, 6, 3, 80, '#5b3d25');
    poly([61, 8, 82, 13, 61, 22], color);
    poly([61, 8, 82, 13, 61, 13], shade(color, 1.2));
    // Barrera sobre el camino.
    R(36, 66, 4, 20, '#7a5532');
    if (closed) {
      R(38, 66, 56, 4, '#a3362b');
      for (let k = 44; k < 94; k += 10) R(k, 66, 5, 4, '#f0e8d8');
    } else {
      g.save();
      g.translate(38, 68);
      g.rotate(-1.1);
      R(0, -2, 50, 4, '#c9b48a');
      g.restore();
    }
  });
}

export function barricade(): Sprite {
  return make('barricada', 70, 38, 35, 35, (g) => {
    g0 = g;
    E(35, 35, 32, 4, 'rgba(0,0,0,0.25)');
    for (let i = 0; i < 6; i++) Ln(5 + i * 12, 34, 13 + i * 12, 6, 4, '#5b3d25');
    Ln(1, 22, 69, 22, 3, '#7a5532');
    Ln(1, 28, 69, 28, 3, '#6b4a2e');
    for (let i = 0; i < 3; i++) E(10 + i * 24, 32, 6, 4, '#9a8a6a');
  });
}

export function placeSprite(kind: string): Sprite {
  return make(`pl:${kind}`, 96, 84, 48, 78, (g) => {
    g0 = g;
    E(48, 78, 40, 6, 'rgba(0,0,0,0.22)');
    switch (kind) {
      case 'cueva':
      case 'mina':
        poly([4, 78, 16, 30, 40, 10, 66, 14, 84, 36, 92, 78], '#7c776e');
        poly([48, 78, 66, 14, 84, 36, 92, 78], '#66615a');
        g.fillStyle = '#16120e';
        g.beginPath();
        g.ellipse(48, 78, 18, 26, 0, Math.PI, 0);
        g.fill();
        if (kind === 'mina') {
          R(28, 50, 5, 28, '#7a5532');
          R(63, 50, 5, 28, '#7a5532');
          R(26, 48, 44, 5, '#7a5532');
          poly([70, 76, 90, 76, 86, 66, 74, 66], '#5a4a3a');
        }
        break;
      case 'ruinas':
      case 'templo':
        for (const [x, h] of [[12, 44], [30, 60], [56, 30], [74, 52]]) {
          R(x, 76 - h, 10, h, '#bcb4a4');
          R(x - 2, 76 - h, 14, 4, '#a8a090');
          Ln(x + 3, 76 - h + 6, x + 3, 74, 0.8, 'rgba(0,0,0,0.15)');
        }
        R(6, 72, 84, 6, '#9a9284');
        if (kind === 'templo') poly([24, 18, 72, 18, 66, 10, 30, 10], '#a89e8a');
        E(44, 74, 6, 3, '#6f8a45');
        break;
      case 'circulo':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const x = 46 + Math.cos(a) * 34;
          const y = 52 + Math.sin(a) * 16;
          R(x, y - 18, 8, 22, '#a49c8c');
          R(x, y - 18, 8, 3, '#8c8474');
        }
        break;
      case 'campamento':
        poly([8, 74, 28, 34, 48, 74], '#8a7a5a');
        poly([28, 34, 48, 74, 34, 74], '#6a5a40');
        E(66, 72, 10, 4, '#3a2a1a');
        Ln(58, 70, 74, 74, 2, '#5a3a22');
        break;
      case 'abandonada':
        R(18, 40, 60, 36, '#8a7a64');
        poly([12, 42, 48, 14, 84, 42], '#5a4a3a');
        R(42, 22, 14, 10, '#1a1612');
        R(40, 54, 14, 22, '#2a2420');
        E(20, 74, 8, 3, '#6f8a45');
        break;
      case 'puesto':
        R(12, 44, 72, 30, '#9a7048');
        for (let i = 0; i < 8; i++) poly([8 + i * 10, 44, 18 + i * 10, 44, 16 + i * 10, 30, 10 + i * 10, 30], i % 2 ? '#b5562d' : '#f0e8d8');
        for (let i = 0; i < 5; i++) E(20 + i * 12, 50, 4, 3, ['#d9a441', '#a8c25a', '#c0503a'][i % 3]);
        break;
      case 'bosque':
        R(44, 24, 8, 54, '#6b8a4a');
        for (const [x, y] of [[20, 64], [48, 56], [76, 64], [34, 70], [62, 70]]) E(x, y, 4, 4, '#f3e6b0');
        Ln(20, 20, 76, 26, 1, '#c9a05a');
        break;
      case 'secreto':
        R(38, 22, 20, 56, '#6a7a8a');
        R(42, 30, 12, 6, 'rgba(180,220,255,0.75)');
        E(48, 20, 12, 4, 'rgba(180,220,255,0.3)');
        break;
      case 'camino':
        for (let i = 0; i < 9; i++) R(6 + i * 9, 62 + (i % 2) * 5, 8, 6, '#b0a690');
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Mobiliario y detalles del pueblo
// ---------------------------------------------------------------------------
export type PropKind = 'banco' | 'farol' | 'barril' | 'cajas' | 'fuente' | 'pozo' | 'valla' | 'vallaV' | 'heno' | 'lenya' | 'carro' | 'cartel' | 'abrevadero';

export function prop(kind: PropKind, v = 0): Sprite {
  switch (kind) {
    case 'banco':
      return make('pr:banco', 34, 20, 17, 18, (g) => {
        g0 = g;
        E(17, 18, 15, 2.5, 'rgba(0,0,0,0.2)');
        R(2, 8, 30, 4, '#8a6440');
        R(2, 3, 30, 3, '#9a7048');
        R(4, 12, 3, 6, '#5b3d25');
        R(27, 12, 3, 6, '#5b3d25');
      });
    case 'farol':
      return makeK('pr:farol', 16, 60, 8, 58, 0.72, (g) => {
        g0 = g;
        E(8, 58, 5, 1.6, 'rgba(0,0,0,0.22)');
        R(6.5, 10, 3, 48, '#3a3a3e');
        R(4, 56, 8, 2, '#2a2a2e');
        R(3, 2, 10, 10, '#2a2a2e');
        R(4.5, 3.5, 7, 7, '#f4cf6a');
        poly([2, 2, 14, 2, 8, -2], '#2a2a2e');
      });
    case 'barril':
      return make('pr:barril', 18, 22, 9, 20, (g) => {
        g0 = g;
        E(9, 20, 8, 2, 'rgba(0,0,0,0.2)');
        g.fillStyle = '#8a6440';
        g.beginPath();
        g.roundRect(2, 3, 14, 17, 4);
        g.fill();
        R(2, 6, 14, 1.6, '#4a4a4e');
        R(2, 15, 14, 1.6, '#4a4a4e');
        E(9, 3.5, 7, 2, '#a07a4e');
      });
    case 'cajas':
      return make(`pr:cajas:${v % 2}`, 30, 28, 15, 26, (g) => {
        g0 = g;
        E(15, 26, 14, 2.5, 'rgba(0,0,0,0.2)');
        for (const [x, y, s] of v % 2 ? [[2, 12, 14], [15, 14, 12], [6, 0, 12]] : [[3, 10, 16], [17, 16, 10]]) {
          R(x, y, s, s, '#a07a4e');
          g.strokeStyle = '#6b4a2e';
          g.lineWidth = 1;
          g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
          Ln(x, y, x + s, y + s, 0.8, '#6b4a2e');
        }
      });
    case 'fuente':
      return make('pr:fuente', 60, 52, 30, 46, (g) => {
        g0 = g;
        E(30, 46, 28, 6, 'rgba(0,0,0,0.22)');
        E(30, 38, 26, 10, '#9a9284');
        E(30, 36, 22, 8, '#4f88a2');
        E(26, 34, 8, 2.5, 'rgba(255,255,255,0.35)');
        R(26, 12, 8, 24, '#b8b0a0');
        E(30, 12, 9, 3.4, '#a8a090');
        E(30, 10, 5, 2, '#6fa6c0');
        g.strokeStyle = 'rgba(160,210,235,0.8)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(26, 10);
        g.quadraticCurveTo(18, 14, 16, 32);
        g.moveTo(34, 10);
        g.quadraticCurveTo(42, 14, 44, 32);
        g.stroke();
      });
    case 'pozo':
      return make('pr:pozo', 44, 54, 22, 50, (g) => {
        g0 = g;
        E(22, 50, 20, 4, 'rgba(0,0,0,0.22)');
        E(22, 42, 16, 7, '#8f877a');
        E(22, 40, 12, 5, '#1e2a30');
        R(6, 14, 3, 28, '#6b4a2e');
        R(35, 14, 3, 28, '#6b4a2e');
        poly([2, 16, 22, 4, 42, 16], '#8a4a2c');
        Ln(22, 16, 22, 34, 0.8, '#c9b48a');
        R(19, 32, 6, 5, '#7a5532');
      });
    case 'valla':
      return make('pr:valla', 18, 16, 9, 15, (g) => {
        g0 = g;
        R(1, 2, 2.5, 13, '#8a6a44');
        R(14.5, 2, 2.5, 13, '#8a6a44');
        R(0, 5, 18, 2, '#9a7a52');
        R(0, 10, 18, 2, '#9a7a52');
      });
    case 'vallaV':
      return make('pr:vallaV', 6, 20, 3, 19, (g) => {
        g0 = g;
        R(1.5, 0, 3, 19, '#8a6a44');
      });
    case 'heno':
      return make(`pr:heno:${v % 2}`, 34, 30, 17, 27, (g) => {
        g0 = g;
        E(17, 27, 15, 3, 'rgba(0,0,0,0.2)');
        g.fillStyle = '#e3c56a';
        g.beginPath();
        g.moveTo(2, 26);
        g.quadraticCurveTo(4, 2, 17, 2);
        g.quadraticCurveTo(30, 2, 32, 26);
        g.closePath();
        g.fill();
        g.strokeStyle = '#c9a548';
        g.lineWidth = 0.8;
        for (let k = 0; k < 6; k++) Ln(6 + k * 4, 24, 9 + k * 3, 6, 0.8, '#c9a548');
      });
    case 'lenya':
      return make('pr:lenya', 32, 20, 16, 18, (g) => {
        g0 = g;
        E(16, 18, 14, 2.4, 'rgba(0,0,0,0.2)');
        for (let i = 0; i < 9; i++) {
          const x = 5 + (i % 4) * 7 + (Math.floor(i / 4) % 2) * 3.5;
          const y = 15 - Math.floor(i / 4) * 5.5;
          E(x, y, 3.4, 3, '#8a6440');
          E(x, y, 1.8, 1.6, '#c9a57a');
        }
      });
    case 'carro':
      return make('pr:carro', 58, 40, 29, 37, (g) => {
        g0 = g;
        E(29, 37, 26, 3.5, 'rgba(0,0,0,0.22)');
        R(6, 14, 40, 14, '#8a6440');
        for (let k = 8; k < 46; k += 6) Ln(k, 14, k, 28, 0.8, 'rgba(0,0,0,0.2)');
        Ln(46, 22, 58, 26, 2, '#6b4a2e');
        for (const wx of [14, 38]) {
          E(wx, 30, 7, 7, '#4a3220');
          E(wx, 30, 2, 2, '#9a7a52');
          for (let a = 0; a < 6; a++) Ln(wx, 30, wx + Math.cos(a) * 6, 30 + Math.sin(a) * 6, 0.8, '#6b4a2e');
        }
        if (v % 2) for (let i = 0; i < 3; i++) E(14 + i * 10, 12, 5, 4, '#d9c08a');
      });
    case 'cartel':
      return make('pr:cartel', 30, 48, 15, 46, (g) => {
        g0 = g;
        E(15, 46, 6, 2, 'rgba(0,0,0,0.2)');
        R(13, 6, 4, 40, '#6b4a2e');
        poly([1, 8, 24, 8, 29, 12, 24, 16, 1, 16], '#a07a4e');
        poly([6, 20, 29, 20, 29, 28, 6, 28, 1, 24], '#9a7048');
      });
    case 'abrevadero':
      return make('pr:abrevadero', 40, 20, 20, 18, (g) => {
        g0 = g;
        E(20, 18, 18, 2.5, 'rgba(0,0,0,0.2)');
        R(2, 6, 36, 10, '#7a5532');
        R(4, 7, 32, 4, '#4f88a2');
      });
  }
}

// ---------------------------------------------------------------------------
// Animales (proporciones propias; el caballo es más grande que una persona)
// ---------------------------------------------------------------------------
export type AnimalKind = 'vaca' | 'oveja' | 'gallina' | 'ciervo' | 'caballo' | 'perro' | 'pato';

export function animal(kind: AnimalKind, frame: number, flip: boolean, v = 0): Sprite {
  const dims: Record<AnimalKind, [number, number]> = { vaca: [64, 46], oveja: [36, 30], gallina: [16, 16], ciervo: [56, 56], caballo: [72, 60], perro: [30, 22], pato: [18, 12] };
  const [W, H] = dims[kind];
  const K: Record<AnimalKind, number> = { vaca: 0.72, oveja: 0.72, gallina: 0.75, ciervo: 0.72, caballo: 0.68, perro: 0.62, pato: 0.8 };
  return makeK(`a:${kind}:${frame % 4}:${flip}:${v % 3}`, W, H, W / 2, H - 2, K[kind], (g) => {
    g0 = g;
    if (flip) (g.translate(W, 0), g.scale(-1, 1));
    const ph = (frame % 4) * (Math.PI / 2);
    const legSwing = (i: number) => Math.sin(ph + (i % 2 ? Math.PI : 0)) * 2.4;
    E(W / 2, H - 2, W * 0.4, 3, 'rgba(0,0,0,0.22)');
    switch (kind) {
      case 'gallina':
        E(8, 10, 5.5, 4.4, ['#f3efe6', '#b8643a', '#3a3030'][v % 3]);
        E(12, 6, 2.6, 2.6, ['#f3efe6', '#b8643a', '#3a3030'][v % 3]);
        R(12, 3, 2.4, 2, '#d9473a');
        poly([14.5, 6, 16, 6.5, 14.5, 7.2], '#e8b03a');
        Ln(7, 14, 7 + legSwing(0) * 0.3, 15.5, 0.8, '#d9a03a');
        break;
      case 'pato':
        E(9, 7, 6.5, 3.6, '#f3efe6');
        E(14, 4, 2.6, 2.4, '#3f7a4a');
        poly([16, 4, 18, 4.6, 16, 5.4], '#e8a03a');
        break;
      case 'oveja': {
        const wool = v % 3 === 2 ? '#4a4038' : '#efe8d8';
        for (let i = 0; i < 4; i++) Ln(9 + i * 5, 18, 9 + i * 5 + legSwing(i) * 0.4, 27, 2.2, '#3a3330');
        for (const [x, y] of [[9, 13], [15, 11], [21, 12], [12, 17], [19, 17], [25, 15]]) E(x, y, 6, 5.2, wool);
        E(30, 11, 4, 4.6, '#3a3330');
        E(29, 8, 2.4, 1.6, '#3a3330');
        E(31.5, 10.5, 0.6, 0.6, '#f0e8d8');
        break;
      }
      case 'vaca': {
        const body = ['#f1ece2', '#8a5a3a', '#3a3330'][v % 3];
        for (let i = 0; i < 4; i++) Ln(14 + i * 9, 26, 14 + i * 9 + legSwing(i) * 0.6, 42, 3.6, shade(body, 0.75));
        E(30, 22, 21, 11, body);
        if (v % 3 === 0) for (const [x, y, r] of [[22, 20, 5], [34, 25, 4], [40, 18, 3.4]]) E(x, y, r, r * 0.8, '#3a3330');
        E(52, 17, 7, 6.4, body);
        E(56, 20, 4, 3, '#e8b8a8');
        Ln(48, 11, 46, 6, 1.6, '#e8dcc0');
        Ln(53, 11, 55, 6, 1.6, '#e8dcc0');
        E(52, 15, 0.9, 0.9, '#1a1410');
        Ln(9, 18, 6, 30, 1.4, shade(body, 0.7));
        break;
      }
      case 'ciervo':
        for (let i = 0; i < 4; i++) Ln(16 + i * 7, 34, 16 + i * 7 + legSwing(i) * 0.7, 52, 2.2, '#7a5232');
        E(26, 30, 15, 8, '#9a6a3c');
        E(28, 33, 10, 4, '#c9a07a');
        Ln(38, 28, 44, 16, 4, '#9a6a3c');
        E(46, 14, 5, 4, '#9a6a3c');
        g.strokeStyle = '#6b4a2a';
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(45, 10);
        g.lineTo(42, 1);
        g.moveTo(43, 5);
        g.lineTo(39, 3);
        g.moveTo(48, 10);
        g.lineTo(52, 1);
        g.moveTo(51, 5);
        g.lineTo(55, 4);
        g.stroke();
        E(47.5, 13, 0.8, 0.8, '#1a1410');
        break;
      case 'caballo': {
        const coat = ['#6b4a30', '#2e2420', '#c9b08a'][v % 3];
        for (let i = 0; i < 4; i++) Ln(18 + i * 10, 34, 18 + i * 10 + legSwing(i) * 0.9, 56, 3.4, shade(coat, 0.8));
        for (let i = 0; i < 4; i++) E(18 + i * 10 + legSwing(i) * 0.9, 57, 2.2, 1.2, '#2a2420');
        E(33, 30, 22, 10, coat);
        Ln(50, 26, 58, 10, 7, coat);
        g.fillStyle = coat;
        g.beginPath();
        g.ellipse(62, 10, 8, 4.6, 0.5, 0, Math.PI * 2);
        g.fill();
        Ln(48, 22, 56, 6, 2.2, '#2a1e14');
        Ln(11, 26, 6, 42, 2.4, '#2a1e14');
        E(61, 7, 1, 1, '#120c08');
        Ln(56, 4, 55, 0, 1.4, coat);
        break;
      }
      case 'perro': {
        const c = ['#9a6a3c', '#3a3030', '#d8c8a8'][v % 3];
        for (let i = 0; i < 4; i++) Ln(7 + i * 5, 12, 7 + i * 5 + legSwing(i) * 0.5, 20, 1.8, shade(c, 0.8));
        E(14, 11, 10, 4.6, c);
        E(25, 7, 4.4, 4, c);
        E(28.5, 8.5, 2.2, 1.6, shade(c, 0.85));
        poly([22, 4, 23, 0, 25, 4], shade(c, 0.7));
        Ln(4, 9, 0, 4 + Math.sin(ph * 2) * 2, 1.6, c);
        break;
      }
    }
  });
}

/** Carro tirado por un caballo (caravanas). */
export function cart(frame: number, flip: boolean, cargo: string): Sprite {
  return makeK(`c:${frame % 4}:${flip}:${cargo}`, 120, 64, 60, 60, 0.72, (g) => {
    g0 = g;
    if (flip) (g.translate(120, 0), g.scale(-1, 1));
    E(56, 60, 52, 4, 'rgba(0,0,0,0.22)');
    // Carro.
    R(8, 24, 52, 18, '#8a6440');
    for (let k = 10; k < 60; k += 6) Ln(k, 24, k, 42, 0.8, 'rgba(0,0,0,0.2)');
    g.fillStyle = cargo;
    g.beginPath();
    g.moveTo(10, 26);
    g.quadraticCurveTo(34, 2, 58, 26);
    g.closePath();
    g.fill();
    Ln(14, 22, 54, 22, 0.8, shade(cargo, 0.8));
    Ln(20, 16, 48, 16, 0.8, shade(cargo, 0.8));
    for (const wx of [18, 48]) {
      E(wx, 46, 10, 10, '#4a3220');
      E(wx, 46, 2.6, 2.6, '#9a7a52');
      for (let a = 0; a < 6; a++) Ln(wx, 46, wx + Math.cos(a + frame) * 8.5, 46 + Math.sin(a + frame) * 8.5, 0.9, '#6b4a2e');
    }
    Ln(60, 34, 74, 34, 2, '#6b4a2e');
    // Caballo de tiro.
    g.save();
    g.translate(66, 0);
    const ph = (frame % 4) * (Math.PI / 2);
    for (let i = 0; i < 4; i++) Ln(10 + i * 8, 34, 10 + i * 8 + Math.sin(ph + (i % 2 ? Math.PI : 0)) * 2.2, 56, 3, '#5a3a24');
    E(22, 30, 17, 8.5, '#6b4a30');
    Ln(35, 26, 42, 12, 6, '#6b4a30');
    g.fillStyle = '#6b4a30';
    g.beginPath();
    g.ellipse(46, 12, 7, 4, 0.5, 0, Math.PI * 2);
    g.fill();
    Ln(33, 22, 40, 8, 2, '#2a1e14');
    Ln(4, 26, 0, 40, 2.2, '#2a1e14');
    g.restore();
  });
}

// ---------------------------------------------------------------------------
// Objetos del prólogo: la mochila, la caja perdida, las brasas
// ---------------------------------------------------------------------------
export function prologueProp(kind: 'mochila' | 'caja' | 'brasas'): Sprite {
  switch (kind) {
    case 'mochila':
      return make('pp:mochila', 16, 14, 8, 13, (g) => {
        g0 = g;
        E(8, 13, 7, 1.6, 'rgba(0,0,0,0.25)');
        R(2, 4, 12, 9, '#7a5232');
        R(3, 4, 10, 2, '#8e6440');
        R(3, 7, 10, 4, '#6a4428');
        R(5, 8, 6, 3, '#5a3a22');
        R(7, 9, 2, 1, '#c9a070');
        Ln(4, 4, 6, 1, 1.2, '#5a3a22');
        Ln(12, 4, 10, 1, 1.2, '#5a3a22');
        R(13, 10, 2, 3, '#a8b4b8');
      });
    case 'caja':
      return make('pp:caja', 18, 16, 9, 15, (g) => {
        g0 = g;
        E(9, 15, 8, 1.8, 'rgba(0,0,0,0.25)');
        R(2, 4, 14, 11, '#a07a4e');
        R(2, 4, 14, 2, '#b88e5c');
        R(2, 9, 14, 1, '#6b4a2e');
        R(6, 6, 6, 3, '#c9382a');
        R(14, 1, 3, 3, '#e8b84a');
        R(1, 13, 2, 2, '#e8b84a');
      });
    case 'brasas':
      return make('pp:brasas', 22, 10, 11, 8, (g) => {
        g0 = g;
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          R(11 + Math.round(Math.cos(a) * 8) - 1, 6 + Math.round(Math.sin(a) * 2.5) - 1, 3, 2, k % 2 ? '#7d776e' : '#948d82');
        }
        R(7, 5, 8, 2, '#3a3430');
        R(8, 4, 3, 1, '#5a3a22');
        R(12, 5, 2, 1, '#c9563a');
      });
  }
}

/** El símbolo del colgante en pixel art (24×24), para la carta. */
export function emblem(index: number, scale = 6): HTMLCanvasElement {
  const P = new Painter(26, 26, 13, 13);
  const ink = '#3a2418';
  const gold = '#c99a3a';
  P.oval(0, 0, 12, 12, '#8a3a2a');
  P.oval(0, 0, 10, 10, '#a8442e');
  switch (index) {
    case 0: // dos líneas cruzadas sobre un círculo
      P.oval(0, 2, 5, 5, gold);
      P.oval(0, 2, 3, 3, '#a8442e');
      P.line(-6, -6, 6, 6, ink);
      P.line(6, -6, -6, 6, ink);
      break;
    case 1: // un ojo dentro de un triángulo
      P.poly([0, -8, 8, 6, -8, 6], gold);
      P.oval(0, 1, 4, 2, '#f4ecd8');
      P.oval(0, 1, 1, 1, ink);
      break;
    case 2: // una espiga partida
      P.line(0, 8, 0, -1, gold);
      P.line(1, -3, 1, -8, gold);
      for (let k = 0; k < 3; k++) (P.px(-1, 4 - k * 3, gold), P.px(1, 3 - k * 3, gold), P.px(-2, 3 - k * 3, gold));
      P.px(2, -6, gold);
      P.px(0, -6, gold);
      break;
    case 3: // tres olas
      for (let k = 0; k < 3; k++) for (let x = -7; x <= 7; x++) P.px(x, -4 + k * 4 + Math.round(Math.sin(x * 0.8) * 1.3), gold);
      break;
    case 4: // una torre con una estrella
      P.rect(-3, -2, 6, 10, gold);
      P.rect(-4, -4, 8, 2, gold);
      P.rect(-1, 3, 2, 4, ink);
      P.px(0, -8, '#f4ecd8');
      P.px(-1, -8, gold);
      P.px(1, -8, gold);
      P.px(0, -9, gold);
      P.px(0, -7, gold);
      break;
    case 5: // una mano abierta con una llave
      P.rect(-4, -1, 8, 7, gold);
      for (let k = 0; k < 4; k++) P.rect(-4 + k * 2, -6, 1, 5, gold);
      P.rect(-7, 0, 3, 1, gold);
      P.line(-2, 2, 3, 2, ink);
      P.px(-3, 1, ink);
      P.px(-3, 3, ink);
      P.px(3, 3, ink);
      break;
    default: // un ciervo con la cornamenta en llamas
      P.rect(-3, 1, 6, 4, gold);
      P.rect(-2, -2, 3, 3, gold);
      P.line(-2, -3, -5, -7, '#ffb050');
      P.line(1, -3, 4, -7, '#ffb050');
      P.px(-5, -8, '#ffd970');
      P.px(4, -8, '#ffd970');
      P.px(-4, -5, '#ef7a2a');
      P.px(3, -5, '#ef7a2a');
      P.rect(-3, 5, 1, 3, gold);
      P.rect(2, 5, 1, 3, gold);
      break;
  }
  P.outline();
  const c = P.toCanvas(false);
  const out = document.createElement('canvas');
  out.width = c.width * scale;
  out.height = c.height * scale;
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, out.width, out.height);
  return out;
}
