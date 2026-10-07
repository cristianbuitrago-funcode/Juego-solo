import type { Appearance } from '../../render/appearance';
import { drawFigure } from '../figure/figure';
import type { Action, Expr } from '../figure/types';
import { alpha, css, ell, lit, mix, rng, shd } from '../paint';

/**
 * Interiores selectivos: al entrar en la posada, la forja, el salón, el
 * templo, el almacén o tu casa, una viñeta pintada del interior encabeza el
 * diálogo, con su luz (fuego, velas, ventana), su mobiliario según la
 * riqueza del pueblo y los vecinos que están dentro haciendo lo suyo. Se
 * repinta a pocos fotogramas por segundo: el fuego crepita y la gente
 * respira, sin coste apreciable.
 */
export type InteriorKind = 'posada' | 'forja' | 'salon' | 'templo' | 'almacen' | 'hogar';

export interface InteriorPerson {
  ap: Appearance;
  action: Action;
  expr: Expr;
  x: number; // 0..1 en el ancho de la sala
  flip?: boolean;
  /** Sitio fijo (no se reparte en filas de profundidad): alguien sentado a una mesa. */
  fixed?: boolean;
  /** Tras la barra: más al fondo y con la barra delante (el posadero). */
  behind?: boolean;
  /** Sentado bebiendo de una jarra. */
  drink?: boolean;
}

export interface InteriorOpts {
  night: boolean;
  weather?: string; // el tiempo de fuera se ve por la ventana
  wealth: number; // 0..1
  people: InteriorPerson[];
  t: number; // segundos
}

/** Ancho y alto lógicos de la viñeta (el lienzo se escala a la densidad de pantalla). */
export const IW = 360;
export const IH = 160;

