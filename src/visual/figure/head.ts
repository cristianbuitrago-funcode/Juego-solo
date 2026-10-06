import type { Appearance } from '../../render/appearance';
import { alpha, blob, ell, lit, mix, rgbOf, shd, smoothPath } from '../paint';
import type { Body } from './body';
import type { Expr, Facing } from './types';

/**
 * Cabezas y rostros pintados. Una cara es lo que más se mira en un juego de
 * personas: ojos con esclerótica, iris, pupila y brillo; párpados que se
 * cierran, se entornan o se abren de golpe; cejas que suben, se juntan o se
 * caen; bocas que sonríen, aprietan los dientes o tiemblan. Cada expresión
 * es una combinación concreta de esas piezas, y la edad y los rasgos de
 * cada persona (mandíbula, nariz, separación de ojos, arrugas) hacen que no
 * haya dos iguales.
 */
type Eyes = 'open' | 'wide' | 'half' | 'squint' | 'happy' | 'closed' | 'tired' | 'sad' | 'smile';
type Brows = 'flat' | 'angry' | 'worried' | 'up' | 'asym' | 'sad' | 'low' | 'relaxed';
type Mouth = 'flat' | 'smile' | 'grin' | 'frown' | 'o' | 'O' | 'teeth' | 'wavy' | 'smirk' | 'soft' | 'tired' | 'pout';

export interface FaceSpec {
  eyes: Eyes;
  brows: Brows;
  mouth: Mouth;
  blush?: number;
  tear?: boolean;
  sweat?: boolean;
  pale?: boolean;
  bags?: boolean;
  look?: number; // dirección de la mirada (-1..1)
}

export const FACES: Record<Expr, FaceSpec> = {
  neutral: { eyes: 'open', brows: 'flat', mouth: 'flat' },
  feliz: { eyes: 'smile', brows: 'relaxed', mouth: 'grin', blush: 0.4 },
  alivio: { eyes: 'happy', brows: 'relaxed', mouth: 'smile', blush: 0.3 },
  preocupado: { eyes: 'open', brows: 'worried', mouth: 'wavy', sweat: true, look: 0.4 },
  enfadado: { eyes: 'open', brows: 'angry', mouth: 'frown', blush: 0.25 },
  hostil: { eyes: 'squint', brows: 'angry', mouth: 'teeth' },
  miedo: { eyes: 'wide', brows: 'worried', mouth: 'o', sweat: true, pale: true, look: -0.5 },
  triste: { eyes: 'sad', brows: 'sad', mouth: 'frown', tear: true },
  sorpresa: { eyes: 'wide', brows: 'up', mouth: 'O' },
  desconfianza: { eyes: 'squint', brows: 'asym', mouth: 'pout', look: 0.7 },
  cansado: { eyes: 'tired', brows: 'low', mouth: 'tired', bags: true },
  confiado: { eyes: 'half', brows: 'relaxed', mouth: 'smirk' },
};

const DARK = 'rgb(46,30,30)';

interface HeadOpts {
  blink: boolean;
  talk: boolean;
  hood: boolean;
  lod: 0 | 1 | 2;
  wet?: boolean;
}

/** Contorno de la cara de frente (cerrado), en coordenadas de la cabeza (centro del cráneo en 0,0). */
function faceOutline(ap: Appearance, B: Body): number[] {
  const H = B.head;
  const W = B.headW;
  const top = -H * 0.55;
  const chin = H * 0.45;
  const jaw = B.child ? 1.12 : ap.jaw;
  const len = B.child ? 0.92 : ap.faceLen;
  const c = chin * len;
  return [
    0, top,
    W * 0.74, top + H * 0.07,
    W * 1.0, top + H * 0.32,
    W * 1.02, -H * 0.02,
    W * 0.96 * (0.92 + jaw * 0.08), H * 0.16,
    W * 0.74 * jaw, c * 0.7,
    W * 0.38 * (0.85 + jaw * 0.15), c * 0.96,
    0, c,
    -W * 0.38 * (0.85 + jaw * 0.15), c * 0.96,
    -W * 0.74 * jaw, c * 0.7,
    -W * 0.96 * (0.92 + jaw * 0.08), H * 0.16,
    -W * 1.02, -H * 0.02,
    -W * 1.0, top + H * 0.32,
    -W * 0.74, top + H * 0.07,
  ];
}

/** Perfil de la cara mirando a la derecha (cerrado). */
function sideOutline(ap: Appearance, B: Body): number[] {
  const H = B.head;
  const W = B.headW;
  const top = -H * 0.55;
  const chin = H * 0.45 * (B.child ? 0.92 : ap.faceLen);
  const nose = B.child ? 0.25 : 0.4 + ap.nose * 0.18;
  return [
    -W * 0.2, top,
    W * 0.55, top + H * 0.08,
    W * 0.92, top + H * 0.33,
    W * 1.0, -H * 0.06, // frente
    W * 0.94, H * 0.02, // entrecejo
    W * (1.0 + nose * 0.45), H * 0.2, // punta de la nariz
    W * 0.95, H * 0.27,
    W * 0.98, H * 0.33, // labios
    W * 0.9, H * 0.38,
    W * 0.86, chin * 0.88, // barbilla
    W * 0.5, chin,
    W * 0.05, chin * 0.82, // mandíbula
    -W * 0.35, H * 0.18,
    -W * 0.95, -H * 0.02, // nuca
    -W * 0.92, top + H * 0.25,
  ];
}

/** Pinta la cabeza completa (sin el pelo largo de detrás, que va en otra capa). */
export function paintHead(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, face: FaceSpec, o: HeadOpts): void {
  const H = B.head;
  const W = B.headW;
  const skin = face.pale ? mix(ap.skin, '#e8e4e0', 0.25) : rgbOf(ap.skin);
  const skinS = skin;
  if (facing === 'back') {
    ears(g, ap, B, 'back', skinS);
    blob(g, faceOutline(ap, B), shadeFill(g, skinS, W, H, true));
    hairFront(g, ap, B, 'back', o);
    if (o.hood) hood(g, ap, B, 'back');
    else hat(g, ap, B, 'back');
    return;
  }
  if (facing === 'side') {
    g.save();
    const pts = sideOutline(ap, B);
    blob(g, pts, shadeFill(g, skinS, W, H, false, true), 0.45);
    // Sombra de la mandíbula y cuello.
    g.save();
    g.beginPath();
    smoothPath(g, pts, true, 0.45);
    g.clip();
    ell(g, -W * 0.15, H * 0.42, W * 0.9, H * 0.18, alpha(shd(skinS, 0.3), 0.55));
    ell(g, W * 0.75, H * 0.1, W * 0.18, H * 0.1, alpha(mix(skinS, '#d06050', 0.25), (face.blush ?? 0) * 0.5 + 0.12));
    g.restore();
    ears(g, ap, B, 'side', skinS);
    if (o.lod === 0) ageLines(g, ap, B, 'side');
    sideFeatures(g, ap, B, face, o);
    beard(g, ap, B, 'side');
    hairFront(g, ap, B, 'side', o);
    if (o.hood) hood(g, ap, B, 'side');
    else hat(g, ap, B, 'side');
    g.restore();
    return;
  }
  // De frente.
  ears(g, ap, B, 'front', skinS);
  const pts = faceOutline(ap, B);
  blob(g, pts, shadeFill(g, skinS, W, H, false));
  g.save();
  g.beginPath();
  smoothPath(g, pts, true, 0.5);
  g.clip();
  // Volumen: sombra lateral, pómulos cálidos, mandíbula.
  const sideShade = g.createLinearGradient(-W, 0, W, 0);
  sideShade.addColorStop(0, alpha(lit(skinS, 0.15), 0.25));
  sideShade.addColorStop(0.55, 'rgba(0,0,0,0)');
  sideShade.addColorStop(1, alpha(shd(skinS, 0.35), 0.45));
  g.fillStyle = sideShade;
  g.fillRect(-W * 1.2, -H, W * 2.4, H * 2);
  ell(g, 0, H * 0.5, W * 0.95, H * 0.16, alpha(shd(skinS, 0.3), 0.4));
  const blush = 0.12 + (face.blush ?? 0);
  ell(g, -W * 0.55, H * 0.14, W * 0.26, H * 0.09, alpha(mix(skinS, '#d85a4a', 0.5), blush * 0.45));
  ell(g, W * 0.55, H * 0.14, W * 0.26, H * 0.09, alpha(mix(skinS, '#d85a4a', 0.5), blush * 0.4));
  if (o.lod === 0) ageLines(g, ap, B, 'front');
  if (ap.freckles && o.lod === 0) freckles(g, ap, B);
  g.restore();
  frontFeatures(g, ap, B, face, o);
  beard(g, ap, B, 'front');
  hairFront(g, ap, B, 'front', o);
  if (o.hood) hood(g, ap, B, 'front');
  else hat(g, ap, B, 'front');
}

