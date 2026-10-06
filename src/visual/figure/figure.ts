import type { Appearance } from '../../render/appearance';
import { frameNo, put, tex, type Tex } from '../paint';
import { contactShadow } from '../light';
import { VQ } from '../quality';
import { bodyOf, type Body } from './body';
import { paintCape, paintCapeFront, paintForeArm, paintItem, paintShin, paintSkirt, paintThigh, paintTorso, paintUpperArm, skirtLen } from './clothes';
import { FACES, paintHairBack, paintHead } from './head';
import { rigOf, type Limb, type Rig } from './rig';
import type { Facing, Pose } from './types';

/**
 * Composición de una persona: cada pieza (cabeza con su expresión, pelo de
 * detrás, torso con la ropa, brazos, antebrazos con las manos, muslos,
 * piernas con el calzado, falda, capa y objeto) se pinta una vez en una
 * textura y en cada fotograma se articula sobre el esqueleto. Así la
 * animación es continua (sin fotogramas) y el coste es de una docena de
 * imágenes por persona.
 */
const ids = new WeakMap<Appearance, string>();
let nextId = 1;
const idOf = (ap: Appearance) => {
  let id = ids.get(ap);
  if (!id) ids.set(ap, (id = `p${nextId++}`));
  return id;
};

type Part = 'head' | 'hairB' | 'torso' | 'skirt' | 'ua' | 'fa' | 'faF' | 'th' | 'sh' | 'cape' | 'capeF' | 'item';

/** Resolución forzada (retratos e interiores, que muestran a la persona mucho más grande). */
let resOverride = 0;
function part(ap: Appearance, B: Body, p: Part, facing: Facing, extra: string, draw: (g: CanvasRenderingContext2D) => void, far = false): Tex {
  const id = idOf(ap);
  const res = resOverride ? resOverride * (far ? 0.6 : 1) : VQ().figureRes * (p === 'head' ? 1.5 : 1) * (far ? 0.6 : 1);
  const box = boxOf(B, p);
  return tex(`fig:${id}:${p}:${facing}:${extra}`, box.w, box.h, box.ax, box.ay, (g) => {
    if (far) g.filter = 'brightness(0.82) saturate(0.9)';
    draw(g);
  }, res);
}

function boxOf(B: Body, p: Part): { w: number; h: number; ax: number; ay: number } {
  switch (p) {
    case 'head':
    case 'hairB':
      return { w: B.headW * 5.2, h: B.head * 3.1, ax: B.headW * 2.6, ay: B.head * 1.35 };
    case 'torso':
    case 'capeF':
      return { w: B.shoulder * 3.2, h: B.torso + B.neck + B.thigh + 3, ax: B.shoulder * 1.6, ay: B.torso + B.neck + 1.6 };
    case 'skirt':
      return { w: B.hip * 5, h: B.leg + 2, ax: B.hip * 2.5, ay: 1 };
    case 'ua':
      return { w: B.armW * 3, h: B.upperArm + B.armW * 1.4, ax: B.armW * 1.5, ay: B.armW * 0.7 };
    case 'fa':
    case 'faF':
      return { w: B.armW * 3, h: B.foreArm + B.armW * 1.6, ax: B.armW * 1.5, ay: B.armW * 0.7 };
    case 'th':
      return { w: B.thighW * 3, h: B.thigh + B.thighW * 1.2, ax: B.thighW * 1.5, ay: B.thighW * 0.6 };
    case 'sh':
      return { w: B.shinW * 5, h: B.shin + B.shinW * 1.6, ax: B.shinW * 1.8, ay: B.shinW * 0.6 };
    case 'cape':
      return { w: B.shoulder * 4.6, h: B.torso + B.leg + 2, ax: B.shoulder * 2.5, ay: B.torso + 1.5 };
    case 'item':
      return { w: 44, h: 50, ax: 22, ay: 26 };
  }
}

