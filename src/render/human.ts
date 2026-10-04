import type { Appearance, Outfit } from './appearance';
import { OUTLINE, Painter, tone, vivid } from './pixel';

/**
 * Personas en pixel art. Proporciones de RPG de pixel art: cabeza grande y
 * expresiva (≈ 2/5 de la altura), cuerpo corto, ropa legible a primera
 * vista. Cada figura se compone por capas (piernas, ropa, brazos, cabeza,
 * pelo, cara, sombrero, objeto) sobre una rejilla de píxeles enteros y se
 * guarda en caché por aspecto y postura.
 *
 * Un adulto mide ~29 px (casi dos teselas): una casa es tres o cuatro veces
 * más alta, un árbol el doble o el triple y un caballo le saca la cabeza.
 */
export type Expr = 'feliz' | 'neutral' | 'preocupado' | 'enfadado' | 'miedo' | 'triste' | 'sorpresa' | 'desconfianza' | 'alivio' | 'hostil';
export type Facing = 'front' | 'back' | 'side';
export type Action = 'idle' | 'walk' | 'run' | 'work' | 'hammer' | 'sit' | 'talk' | 'wave' | 'cross' | 'point' | 'carry' | 'nod' | 'shake' | 'look' | 'fish' | 'listen';

export interface Pose {
  facing: Facing;
  flip: boolean; // de perfil: mira a la izquierda
  phase: number; // ciclo de paso (radianes)
  action: Action;
  t: number; // segundos (gestos, parpadeo)
  expr: Expr;
  lod: 0 | 1 | 2;
  hood?: boolean; // capucha puesta (lluvia)
  heavy?: boolean; // abrigo de nieve
}

// ---------------------------------------------------------------------------
// Medidas (filas: los pies están en y = -1; la cabeza arriba, y negativo)
// ---------------------------------------------------------------------------
interface Body {
  legTop: number; // primera fila de piernas
  hip: number; // fila del cinturón
  sh: number; // fila de los hombros
  headBot: number;
  headTop: number;
  hw: number; // media anchura del torso
  hh: number; // media anchura de la cabeza
  child: boolean;
}

function bodyOf(ap: Appearance): Body {
  if (ap.height < 0.8) return { legTop: -5, hip: -6, sh: -11, headBot: -12, headTop: -22, hw: 3, hh: 5, child: true };
  const tall = ap.height >= 1 ? 1 : 0;
  const hw = ap.build > 1.08 ? 5 : 4;
  return { legTop: -7 - tall, hip: -8 - tall, sh: -16 - tall, headBot: -17 - tall, headTop: -28 - tall, hw, hh: 6, child: false };
}

// ---------------------------------------------------------------------------
// Colores de cada figura
// ---------------------------------------------------------------------------
interface Pal {
  skin: string;
  skinS: string;
  skinL: string;
  hair: string;
  hairS: string;
  hairL: string;
  top: string;
  topS: string;
  topL: string;
  bot: string;
  botS: string;
  shoe: string;
  eye: string;
  brow: string;
  lip: string;
}

const pals = new WeakMap<Appearance, Pal>();
function palOf(ap: Appearance): Pal {
  const hit = pals.get(ap);
  if (hit) return hit;
  const hair = vivid(ap.hair.color, 1.1);
  const top = vivid(ap.outfit.topColor, 1.15);
  const bot = vivid(ap.outfit.bottomColor, 1.1);
  const p: Pal = {
    skin: ap.skin,
    skinS: tone(ap.skin, 0.8),
    skinL: tone(ap.skin, 1.12),
    hair,
    hairS: tone(hair, 0.7),
    hairL: tone(hair, 1.35),
    top,
    topS: tone(top, 0.74),
    topL: tone(top, 1.18),
    bot,
    botS: tone(bot, 0.72),
    shoe: ap.outfit.shoes === 'descalzo' ? ap.skin : vivid(ap.outfit.shoeColor),
    eye: ap.eye.color,
    brow: tone(ap.brow.color, 0.85),
    lip: tone(ap.skin, 0.62),
  };
  pals.set(ap, p);
  return p;
}

// ---------------------------------------------------------------------------
// Caras: cada expresión es un pequeño dibujo de cejas, ojos y boca
// ---------------------------------------------------------------------------
type Eyes = 'open' | 'wide' | 'half' | 'closed' | 'happy';
type Brows = 'flat' | 'angry' | 'worried' | 'up' | 'asym';
type Mouth = 'flat' | 'smile' | 'grin' | 'frown' | 'o' | 'O' | 'teeth' | 'wavy' | 'smirk' | 'talk';
interface Face {
  eyes: Eyes;
  brows: Brows;
  mouth: Mouth;
  blush?: boolean;
  tear?: boolean;
  sweat?: boolean;
}

const FACES: Record<Expr, Face> = {
  neutral: { eyes: 'open', brows: 'flat', mouth: 'flat' },
  feliz: { eyes: 'open', brows: 'flat', mouth: 'smile', blush: true },
  preocupado: { eyes: 'open', brows: 'worried', mouth: 'wavy', sweat: true },
  enfadado: { eyes: 'half', brows: 'angry', mouth: 'frown' },
  miedo: { eyes: 'wide', brows: 'worried', mouth: 'o', sweat: true },
  triste: { eyes: 'half', brows: 'worried', mouth: 'frown', tear: true },
  sorpresa: { eyes: 'wide', brows: 'up', mouth: 'O' },
  desconfianza: { eyes: 'half', brows: 'asym', mouth: 'smirk' },
  alivio: { eyes: 'happy', brows: 'flat', mouth: 'smile', blush: true },
  hostil: { eyes: 'half', brows: 'angry', mouth: 'teeth' },
};

// ---------------------------------------------------------------------------
// Caché de figuras
// ---------------------------------------------------------------------------
const ids = new WeakMap<Appearance, number>();
let nextId = 1;
const cache = new Map<string, { c: HTMLCanvasElement; ax: number; ay: number }>();
const SW = 44;
const SH = 52;
const AX = 22;
const AY = 46;

function frameOf(pose: Pose): { walk: number; act: number; blink: boolean; talkOpen: boolean } {
  const moving = pose.action === 'walk' || pose.action === 'run';
  const walk = moving ? ((Math.floor(pose.phase / (Math.PI / 2)) % 4) + 4) % 4 : 0;
  const act = pose.lod === 2 ? 0 : Math.floor(pose.t * (pose.action === 'hammer' || pose.action === 'work' ? 3 : 2.5)) % 4;
  const blink = pose.lod < 2 && (pose.t * 1000) % 3700 < 140;
  const talkOpen = pose.lod < 2 && pose.action === 'talk' && Math.floor(pose.t * 6) % 2 === 0;
  return { walk, act, blink, talkOpen };
}

/** Dibuja una persona con los pies en (x, y). */
export function drawHuman(g: CanvasRenderingContext2D, ap: Appearance, pose: Pose, x: number, y: number, scale = 1): void {
  let id = ids.get(ap);
  if (!id) ids.set(ap, (id = nextId++));
  const f = frameOf(pose);
  const key = `${id}|${pose.facing}|${pose.action}|${f.walk}|${f.act}|${f.blink ? 1 : 0}|${f.talkOpen ? 1 : 0}|${pose.expr}|${pose.hood ? 1 : 0}|${pose.heavy ? 1 : 0}`;
  let s = cache.get(key);
  if (!s) {
    if (cache.size > 5000) cache.clear();
    const P = new Painter(SW, SH, AX, AY);
    paintPerson(P, ap, pose, f);
    s = { c: P.toCanvas(), ax: AX, ay: AY };
    cache.set(key, s);
  }
  const flip = pose.facing === 'side' && pose.flip;
  const X = Math.round(x);
  const Y = Math.round(y);
  if (!flip && scale === 1) {
    g.drawImage(s.c, X - s.ax, Y - s.ay);
    return;
  }
  g.save();
  g.translate(X, Y);
  g.scale(flip ? -scale : scale, scale);
  g.drawImage(s.c, -s.ax, -s.ay);
  g.restore();
}

// ---------------------------------------------------------------------------
// Composición
// ---------------------------------------------------------------------------
function paintPerson(P: Painter, ap: Appearance, pose: Pose, f: ReturnType<typeof frameOf>): void {
  const B = bodyOf(ap);
  const c = palOf(ap);
  const o = ap.outfit;
  const back = pose.facing === 'back';
  const side = pose.facing === 'side';
  const sit = pose.action === 'sit';
  const run = pose.action === 'run';
  // Bote del paso y reposo.
  const bob = (pose.action === 'walk' || run) && (f.walk === 1 || f.walk === 3) ? -1 : 0;
  const dy = bob + (sit ? 3 : 0);
  P.shadow(-0.5, -0.5, B.child ? 4.5 : 6, 1.8);
  const cloak = o.cloak && (o.cloak.hood || pose.hood || pose.heavy || o.cloak.fur || true) ? o.cloak : undefined;

  if (side) {
    paintSide(P, ap, B, c, pose, f, dy);
    return;
  }
  // 1) Capa y pelo largo por detrás.
  if (cloak && !back) {
    const cc = vivid(cloak.color);
    P.rect(-B.hw - 2, B.sh + dy, 2, hemRow(B, 0.85) - B.sh, tone(cc, 0.7));
    P.rect(B.hw, B.sh + dy, 2, hemRow(B, 0.85) - B.sh, tone(cc, 0.7));
  }
  if (!back && !pose.hood && longHair(ap)) {
    P.rect(-B.hh - 1, B.headBot - 4 + dy, 2, B.child ? 6 : 8, c.hairS);
    P.rect(B.hh - 1, B.headBot - 4 + dy, 2, B.child ? 6 : 8, c.hairS);
  }
  // 2) Piernas y calzado.
  paintLegsFront(P, B, c, o, pose, f.walk, sit);
  // 3) Torso, prendas y adornos.
  paintTorso(P, ap, B, c, pose, dy, back);
  // 4) Capa por detrás (vista de espalda: la capa cubre la espalda).
  if (cloak && back) {
    const cc = vivid(cloak.color);
    const bottom = hemRow(B, pose.heavy || cloak.fur ? 0.75 : 0.9);
    for (let y = B.sh + dy; y < bottom + dy; y++) {
      const wdt = B.hw + 1 + Math.floor((y - B.sh) / 4);
      P.rect(-wdt, y, wdt * 2, 1, (y - B.sh) % 5 === 4 ? tone(cc, 0.82) : cc);
    }
    P.rect(-1, B.sh + dy + 2, 1, bottom - B.sh - 3, tone(cc, 0.78));
  }
  if (back && o.backpack && !cloak) P.rect(-3, B.sh + 2 + dy, 6, 6, vivid(o.backpack)), P.rect(-3, B.sh + 2 + dy, 6, 1, tone(o.backpack, 1.2));
  // 5) Brazos (según la acción).
  paintArmsFront(P, ap, B, c, pose, f, dy, back);
  // 6) Cabeza.
  const hx = pose.action === 'shake' ? (f.act % 2 ? 1 : -1) : 0;
  const hy = dy + (pose.action === 'nod' && f.act % 2 ? 1 : 0) + (pose.action === 'listen' && f.act === 3 ? 1 : 0);
  paintHeadFront(P, ap, B, c, pose, f, hx, hy, back);
  // 7) Capa por delante: hombros, broche y cuello de piel.
  if (cloak && !back) {
    const cc = vivid(cloak.color);
    P.rect(-B.hw - 2, B.sh + dy, 3, 2, cc);
    P.rect(B.hw - 1, B.sh + dy, 3, 2, cc);
    if (cloak.fur || pose.heavy) P.rect(-B.hw - 1, B.sh - 1 + dy, B.hw * 2 + 2, 2, '#e6dcc6'), P.px(-B.hw, B.sh + dy, '#c8baa0'), P.px(B.hw - 1, B.sh + dy, '#c8baa0');
    else P.px(-1, B.sh + dy, cloak.clasp), P.px(0, B.sh + dy, cloak.clasp);
  }
}

