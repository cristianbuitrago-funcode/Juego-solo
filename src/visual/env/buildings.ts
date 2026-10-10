import { alpha, blob, ell, lit, mix, rng, shd, tex, vgrad, type Tex } from '../paint';

/**
 * Edificios pintados con volumen: fachada, pared lateral en perspectiva,
 * tejado con faldón lateral y sombra del alero sobre el muro. Los
 * materiales cuentan quién vive dentro: enlucido limpio o desconchado,
 * cristal o postigos, jardineras o tablones clavados. Y las consecuencias
 * se ven: casas deterioradas por la pobreza, dañadas o destruidas por la
 * guerra y los desastres, andamios mientras se reconstruyen, tejas nuevas
 * cuando ya están restauradas.
 */
export type BuildState = 'normal' | 'deteriorada' | 'quemada' | 'destruida' | 'obra' | 'restaurada' | 'abandonada';

export interface Style {
  wall: string;
  roof: string;
  trim: string;
  shape: 'dos-aguas' | 'plano' | 'redondo' | 'alto';
}

const DEPTH = 13; // fondo lateral (oblicuo, hacia arriba a la derecha)
const DY = 7;
/** Muro de una planta: la puerta (36) mide ~1,2 veces una persona (31), como en la realidad. */
export const WALL_H = 56;

interface Win {
  x: number; // relativo al centro de la fachada
  y: number; // relativo a la base
  w: number;
  h: number;
}

/** Ventanas de una casa (para encenderlas de noche), relativas al ancla: mismas posiciones de siempre. */
export function houseWindows(wTiles: number): Win[] {
  const W = wTiles * 16;
  return [
    { x: -W / 2 + 10, y: -42, w: 12, h: 14 },
    { x: W / 2 - 22, y: -42, w: 12, h: 14 },
  ];
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------
function plaster(g: CanvasRenderingContext2D, R: () => number, x: number, y: number, w: number, h: number, c: string, st: BuildState): void {
  const faded = st === 'deteriorada' || st === 'abandonada' ? 0.18 : st === 'quemada' ? 0.5 : 0;
  const base = faded ? `rgb(${mix(c, st === 'quemada' ? '#3a3230' : '#9a9080', faded).map(Math.round).join(',')})` : c;
  g.fillStyle = vgrad(g, y, y + h, [[0, shd(base, 0.12)], [0.18, lit(base, st === 'restaurada' ? 0.12 : 0.05)], [0.85, base], [1, shd(base, 0.2)]]);
  g.fillRect(x, y, w, h);
  // Textura: manchas suaves del enlucido.
  for (let i = 0; i < w * h * 0.012; i++) ell(g, x + R() * w, y + R() * h, 1 + R() * 3, 0.6 + R() * 1.5, alpha(R() < 0.5 ? shd(base, 0.1) : lit(base, 0.1), 0.35));
  if (faded || st === 'destruida') {
    // Desconchones que dejan ver el ladrillo.
    for (let i = 0; i < (st === 'deteriorada' ? 3 : 5); i++) {
      const px = x + R() * (w - 10);
      const py = y + 6 + R() * (h - 18);
      blob(g, [px, py, px + 6 + R() * 5, py + 1, px + 7, py + 5, px + 2, py + 6 + R() * 2], '#a86a4a', 0.6);
      g.strokeStyle = 'rgba(90,50,30,0.5)';
      g.lineWidth = 0.4;
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        g.moveTo(px + 1, py + 2 + k * 2.4);
        g.lineTo(px + 6, py + 2 + k * 2.4);
        g.stroke();
      }
    }
    g.strokeStyle = 'rgba(40,30,24,0.45)';
    g.lineWidth = 0.4;
    for (let i = 0; i < 3; i++) {
      let cx = x + R() * w;
      let cy = y + R() * h * 0.5;
      g.beginPath();
      g.moveTo(cx, cy);
      for (let k = 0; k < 5; k++) g.lineTo((cx += (R() - 0.5) * 5), (cy += 2 + R() * 3));
      g.stroke();
    }
  }
}

function stoneBase(g: CanvasRenderingContext2D, R: () => number, x: number, y: number, w: number, h: number, side = false): void {
  g.fillStyle = side ? '#6a6458' : '#8a8274';
  g.fillRect(x, y, w, h);
  const rows = Math.max(1, Math.round(h / 4));
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let sx = x - (r % 2) * 3;
    while (sx < x + w) {
      const sw = 5 + R() * 4;
      const tone = (side ? 100 : 130) + R() * 30;
      const c = `rgb(${tone + 8},${tone + 2},${tone - 8})`;
      const gr = g.createLinearGradient(sx, y + r * rh, sx + sw, y + (r + 1) * rh);
      gr.addColorStop(0, lit(c, 0.15));
      gr.addColorStop(1, shd(c, 0.25));
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(Math.max(x, sx + 0.35), y + r * rh + 0.35, Math.min(sw - 0.7, x + w - sx - 0.35), rh - 0.7, 1);
      g.fill();
      sx += sw;
    }
  }
}