/** Ángulo de un brazo visto de frente: solo se separa del cuerpo al levantarlo; un balanceo pequeño se ve como escorzo. */
function frontArm(l: Limb, sign: number): { out: number; fs: number; bend: number } {
  if (l.lift < 0) return { out: sign * 0.62, fs: 1, bend: -sign * 2.05 }; // en jarras
  const out = 0.09 + (l.a > 0.65 ? (l.a - 0.65) * 1.08 : 0);
  const fs = Math.cos(Math.min(Math.abs(l.a), 0.65) * 1.05) * (1 - l.lift * 0.12);
  const bend = out < 1.15 ? -l.b * 0.82 : l.b * 0.55;
  return { out: sign * out, fs, bend: sign * bend };
}

interface Opts {
  far?: boolean; // LOD 2: figura en una sola imagen
  res?: number; // píxeles de textura por píxel de mundo (retratos: nítidos al tamaño en que se ven)
}

/** Dibuja a una persona con los pies en (x, y) de mundo. */
export function drawFigure(g: CanvasRenderingContext2D, ap: Appearance, pose: Pose, x: number, y: number, o: Opts = {}): void {
  const B = bodyOf(ap);
  if (pose.lod === 2 || o.far) return drawStatue(g, ap, B, pose, x, y);
  if (pose.action === 'sleep') return drawLying(g, ap, B, pose, x, y);
  const { R, squash } = blended(g, ap, pose, B);
  resOverride = o.res ? Math.min(24, Math.round(o.res * 2) / 2) : 0;
  g.save();
  g.translate(x + R.x, y);
  if (pose.facing === 'side' && pose.flip) g.scale(-1, 1);
  if (squash !== 1) g.scale(squash, 1);
  compose(g, ap, B, pose, R);
  g.restore();
  resOverride = 0;
}

// ---------------------------------------------------------------------------
// Mezcla entre estados: al cambiar de acción o de orientación el esqueleto
// no salta; pasa del estado anterior al nuevo en un instante corto, y al
// girarse el cuerpo se estrecha un momento (se lee como un giro).
// ---------------------------------------------------------------------------
interface Mem {
  key: string;
  facing: string;
  t: number;
  from: Rig | null;
  since: number;
  last: Rig | null;
  turn: number;
  multi: boolean; // se dibuja varias veces por fotograma (galería): sin mezcla
  frame: number;
}
const BLEND = 0.22;
const TURN = 0.14;
const mems = new WeakMap<object, WeakMap<Appearance, Mem>>();