/** Relleno de piel con luz cálida arriba a la izquierda y sombra fría abajo a la derecha. */
function shadeFill(g: CanvasRenderingContext2D, skin: [number, number, number], W: number, H: number, back: boolean, side = false): CanvasGradient {
  const gr = g.createRadialGradient(side ? W * 0.3 : -W * 0.35, -H * 0.2, W * 0.1, 0, 0, Math.max(W, H) * 1.05);
  gr.addColorStop(0, lit(skin, back ? 0.04 : 0.14));
  gr.addColorStop(0.55, `rgb(${skin.map(Math.round).join(',')})`);
  gr.addColorStop(1, shd(skin, 0.22));
  return gr;
}

function ears(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, skin: [number, number, number]): void {
  const H = B.head;
  const W = B.headW;
  const s = ap.ears * (B.child ? 1.08 : 1);
  if (facing === 'side') {
    ell(g, -W * 0.12, H * 0.06, W * 0.2 * s, H * 0.14 * s, shd(skin, 0.08));
    ell(g, -W * 0.1, H * 0.07, W * 0.1 * s, H * 0.08 * s, shd(skin, 0.28));
    return;
  }
  for (const sx of [-1, 1]) {
    ell(g, sx * W * 1.0, H * 0.06, W * 0.17 * s, H * 0.13 * s, shd(skin, facing === 'back' ? 0.05 : sx > 0 ? 0.2 : 0.04));
    if (facing === 'front') ell(g, sx * W * 1.02, H * 0.07, W * 0.07 * s, H * 0.07 * s, shd(skin, 0.3));
  }
}

function ageLines(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing): void {
  const k = ap.wrinkles;
  if (k <= 0.05) return;
  const H = B.head;
  const W = B.headW;
  g.strokeStyle = alpha(shd(ap.skin, 0.45), Math.min(0.7, k * 0.75));
  g.lineWidth = H * 0.018;
  g.beginPath();
  if (facing === 'front') {
    // Frente, patas de gallo y surcos junto a la boca.
    for (let i = 0; i < (k > 0.55 ? 3 : 2); i++) {
      const y = -H * (0.3 - i * 0.065);
      g.moveTo(-W * 0.45, y + H * 0.01);
      g.quadraticCurveTo(0, y - H * 0.02, W * 0.45, y + H * 0.01);
    }
    for (const sx of [-1, 1]) {
      g.moveTo(sx * W * 0.78, H * 0.03);
      g.lineTo(sx * W * 0.92, H * 0.0);
      g.moveTo(sx * W * 0.78, H * 0.07);
      g.lineTo(sx * W * 0.92, H * 0.08);
      g.moveTo(sx * W * 0.28, H * 0.2);
      g.quadraticCurveTo(sx * W * 0.42, H * 0.3, sx * W * 0.36, H * 0.38);
    }
  } else {
    g.moveTo(W * 0.4, -H * 0.27);
    g.quadraticCurveTo(W * 0.7, -H * 0.29, W * 0.88, -H * 0.25);
    g.moveTo(W * 0.62, H * 0.05);
    g.lineTo(W * 0.48, H * 0.08);
    g.moveTo(W * 0.78, H * 0.24);
    g.quadraticCurveTo(W * 0.7, H * 0.32, W * 0.74, H * 0.38);
  }
  g.stroke();
}

