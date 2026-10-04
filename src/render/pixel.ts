/**
 * Base común del pixel art. Todo el arte del juego (personas, retratos,
 * edificios, vegetación, animales, suelo) pasa por aquí para compartir un
 * mismo lenguaje: píxeles enteros, colores sólidos con 3–4 tonos por
 * material, contorno oscuro teñido del color vecino y sombras planas.
 * Así ninguna pantalla parece hecha por una mano distinta.
 */

export type RGB = [number, number, number];

const parsed = new Map<string, RGB>();

/** Convierte #hex, rgb() o hsl() a RGB (con caché). */
export function rgbOf(c: string): RGB {
  const hit = parsed.get(c);
  if (hit) return hit;
  let out: RGB = [255, 0, 255];
  if (c.startsWith('#')) {
    const s = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    const n = parseInt(s, 16);
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else if (c.startsWith('rgb')) {
    const m = c.match(/[\d.]+/g)!.map(Number);
    out = [m[0], m[1], m[2]];
  } else if (c.startsWith('hsl')) {
    const m = c.match(/[\d.]+/g)!.map(Number);
    out = hslToRgb(m[0], m[1] / 100, m[2] / 100);
  }
  parsed.set(c, out);
  return out;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255);
  return [f(0), f(8), f(4)];
}

export function hex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Tono de un color para sombrear al estilo pixel art: las sombras se
 * desplazan hacia el violeta/azul y las luces hacia el amarillo, en vez de
 * oscurecer o aclarar sin más.
 */
export function tone(c: string, k: number): string {
  const [r, g, b] = rgbOf(c);
  if (k < 1) {
    const t = 1 - k;
    return hex([r * k - 6 * t, g * k - 4 * t, b * k + 14 * t]);
  }
  const t = k - 1;
  return hex([r + (255 - r) * t * 0.9 + 6 * t, g + (255 - g) * t * 0.85, b + (255 - b) * t * 0.6 - 10 * t]);
}

/** Más saturado (las referencias usan colores vivos). */
export function vivid(c: string, k = 1.18): string {
  const [r, g, b] = rgbOf(c);
  const m = (r + g + b) / 3;
  return hex([m + (r - m) * k, m + (g - m) * k, m + (b - m) * k]);
}

export const OUTLINE = '#2a1a1c';

/**
 * Lienzo de píxeles: dibuja con coordenadas enteras sobre un ImageData y
 * después añade el contorno. Las coordenadas son relativas a un ancla
 * (normalmente los pies del objeto).
 */
export class Painter {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly mask: Uint8Array; // 1 sólido, 2 sombra (sin contorno)
  constructor(readonly w: number, readonly h: number, readonly ax: number, readonly ay: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
    this.mask = new Uint8Array(w * h);
  }

  px(x: number, y: number, c: string): void {
    const X = Math.round(x) + this.ax;
    const Y = Math.round(y) + this.ay;
    if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) return;
    const [r, g, b] = rgbOf(c);
    const i = Y * this.w + X;
    this.data[i * 4] = r;
    this.data[i * 4 + 1] = g;
    this.data[i * 4 + 2] = b;
    this.data[i * 4 + 3] = 255;
    this.mask[i] = 1;
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    for (let yy = 0; yy < Math.round(h); yy++) for (let xx = 0; xx < Math.round(w); xx++) this.px(x0 + xx, y0 + yy, c);
  }

  /** Elipse rellena (centro y radios en píxeles). */
  oval(cx: number, cy: number, rx: number, ry: number, c: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.35);
        const dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) (err += dy), (x0 += sx);
      if (e2 <= dx) (err += dx), (y0 += sy);
    }
  }

  /** Polígono relleno (regla par-impar, por filas). */
  poly(pts: number[], c: string): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 2) (minY = Math.min(minY, pts[i])), (maxY = Math.max(maxY, pts[i]));
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const x1 = pts[i];
        const y1 = pts[i + 1];
        const x2 = pts[(i + 2) % pts.length];
        const y2 = pts[(i + 3) % pts.length];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.px(x, y, c);
    }
  }

  /** Sombra plana en el suelo (semitransparente, sin contorno). */
  shadow(cx: number, cy: number, rx: number, ry: number, a = 0.28): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.3);
        const dy = (y - cy) / (ry + 0.3);
        if (dx * dx + dy * dy > 1) continue;
        const X = x + this.ax;
        const Y = y + this.ay;
        if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
        const i = Y * this.w + X;
        if (this.mask[i]) continue;
        this.data[i * 4] = 20;
        this.data[i * 4 + 1] = 12;
        this.data[i * 4 + 2] = 30;
        this.data[i * 4 + 3] = Math.round(a * 255);
        this.mask[i] = 2;
      }
  }

  get(x: number, y: number): boolean {
    const X = Math.round(x) + this.ax;
    const Y = Math.round(y) + this.ay;
    return X >= 0 && Y >= 0 && X < this.w && Y < this.h && this.mask[Y * this.w + X] === 1;
  }

  /** Contorno exterior: oscuro, teñido del color del píxel vecino. */
  outline(strength = 0.38): void {
    addOutline(this.data, this.mask, this.w, this.h, strength);
  }

  toCanvas(outline = true): HTMLCanvasElement {
    if (outline) this.outline();
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    c.getContext('2d')!.putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
    return c;
  }
}