function blended(g: CanvasRenderingContext2D, ap: Appearance, pose: Pose, B: Body): { R: Rig; squash: number } {
  const target = rigOf(pose, B, ap.seed);
  let byCtx = mems.get(g);
  if (!byCtx) mems.set(g, (byCtx = new WeakMap()));
  const facing = pose.facing + (pose.flip ? 'L' : 'R');
  const key = pose.action;
  const t = pose.t;
  let m = byCtx.get(ap);
  const fr = frameNo();
  // La misma persona dibujada dos veces en un fotograma con otra acción (galería): sin mezcla.
  if (m && m.frame === fr && (m.key !== key || m.facing !== facing)) m.multi = true;
  if (m?.multi) return { R: target, squash: 1 };
  if (!m || t < m.t || t - m.t > 0.5) {
    m = { key, facing, t, from: null, since: -9, last: target, turn: -9, multi: false, frame: fr };
    byCtx.set(ap, m);
    return { R: target, squash: 1 };
  }
  m.frame = fr;
  if (m.key !== key) {
    m.from = m.last;
    m.since = t;
    m.key = key;
  }
  if (m.facing !== facing) {
    // Solo los cambios de frente a perfil o espalda se marcan con giro.
    if (m.facing[0] !== facing[0] || pose.facing === 'side') m.turn = t;
    m.facing = facing;
  }
  m.t = t;
  let R = target;
  const u = (t - m.since) / BLEND;
  if (m.from && u < 1) R = mixRig(m.from, target, u * u * (3 - 2 * u));
  else m.from = null;
  m.last = R;
  const v = (t - m.turn) / TURN;
  const squash = v >= 0 && v < 1 ? 1 - 0.3 * Math.sin(Math.PI * v) : 1;
  return { R, squash };
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
function mixLimb(a: Limb, b: Limb, u: number): Limb {
  return { a: lerp(a.a, b.a, u), b: lerp(a.b, b.b, u), lift: lerp(a.lift, b.lift, u), fist: u > 0.5 ? b.fist : a.fist };
}
function mixRig(a: Rig, b: Rig, u: number): Rig {
  return {
    ...b,
    y: lerp(a.y, b.y, u),
    x: lerp(a.x, b.x, u),
    lean: lerp(a.lean, b.lean, u),
    breath: lerp(a.breath, b.breath, u),
    shrug: lerp(a.shrug, b.shrug, u),
    legs: [mixLimb(a.legs[0], b.legs[0], u), mixLimb(a.legs[1], b.legs[1], u)],
    arms: [mixLimb(a.arms[0], b.arms[0], u), mixLimb(a.arms[1], b.arms[1], u)],
    head: { tilt: lerp(a.head.tilt, b.head.tilt, u), nod: lerp(a.head.nod, b.head.nod, u), dx: lerp(a.head.dx, b.head.dx, u), dy: lerp(a.head.dy, b.head.dy, u) },
    sitting: lerp(a.sitting, b.sitting, u),
    item: lerp(a.item, b.item, u),
    skirt: lerp(a.skirt, b.skirt, u),
    cape: lerp(a.cape, b.cape, u),
  };
}

/** Qué lleva en la mano según lo que hace: no se martillea con una cesta. */
const WEAPONS = new Set(['espada', 'lanza', 'arco']);
function itemFor(ap: Appearance, pose: Pose): Appearance['outfit']['item'] | 'paraguas' {
  if (pose.umbrella) return 'paraguas';
  const own = ap.outfit.item;
  switch (pose.action) {
    case 'hammer':
      return 'martillo';
    case 'fish':
      return 'cana';
    case 'work':
      return 'azada';
    case 'point':
    case 'talk':
    case 'listen':
    case 'nod':
    case 'shake':
      // Se habla y se señala con la mano libre: solo un bastón o una lanza se quedan.
      return own === 'lanza' || own === 'cayado' || own === 'baston' ? own : undefined;
    case 'fight':
      return own && WEAPONS.has(own) && own !== 'arco' ? own : undefined;
    case 'carry':
      return own === 'cesta' || own === 'saco' ? own : 'saco';
    case 'wave':
    case 'celebrate':
    case 'cry':
    case 'eat':
    case 'cross':
    case 'argue':
    case 'sit':
    case 'rest':
      return own === 'lanza' || own === 'cayado' || own === 'baston' ? own : undefined;
    default:
      return own;
  }
}

/** Dormir: tumbado en el suelo sobre una estera, tapado con una manta. */
function drawLying(g: CanvasRenderingContext2D, ap: Appearance, B: Body, pose: Pose, x: number, y: number): void {
  const still: Pose = { ...pose, action: 'idle', facing: 'front', flip: false };
  const R = rigOf(still, B, ap.seed);
  R.blink = true;
  R.mouthOpen = false;
  R.x = 0;
  R.arms = [{ a: 0.12, b: 0.5, lift: 0 }, { a: 0.12, b: 0.5, lift: 0 }];
  R.breath = 1 + Math.sin(pose.t * 0.9 + ap.seed) * 0.03;
  const dir = pose.flip ? -1 : 1;
  g.save();
  g.translate(x - dir * B.H * 0.5, y - B.shoulder * 0.55);
  // Estera de paja.
  g.fillStyle = '#b89a62';
  g.beginPath();
  g.ellipse(dir * B.H * 0.48, B.shoulder * 0.6, B.H * 0.6, B.shoulder * 1.5, 0, 0, Math.PI * 2);
  g.fill();
  g.rotate(dir * Math.PI / 2);
  compose(g, ap, B, still, R);
  // Manta desde el pecho hasta los pies.
  const top = -B.leg - B.torso * 0.62;
  const gr = g.createLinearGradient(-B.shoulder * 1.4, 0, B.shoulder * 1.4, 0);
  gr.addColorStop(0, '#8a5a3e');
  gr.addColorStop(0.5, '#a56c48');
  gr.addColorStop(1, '#6a4230');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-B.shoulder * 1.35, top);
  g.quadraticCurveTo(0, top - 1.2 * R.breath, B.shoulder * 1.35, top);
  g.lineTo(B.shoulder * 1.25, 1.5);
  g.quadraticCurveTo(0, 2.5, -B.shoulder * 1.25, 1.5);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(240,220,180,0.55)';
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(-B.shoulder * 1.3, top + 1);
  g.quadraticCurveTo(0, top - 0.2, B.shoulder * 1.3, top + 1);
  g.stroke();
  g.restore();
}