export function paintInterior(canvas: HTMLCanvasElement, kind: InteriorKind, o: InteriorOpts): void {
  const g = canvas.getContext('2d')!;
  const k = canvas.width / IW;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.imageSmoothingEnabled = true;
  const R = rng(kind.length * 977 + Math.round(o.wealth * 7));
  const floorY = IH * 0.78;
  const P = PALETTE[kind];
  // Pared del fondo.
  const wall = g.createLinearGradient(0, 0, 0, floorY);
  wall.addColorStop(0, shd(P.wall, 0.45));
  wall.addColorStop(0.55, P.wall);
  wall.addColorStop(1, shd(P.wall, 0.15));
  g.fillStyle = wall;
  g.fillRect(0, 0, IW, floorY);
  if (P.stone) stoneWall(g, R, floorY, P.wall);
  else planks(g, R, floorY, P.wall, true);
  // Vigas del techo.
  g.fillStyle = shd(P.wood, 0.35);
  g.fillRect(0, 0, IW, 9);
  for (let x = 20; x < IW; x += 74) {
    g.fillStyle = shd(P.wood, 0.25);
    g.fillRect(x, 0, 10, 14);
    g.fillStyle = alpha('#000', 0.18);
    g.fillRect(x + 10, 0, 3, 14);
  }
  // Suelo.
  const fl = g.createLinearGradient(0, floorY, 0, IH);
  fl.addColorStop(0, shd(P.floor, 0.25));
  fl.addColorStop(1, P.floor);
  g.fillStyle = fl;
  g.fillRect(0, floorY, IW, IH - floorY);
  g.strokeStyle = alpha(shd(P.floor, 0.5), 0.5);
  g.lineWidth = 0.8;
  for (let i = -8; i < 16; i++) {
    g.beginPath();
    g.moveTo(IW / 2 + i * 26, IH);
    g.lineTo(IW / 2 + i * 10, floorY);
    g.stroke();
  }
  g.fillStyle = alpha('#000', 0.25);
  g.fillRect(0, floorY, IW, 3);
  // Ventana con la luz de fuera.
  const wx = kind === 'templo' ? IW / 2 - 16 : IW * 0.68;
  windowPane(g, wx, 22, kind === 'templo' ? 32 : 40, kind === 'templo' ? 52 : 34, o.night, P.wood, kind === 'templo', o.weather ?? 'despejado', o.t);
  // Mobiliario.
  const fire = o.t * 1000;
  switch (kind) {
    case 'posada':
      hearth(g, 18, floorY, fire);
      shelf(g, R, IW * 0.36, 30, 70, ['#8a5a2a', '#5a7a4a', '#a8a090', '#7a4a3a'], o.wealth);
      for (const p of o.people) if (p.behind) person(g, p, o.t, k, 1.75, 40 + p.x * (IW - 80), floorY - 16); // asoma de cintura arriba
      counter(g, IW * 0.32, floorY, 120, P.wood);
      barrels(g, IW * 0.86, floorY, P.wood);
      // La mesa entre los dos que beben sentados (a 0,36 y 0,62 del ancho).
      table(g, 40 + 0.49 * (IW - 80), floorY + 24, 50, P.wood, true);
      break;
    case 'forja':
      forge(g, 22, floorY, fire);
      anvil(g, IW * 0.46, floorY + 10);
      tools(g, IW * 0.72, 40, P.wood);
      barrels(g, IW * 0.9, floorY, P.wood);
      break;
    case 'salon':
      banners(g, R, o.wealth);
      table(g, IW * 0.5, floorY + 14, 150, P.wood, false);
      for (let i = 0; i < 5; i++) chair(g, IW * 0.5 - 60 + i * 30, floorY + 4, P.wood);
      candles(g, IW * 0.5, floorY - 4, fire, 3);
      break;
    case 'templo':
      altar(g, IW / 2, floorY, o.wealth);
      candles(g, IW / 2, floorY - 26, fire, 5);
      for (let i = 0; i < 3; i++) bench(g, 30 + i * 36, floorY + 14, P.wood), bench(g, IW - 66 - i * 36, floorY + 14, P.wood);
      break;
    case 'almacen':
      shelf(g, R, 20, 26, 110, ['#c9a65a', '#a88a4a', '#d8c08a', '#8a6a3a'], o.wealth);
      sacks(g, R, IW * 0.55, floorY, Math.round(3 + o.wealth * 6));
      barrels(g, IW * 0.88, floorY, P.wood);
      break;
    case 'hogar':
      hearth(g, 18, floorY, fire);
      table(g, IW * 0.55, floorY + 12, 70, P.wood, true);
      bed(g, IW * 0.8, floorY);
      break;
  }
  // Gente: de pie o sentada, en tamaño de «retrato de grupo».
  // Dos filas de profundidad (los de atrás, algo más pequeños y más arriba): un grupo, no una fila de cola.
  const byX = [...o.people].filter((p) => !p.behind).sort((a, b) => a.x - b.x).map((p, i) => ({ p, back: !p.fixed && i % 2 === 1 && o.people.length > 2 }));
  const sorted = [...byX.filter((q) => q.back), ...byX.filter((q) => !q.back)];
  for (const { p, back } of sorted) person(g, p, o.t, k, back ? 1.8 : 2.1, 40 + p.x * (IW - 80) + (back ? 10 : 0), IH - 6 - (back ? 16 : 0));
  // Luz: el fuego o las velas calientan; la sala se oscurece en los bordes.
  const lx = kind === 'templo' || kind === 'salon' ? IW / 2 : kind === 'almacen' ? wx + 20 : 40;
  const flick = 1 + Math.sin(fire / 120) * 0.05 + Math.sin(fire / 47) * 0.03;
  const warm = g.createRadialGradient(lx, floorY - 20, 4, lx, floorY - 20, IW * 0.75 * flick);
  warm.addColorStop(0, kind === 'almacen' ? 'rgba(255,240,200,0.22)' : 'rgba(255,170,80,0.32)');
  warm.addColorStop(0.5, 'rgba(255,140,60,0.08)');
  warm.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = warm;
  g.fillRect(0, 0, IW, IH);
  g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(IW / 2, IH * 0.55, IW * 0.25, IW / 2, IH * 0.55, IW * 0.7);
  v.addColorStop(0, 'rgba(10,6,4,0)');
  v.addColorStop(1, o.night ? 'rgba(10,6,4,0.7)' : 'rgba(10,6,4,0.5)');
  g.fillStyle = v;
  g.fillRect(0, 0, IW, IH);
}