function freckles(g: CanvasRenderingContext2D, ap: Appearance, B: Body): void {
  const H = B.head;
  const W = B.headW;
  g.fillStyle = alpha(shd(ap.skin, 0.4), 0.55);
  for (let i = 0; i < 14; i++) {
    const sx = i % 2 ? 1 : -1;
    const x = sx * W * (0.25 + ((i * 37) % 10) / 22);
    const y = H * (0.07 + ((i * 53) % 10) / 70);
    g.beginPath();
    g.arc(x, y, H * 0.012, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------------------
// Rasgos de frente
// ---------------------------------------------------------------------------
function frontFeatures(g: CanvasRenderingContext2D, ap: Appearance, B: Body, face: FaceSpec, o: HeadOpts): void {
  const H = B.head;
  const W = B.headW;
  const eyeY = H * (B.child ? 0.11 : 0.07);
  const ex = W * 0.44 * ap.eye.spacing;
  const ew = W * 0.31 * ap.eye.size * (B.child ? 1.15 : 1);
  const eh = ew * 0.6;
  // Cuencas: un poco de sombra sobre los ojos da profundidad a la mirada.
  // (solo por encima: una sombra que rodea el ojo entero parecería unas gafas).
  for (const sx of [-1, 1]) ell(g, sx * ex, eyeY - eh * 0.85, ew * 1.25, eh * 0.75, alpha(shd(ap.skin, 0.3), 0.16));
  const eyes: Eyes = o.blink && face.eyes !== 'happy' ? 'closed' : face.eyes;
  for (const sx of [-1, 1]) eye(g, ap, sx * ex, eyeY, ew, eh, sx, eyes, face.look ?? 0, o.lod);
  if (face.bags) for (const sx of [-1, 1]) ell(g, sx * ex, eyeY + eh * 1.05, ew * 0.75, eh * 0.35, alpha(shd(ap.skin, 0.4), 0.35));
  brows(g, ap, B, ex, eyeY - eh * 1.25, ew, face.brows, o.lod > 0 ? 1.5 : 1);
  // Nariz: el puente se intuye por la sombra; la punta y las aletas, por la luz.
  const ny = H * (B.child ? 0.24 : 0.22);
  const nw = W * (0.13 + ap.nose * 0.04) * (B.child ? 0.8 : 1);
  // Lado en sombra del tabique.
  blob(g, [W * 0.06, eyeY + eh * 0.4, W * 0.16, ny - nw * 0.5, nw * 1.1, ny + nw * 0.15, W * 0.05, ny + nw * 0.1], alpha(shd(ap.skin, 0.35), 0.4), 0.5);
  g.strokeStyle = alpha(shd(ap.skin, 0.45), 0.6);
  g.lineWidth = H * 0.024;
  g.beginPath();
  g.moveTo(W * 0.1, eyeY + eh * 0.7);
  g.quadraticCurveTo(W * 0.16, ny - nw * 0.6, nw * 0.95, ny + nw * 0.05);
  g.stroke();
  // Aletas y orificios.
  ell(g, 0, ny + nw * 0.25, nw * 1.1, nw * 0.5, alpha(shd(ap.skin, 0.3), 0.45));
  ell(g, -nw * 0.45, ny + nw * 0.32, nw * 0.24, nw * 0.13, alpha(shd(ap.skin, 0.6), 0.75));
  ell(g, nw * 0.45, ny + nw * 0.32, nw * 0.24, nw * 0.13, alpha(shd(ap.skin, 0.6), 0.75));
  ell(g, -nw * 0.2, ny - nw * 0.05, nw * 0.5, nw * 0.32, alpha(lit(ap.skin, 0.35), 0.6));
  // Sombra bajo el labio inferior y hoyuelo de la barbilla.
  ell(g, 0, H * (B.child ? 0.4 : 0.385), W * 0.2, H * 0.025, alpha(shd(ap.skin, 0.35), 0.35));
  // Boca.
  const my = H * (B.child ? 0.33 : 0.315);
  const mw = W * 0.44 * ap.mouthW * (B.child ? 0.82 : 1) * (o.lod > 0 ? 1.15 : 1);
  mouth(g, ap, 0, my, mw, H * (o.lod > 0 ? 1.35 : 1), o.talk ? openOf(face.mouth) : face.mouth);
  if (face.tear) {
    ell(g, -ex + ew * 0.2, eyeY + eh * 1.6, H * 0.03, H * 0.05, 'rgba(190,225,255,0.85)');
    g.strokeStyle = 'rgba(190,225,255,0.6)';
    g.lineWidth = H * 0.02;
    g.beginPath();
    g.moveTo(-ex + ew * 0.2, eyeY + eh * 0.8);
    g.lineTo(-ex + ew * 0.22, eyeY + eh * 1.5);
    g.stroke();
  }
  if (face.sweat) {
    blob(g, [W * 0.8, -H * 0.24, W * 0.88, -H * 0.12, W * 0.8, -H * 0.06, W * 0.72, -H * 0.12], 'rgba(200,232,255,0.85)', 0.6);
  }
}

function openOf(m: Mouth): Mouth {
  if (m === 'smile' || m === 'soft' || m === 'smirk') return 'grin';
  if (m === 'frown' || m === 'teeth') return 'teeth';
  if (m === 'O' || m === 'o') return m;
  return 'o';
}

function eye(g: CanvasRenderingContext2D, ap: Appearance, x: number, y: number, w: number, h: number, sx: number, kind: Eyes, look: number, lod: number): void {
  const lid = shd(ap.skin, 0.12);
  const line = DARK;
  const lw = h * 0.3;
  if (kind === 'closed' || kind === 'happy') {
    g.strokeStyle = line;
    g.lineWidth = lw;
    g.beginPath();
    if (kind === 'happy') {
      g.moveTo(x - w, y + h * 0.15);
      g.quadraticCurveTo(x, y - h * 0.9, x + w, y + h * 0.15);
    } else {
      g.moveTo(x - w, y);
      g.quadraticCurveTo(x, y + h * 0.55, x + w, y);
    }
    g.stroke();
    return;
  }
  const wide = kind === 'wide';
  const hh = wide ? h * 1.25 : h;
  // Forma de almendra: la esquina exterior un poco más alta.
  const outer = sx;
  const shape = () => {
    g.beginPath();
    g.moveTo(x - w, y + (outer < 0 ? -hh * 0.08 : hh * 0.05));
    g.bezierCurveTo(x - w * 0.5, y - hh * 1.05, x + w * 0.5, y - hh * 1.05, x + w, y + (outer > 0 ? -hh * 0.08 : hh * 0.05));
    g.bezierCurveTo(x + w * 0.5, y + hh * 0.85, x - w * 0.5, y + hh * 0.85, x - w, y + (outer < 0 ? -hh * 0.08 : hh * 0.05));
    g.closePath();
  };
  g.save();
  shape();
  g.fillStyle = '#f3ede4';
  g.fill();
  g.clip();
  // Iris con anillo oscuro, pupila y brillo; la mirada se desplaza un poco.
  const ir = hh * (wide ? 0.62 : 0.78);
  const ix = x + look * w * 0.35;
  const iy = y + hh * 0.02;
  if (lod === 0) {
    const gr = g.createRadialGradient(ix - ir * 0.3, iy - ir * 0.3, ir * 0.1, ix, iy, ir);
    gr.addColorStop(0, lit(ap.eye.color, 0.35));
    gr.addColorStop(0.7, ap.eye.color);
    gr.addColorStop(1, shd(ap.eye.color, 0.55));
    ell(g, ix, iy, ir, ir, gr);
    ell(g, ix, iy, ir * 0.45, ir * 0.45, '#120c0c');
    ell(g, ix - ir * 0.35, iy - ir * 0.38, ir * 0.25, ir * 0.25, 'rgba(255,255,255,0.95)');
  } else ell(g, ix, iy, ir * 0.85, ir * 0.85, '#1e1414');
  // Sombra del párpado sobre el ojo.
  ell(g, x, y - hh * 0.95, w * 1.2, hh * 0.45, alpha(shd(ap.skin, 0.4), 0.35));
  // Párpados según el estado.
  const lidDrop = kind === 'half' ? 0.45 : kind === 'squint' ? 0.5 : kind === 'tired' ? 0.58 : kind === 'sad' ? 0.35 : 0;
  if (lidDrop > 0) {
    g.fillStyle = lid;
    g.beginPath();
    if (kind === 'sad') {
      // El párpado cae hacia fuera.
      g.moveTo(x - w * 1.1, y - hh * 1.2);
      g.lineTo(x + w * 1.1, y - hh * 1.2);
      g.lineTo(x + w * 1.1, y - hh * (outer > 0 ? -0.05 : 0.65));
      g.lineTo(x - w * 1.1, y - hh * (outer < 0 ? -0.05 : 0.65));
    } else if (kind === 'squint') {
      // Entornado y con el párpado inferior subido (enfado, recelo).
      g.moveTo(x - w * 1.1, y - hh * 1.2);
      g.lineTo(x + w * 1.1, y - hh * 1.2);
      g.lineTo(x + w * 1.1, y - hh * (outer > 0 ? 0.2 : -0.1));
      g.lineTo(x - w * 1.1, y - hh * (outer < 0 ? 0.2 : -0.1));
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(x - w * 1.1, y + hh * 1.2);
      g.lineTo(x + w * 1.1, y + hh * 1.2);
      g.lineTo(x + w * 1.1, y + hh * 0.45);
      g.lineTo(x - w * 1.1, y + hh * 0.45);
    } else {
      g.rect(x - w * 1.1, y - hh * 1.2, w * 2.2, hh * (2.2 * lidDrop + 0.1));
    }
    g.closePath();
    g.fill();
  }
  if (kind === 'smile') {
    // La mejilla empuja el párpado inferior: ojos que sonríen.
    g.fillStyle = lid;
    g.beginPath();
    g.moveTo(x - w * 1.1, y + hh * 1.2);
    g.lineTo(x - w * 1.1, y + hh * 0.35);
    g.quadraticCurveTo(x, y - hh * 0.2, x + w * 1.1, y + hh * 0.35);
    g.lineTo(x + w * 1.1, y + hh * 1.2);
    g.closePath();
    g.fill();
  }
  g.restore();
  // Línea del párpado superior (más gruesa) y pestañas.
  g.strokeStyle = line;
  g.lineWidth = lw;
  g.beginPath();
  const top = kind === 'half' || kind === 'tired' ? 0.2 : kind === 'squint' ? 0.35 : 1.05;
  if (kind === 'sad') {
    g.moveTo(x - w * 1.05, y - hh * (outer < 0 ? -0.05 : 0.6));
    g.lineTo(x + w * 1.05, y - hh * (outer > 0 ? -0.05 : 0.6));
  } else if (kind === 'squint') {
    g.moveTo(x - w * 1.05, y - hh * (outer < 0 ? 0.15 : -0.15));
    g.lineTo(x + w * 1.05, y - hh * (outer > 0 ? 0.15 : -0.15));
  } else {
    g.moveTo(x - w * 1.02, y);
    g.bezierCurveTo(x - w * 0.5, y - hh * top, x + w * 0.5, y - hh * top, x + w * 1.02, y + (outer > 0 ? -hh * 0.1 : 0));
  }
  g.stroke();
  if (ap.fem && lod === 0 && kind !== 'squint') {
    g.lineWidth = lw * 0.6;
    g.beginPath();
    g.moveTo(x + outer * w * 0.95, y - hh * 0.15);
    g.lineTo(x + outer * w * 1.25, y - hh * 0.4);
    g.stroke();
  }
  if (lod === 0) {
    // Pliegue del párpado y línea inferior suave.
    g.strokeStyle = alpha(shd(ap.skin, 0.4), 0.28);
    g.lineWidth = lw * 0.4;
    g.beginPath();
    g.moveTo(x - w * 0.8, y - hh * 1.25);
    g.quadraticCurveTo(x, y - hh * 1.65, x + w * 0.85, y - hh * 1.15);
    g.stroke();
  }
}

function brows(g: CanvasRenderingContext2D, ap: Appearance, B: Body, ex: number, y: number, ew: number, kind: Brows, amp = 1): void {
  const H = B.head;
  const th = H * 0.055 * ap.brow.thick * (B.child ? 0.8 : 1) * (amp > 1 ? 1.4 : 1);
  g.strokeStyle = ap.brow.color;
  g.lineCap = 'round';
  for (const sx of [-1, 1]) {
    // inner: lado de la nariz; outer: lado de la sien (desplazamientos en y, negativo = arriba).
    let inner = 0;
    let outer = 0;
    let arch = -0.25;
    switch (kind) {
      case 'angry':
        inner = 0.55;
        outer = -0.35;
        arch = 0.05;
        break;
      case 'worried':
        inner = -0.55;
        outer = 0.15;
        arch = -0.1;
        break;
      case 'sad':
        inner = -0.45;
        outer = 0.4;
        arch = 0;
        break;
      case 'up':
        inner = -0.75;
        outer = -0.7;
        arch = -0.4;
        break;
      case 'low':
        inner = 0.25;
        outer = 0.2;
        arch = -0.1;
        break;
      case 'relaxed':
        inner = -0.1;
        outer = 0.05;
        arch = -0.3;
        break;
      case 'asym':
        inner = sx < 0 ? 0.35 : -0.35;
        outer = sx < 0 ? -0.05 : -0.55;
        arch = -0.2;
        break;
    }
    const tilt = ap.brow.tilt;
    const xi = sx * ex - sx * ew * 0.95;
    const xo = sx * ex + sx * ew * 1.1;
    const yi = y + (inner * amp + tilt) * ew * 0.6;
    const yo = y + (outer * amp - tilt) * ew * 0.6;
    g.lineWidth = th;
    g.beginPath();
    g.moveTo(xi, yi);
    g.quadraticCurveTo((xi + xo) / 2, (yi + yo) / 2 + arch * ew, xo, yo);
    g.stroke();
    // Arranque más grueso junto a la nariz.
    g.lineWidth = th * 1.3;
    g.beginPath();
    g.moveTo(xi, yi);
    g.lineTo(xi + (xo - xi) * 0.25, yi + (yo - yi) * 0.25 + arch * ew * 0.4);
    g.stroke();
  }
}

function mouth(g: CanvasRenderingContext2D, ap: Appearance, x: number, y: number, w: number, H: number, kind: Mouth): void {
  const lip = ap.lips;
  const dark = 'rgb(86,34,34)';
  const lw = H * 0.042;
  g.lineCap = 'round';
  const curve = (dy: number, color = shd(lip, 0.25), width = lw) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x, y + dy, x + w, y);
    g.stroke();
  };
  const open = (hgt: number, teeth: boolean, round = false) => {
    g.fillStyle = dark;
    g.beginPath();
    if (round) g.ellipse(x, y + hgt * 0.4, w * 0.45, hgt * 0.6, 0, 0, Math.PI * 2);
    else {
      g.moveTo(x - w, y);
      g.quadraticCurveTo(x, y - hgt * 0.2, x + w, y);
      g.quadraticCurveTo(x, y + hgt * 1.4, x - w, y);
    }
    g.fill();
    if (teeth) {
      g.save();
      g.clip();
      g.fillStyle = '#f2ece0';
      g.fillRect(x - w, y - hgt * 0.4, w * 2, hgt * 0.5);
      g.restore();
    }
    if (!teeth || round) ell(g, x, y + hgt * 0.75, w * 0.4, hgt * 0.25, 'rgb(170,70,70)');
  };
  switch (kind) {
    case 'flat':
      curve(H * 0.01);
      ell(g, x, y + H * 0.035, w * 0.55, H * 0.018, alpha(lip, 0.6));
      break;
    case 'smile':
      curve(H * 0.09, shd(lip, 0.3), lw * 1.15);
      ell(g, x, y + H * 0.06, w * 0.5, H * 0.016, alpha(lit(lip, 0.1), 0.5));
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(x + sx * w * 1.0, y - H * 0.005);
        g.lineTo(x + sx * w * 1.12, y - H * 0.025);
        g.stroke();
      }
      break;
    case 'soft':
      curve(H * 0.045);
      break;
    case 'grin':
      open(H * 0.085, true);
      g.strokeStyle = shd(lip, 0.3);
      g.lineWidth = lw * 0.8;
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(x + sx * w * 1.0, y - H * 0.002);
        g.quadraticCurveTo(x + sx * w * 1.2, y - H * 0.02, x + sx * w * 1.18, y - H * 0.05);
        g.stroke();
      }
      break;
    case 'frown':
      curve(-H * 0.06);
      break;
    case 'pout':
      curve(-H * 0.03);
      ell(g, x, y + H * 0.03, w * 0.5, H * 0.025, alpha(lip, 0.7));
      break;
    case 'o':
      open(H * 0.055, false, true);
      break;
    case 'O':
      open(H * 0.1, false, true);
      break;
    case 'teeth': {
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(x - w, y + H * 0.01);
      g.quadraticCurveTo(x, y - H * 0.04, x + w, y + H * 0.01);
      g.quadraticCurveTo(x, y + H * 0.07, x - w, y + H * 0.01);
      g.fill();
      g.fillStyle = '#f2ece0';
      g.fillRect(x - w * 0.75, y - H * 0.012, w * 1.5, H * 0.03);
      g.strokeStyle = alpha(dark, 0.6);
      g.lineWidth = lw * 0.4;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(x + i * w * 0.3, y - H * 0.012);
        g.lineTo(x + i * w * 0.3, y + H * 0.018);
        g.stroke();
      }
      break;
    }
    case 'wavy':
      g.strokeStyle = shd(lip, 0.25);
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x - w, y);
      g.quadraticCurveTo(x - w * 0.5, y - H * 0.025, x, y);
      g.quadraticCurveTo(x + w * 0.5, y + H * 0.025, x + w, y - H * 0.01);
      g.stroke();
      break;
    case 'smirk':
      g.strokeStyle = shd(lip, 0.25);
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x - w, y + H * 0.01);
      g.quadraticCurveTo(x + w * 0.2, y + H * 0.02, x + w * 1.05, y - H * 0.035);
      g.stroke();
      break;
    case 'tired':
      g.fillStyle = alpha(dark, 0.8);
      ell(g, x, y + H * 0.01, w * 0.45, H * 0.018, alpha(dark, 0.7));
      curve(H * 0.0, shd(lip, 0.3), lw * 0.8);
      break;
  }
}