function window_(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, trim: string, st: BuildState, wealth: number, flowers: boolean): void {
  // Marco y alféizar.
  g.fillStyle = shd(trim, 0.15);
  g.fillRect(x - 1.4, y - 1.4, w + 2.8, h + 2.8);
  if (st === 'abandonada' || st === 'destruida') {
    g.fillStyle = '#1e1a16';
    g.fillRect(x, y, w, h);
    for (const [a, b] of [[3, 6], [h - 3, h - 7]]) {
      g.strokeStyle = '#7a6040';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 1.5, y + a);
      g.lineTo(x + w + 1.5, y + b);
      g.stroke();
    }
    return;
  }
  if (st === 'quemada') {
    g.fillStyle = '#100c0a';
    g.fillRect(x, y, w, h);
    blob(g, [x - 1, y - 2, x + w + 1, y - 2, x + w * 0.8, y - 9, x + w * 0.3, y - 11], 'rgba(20,16,14,0.6)', 0.5);
    return;
  }
  // Cristal: refleja el cielo (arriba claro, abajo el interior oscuro).
  const glass = wealth > 0.35 || st === 'restaurada';
  g.fillStyle = vgrad(g, y, y + h, glass ? [[0, '#c8dce8'], [0.45, '#6a8aa0'], [1, '#2a3440']] : [[0, '#4a3a2a'], [1, '#2a2018']]);
  g.fillRect(x, y, w, h);
  if (glass) {
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x + 1.2, y + h * 0.7);
    g.lineTo(x + w * 0.5, y + 1);
    g.stroke();
  }
  g.fillStyle = shd(trim, 0.05);
  g.fillRect(x + w / 2 - 0.5, y, 1, h);
  g.fillRect(x, y + h / 2 - 0.5, w, 1);
  // Contraventanas pintadas con el color de la casa.
  const sh = st === 'deteriorada' ? `rgb(${mix(trim, '#8a8070', 0.4).map(Math.round).join(',')})` : trim;
  for (const [sx, flip] of [[x - 5, 1], [x + w + 1, -1]] as const) {
    g.fillStyle = vgrad(g, y, y + h, [[0, lit(sh, 0.12)], [1, shd(sh, 0.2)]]);
    g.fillRect(sx, y - 0.6, 4, h + 1.2);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 0.35;
    for (let k = 1; k < 4; k++) {
      g.beginPath();
      g.moveTo(sx + 0.4, y + (h * k) / 4);
      g.lineTo(sx + 3.6, y + (h * k) / 4 - flip * 0.8);
      g.stroke();
    }
  }
  g.fillStyle = shd(trim, 0.35);
  g.fillRect(x - 2, y + h + 1.2, w + 4, 1.8);
  if (flowers && st !== 'deteriorada') {
    g.fillStyle = '#7a4a28';
    g.fillRect(x - 1, y + h + 2.6, w + 2, 2.4);
    for (let i = 0; i < 6; i++) {
      ell(g, x + 0.5 + i * (w / 5), y + h + 2.2, 1.6, 1.3, '#4f8a3a');
      ell(g, x + 0.5 + i * (w / 5), y + h + 1.6, 1.0, 1.0, ['#d9473a', '#f3e27a', '#f0b8cf', '#fbf6ee'][i % 4]);
    }
  }
}

function door(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, trim: string, st: BuildState, wide = false): void {
  g.fillStyle = shd(trim, 0.25);
  g.beginPath();
  g.roundRect(x - 1.8, y - 1.8, w + 3.6, h + 1.8, [w / 2 + 1.8, w / 2 + 1.8, 0, 0]);
  g.fill();
  const wood = st === 'quemada' ? '#181210' : st === 'abandonada' || st === 'deteriorada' ? '#5a4a38' : wide ? '#5a3c24' : '#6e4a2c';
  g.fillStyle = vgrad(g, y, y + h, [[0, lit(wood, 0.08)], [1, shd(wood, 0.3)]]);
  g.beginPath();
  g.roundRect(x, y, w, h, [w / 2, w / 2, 0, 0]);
  g.fill();
  if (st === 'quemada') return;
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.45;
  for (let k = x + 3; k < x + w - 1; k += 3.2) {
    g.beginPath();
    g.moveTo(k, y + 2);
    g.lineTo(k, y + h);
    g.stroke();
  }
  // Herrajes y pomo.
  g.fillStyle = '#2a2420';
  g.fillRect(x + 1, y + h * 0.3, w - 2, 0.9);
  g.fillRect(x + 1, y + h * 0.72, w - 2, 0.9);
  ell(g, x + w - 3, y + h * 0.55, 0.9, 0.9, '#d8b860');
  // Escalón de piedra.
  g.fillStyle = vgrad(g, y + h, y + h + 2.5, [[0, '#b0a898'], [1, '#7a7468']]);
  g.fillRect(x - 3, y + h, w + 6, 2.5);
}