function person(g: CanvasRenderingContext2D, p: InteriorPerson, t: number, k: number, scale: number, px: number, py: number): void {
  g.save();
  g.translate(px, py);
  g.scale(scale, scale);
  // Sombra en el suelo.
  g.fillStyle = 'rgba(20,12,8,0.35)';
  g.beginPath();
  g.ellipse(0, 0, 8, 2.2, 0, 0, Math.PI * 2);
  g.fill();
  drawFigure(g, p.ap, { facing: p.action === 'talk' || p.action === 'listen' ? 'front' : 'side', flip: !!p.flip, phase: 0, action: p.action, t: t + p.x * 7, expr: p.expr, lod: 0, drink: p.drink }, 0, 0, { res: k * scale });
  g.restore();
}

const PALETTE: Record<InteriorKind, { wall: string; wood: string; floor: string; stone?: boolean }> = {
  posada: { wall: '#7a5a3e', wood: '#6a4228', floor: '#5a3e28' },
  forja: { wall: '#5a524a', wood: '#4a3424', floor: '#3e3630', stone: true },
  salon: { wall: '#8a7a62', wood: '#5e3e26', floor: '#6a4e34', stone: true },
  templo: { wall: '#a49a86', wood: '#6a4a30', floor: '#8a8070', stone: true },
  almacen: { wall: '#6e583e', wood: '#5a4028', floor: '#5a4a36' },
  hogar: { wall: '#8a6a48', wood: '#6a4630', floor: '#5e4430' },
};

function planks(g: CanvasRenderingContext2D, R: () => number, floorY: number, c: string, vertical: boolean): void {
  for (let x = 0; x < IW; x += 18) {
    const tone = (R() - 0.5) * 0.12;
    g.fillStyle = tone > 0 ? alpha(lit(c, tone), 0.5) : alpha(shd(c, -tone), 0.5);
    g.fillRect(x, 0, 18, floorY);
    g.fillStyle = alpha(shd(c, 0.5), 0.6);
    g.fillRect(x, 0, 1, floorY);
    if (R() < 0.4) ell(g, x + 9, 20 + R() * (floorY - 30), 1.4, 2, alpha(shd(c, 0.5), 0.6));
  }
  void vertical;
}

function stoneWall(g: CanvasRenderingContext2D, R: () => number, floorY: number, c: string): void {
  for (let y = 0, row = 0; y < floorY; y += 13, row++) {
    for (let x = row % 2 ? -12 : 0; x < IW; x += 26) {
      const tone = (R() - 0.5) * 0.18;
      const col = tone > 0 ? lit(c, tone) : shd(c, -tone);
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(x + 1, y + 1, 24, 11, 3);
      g.fill();
      g.fillStyle = alpha(lit(c, 0.2), 0.35);
      g.fillRect(x + 3, y + 2, 18, 1.2);
    }
  }
}

