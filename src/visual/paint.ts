import { rgbOf, type RGB } from '../render/pixel';
import { VQ } from './quality';

/**
 * Base de la pintura de ECOS: color, degradados y una caché de texturas con
 * presupuesto de memoria. Todo el arte nuevo (personas, árboles, edificios,
 * suelo, efectos) pasa por aquí para compartir un mismo lenguaje: luz cálida
 * desde arriba a la izquierda, sombras frías y violáceas, bordes suaves y
 * materiales con variación.
 */
export type { RGB };
export { rgbOf };

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export const css = ([r, g, b]: RGB, a = 1): string => (a >= 1 ? `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})` : `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${a.toFixed(3)})`);

export function mix(a: string | RGB, b: string | RGB, t: number): RGB {
  const A = typeof a === 'string' ? rgbOf(a) : a;
  const B = typeof b === 'string' ? rgbOf(b) : b;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

/** Luz: aclara hacia un amarillo cálido (no hacia el blanco). */
export function lit(c: string | RGB, k: number): string {
  const [r, g, b] = typeof c === 'string' ? rgbOf(c) : c;
  return css([r + (255 - r) * k * 0.95 + 10 * k, g + (255 - g) * k * 0.88 + 4 * k, b + (255 - b) * k * 0.62 - 12 * k]);
}

/** Sombra: oscurece desplazando hacia el violeta/azul (nunca gris sucio). */
export function shd(c: string | RGB, k: number): string {
  const [r, g, b] = typeof c === 'string' ? rgbOf(c) : c;
  const m = 1 - k;
  return css([r * m - 8 * k, g * m - 2 * k, b * m + 18 * k]);
}

export function alpha(c: string | RGB, a: number): string {
  return css(typeof c === 'string' ? rgbOf(c) : c, a);
}

/** Generador determinista (cada cosa del mundo se pinta siempre igual). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Degradado lineal vertical entre dos colores (para volúmenes cilíndricos y paredes). */
export function vgrad(g: CanvasRenderingContext2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

export function hgrad(g: CanvasRenderingContext2D, x0: number, x1: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

/** Relleno «cilíndrico»: luz a la izquierda, sombra a la derecha (brazos, piernas, troncos). */
export function cyl(g: CanvasRenderingContext2D, x0: number, x1: number, base: string): CanvasGradient {
  return hgrad(g, x0, x1, [
    [0, shd(base, 0.12)],
    [0.28, lit(base, 0.12)],
    [0.55, base],
    [1, shd(base, 0.38)],
  ]);
}

/** Elipse rellena. */
export function ell(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0): void {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
  g.fill();
}

/** Trazo de curva suave por puntos (Catmull-Rom → Bézier), cerrado o abierto. */
export function smoothPath(g: CanvasRenderingContext2D, pts: number[], closed = true, tension = 0.5): void {
  const n = pts.length / 2;
  const P = (i: number) => {
    const k = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    return [pts[k * 2], pts[k * 2 + 1]];
  };
  g.moveTo(pts[0], pts[1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [x0, y0] = P(i - 1);
    const [x1, y1] = P(i);
    const [x2, y2] = P(i + 1);
    const [x3, y3] = P(i + 2);
    const t = tension / 3;
    g.bezierCurveTo(x1 + (x2 - x0) * t, y1 + (y2 - y0) * t, x2 - (x3 - x1) * t, y2 - (y3 - y1) * t, x2, y2);
  }
  if (closed) g.closePath();
}

export function blob(g: CanvasRenderingContext2D, pts: number[], fill: string | CanvasGradient, tension = 0.5): void {
  g.fillStyle = fill;
  g.beginPath();
  smoothPath(g, pts, true, tension);
  g.fill();
}

// ---------------------------------------------------------------------------
// Texturas en caché
// ---------------------------------------------------------------------------
/** Una textura pintada: lienzo a `res` píxeles por píxel de mundo, con ancla en unidades de mundo. */
export interface Tex {
  canvas: HTMLCanvasElement;
  w: number; // ancho en unidades de mundo
  h: number;
  ax: number; // ancla en unidades de mundo (desde la esquina superior izquierda)
  ay: number;
  res: number;
  bytes: number;
  used: number;
}

const texCache = new Map<string, Tex>();
let texBytes = 0;
let frame = 0;

export const nextFrame = () => frame++;
/** Número del fotograma en curso (lo avanza la escena con `nextFrame`). */
export const frameNo = () => frame;
export const texStats = () => ({ count: texCache.size, mb: texBytes / 1048576 });

/** Vacía todas las texturas (al cambiar de nivel gráfico). */
export function clearTextures(): void {
  texCache.clear();
  texBytes = 0;
}

/**
 * Pinta (una vez) y devuelve una textura. `draw` recibe el contexto ya
 * escalado: se dibuja en unidades de mundo con el ancla en (0,0) desplazada
 * a (ax, ay). `res` por defecto: la de los sprites del nivel gráfico.
 */
/**
 * Opacidad (0..1) de un sprite en un punto, en unidades de mundo relativas al ancla.
 * Lee los píxeles una sola vez por lienzo (para saber si una casa tapa de verdad al jugador
 * o solo su rectángulo, que incluye aire alrededor del tejado).
 */
const alphaMaps = new WeakMap<HTMLCanvasElement, Uint8ClampedArray | null>();
export function alphaAt(t: Tex, dx: number, dy: number): number {
  let a = alphaMaps.get(t.canvas);
  if (a === undefined) {
    try {
      a = t.canvas.getContext('2d')!.getImageData(0, 0, t.canvas.width, t.canvas.height).data;
    } catch {
      a = null;
    }
    alphaMaps.set(t.canvas, a);
  }
  if (!a) return 1;
  const x = Math.floor((dx + t.ax) * (t.canvas.width / t.w));
  const y = Math.floor((dy + t.ay) * (t.canvas.height / t.h));
  if (x < 0 || y < 0 || x >= t.canvas.width || y >= t.canvas.height) return 0;
  return a[(y * t.canvas.width + x) * 4 + 3] / 255;
}

export function tex(key: string, w: number, h: number, ax: number, ay: number, draw: (g: CanvasRenderingContext2D) => void, res = VQ().spriteRes): Tex {
  const k = `${key}@${res}`;
  const hit = texCache.get(k);
  if (hit) {
    hit.used = frame;
    return hit;
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * res));
  c.height = Math.max(1, Math.ceil(h * res));
  const g = c.getContext('2d')!;
  g.scale(res, res);
  g.translate(ax, ay);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  const t: Tex = { canvas: c, w, h, ax, ay, res, bytes: c.width * c.height * 4, used: frame };
  texCache.set(k, t);
  texBytes += t.bytes;
  if (texBytes > VQ().textureBudgetMB * 1048576) evict();
  return t;
}

/** Libera las texturas que llevan más tiempo sin usarse (hasta el 75 % del presupuesto). */
function evict(): void {
  const limit = VQ().textureBudgetMB * 1048576 * 0.75;
  const list = [...texCache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [k, t] of list) {
    if (texBytes <= limit || frame - t.used < 2) break;
    texCache.delete(k);
    texBytes -= t.bytes;
  }
}

/** Dibuja una textura con su ancla en (x, y) de mundo. */
export function put(g: CanvasRenderingContext2D, t: Tex, x: number, y: number, flip = false, scale = 1): void {
  if (!flip && scale === 1) {
    g.drawImage(t.canvas, x - t.ax, y - t.ay, t.w, t.h);
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(flip ? -scale : scale, scale);
  g.drawImage(t.canvas, -t.ax, -t.ay, t.w, t.h);
  g.restore();
}

/** Silueta oscura de una textura (para sombras proyectadas), en caché. */
const silCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export function silhouette(t: Tex): HTMLCanvasElement {
  const hit = silCache.get(t.canvas);
  if (hit) return hit;
  const c = document.createElement('canvas');
  // Media resolución: la sombra es borrosa de todos modos.
  c.width = Math.max(1, Math.ceil(t.canvas.width / 2));
  c.height = Math.max(1, Math.ceil(t.canvas.height / 2));
  const g = c.getContext('2d')!;
  g.drawImage(t.canvas, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-in';
  // Violeta frío: con el sol cálido, las sombras son azuladas (y se leen sobre la nieve).
  g.fillStyle = 'rgb(34,28,62)';
  g.fillRect(0, 0, c.width, c.height);
  silCache.set(t.canvas, c);
  return c;
}