function longHair(ap: Appearance): boolean {
  const s = ap.hair.style;
  return s === 'largo' || s === 'melena' || s === 'trenza';
}

function hemRow(B: Body, hem: number): number {
  // 0 = cintura … 1 = tobillos.
  return Math.round(B.hip + (-2 - B.hip) * hem);
}

function paintLegsFront(P: Painter, B: Body, c: Pal, o: Outfit, pose: Pose, walk: number, sit: boolean): void {
  const legC = o.bottom === 'falda' ? c.skinS : o.bottom === 'calzas' ? tone(c.bot, 0.9) : c.bot;
  if (sit) {
    // Sentado: muslos hacia delante, pies colgando.
    P.rect(-B.hw + 1, B.legTop + 3, B.hw - 1, 2, legC);
    P.rect(1, B.legTop + 3, B.hw - 1, 2, legC);
    P.rect(-B.hw + 1, -2, 3, 2, c.shoe);
    P.rect(1, -2, 3, 2, c.shoe);
    return;
  }
  const lift = (leg: 0 | 1) => (walk === 1 && leg === 0) || (walk === 3 && leg === 1) ? 1 : 0;
  for (const leg of [0, 1] as const) {
    const x = leg === 0 ? -B.hw + 1 : 0;
    const w = B.hw - 1;
    const up = lift(leg) * (pose.action === 'run' ? 2 : 1);
    P.rect(x, B.legTop, w, -2 - B.legTop - up, legC);
    P.px(leg === 0 ? x : x + w - 1, B.legTop + 1, tone(legC, leg === 0 ? 1.12 : 0.82));
    // Calzado.
    P.rect(x, -2 - up, w, 2, c.shoe);
    P.rect(x, -2 - up, w, 1, tone(c.shoe, 1.15));
    if (o.shoes === 'botasPiel') P.rect(x, -3 - up, w, 1, '#e2d6bf');
    if (o.patches && leg === 1) P.px(x + 1, B.legTop + 2, tone(legC, 1.25));
  }
}

function paintTorso(P: Painter, ap: Appearance, B: Body, c: Pal, pose: Pose, dy: number, back: boolean): void {
  const o = ap.outfit;
  const long = o.top === 'tunicaLarga' || o.top === 'abrigo' || o.bottom === 'falda';
  // Faldas, túnicas largas y abrigos: trapecio sobre las piernas.
  if (long) {
    const bottom = hemRow(B, Math.max(o.hem, o.bottom === 'falda' ? 0.75 : 0.6));
    const col = o.bottom === 'falda' && o.top !== 'tunicaLarga' && o.top !== 'abrigo' ? c.bot : c.top;
    for (let y = B.hip + dy; y <= bottom + (pose.action === 'sit' ? 0 : 0); y++) {
      const wdt = B.hw + Math.floor((y - B.hip - dy) / 3);
      P.rect(-wdt, y, wdt * 2, 1, col);
      P.px(wdt - 1, y, tone(col, 0.78));
      P.px(-wdt, y, tone(col, 1.1));
    }
    P.rect(-B.hw - 1, bottom, B.hw * 2 + 2, 1, tone(col, 0.72));
    if (o.trim && o.pattern === 'bordado') P.rect(-B.hw - 1, bottom, B.hw * 2 + 2, 1, vivid(o.trim));
  }
  // Torso.
  for (let y = B.sh; y <= B.hip; y++) {
    const narrow = y === B.sh ? 1 : 0;
    P.rect(-B.hw + narrow, y + dy, B.hw * 2 - narrow * 2, 1, c.top);
  }
  // Contorno interior: separa los brazos del torso, como en el pixel art dibujado a mano.
  P.rect(-B.hw, B.sh + 1 + dy, 1, B.hip - B.sh, tone(c.top, 0.62));
  P.rect(B.hw - 1, B.sh + 1 + dy, 1, B.hip - B.sh, tone(c.top, 0.58));
  P.rect(-B.hw + 1, B.sh + 1 + dy, 1, B.hip - B.sh - 1, c.topL);
  // Estampado.
  for (let y = B.sh + 1; y < B.hip; y++)
    for (let x = -B.hw + 1; x < B.hw - 1; x++) {
      const k = y - B.sh;
      if (o.pattern === 'rayas' && k % 2 === 0) P.px(x, y + dy, tone(c.top, 0.78));
      else if (o.pattern === 'cuadros' && ((x >> 1) + (k >> 1)) % 2 === 0) P.px(x, y + dy, tone(c.top, 0.84));
      else if (o.pattern === 'acolchado' && k % 3 === 0) P.px(x, y + dy, tone(c.top, 0.8));
      else if (o.pattern === 'hojas' && (x * 7 + k * 5) % 9 === 0) P.px(x, y + dy, tone(c.top, 1.25));
    }
  if (back) {
    P.rect(-B.hw, B.hip + dy, B.hw * 2, 1, vivid(o.belt));
    return;
  }
  // Escote.
  P.rect(-1, B.sh + dy, 2, 1, c.skinS);
  if (o.top === 'camisa' || o.top === 'tunica') P.px(-1, B.sh + 1 + dy, tone(c.top, 0.7)), P.px(0, B.sh + 1 + dy, tone(c.top, 0.7));
  if (o.trim && (o.pattern === 'bordado' || o.top === 'jubon' || o.top === 'tunicaLarga')) {
    P.px(-2, B.sh + dy, vivid(o.trim));
    P.px(1, B.sh + dy, vivid(o.trim));
    if (o.top === 'jubon') for (let y = B.sh + 2; y < B.hip; y += 2) P.px(0, y + dy, vivid(o.trim));
  }
  // Chaleco abierto.
  if (o.vest) {
    const v = vivid(o.vest);
    P.rect(-B.hw, B.sh + 1 + dy, 2, B.hip - B.sh - 1, v);
    P.rect(B.hw - 2, B.sh + 1 + dy, 2, B.hip - B.sh - 1, tone(v, 0.82));
  }
  // Armadura: sobreveste con el color de la región y emblema.
  if (o.armor) {
    const t = vivid(o.armor.tabard);
    P.rect(-2, B.sh + 1 + dy, 4, B.hip - B.sh + (long ? 3 : 2), t);
    P.rect(1, B.sh + 1 + dy, 1, B.hip - B.sh + 2, tone(t, 0.8));
    P.rect(-1, B.sh + 3 + dy, 2, 2, vivid(o.armor.emblem));
    if (o.armor.mail) {
      P.rect(-B.hw, B.sh + dy, 2, 3, '#8f949c');
      P.rect(B.hw - 2, B.sh + dy, 2, 3, '#7a7f88');
    }
  }
  // Mandil.
  if (o.apron) {
    const a = o.apron;
    P.rect(-2, B.sh + 3 + dy, 4, B.hip - B.sh + 2, a);
    P.rect(-2, B.sh + 3 + dy, 4, 1, tone(a, 0.85));
    P.px(1, B.hip + 1 + dy, tone(a, 0.8));
  }
  // Chal.
  if (o.shawl) {
    const s = vivid(o.shawl);
    P.rect(-B.hw, B.sh + dy, B.hw * 2, 2, s);
    P.rect(-2, B.sh + 2 + dy, 4, 1, s);
    P.rect(-1, B.sh + 3 + dy, 2, 1, tone(s, 0.85));
  }
  // Cinturón, fajín, bandolera, bolsa, joyas.
  P.rect(-B.hw, B.hip + dy, B.hw * 2, 1, vivid(o.belt));
  if (!o.sash) P.px(0, B.hip + dy, '#e2c46a');
  if (o.sash) P.rect(-B.hw, B.hip - 1 + dy, B.hw * 2, 2, vivid(o.sash)), P.px(B.hw - 2, B.hip + 1 + dy, vivid(o.sash));
  if (o.strap) for (let k = 0; k < B.hip - B.sh; k++) P.px(B.hw - 1 - Math.round((k * (B.hw * 2 - 1)) / (B.hip - B.sh)), B.sh + k + dy, tone(o.strap, 0.9));
  if (o.pouch) P.rect(B.hw - 2, B.hip + 1 + dy, 2, 2, vivid(o.pouch)), P.px(B.hw - 2, B.hip + 1 + dy, tone(o.pouch, 1.25));
  if (o.jewelry) P.px(-1, B.sh + 2 + dy, o.jewelry), P.px(0, B.sh + 2 + dy, o.jewelry), P.px(-1, B.sh + 3 + dy, tone(o.jewelry, 1.3));
  if (o.patches) P.rect(-B.hw + 1, B.hip - 3 + dy, 2, 2, tone(c.top, 1.22));
}

