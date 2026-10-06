/**
 * Puente entre la escena y el arte pintado: tipos compartidos (estilo de
 * cada cultura, estaciones), `drawSprite`, y los nombres de siempre para
 * montañas, puestos fronterizos, barricadas, lugares, carros y mojones, que
 * ahora pinta `visual/env/structures`. Aquí quedan solo los objetos del
 * prólogo y los emblemas heráldicos.
 */
import { barricadeTex, boundaryStoneTex, cartTex, peakTex, placeTex, postTex } from '../visual/env/structures';
import { Painter } from './pixel';
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

/** Cada dibujo se pinta una vez a la resolución del nivel gráfico y se reutiliza. */
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







/**
 * Montaña en pixel art, generada píxel a píxel: silueta con una o dos
 * cumbres, cara iluminada (noroeste) y cara en sombra violácea, estratos y
 * grietas, nieve con borde dentado y pinos diminutos al pie. Seis
 * variantes de tamaño y forma para que la cordillera no se repita.
 */
export function peak(v: number, snowy = true): Sprite {
  return peakTex(v, snowy);
}

export function boundaryStone(): Sprite {
  return boundaryStoneTex();
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











// ---------------------------------------------------------------------------
// Mercado, campamentos, fronteras
// ---------------------------------------------------------------------------




export function post(color: string, closed: boolean): Sprite {
  return postTex(color, closed);
}

export function barricade(): Sprite {
  return barricadeTex();
}

export function placeSprite(kind: string): Sprite {
  return placeTex(kind);
}

// ---------------------------------------------------------------------------
// Mobiliario y detalles del pueblo
// ---------------------------------------------------------------------------
export type PropKind = 'banco' | 'farol' | 'barril' | 'cajas' | 'fuente' | 'pozo' | 'valla' | 'vallaV' | 'heno' | 'lenya' | 'carro' | 'cartel' | 'abrevadero';



// ---------------------------------------------------------------------------
// Animales (proporciones propias; el caballo es más grande que una persona)
// ---------------------------------------------------------------------------
export type AnimalKind = 'vaca' | 'oveja' | 'gallina' | 'ciervo' | 'caballo' | 'perro' | 'pato';



/** Carro tirado por un caballo (caravanas). */
export function cart(frame: number, flip: boolean, cargo: string): Sprite {
  return cartTex(frame, flip, cargo);
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