// ---------------------------------------------------------------------------
// Rasgos de perfil
// ---------------------------------------------------------------------------
function sideFeatures(g: CanvasRenderingContext2D, ap: Appearance, B: Body, face: FaceSpec, o: HeadOpts): void {
  const H = B.head;
  const W = B.headW;
  const eyeY = H * (B.child ? 0.1 : 0.05);
  const x = W * 0.62;
  const ew = W * 0.22 * ap.eye.size * (B.child ? 1.15 : 1);
  const eh = ew * 0.8;
  const kind: Eyes = o.blink && face.eyes !== 'happy' ? 'closed' : face.eyes;
  if (kind === 'closed' || kind === 'happy') {
    g.strokeStyle = DARK;
    g.lineWidth = eh * 0.25;
    g.beginPath();
    g.moveTo(x - ew, eyeY);
    g.quadraticCurveTo(x, eyeY + (kind === 'happy' ? -eh * 0.6 : eh * 0.5), x + ew * 0.8, eyeY);
    g.stroke();
  } else {
    const hh = kind === 'wide' ? eh * 1.2 : kind === 'half' || kind === 'tired' || kind === 'squint' ? eh * 0.6 : eh;
    g.save();
    g.beginPath();
    g.moveTo(x - ew * 0.6, eyeY);
    g.quadraticCurveTo(x + ew * 0.3, eyeY - hh, x + ew * 0.85, eyeY + hh * 0.1);
    g.quadraticCurveTo(x + ew * 0.2, eyeY + hh * 0.8, x - ew * 0.6, eyeY);
    g.fillStyle = '#f3ede4';
    g.fill();
    g.clip();
    ell(g, x + ew * 0.3, eyeY, hh * 0.7, hh * 0.7, o.lod === 0 ? ap.eye.color : '#1e1414');
    if (o.lod === 0) {
      ell(g, x + ew * 0.38, eyeY, hh * 0.32, hh * 0.32, '#120c0c');
      ell(g, x + ew * 0.2, eyeY - hh * 0.25, hh * 0.18, hh * 0.18, '#fff');
    }
    g.restore();
    g.strokeStyle = DARK;
    g.lineWidth = eh * 0.28;
    g.beginPath();
    g.moveTo(x - ew * 0.6, eyeY);
    g.quadraticCurveTo(x + ew * 0.3, eyeY - hh * 1.05, x + ew * 0.9, eyeY + hh * 0.05);
    g.stroke();
  }
  // Ceja.
  const by = eyeY - eh * 1.5;
  const angry = face.brows === 'angry';
  const up = face.brows === 'up' || face.brows === 'worried' || face.brows === 'sad';
  g.strokeStyle = ap.brow.color;
  g.lineWidth = H * 0.05 * ap.brow.thick;
  g.beginPath();
  g.moveTo(x - ew * 0.7, by + (up ? -eh * 0.4 : 0));
  g.quadraticCurveTo(x, by - eh * 0.5, x + ew * 0.9, by + (angry ? eh * 0.55 : up ? -eh * 0.6 : 0));
  g.stroke();
  // Boca de perfil.
  const my = H * 0.315;
  const mx = W * 0.92;
  const m = o.talk ? openOf(face.mouth) : face.mouth;
  g.strokeStyle = shd(ap.lips, 0.25);
  g.lineWidth = H * 0.03;
  g.beginPath();
  if (m === 'o' || m === 'O' || m === 'grin' || m === 'teeth') {
    ell(g, mx - W * 0.06, my + H * 0.01, W * 0.08, H * (m === 'O' ? 0.06 : 0.04), 'rgb(86,34,34)');
  } else {
    const dy = m === 'smile' || m === 'soft' || m === 'smirk' ? -H * 0.03 : m === 'frown' ? H * 0.03 : 0;
    g.moveTo(mx, my);
    g.lineTo(mx - W * 0.22, my + dy);
    g.stroke();
  }
  if (face.tear) ell(g, x + ew * 0.1, eyeY + eh * 1.6, H * 0.025, H * 0.045, 'rgba(190,225,255,0.85)');
  if (face.sweat) blob(g, [W * 0.05, -H * 0.3, W * 0.12, -H * 0.18, W * 0.05, -H * 0.12, -W * 0.02, -H * 0.18], 'rgba(200,232,255,0.85)', 0.6);
}