// ---------------------------------------------------------------------------
// Brazos y objetos (vista frontal / de espalda)
// ---------------------------------------------------------------------------
function paintArmsFront(P: Painter, ap: Appearance, B: Body, c: Pal, pose: Pose, f: ReturnType<typeof frameOf>, dy: number, back: boolean): void {
  const o = ap.outfit;
  const sleeve = o.armor?.mail ? '#8f949c' : c.top;
  const sleeveS = tone(sleeve, 0.78);
  const hand = o.gloves ? vivid(o.gloves) : c.skin;
  const bare = o.sleeves === 'cortas' ? 4 : o.sleeves === 'remangadas' ? 2 : 0;
  const L = B.hip - B.sh; // longitud de manga (filas)
  const lx = -B.hw - 2;
  const rx = B.hw;
  const sh = B.sh + dy;
  // Brazo colgando, con desfase vertical (balanceo).
  const hang = (x: number, off: number, shadeSide: boolean) => {
    for (let k = 0; k < L - off; k++) {
      const col = k >= L - off - bare ? c.skin : shadeSide ? sleeveS : sleeve;
      P.rect(x, sh + k, 2, 1, col);
      if (k > 0 && k < L - off - bare) P.px(shadeSide ? x + 1 : x, sh + k, tone(col, shadeSide ? 0.82 : 1.12));
    }
    P.rect(x, sh + L - off, 2, 2, hand);
    return { x: x + 1, y: sh + L - off + 1 };
  };
  // Antebrazo hacia el centro del cuerpo (manos delante).
  const bent = (x: number, inward: number, handY: number) => {
    P.rect(x, sh, 2, handY - sh - 1, sleeve);
    const dir = x < 0 ? 1 : -1;
    for (let k = 0; k <= inward; k++) P.rect(x + dir * k, handY - 1, 2, 2, k === inward ? hand : sleeve);
    return { x: x + dir * inward + (dir > 0 ? 1 : 0), y: handY };
  };
  const raised = (x: number, wiggle: number) => {
    P.rect(x + wiggle, sh - 7, 2, 7, sleeve);
    P.rect(x + wiggle, sh - 9, 2, 2, hand);
    return { x: x + wiggle, y: sh - 9 };
  };
  const a = pose.action;
  const swing = a === 'walk' || a === 'run' ? (f.walk === 1 ? 1 : f.walk === 3 ? -1 : 0) * (a === 'run' ? 2 : 1) : 0;
  let L1: { x: number; y: number };
  let R1: { x: number; y: number };
  switch (a) {
    case 'wave':
      L1 = hang(lx, 0, false);
      R1 = raised(rx + 1, f.act % 2);
      break;
    case 'cross':
      P.rect(lx, sh, 2, 4, sleeve);
      P.rect(rx, sh, 2, 4, sleeveS);
      P.rect(-B.hw - 1, sh + 4, B.hw * 2 + 2, 2, sleeveS);
      P.rect(-B.hw + 1, sh + 4, 2, 2, hand);
      P.rect(B.hw - 3, sh + 4, 2, 2, hand);
      L1 = { x: -B.hw + 1, y: sh + 5 };
      R1 = { x: B.hw - 2, y: sh + 5 };
      break;
    case 'talk':
      L1 = hang(lx, 0, false);
      R1 = f.act < 2 ? bent(rx, 2, sh + 5 - (f.act % 2)) : hang(rx, 1, true);
      break;
    case 'point':
      L1 = hang(lx, 0, false);
      P.rect(rx, sh + 1, 6, 2, sleeve);
      P.rect(rx + 6, sh + 1, 2, 2, hand);
      R1 = { x: rx + 7, y: sh + 2 };
      break;
    case 'carry':
      L1 = bent(lx, 2, sh + 6);
      R1 = bent(rx, 2, sh + 6);
      P.rect(-3, sh + 3, 6, 4, '#a07a4a');
      P.rect(-3, sh + 3, 6, 1, '#c09a64');
      break;
    case 'work':
    case 'hammer': {
      const up = f.act < 2;
      if (a === 'hammer') {
        L1 = hang(lx, 0, false);
        R1 = up ? raised(rx, 0) : bent(rx, 1, sh + 6);
      } else {
        L1 = up ? bent(lx, 3, sh + 2) : bent(lx, 3, sh + 7);
        R1 = up ? bent(rx, 3, sh + 2) : bent(rx, 3, sh + 7);
      }
      break;
    }
    case 'fish':
      L1 = bent(lx, 3, sh + 5);
      R1 = bent(rx, 3, sh + 5);
      break;
    case 'sit':
      L1 = bent(lx, 1, sh + 7);
      R1 = bent(rx, 1, sh + 7);
      break;
    default:
      L1 = hang(lx, Math.max(0, swing), false);
      R1 = hang(rx, Math.max(0, -swing), true);
  }
  if (back) return;
  paintItemFront(P, ap, B, pose, f, L1, R1, dy);
}

function paintItemFront(P: Painter, ap: Appearance, B: Body, pose: Pose, f: ReturnType<typeof frameOf>, L: { x: number; y: number }, R: { x: number; y: number }, dy: number): void {
  const it = ap.outfit.item;
  const a = pose.action;
  const wood = '#7a5232';
  const woodL = '#9a6e44';
  const metal = '#a8adb4';
  if (a === 'work' || it === 'azada') {
    if (a !== 'work' && it !== 'azada') return;
    // Azada: mango en diagonal, hoja de hierro.
    const up = a === 'work' && f.act < 2;
    const hx = Math.round((L.x + R.x) / 2);
    const hy = Math.round((L.y + R.y) / 2);
    if (a === 'work') {
      if (up) P.line(hx, hy, hx + 5, hy - 9, wood), P.rect(hx + 4, hy - 11, 4, 2, metal);
      else P.line(hx, hy, hx + 6, -2, wood), P.rect(hx + 5, -2, 3, 2, metal);
    } else {
      P.line(R.x, R.y + 4, R.x + 1, R.y - 9, wood);
      P.rect(R.x, R.y - 11, 4, 2, metal);
    }
    return;
  }
  switch (it) {
    case 'martillo':
      if (a === 'hammer' && f.act < 2) P.line(R.x, R.y, R.x, R.y - 4, wood), P.rect(R.x - 1, R.y - 6, 4, 2, '#6a6f78');
      else P.line(R.x, R.y, R.x, R.y + 3, wood), P.rect(R.x - 1, R.y + 3, 4, 2, '#6a6f78');
      break;
    case 'cana':
      P.line(R.x, R.y, R.x + 9, R.y - 12, woodL);
      P.line(R.x + 9, R.y - 12, R.x + 12, -1, '#d8dde2');
      break;
    case 'cayado':
    case 'baston':
      P.line(R.x, -1, R.x, R.y - (it === 'cayado' ? 9 : 2), wood);
      if (it === 'cayado') P.px(R.x + 1, R.y - 10, wood), P.px(R.x + 2, R.y - 9, wood), P.px(R.x + 2, R.y - 8, wood);
      break;
    case 'lanza':
      P.line(R.x, -1, R.x, B.headTop - 6 + dy, wood);
      P.poly([R.x - 1.5, B.headTop - 6 + dy, R.x + 0.5, B.headTop - 11 + dy, R.x + 2.5, B.headTop - 6 + dy], metal);
      break;
    case 'cesta':
      P.rect(L.x - 2, L.y + 1, 5, 3, '#b08850');
      P.rect(L.x - 2, L.y + 1, 5, 1, '#c9a064');
      P.px(L.x, L.y + 2, '#8a6a3a');
      if (ap.outfit.topColor) P.px(L.x - 1, L.y, '#d9473a'), P.px(L.x + 1, L.y, '#e8c04a');
      break;
    case 'saco':
      P.oval(L.x, L.y + 3, 2.5, 3, '#c8b088');
      P.px(L.x - 1, L.y + 1, '#e2cfa8');
      break;
    case 'farol':
      P.px(L.x, L.y + 1, '#3a2e22');
      P.rect(L.x - 1, L.y + 2, 3, 4, '#3a2e22');
      P.px(L.x, L.y + 3, '#ffe28a');
      P.px(L.x, L.y + 4, '#ffcf5a');
      break;
    case 'libro':
      P.rect(L.x - 1, L.y - 1, 3, 4, '#7a2f3a');
      P.rect(L.x + 1, L.y - 1, 1, 4, '#e8dcc0');
      break;
    case 'red':
      for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) P.px(L.x - 1 + x, L.y + 1 + y, '#c9bfa8');
      break;
    case 'arco':
      // A la espalda: asoma por encima del hombro.
      P.line(B.hw + 1, B.sh - 3 + dy, B.hw - 3, B.hip + dy, '#8a5a2a');
      break;
  }
}

// ---------------------------------------------------------------------------
// Cabeza, pelo, cara y sombreros (frente / espalda)
// ---------------------------------------------------------------------------
function headRows(B: Body): number[] {
  // Anchura de cada fila de la cabeza (de arriba abajo): redonda, con mentón.
  const n = B.headBot - B.headTop + 1;
  const out: number[] = [];
  for (let r = 0; r < n; r++) {
    let w = B.hh;
    if (r === 0) w = B.hh - 3;
    else if (r === 1) w = B.hh - 1;
    else if (r === n - 2) w = B.hh - 1;
    else if (r === n - 1) w = B.hh - 3;
    out.push(w);
  }
  return out;
}

function paintHeadFront(P: Painter, ap: Appearance, B: Body, c: Pal, pose: Pose, f: ReturnType<typeof frameOf>, hx: number, hy: number, back: boolean): void {
  const rows = headRows(B);
  const top = B.headTop + hy;
  // Cara.
  rows.forEach((w, r) => {
    P.rect(-w + hx, top + r, w * 2, 1, c.skin);
    P.px(w - 1 + hx, top + r, c.skinS);
  });
  P.rect(-rows[rows.length - 1] + hx, top + rows.length - 1, rows[rows.length - 1] * 2, 1, c.skinS);
  // Orejas.
  const er = B.child ? 5 : 6;
  P.px(-B.hh - 1 + hx, top + er, c.skin);
  P.px(B.hh + hx, top + er, c.skinS);
  if (back) {
    paintHairBack(P, ap, B, c, top, hx, pose);
    if (!pose.hood) paintHat(P, ap, B, c, top, hx, pose, true);
    else paintHood(P, ap, B, top, hx, true);
    return;
  }
  paintFace(P, ap, B, c, pose, f, top, hx);
  if (pose.hood) {
    paintHood(P, ap, B, top, hx, false);
    return;
  }
  paintHairFront(P, ap, B, c, top, hx);
  paintHat(P, ap, B, c, top, hx, pose, false);
}