function compose(g: CanvasRenderingContext2D, ap: Appearance, B: Body, pose: Pose, R: Rig): void {
  const f = pose.facing;
  const side = f === 'side';
  const wet = pose.wet;
  const hood = !!pose.hood;
  const lod = pose.lod;
  const hipY = -B.leg + R.y;
  const expr = pose.expr;
  const face = FACES[expr] ?? FACES.neutral;
  const W = wet ? 'w' : '';
  const hasCape = !!ap.outfit.cloak;
  const long = ap.hair.style === 'largo' || ap.hair.style === 'melena' || ap.hair.style === 'coleta' || ap.hair.style === 'trenza' || (ap.hair.style === 'rizado' && ap.fem);
  const item = itemFor(ap, pose);

  const tTorso = part(ap, B, 'torso', f, W, (gg) => paintTorso(gg, ap, B, f, wet));
  const tSkirt = skirtLen(ap, B) ? part(ap, B, 'skirt', f, W, (gg) => paintSkirt(gg, ap, B, f, wet)) : null;
  const tUA = part(ap, B, 'ua', 'front', W, (gg) => paintUpperArm(gg, ap, B, wet));
  const tUAf = side ? part(ap, B, 'ua', 'front', `${W}far`, (gg) => paintUpperArm(gg, ap, B, wet), true) : tUA;
  const tFA = (fist: boolean, far: boolean) => part(ap, B, fist ? 'faF' : 'fa', 'front', `${W}${far ? 'far' : ''}`, (gg) => paintForeArm(gg, ap, B, fist, wet), far);
  const tTH = part(ap, B, 'th', 'front', W, (gg) => paintThigh(gg, ap, B, wet));
  const tTHf = side ? part(ap, B, 'th', 'front', `${W}far`, (gg) => paintThigh(gg, ap, B, wet), true) : tTH;
  const tSH = (far: boolean) => part(ap, B, 'sh', side ? 'side' : 'front', `${W}${far ? 'far' : ''}`, (gg) => paintShin(gg, ap, B, side ? 'side' : 'front', wet), far);
  const tCape = hasCape ? part(ap, B, 'cape', f, W, (gg) => paintCape(gg, ap, B, f, wet)) : null;
  const tCapeF = hasCape && f !== 'back' ? part(ap, B, 'capeF', f, W, (gg) => paintCapeFront(gg, ap, B, f, wet)) : null;
  const blink = R.blink;
  const talk = R.mouthOpen;
  const tHead = part(ap, B, 'head', f, `${expr}:${blink ? 1 : 0}${talk ? 1 : 0}:${hood ? 1 : 0}:${lod}:${W}`, (gg) => paintHead(gg, ap, B, f, face, { blink, talk, hood, lod, wet }));
  const tHairB = long && !hood ? part(ap, B, 'hairB', f, W, (gg) => paintHairBack(gg, ap, B, f, wet)) : null;
  const tItem = item ? tex(`item:${item}:${B.H.toFixed(1)}`, 44, 50, 22, 26, (gg) => paintItem(gg, item, B)) : null;

  // --- Piernas ---
  const leg = (l: Limb, hx: number, far: boolean) => {
    g.save();
    g.translate(hx, hipY);
    if (side) {
      g.rotate(-l.a);
      put(g, far ? tTHf : tTH, 0, 0);
      g.translate(0, B.thigh);
      g.rotate(-l.b);
      put(g, tSH(far), 0, 0);
    } else {
      // De frente: la rodilla sube hacia la cámara (escorzo del muslo).
      const k = R.sitting > 0.5 ? 0.26 : 1 - Math.min(0.75, l.lift * 0.45);
      // La pierna que avanza se acerca a la cámara (de frente) o se aleja (de espaldas).
      if (R.sitting < 0.5) g.translate(0, (pose.facing === 'back' ? -1 : 1) * l.lift * 1.6);
      // La rodilla que sube se abre un poco hacia fuera y la espinilla se acorta (escorzo).
      const splay = R.sitting > 0.5 ? 0 : l.lift * 0.14;
      g.rotate(hx > 0 ? -0.03 - splay : 0.03 + splay);
      g.scale(1, k);
      put(g, tTH, 0, 0);
      g.scale(1, 1 / k);
      g.translate(0, B.thigh * k);
      g.rotate(hx > 0 ? splay * 1.6 : -splay * 1.6);
      const ks = R.sitting > 0.5 ? 1 : 1 - Math.min(0.4, l.lift * 0.22);
      g.scale(1, ks);
      put(g, tSH(false), 0, 0);
    }
    g.restore();
  };

  // --- Torso (con inclinación y respiración) ---
  const torsoT = () => {
    g.translate(0, hipY);
    if (side) g.rotate(R.lean);
    else g.scale(1, 1 - Math.max(0, R.lean) * 0.08);
    g.scale(1, R.breath);
  };

  // --- Brazos ---
  const shoulderY = -B.torso + B.armW * 0.55 - R.shrug * 0.6;
  const arm = (l: Limb, sign: number, far: boolean, withItem: boolean) => {
    g.save();
    torsoT();
    if (side) {
      g.translate(B.shoulder * 0.05, shoulderY);
      g.rotate(-l.a);
      put(g, far ? tUAf : tUA, 0, 0);
      g.translate(0, B.upperArm * 0.96);
      g.rotate(-l.b);
      if (withItem && tItem) {
        g.save();
        g.translate(0, B.foreArm * 0.8);
        g.rotate(l.b + l.a - Math.PI / 2 + R.item + (item === 'lanza' || item === 'cayado' || item === 'paraguas' || item === 'baston' ? Math.PI / 2 - l.a - l.b : pose.action === 'idle' || pose.action === 'walk' || pose.action === 'look' ? Math.PI / 2 - l.a - l.b - 0.15 : 0));
        put(g, tItem, 0, 0);
        g.restore();
      }
      put(g, tFA(!!l.fist, far), 0, 0);
    } else {
      const fa = frontArm(l, sign);
      g.translate(sign * (B.shoulder - B.armW * 0.42), shoulderY);
      g.rotate(-fa.out);
      g.scale(1, fa.fs);
      put(g, tUA, 0, 0);
      g.translate(0, B.upperArm * 0.96);
      g.scale(1, 1 / fa.fs);
      g.rotate(-fa.bend);
      put(g, tFA(!!l.fist, false), 0, 0);
      if (withItem && tItem) {
        g.save();
        g.translate(0, B.foreArm * 0.82);
        g.rotate(fa.out + fa.bend + R.item * 0.5 + (item === 'lanza' || item === 'cayado' || item === 'paraguas' || item === 'baston' ? 0 : 0.2));
        put(g, tItem, 0, 0, sign < 0);
        g.restore();
      }
    }
    g.restore();
  };

  // --- Cabeza ---
  const headT = () => {
    torsoT();
    g.translate(side ? B.shoulder * 0.12 : 0, -B.torso - B.neck * 0.75 - R.shrug * 0.3);
    if (side) g.rotate(R.head.nod - R.lean * 0.6);
    g.rotate(R.head.tilt * (side ? 0.4 : 1));
    g.translate(R.head.dx * (side ? 0.2 : 0.5), -B.head * 0.45 + (side ? 0 : R.head.nod * B.head * 0.35) + R.head.dy);
  };
  const head = () => {
    g.save();
    headT();
    put(g, tHead, 0, 0);
    g.restore();
  };
  const hairBack = () => {
    if (!tHairB) return;
    g.save();
    headT();
    put(g, tHairB, 0, 0);
    g.restore();
  };
  const cape = () => {
    if (!tCape) return;
    g.save();
    torsoT();
    // Cuelga de los hombros por su peso (no sigue la inclinación del torso) y el
    // bajo ondea más que el cuello: cizalla desde el hombro hacia abajo.
    const sy = -B.torso + B.armW * 0.5;
    g.translate(0, sy);
    if (side) {
      g.rotate(-R.lean * 0.85);
      g.transform(1, 0, R.cape * 0.35 + R.skirt * 0.3, 1, 0, 0);
    } else g.transform(1 + R.cape * 0.04, 0, R.skirt * 0.22, 1, 0, 0);
    g.translate(0, -sy);
    put(g, tCape, 0, 0);
    g.restore();
  };
  const capeFront = () => {
    if (!tCapeF) return;
    g.save();
    torsoT();
    put(g, tCapeF, 0, 0);
    g.restore();
  };
  const torso = () => {
    g.save();
    torsoT();
    put(g, tTorso, 0, 0);
    g.restore();
  };
  const skirt = () => {
    if (!tSkirt) return;
    g.save();
    g.translate(0, hipY);
    if (side) g.rotate(R.lean * 0.5);
    g.transform(1, 0, R.skirt * (side ? 0.35 : 0.2), 1, 0, 0);
    put(g, tSkirt, 0, 0);
    g.restore();
  };

  const [L0, L1] = R.legs;
  const [A0, A1] = R.arms;
  // Sentado: siempre sobre algo (un taburete de tres patas), nunca en el aire.
  const seated = R.sitting > 0.5;
  if (seated && f !== 'front') stool(g, B, hipY, side);
  if (f === 'front') {
    cape();
    if (seated) stool(g, B, hipY, false);
    hairBack();
    leg(L0, -B.hipJoint, false);
    leg(L1, B.hipJoint, false);
    skirt();
    torso();
    arm(A0, -1, false, false);
    arm(A1, 1, false, true);
    head();
    capeFront();
  } else if (f === 'back') {
    leg(L0, -B.hipJoint, false);
    leg(L1, B.hipJoint, false);
    skirt();
    torso();
    arm(A1, 1, false, true);
    arm(A0, -1, false, false);
    cape();
    head();
    hairBack();
  } else {
    arm(A0, 1, true, false);
    leg(L0, -B.hipJoint * 0.25, true);
    cape();
    hairBack();
    torso();
    leg(L1, B.hipJoint * 0.25, false);
    skirt();
    head();
    capeFront();
    arm(A1, 1, false, true);
  }
}