/** Tejado a dos aguas visto en 3/4: faldón delantero, faldón lateral, tejas y caballete. */
function roof(g: CanvasRenderingContext2D, R: () => number, x0: number, top: number, W: number, color: string, kind: Style['shape'], st: BuildState): number {
  const tall = kind === 'alto' ? 46 : kind === 'plano' ? 10 : 36;
  const over = 6;
  const c = st === 'quemada' ? '#2a2420' : st === 'deteriorada' || st === 'abandonada' ? `rgb(${mix(color, '#7a7268', 0.3).map(Math.round).join(',')})` : st === 'restaurada' ? lit(color, 0.08) : color;
  if (kind === 'plano') {
    // Azotea con pretil y vigas.
    g.fillStyle = vgrad(g, top - tall, top, [[0, lit(c, 0.15)], [1, shd(c, 0.1)]]);
    g.fillRect(x0 - 3, top - tall, W + 6, tall + 2);
    g.fillStyle = shd(c, 0.3);
    g.beginPath();
    g.moveTo(x0 + W + 3, top - tall);
    g.lineTo(x0 + W + 3 + DEPTH, top - tall - DY);
    g.lineTo(x0 + W + 3 + DEPTH, top + 2 - DY);
    g.lineTo(x0 + W + 3, top + 2);
    g.fill();
    for (let k = x0 + 6; k < x0 + W; k += 10) {
      g.fillStyle = '#5a3e26';
      g.fillRect(k, top - 1, 2.6, 4);
    }
    return tall;
  }
  // Faldón lateral (en sombra), con sus hileras de tejas: es tejado, no una tabla.
  const sidePath = () => {
    g.beginPath();
    g.moveTo(x0 + W - 6, top - tall);
    g.lineTo(x0 + W - 6 + DEPTH, top - tall - DY);
    g.lineTo(x0 + W + over + DEPTH, top + 2 - DY);
    g.lineTo(x0 + W + over, top + 2);
    g.closePath();
  };
  g.fillStyle = vgrad(g, top - tall, top, [[0, shd(c, 0.16)], [1, shd(c, 0.32)]]);
  sidePath();
  g.fill();
  g.save();
  sidePath();
  g.clip();
  const srows = kind === 'alto' ? 10 : 7;
  for (let r = 1; r <= srows; r++) {
    const f = r / srows;
    // Cada hilera es paralela al alero lateral, subiendo hacia la cumbrera.
    const ax = x0 + W + over - (over + 6) * f;
    const ay = top + 2 - (tall + 2) * f;
    g.strokeStyle = alpha(shd(c, 0.55), 0.55);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(ax + DEPTH, ay - DY);
    g.stroke();
    g.strokeStyle = alpha(lit(c, 0.05), 0.35);
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(ax - 0.3, ay - 1.2);
    g.lineTo(ax - 0.3 + DEPTH, ay - 1.2 - DY);
    g.stroke();
  }
  g.restore();
  // Cumbrera lateral (arista entre los dos faldones).
  g.strokeStyle = shd(c, 0.45);
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x0 + W - 6, top - tall);
  g.lineTo(x0 + W + over, top + 2);
  g.moveTo(x0 + W - 6, top - tall);
  g.lineTo(x0 + W - 6 + DEPTH, top - tall - DY);
  g.stroke();
  // Faldón delantero.
  const front = () => {
    g.beginPath();
    g.moveTo(x0 - over, top + 2);
    g.lineTo(x0 + W + over, top + 2);
    g.lineTo(x0 + W - 6, top - tall);
    g.lineTo(x0 + 6, top - tall);
    g.closePath();
  };
  g.fillStyle = vgrad(g, top - tall, top + 2, [[0, lit(c, 0.18)], [0.5, c], [1, shd(c, 0.18)]]);
  front();
  g.fill();
  g.save();
  front();
  g.clip();
  // Tejas en hileras: cada una con su luz; las rotas, a la vista.
  const rows = kind === 'alto' ? 10 : 7;
  const rh = (tall + 2) / rows;
  for (let r = 0; r < rows; r++) {
    const y = top + 2 - (r + 1) * rh;
    const tw = kind === 'alto' ? 5 : 6.5;
    for (let x = x0 - over - (r % 2) * tw * 0.5; x < x0 + W + over; x += tw) {
      const broken = (st === 'deteriorada' || st === 'abandonada') && R() < 0.06;
      if (broken) {
        g.fillStyle = 'rgba(30,20,16,0.85)';
        g.fillRect(x, y, tw, rh);
        continue;
      }
      const tone = 0.92 + R() * 0.16;
      const tc = `rgb(${mix(c, '#000000', 1 - tone).map(Math.round).join(',')})`;
      const gr = g.createLinearGradient(x, y, x, y + rh);
      gr.addColorStop(0, lit(tc, 0.12));
      gr.addColorStop(0.7, tc);
      gr.addColorStop(1, shd(tc, 0.4));
      g.fillStyle = gr;
      g.beginPath();
      if (kind === 'alto') g.rect(x + 0.2, y, tw - 0.4, rh + 0.3);
      else {
        g.moveTo(x + 0.2, y + rh + 0.3);
        g.lineTo(x + 0.2, y + rh * 0.3);
        g.quadraticCurveTo(x + tw / 2, y - rh * 0.25, x + tw - 0.2, y + rh * 0.3);
        g.lineTo(x + tw - 0.2, y + rh + 0.3);
      }
      g.fill();
    }
  }
  // Musgo o tejas nuevas.
  if (st === 'deteriorada' || st === 'abandonada') for (let i = 0; i < 6; i++) ell(g, x0 + R() * W, top - R() * tall, 3, 1.4, 'rgba(90,120,50,0.6)');
  g.restore();
  // Caballete y alero.
  g.strokeStyle = shd(c, 0.45);
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(x0 + 6, top - tall);
  g.lineTo(x0 + W - 6, top - tall);
  g.lineTo(x0 + W - 6 + DEPTH, top - tall - DY);
  g.stroke();
  g.strokeStyle = shd(c, 0.55);
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x0 - over, top + 2);
  g.lineTo(x0 + W + over, top + 2);
  g.stroke();
  return tall;
}

function thatch(g: CanvasRenderingContext2D, R: () => number, cx: number, top: number, W: number, color: string, st: BuildState): void {
  const c = st === 'quemada' ? '#2a2420' : color;
  g.fillStyle = vgrad(g, top - 46, top + 6, [[0, lit(c, 0.2)], [1, shd(c, 0.3)]]);
  g.beginPath();
  g.moveTo(cx - W / 2 - 6, top + 4);
  g.quadraticCurveTo(cx, top + 14, cx + W / 2 + 6, top + 4);
  g.lineTo(cx + 4, top - 46);
  g.lineTo(cx - 4, top - 46);
  g.closePath();
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = alpha(shd(c, 0.4), 0.55);
  g.lineWidth = 0.5;
  for (let i = 0; i < 90; i++) {
    const t = R();
    const x = cx + (t - 0.5) * W * 1.1;
    g.beginPath();
    g.moveTo(cx + (x - cx) * 0.1, top - 44);
    g.lineTo(x + (R() - 0.5) * 2, top + 10);
    g.stroke();
  }
  for (let k = 1; k < 4; k++) {
    g.strokeStyle = alpha(shd(c, 0.5), 0.6);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx - W / 2 - 6 + k * 9, top + 4 - k * 12);
    g.quadraticCurveTo(cx, top + 10 - k * 12, cx + W / 2 + 6 - k * 9, top + 4 - k * 12);
    g.stroke();
  }
  g.restore();
}

function scaffold(g: CanvasRenderingContext2D, x0: number, top: number, base: number, W: number): void {
  g.strokeStyle = '#8a6a44';
  g.lineWidth = 1.6;
  for (let k = 0; k <= W; k += 14) {
    g.beginPath();
    g.moveTo(x0 + k, base);
    g.lineTo(x0 + k + 1, top - 30);
    g.stroke();
  }
  for (const y of [top - 4, top - 20, base - 20]) {
    g.fillStyle = vgrad(g, y, y + 2.4, [[0, '#c8a070'], [1, '#8a6a44']]);
    g.fillRect(x0 - 4, y, W + 8, 2.4);
  }
  g.strokeStyle = '#7a5a38';
  g.lineWidth = 0.9;
  for (let k = 0; k < W; k += 14) {
    g.beginPath();
    g.moveTo(x0 + k, base - 20);
    g.lineTo(x0 + k + 14, top - 4);
    g.stroke();
  }
  // Vigas del tejado nuevo y material apilado.
  for (let k = 0; k <= W; k += 10) {
    g.strokeStyle = '#a07a4a';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x0 + k, top);
    g.lineTo(x0 + W / 2, top - 30);
    g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    g.fillStyle = vgrad(g, base - 4 - i * 1.6, base - 2.4 - i * 1.6, [[0, '#d0a878'], [1, '#9a7448']]);
    g.fillRect(x0 + W + 2 - i * 0.6, base - 4 - i * 1.6, 14, 1.6);
  }
}