function paintFace(P: Painter, ap: Appearance, B: Body, c: Pal, pose: Pose, f: ReturnType<typeof frameOf>, top: number, hx: number): void {
  const F = FACES[pose.expr];
  const k = B.child ? -1 : 0; // la cara de los niños está una fila más arriba
  const browY = top + 4 + k;
  const eyeY = top + 5 + k;
  const mouthY = top + 8 + k;
  const lx = -4 + hx + (B.child ? 1 : 0);
  const rx = 2 + hx - (B.child ? 1 : 0);
  const look = pose.action === 'look' ? (f.act < 2 ? -1 : 1) : 0;
  // Cejas.
  const brow = (x: number, side: -1 | 1) => {
    const inner = side < 0 ? x + 1 : x;
    const outer = side < 0 ? x : x + 1;
    let yi = browY;
    let yo = browY;
    if (F.brows === 'angry') (yi = browY + 1), (yo = browY - 1);
    else if (F.brows === 'worried') (yi = browY - 1), (yo = browY);
    else if (F.brows === 'up') (yi = browY - 1), (yo = browY - 1);
    else if (F.brows === 'asym' && side > 0) (yi = browY - 1), (yo = browY - 1);
    else if (F.brows === 'asym') (yi = browY + 1), (yo = browY);
    P.px(inner, yi, c.brow);
    P.px(outer, yo, c.brow);
  };
  brow(lx, -1);
  brow(rx, 1);
  // Ojos.
  const eyes: Eyes = f.blink && F.eyes !== 'happy' ? 'closed' : F.eyes;
  const eye = (x: number, side: -1 | 1) => {
    const inner = side < 0 ? x + 1 : x;
    const outer = side < 0 ? x : x + 1;
    switch (eyes) {
      case 'closed':
        P.px(x, eyeY + 1, OUTLINE);
        P.px(x + 1, eyeY + 1, OUTLINE);
        break;
      case 'happy':
        P.px(x, eyeY + 1, OUTLINE);
        P.px(x + 1, eyeY, OUTLINE);
        if (side > 0) P.px(x, eyeY, OUTLINE), P.px(x + 1, eyeY + 1, OUTLINE), P.px(x + 1, eyeY, c.skin);
        break;
      case 'wide':
        P.px(outer, eyeY, '#ffffff');
        P.px(outer, eyeY + 1, '#ffffff');
        P.px(inner, eyeY, OUTLINE);
        P.px(inner, eyeY + 1, c.eye);
        P.px(outer, eyeY - 1, OUTLINE);
        break;
      case 'half':
        P.px(inner + (side < 0 ? look : look), eyeY + 1, OUTLINE);
        P.px(outer, eyeY + 1, '#f0ece4');
        P.px(inner, eyeY, c.skinS);
        break;
      default:
        P.px(inner + look * (side < 0 ? 0 : 0), eyeY, OUTLINE);
        P.px(inner, eyeY + 1, c.eye);
        P.px(outer, eyeY + 1, '#f4f0ea');
        P.px(outer, eyeY, OUTLINE);
    }
  };
  eye(lx, -1);
  eye(rx, 1);
  // Mejillas, nariz, pecas, arrugas, lágrima, sudor.
  if (F.blush || (ap.fem && pose.expr !== 'enfadado' && pose.expr !== 'hostil')) {
    P.px(-B.hh + 1 + hx, mouthY - 1, tone(c.skin, 0.9) === c.skin ? c.skinS : '#e8908a');
    P.px(B.hh - 2 + hx, mouthY - 1, '#e8908a');
  }
  if (ap.nose > 1.1) P.px(-1 + hx, mouthY - 1, c.skinS);
  if (ap.freckles) P.px(-3 + hx, mouthY - 1, tone(c.skin, 0.72)), P.px(2 + hx, mouthY - 1, tone(c.skin, 0.72));
  if (ap.wrinkles > 0.4) P.px(lx - 1, eyeY + 1, c.skinS), P.px(rx + 2, eyeY + 1, c.skinS), P.px(-2 + hx, mouthY, c.skinS), P.px(1 + hx, mouthY, c.skinS);
  if (F.tear) P.px(lx, eyeY + 2, '#7ab8e8'), P.px(lx, eyeY + 3, '#a8d4f4');
  if (F.sweat) P.px(B.hh + hx, top + 2, '#a8d4f4'), P.px(B.hh + hx, top + 3, '#7ab8e8');
  // Barba (antes de la boca para que esta quede visible).
  paintBeard(P, ap, B, c, top, hx, mouthY);
  // Boca.
  const m: Mouth = f.talkOpen ? 'talk' : F.mouth;
  const mx = -1 + hx;
  const lip = c.lip;
  switch (m) {
    case 'smile':
      P.px(mx, mouthY, lip);
      P.px(mx + 1, mouthY, lip);
      P.px(mx - 1, mouthY - 1, lip);
      P.px(mx + 2, mouthY - 1, lip);
      break;
    case 'grin':
      P.rect(mx - 1, mouthY, 4, 1, '#ffffff');
      break;
    case 'frown':
      P.px(mx, mouthY, lip);
      P.px(mx + 1, mouthY, lip);
      P.px(mx - 1, mouthY + 1, lip);
      P.px(mx + 2, mouthY + 1, lip);
      break;
    case 'o':
      P.px(mx, mouthY, OUTLINE);
      P.px(mx + 1, mouthY, OUTLINE);
      break;
    case 'O':
    case 'talk':
      P.rect(mx, mouthY, 2, 2, '#5a1e22');
      if (m === 'O') P.px(mx, mouthY - 1, lip), P.px(mx + 1, mouthY - 1, lip);
      break;
    case 'teeth':
      P.rect(mx - 1, mouthY, 4, 1, '#f4f0ea');
      P.rect(mx - 1, mouthY + 1, 4, 1, lip);
      break;
    case 'wavy':
      P.px(mx - 1, mouthY + 1, lip);
      P.px(mx, mouthY, lip);
      P.px(mx + 1, mouthY + 1, lip);
      P.px(mx + 2, mouthY, lip);
      break;
    case 'smirk':
      P.px(mx + 1, mouthY, lip);
      P.px(mx + 2, mouthY - 1, lip);
      P.px(mx, mouthY, lip);
      break;
    default:
      P.px(mx, mouthY, lip);
      P.px(mx + 1, mouthY, lip);
  }
}

function paintBeard(P: Painter, ap: Appearance, B: Body, c: Pal, top: number, hx: number, mouthY: number): void {
  const bc = ap.age > 58 ? '#d8d4cc' : c.hair;
  const bot = B.headBot - B.headTop + top;
  switch (ap.beard) {
    case 'sombra':
      for (let x = -B.hh + 2; x < B.hh - 2; x++) if (x % 2 === 0) P.px(x + hx, bot - 1, c.skinS);
      P.px(-B.hh + 1 + hx, mouthY, c.skinS);
      P.px(B.hh - 2 + hx, mouthY, c.skinS);
      break;
    case 'corta':
      P.rect(-B.hh + 1 + hx, mouthY - 1, 1, 3, bc);
      P.rect(B.hh - 2 + hx, mouthY - 1, 1, 3, bc);
      P.rect(-B.hh + 2 + hx, mouthY + 1, B.hh * 2 - 4, 2, bc);
      P.rect(-2 + hx, mouthY - 1, 4, 1, tone(bc, 0.85));
      break;
    case 'larga':
      P.rect(-B.hh + 1 + hx, mouthY - 1, 1, 3, bc);
      P.rect(B.hh - 2 + hx, mouthY - 1, 1, 3, bc);
      P.rect(-B.hh + 2 + hx, mouthY + 1, B.hh * 2 - 4, 3, bc);
      P.rect(-3 + hx, bot + 1, 6, 3, bc);
      P.rect(-2 + hx, bot + 4, 4, 1, tone(bc, 0.85));
      P.px(-1 + hx, bot + 2, tone(bc, 1.2));
      P.rect(-2 + hx, mouthY - 1, 4, 1, tone(bc, 0.85));
      break;
    case 'bigote':
      P.rect(-2 + hx, mouthY - 1, 4, 1, bc);
      P.px(-3 + hx, mouthY, bc);
      P.px(2 + hx, mouthY, bc);
      break;
    case 'perilla':
      P.rect(-1 + hx, bot - 1, 2, 2, bc);
      P.rect(-2 + hx, mouthY - 1, 4, 1, tone(bc, 0.85));
      break;
  }
}