// ---------------------------------------------------------------------------
// Barba
// ---------------------------------------------------------------------------
function beard(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing): void {
  if (ap.beard === 'ninguna' || facing === 'back') return;
  const H = B.head;
  const W = B.headW;
  const c = ap.hair.color;
  const chin = H * 0.45 * ap.faceLen;
  const fill = (pts: number[], a = 1) => {
    const gr = g.createLinearGradient(0, H * 0.1, 0, chin + H * 0.4);
    gr.addColorStop(0, alpha(lit(c, 0.1), a));
    gr.addColorStop(1, alpha(shd(c, 0.3), a));
    blob(g, pts, gr, 0.5);
  };
  const side = facing === 'side';
  const sx = (x: number) => (side ? W * 0.45 + x * 0.55 : x);
  const mustache = () => {
    const my = H * 0.27;
    fill([sx(-W * 0.45), my + H * 0.02, sx(-W * 0.15), my - H * 0.03, sx(0), my - H * 0.01, sx(W * 0.15), my - H * 0.03, sx(W * 0.45), my + H * 0.02, sx(W * 0.25), my + H * 0.05, sx(0), my + H * 0.025, sx(-W * 0.25), my + H * 0.05]);
  };
  switch (ap.beard) {
    case 'sombra':
      g.save();
      g.globalAlpha = 0.28;
      fill([sx(-W * 0.85), H * 0.15, sx(-W * 0.5), H * 0.4, sx(0), chin + H * 0.02, sx(W * 0.5), H * 0.4, sx(W * 0.85), H * 0.15, sx(W * 0.55), H * 0.3, sx(0), H * 0.38, sx(-W * 0.55), H * 0.3]);
      g.restore();
      break;
    case 'bigote':
      mustache();
      break;
    case 'perilla':
      mustache();
      fill([sx(-W * 0.22), H * 0.36, sx(0), H * 0.34, sx(W * 0.22), H * 0.36, sx(W * 0.12), chin + H * 0.06, sx(0), chin + H * 0.1, sx(-W * 0.12), chin + H * 0.06]);
      break;
    case 'corta':
      fill([sx(-W * 0.95), H * 0.05, sx(-W * 0.85), H * 0.3, sx(-W * 0.5), chin * 0.95, sx(0), chin + H * 0.08, sx(W * 0.5), chin * 0.95, sx(W * 0.85), H * 0.3, sx(W * 0.95), H * 0.05, sx(W * 0.6), H * 0.22, sx(W * 0.3), H * 0.37, sx(0), H * 0.4, sx(-W * 0.3), H * 0.37, sx(-W * 0.6), H * 0.22]);
      mustache();
      break;
    case 'larga':
      fill([sx(-W * 0.95), H * 0.05, sx(-W * 0.85), H * 0.35, sx(-W * 0.55), chin + H * 0.25, sx(-W * 0.2), chin + H * 0.62, sx(0), chin + H * 0.72, sx(W * 0.2), chin + H * 0.62, sx(W * 0.55), chin + H * 0.25, sx(W * 0.85), H * 0.35, sx(W * 0.95), H * 0.05, sx(W * 0.6), H * 0.22, sx(W * 0.3), H * 0.37, sx(0), H * 0.4, sx(-W * 0.3), H * 0.37, sx(-W * 0.6), H * 0.22]);
      g.strokeStyle = alpha(shd(c, 0.35), 0.5);
      g.lineWidth = H * 0.018;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(sx(i * W * 0.15), chin);
        g.quadraticCurveTo(sx(i * W * 0.2), chin + H * 0.3, sx(i * W * 0.08), chin + H * 0.55);
        g.stroke();
      }
      mustache();
      break;
  }
}