function addOutline(d: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, k: number): void {
  const [or, og, ob] = rgbOf(OUTLINE);
  const src = mask.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i] === 1) continue;
      let n = -1;
      if (x > 0 && src[i - 1] === 1) n = i - 1;
      else if (x < w - 1 && src[i + 1] === 1) n = i + 1;
      else if (y > 0 && src[i - w] === 1) n = i - w;
      else if (y < h - 1 && src[i + w] === 1) n = i + w;
      if (n < 0) continue;
      d[i * 4] = or + (d[n * 4] - or) * k * 0.6;
      d[i * 4 + 1] = og + (d[n * 4 + 1] - og) * k * 0.6;
      d[i * 4 + 2] = ob + (d[n * 4 + 2] - ob) * k * 0.6;
      d[i * 4 + 3] = 255;
      mask[i] = 3;
    }
}

/**
 * Convierte un lienzo dibujado con trazos vectoriales en pixel art: cada
 * píxel toma el color sólido más cercano de los que forman el dibujo (los
 * semitonos del suavizado desaparecen), el alfa se vuelve todo o nada, las
 * sombras quedan planas y se añade el contorno.
 */
export function pixelize(c: HTMLCanvasElement, outline = true): void {
  const g = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  if (!w || !h) return;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const mask = new Uint8Array(w * h);
  // 1) Paleta: los colores que se repiten de verdad.
  const count = new Map<number, number>();
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] < 250) continue;
    const key = ((d[i * 4] >> 2) << 12) | ((d[i * 4 + 1] >> 2) << 6) | (d[i * 4 + 2] >> 2);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const min = Math.max(3, Math.floor((w * h) / 2500));
  const pal: RGB[] = [];
  for (const [k, n] of count) if (n >= min) pal.push([((k >> 12) & 63) << 2, ((k >> 6) & 63) << 2, (k & 63) << 2]);
  const near = new Map<number, RGB>();
  const nearest = (r: number, g2: number, b: number): RGB => {
    const key = ((r >> 3) << 10) | ((g2 >> 3) << 5) | (b >> 3);
    const hit = near.get(key);
    if (hit) return hit;
    let best: RGB = [r, g2, b];
    let bd = Infinity;
    for (const p of pal) {
      const dd = (p[0] - r) ** 2 * 0.3 + (p[1] - g2) ** 2 * 0.59 + (p[2] - b) ** 2 * 0.11;
      if (dd < bd) (bd = dd), (best = p);
    }
    near.set(key, best);
    return best;
  };
  // 2) Alfa todo o nada; sombras planas.
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    if (a >= 140) {
      // Píxel de borde suavizado: el color está premezclado con transparente.
      const [r, g2, b] = pal.length ? nearest(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) : [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
      d[i * 4] = r;
      d[i * 4 + 1] = g2;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
      mask[i] = 1;
    } else if (a >= 28 && d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 150) {
      d[i * 4] = 20;
      d[i * 4 + 1] = 12;
      d[i * 4 + 2] = 30;
      d[i * 4 + 3] = 70;
      mask[i] = 2;
    } else if (a >= 60) {
      // Brillo o humo claro semitransparente: se conserva a medio tono.
      d[i * 4 + 3] = 150;
      mask[i] = 2;
    } else d[i * 4 + 3] = 0;
  }
  if (outline) addOutline(d, mask, w, h, 0.38);
  g.putImageData(img, 0, 0);
}