function paintHairFront(P: Painter, ap: Appearance, B: Body, c: Pal, top: number, hx: number): void {
  const rows = headRows(B);
  const s = ap.hair.style;
  if (s !== 'calvo') for (let x = -B.hh + 1; x < B.hh - 1; x++) if (!P.get(x + hx, top + 4)) P.px(x + hx, top + 4, c.skinS);
  const cap = (n: number, col = c.hair) => {
    for (let r = 0; r < n; r++) P.rect(-rows[r] - (r > 1 ? 0 : 0) + hx, top + r, rows[r] * 2, 1, col);
    P.rect(-rows[0] + hx, top - 1, rows[0] * 2, 1, col);
  };
  const sides = (to: number, col = c.hair, out = 0) => {
    P.rect(-B.hh - out + hx, top + 1, 1 + out, to, col);
    P.rect(B.hh - 1 + hx, top + 1, 1 + out, to, tone(col, 0.85));
  };
  const hl = () => (P.px(-3 + hx, top, c.hairL), P.px(-2 + hx, top, c.hairL), P.px(-4 + hx, top + 1, c.hairL));
  switch (s) {
    case 'calvo':
      P.px(-3 + hx, top + 1, c.skinL);
      P.rect(-B.hh + hx, top + 4, 1, 3, c.hair);
      P.rect(B.hh - 1 + hx, top + 4, 1, 3, c.hairS);
      return;
    case 'rapado':
      cap(2, c.hairS);
      P.rect(-B.hh + hx, top + 2, 1, 3, c.hairS);
      P.rect(B.hh - 1 + hx, top + 2, 1, 3, c.hairS);
      return;
    case 'rizado':
      cap(3);
      for (let x = -B.hh; x < B.hh; x += 2) P.px(x + hx, top - 2, c.hair), P.px(x + 1 + hx, top + 3, c.hair);
      sides(5, c.hair, 1);
      for (let x = -B.hh + 1; x < B.hh; x += 3) P.px(x + hx, top, c.hairL);
      return;
    case 'largo':
    case 'melena':
      cap(3);
      // Raya en medio y mechones que enmarcan la cara.
      P.px(-1 + hx, top + 1, c.hairS);
      P.rect(-B.hh + 1 + hx, top + 3, 2, 1, c.hair);
      P.rect(B.hh - 3 + hx, top + 3, 2, 1, c.hair);
      sides(s === 'melena' ? 11 : 10, c.hair, s === 'melena' ? 1 : 0);
      hl();
      return;
    case 'trenza':
      cap(3);
      P.px(-1 + hx, top + 1, c.hairS);
      sides(5);
      for (let y = 6; y < 14; y++) P.px(-B.hh + hx, top + y, y % 2 ? c.hair : c.hairS), P.px(-B.hh + 1 + hx, top + y, y % 2 ? c.hairS : c.hair);
      P.px(-B.hh + hx, top + 14, '#c9473a');
      hl();
      return;
    case 'mono':
      cap(3);
      P.oval(-0.5 + hx, top - 2.5, 2.5, 1.5, c.hair);
      P.px(-1 + hx, top - 3, c.hairL);
      sides(4);
      hl();
      return;
    case 'coleta':
      cap(3);
      P.rect(-2 + hx, top + 3, 3, 1, c.hair);
      sides(5);
      P.rect(B.hh + hx, top + 2, 2, 5, c.hairS);
      hl();
      return;
    default:
      // Corto: flequillo desigual y patillas.
      cap(3);
      for (let x = -B.hh + 1; x < B.hh - 1; x++) if ((x + 9) % 3 !== 0) P.px(x + hx, top + 3, c.hair);
      sides(4);
      hl();
  }
}

function paintHairBack(P: Painter, ap: Appearance, B: Body, c: Pal, top: number, hx: number, pose: Pose): void {
  const rows = headRows(B);
  const s = ap.hair.style;
  if (pose.hood) return;
  const n = s === 'calvo' ? 0 : s === 'rapado' ? rows.length - 3 : rows.length - 1;
  if (s === 'calvo') {
    P.rect(-B.hh + hx, top + 4, B.hh * 2, 3, c.hair);
    return;
  }
  for (let r = 0; r < n; r++) P.rect(-rows[r] + hx, top + r, rows[r] * 2, 1, r % 4 === 3 ? c.hairS : c.hair);
  P.rect(-rows[0] + hx, top - 1, rows[0] * 2, 1, c.hair);
  P.px(-2 + hx, top + 1, c.hairL);
  P.px(-3 + hx, top + 2, c.hairL);
  if (longHair(ap)) {
    P.rect(-B.hh + 1 + hx, B.headBot + 1, B.hh * 2 - 2, s === 'melena' ? 6 : 5, c.hair);
    P.rect(-1 + hx, B.headBot + 1, 1, 5, c.hairS);
    if (s === 'trenza') P.rect(-1 + hx, B.headBot + 1, 2, 8, c.hairS), P.px(-1 + hx, B.headBot + 9, '#c9473a');
  }
  if (s === 'coleta') P.rect(-1 + hx, B.headBot, 2, 6, c.hairS);
  if (s === 'mono') P.oval(-0.5 + hx, top - 2, 2.5, 1.5, c.hair);
}

function paintHood(P: Painter, ap: Appearance, B: Body, top: number, hx: number, back: boolean): void {
  const col = vivid(ap.outfit.cloak?.color ?? ap.outfit.hatColor ?? '#5d5446');
  const sh = tone(col, 0.75);
  const n = B.headBot - B.headTop + 1;
  if (back) {
    for (let r = -1; r < n + 1; r++) P.rect(-B.hh - 1 + hx, top + r, B.hh * 2 + 2, 1, r % 4 === 2 ? sh : col);
    P.poly([-2 + hx, top + n + 1, 2 + hx, top + n + 1, hx, top + n + 4], sh);
    return;
  }
  P.rect(-B.hh + hx, top - 2, B.hh * 2, 3, col);
  P.rect(-B.hh - 1 + hx, top, 2, n, col);
  P.rect(B.hh - 1 + hx, top, 2, n, sh);
  P.rect(-B.hh + 1 + hx, top + 1, B.hh * 2 - 2, 1, sh);
  P.px(-2 + hx, top - 1, tone(col, 1.2));
}

function paintHat(P: Painter, ap: Appearance, B: Body, c: Pal, top: number, hx: number, pose: Pose, back: boolean): void {
  const o = ap.outfit;
  const h = o.hat;
  if (!h) return;
  const col = vivid(o.hatColor);
  const s = tone(col, 0.72);
  const l = tone(col, 1.2);
  const W = B.hh;
  switch (h) {
    case 'paja': {
      const straw = '#e2bf6a';
      P.rect(-W - 2 + hx, top + 2, W * 2 + 4, 1, straw);
      P.rect(-W - 1 + hx, top + 3, W * 2 + 2, 1, tone(straw, 0.75));
      P.rect(-W + 2 + hx, top - 2, W * 2 - 4, 4, straw);
      P.rect(-W + 2 + hx, top + 1, W * 2 - 4, 1, col);
      for (let x = -W; x < W; x += 3) P.px(x + hx, top + 2, tone(straw, 0.85));
      P.px(-W + 3 + hx, top - 2, tone(straw, 1.2));
      break;
    }
    case 'gorro':
      P.rect(-W + hx, top - 2, W * 2, 5, col);
      for (let x = -W; x < W; x += 2) P.px(x + hx, top + 1, s), P.px(x + hx, top + 2, s);
      P.rect(-W + hx, top + 2, W * 2, 1, s);
      P.rect(-1 + hx, top - 4, 2, 2, l);
      break;
    case 'boina':
      P.rect(-W - 1 + hx, top, W * 2 + 1, 2, col);
      P.rect(-W + hx, top - 1, W * 2 - 1, 1, col);
      P.rect(-W - 1 + hx, top + 1, W * 2 + 1, 1, s);
      P.px(hx, top - 2, s);
      break;
    case 'piel':
      for (let y = -3; y <= 2; y++) for (let x = -W - 1; x <= W; x++) P.px(x + hx, top + y, (x * 3 + y * 5) % 4 === 0 ? tone('#8a6a4a', 0.8) : y === 2 ? '#d8c8a8' : '#8a6a4a');
      P.rect(-W - 1 + hx, top + 2, W * 2 + 2, 1, '#e2d6bf');
      break;
    case 'capucha':
      paintHood(P, ap, B, top, hx, back);
      break;
    case 'panuelo':
      P.rect(-W + hx, top - 1, W * 2, 4, col);
      for (let x = -W + 1; x < W; x += 3) P.px(x + hx, top, l);
      if (!back) P.rect(W - 1 + hx, top + 3, 2, 2, s);
      break;
    case 'pluma':
      P.rect(-W - 1 + hx, top + 1, W * 2 + 2, 1, s);
      P.rect(-W + 1 + hx, top - 3, W * 2 - 2, 4, col);
      P.rect(-W + 1 + hx, top, W * 2 - 2, 1, vivid(o.trim));
      P.line(W - 2 + hx, top - 2, W + 2 + hx, top - 7, '#c9473a');
      P.line(W - 1 + hx, top - 2, W + 3 + hx, top - 6, '#e8704a');
      break;
    case 'casco':
      P.rect(-W + hx, top - 2, W * 2, 6, '#9aa0a8');
      P.rect(-W + hx, top + 3, W * 2, 1, '#6a7078');
      P.rect(-W + 1 + hx, top - 1, 2, 2, '#d0d4da');
      if (!back) P.rect(-1 + hx, top + 4, 2, 2, '#7a8088');
      P.rect(-1 + hx, top - 3, 2, 1, vivid(o.armor?.tabard ?? col));
      break;
    case 'corona':
      P.rect(-W + 1 + hx, top + 1, W * 2 - 2, 1, '#e9c04a');
      for (const x of [-W + 1, -1, 0, W - 2]) P.px(x + hx, top, '#e9c04a');
      P.px(-1 + hx, top + 1, '#c9302a');
      P.px(0 + hx, top + 1, '#f0d070');
      break;
    case 'turbante':
      for (let y = -3; y <= 2; y++) P.rect(-W - (y > -2 ? 1 : 0) + hx, top + y, W * 2 + (y > -2 ? 2 : 0), 1, y % 2 ? col : s);
      if (!back) P.rect(-1 + hx, top - 1, 2, 2, '#e9c04a');
      break;
    case 'impermeable': {
      const y = '#e2b84a';
      P.rect(-W + hx, top - 2, W * 2, 4, y);
      P.rect(-W - 2 + hx, top + 2, W * 2 + 4, 1, tone(y, 0.8));
      P.px(-W + 1 + hx, top - 1, tone(y, 1.2));
      break;
    }
  }
  void c;
  void pose;
}