// ---------------------------------------------------------------------------
// Casa
// ---------------------------------------------------------------------------
export function houseTex(st: Style, state: BuildState, v: number, wTiles: number, wealth: number): Tex {
  const W = wTiles * 16;
  const H = 118;
  const wb = Math.round(wealth * 3);
  return tex(`house:${st.wall}:${st.roof}:${st.shape}:${state}:${v % 3}:${wTiles}:${wb}`, W + 16 + DEPTH, H, W / 2 + 8, H - 4, (g) => {
    const R = rng(v * 131 + wTiles);
    const x0 = -W / 2;
    const base = 0;
    if (st.shape === 'redondo') return roundHut(g, R, W, st, state, v, wealth);
    if (state === 'destruida') return ruin(g, R, x0, base, W, st);
    const top = base - WALL_H;
    // Pared lateral en perspectiva.
    g.fillStyle = vgrad(g, top, base, [[0, shd(st.wall, 0.3)], [1, shd(st.wall, 0.42)]]);
    g.beginPath();
    g.moveTo(x0 + W, top);
    g.lineTo(x0 + W + DEPTH, top - DY);
    g.lineTo(x0 + W + DEPTH, base - DY);
    g.lineTo(x0 + W, base);
    g.fill();
    stoneBase(g, R, x0 + W, base - 8, DEPTH * 0.98, 7, true);
    // Fachada.
    plaster(g, R, x0, top, W, WALL_H, st.wall, state);
    stoneBase(g, R, x0, base - 8, W, 8);
    if (state !== 'quemada') {
      // Entramado de madera según la cultura.
      const t = st.trim;
      g.strokeStyle = t;
      g.lineCap = 'butt';
      const beam = (x1: number, y1: number, x2: number, y2: number, w: number) => {
        g.strokeStyle = shd(t, 0.2);
        g.lineWidth = w + 0.5;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        g.strokeStyle = t;
        g.lineWidth = w;
        g.stroke();
      };
      beam(x0, top + 1.2, x0 + W, top + 1.2, 2.6);
      beam(x0 + 1.2, top, x0 + 1.2, base - 8, 2.4);
      beam(x0 + W - 1.2, top, x0 + W - 1.2, base - 8, 2.4);
      if (st.shape === 'dos-aguas') {
        beam(x0, top + WALL_H / 2 - 4, x0 + W, top + WALL_H / 2 - 4, 1.8);
        beam(x0 + W / 2 - 14, top, x0 + W / 2 - 4, top + WALL_H / 2 - 4, 1.5);
        beam(x0 + W / 2 + 14, top, x0 + W / 2 + 4, top + WALL_H / 2 - 4, 1.5);
      } else if (st.shape === 'alto') for (let k = x0 + 14; k < x0 + W - 6; k += 14) beam(k, top, k, base - 8, 1.3);
      g.lineCap = 'round';
    }
    for (const wr of houseWindows(wTiles)) window_(g, wr.x, base + wr.y, wr.w, wr.h, st.trim, state, wealth, wealth > 0.45 && v % 2 === 0);
    door(g, -9, base - 44, 18, 36, st.trim, state);
    // Sombra del alero sobre el muro.
    g.fillStyle = vgrad(g, top, top + 7, [[0, 'rgba(20,12,10,0.4)'], [1, 'rgba(20,12,10,0)']]);
    g.fillRect(x0, top, W, 7);
    if (state === 'obra') {
      scaffold(g, x0, top, base, W);
      return;
    }
    const tall = roof(g, R, x0, top, W, st.roof, st.shape, state);
    // Chimenea.
    if (state !== 'quemada' && st.shape !== 'plano') {
      const cx = x0 + W - 22 - (v % 2) * 20;
      g.fillStyle = vgrad(g, top - tall - 10, top - tall * 0.4, [[0, '#9a9286'], [1, '#6a6458']]);
      g.fillRect(cx, top - tall - 8, 9, tall * 0.55);
      g.fillStyle = shd('#8a8274', 0.3);
      g.fillRect(cx + 9, top - tall - 8, 3, tall * 0.55);
      g.fillStyle = '#5a544a';
      g.fillRect(cx - 1.5, top - tall - 10, 13, 3);
    }
    if (state === 'quemada') {
      // Hueco del tejado quemado con vigas carbonizadas.
      blob(g, [x0 + W * 0.25, top - tall * 0.15, x0 + W * 0.45, top - tall * 0.75, x0 + W * 0.65, top - tall * 0.7, x0 + W * 0.7, top - tall * 0.05], '#0e0b09', 0.5);
      for (let k = 0; k < 4; k++) {
        g.strokeStyle = '#3a2a1e';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x0 + W * 0.3 + k * 7, top - tall * 0.15);
        g.lineTo(x0 + W * 0.36 + k * 7, top - tall * 0.65);
        g.stroke();
      }
      blob(g, [x0 + W * 0.1, top + 4, x0 + W * 0.4, top - 4, x0 + W * 0.45, top + 18, x0 + W * 0.15, top + 22], 'rgba(20,16,14,0.45)', 0.6);
    }
    if (state === 'abandonada' || state === 'deteriorada') {
      // La hiedra trepa por la esquina.
      for (let i = 0; i < 18; i++) ell(g, x0 + 2 + R() * 8, base - R() * WALL_H * 0.8, 1.6, 1.2, R() < 0.5 ? '#4f6a34' : '#6a8a44');
    }
    if (state === 'normal' && v % 3 === 1) {
      // Leña junto a la casa.
      for (let i = 0; i < 6; i++) {
        const lx = x0 + W - 8 + (i % 3) * 3.4;
        const ly = base - 2.6 - Math.floor(i / 3) * 3;
        ell(g, lx, ly, 1.8, 1.5, '#8a6440');
        ell(g, lx, ly, 0.9, 0.8, '#c8a070');
      }
    }
    if (wealth > 0.6 && state === 'normal') {
      // Farol de hierro junto a la puerta.
      g.fillStyle = '#2a2420';
      g.fillRect(9.5, base - 34, 4, 1);
      g.fillStyle = vgrad(g, base - 33, base - 27, [[0, '#f8e8b0'], [1, '#c89040']]);
      g.fillRect(11, base - 33, 3, 5);
    }
  });
}