// ---------------------------------------------------------------------------
// Pelo
// ---------------------------------------------------------------------------
function hairFill(g: CanvasRenderingContext2D, ap: Appearance, B: Body, wet?: boolean): CanvasGradient {
  const H = B.head;
  const base = wet ? shd(ap.hair.color, 0.25) : ap.hair.color;
  const gr = g.createLinearGradient(-B.headW, -H * 0.6, B.headW * 0.8, H * 0.3);
  gr.addColorStop(0, lit(base, 0.22));
  gr.addColorStop(0.45, base);
  gr.addColorStop(1, shd(base, 0.35));
  return gr;
}

function strands(g: CanvasRenderingContext2D, ap: Appearance, B: Body, lines: number[][], light = false): void {
  g.strokeStyle = light ? alpha(lit(ap.hair.color, 0.35), 0.55) : alpha(shd(ap.hair.color, 0.4), 0.55);
  g.lineWidth = B.head * 0.022;
  for (const l of lines) {
    g.beginPath();
    g.moveTo(l[0], l[1]);
    g.quadraticCurveTo(l[2], l[3], l[4], l[5]);
    g.stroke();
  }
}

export function hairFront(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, o: { hood: boolean; wet?: boolean }): void {
  if (o.hood) return;
  const H = B.head;
  const W = B.headW;
  const st = ap.hair.style;
  const top = -H * 0.55;
  const fill = hairFill(g, ap, B, o.wet);
  const hatCovers = ap.outfit.hat === 'casco' || ap.outfit.hat === 'turbante' || ap.outfit.hat === 'piel' || ap.outfit.hat === 'gorro' || ap.outfit.hat === 'panuelo' || ap.outfit.hat === 'impermeable';
  if (st === 'calvo') {
    // Herradura de pelo a los lados y detrás.
    if (facing === 'side') blob(g, [-W * 0.95, -H * 0.05, -W * 0.6, -H * 0.2, -W * 0.15, -H * 0.12, -W * 0.25, H * 0.15, -W * 0.85, H * 0.15], fill);
    else for (const sx of [-1, 1]) blob(g, [sx * W * 1.03, -H * 0.18, sx * W * 0.82, -H * 0.12, sx * W * 0.86, H * 0.08, sx * W * 1.05, H * 0.12], fill);
    // Brillo de la calva.
    ell(g, -W * 0.25, top + H * 0.14, W * 0.35, H * 0.08, alpha('#ffffff', 0.18));
    return;
  }
  if (st === 'rapado') {
    g.save();
    g.globalAlpha = 0.6;
    if (facing === 'side') blob(g, [-W * 0.95, -H * 0.05, -W * 0.7, top + H * 0.05, W * 0.3, top - H * 0.02, W * 0.8, top + H * 0.18, W * 0.5, top + H * 0.22, -W * 0.1, -H * 0.1, -W * 0.3, H * 0.1], fill);
    else blob(g, [-W * 1.02, -H * 0.05, -W * 0.85, top + H * 0.12, 0, top - H * 0.04, W * 0.85, top + H * 0.12, W * 1.02, -H * 0.05, W * 0.6, top + H * 0.2, 0, top + H * 0.17, -W * 0.6, top + H * 0.2], fill);
    g.restore();
    return;
  }
  const curly = st === 'rizado';
  const vol = curly ? 1.18 : st === 'melena' ? 1.1 : 1.04;
  if (facing === 'back') {
    blob(g, [-W * 1.08 * vol, H * 0.1, -W * 1.08 * vol, top + H * 0.2, -W * 0.6, top - H * 0.06 * vol, W * 0.6, top - H * 0.06 * vol, W * 1.08 * vol, top + H * 0.2, W * 1.08 * vol, H * 0.1, W * 0.6, H * 0.32, -W * 0.6, H * 0.32], fill);
    strands(g, ap, B, [[-W * 0.4, top, -W * 0.5, -H * 0.1, -W * 0.6, H * 0.25], [W * 0.1, top, W * 0.05, -H * 0.1, W * 0.1, H * 0.28], [W * 0.5, top + H * 0.05, W * 0.6, -H * 0.1, W * 0.65, H * 0.22]]);
    if (st === 'mono') ell(g, 0, top + H * 0.02, W * 0.45, H * 0.17, fill);
    return;
  }
  if (facing === 'side') {
    const pts = [-W * 1.0 * vol, H * 0.12, -W * 1.05 * vol, top + H * 0.15, -W * 0.4, top - H * 0.07 * vol, W * 0.45, top - H * 0.02, W * 0.95, top + H * 0.22, W * 0.82, top + H * 0.32, W * 0.35, top + H * 0.26, W * 0.05, -H * 0.12, -W * 0.05, H * 0.12, -W * 0.45, H * 0.28];
    blob(g, pts, fill, 0.5);
    if (st === 'largo' || st === 'melena' || st === 'rizado') blob(g, [-W * 0.95, H * 0.0, -W * 0.3, H * 0.05, -W * 0.25, H * (st === 'largo' ? 0.75 : 0.5), -W * 1.0, H * (st === 'largo' ? 0.85 : 0.55)], fill);
    if (st === 'mono') ell(g, -W * 0.7, top + H * 0.1, W * 0.42, H * 0.18, fill);
    strands(g, ap, B, [[-W * 0.6, top + H * 0.05, -W * 0.2, top + H * 0.05, W * 0.5, top + H * 0.15], [-W * 0.8, -H * 0.1, -W * 0.4, -H * 0.25, W * 0.1, top + H * 0.22]], true);
    if (curly) curlBumps(g, ap, B, -W * 0.3, top + H * 0.08, W * 0.9, 6);
    return;
  }
  // De frente: casquete y flequillo según el peinado.
  const cap = [-W * 1.06 * vol, -H * 0.02, -W * 1.05 * vol, top + H * 0.2, -W * 0.65, top - H * 0.06 * vol, 0, top - H * 0.09 * vol, W * 0.65, top - H * 0.06 * vol, W * 1.05 * vol, top + H * 0.2, W * 1.06 * vol, -H * 0.02];
  let fringe: number[];
  switch (st) {
    case 'corto':
      fringe = [W * 0.95, -H * 0.12, W * 0.7, top + H * 0.2, W * 0.1, top + H * 0.17, -W * 0.25, top + H * 0.26, -W * 0.75, top + H * 0.22, -W * 0.95, -H * 0.12];
      break;
    case 'coleta':
    case 'trenza':
      // Raya en medio y todo hacia atrás.
      fringe = [W * 1.0, -H * 0.1, W * 0.6, top + H * 0.14, W * 0.05, top + H * 0.08, -W * 0.05, top + H * 0.08, -W * 0.6, top + H * 0.14, -W * 1.0, -H * 0.1];
      break;
    case 'mono':
      fringe = [W * 1.0, -H * 0.12, W * 0.55, top + H * 0.12, 0, top + H * 0.1, -W * 0.55, top + H * 0.12, -W * 1.0, -H * 0.12];
      break;
    case 'largo':
    case 'melena':
      fringe = [W * 1.02, H * 0.05, W * 0.8, top + H * 0.25, W * 0.25, top + H * 0.2, -W * 0.2, top + H * 0.3, -W * 0.75, top + H * 0.26, -W * 1.02, H * 0.05];
      break;
    default:
      fringe = [W * 1.0, -H * 0.05, W * 0.6, top + H * 0.28, 0, top + H * 0.24, -W * 0.6, top + H * 0.28, -W * 1.0, -H * 0.05];
  }
  g.fillStyle = fill;
  g.beginPath();
  smoothPath(g, [...cap, ...fringe], true, 0.45);
  g.fill();
  // Mechones que caen a los lados de la cara.
  if (st === 'largo' || st === 'melena' || (st === 'rizado' && ap.fem)) {
    const len = st === 'largo' ? 0.85 : 0.5;
    for (const sx of [-1, 1]) blob(g, [sx * W * 1.08, -H * 0.15, sx * W * 0.85, -H * 0.05, sx * W * 0.82, H * len, sx * W * 1.15, H * (len + 0.05), sx * W * 1.2, H * 0.2], fill);
  }
  if (st === 'mono') ell(g, 0, top - H * 0.08, W * 0.45, H * 0.17, fill);
  if (curly) curlBumps(g, ap, B, 0, top + H * 0.02, W * 1.0, 9);
  if (!hatCovers) {
    strands(g, ap, B, [[-W * 0.7, top + H * 0.15, -W * 0.3, top - H * 0.02, W * 0.2, top + H * 0.02], [W * 0.05, top + H * 0.05, W * 0.5, top + H * 0.02, W * 0.85, top + H * 0.3]], true);
    strands(g, ap, B, [[-W * 0.85, top + H * 0.3, -W * 0.6, top + H * 0.15, -W * 0.3, top + H * 0.22], [W * 0.3, top + H * 0.18, W * 0.55, top + H * 0.12, W * 0.8, top + H * 0.25]]);
  }
}