// ---------------------------------------------------------------------------
// Perfil (mirando a la derecha; a la izquierda se espeja)
// ---------------------------------------------------------------------------
function paintSide(P: Painter, ap: Appearance, B: Body, c: Pal, pose: Pose, f: ReturnType<typeof frameOf>, dy: number): void {
  const o = ap.outfit;
  const a = pose.action;
  const run = a === 'run';
  const walking = a === 'walk' || run;
  const stride = walking ? [0, 2, 0, -2][f.walk] * (run ? 1.5 : 1) : 0;
  const legC = o.bottom === 'falda' ? c.skinS : c.bot;
  const tw = B.child ? 2 : 3; // media anchura del torso de perfil
  const lean = run ? 1 : 0;
  // Capa por detrás.
  if (o.cloak) {
    const cc = vivid(o.cloak.color);
    const bottom = hemRow(B, pose.heavy || o.cloak.fur ? 0.75 : 0.9);
    for (let y = B.sh + dy; y < bottom + dy; y++) P.rect(-tw - 2 - Math.floor((y - B.sh - dy) / 3) - (run ? 1 : 0), y, 3, 1, tone(cc, 0.8));
  }
  // Piernas: la de atrás más oscura.
  const leg = (x: number, col: string) => {
    if (a === 'sit') {
      P.rect(-1, B.legTop + 3, 5, 2, col);
      P.rect(3, B.legTop + 5, 2, -2 - B.legTop - 5, col);
      P.rect(3, -2, 3, 2, c.shoe);
      return;
    }
    const xs = Math.round(x);
    for (let y = B.legTop; y < -2; y++) {
      const t = (y - B.legTop) / (-2 - B.legTop);
      P.rect(Math.round(xs * t) - 1, y, 3, 1, col);
    }
    P.rect(xs - 1, -2, 4, 2, c.shoe);
    P.rect(xs - 1, -2, 4, 1, tone(c.shoe, 1.15));
  };
  leg(-stride, tone(legC, 0.78));
  leg(stride, legC);
  // Falda / túnica larga.
  const long = o.top === 'tunicaLarga' || o.top === 'abrigo' || o.bottom === 'falda';
  if (long) {
    const bottom = hemRow(B, Math.max(o.hem, o.bottom === 'falda' ? 0.75 : 0.6));
    const col = o.bottom === 'falda' && o.top !== 'tunicaLarga' && o.top !== 'abrigo' ? c.bot : c.top;
    for (let y = B.hip + dy; y <= bottom; y++) {
      const wdt = tw + Math.floor((y - B.hip - dy) / 3);
      P.rect(-wdt, y, wdt * 2 + 1, 1, col);
      P.px(wdt, y, tone(col, 0.8));
    }
  }
  // Mochila.
  if (o.backpack) P.rect(-tw - 3, B.sh + 2 + dy, 3, 6, vivid(o.backpack)), P.px(-tw - 3, B.sh + 2 + dy, tone(o.backpack, 1.2));
  // Torso.
  for (let y = B.sh; y <= B.hip; y++) P.rect(-tw + (y < B.sh + 2 ? lean : 0), y + dy, tw * 2 + 1, 1, c.top);
  P.rect(tw, B.sh + 1 + dy, 1, B.hip - B.sh, c.topS);
  if (o.vest) P.rect(-tw, B.sh + 1 + dy, 2, B.hip - B.sh - 1, vivid(o.vest));
  if (o.apron) P.rect(tw - 1, B.sh + 3 + dy, 2, B.hip - B.sh + 2, o.apron);
  if (o.armor) P.rect(-1, B.sh + 1 + dy, 3, B.hip - B.sh + 2, vivid(o.armor.tabard));
  P.rect(-tw, B.hip + dy, tw * 2 + 1, 1, vivid(o.belt));
  if (o.sash) P.rect(-tw, B.hip - 1 + dy, tw * 2 + 1, 2, vivid(o.sash));
  if (o.pouch) P.rect(tw - 1, B.hip + 1 + dy, 2, 2, vivid(o.pouch));
  // Brazo: balanceo o gesto.
  const sleeve = o.armor?.mail ? '#8f949c' : c.top;
  const hand = o.gloves ? vivid(o.gloves) : c.skin;
  const sh = B.sh + dy;
  const L = B.hip - B.sh;
  let hx = 0;
  let hy = sh + L;
  if (a === 'work' || a === 'hammer' || a === 'fish' || a === 'carry' || a === 'point' || a === 'talk' || a === 'wave') {
    const up = (a === 'work' || a === 'hammer') && f.act < 2;
    const fx = a === 'point' ? 6 : a === 'wave' ? 1 : 3;
    const fy = a === 'wave' ? -8 : up ? -3 : a === 'talk' ? 3 - (f.act % 2) : 4;
    P.rect(-1, sh, 2, 3, sleeve);
    P.line(0, sh + 2, fx, sh + fy, sleeve);
    P.line(1, sh + 2, fx + 1, sh + fy, sleeve);
    P.rect(fx, sh + fy - 1, 2, 2, hand);
    hx = fx;
    hy = sh + fy;
  } else if (a === 'cross') {
    P.rect(-1, sh, 2, 4, sleeve);
    P.rect(-1, sh + 4, tw + 2, 2, tone(sleeve, 0.85));
    P.rect(tw, sh + 4, 1, 2, hand);
    hx = tw;
    hy = sh + 5;
  } else {
    const sw = walking ? [0, 2, 0, -2][f.walk] * (run ? 1.5 : 1) : 0;
    for (let k = 0; k < L; k++) {
      const t = k / L;
      P.rect(Math.round(sw * t * 0.8) - 1, sh + k, 2, 1, k >= L - (o.sleeves === 'cortas' ? 4 : o.sleeves === 'remangadas' ? 2 : 0) ? c.skin : sleeve);
    }
    P.rect(Math.round(sw * 0.8) - 1, sh + L, 2, 2, hand);
    hx = Math.round(sw * 0.8);
    hy = sh + L + 1;
  }
  // Objeto en la mano (perfil).
  paintItemSide(P, ap, B, pose, f, hx, hy, dy);
  // Cabeza de perfil.
  const nod = a === 'nod' && f.act % 2 ? 1 : 0;
  const top = B.headTop + dy + nod;
  const hxo = lean + (ap.stoop > 0.2 ? 1 : 0);
  const rows = headRows(B);
  rows.forEach((w, r) => P.rect(-w + 1 + hxo, top + r, w * 2 - 1, 1, c.skin));
  // Nariz, ojo, ceja, boca, oreja.
  const fx = B.hh + hxo;
  const k = B.child ? -1 : 0;
  P.px(fx, top + 6 + k, c.skin);
  P.px(fx, top + 7 + k, c.skinS);
  const F = FACES[pose.expr];
  const blink = f.blink && F.eyes !== 'happy';
  if (blink || F.eyes === 'happy' || F.eyes === 'closed') P.rect(fx - 3, top + 6 + k, 2, 1, OUTLINE);
  else {
    P.px(fx - 2, top + 5 + k, OUTLINE);
    P.px(fx - 2, top + 6 + k, ap.eye.color);
    if (F.eyes === 'wide') P.px(fx - 3, top + 6 + k, '#ffffff'), P.px(fx - 3, top + 5 + k, '#ffffff');
    else P.px(fx - 3, top + 6 + k, '#f4f0ea');
  }
  const by = top + 4 + k + (F.brows === 'angry' ? 0 : F.brows === 'worried' || F.brows === 'up' ? -1 : 0);
  P.px(fx - 2, by + (F.brows === 'angry' ? 1 : 0), c.brow);
  P.px(fx - 3, by, c.brow);
  const my = top + 8 + k;
  if (f.talkOpen || F.mouth === 'O' || F.mouth === 'o') P.rect(fx - 2, my, 2, F.mouth === 'O' || f.talkOpen ? 2 : 1, '#5a1e22');
  else if (F.mouth === 'smile') P.px(fx - 2, my, c.lip), P.px(fx - 1, my - 1, c.lip);
  else if (F.mouth === 'frown') P.px(fx - 2, my, c.lip), P.px(fx - 1, my + 1, c.lip);
  else if (F.mouth === 'teeth') P.rect(fx - 2, my, 2, 1, '#f4f0ea');
  else P.rect(fx - 2, my, 2, 1, c.lip);
  if (F.blush || ap.fem) P.px(fx - 4, top + 7 + k, '#e8908a');
  if (F.tear) P.px(fx - 3, top + 7 + k, '#7ab8e8');
  // Barba de perfil.
  if (ap.beard !== 'ninguna' && ap.beard !== 'sombra') {
    const bc = ap.age > 58 ? '#d8d4cc' : c.hair;
    if (ap.beard === 'bigote') P.rect(fx - 2, my - 1, 3, 1, bc);
    else {
      P.rect(fx - 5, my - 1, 4, 3, bc);
      P.rect(fx - 2, my + 1, 3, ap.beard === 'larga' ? 4 : 2, bc);
      P.px(fx - 1, my, c.lip);
    }
  }
  // Pelo de perfil: nuca y coronilla.
  const s = ap.hair.style;
  if (pose.hood) {
    const col = vivid(o.cloak?.color ?? o.hatColor);
    P.rect(-B.hh + hxo, top - 2, B.hh * 2, 3, col);
    P.rect(-B.hh - 1 + hxo, top, B.hh + 1, rows.length + 1, col);
    P.rect(fx - 4, top - 1, 4, 2, tone(col, 0.8));
  } else if (s !== 'calvo') {
    const back = s === 'rapado' ? 6 : longHair(ap) ? 13 : 8;
    P.rect(-B.hh + 1 + hxo, top - 1, B.hh * 2 - 2, 1, c.hair);
    for (let r = 0; r < 3; r++) P.rect(-rows[r] + 1 + hxo, top + r, rows[r] * 2 - 2 - (r === 2 ? 2 : 0), 1, s === 'rapado' ? c.hairS : c.hair);
    P.rect(-B.hh + hxo, top + 2, 4, back - 2, c.hair);
    P.rect(-B.hh + hxo, top + 3, 1, back - 3, c.hairS);
    if (s === 'coleta') P.rect(-B.hh - 2 + hxo, top + 2, 2, 5, c.hairS);
    if (s === 'mono') P.oval(-2 + hxo, top - 2, 2, 1.5, c.hair);
    if (s === 'rizado') for (let x = -B.hh; x < B.hh - 1; x += 2) P.px(x + hxo, top - 2, c.hair);
    P.px(-1 + hxo, top, c.hairL);
    P.px(hxo, top, c.hairL);
  }
  P.px(-1 + hxo, top + 6 + k, c.skinS);
  if (!pose.hood) paintHatSide(P, ap, B, top, hxo);
}