function roundHut(g: CanvasRenderingContext2D, R: () => number, W: number, st: Style, state: BuildState, v: number, wealth: number): void {
  const top = -40;
  const x0 = -W / 2;
  g.fillStyle = vgrad(g, top, 0, [[0, lit(st.wall, 0.05)], [1, shd(st.wall, 0.2)]]);
  g.beginPath();
  g.moveTo(x0 + 2, top);
  g.lineTo(x0 + W - 2, top);
  g.lineTo(x0 + W - 2, -6);
  g.quadraticCurveTo(0, 2, x0 + 2, -6);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(30,20,30,0.18)';
  g.fillRect(W * 0.2, top, W * 0.3 - 2, 40);
  window_(g, x0 + 12, -32, 11, 11, st.trim, state, wealth, false);
  door(g, -9, -38, 18, 34, st.trim, state);
  if (state === 'obra') return scaffold(g, x0, top, 0, W);
  thatch(g, R, 0, top, W, st.roof, state);
  void v;
}

function ruin(g: CanvasRenderingContext2D, R: () => number, x0: number, base: number, W: number, st: Style): void {
  // Restos: muros a medio caer, vigas quemadas y escombros.
  const h1 = 18 + R() * 14;
  const h2 = 8 + R() * 10;
  plaster(g, R, x0, base - h1, W * 0.35, h1, st.wall, 'destruida');
  plaster(g, R, x0 + W * 0.65, base - h2, W * 0.35, h2, st.wall, 'destruida');
  stoneBase(g, R, x0, base - 8, W, 8);
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = '#2a1e16';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(x0 + W * (0.2 + i * 0.18), base - 2);
    g.lineTo(x0 + W * (0.3 + i * 0.15), base - 14 - R() * 10);
    g.stroke();
  }
  for (let i = 0; i < 14; i++) ell(g, x0 + R() * W, base - R() * 4, 1.5 + R() * 2.5, 1 + R() * 1.5, R() < 0.5 ? '#8a8274' : '#6a5a4a');
}

// ---------------------------------------------------------------------------
// Edificios principales
// ---------------------------------------------------------------------------
const KEY_DIMS: Record<string, [number, number]> = { salon: [128, 150], almacen: [96, 120], posada: [96, 140], templo: [96, 150], forja: [80, 116], hogar: [80, 116], establo: [96, 96], granero: [80, 128] };