function curlBumps(g: CanvasRenderingContext2D, ap: Appearance, B: Body, cx: number, cy: number, rw: number, n: number): void {
  const H = B.head;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    const x = cx + Math.cos(a) * rw;
    const y = cy + Math.sin(a) * H * 0.18;
    ell(g, x, y, H * 0.1, H * 0.09, i % 2 ? shd(ap.hair.color, 0.1) : lit(ap.hair.color, 0.1));
  }
}

/** Pelo largo, coletas y trenzas: van detrás del cuerpo (se pintan antes que el torso). */
export function paintHairBack(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, wet?: boolean): void {
  const st = ap.hair.style;
  const H = B.head;
  const W = B.headW;
  const fill = hairFill(g, ap, B, wet);
  const top = -H * 0.55;
  if (facing === 'side') {
    if (st === 'coleta') blob(g, [-W * 0.8, -H * 0.2, -W * 1.4, H * 0.1, -W * 1.5, H * 0.8, -W * 1.2, H * 1.0, -W * 1.0, H * 0.4], fill);
    if (st === 'trenza') for (let i = 0; i < 5; i++) ell(g, -W * (0.95 + i * 0.05), H * (0.15 + i * 0.22), W * 0.22, H * 0.13, i % 2 ? fill : shd(ap.hair.color, 0.1));
    if (st === 'largo') blob(g, [-W * 1.0, top + H * 0.3, -W * 0.2, H * 0.1, -W * 0.3, H * 1.35, -W * 1.2, H * 1.3], fill);
    if (st === 'melena') blob(g, [-W * 1.05, top + H * 0.3, -W * 0.3, H * 0.1, -W * 0.4, H * 0.72, -W * 1.2, H * 0.7], fill);
    return;
  }
  if (st === 'largo') blob(g, [-W * 1.1, top + H * 0.3, W * 1.1, top + H * 0.3, W * 1.25, H * 1.35, 0, H * 1.45, -W * 1.25, H * 1.35], fill);
  else if (st === 'melena' || (st === 'rizado' && ap.fem)) blob(g, [-W * 1.15, top + H * 0.3, W * 1.15, top + H * 0.3, W * 1.3, H * 0.75, 0, H * 0.82, -W * 1.3, H * 0.75], fill);
  else if (facing === 'back' && st === 'coleta') blob(g, [-W * 0.3, H * 0.0, W * 0.3, H * 0.0, W * 0.25, H * 1.1, 0, H * 1.25, -W * 0.25, H * 1.1], fill);
  else if (facing === 'back' && st === 'trenza') for (let i = 0; i < 6; i++) ell(g, 0, H * (0.15 + i * 0.22), W * 0.24, H * 0.13, i % 2 ? fill : shd(ap.hair.color, 0.1));
}