function paintHatSide(P: Painter, ap: Appearance, B: Body, top: number, hx: number): void {
  const o = ap.outfit;
  if (!o.hat) return;
  const col = vivid(o.hatColor);
  const W = B.hh;
  switch (o.hat) {
    case 'paja':
      P.rect(-W - 2 + hx, top + 2, W * 2 + 5, 1, '#e2bf6a');
      P.rect(-W + 1 + hx, top - 2, W * 2 - 2, 4, '#e2bf6a');
      P.rect(-W + 1 + hx, top + 1, W * 2 - 2, 1, col);
      break;
    case 'gorro':
    case 'panuelo':
    case 'turbante':
      P.rect(-W + hx, top - 2, W * 2, 4, col);
      P.rect(-W + hx, top + 1, W * 2, 1, tone(col, 0.75));
      if (o.hat === 'panuelo') P.rect(-W - 2 + hx, top + 2, 2, 2, tone(col, 0.8));
      break;
    case 'boina':
      P.rect(-W - 1 + hx, top - 1, W * 2 + 1, 2, col);
      break;
    case 'piel':
      P.rect(-W - 1 + hx, top - 3, W * 2 + 1, 5, '#8a6a4a');
      P.rect(-W - 1 + hx, top + 1, W * 2 + 1, 1, '#e2d6bf');
      break;
    case 'capucha':
      P.rect(-W + hx, top - 2, W * 2, 3, col);
      P.rect(-W - 1 + hx, top, W + 1, B.headBot - B.headTop + 2, col);
      break;
    case 'pluma':
      P.rect(-W - 1 + hx, top + 1, W * 2 + 3, 1, tone(col, 0.72));
      P.rect(-W + 1 + hx, top - 3, W * 2 - 2, 4, col);
      P.line(-W + hx, top - 2, -W - 4 + hx, top - 7, '#c9473a');
      break;
    case 'casco':
      P.rect(-W + hx, top - 2, W * 2, 6, '#9aa0a8');
      P.rect(-W + hx, top + 3, W * 2, 1, '#6a7078');
      P.rect(-W + 2 + hx, top - 1, 2, 2, '#d0d4da');
      break;
    case 'corona':
      P.rect(-W + 1 + hx, top + 1, W * 2 - 2, 1, '#e9c04a');
      P.px(-W + 2 + hx, top, '#e9c04a');
      P.px(W - 2 + hx, top, '#e9c04a');
      break;
    case 'impermeable':
      P.rect(-W + hx, top - 2, W * 2, 4, '#e2b84a');
      P.rect(-W - 3 + hx, top + 2, W * 2 + 4, 1, '#b8923a');
      break;
  }
}

function paintItemSide(P: Painter, ap: Appearance, B: Body, pose: Pose, f: ReturnType<typeof frameOf>, x: number, y: number, dy: number): void {
  const it = ap.outfit.item;
  const a = pose.action;
  const wood = '#7a5232';
  const metal = '#a8adb4';
  if (a === 'work') {
    const up = f.act < 2;
    if (up) P.line(x, y, x - 2, y - 9, wood), P.rect(x - 4, y - 11, 3, 2, metal);
    else P.line(x, y, x + 5, -2, wood), P.rect(x + 5, -3, 2, 3, metal);
    return;
  }
  switch (it) {
    case 'martillo':
      if (a === 'hammer' && f.act < 2) P.line(x, y, x - 1, y - 4, wood), P.rect(x - 3, y - 6, 4, 2, '#6a6f78');
      else P.line(x, y, x + 2, y + 3, wood), P.rect(x + 1, y + 3, 4, 2, '#6a6f78');
      break;
    case 'cana':
      P.line(x, y, x + 10, y - 10, '#9a6e44');
      P.line(x + 10, y - 10, x + 13, -1, '#d8dde2');
      break;
    case 'lanza':
      P.line(x, -1, x + 1, B.headTop - 6 + dy, wood);
      P.poly([x - 0.5, B.headTop - 6 + dy, x + 1.5, B.headTop - 11 + dy, x + 3.5, B.headTop - 6 + dy], metal);
      break;
    case 'cayado':
    case 'baston':
      P.line(x + 1, -1, x + 1, y - (it === 'cayado' ? 8 : 1), wood);
      if (it === 'cayado') P.px(x + 2, y - 9, wood), P.px(x + 3, y - 8, wood);
      break;
    case 'cesta':
      P.rect(x - 2, y + 1, 5, 3, '#b08850');
      P.rect(x - 2, y + 1, 5, 1, '#c9a064');
      break;
    case 'saco':
      P.oval(x, y + 3, 2.5, 3, '#c8b088');
      break;
    case 'farol':
      P.rect(x - 1, y + 2, 3, 4, '#3a2e22');
      P.px(x, y + 3, '#ffe28a');
      P.px(x, y + 4, '#ffcf5a');
      break;
    case 'arco':
      P.line(-3, B.sh - 3 + dy, -4, B.hip + 1 + dy, '#8a5a2a');
      break;
  }
}

// ---------------------------------------------------------------------------
// Retratos de diálogo (busto grande en pixel art, 48×48)
// ---------------------------------------------------------------------------
const PORTRAIT = 48;