function windowPane(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, night: boolean, wood: string, arch: boolean, weather: string, t: number): void {
  const wet = weather === 'lluvia' || weather === 'tormenta';
  const grey = wet || weather === 'nublado' || weather === 'niebla' || weather === 'nieve';
  g.save();
  g.beginPath();
  if (arch) {
    g.moveTo(x, y + h);
    g.lineTo(x, y + w / 2);
    g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    g.lineTo(x + w, y + h);
  } else g.rect(x, y, w, h);
  g.closePath();
  const sky = g.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, night ? (grey ? '#141a26' : '#1a2440') : grey ? '#8a96a4' : '#b8d4e8');
  sky.addColorStop(1, night ? (grey ? '#202838' : '#2a3456') : grey ? '#b4b8bc' : '#f0e2c0');
  g.fillStyle = sky;
  g.fill();
  g.save();
  g.clip();
  if (night && !grey) for (let i = 0; i < 4; i++) ell(g, x + 6 + i * 9, y + 6 + (i % 2) * 7, 0.6, 0.6, '#f0f0d0');
  if (wet) {
    // Lluvia que cae tras el cristal y gotas que resbalan.
    g.strokeStyle = 'rgba(220,232,245,0.55)';
    g.lineWidth = 0.6;
    for (let i = 0; i < 14; i++) {
      const sx = x + ((i * 7.3 + t * 40) % w);
      const sy = y + ((i * 13.1 + t * 160) % h);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx - 1.5, sy + 5);
      g.stroke();
    }
  } else if (weather === 'nieve') {
    for (let i = 0; i < 12; i++) ell(g, x + ((i * 7.7 + Math.sin(t + i) * 3) % w), y + ((i * 11.3 + t * 12) % h), 0.9, 0.9, 'rgba(250,252,255,0.9)');
  }
  g.restore();
  g.restore();
  g.strokeStyle = wood;
  g.lineWidth = 3;
  g.strokeRect(x, arch ? y + w / 2 : y, w, arch ? h - w / 2 : h);
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x + w / 2, y);
  g.lineTo(x + w / 2, y + h);
  g.moveTo(x, y + h / 2);
  g.lineTo(x + w, y + h / 2);
  g.stroke();
  if (!night) {
    // Rayo de luz que entra.
    const ray = g.createLinearGradient(x, y, x - 40, y + 110);
    ray.addColorStop(0, 'rgba(255,240,200,0.28)');
    ray.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w, y);
    g.lineTo(x + w - 50, y + 120);
    g.lineTo(x - 50, y + 120);
    g.fill();
  }
}

function flames(g: CanvasRenderingContext2D, x: number, y: number, w: number, t: number): void {
  for (let i = 0; i < 5; i++) {
    const f = Math.sin(t / (90 + i * 23) + i) * 0.5 + 0.5;
    const h = 10 + f * 9 + (i % 2) * 4;
    const cx = x + (i - 2) * (w / 6);
    g.fillStyle = i % 2 ? '#f6b24a' : '#e8642a';
    g.beginPath();
    g.moveTo(cx - 3.5, y);
    g.quadraticCurveTo(cx - 3, y - h * 0.6, cx + Math.sin(t / 70 + i) * 1.5, y - h);
    g.quadraticCurveTo(cx + 3, y - h * 0.6, cx + 3.5, y);
    g.fill();
  }
  ell(g, x, y - 3, w * 0.45, 3, 'rgba(255,230,150,0.8)');
}

function hearth(g: CanvasRenderingContext2D, x: number, floorY: number, t: number): void {
  g.fillStyle = '#6e665c';
  g.fillRect(x, floorY - 58, 60, 58);
  g.fillStyle = '#5a5248';
  g.fillRect(x - 4, floorY - 62, 68, 8);
  g.fillStyle = '#140c08';
  g.beginPath();
  g.moveTo(x + 10, floorY);
  g.lineTo(x + 10, floorY - 28);
  g.quadraticCurveTo(x + 30, floorY - 42, x + 50, floorY - 28);
  g.lineTo(x + 50, floorY);
  g.fill();
  flames(g, x + 30, floorY - 4, 28, t);
  g.fillStyle = '#3a2a1e';
  g.fillRect(x + 16, floorY - 6, 28, 4);
}

function forge(g: CanvasRenderingContext2D, x: number, floorY: number, t: number): void {
  g.fillStyle = '#5e564c';
  g.beginPath();
  g.moveTo(x, floorY);
  g.lineTo(x + 6, floorY - 40);
  g.lineTo(x + 70, floorY - 40);
  g.lineTo(x + 76, floorY);
  g.fill();
  g.fillStyle = '#4a4239';
  g.fillRect(x + 22, 0, 32, floorY - 60);
  g.fillStyle = '#2a1408';
  g.fillRect(x + 12, floorY - 46, 52, 10);
  const glow = 0.7 + Math.sin(t / 150) * 0.15;
  g.fillStyle = `rgba(255,${Math.round(110 + glow * 60)},40,${glow.toFixed(2)})`;
  g.fillRect(x + 14, floorY - 45, 48, 7);
  flames(g, x + 38, floorY - 44, 40, t);
}