export function keyTex(kind: string, st: Style, extra = '', wealth = 0.5): Tex {
  const [W, H] = KEY_DIMS[kind] ?? [80, 110];
  return tex(`key:${kind}:${st.roof}:${st.wall}:${st.shape}:${extra}:${Math.round(wealth * 3)}`, W + 20 + DEPTH, H, W / 2 + 10, H - 4, (g) => {
    const R = rng(kind.length * 977 + W);
    const x0 = -W / 2;
    const base = 0;
    const side = (top: number, c: string) => {
      g.fillStyle = vgrad(g, top, base, [[0, shd(c, 0.3)], [1, shd(c, 0.45)]]);
      g.beginPath();
      g.moveTo(x0 + W, top);
      g.lineTo(x0 + W + DEPTH, top - DY);
      g.lineTo(x0 + W + DEPTH, base - DY);
      g.lineTo(x0 + W, base);
      g.fill();
    };
    const eave = (top: number) => {
      g.fillStyle = vgrad(g, top, top + 7, [[0, 'rgba(20,12,10,0.4)'], [1, 'rgba(20,12,10,0)']]);
      g.fillRect(x0, top, W, 7);
    };
    const planks = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = vgrad(g, y, y + h, [[0, lit(c, 0.06)], [1, shd(c, 0.2)]]);
      g.fillRect(x, y, w, h);
      for (let k = x + 3; k < x + w; k += 5) {
        g.fillStyle = alpha(shd(c, 0.4), 0.5);
        g.fillRect(k, y, 0.6, h);
        g.fillStyle = alpha(lit(c, 0.15), 0.4);
        g.fillRect(k + 0.6, y, 0.5, h);
      }
    };
    switch (kind) {
      case 'salon': {
        const top = base - 62;
        side(top, st.wall);
        plaster(g, R, x0, top, W, 62, st.wall, 'normal');
        stoneBase(g, R, x0, base - 12, W, 12);
        // Columnas con fuste sombreado y capitel.
        for (const cx of [x0 + 14, x0 + 44, x0 + W - 44, x0 + W - 14]) {
          g.fillStyle = vgrad(g, top, base, [[0, '#ece4d4'], [1, '#bdb3a0']]);
          const gr = g.createLinearGradient(cx - 4, 0, cx + 4, 0);
          gr.addColorStop(0, '#c8bea8');
          gr.addColorStop(0.35, '#f4eee2');
          gr.addColorStop(1, '#a8a08c');
          g.fillStyle = gr;
          g.fillRect(cx - 4, top + 4, 8, 50);
          g.fillStyle = '#d4cab6';
          g.fillRect(cx - 6, top + 2, 12, 4);
          g.fillRect(cx - 6, top + 52, 12, 3);
        }
        window_(g, x0 + 22, base - 48, 12, 16, st.trim, 'normal', 1, false);
        window_(g, x0 + W - 34, base - 48, 12, 16, st.trim, 'normal', 1, false);
        door(g, -13, base - 46, 26, 34, st.trim, 'normal', true);
        g.fillStyle = vgrad(g, base - 6, base, [[0, '#b8b0a0'], [1, '#8a8274']]);
        g.fillRect(-22, base - 6, 44, 3);
        g.fillRect(-26, base - 3, 52, 3);
        eave(top);
        roof(g, R, x0, top, W, st.roof, 'dos-aguas', 'normal');
        for (const bx of [x0 + 30, x0 + W - 30]) {
          g.strokeStyle = '#5a3a22';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(bx, top - 2);
          g.lineTo(bx, top + 26);
          g.stroke();
          const ban = extra || '#a3362b';
          g.fillStyle = vgrad(g, top, top + 22, [[0, lit(ban, 0.15)], [1, shd(ban, 0.25)]]);
          g.beginPath();
          g.moveTo(bx - 6, top);
          g.lineTo(bx + 6, top);
          g.lineTo(bx + 6, top + 22);
          g.lineTo(bx, top + 18);
          g.lineTo(bx - 6, top + 22);
          g.fill();
          ell(g, bx, top + 9, 2.4, 2.4, '#e2b84a');
        }
        break;
      }
      case 'almacen': {
        const top = base - 54;
        side(top, '#a8845a');
        planks(x0, top, W, 54, '#a8845a');
        g.fillStyle = vgrad(g, base - 42, base, [[0, '#3a2818'], [1, '#2a1c10']]);
        g.fillRect(-18, base - 40, 36, 40);
        g.strokeStyle = '#6b4a2e';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-18, base - 40);
        g.lineTo(18, base);
        g.moveTo(18, base - 40);
        g.lineTo(-18, base);
        g.stroke();
        g.fillStyle = '#6b4a2e';
        g.fillRect(-18, base - 42, 36, 3);
        eave(top);
        roof(g, R, x0, top, W, st.roof, 'dos-aguas', 'normal');
        if (extra !== 'vacio') {
          for (const [sx, sy] of [[x0 - 4, base - 6], [x0 + 6, base - 4], [x0 + 1, base - 13], [x0 + W - 6, base - 5], [x0 + W + 3, base - 6], [x0 + W - 1, base - 13]]) {
            ell(g, sx, sy, 6, 5, vgrad(g, sy - 5, sy + 5, [[0, '#e8d4a0'], [1, '#a88a5a']]));
            g.strokeStyle = '#8a6a3a';
            g.lineWidth = 0.6;
            g.beginPath();
            g.moveTo(sx - 3, sy - 3.5);
            g.lineTo(sx + 3, sy - 3.5);
            g.stroke();
          }
        } else {
          g.fillStyle = '#6a4a2a';
          g.fillRect(x0 + 2, base - 8, 10, 8);
        }
        break;
      }
      case 'posada': {
        const top = base - 72;
        side(top, st.wall);
        plaster(g, R, x0, top, W, 72, st.wall, 'normal');
        g.fillStyle = st.trim;
        g.fillRect(x0, top + 35, W, 2.6);
        stoneBase(g, R, x0, base - 8, W, 8);
        for (const wx of [x0 + 12, x0 + W - 26]) {
          window_(g, wx, top + 12, 13, 14, st.trim, 'normal', wealth, true);
          window_(g, wx, top + 46, 13, 14, st.trim, 'normal', wealth, false);
        }
        door(g, -10, base - 44, 20, 36, st.trim, 'normal');
        eave(top);
        roof(g, R, x0, top, W, st.roof, st.shape === 'redondo' ? 'dos-aguas' : st.shape, 'normal');
        // Cartel con una jarra.
        g.strokeStyle = '#4a3020';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x0 + W - 2, top + 30);
        g.lineTo(x0 + W + 13, top + 30);
        g.stroke();
        g.fillStyle = vgrad(g, top + 32, top + 44, [[0, '#d8b070'], [1, '#9a7038']]);
        g.fillRect(x0 + W + 3, top + 32, 14, 12);
        g.fillStyle = '#7a4a1e';
        g.fillRect(x0 + W + 6.5, top + 35, 6, 7);
        ell(g, x0 + W + 9.5, top + 35, 3, 1, '#f2ead4');
        for (const bx of [x0 - 4, x0 + 4]) {
          ell(g, bx, base - 6, 5, 7, vgrad(g, base - 13, base, [[0, '#a07850'], [1, '#6a4a2a']]));
          g.strokeStyle = '#3a2a1a';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(bx - 5, base - 9);
          g.lineTo(bx + 5, base - 9);
          g.stroke();
        }
        break;
      }
      case 'templo': {
        const top = base - 60;
        side(top, '#e2dacb');
        plaster(g, R, x0 + 4, top, W - 8, 60, '#e2dacb', 'normal');
        stoneBase(g, R, x0, base - 10, W, 10);
        for (let cx = x0 + 12; cx < x0 + W - 6; cx += 18) {
          const gr = g.createLinearGradient(cx - 3.5, 0, cx + 3.5, 0);
          gr.addColorStop(0, '#cfc6b4');
          gr.addColorStop(0.35, '#faf6ee');
          gr.addColorStop(1, '#b0a894');
          g.fillStyle = gr;
          g.fillRect(cx - 3.5, top + 6, 7, 44);
          g.fillStyle = '#d4ccbc';
          g.fillRect(cx - 5, top + 4, 10, 3);
        }
        door(g, -10, base - 44, 20, 34, '#7a6a5a', 'normal', true);
        g.fillStyle = vgrad(g, top - 18, top + 4, [[0, '#ded6c6'], [1, '#bab2a0']]);
        g.beginPath();
        g.moveTo(x0 - 2, top + 4);
        g.lineTo(x0 + W + 2, top + 4);
        g.lineTo(0, top - 18);
        g.fill();
        // Cúpula con brillo.
        const dg = g.createRadialGradient(-10, top - 30, 2, 0, top - 16, W / 2);
        dg.addColorStop(0, lit(st.roof, 0.35));
        dg.addColorStop(0.5, st.roof);
        dg.addColorStop(1, shd(st.roof, 0.35));
        g.fillStyle = dg;
        g.beginPath();
        g.ellipse(0, top - 16, W / 2 - 14, 28, 0, Math.PI, 0);
        g.fill();
        g.fillStyle = vgrad(g, top - 62, top - 42, [[0, '#f8e090'], [1, '#c89a3a']]);
        g.fillRect(-1.5, top - 60, 3, 18);
        ell(g, 0, top - 62, 4, 4, '#f0d070');
        break;
      }
      case 'forja': {
        const top = base - 46;
        side(top, '#7a7266');
        stoneBase(g, R, x0, top, W, 46);
        // El fuego tiñe la piedra de alrededor de la boca.
        const tint = g.createRadialGradient(x0 + 34, base - 10, 6, x0 + 34, base - 10, 44);
        tint.addColorStop(0, 'rgba(255,150,60,0.42)');
        tint.addColorStop(1, 'rgba(255,120,40,0)');
        g.fillStyle = tint;
        g.fillRect(x0, top, W, 46);
        // Boca de la fragua: arco de ladrillo, fondo de hollín, lecho de brasas con ascuas,
        // herramientas colgadas y el fuelle (antes, un rectángulo negro con un degradado).
        g.fillStyle = '#1e1814';
        g.beginPath();
        g.moveTo(x0 + 14, base);
        g.lineTo(x0 + 14, base - 24);
        g.quadraticCurveTo(x0 + 34, base - 38, x0 + 54, base - 24);
        g.lineTo(x0 + 54, base);
        g.fill();
        g.strokeStyle = '#8a4a32';
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(x0 + 13, base);
        g.lineTo(x0 + 13, base - 24);
        g.quadraticCurveTo(x0 + 34, base - 39.5, x0 + 55, base - 24);
        g.lineTo(x0 + 55, base);
        g.stroke();
        // Juntas de las dovelas, dentro del propio arco (antes salían hacia fuera y se leían como pinchos).
        g.strokeStyle = alpha('#3a1e14', 0.55);
        g.lineWidth = 0.5;
        for (let k = 1; k < 8; k++) {
          const u = k / 8;
          // Punto de la curva del arco (Bézier cuadrática) y su normal.
          const px = (1 - u) * (1 - u) * (x0 + 13) + 2 * u * (1 - u) * (x0 + 34) + u * u * (x0 + 55);
          const py = (1 - u) * (1 - u) * (base - 24) + 2 * u * (1 - u) * (base - 39.5) + u * u * (base - 24);
          const tx = 2 * (1 - u) * 21 + 2 * u * 21;
          const ty = 2 * (1 - u) * -15.5 + 2 * u * 15.5;
          const n = Math.hypot(tx, ty);
          g.beginPath();
          g.moveTo(px - (ty / n) * 1.2, py + (tx / n) * 1.2);
          g.lineTo(px + (ty / n) * 1.2, py - (tx / n) * 1.2);
          g.stroke();
        }
        const fg = g.createRadialGradient(x0 + 34, base - 8, 1, x0 + 34, base - 8, 18);
        fg.addColorStop(0, '#ffe8a0');
        fg.addColorStop(0.3, '#f08a3a');
        fg.addColorStop(1, 'rgba(120,30,10,0)');
        g.fillStyle = fg;
        g.fillRect(x0 + 14, base - 34, 40, 34);
        // Lecho de brasas: carbón oscuro y ascuas que brillan entre los trozos.
        for (let k = 0; k < 18; k++) {
          const bx = x0 + 20 + R() * 28;
          const by = base - 5 - R() * 4;
          // Casi todas encendidas, con algún trozo apagado entre ellas.
          const lit2 = R();
          // Trozos de carbón con aristas (no bolas): un cuadrilátero irregular girado.
          const rr = 1.4 + R() * 0.9;
          const a0 = R() * Math.PI;
          g.fillStyle = lit2 < 0.25 ? '#3a2018' : lit2 < 0.7 ? '#e0701e' : '#ffc860';
          g.beginPath();
          for (let q = 0; q < 4; q++) {
            const a = a0 + q * (Math.PI / 2) + (R() - 0.5) * 0.6;
            const d = rr * (0.7 + R() * 0.4);
            g.lineTo(bx + Math.cos(a) * d, by + Math.sin(a) * d * 0.65);
          }
          g.fill();
          if (lit2 >= 0.25) {
            g.fillStyle = 'rgba(255,240,190,0.75)';
            g.fillRect(bx - 0.5, by - 0.4, 1, 0.6);
          }
        }
        // Herramientas colgadas en la pared del fondo.
        g.strokeStyle = '#4a4a4e';
        g.lineWidth = 1;
        for (const [tx, len] of [[x0 + 22, 9], [x0 + 27, 11], [x0 + 44, 8]] as const) {
          g.beginPath();
          g.moveTo(tx, base - 28);
          g.lineTo(tx, base - 28 + len);
          g.stroke();
          g.fillStyle = '#5a5a60';
          g.fillRect(tx - 1.5, base - 28 + len, 3, 1.6);
        }
        // Fuelle de cuero junto a la boca.
        g.fillStyle = vgrad(g, base - 14, base - 4, [[0, '#7a5232'], [1, '#4a301c']]);
        g.beginPath();
        g.moveTo(x0 + 56, base - 12);
        g.lineTo(x0 + 66, base - 15);
        g.lineTo(x0 + 66, base - 5);
        g.lineTo(x0 + 56, base - 7);
        g.fill();
        g.fillStyle = vgrad(g, top - 26, top + 4, [[0, lit(st.roof, 0.1)], [1, shd(st.roof, 0.25)]]);
        g.beginPath();
        g.moveTo(x0 - 6, top + 4);
        g.lineTo(x0 + W + 6, top + 4);
        g.lineTo(x0 + W - 4, top - 26);
        g.lineTo(x0 + 4, top - 26);
        g.fill();
        // Hiladas de teja (antes era un trapecio liso que se leía como chapa).
        g.save();
        g.clip();
        for (let y = top - 24, row = 0; y < top + 4; y += 5, row++) {
          g.fillStyle = alpha(shd(st.roof, 0.45), 0.55);
          g.fillRect(x0 - 6, y + 3.4, W + 12, 1.1);
          for (let x = x0 - 6 + (row % 2) * 3.5; x < x0 + W + 6; x += 7) {
            g.fillStyle = alpha(lit(st.roof, 0.18), 0.5);
            g.beginPath();
            g.ellipse(x + 3.5, y + 3.2, 3.1, 1.6, 0, Math.PI, 0);
            g.fill();
          }
        }
        g.fillStyle = alpha(shd(st.roof, 0.5), 0.8);
        g.fillRect(x0 + 2, top - 27, W - 4, 2);
        g.restore();
        g.fillStyle = vgrad(g, top - 50, top, [[0, '#7a7268'], [1, '#5a544c']]);
        g.fillRect(x0 + W - 22, top - 48, 14, 44);
        g.fillStyle = '#4a443e';
        g.fillRect(x0 + W - 24, top - 50, 18, 4);
        g.fillStyle = vgrad(g, base - 10, base - 6, [[0, '#6a6e76'], [1, '#2a2c32']]);
        g.beginPath();
        g.moveTo(x0 + W - 14, base - 10);
        g.lineTo(x0 + W + 6, base - 10);
        g.lineTo(x0 + W + 2, base - 6);
        g.lineTo(x0 + W - 10, base - 6);
        g.fill();
        g.fillStyle = '#2a2c32';
        g.fillRect(x0 + W - 6, base - 6, 5, 6);
        break;
      }
      case 'hogar': {
        const top = base - WALL_H;
        side(top, '#efdcb6');
        plaster(g, R, x0, top, W, WALL_H, '#efdcb6', 'normal');
        stoneBase(g, R, x0, base - 8, W, 8);
        g.fillStyle = '#7a4a28';
        g.fillRect(x0, top, W, 2.6);
        for (const wr of houseWindows(5)) window_(g, wr.x, base + wr.y, wr.w, wr.h, '#2f5f63', 'normal', wealth, true);
        door(g, -9, base - 44, 18, 36, '#2f5f63', 'normal');
        eave(top);
        roof(g, R, x0, top, W, '#9c5b34', 'dos-aguas', 'normal');
        ell(g, 0, top - 10, 5, 5, '#e9b44c');
        // Huerto con valla.
        for (let k = 0; k < 7; k++) {
          g.fillStyle = vgrad(g, base - 10, base, [[0, '#b8946a'], [1, '#7a5a38']]);
          g.fillRect(x0 - 8 + k * 4, base - 10, 1.6, 10);
        }
        for (let k = 0; k < 4; k++) ell(g, x0 - 4 + k * 6, base - 3, 2.6, 2, '#5f923f');
        break;
      }
      case 'establo': {
        const top = base - 40;
        side(top, '#8a6440');
        planks(x0, top, W, 40, '#8a6440');
        for (let i = 0; i < 3; i++) {
          const sx = x0 + 10 + i * 28;
          g.fillStyle = '#2a1e14';
          g.fillRect(sx, base - 26, 20, 26);
          g.fillStyle = '#6b4a2e';
          g.fillRect(sx, base - 14, 20, 3);
          ell(g, sx + 10, base - 22, 4, 6, ['#6b4a30', '#3a2a20', '#c9b08a'][i]);
          ell(g, sx + 11.5, base - 24, 0.8, 0.8, '#111');
        }
        // Tejado de tejas como el de las casas (con su faldón lateral), no un trapecio liso.
        eave(top);
        roof(g, R, x0, top, W, st.roof, 'dos-aguas', 'normal');
        break;
      }
      case 'granero': {
        const top = base - 60;
        side(top, '#9a4a36');
        planks(x0, top, W, 60, '#9a4a36');
        g.fillStyle = '#4a2218';
        g.fillRect(-14, base - 36, 28, 36);
        g.strokeStyle = '#e8dcc0';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-14, base - 36);
        g.lineTo(14, base);
        g.moveTo(14, base - 36);
        g.lineTo(-14, base);
        g.stroke();
        g.fillStyle = '#2a1410';
        g.fillRect(-8, top + 8, 16, 12);
        ell(g, 0, top + 16, 6, 3, '#e3c56a');
        // Tejado alto de pizarra, con hileras y cumbrera.
        eave(top);
        roof(g, R, x0, top, W, '#5e5650', 'alto', 'normal');
        for (const hx of [x0 - 6, x0 + W + 4]) ell(g, hx, base - 8, 9, 8, vgrad(g, base - 16, base, [[0, '#f0d880'], [1, '#b8963a']]));
        break;
      }
    }
  });
}