/** Retrato de busto con la expresión indicada. El lienzo se escala sin suavizado. */
export function drawPortrait(canvas: HTMLCanvasElement, ap: Appearance, expr: Expr, t = 0, bg = '#d9c8a4'): void {
  const P = new Painter(PORTRAIT, PORTRAIT, PORTRAIT / 2, PORTRAIT);
  const c = palOf(ap);
  const o = ap.outfit;
  const F = FACES[expr];
  const blink = (t * 1000) % 3900 < 150 && F.eyes !== 'happy';
  const talk = false;
  // Hombros y ropa.
  const shY = -12;
  const cloak = o.cloak ? vivid(o.cloak.color) : null;
  for (let y = shY; y < 0; y++) {
    const w = 15 + Math.min(4, Math.floor((y - shY) / 2));
    P.rect(-w, y, w * 2, 1, c.top);
    P.px(-w, y, c.topL);
    P.px(w - 1, y, c.topS);
  }
  if (o.pattern === 'rayas') for (let y = shY + 2; y < 0; y += 2) P.rect(-16, y, 32, 1, tone(c.top, 0.8));
  if (o.vest) P.rect(-15, shY + 1, 7, 12, vivid(o.vest)), P.rect(8, shY + 1, 7, 12, tone(o.vest, 0.85));
  if (o.armor) {
    P.rect(-6, shY + 2, 12, 12, vivid(o.armor.tabard));
    P.rect(-2, shY + 5, 4, 4, vivid(o.armor.emblem));
    if (o.armor.mail) for (let y = shY; y < 0; y++) for (let x = -19; x < -7; x++) if ((x + y) % 2 === 0) P.px(x, y, '#9aa0a8');
  }
  if (o.apron) P.rect(-7, shY + 5, 14, 9, o.apron);
  if (o.shawl) P.rect(-16, shY, 32, 4, vivid(o.shawl)), P.poly([-8, shY + 4, 8, shY + 4, 0, shY + 10], vivid(o.shawl));
  if (o.strap) P.line(12, shY, -10, -1, tone(o.strap, 0.9)), P.line(13, shY, -9, -1, tone(o.strap, 0.9));
  // Cuello y escote.
  P.rect(-3, shY - 3, 6, 4, c.skinS);
  P.poly([-4, shY, 4, shY, 0, shY + 4], c.skin);
  if (o.trim) P.line(-5, shY, 0, shY + 5, vivid(o.trim)), P.line(5, shY, 0, shY + 5, vivid(o.trim));
  if (o.jewelry) P.rect(-1, shY + 4, 2, 2, o.jewelry), P.px(0, shY + 3, tone(o.jewelry, 1.3));
  if (cloak) {
    P.rect(-20, shY, 6, 12, cloak);
    P.rect(14, shY, 6, 12, tone(cloak, 0.8));
    if (o.cloak!.fur) P.rect(-18, shY - 2, 36, 3, '#e6dcc6');
    else P.rect(-2, shY, 4, 2, o.cloak!.clasp);
  }
  // Pelo largo por detrás.
  const hair = ap.hair.style;
  const longH = hair === 'largo' || hair === 'melena' || hair === 'trenza';
  const hy = -40; // coronilla
  if (longH) P.rect(-13, hy + 8, 26, 26, c.hairS);
  // Cara.
  const faceRows = 24;
  for (let r = 0; r < faceRows; r++) {
    const k = r / (faceRows - 1);
    const w = Math.round(11 * (r < 3 ? 0.75 + r * 0.08 : k > 0.72 ? 1 - (k - 0.72) * 1.4 * ap.jaw : 1));
    P.rect(-w, hy + 4 + r, w * 2, 1, c.skin);
    P.rect(w - 2, hy + 4 + r, 2, 1, c.skinS);
  }
  P.rect(-12, hy + 13, 2, 4, c.skin);
  P.rect(10, hy + 13, 2, 4, c.skinS);
  // Ojos.
  const eyeY = hy + 15;
  const eye = (x: number, side: -1 | 1) => {
    if (blink || F.eyes === 'closed') return P.rect(x, eyeY + 2, 4, 1, OUTLINE);
    if (F.eyes === 'happy') {
      P.px(x, eyeY + 2, OUTLINE);
      P.rect(x + 1, eyeY + 1, 2, 1, OUTLINE);
      P.px(x + 3, eyeY + 2, OUTLINE);
      return;
    }
    const half = F.eyes === 'half';
    P.rect(x, eyeY + (half ? 1 : 0), 4, half ? 2 : 3, '#f6f2ea');
    P.rect(x + (side < 0 ? 1 : 1), eyeY + (half ? 1 : 0), 2, half ? 2 : 3, ap.eye.color);
    P.px(x + (side < 0 ? 2 : 1), eyeY + 1, OUTLINE);
    if (!half) P.px(x + (side < 0 ? 1 : 2), eyeY, '#ffffff');
    P.rect(x - (F.eyes === 'wide' ? 1 : 0), eyeY - 1 + (half ? 1 : 0), 4 + (F.eyes === 'wide' ? 1 : 0), 1, OUTLINE);
    if (F.eyes === 'wide') P.rect(x, eyeY + 3, 4, 1, '#f6f2ea');
  };
  eye(-8, -1);
  eye(4, 1);
  // Cejas.
  const brow = (x: number, side: -1 | 1) => {
    const by = eyeY - 3;
    const thick = ap.brow.thick > 1 ? 2 : 1;
    for (let i = 0; i < 5; i++) {
      const inner = side < 0 ? i / 4 : 1 - i / 4; // 1 = lado interior
      let off = 0;
      if (F.brows === 'angry') off = Math.round(inner * 2 - 0.6);
      else if (F.brows === 'worried') off = -Math.round(inner * 2 - 0.4);
      else if (F.brows === 'up') off = -1;
      else if (F.brows === 'asym') off = side > 0 ? -1 : Math.round(inner);
      P.rect(x + i, by + off, 1, thick, c.brow);
    }
  };
  brow(-9, -1);
  brow(4, 1);
  // Nariz.
  P.px(-1, eyeY + 6, c.skinS);
  P.px(0, eyeY + 7, c.skinS);
  P.px(-1, eyeY + 7, tone(c.skin, 0.7));
  // Mejillas, pecas, arrugas, lágrima.
  if (F.blush || ap.fem) P.rect(-9, eyeY + 6, 3, 1, '#ec9a90'), P.rect(6, eyeY + 6, 3, 1, '#ec9a90');
  if (ap.freckles) for (const x of [-8, -6, 5, 7]) P.px(x, eyeY + 5, tone(c.skin, 0.72));
  if (ap.wrinkles > 0.3) P.line(-4, eyeY + 8, -5, eyeY + 10, c.skinS), P.line(3, eyeY + 8, 4, eyeY + 10, c.skinS), P.px(-10, eyeY + 1, c.skinS), P.px(9, eyeY + 1, c.skinS);
  if (F.tear) P.rect(-8, eyeY + 4, 1, 3, '#8ac4ee');
  if (F.sweat) P.rect(10, hy + 8, 2, 3, '#a8d4f4');
  // Barba.
  const bc = ap.age > 58 ? '#d8d4cc' : c.hair;
  const my = eyeY + 10;
  if (ap.beard === 'corta' || ap.beard === 'larga') {
    for (let y = my - 2; y < hy + 28 + (ap.beard === 'larga' ? 5 : 1); y++) {
      const w = y < my ? 10 : Math.max(3, 9 - Math.floor((y - my) / 2));
      P.rect(-w, y, w * 2, 1, (y + 1) % 3 === 0 ? tone(bc, 0.85) : bc);
    }
    P.rect(-3, my - 2, 6, 1, tone(bc, 0.8));
  } else if (ap.beard === 'bigote') P.rect(-4, my - 2, 8, 2, bc);
  else if (ap.beard === 'perilla') P.rect(-2, my + 2, 4, 4, bc), P.rect(-3, my - 2, 6, 1, bc);
  else if (ap.beard === 'sombra') for (let x = -8; x < 8; x += 2) P.px(x, my + 3, c.skinS), P.px(x + 1, my + 1, c.skinS);
  // Boca.
  const lip = c.lip;
  switch (talk ? 'talk' : F.mouth) {
    case 'smile':
      P.rect(-3, my, 6, 1, lip);
      P.px(-4, my - 1, lip);
      P.px(3, my - 1, lip);
      break;
    case 'frown':
      P.rect(-2, my, 4, 1, lip);
      P.px(-3, my + 1, lip);
      P.px(2, my + 1, lip);
      break;
    case 'o':
      P.rect(-1, my, 2, 2, '#5a1e22');
      break;
    case 'O':
    case 'talk':
      P.rect(-2, my - 1, 4, 3, '#5a1e22');
      P.rect(-1, my + 1, 2, 1, '#c9545a');
      break;
    case 'teeth':
      P.rect(-3, my - 1, 6, 2, '#f4f0ea');
      P.rect(-3, my + 1, 6, 1, lip);
      P.rect(-4, my - 1, 1, 2, lip);
      P.rect(3, my - 1, 1, 2, lip);
      break;
    case 'wavy':
      P.px(-3, my + 1, lip);
      P.px(-2, my, lip);
      P.px(-1, my + 1, lip);
      P.px(0, my, lip);
      P.px(1, my + 1, lip);
      P.px(2, my, lip);
      break;
    case 'smirk':
      P.rect(-1, my, 4, 1, lip);
      P.px(3, my - 1, lip);
      break;
    default:
      P.rect(-2, my, 4, 1, lip);
  }
  // Pelo delantero.
  const hc = c.hair;
  if (hair !== 'calvo') {
    const fringe = hair === 'rapado' ? 2 : 6;
    for (let r = 0; r < fringe + 3; r++) {
      const w = r < 2 ? 8 + r * 2 : 12;
      P.rect(-w, hy + 1 + r, w * 2, 1, hc);
    }
    // Volumen: la melena sobresale un poco de la cabeza.
    P.rect(-10, hy, 20, 1, hc);
    P.rect(-7, hy - 1, 14, 1, hc);
    // Mechones del flequillo, con sombra bajo ellos.
    if (hair !== 'rapado') {
      for (let x = -10; x < 11; x++) P.px(x, hy + fringe + 4, c.skinS);
      for (let x = -11; x < 11; x += 4) P.poly([x, hy + fringe + 3, x + 4, hy + fringe + 3, x + 1, hy + fringe + 6], hc);
      // Mechas: trazos oscuros y un brillo en arco.
      for (let x = -9; x < 10; x += 3) P.line(x, hy + 2, x + 1, hy + fringe + 1, c.hairS);
    }
    P.rect(-7, hy + 1, 5, 1, c.hairL);
    P.rect(-9, hy + 2, 3, 1, c.hairL);
    P.rect(-2, hy + 1, 2, 1, tone(c.hairL, 1.15));
    if (hair === 'rizado') for (let x = -12; x < 12; x += 3) P.oval(x, hy + 1, 1.5, 1.5, hc), P.oval(x - 1, hy + 9, 1.5, 1.5, hc);
    const sideTo = longH ? 30 : hair === 'rapado' ? 10 : 14;
    P.rect(-13, hy + 4, 3, sideTo - 4, hc);
    P.rect(10, hy + 4, 3, sideTo - 4, tone(hc, 0.85));
    if (hair === 'mono') P.oval(0, hy - 2, 5, 3, hc), P.rect(-2, hy - 3, 3, 1, c.hairL);
    if (hair === 'coleta') P.rect(12, hy + 6, 4, 14, c.hairS);
    if (hair === 'trenza') for (let y = hy + 18; y < hy + 40; y++) P.rect(-15 + ((y >> 1) % 2), y, 4, 1, y % 3 ? hc : c.hairS);
    if (hair === 'melena') P.rect(-15, hy + 6, 3, 26, hc), P.rect(12, hy + 6, 3, 26, tone(hc, 0.85));
  } else {
    P.rect(-12, hy + 12, 3, 6, hc);
    P.rect(9, hy + 12, 3, 6, tone(hc, 0.85));
    P.rect(-5, hy + 6, 3, 1, c.skinL);
  }
  // Sombrero.
  paintPortraitHat(P, ap, hy);
  const tmp = P.toCanvas();
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Viñeta suave del fondo, en bandas (sin degradados).
  g.fillStyle = 'rgba(255,255,255,0.12)';
  const u = canvas.width / PORTRAIT;
  g.fillRect(u * 8, u * 4, u * 32, u * 36);
  g.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}

function paintPortraitHat(P: Painter, ap: Appearance, hy: number): void {
  const o = ap.outfit;
  if (!o.hat) return;
  const col = vivid(o.hatColor);
  const s = tone(col, 0.72);
  switch (o.hat) {
    case 'paja':
      P.rect(-20, hy + 6, 40, 3, '#e2bf6a');
      P.rect(-18, hy + 9, 36, 1, '#b8923a');
      P.rect(-11, hy - 4, 22, 10, '#e2bf6a');
      P.rect(-11, hy + 3, 22, 2, col);
      for (let x = -18; x < 18; x += 4) P.px(x, hy + 7, '#c9a050');
      break;
    case 'gorro':
      P.rect(-13, hy - 4, 26, 12, col);
      for (let x = -13; x < 13; x += 2) P.rect(x, hy + 4, 1, 4, s);
      P.rect(-3, hy - 7, 6, 4, tone(col, 1.2));
      break;
    case 'boina':
      P.oval(-1, hy + 2, 14, 4, col);
      P.rect(-13, hy + 5, 26, 2, s);
      break;
    case 'piel':
      for (let y = hy - 5; y < hy + 8; y++) for (let x = -14; x < 14; x++) P.px(x, y, (x * 3 + y * 7) % 5 === 0 ? '#6a5038' : '#8a6a4a');
      P.rect(-14, hy + 6, 28, 3, '#e2d6bf');
      break;
    case 'capucha':
      P.rect(-15, hy - 3, 30, 6, col);
      P.rect(-16, hy, 4, 34, col);
      P.rect(12, hy, 4, 34, s);
      break;
    case 'panuelo':
      P.rect(-13, hy - 2, 26, 9, col);
      for (let x = -12; x < 12; x += 4) P.px(x, hy + 1, tone(col, 1.3)), P.px(x + 2, hy + 4, tone(col, 1.3));
      P.rect(12, hy + 6, 4, 4, s);
      break;
    case 'pluma':
      P.rect(-17, hy + 4, 34, 2, s);
      P.rect(-11, hy - 6, 22, 10, col);
      P.rect(-11, hy + 1, 22, 2, vivid(o.trim));
      P.line(8, hy - 4, 18, hy - 16, '#c9473a');
      P.line(9, hy - 4, 19, hy - 15, '#e8704a');
      break;
    case 'casco':
      P.rect(-13, hy - 4, 26, 13, '#9aa0a8');
      P.rect(-13, hy + 8, 26, 2, '#6a7078');
      P.rect(-1, hy + 9, 2, 8, '#7a8088');
      P.rect(-9, hy - 2, 4, 3, '#d4d8de');
      break;
    case 'corona':
      P.rect(-11, hy + 3, 22, 2, '#e9c04a');
      for (const x of [-10, -5, -1, 3, 8]) P.rect(x, hy, 2, 3, '#e9c04a');
      P.rect(-1, hy + 3, 2, 2, '#c9302a');
      break;
    case 'turbante':
      for (let y = hy - 6; y < hy + 8; y++) P.rect(-14, y, 28, 1, y % 3 ? col : s);
      P.rect(-2, hy, 4, 4, '#e9c04a');
      break;
    case 'impermeable':
      P.rect(-13, hy - 4, 26, 10, '#e2b84a');
      P.rect(-18, hy + 6, 36, 2, '#b8923a');
      break;
  }
}