function anvil(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = '#4a4a50';
  g.beginPath();
  g.moveTo(x - 22, y - 26);
  g.lineTo(x + 18, y - 26);
  g.quadraticCurveTo(x + 30, y - 24, x + 30, y - 20);
  g.lineTo(x + 8, y - 18);
  g.lineTo(x + 8, y - 8);
  g.lineTo(x + 16, y);
  g.lineTo(x - 16, y);
  g.lineTo(x - 8, y - 8);
  g.lineTo(x - 8, y - 18);
  g.lineTo(x - 22, y - 20);
  g.closePath();
  g.fill();
  g.fillStyle = '#8a8a94';
  g.fillRect(x - 20, y - 26, 36, 2);
}

function tools(g: CanvasRenderingContext2D, x: number, y: number, wood: string): void {
  g.fillStyle = wood;
  g.fillRect(x - 30, y, 70, 4);
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = '#3a2a1e';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 24 + i * 14, y + 4);
    g.lineTo(x - 24 + i * 14, y + 30);
    g.stroke();
    g.fillStyle = '#6a6a72';
    g.fillRect(x - 28 + i * 14, y + 28 + (i % 2) * 2, 8, 5);
  }
}

function shelf(g: CanvasRenderingContext2D, R: () => number, x: number, y: number, w: number, cols: string[], wealth: number): void {
  for (let s = 0; s < 3; s++) {
    const sy = y + s * 26;
    g.fillStyle = '#4a3020';
    g.fillRect(x, sy + 20, w, 3);
    const n = Math.round(3 + wealth * 6);
    for (let i = 0; i < n; i++) {
      const c = cols[Math.floor(R() * cols.length)];
      const bx = x + 4 + (i / n) * (w - 10);
      const bw = 5 + R() * 5;
      const bh = 8 + R() * 10;
      g.fillStyle = c;
      g.beginPath();
      g.roundRect(bx, sy + 20 - bh, bw, bh, 2);
      g.fill();
      g.fillStyle = alpha(lit(c, 0.4), 0.6);
      g.fillRect(bx + 1, sy + 21 - bh, 1.2, bh - 2);
    }
  }
}

function counter(g: CanvasRenderingContext2D, x: number, floorY: number, w: number, wood: string): void {
  g.fillStyle = shd(wood, 0.1);
  g.fillRect(x, floorY - 30, w, 30);
  g.fillStyle = lit(wood, 0.15);
  g.fillRect(x - 4, floorY - 34, w + 8, 5);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = '#c9a65a';
    g.fillRect(x + 14 + i * 26, floorY - 42, 7, 8);
    g.fillStyle = 'rgba(255,250,220,0.8)';
    g.fillRect(x + 14 + i * 26, floorY - 42, 7, 2);
  }
}

function barrels(g: CanvasRenderingContext2D, x: number, floorY: number, wood: string): void {
  for (let i = 0; i < 2; i++) {
    const bx = x - i * 22;
    const gr = g.createLinearGradient(bx - 10, 0, bx + 10, 0);
    gr.addColorStop(0, shd(wood, 0.3));
    gr.addColorStop(0.4, lit(wood, 0.15));
    gr.addColorStop(1, shd(wood, 0.4));
    g.fillStyle = gr;
    g.beginPath();
    g.roundRect(bx - 10, floorY - 28 + i * 2, 20, 28, 5);
    g.fill();
    g.fillStyle = '#3a3a3a';
    g.fillRect(bx - 10, floorY - 22 + i * 2, 20, 2);
    g.fillRect(bx - 10, floorY - 8 + i * 2, 20, 2);
  }
}

function table(g: CanvasRenderingContext2D, x: number, y: number, w: number, wood: string, mugs: boolean): void {
  g.fillStyle = shd(wood, 0.3);
  g.fillRect(x - w / 2 + 4, y - 14, 3, 14);
  g.fillRect(x + w / 2 - 7, y - 14, 3, 14);
  g.fillStyle = lit(wood, 0.1);
  g.fillRect(x - w / 2, y - 18, w, 5);
  if (mugs) for (let i = 0; i < 3; i++) (g.fillStyle = '#a8a090'), g.fillRect(x - w / 3 + i * (w / 3), y - 24, 5, 6);
}