// ---------------------------------------------------------------------------
// Sombreros y capucha
// ---------------------------------------------------------------------------
function hat(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing): void {
  const h = ap.outfit.hat;
  if (!h) return;
  const H = B.head;
  const W = B.headW;
  const top = -H * 0.55;
  const c = ap.outfit.hatColor;
  const side = facing === 'side';
  const vg = (y0: number, y1: number, col: string) => {
    const gr = g.createLinearGradient(-W, y0, W, y1);
    gr.addColorStop(0, lit(col, 0.2));
    gr.addColorStop(0.5, col);
    gr.addColorStop(1, shd(col, 0.35));
    return gr;
  };
  switch (h) {
    case 'paja': {
      const straw = '#d8b860';
      ell(g, side ? W * 0.1 : 0, top + H * 0.2, W * 2.0, H * 0.22, vg(top, top + H * 0.3, straw));
      blob(g, [-W * 0.9, top + H * 0.18, -W * 0.75, top - H * 0.22, W * 0.75, top - H * 0.22, W * 0.9, top + H * 0.18], vg(top - H * 0.3, top + H * 0.2, straw));
      g.fillStyle = shd(c, 0.1);
      g.fillRect(-W * 0.9, top + H * 0.04, W * 1.8, H * 0.1);
      g.strokeStyle = alpha(shd(straw, 0.4), 0.5);
      g.lineWidth = H * 0.015;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.ellipse(side ? W * 0.1 : 0, top + H * 0.2, W * (0.95 + i * 0.18), H * (0.1 + i * 0.02), 0, Math.PI * 0.05, Math.PI * 0.95);
        g.stroke();
      }
      break;
    }
    case 'gorro':
      blob(g, [-W * 1.08, -H * 0.1, -W * 1.0, top - H * 0.1, 0, top - H * 0.3, W * 1.0, top - H * 0.1, W * 1.08, -H * 0.1], vg(top - H * 0.3, -H * 0.1, c));
      g.fillStyle = shd(c, 0.15);
      g.fillRect(-W * 1.1, -H * 0.22, W * 2.2, H * 0.14);
      g.strokeStyle = alpha(shd(c, 0.4), 0.5);
      g.lineWidth = H * 0.025;
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.moveTo(i * W * 0.28, -H * 0.22);
        g.lineTo(i * W * 0.2, top - H * 0.15);
        g.stroke();
      }
      break;
    case 'piel':
      blob(g, [-W * 1.2, -H * 0.05, -W * 1.15, top - H * 0.1, 0, top - H * 0.32, W * 1.15, top - H * 0.1, W * 1.2, -H * 0.05], vg(top - H * 0.3, 0, c));
      for (let i = 0; i < 9; i++) ell(g, -W * 1.1 + i * W * 0.28, -H * 0.12, W * 0.18, H * 0.11, i % 2 ? '#d8cfc0' : '#bfb5a4');
      break;
    case 'panuelo':
      blob(g, [-W * 1.08, H * 0.05, -W * 1.05, top + H * 0.1, 0, top - H * 0.08, W * 1.05, top + H * 0.1, W * 1.08, H * 0.05, W * 0.8, -H * 0.15, 0, top + H * 0.22, -W * 0.8, -H * 0.15], vg(top, H * 0.05, c));
      if (!side) ell(g, W * 1.0, H * 0.12, W * 0.18, H * 0.1, shd(c, 0.2));
      break;
    case 'pluma': {
      blob(g, [-W * 1.15, top + H * 0.2, -W * 0.9, top - H * 0.15, W * 0.6, top - H * 0.2, W * 1.15, top + H * 0.12, W * 1.25, top + H * 0.22], vg(top - H * 0.2, top + H * 0.2, c));
      g.fillStyle = shd(c, 0.3);
      g.fillRect(-W * 1.1, top + H * 0.1, W * 2.25, H * 0.08);
      // La pluma: curva larga con barbas.
      g.strokeStyle = ap.outfit.trim;
      g.lineWidth = H * 0.05;
      g.beginPath();
      g.moveTo(W * 0.5, top + H * 0.05);
      g.quadraticCurveTo(W * 1.6, top - H * 0.4, W * 1.9, top - H * 0.85);
      g.stroke();
      g.lineWidth = H * 0.02;
      for (let i = 1; i < 8; i++) {
        const k = i / 8;
        const x = W * (0.5 + 1.4 * k);
        const y = top + H * (0.05 - 0.9 * k * k);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - W * 0.25, y - H * 0.02);
        g.stroke();
      }
      break;
    }
    case 'casco': {
      const metal = c || '#8f959c';
      const gr = g.createRadialGradient(-W * 0.4, top, W * 0.1, 0, top + H * 0.3, W * 1.3);
      gr.addColorStop(0, '#f2f4f6');
      gr.addColorStop(0.35, metal);
      gr.addColorStop(1, shd(metal, 0.45));
      blob(g, [-W * 1.12, H * 0.02, -W * 1.08, top + H * 0.05, 0, top - H * 0.16, W * 1.08, top + H * 0.05, W * 1.12, H * 0.02, W * 0.9, -H * 0.12, -W * 0.9, -H * 0.12], gr);
      g.fillStyle = shd(metal, 0.3);
      g.fillRect(-W * 1.14, -H * 0.16, W * 2.28, H * 0.08);
      if (!side) {
        g.fillStyle = shd(metal, 0.15);
        g.fillRect(-W * 0.07, -H * 0.12, W * 0.14, H * 0.3); // nasal
      }
      break;
    }
    case 'corona': {
      const gold = '#e2b84a';
      g.fillStyle = vg(top, top + H * 0.15, gold);
      g.beginPath();
      g.moveTo(-W * 0.95, top + H * 0.2);
      for (let i = 0; i <= 4; i++) {
        const x = -W * 0.95 + (i * W * 1.9) / 4;
        g.lineTo(x, top - H * (i % 2 ? 0.02 : 0.14));
        if (i < 4) g.lineTo(x + W * 0.24, top + H * 0.04);
      }
      g.lineTo(W * 0.95, top + H * 0.2);
      g.closePath();
      g.fill();
      ell(g, 0, top + H * 0.09, W * 0.12, H * 0.06, '#b8323a');
      ell(g, -W * 0.5, top + H * 0.1, W * 0.08, H * 0.05, '#3a6ab8');
      ell(g, W * 0.5, top + H * 0.1, W * 0.08, H * 0.05, '#3a6ab8');
      break;
    }
    case 'turbante':
      blob(g, [-W * 1.18, -H * 0.05, -W * 1.15, top - H * 0.05, 0, top - H * 0.3, W * 1.15, top - H * 0.05, W * 1.18, -H * 0.05, 0, -H * 0.14], vg(top - H * 0.3, 0, c));
      g.strokeStyle = alpha(shd(c, 0.35), 0.6);
      g.lineWidth = H * 0.03;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(-W * 1.1, -H * (0.12 + i * 0.16));
        g.quadraticCurveTo(0, top - H * (0.05 - i * 0.12), W * 1.1, -H * (0.3 + i * 0.1));
        g.stroke();
      }
      break;
    case 'impermeable':
      blob(g, [-W * 1.45, H * 0.0, -W * 1.05, top + H * 0.05, 0, top - H * 0.18, W * 1.05, top + H * 0.05, W * 1.45, H * 0.0, W * 1.6, H * 0.2, 0, -H * 0.05, -W * 1.6, H * 0.2], vg(top, H * 0.2, '#d9b44a'));
      break;
    case 'boina':
      // Envuelve el cráneo: cúpula ladeada que cae sobre una sien.
      blob(g, [-W * 1.04, top + H * 0.3, -W * 0.95, top - H * 0.02, -W * 0.2, top - H * 0.16, W * 0.85, top - H * 0.08, W * 1.25, top + H * 0.16, W * 1.02, top + H * 0.3], vg(top - H * 0.15, top + H * 0.3, c), 0.6);
      g.fillStyle = shd(c, 0.3);
      blob(g, [-W * 1.02, top + H * 0.26, W * 1.02, top + H * 0.26, W * 1.0, top + H * 0.33, -W * 1.0, top + H * 0.33], shd(c, 0.3), 0.3);
      ell(g, W * 0.05, top - H * 0.14, W * 0.09, H * 0.05, shd(c, 0.2));
      break;
    case 'capucha':
      hood(g, ap, B, facing);
      break;
  }
}

function hood(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing): void {
  // Capucha de tela gruesa, más oscura que la capa (está mojada y en sombra),
  // con pico en la coronilla, costura central y un forro oscuro que enmarca
  // la cara: no debe leerse como una melena.
  const H = B.head;
  const W = B.headW;
  const top = -H * 0.55;
  const col = shd(ap.outfit.cloak?.color ?? ap.outfit.hatColor ?? '#5d5446', 0.24);
  const gr = g.createLinearGradient(-W, top, W, H * 0.5);
  gr.addColorStop(0, lit(col, 0.12));
  gr.addColorStop(0.5, col);
  gr.addColorStop(1, shd(col, 0.4));
  const seam = alpha(shd(col, 0.55), 0.8);
  if (facing === 'side') {
    blob(g, [-W * 1.3, H * 0.6, -W * 1.4, top + H * 0.05, -W * 0.75, top - H * 0.42, W * 0.85, top + H * 0.02, W * 1.05, -H * 0.1, W * 0.55, top + H * 0.35, W * 0.3, H * 0.2, W * 0.1, H * 0.6], gr, 0.4);
    g.strokeStyle = seam;
    g.lineWidth = H * 0.025;
    g.beginPath();
    g.moveTo(-W * 0.72, top - H * 0.36);
    g.quadraticCurveTo(-W * 1.25, top + H * 0.3, -W * 1.2, H * 0.55);
    g.stroke();
    return;
  }
  if (facing === 'back') {
    blob(g, [-W * 1.35, H * 0.65, -W * 1.38, top + H * 0.05, 0, top - H * 0.46, W * 1.38, top + H * 0.05, W * 1.35, H * 0.65], gr, 0.4);
    g.strokeStyle = seam;
    g.lineWidth = H * 0.025;
    g.beginPath();
    g.moveTo(0, top - H * 0.42);
    g.lineTo(0, H * 0.55);
    g.stroke();
    return;
  }
  // De frente: pico arriba, el borde enmarca la cara y el forro queda en sombra.
  g.fillStyle = gr;
  g.beginPath();
  smoothPath(g, [-W * 1.4, H * 0.7, -W * 1.42, top + H * 0.05, -W * 0.3, top - H * 0.34, 0, top - H * 0.46, W * 0.3, top - H * 0.34, W * 1.42, top + H * 0.05, W * 1.4, H * 0.7, W * 0.95, H * 0.55, W * 0.98, -H * 0.1, W * 0.6, top + H * 0.18, 0, top + H * 0.1, -W * 0.6, top + H * 0.18, -W * 0.98, -H * 0.1, -W * 0.95, H * 0.55], true, 0.4);
  g.fill();
  // Forro oscuro junto a la cara.
  g.strokeStyle = alpha(shd(col, 0.65), 0.85);
  g.lineWidth = H * 0.085;
  g.beginPath();
  g.moveTo(-W * 0.9, H * 0.5);
  g.quadraticCurveTo(-W * 1.02, top + H * 0.22, 0, top + H * 0.14);
  g.quadraticCurveTo(W * 1.02, top + H * 0.22, W * 0.9, H * 0.5);
  g.stroke();
  // Costura central y pliegue.
  g.strokeStyle = seam;
  g.lineWidth = H * 0.022;
  g.beginPath();
  g.moveTo(0, top - H * 0.42);
  g.lineTo(0, top + H * 0.06);
  g.moveTo(-W * 1.15, top + H * 0.3);
  g.quadraticCurveTo(-W * 1.25, H * 0.2, -W * 1.1, H * 0.6);
  g.stroke();
}