/**
 * Variante nevada de un edificio: un manto de nieve sobre todo lo que queda
 * por encima de `cutY` (el tejado), solo donde ya hay pintura, con el borde
 * del alero irregular y algún carámbano.
 */
const snowIds = new WeakMap<HTMLCanvasElement, number>();
let snowNext = 1;
export function snowCapped(t: Tex, cutY: number): Tex {
  let id = snowIds.get(t.canvas);
  if (!id) snowIds.set(t.canvas, (id = snowNext++));
  return tex(`nieve:${id}`, t.w, t.h, t.ax, t.ay, (g) => {
    g.drawImage(t.canvas, -t.ax, -t.ay, t.w, t.h);
    const R = rng(t.w * 31 + t.h);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    const gr = g.createLinearGradient(0, -t.ay, 0, cutY);
    gr.addColorStop(0, 'rgba(246,250,255,0.95)');
    gr.addColorStop(1, 'rgba(214,226,242,0.92)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-t.ax, -t.ay);
    g.lineTo(t.w - t.ax, -t.ay);
    // Borde inferior ondulado (la nieve no acaba en línea recta).
    for (let x = t.w - t.ax; x >= -t.ax; x -= 3) g.lineTo(x, cutY - 1.5 + R() * 3);
    g.closePath();
    g.fill();
    // Ventisqueros y sombras azuladas.
    for (let i = 0; i < 18; i++) ell(g, -t.ax + R() * t.w, -t.ay + R() * (cutY + t.ay), 3 + R() * 6, 0.8 + R(), 'rgba(150,170,205,0.28)');
    g.restore();
    // Bajo la nieve se adivinan las tejas, la cumbrera y la chimenea.
    g.save();
    g.beginPath();
    g.rect(-t.ax, -t.ay, t.w, cutY + t.ay);
    g.clip();
    g.globalAlpha = 0.15; // (más: las tejas asomaban y el manto se veía malva, no blanco)
    g.drawImage(t.canvas, -t.ax, -t.ay, t.w, t.h);
    g.restore();
    // Carámbanos bajo el alero.
    g.fillStyle = 'rgba(220,235,250,0.85)';
    for (let x = -t.ax + 6; x < t.w - t.ax - 6; x += 5 + R() * 9) {
      const l = 1.5 + R() * 4;
      g.beginPath();
      g.moveTo(x - 0.8, cutY + 1);
      g.lineTo(x + 0.8, cutY + 1);
      g.lineTo(x, cutY + 1 + l);
      g.fill();
    }
  });
}