function chair(g: CanvasRenderingContext2D, x: number, y: number, wood: string): void {
  g.fillStyle = shd(wood, 0.2);
  g.fillRect(x - 6, y - 26, 3, 26);
  g.fillRect(x + 4, y - 12, 2, 12);
  g.fillRect(x - 6, y - 13, 12, 3);
}

function bench(g: CanvasRenderingContext2D, x: number, y: number, wood: string): void {
  g.fillStyle = lit(wood, 0.05);
  g.fillRect(x, y - 10, 30, 4);
  g.fillStyle = shd(wood, 0.3);
  g.fillRect(x + 2, y - 6, 3, 6);
  g.fillRect(x + 25, y - 6, 3, 6);
}

function banners(g: CanvasRenderingContext2D, R: () => number, wealth: number): void {
  const cols = ['#8a2a2a', '#2a4a7a', '#3a6a3a', '#7a5a1a'];
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 110;
    const c = cols[Math.floor(R() * cols.length)];
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(x, 14);
    g.lineTo(x + 26, 14);
    g.lineTo(x + 26, 70);
    g.lineTo(x + 13, 62);
    g.lineTo(x, 70);
    g.fill();
    if (wealth > 0.5) (g.fillStyle = '#d8b04a'), g.fillRect(x, 14, 26, 3);
    ell(g, x + 13, 36, 6, 6, alpha('#f0d890', 0.7));
  }
}

function altar(g: CanvasRenderingContext2D, x: number, floorY: number, wealth: number): void {
  g.fillStyle = '#c8bca4';
  g.fillRect(x - 34, floorY - 24, 68, 24);
  g.fillStyle = '#e0d6c0';
  g.fillRect(x - 38, floorY - 28, 76, 5);
  g.fillStyle = wealth > 0.5 ? '#d8b04a' : '#9a8a6a';
  g.fillRect(x - 3, floorY - 52, 6, 24);
  g.fillRect(x - 10, floorY - 46, 20, 5);
}

function candles(g: CanvasRenderingContext2D, x: number, y: number, t: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const cx = x + (i - (n - 1) / 2) * 14;
    g.fillStyle = '#efe6d0';
    g.fillRect(cx - 1.5, y - 10, 3, 10);
    const f = Math.sin(t / 80 + i * 2) * 0.6;
    g.fillStyle = '#ffd27a';
    g.beginPath();
    g.ellipse(cx + f * 0.4, y - 13, 1.6, 3, 0, 0, Math.PI * 2);
    g.fill();
    const halo = g.createRadialGradient(cx, y - 13, 0, cx, y - 13, 14);
    halo.addColorStop(0, 'rgba(255,210,120,0.35)');
    halo.addColorStop(1, 'rgba(255,210,120,0)');
    g.fillStyle = halo;
    g.fillRect(cx - 14, y - 27, 28, 28);
  }
}

function sacks(g: CanvasRenderingContext2D, R: () => number, x: number, floorY: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const sx = x - 50 + (i % 5) * 22 + (i > 4 ? 11 : 0);
    const sy = floorY + 4 - (i > 4 ? 16 : 0);
    const c = css(mix('#c8aa74', '#a8885a', R()));
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(sx - 10, sy);
    g.quadraticCurveTo(sx - 12, sy - 18, sx - 4, sy - 22);
    g.lineTo(sx + 4, sy - 22);
    g.quadraticCurveTo(sx + 12, sy - 18, sx + 10, sy);
    g.closePath();
    g.fill();
    g.fillStyle = alpha(shd(c, 0.4), 0.7);
    g.fillRect(sx - 4, sy - 22, 8, 3);
  }
}

function bed(g: CanvasRenderingContext2D, x: number, floorY: number): void {
  g.fillStyle = '#5a3a24';
  g.fillRect(x - 30, floorY - 16, 60, 16);
  g.fillStyle = '#d8ccb0';
  g.fillRect(x - 28, floorY - 22, 56, 7);
  g.fillStyle = '#8a4a3a';
  g.fillRect(x - 12, floorY - 22, 40, 8);
  ell(g, x - 20, floorY - 22, 7, 3.5, '#ece4d2');
}