function stool(g: CanvasRenderingContext2D, B: Body, hipY: number, side: boolean): void {
  const top = hipY + 0.6;
  const w = B.hip * (side ? 1.6 : 2.1);
  g.strokeStyle = '#5a3e26';
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(-w * 0.7, 0);
  g.lineTo(-w * 0.45, top + 1);
  g.moveTo(w * 0.7, 0);
  g.lineTo(w * 0.45, top + 1);
  g.moveTo(0, 0.4);
  g.lineTo(0, top + 1);
  g.stroke();
  g.fillStyle = '#8a6440';
  g.beginPath();
  g.ellipse(0, top + 0.6, w * 0.62, 1.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#6a4a2e';
  g.fillRect(-w * 0.62, top + 0.6, w * 1.24, 0.9);
}

/** LOD lejano: la figura entera en una sola imagen, de pie (con un leve vaivén al andar). */
function drawStatue(g: CanvasRenderingContext2D, ap: Appearance, B: Body, pose: Pose, x: number, y: number): void {
  const f = pose.facing;
  const moving = pose.action === 'walk' || pose.action === 'run' || pose.action === 'patrol';
  const t = tex(`stat:${idOf(ap)}:${f}:${pose.hood ? 1 : 0}:${pose.wet ? 1 : 0}`, B.H * 1.2, B.H * 1.25, B.H * 0.6, B.H * 1.18, (gg) => {
    const still: Pose = { ...pose, action: 'idle', t: 0, lod: 1, phase: 0, flip: false };
    compose(gg, ap, B, still, rigOf(still, B, ap.seed));
  }, VQ().figureRes * 0.6);
  const bob = moving ? Math.abs(Math.sin(pose.phase)) * 0.5 : 0;
  put(g, t, x, y - bob, f === 'side' && pose.flip);
}

// ---------------------------------------------------------------------------
// Sombras
// ---------------------------------------------------------------------------
export interface Sun {
  dx: number; // dirección de la sombra (unitaria)
  dy: number;
  len: number; // longitud relativa a la altura (0 = mediodía)
  a: number; // opacidad
}

/** Sombra de contacto bajo los pies y sombra alargada en la dirección del sol. */
export function drawFigureShadow(g: CanvasRenderingContext2D, ap: Appearance, x: number, y: number, sun: Sun | null, sitting = false): void {
  const B = bodyOf(ap);
  const r = B.shoulder * 1.15;
  contactShadow(g, x, y, r * 1.3, r * 0.5, 0.45);
  if (!sun || sun.a <= 0.01 || VQ().shadows === 'blob') return;
  // Sombra alargada: una textura de silueta difusa, girada hacia donde cae.
  const L = sun.len * B.H * (sitting ? 0.55 : 1);
  const ang = Math.atan2(sun.dy, sun.dx);
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.globalAlpha = sun.a * 0.55;
  g.drawImage(longShadow(), 0, -B.shoulder, L * 1.06, B.shoulder * 2);
  g.restore();
}

let longTex: HTMLCanvasElement | null = null;
function longShadow(): HTMLCanvasElement {
  if (longTex) return longTex;
  const c = (longTex = document.createElement('canvas'));
  c.width = 96;
  c.height = 32;
  const g = c.getContext('2d')!;
  const sg = g.createLinearGradient(0, 0, 96, 0);
  sg.addColorStop(0, 'rgba(34,28,62,1)');
  sg.addColorStop(1, 'rgba(34,28,62,0)');
  g.fillStyle = sg;
  // Hombros anchos cerca de los pies, cabeza estrecha al final.
  g.beginPath();
  g.moveTo(0, 4);
  g.quadraticCurveTo(52, 0, 90, 10);
  g.quadraticCurveTo(98, 16, 90, 22);
  g.quadraticCurveTo(52, 32, 0, 28);
  g.closePath();
  g.fill();
  return c;
}

/** Altura de la cabeza (para colocar etiquetas y bocadillos). */
export function figureTop(ap: Appearance): number {
  return bodyOf(ap).H;
}
