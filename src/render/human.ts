import { darken, type Appearance } from './appearance';

/**
 * Figura humana vectorial: proporciones creíbles (adulto de 48 px, cabeza
 * ≈ 1/7 de la altura), rostro con ojos, cejas, nariz, boca, orejas, barba y
 * arrugas; ropa por capas (calzado, calzas o falda, camisa, chaleco,
 * delantal, cinturón, fajín, bolsa, capa, armadura, sombrero); vistas de
 * frente, espalda y perfil; animación por un esqueleto sencillo.
 *
 * Niveles de detalle: 0 = cercano (todo), 1 = intermedio (sin microdetalles),
 * 2 = lejano (silueta y colores).
 */
export type Expr = 'feliz' | 'neutral' | 'preocupado' | 'enfadado' | 'miedo' | 'triste' | 'sorpresa' | 'desconfianza' | 'alivio' | 'hostil';
export type Facing = 'front' | 'back' | 'side';
export type Action = 'idle' | 'walk' | 'run' | 'work' | 'hammer' | 'sit' | 'talk' | 'wave' | 'cross' | 'point' | 'carry' | 'nod' | 'shake' | 'look' | 'fish' | 'listen';

export interface Pose {
  facing: Facing;
  flip: boolean; // de perfil: mira a la izquierda
  phase: number; // ciclo de paso (radianes)
  action: Action;
  t: number; // segundos (animaciones de reposo, parpadeo, gestos)
  expr: Expr;
  lod: 0 | 1 | 2;
  hood?: boolean; // capucha puesta (lluvia)
  heavy?: boolean; // abrigo de nieve
}

interface Face {
  open: number; // apertura de ojos
  browIn: [number, number]; // desplazamiento interior de cada ceja (+ abajo)
  browOut: [number, number];
  curve: number; // sonrisa (+) / ceño (−)
  asym: number; // media sonrisa
  mouthOpen: number;
  teeth: boolean;
}

const FACES: Record<Expr, Face> = {
  neutral: { open: 1, browIn: [0, 0], browOut: [0, 0], curve: 0.05, asym: 0, mouthOpen: 0, teeth: false },
  feliz: { open: 0.78, browIn: [-0.15, -0.15], browOut: [-0.1, -0.1], curve: 0.6, asym: 0, mouthOpen: 0.12, teeth: true },
  alivio: { open: 0.55, browIn: [-0.3, -0.3], browOut: [0.05, 0.05], curve: 0.38, asym: 0, mouthOpen: 0, teeth: false },
  preocupado: { open: 1.02, browIn: [-0.5, -0.5], browOut: [0.15, 0.15], curve: -0.22, asym: 0, mouthOpen: 0, teeth: false },
  triste: { open: 0.72, browIn: [-0.6, -0.6], browOut: [0.3, 0.3], curve: -0.5, asym: 0, mouthOpen: 0, teeth: false },
  enfadado: { open: 0.85, browIn: [0.55, 0.55], browOut: [-0.25, -0.25], curve: -0.32, asym: 0, mouthOpen: 0, teeth: false },
  hostil: { open: 0.72, browIn: [0.75, 0.75], browOut: [-0.3, -0.3], curve: -0.45, asym: 0, mouthOpen: 0.22, teeth: true },
  miedo: { open: 1.35, browIn: [-0.7, -0.7], browOut: [-0.35, -0.35], curve: -0.15, asym: 0, mouthOpen: 0.42, teeth: false },
  sorpresa: { open: 1.4, browIn: [-0.85, -0.85], browOut: [-0.75, -0.75], curve: 0, asym: 0, mouthOpen: 0.75, teeth: false },
  desconfianza: { open: 0.6, browIn: [0.45, -0.35], browOut: [-0.1, -0.45], curve: 0.05, asym: 0.35, mouthOpen: 0, teeth: false },
};

let G: CanvasRenderingContext2D;
const E = (x: number, y: number, rx: number, ry: number, c: string, rot = 0) => {
  G.fillStyle = c;
  G.beginPath();
  G.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
  G.fill();
};
const L = (x1: number, y1: number, x2: number, y2: number, w: number, c: string) => {
  G.strokeStyle = c;
  G.lineWidth = w;
  G.beginPath();
  G.moveTo(x1, y1);
  G.lineTo(x2, y2);
  G.stroke();
};
const L3 = (a: P2, b: P2, c: P2, w: number, col: string) => {
  G.strokeStyle = col;
  G.lineWidth = w;
  G.beginPath();
  G.moveTo(a.x, a.y);
  G.lineTo(b.x, b.y);
  G.lineTo(c.x, c.y);
  G.stroke();
};
interface P2 {
  x: number;
  y: number;
}

/** Dibuja una persona con los pies en (x, y). */
export function drawHuman(g: CanvasRenderingContext2D, ap: Appearance, pose: Pose, x: number, y: number, scale = 1): void {
  G = g;
  g.save();
  g.translate(x, y);
  const s = scale * ap.height;
  g.scale(pose.facing === 'side' && pose.flip ? -s : s, s);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  E(0, 0, 6.5 * ap.build, 2, 'rgba(0,0,0,0.26)');
  const moving = pose.action === 'walk' || pose.action === 'run';
  const amp = pose.action === 'run' ? 1.6 : moving ? 1 : 0;
  const bob = moving ? -Math.abs(Math.sin(pose.phase)) * (pose.action === 'run' ? 1.5 : 0.8) : Math.sin(pose.t * 1.6 + ap.seed) * 0.15;
  const sit = pose.action === 'sit';
  g.translate(0, bob + (sit ? 6.5 : 0));
  if (pose.facing === 'side') drawSide(ap, pose, amp, sit);
  else drawFrontBack(ap, pose, amp, sit, pose.facing === 'back');
  g.restore();
}

// ---------------------------------------------------------------------------
// Medidas del cuerpo
// ---------------------------------------------------------------------------
function body(ap: Appearance) {
  const b = ap.build;
  const st = ap.stoop;
  return {
    hipY: -22,
    waistY: -26.8,
    chestY: -32,
    shY: -36.4 + st * 1.4,
    neckY: -39 + st * 1.6,
    headY: -42.9 + st * 2,
    sh: (ap.fem ? 4.5 : 5.3) * b,
    waist: (ap.fem ? 3.1 : 3.7) * b,
    hip: (ap.fem ? 4.2 : 3.9) * b,
    rx: 2.95 * (0.95 + ap.jaw * 0.05),
    ry: 3.7 * ap.faceLen,
  };
}

function legsColor(ap: Appearance): string {
  return ap.outfit.bottom === 'falda' ? darken(ap.outfit.bottomColor, 0.75) : ap.outfit.bottomColor;
}

function shoe(ap: Appearance, x: number, y: number, dir = 0): void {
  const o = ap.outfit;
  if (o.shoes === 'descalzo') {
    E(x + dir * 0.6, y + 0.6, 1.5, 0.8, ap.skinShade);
    return;
  }
  const c = o.shoes === 'sandalias' ? '#8a6a44' : o.shoeColor;
  E(x + dir * 0.7, y + 0.7, 1.75, 1.05, c);
  if (o.shoes === 'botas' || o.shoes === 'botasPiel') L(x, y + 0.2, x, y - 3.2, 2.6, c);
  if (o.shoes === 'botasPiel') E(x, y - 3.3, 1.7, 0.8, '#d8cdb8');
  if (o.shoes === 'sandalias') L(x - 1, y - 0.6, x + 1, y - 0.6, 0.4, '#5a3a22');
}

// ---------------------------------------------------------------------------
// Vista de frente / espalda
// ---------------------------------------------------------------------------
function drawFrontBack(ap: Appearance, pose: Pose, amp: number, sit: boolean, back: boolean): void {
  const B = body(ap);
  const o = ap.outfit;
  const ph = pose.phase;
  const liftL = Math.max(0, Math.sin(ph)) * 2.4 * amp;
  const liftR = Math.max(0, -Math.sin(ph)) * 2.4 * amp;
  const cloakSway = Math.sin(ph) * 0.6 * amp;

  // Capa por detrás (de frente se ve asomar por los lados).
  if (o.cloak && !back) cloak(ap, B, cloakSway, false, pose);
  if (o.backpack && !back) {
    E(-B.sh - 0.4, B.chestY + 1, 1.3, 3.2, darken(o.backpack, 0.8));
    E(B.sh + 0.4, B.chestY + 1, 1.3, 3.2, darken(o.backpack, 0.8));
  }
  // Pelo largo detrás de la cabeza.
  if (!back) backHair(ap, B, pose);

  // Piernas.
  const hemY = B.hipY + o.hem * 21.5;
  const lc = legsColor(ap);
  const legs: [number, number][] = [[-1, liftL], [1, liftR]];
  for (const [side, lift] of legs) {
    const hx = side * 2.05 * ap.build;
    if (sit) {
      const knee = { x: hx * 1.2, y: -9.5 };
      L(hx, B.hipY, knee.x, knee.y, 3.4 * ap.build, lc);
      L(knee.x, knee.y, knee.x, -1.8, 3 * ap.build, lc);
      shoe(ap, knee.x, -1.6);
      continue;
    }
    const knee = { x: hx * 1.08, y: -11 - lift * 0.55 };
    const ankle = { x: hx * 1.15, y: -1.6 - lift };
    if (o.bottom !== 'falda' || o.hem < 0.95) {
      L3({ x: hx, y: B.hipY }, knee, ankle, 3.2 * ap.build, lc);
      if (ap.outfit.patches && pose.lod === 0) E(knee.x, knee.y, 0.9, 0.8, darken(lc, 1.25));
    }
    shoe(ap, ankle.x, ankle.y);
  }

  // Faldas, túnicas largas y abrigos.
  if (hemY > B.hipY + 1) {
    const flare = B.hip + 0.6 + o.hem * 2.6;
    G.fillStyle = o.top === 'tunicaLarga' || o.top === 'abrigo' ? o.topColor : o.bottomColor;
    G.beginPath();
    G.moveTo(-B.waist, B.waistY + 0.5);
    G.lineTo(B.waist, B.waistY + 0.5);
    G.lineTo(flare + cloakSway * 0.6, hemY);
    G.quadraticCurveTo(0, hemY + 1.1, -flare + cloakSway * 0.6, hemY);
    G.closePath();
    G.fill();
    if (pose.lod < 2) {
      G.strokeStyle = 'rgba(0,0,0,0.18)';
      G.lineWidth = 0.5;
      for (const fx of [-0.45, 0.1, 0.55]) {
        G.beginPath();
        G.moveTo(fx * B.waist, B.waistY + 3);
        G.lineTo(fx * flare * 1.1 + cloakSway * 0.4, hemY - 0.3);
        G.stroke();
      }
      L(-flare + cloakSway * 0.6, hemY - 0.2, flare + cloakSway * 0.6, hemY - 0.2, 0.7, o.trim);
      if (o.top === 'abrigo' && !back) L(0, B.waistY, 0, hemY, 0.45, darken(o.topColor, 0.7));
    }
  }

  // Torso.
  torso(ap, B, pose, back);

  // Brazos.
  arms(ap, B, pose, amp, back);

  // Capa por encima (de espalda cubre el cuerpo).
  if (o.cloak && back) cloak(ap, B, cloakSway, true, pose);
  if (o.backpack && back) {
    G.fillStyle = o.backpack;
    G.beginPath();
    G.roundRect(-3.2, B.shY + 1.5, 6.4, 8, 1.4);
    G.fill();
    L(-3.2, B.shY + 5, 3.2, B.shY + 5, 0.5, darken(o.backpack, 0.7));
  }
  if (o.item === 'arco' && back) bowOnBack(B);

  // Cabeza.
  // Cuello con trapecios: une la cabeza a los hombros sin parecer un palo.
  G.fillStyle = ap.skin;
  G.beginPath();
  G.moveTo(-1.05, B.neckY - 0.6);
  G.lineTo(1.05, B.neckY - 0.6);
  G.lineTo(1.25, B.shY - 0.6);
  G.quadraticCurveTo(2.6, B.shY - 0.5, 3.2, B.shY - 0.1);
  G.lineTo(-3.2, B.shY - 0.1);
  G.quadraticCurveTo(-2.6, B.shY - 0.5, -1.25, B.shY - 0.6);
  G.closePath();
  G.fill();
  if (!back) {
    G.fillStyle = 'rgba(0,0,0,0.12)';
    G.fillRect(-1.05, B.neckY - 0.6, 2.1, 0.9);
  }
  head(ap, B, pose, back);
}

function torso(ap: Appearance, B: ReturnType<typeof body>, pose: Pose, back: boolean): void {
  const o = ap.outfit;
  const top = o.top === 'tunicaLarga' ? o.topColor : o.topColor;
  // Silueta del torso con hombros redondeados.
  G.fillStyle = top;
  G.beginPath();
  G.moveTo(-B.sh, B.shY + 0.6);
  G.quadraticCurveTo(-B.sh + 0.2, B.shY - 0.9, -B.sh * 0.45, B.shY - 1);
  G.lineTo(B.sh * 0.45, B.shY - 1);
  G.quadraticCurveTo(B.sh - 0.2, B.shY - 0.9, B.sh, B.shY + 0.6);
  G.quadraticCurveTo(B.sh * 0.92, B.chestY + 1, B.waist + 0.2, B.waistY);
  G.lineTo(B.hip, B.hipY + 0.6);
  G.lineTo(-B.hip, B.hipY + 0.6);
  G.lineTo(-B.waist - 0.2, B.waistY);
  G.quadraticCurveTo(-B.sh * 0.92, B.chestY + 1, -B.sh, B.shY + 0.6);
  G.closePath();
  G.fill();
  G.save();
  G.clip();
  // Volumen: la luz viene de arriba a la izquierda.
  G.fillStyle = 'rgba(0,0,0,0.16)';
  G.fillRect(B.sh * 0.15, B.shY - 2, B.sh, 20);
  G.fillStyle = 'rgba(255,255,255,0.08)';
  G.fillRect(-B.sh, B.shY - 2, B.sh * 0.5, 20);
  if (pose.lod < 2) pattern(o, B);
  // Armadura: acolchado, cota de malla y sobrevesta con emblema.
  if (o.armor) {
    if (o.armor.mail) {
      G.fillStyle = '#9aa0a8';
      G.fillRect(-B.sh, B.shY - 1, B.sh * 2, 5.5);
      if (pose.lod === 0) {
        G.fillStyle = 'rgba(40,44,50,0.45)';
        for (let yy = B.shY - 0.5; yy < B.shY + 4.5; yy += 0.9) for (let xx = -B.sh; xx < B.sh; xx += 0.9) G.fillRect(xx + ((yy * 3) % 0.9), yy, 0.35, 0.35);
      }
    }
    if (!back) {
      G.fillStyle = o.armor.tabard;
      G.fillRect(-2.9, B.chestY - 2.5, 5.8, 14);
      G.fillStyle = o.armor.emblem;
      G.beginPath();
      G.moveTo(0, B.chestY - 0.5);
      G.lineTo(1.6, B.chestY + 1.5);
      G.lineTo(0, B.chestY + 3.8);
      G.lineTo(-1.6, B.chestY + 1.5);
      G.closePath();
      G.fill();
    }
  }
  G.restore();
  // Chaleco.
  if (o.vest) {
    G.fillStyle = o.vest;
    for (const sd of [-1, 1]) {
      G.beginPath();
      G.moveTo(sd * B.sh * 0.95, B.shY + 0.5);
      G.lineTo(sd * (back ? 0 : 1.1), B.shY - 0.6);
      G.lineTo(sd * (back ? 0 : 1.5), B.waistY + 0.8);
      G.lineTo(sd * (B.waist + 0.3), B.waistY + 0.8);
      G.closePath();
      G.fill();
    }
  }
  // Cuello y escote.
  if (!back && pose.lod < 2) {
    G.strokeStyle = o.trim;
    G.lineWidth = 0.55;
    G.beginPath();
    if (o.top === 'camisa' || o.top === 'tunica') {
      G.moveTo(-1.5, B.shY - 0.9);
      G.lineTo(0, B.shY + 1.5);
      G.lineTo(1.5, B.shY - 0.9);
    } else {
      G.moveTo(-1.8, B.shY - 0.8);
      G.quadraticCurveTo(0, B.shY + 0.9, 1.8, B.shY - 0.8);
    }
    G.stroke();
    if (o.top === 'jubon' || o.top === 'abrigo') for (let yy = B.shY + 2; yy < B.waistY; yy += 2.2) E(0, yy, 0.32, 0.32, o.trim);
  }
  // Pliegues.
  if (pose.lod === 0) {
    G.strokeStyle = 'rgba(0,0,0,0.16)';
    G.lineWidth = 0.4;
    G.beginPath();
    G.moveTo(-B.sh * 0.5, B.chestY + 1);
    G.quadraticCurveTo(-B.waist * 0.6, B.waistY - 1.5, -B.waist * 0.3, B.waistY - 0.4);
    G.moveTo(B.sh * 0.55, B.chestY + 0.5);
    G.quadraticCurveTo(B.waist * 0.7, B.waistY - 1.8, B.waist * 0.25, B.waistY - 0.4);
    G.stroke();
  }
  // Delantal.
  if (o.apron && !back) {
    G.fillStyle = o.apron;
    G.beginPath();
    G.moveTo(-2.6, B.chestY);
    G.lineTo(2.6, B.chestY);
    G.lineTo(3.2, B.hipY + 9);
    G.lineTo(-3.2, B.hipY + 9);
    G.closePath();
    G.fill();
    if (pose.lod < 2) L(-2.6, B.chestY, -B.sh * 0.6, B.shY - 0.6, 0.45, o.apron), L(2.6, B.chestY, B.sh * 0.6, B.shY - 0.6, 0.45, o.apron);
  }
  // Chal de los ancianos.
  if (o.shawl) {
    G.fillStyle = o.shawl;
    G.beginPath();
    G.moveTo(-B.sh - 0.4, B.shY + 0.4);
    G.quadraticCurveTo(0, B.shY - 2, B.sh + 0.4, B.shY + 0.4);
    G.lineTo(0, back ? B.waistY : B.chestY + 2.5);
    G.closePath();
    G.fill();
  }
  // Cinturón, fajín, bandolera y bolsa.
  L(-B.waist - 0.3, B.waistY, B.waist + 0.3, B.waistY, 1.3, o.belt);
  if (!back && pose.lod < 2) {
    G.fillStyle = '#c9b070';
    G.fillRect(-0.6, B.waistY - 0.6, 1.2, 1.2);
  }
  if (o.sash) {
    L(-B.waist - 0.3, B.waistY - 0.2, B.waist + 0.3, B.waistY - 0.2, 1.9, o.sash);
    if (!back) L(B.waist - 0.6, B.waistY, B.waist - 0.2, B.waistY + 4.5, 1.1, o.sash);
  }
  if (o.strap) L(-B.sh * 0.7, B.shY - 0.4, B.waist + 0.3, B.waistY - 0.4, 0.75, o.strap);
  if (o.pouch) {
    G.fillStyle = o.pouch;
    G.beginPath();
    G.roundRect(B.waist - 0.4, B.waistY + 0.2, 2.4, 2.8, 0.7);
    G.fill();
  }
  if (o.jewelry && !back && pose.lod < 2) {
    G.strokeStyle = o.jewelry;
    G.lineWidth = 0.4;
    G.beginPath();
    G.arc(0, B.shY - 1.4, 2.2, 0.35, Math.PI - 0.35);
    G.stroke();
    E(0, B.shY + 0.9, 0.45, 0.45, o.jewelry);
  }
}

function pattern(o: Appearance['outfit'], B: ReturnType<typeof body>): void {
  switch (o.pattern) {
    case 'rayas':
      G.fillStyle = darken(o.topColor, 0.62);
      for (let yy = B.shY + 0.5; yy < B.hipY + 1; yy += 1.8) G.fillRect(-B.sh, yy, B.sh * 2, 0.6);
      break;
    case 'cuadros':
      G.strokeStyle = 'rgba(0,0,0,0.2)';
      G.lineWidth = 0.35;
      G.beginPath();
      for (let xx = -B.sh; xx < B.sh; xx += 1.6) (G.moveTo(xx, B.shY - 1), G.lineTo(xx, B.hipY + 1));
      for (let yy = B.shY; yy < B.hipY + 1; yy += 1.6) (G.moveTo(-B.sh, yy), G.lineTo(B.sh, yy));
      G.stroke();
      break;
    case 'bordado':
      G.fillStyle = o.trim;
      for (let yy = B.shY + 1.4; yy < B.waistY - 0.6; yy += 1.4) {
        G.fillRect(-1.6, yy, 0.5, 0.5);
        G.fillRect(1.1, yy, 0.5, 0.5);
      }
      G.fillRect(-B.hip, B.hipY - 0.4, B.hip * 2, 0.8);
      break;
    case 'acolchado':
      G.strokeStyle = 'rgba(0,0,0,0.2)';
      G.lineWidth = 0.35;
      G.beginPath();
      for (let k = -12; k < 12; k += 2) (G.moveTo(k, B.shY), G.lineTo(k + 8, B.hipY), G.moveTo(k + 8, B.shY), G.lineTo(k, B.hipY));
      G.stroke();
      break;
    case 'hojas':
      G.fillStyle = darken(o.trim, 0.9);
      for (let xx = -B.hip + 0.5; xx < B.hip; xx += 1.6) E(xx, B.hipY - 0.6, 0.55, 0.3, o.trim, 0.6);
      break;
  }
}

function cloak(ap: Appearance, B: ReturnType<typeof body>, sway: number, over: boolean, pose: Pose): void {
  const c = ap.outfit.cloak!;
  const len = pose.heavy || c.fur ? -3.5 : -8;
  G.fillStyle = over ? c.color : darken(c.color, 0.82);
  G.beginPath();
  G.moveTo(-B.sh - 0.4, B.shY);
  G.quadraticCurveTo(0, B.shY - 1.6, B.sh + 0.4, B.shY);
  G.lineTo(B.sh + 2.4 + sway, len);
  G.quadraticCurveTo(0, len + 1.4, -B.sh - 2.4 + sway, len);
  G.closePath();
  G.fill();
  if (over && pose.lod < 2) {
    G.strokeStyle = 'rgba(0,0,0,0.2)';
    G.lineWidth = 0.5;
    G.beginPath();
    for (const fx of [-0.5, 0, 0.5]) (G.moveTo(fx * B.sh, B.shY + 2), G.lineTo(fx * (B.sh + 3) + sway, len + 0.4));
    G.stroke();
  }
  if (c.fur || pose.heavy) for (let k = -B.sh; k <= B.sh; k += 1.3) E(k, B.shY - 0.4 + Math.abs(k) * 0.08, 1.15, 0.9, '#d8cdb8');
  if (!over) E(0, B.shY - 0.2, 0.6, 0.6, c.clasp);
  if (over && c.hood && !pose.hood) {
    G.fillStyle = darken(c.color, 0.9);
    G.beginPath();
    G.ellipse(0, B.shY + 0.6, 3.4, 2.4, 0, 0, Math.PI);
    G.fill();
  }
}

function arms(ap: Appearance, B: ReturnType<typeof body>, pose: Pose, amp: number, back: boolean): void {
  const o = ap.outfit;
  const t = pose.t;
  const sw = Math.sin(pose.phase) * 1.3 * amp;
  const sleeve = o.armor?.mail ? '#9aa0a8' : o.top === 'tunicaLarga' || o.top === 'abrigo' ? o.topColor : o.topColor;
  const fore = o.sleeves === 'largas' ? sleeve : ap.skin;
  const hand = o.gloves ?? ap.skin;
  const W = 2.5 * ap.build;
  const shL = { x: -B.sh + 0.6, y: B.shY + 0.8 };
  const shR = { x: B.sh - 0.6, y: B.shY + 0.8 };
  // Posición de codos y manos según la acción.
  let eL = { x: -B.sh - 0.5, y: B.shY + 7.4 };
  let hL = { x: -B.sh - 0.2, y: B.shY + 13.6 + sw };
  let eR = { x: B.sh + 0.5, y: B.shY + 7.4 };
  let hR = { x: B.sh + 0.2, y: B.shY + 13.6 - sw };
  const breathe = Math.sin(t * 1.6) * 0.15;
  switch (pose.action) {
    case 'wave':
      eR = { x: B.sh + 2.6, y: B.shY - 1 };
      hR = { x: B.sh + 3.4 + Math.sin(t * 9) * 1.3, y: B.shY - 6.8 };
      break;
    case 'talk':
      eR = { x: B.sh + 1.4, y: B.shY + 6.2 };
      hR = { x: B.sh - 0.4 + Math.sin(t * 2.6) * 1.6, y: B.shY + 4.8 + Math.cos(t * 3.4) * 1.3 };
      if (Math.sin(t * 0.9) > 0.3) hL = { x: -B.sh + 0.6 + Math.sin(t * 2.1) * 1.2, y: B.shY + 6 };
      break;
    case 'point':
      eR = { x: B.sh + 4, y: B.shY + 1.6 };
      hR = { x: B.sh + 8, y: B.shY + 0.6 };
      break;
    case 'cross':
    case 'listen':
      eL = { x: -B.sh - 0.2, y: B.shY + 6 };
      eR = { x: B.sh + 0.2, y: B.shY + 6 };
      hL = { x: 2.2, y: B.chestY + 2.4 };
      hR = { x: -2.2, y: B.chestY + 2.8 };
      break;
    case 'work': {
      const k = Math.sin(t * 3.6);
      eL = { x: -B.sh + 0.2, y: B.shY + 6 };
      eR = { x: B.sh - 0.2, y: B.shY + 6 };
      hL = { x: -0.8, y: B.shY + 9 + k * 3 };
      hR = { x: 0.8, y: B.shY + 7 + k * 3 };
      break;
    }
    case 'hammer': {
      const k = (Math.sin(t * 5) + 1) / 2;
      eR = { x: B.sh + 2, y: B.shY + 3 - k * 3 };
      hR = { x: B.sh + 1.5, y: B.shY + 9 - k * 12 };
      break;
    }
    case 'carry':
      eL = { x: -B.sh - 0.6, y: B.shY + 2 };
      hL = { x: -B.sh + 0.6, y: B.shY - 2.4 };
      break;
    case 'sit':
      hL = { x: -2.6, y: -12.5 };
      hR = { x: 2.6, y: -12.5 };
      eL = { x: -B.sh, y: B.shY + 6 };
      eR = { x: B.sh, y: B.shY + 6 };
      break;
    case 'fish':
      eR = { x: B.sh + 1.4, y: B.shY + 5 };
      hR = { x: B.sh + 1, y: B.shY + 8 };
      break;
  }
  hL.y += breathe;
  hR.y += breathe;
  const drawArm = (s: P2, e: P2, h: P2) => {
    L(s.x, s.y, e.x, e.y, W, sleeve);
    L(e.x, e.y, h.x, h.y, W * 0.86, fore);
    if (o.sleeves !== 'largas' && pose.lod < 2) L(e.x, e.y, e.x + (s.x - e.x) * 0.1, e.y + (s.y - e.y) * 0.1, W * 0.95, darken(sleeve, 0.85));
    E(h.x, h.y + 0.3, 1.15, 1.2, hand);
  };
  drawArm(shL, eL, hL);
  if (!back || pose.action !== 'wave') drawArm(shR, eR, hR);
  if (back && pose.action === 'wave') drawArm(shR, eR, hR);
  item(ap, pose, hR, hL, B);
}

function item(ap: Appearance, pose: Pose, hR: P2, hL: P2, B: ReturnType<typeof body>): void {
  const it = ap.outfit.item;
  if (!it || pose.lod === 2) return;
  switch (it) {
    case 'lanza':
      L(hR.x, hR.y + 9, hR.x, hR.y - 25, 0.8, '#6b4a2a');
      G.fillStyle = '#c8ccd2';
      G.beginPath();
      G.moveTo(hR.x, hR.y - 29);
      G.lineTo(hR.x + 1, hR.y - 25);
      G.lineTo(hR.x - 1, hR.y - 25);
      G.fill();
      break;
    case 'azada':
      if (pose.action === 'work') {
        L(hL.x, hL.y, hL.x + 2, hL.y + 10, 0.8, '#7a5532');
        L(hL.x + 1.4, hL.y + 10, hL.x + 3.6, hL.y + 10.6, 1.2, '#8f959c');
      } else {
        L(hR.x, hR.y + 6, hR.x + 0.6, hR.y - 12, 0.8, '#7a5532');
        L(hR.x - 0.6, hR.y - 12, hR.x + 2.4, hR.y - 11, 1.2, '#8f959c');
      }
      break;
    case 'martillo':
      L(hR.x, hR.y, hR.x + 0.3, hR.y - 4.5, 0.7, '#6b4a2a');
      G.fillStyle = '#5a5f66';
      G.fillRect(hR.x - 1.3, hR.y - 5.6, 2.6, 1.6);
      break;
    case 'cayado':
    case 'baston':
      L(hR.x + 0.6, hR.y - (it === 'cayado' ? 9 : 2), hR.x + 1, -0.4, 0.75, '#7a5532');
      if (it === 'cayado') {
        G.strokeStyle = '#7a5532';
        G.lineWidth = 0.75;
        G.beginPath();
        G.arc(hR.x - 0.5, hR.y - 9, 1.1, 0, Math.PI, true);
        G.stroke();
      }
      break;
    case 'cesta':
      L(hL.x, hL.y, hL.x, hL.y + 1.6, 0.4, '#8a6a3a');
      G.fillStyle = '#a07a3e';
      G.beginPath();
      G.roundRect(hL.x - 2, hL.y + 1.4, 4, 2.8, 0.8);
      G.fill();
      G.fillStyle = 'rgba(0,0,0,0.2)';
      G.fillRect(hL.x - 2, hL.y + 2.4, 4, 0.4);
      break;
    case 'saco':
      if (pose.action === 'carry') E(hL.x - 0.5, hL.y - 1.5, 2.6, 2.2, '#c9b07a');
      else E(hR.x + 0.4, hR.y + 2.2, 2, 2.4, '#c9b07a');
      break;
    case 'farol':
      L(hL.x, hL.y, hL.x, hL.y + 1.5, 0.3, '#3a2a1a');
      G.fillStyle = '#f2c35a';
      G.fillRect(hL.x - 0.9, hL.y + 1.5, 1.8, 2.2);
      break;
    case 'libro':
      G.fillStyle = '#6a3a2a';
      G.fillRect(hR.x - 1.4, hR.y - 1.2, 2.8, 2);
      break;
    case 'red':
      G.strokeStyle = '#b8a888';
      G.lineWidth = 0.3;
      G.beginPath();
      for (let k = 0; k < 4; k++) (G.moveTo(hR.x - 1.5 + k, hR.y), G.lineTo(hR.x - 1 + k, hR.y + 4));
      G.stroke();
      break;
    case 'cana':
      L(hR.x, hR.y, hR.x + 9, hR.y - 9, 0.5, '#8a6a44');
      L(hR.x + 9, hR.y - 9, hR.x + 10, hR.y + 2, 0.15, 'rgba(240,240,240,0.7)');
      break;
    case 'arco':
      if (pose.facing !== 'back') bowOnBack(B, true);
      break;
  }
}

function bowOnBack(B: ReturnType<typeof body>, peek = false): void {
  G.strokeStyle = '#7a5532';
  G.lineWidth = 0.7;
  G.beginPath();
  if (peek) G.arc(B.sh + 1.4, B.chestY - 2, 6, -1.9, -1.2);
  else G.arc(0, B.chestY, 7.5, -2.3, -0.85);
  G.stroke();
}

// ---------------------------------------------------------------------------
// Cabeza y rostro (de frente / espalda)
// ---------------------------------------------------------------------------
function backHair(ap: Appearance, B: ReturnType<typeof body>, pose: Pose): void {
  const st = ap.hair.style;
  if (pose.hood) return;
  const c = darken(ap.hair.color, 0.85);
  if (st === 'coleta') E(B.rx * 0.2, B.headY + 2.6, 1.1, 2.4, c);
  if (st === 'trenza') L(B.rx * 0.6, B.headY + 1, B.rx + 0.6, B.headY + 7.5, 1.3, c);
  if (st === 'largo' || st === 'melena') {
    G.fillStyle = c;
    G.beginPath();
    G.moveTo(-B.rx - 0.4, B.headY - 1);
    G.quadraticCurveTo(-B.rx - 1, B.headY + (st === 'largo' ? 6 : 3.5), -B.rx + 0.3, B.headY + (st === 'largo' ? 8.5 : 5));
    G.lineTo(B.rx - 0.3, B.headY + (st === 'largo' ? 8.5 : 5));
    G.quadraticCurveTo(B.rx + 1, B.headY + (st === 'largo' ? 6 : 3.5), B.rx + 0.4, B.headY - 1);
    G.closePath();
    G.fill();
  }
}

function faceOf(pose: Pose): Face {
  const f = { ...FACES[pose.expr] };
  // Parpadeo.
  if ((pose.t * 0.27 + 0.13) % 1 < 0.035) f.open = 0.08;
  // Hablar.
  if (pose.action === 'talk') f.mouthOpen = Math.max(f.mouthOpen, Math.abs(Math.sin(pose.t * 11)) * 0.35);
  return f;
}

function head(ap: Appearance, B: ReturnType<typeof body>, pose: Pose, back: boolean): void {
  let hx = 0;
  let hy = B.headY;
  if (pose.action === 'nod') hy += Math.sin(pose.t * 7) * 0.45;
  if (pose.action === 'shake' || pose.action === 'look') hx += Math.sin(pose.t * (pose.action === 'shake' ? 8 : 1.3)) * 0.5;
  const rx = B.rx;
  const ry = B.ry;
  const skin = ap.skin;
  // Orejas.
  if (!pose.hood) {
    E(hx - rx + 0.05, hy + 0.3, 0.55 * ap.ears, 1, ap.skinShade);
    E(hx + rx - 0.05, hy + 0.3, 0.55 * ap.ears, 1, ap.skinShade);
  }
  // Cara con mandíbula.
  G.fillStyle = skin;
  G.beginPath();
  G.moveTo(hx - rx, hy - 0.4);
  G.bezierCurveTo(hx - rx, hy - ry * 1.3, hx + rx, hy - ry * 1.3, hx + rx, hy - 0.4);
  G.bezierCurveTo(hx + rx, hy + ry * 0.55, hx + rx * 0.45 * ap.jaw, hy + ry, hx, hy + ry);
  G.bezierCurveTo(hx - rx * 0.45 * ap.jaw, hy + ry, hx - rx, hy + ry * 0.55, hx - rx, hy - 0.4);
  G.closePath();
  G.fill();
  if (!back) {
    G.save();
    G.clip();
    G.fillStyle = 'rgba(0,0,0,0.1)';
    G.fillRect(hx + rx * 0.35, hy - ry * 1.5, rx, ry * 3);
    G.restore();
    if (pose.lod === 2) {
      E(hx - 1.2, hy - 0.1, 0.35, 0.35, '#2a2018');
      E(hx + 1.2, hy - 0.1, 0.35, 0.35, '#2a2018');
    } else features(ap, pose, hx, hy, rx, ry);
  }
  hair(ap, pose, hx, hy, rx, ry, back);
  hat(ap, pose, hx, hy, rx, ry, back);
}

function features(ap: Appearance, pose: Pose, hx: number, hy: number, rx: number, ry: number): void {
  const F = faceOf(pose);
  const detail = pose.lod === 0;
  const ey = hy - 0.15;
  const ex = 1.25 * ap.eye.spacing;
  const es = ap.eye.size;
  // Mejillas.
  if (detail && (ap.fem || ap.age < 14 || pose.expr === 'feliz')) {
    E(hx - ex - 0.3, hy + 1.4, 0.9, 0.55, 'rgba(220,110,100,0.18)');
    E(hx + ex + 0.3, hy + 1.4, 0.9, 0.55, 'rgba(220,110,100,0.18)');
  }
  // Ojos.
  for (const sd of [-1, 1]) {
    const x = hx + sd * ex;
    const open = F.open * (pose.expr === 'desconfianza' && sd > 0 ? 0.75 : 1);
    if (detail) {
      E(x, ey, 0.68 * es, Math.max(0.05, 0.46 * es * open), '#f4efe6');
      if (open > 0.2) {
        G.save();
        G.beginPath();
        G.ellipse(x, ey, 0.68 * es, Math.max(0.05, 0.46 * es * open), 0, 0, Math.PI * 2);
        G.clip();
        E(x + (pose.action === 'look' ? Math.sin(pose.t * 1.3) * 0.25 : 0), ey + 0.02, 0.36 * es, 0.36 * es, ap.eye.color);
        E(x, ey + 0.02, 0.19 * es, 0.19 * es, '#120c08');
        E(x - 0.12, ey - 0.12, 0.08, 0.08, 'rgba(255,255,255,0.9)');
        G.restore();
      }
      G.strokeStyle = '#3a2618';
      G.lineWidth = 0.22;
      G.beginPath();
      G.ellipse(x, ey, 0.76 * es, Math.max(0.05, 0.52 * es * open), 0, Math.PI * 1.05, Math.PI * 1.95);
      G.stroke();
      if (pose.expr === 'feliz' || pose.expr === 'alivio') {
        G.strokeStyle = ap.skinShade;
        G.beginPath();
        G.arc(x, ey + 0.7, 0.6, Math.PI * 1.15, Math.PI * 1.85);
        G.stroke();
      }
    } else E(x, ey, 0.38, 0.36 * Math.max(0.2, open), '#2a2018');
    // Cejas.
    const bi = F.browIn[sd < 0 ? 0 : 1];
    const bo = F.browOut[sd < 0 ? 0 : 1];
    L(x - sd * 0.55, ey - 1.05 + bi + ap.brow.tilt * sd * 0, x + sd * 0.95, ey - 1.18 + bo - ap.brow.tilt, 0.42 * ap.brow.thick, ap.brow.color);
  }
  // Nariz.
  if (detail) {
    G.strokeStyle = ap.skinShade;
    G.lineWidth = 0.32;
    G.beginPath();
    G.moveTo(hx + 0.12, ey + 0.2);
    G.quadraticCurveTo(hx + 0.45 + ap.nose * 0.12, ey + 1.2, hx + 0.1, ey + 1.45);
    G.stroke();
    E(hx, ey + 1.5, 0.45 + ap.nose * 0.18, 0.22, 'rgba(0,0,0,0.12)');
  } else E(hx, ey + 1.3, 0.3, 0.3, ap.skinShade);
  // Boca.
  const my = ey + 2.45;
  const mw = 0.95 * ap.mouthW * (pose.expr === 'feliz' ? 1.12 : 1);
  if (F.mouthOpen > 0.05) {
    E(hx, my + 0.1, mw * (0.5 + F.mouthOpen * 0.25), 0.25 + F.mouthOpen * 0.55, '#4a1e1a');
    if (F.teeth && detail) {
      G.fillStyle = '#f2ece0';
      G.fillRect(hx - mw * 0.45, my - 0.15, mw * 0.9, 0.28);
    }
  } else {
    G.strokeStyle = detail ? ap.lips : ap.skinShade;
    G.lineWidth = detail ? 0.34 : 0.4;
    G.beginPath();
    G.moveTo(hx - mw, my - F.curve * 0.5);
    G.quadraticCurveTo(hx, my + F.curve * 0.65, hx + mw, my - F.curve * 0.5 - F.asym);
    G.stroke();
  }
  if (!detail) return;
  // Pecas, arrugas.
  if (ap.freckles) for (const [fx, fy] of [[-1.6, 0.9], [-1.1, 1.2], [1.2, 1], [1.7, 0.8], [-0.4, 1.0]]) E(hx + fx, hy + fy, 0.1, 0.1, 'rgba(140,80,40,0.5)');
  if (ap.wrinkles > 0) {
    G.strokeStyle = `rgba(90,50,30,${0.25 * ap.wrinkles})`;
    G.lineWidth = 0.18;
    G.beginPath();
    G.moveTo(hx - 1.3, hy - ry * 0.62);
    G.quadraticCurveTo(hx, hy - ry * 0.7, hx + 1.3, hy - ry * 0.62);
    G.moveTo(hx - ex - 0.9, ey - 0.1);
    G.lineTo(hx - ex - 1.3, ey + 0.2);
    G.moveTo(hx + ex + 0.9, ey - 0.1);
    G.lineTo(hx + ex + 1.3, ey + 0.2);
    G.moveTo(hx - 0.8, my - 1.2);
    G.quadraticCurveTo(hx - mw - 0.4, my - 0.4, hx - mw - 0.2, my + 0.3);
    G.moveTo(hx + 0.8, my - 1.2);
    G.quadraticCurveTo(hx + mw + 0.4, my - 0.4, hx + mw + 0.2, my + 0.3);
    G.stroke();
  }
  if (pose.expr === 'triste' && ap.important) E(hx - ex, ey + 1, 0.15, 0.28, 'rgba(160,200,240,0.8)');
}

function hair(ap: Appearance, pose: Pose, hx: number, hy: number, rx: number, ry: number, back: boolean): void {
  if (pose.hood) return;
  const st = ap.hair.style;
  const c = ap.hair.color;
  const top = hy - ry * 0.95;
  // Barba (de frente).
  if (!back && ap.beard !== 'ninguna') beard(ap, hx, hy, rx, ry, pose);
  if (st === 'calvo') {
    if (back || true) {
      E(hx - rx + 0.3, hy - 0.2, 0.7, 1.4, c);
      E(hx + rx - 0.3, hy - 0.2, 0.7, 1.4, c);
    }
    return;
  }
  G.fillStyle = c;
  if (back) {
    G.beginPath();
    G.ellipse(hx, hy - 0.5, rx + 0.25, ry * 1.08, 0, 0, Math.PI * 2);
    G.fill();
    if (st === 'coleta' || st === 'trenza') L(hx, hy + 1, hx + 0.3, hy + (st === 'trenza' ? 7 : 4.5), 1.4, c);
    if (st === 'mono') E(hx, top - 0.6, 1.4, 1.1, c);
    if (st === 'largo' || st === 'melena') {
      G.beginPath();
      G.moveTo(hx - rx - 0.3, hy);
      G.lineTo(hx + rx + 0.3, hy);
      G.lineTo(hx + rx, hy + (st === 'largo' ? 8 : 5));
      G.lineTo(hx - rx, hy + (st === 'largo' ? 8 : 5));
      G.fill();
    }
    return;
  }
  // Casquete superior con raya o flequillo.
  const fringe = hy - ry * (st === 'rapado' ? 0.55 : 0.35);
  G.globalAlpha = st === 'rapado' ? 0.75 : 1;
  G.beginPath();
  G.moveTo(hx - rx - 0.15, hy + (st === 'corto' || st === 'rapado' || st === 'rizado' ? -0.6 : 0.6));
  G.bezierCurveTo(hx - rx - 0.3, top - ry * 0.5, hx + rx + 0.3, top - ry * 0.5, hx + rx + 0.15, hy + (st === 'corto' || st === 'rapado' || st === 'rizado' ? -0.6 : 0.6));
  G.quadraticCurveTo(hx + rx * 0.4, fringe - 0.2, hx + 0.4, fringe + 0.3);
  G.quadraticCurveTo(hx - rx * 0.5, fringe - 0.6, hx - rx - 0.15, hy - 0.2);
  G.closePath();
  G.fill();
  G.globalAlpha = 1;
  if (st === 'rizado') for (let a = Math.PI * 1.05; a < Math.PI * 1.95; a += 0.32) E(hx + Math.cos(a) * (rx + 0.2), hy - 0.8 + Math.sin(a) * (ry + 0.3), 0.9, 0.9, c);
  if (st === 'largo' || st === 'melena') {
    const len = st === 'largo' ? 6.5 : 3.6;
    G.beginPath();
    G.moveTo(hx - rx - 0.2, hy - 1);
    G.quadraticCurveTo(hx - rx - 0.9, hy + len * 0.6, hx - rx + 0.6, hy + len);
    G.lineTo(hx - rx + 0.9, hy + 0.5);
    G.closePath();
    G.moveTo(hx + rx + 0.2, hy - 1);
    G.quadraticCurveTo(hx + rx + 0.9, hy + len * 0.6, hx + rx - 0.6, hy + len);
    G.lineTo(hx + rx - 0.9, hy + 0.5);
    G.closePath();
    G.fill();
  }
  if (st === 'mono') E(hx, top - 0.7, 1.5, 1.2, c);
  if (pose.lod === 0) {
    // Mechones: algo de textura en el pelo.
    G.strokeStyle = 'rgba(255,255,255,0.14)';
    G.lineWidth = 0.25;
    G.beginPath();
    G.moveTo(hx - rx * 0.6, top + 0.4);
    G.quadraticCurveTo(hx - rx * 0.2, top - 0.4, hx + rx * 0.3, top + 0.2);
    G.stroke();
  }
}

function beard(ap: Appearance, hx: number, hy: number, rx: number, ry: number, pose: Pose): void {
  const c = ap.hair.color;
  const my = hy + 2.3;
  switch (ap.beard) {
    case 'sombra':
      G.fillStyle = 'rgba(40,30,20,0.18)';
      G.beginPath();
      G.moveTo(hx - rx + 0.3, hy + 0.6);
      G.bezierCurveTo(hx - rx + 0.3, hy + ry, hx + rx - 0.3, hy + ry, hx + rx - 0.3, hy + 0.6);
      G.lineTo(hx + 1.2, my - 0.5);
      G.lineTo(hx - 1.2, my - 0.5);
      G.closePath();
      G.fill();
      break;
    case 'corta':
    case 'larga': {
      const down = ap.beard === 'larga' ? 2.6 : 0.7;
      G.fillStyle = c;
      G.beginPath();
      G.moveTo(hx - rx + 0.1, hy + 0.2);
      G.bezierCurveTo(hx - rx, hy + ry + down, hx + rx, hy + ry + down, hx + rx - 0.1, hy + 0.2);
      G.lineTo(hx + 1.3, my - 0.3);
      G.quadraticCurveTo(hx, my + 0.9, hx - 1.3, my - 0.3);
      G.closePath();
      G.fill();
      L(hx - 1.1, my - 0.55, hx + 1.1, my - 0.55, 0.55, c);
      if (pose.lod === 0) E(hx, my + 0.1, 0.8, 0.28, darken(ap.skin, 0.7));
      break;
    }
    case 'bigote':
      L(hx - 1.2, my - 0.45, hx + 1.2, my - 0.45, 0.6, c);
      break;
    case 'perilla':
      L(hx - 1.1, my - 0.5, hx + 1.1, my - 0.5, 0.5, c);
      E(hx, my + 1, 0.7, 0.75, c);
      break;
  }
}

function hat(ap: Appearance, pose: Pose, hx: number, hy: number, rx: number, ry: number, back: boolean): void {
  const o = ap.outfit;
  const h = pose.hood && (o.cloak?.hood || pose.heavy || o.cloak) ? 'capucha' : o.hat;
  const top = hy - ry * 1.02;
  const c = h === 'capucha' ? (o.cloak?.color ?? o.hatColor) : o.hatColor;
  switch (h) {
    case 'paja':
      E(hx, top + 1.3, rx + 2.6, 1.2, '#cfae5a');
      G.fillStyle = '#c29e48';
      G.beginPath();
      G.ellipse(hx, top + 0.8, rx * 0.8, 1.8, 0, Math.PI, 0);
      G.fill();
      L(hx - rx * 0.8, top + 0.9, hx + rx * 0.8, top + 0.9, 0.5, '#8a4a2a');
      break;
    case 'gorro':
      G.fillStyle = c;
      G.beginPath();
      G.ellipse(hx, top + 1.3, rx + 0.4, 2.2, 0, Math.PI, 0);
      G.fill();
      L(hx - rx - 0.3, top + 1.3, hx + rx + 0.3, top + 1.3, 0.8, darken(c, 0.75));
      break;
    case 'boina':
      E(hx + 0.4, top + 0.8, rx + 0.9, 1.3, c);
      break;
    case 'piel':
      for (let k = -rx; k <= rx + 0.1; k += 1) E(hx + k, top + 1, 1.3, 1.6, '#cbbda4');
      E(hx, top - 0.4, rx * 0.85, 1.6, '#b0a088');
      break;
    case 'capucha':
      G.fillStyle = c;
      G.beginPath();
      G.moveTo(hx - rx - 1, hy + 3);
      G.quadraticCurveTo(hx - rx - 1.6, top - 1.5, hx, top - 1.6);
      G.quadraticCurveTo(hx + rx + 1.6, top - 1.5, hx + rx + 1, hy + 3);
      if (!back) {
        G.lineTo(hx + rx - 0.2, hy + 1);
        G.quadraticCurveTo(hx + rx, top + 0.2, hx, top + 0.2);
        G.quadraticCurveTo(hx - rx, top + 0.2, hx - rx + 0.2, hy + 1);
      }
      G.closePath();
      G.fill();
      break;
    case 'panuelo':
      G.fillStyle = c;
      G.beginPath();
      G.moveTo(hx - rx - 0.3, hy - 0.4);
      G.bezierCurveTo(hx - rx - 0.4, top - ry * 0.5, hx + rx + 0.4, top - ry * 0.5, hx + rx + 0.3, hy - 0.4);
      G.quadraticCurveTo(hx, top + 1.4, hx - rx - 0.3, hy - 0.4);
      G.fill();
      if (back || pose.lod === 0) E(hx + (back ? 0 : rx), hy - 0.2, 0.8, 0.6, darken(c, 0.85));
      break;
    case 'pluma':
      G.fillStyle = c;
      G.beginPath();
      G.ellipse(hx, top + 1.2, rx + 0.6, 1.9, 0, Math.PI, 0);
      G.fill();
      L(hx - rx - 0.6, top + 1.2, hx + rx + 0.6, top + 1.2, 0.6, o.trim);
      G.strokeStyle = '#e8dcc0';
      G.lineWidth = 0.6;
      G.beginPath();
      G.moveTo(hx + rx * 0.4, top + 0.4);
      G.quadraticCurveTo(hx + rx + 2, top - 2.8, hx + rx + 3.2, top - 1.6);
      G.stroke();
      break;
    case 'casco':
      G.fillStyle = '#8f959c';
      G.beginPath();
      G.ellipse(hx, top + 1.6, rx + 0.5, 2.8, 0, Math.PI, 0);
      G.fill();
      E(hx, top + 1.6, rx + 1.5, 0.7, '#7a8088');
      if (pose.lod === 0) E(hx - 0.8, top - 0.2, 0.6, 0.35, 'rgba(255,255,255,0.45)');
      if (!back && pose.lod === 0) L(hx, top + 1.6, hx, hy + 0.3, 0.45, '#7a8088');
      break;
    case 'corona':
      // Diadema: una banda fina de metal con una gema.
      G.strokeStyle = c;
      G.lineWidth = 0.55;
      G.beginPath();
      G.ellipse(hx, top + 1.4, rx + 0.15, 1, 0, Math.PI * 1.02, Math.PI * 1.98);
      G.stroke();
      if (!back) {
        G.fillStyle = c;
        G.beginPath();
        G.moveTo(hx - 0.6, top + 0.5);
        G.lineTo(hx, top - 0.5);
        G.lineTo(hx + 0.6, top + 0.5);
        G.fill();
        E(hx, top + 0.45, 0.32, 0.32, '#3a8a7a');
      }
      break;
    case 'turbante':
      G.fillStyle = c;
      G.beginPath();
      G.ellipse(hx, top + 0.9, rx + 0.7, 2.3, 0, Math.PI, 0);
      G.fill();
      G.strokeStyle = darken(c, 0.78);
      G.lineWidth = 0.35;
      G.beginPath();
      G.moveTo(hx - rx, top + 0.6);
      G.quadraticCurveTo(hx, top - 1.2, hx + rx, top + 0.2);
      G.stroke();
      break;
    case 'impermeable':
      G.fillStyle = '#d9b44a';
      G.beginPath();
      G.ellipse(hx, top + 1.3, rx + 0.3, 2.2, 0, Math.PI, 0);
      G.fill();
      E(hx, top + 1.5, rx + 1.7, 0.9, '#c9a03a');
      break;
  }
}

// ---------------------------------------------------------------------------
// Vista de perfil
// ---------------------------------------------------------------------------
function drawSide(ap: Appearance, pose: Pose, amp: number, sit: boolean): void {
  const B = body(ap);
  const o = ap.outfit;
  const ph = pose.phase;
  const run = pose.action === 'run';
  const swing = Math.sin(ph) * (run ? 0.36 : 0.42) * amp;
  const lean = run ? 0.14 : ap.stoop * 0.12;
  G.save();
  G.rotate(lean);
  const lc = legsColor(ap);
  const hemY = B.hipY + o.hem * 21.5;
  const leg = (a: number, dark: boolean) => {
    const bend = (0.15 + Math.max(0, Math.sin(a * 3 + 1)) * 0.25 + (run ? 0.35 : 0)) * (amp ? 1 : 0.3);
    const hip = { x: 0, y: B.hipY };
    let knee = { x: Math.sin(a) * 10.4, y: B.hipY + Math.cos(a) * 10.4 };
    let ankle = { x: knee.x + Math.sin(a - bend) * 10.2, y: knee.y + Math.cos(a - bend) * 10.2 };
    if (sit) {
      knee = { x: 9, y: -8.5 };
      ankle = { x: 9.6, y: -1.4 };
    }
    const col = dark ? darken(lc, 0.8) : lc;
    if (o.bottom !== 'falda' || o.hem < 0.95) L3(hip, knee, ankle, 3.1 * ap.build, col);
    shoe(ap, ankle.x, ankle.y, 1);
  };
  // Brazo y pierna del fondo.
  if (o.cloak) {
    G.fillStyle = darken(o.cloak.color, 0.85);
    G.beginPath();
    G.moveTo(-0.6, B.shY - 0.6);
    G.lineTo(-3.4 - Math.sin(ph) * amp * 0.9 - (run ? 2.5 : 0), pose.heavy || o.cloak.fur ? -4 : -8);
    G.lineTo(1.4, pose.heavy || o.cloak.fur ? -4 : -8);
    G.lineTo(2, B.shY);
    G.closePath();
    G.fill();
  }
  const arm = (a: number, dark: boolean) => {
    const sh = { x: 0.2, y: B.shY + 0.9 };
    let el = { x: sh.x + Math.sin(a) * 6.6, y: sh.y + Math.cos(a) * 6.6 };
    let ha = { x: el.x + Math.sin(a + 0.45 + (run ? 0.8 : 0)) * 6.2, y: el.y + Math.cos(a + 0.45 + (run ? 0.8 : 0)) * 6.2 };
    if (pose.action === 'talk' || pose.action === 'point') {
      el = { x: sh.x + 2.4, y: sh.y + 5.4 };
      ha = { x: el.x + 4 + Math.sin(pose.t * 2.6) * 1.2, y: el.y - 1.2 + Math.cos(pose.t * 3) * 1.2 };
      if (pose.action === 'point') ha = { x: sh.x + 11, y: sh.y - 0.6 };
    }
    if (pose.action === 'wave' && !dark) {
      el = { x: sh.x + 2.2, y: sh.y - 3 };
      ha = { x: sh.x + 3.4 + Math.sin(pose.t * 9) * 0.9, y: sh.y - 8.4 };
    }
    if (pose.action === 'work') {
      const k = Math.sin(pose.t * 3.6);
      el = { x: sh.x + 3, y: sh.y + 5 };
      ha = { x: sh.x + 6, y: sh.y + 7 + k * 3 };
    }
    if (pose.action === 'hammer' && !dark) {
      const k = (Math.sin(pose.t * 5) + 1) / 2;
      el = { x: sh.x + 3, y: sh.y + 3 - k * 4 };
      ha = { x: sh.x + 6, y: sh.y + 8 - k * 12 };
    }
    if (sit) {
      el = { x: sh.x + 2.6, y: sh.y + 5.5 };
      ha = { x: sh.x + 7.6, y: -11 };
    }
    const sleeve = o.armor?.mail ? '#9aa0a8' : o.topColor;
    const col = dark ? darken(sleeve, 0.78) : sleeve;
    L(sh.x, sh.y, el.x, el.y, 2.5 * ap.build, col);
    L(el.x, el.y, ha.x, ha.y, 2.15 * ap.build, o.sleeves === 'largas' ? col : dark ? ap.skinShade : ap.skin);
    E(ha.x, ha.y + 0.2, 1.1, 1.15, o.gloves ?? (dark ? ap.skinShade : ap.skin));
    return ha;
  };
  arm(-swing, true);
  leg(-swing, true);
  // Torso de perfil.
  const d = 2.9 * ap.build;
  if (hemY > B.hipY + 1) {
    G.fillStyle = o.top === 'tunicaLarga' || o.top === 'abrigo' ? o.topColor : o.bottomColor;
    G.beginPath();
    G.moveTo(-d + 0.4, B.waistY);
    G.lineTo(d - 0.2, B.waistY);
    G.lineTo(d + 1.4 + swing * 2, hemY);
    G.lineTo(-d - 1.2 + swing, hemY);
    G.closePath();
    G.fill();
  }
  G.fillStyle = o.topColor;
  G.beginPath();
  G.moveTo(-d * 0.8, B.shY - 0.6);
  G.quadraticCurveTo(d * 0.6, B.shY - 1.5, d * (ap.fem ? 1.08 : 0.95), B.chestY);
  G.lineTo(d * 0.75, B.waistY);
  G.lineTo(d * 0.85, B.hipY + 0.6);
  G.lineTo(-d * 0.9, B.hipY + 0.6);
  G.lineTo(-d * 0.75, B.waistY);
  G.quadraticCurveTo(-d * 1.05, B.chestY, -d * 0.8, B.shY - 0.6);
  G.closePath();
  G.fill();
  G.fillStyle = 'rgba(0,0,0,0.14)';
  G.fillRect(-d, B.chestY + 1, d * 0.8, 10);
  if (o.armor) {
    G.fillStyle = o.armor.tabard;
    G.fillRect(-0.5, B.chestY - 2, d * 0.75 + 0.5, 13);
  }
  if (o.apron) {
    G.fillStyle = o.apron;
    G.fillRect(d * 0.35, B.chestY, d * 0.65, 18);
  }
  L(-d * 0.8, B.waistY, d * 0.8, B.waistY, 1.3, o.belt);
  if (o.sash) L(-d * 0.8, B.waistY - 0.2, d * 0.8, B.waistY - 0.2, 1.8, o.sash);
  if (o.pouch) E(-d * 0.3, B.waistY + 1.6, 1.3, 1.5, o.pouch);
  if (o.backpack) {
    G.fillStyle = o.backpack;
    G.beginPath();
    G.roundRect(-d - 2.6, B.shY + 1, 2.8, 7.5, 1);
    G.fill();
  }
  if (o.item === 'arco') {
    G.strokeStyle = '#7a5532';
    G.lineWidth = 0.7;
    G.beginPath();
    G.arc(-d - 1, B.chestY, 6.5, -1.9, 1.9);
    G.stroke();
  }
  // Pierna y brazo del frente.
  leg(swing, false);
  G.fillStyle = ap.skin;
  G.fillRect(-0.7 + ap.stoop * 0.8, B.neckY - 0.4, 2, 3.2);
  sideHead(ap, pose, B);
  const hand = arm(swing, false);
  sideItem(ap, pose, hand);
  G.restore();
}

function sideItem(ap: Appearance, pose: Pose, h: P2): void {
  const it = ap.outfit.item;
  if (!it || pose.lod === 2) return;
  if (it === 'lanza') {
    L(h.x, h.y + 9, h.x + 0.6, h.y - 25, 0.8, '#6b4a2a');
    G.fillStyle = '#c8ccd2';
    G.beginPath();
    G.moveTo(h.x + 0.7, h.y - 29);
    G.lineTo(h.x + 1.6, h.y - 25);
    G.lineTo(h.x - 0.3, h.y - 25);
    G.fill();
  } else if (it === 'cayado' || it === 'baston') L(h.x, h.y - (it === 'cayado' ? 8 : 1), h.x + 1.2, -0.4, 0.75, '#7a5532');
  else if (it === 'azada') {
    L(h.x - 2, h.y - 5, h.x + 3, h.y + 7, 0.8, '#7a5532');
    L(h.x + 2.4, h.y + 7, h.x + 4.6, h.y + 6.6, 1.2, '#8f959c');
  } else if (it === 'martillo') {
    L(h.x, h.y, h.x + 0.6, h.y - 4.6, 0.7, '#6b4a2a');
    G.fillStyle = '#5a5f66';
    G.fillRect(h.x - 0.8, h.y - 5.8, 2.6, 1.6);
  } else if (it === 'cesta') {
    G.fillStyle = '#a07a3e';
    G.beginPath();
    G.roundRect(h.x - 1.8, h.y + 1, 3.6, 2.8, 0.8);
    G.fill();
  } else if (it === 'saco') E(h.x, h.y + 2, 2, 2.3, '#c9b07a');
  else if (it === 'farol') {
    G.fillStyle = '#f2c35a';
    G.fillRect(h.x - 0.9, h.y + 1.4, 1.8, 2.2);
  } else if (it === 'cana') L(h.x, h.y, h.x + 10, h.y - 8, 0.5, '#8a6a44');
}

function sideHead(ap: Appearance, pose: Pose, B: ReturnType<typeof body>): void {
  const F = faceOf(pose);
  const hx = 0.4 + ap.stoop * 1.4 + (pose.action === 'nod' ? Math.sin(pose.t * 7) * 0.25 : 0);
  const hy = B.headY + (pose.action === 'nod' ? Math.sin(pose.t * 7) * 0.4 : 0);
  const rx = 2.85;
  const ry = B.ry;
  const o = ap.outfit;
  // Pelo largo por detrás.
  if (!pose.hood && (ap.hair.style === 'largo' || ap.hair.style === 'melena' || ap.hair.style === 'trenza' || ap.hair.style === 'coleta')) {
    const len = ap.hair.style === 'largo' ? 7 : ap.hair.style === 'melena' ? 4 : 0;
    G.fillStyle = darken(ap.hair.color, 0.88);
    G.beginPath();
    G.moveTo(hx - rx * 0.2, hy - ry);
    G.quadraticCurveTo(hx - rx - 1.5, hy, hx - rx - 0.4, hy + len);
    G.lineTo(hx - 0.5, hy + len * 0.6);
    G.closePath();
    G.fill();
    if (ap.hair.style === 'coleta' || ap.hair.style === 'trenza') L(hx - rx, hy - 0.5, hx - rx - 1.6, hy + (ap.hair.style === 'trenza' ? 6 : 3.4), 1.3, ap.hair.color);
  }
  // Silueta del rostro con nariz.
  G.fillStyle = ap.skin;
  G.beginPath();
  G.moveTo(hx - rx, hy);
  G.bezierCurveTo(hx - rx, hy - ry * 1.3, hx + rx * 0.9, hy - ry * 1.3, hx + rx, hy - 0.8);
  G.lineTo(hx + rx + 0.55 + ap.nose * 0.2, hy + 0.9);
  G.lineTo(hx + rx - 0.1, hy + 1.4);
  G.quadraticCurveTo(hx + rx + 0.05, hy + 2.5, hx + rx - 0.4, hy + 2.9);
  G.quadraticCurveTo(hx + rx * 0.4, hy + ry * 1.02, hx - 0.4, hy + ry * 0.85);
  G.quadraticCurveTo(hx - rx, hy + ry * 0.6, hx - rx, hy);
  G.closePath();
  G.fill();
  if (!pose.hood) E(hx - 0.5, hy + 0.3, 0.7 * ap.ears, 1.05, ap.skinShade);
  if (pose.lod < 2) {
    const ey = hy - 0.15;
    const ex = hx + rx - 1.25;
    if (pose.lod === 0) {
      E(ex, ey, 0.42 * ap.eye.size, Math.max(0.05, 0.42 * ap.eye.size * F.open), '#f6f2ea');
      if (F.open > 0.2) E(ex + 0.14, ey + 0.03, 0.26 * ap.eye.size, 0.3 * ap.eye.size, ap.eye.color);
      L(ex - 0.45, ey - 0.4 * F.open, ex + 0.45, ey - 0.45 * F.open, 0.2, '#3a2618');
    } else E(ex, ey, 0.32, 0.32, '#2a2018');
    L(ex - 0.7, ey - 1.1 + F.browIn[1] * 0.6, ex + 0.65, ey - 1.15 + F.browOut[1] * 0.4 - F.browIn[1] * 0.3, 0.42 * ap.brow.thick, ap.brow.color);
    const my = hy + 2.2;
    if (F.mouthOpen > 0.05) E(hx + rx - 0.45, my, 0.45, 0.2 + F.mouthOpen * 0.45, '#4a1e1a');
    else L(hx + rx - 1.2, my + F.curve * -0.25, hx + rx - 0.25, my - F.curve * 0.4, 0.32, ap.lips);
  }
  // Barba de perfil.
  if (ap.beard === 'corta' || ap.beard === 'larga' || ap.beard === 'perilla') {
    G.fillStyle = ap.hair.color;
    G.beginPath();
    G.moveTo(hx - 0.6, hy + 0.6);
    G.quadraticCurveTo(hx + rx * 0.6, hy + ry + (ap.beard === 'larga' ? 2.6 : 0.8), hx + rx - 0.2, hy + 2.6);
    G.lineTo(hx + rx - 0.4, hy + 1.9);
    G.lineTo(hx + 0.6, hy + 1.8);
    G.closePath();
    G.fill();
  } else if (ap.beard === 'bigote') L(hx + rx - 1.3, hy + 1.9, hx + rx - 0.2, hy + 1.85, 0.55, ap.hair.color);
  // Pelo y sombrero.
  if (!pose.hood && ap.hair.style !== 'calvo') {
    G.fillStyle = ap.hair.color;
    G.beginPath();
    G.moveTo(hx - rx - 0.25, hy + 0.6);
    G.bezierCurveTo(hx - rx - 0.5, hy - ry * 1.45, hx + rx + 0.4, hy - ry * 1.4, hx + rx + 0.2, hy - ry * 0.4);
    G.quadraticCurveTo(hx + rx * 0.3, hy - ry * 0.6, hx - 0.2, hy - 0.4);
    G.quadraticCurveTo(hx - 0.9, hy + 0.2, hx - rx - 0.25, hy + 0.6);
    G.fill();
    if (ap.hair.style === 'mono') E(hx - rx * 0.5, hy - ry * 1.1, 1.3, 1.1, ap.hair.color);
  }
  hat(ap, { ...pose, facing: 'side' }, hx, hy, rx, ry, false);
  if (pose.hood && o.cloak) {
    G.fillStyle = o.cloak.color;
    G.beginPath();
    G.moveTo(hx + rx * 0.6, hy + 2.5);
    G.quadraticCurveTo(hx + rx + 0.4, hy - ry * 1.4, hx - 0.5, hy - ry * 1.35);
    G.quadraticCurveTo(hx - rx - 2, hy - ry, hx - rx - 1.4, hy + 3);
    G.closePath();
    G.fill();
  }
}

// ---------------------------------------------------------------------------
// Retrato para conversaciones: el rostro en primer plano con su expresión.
// ---------------------------------------------------------------------------
export function drawPortrait(canvas: HTMLCanvasElement, ap: Appearance, expr: Expr, t = 0, bg = '#d9c8a4'): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  g.save();
  g.clearRect(0, 0, W, H);
  const grad = g.createRadialGradient(W / 2, H * 0.4, W * 0.1, W / 2, H * 0.5, W * 0.75);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, darken(bg.startsWith('#') ? bg : '#d9c8a4', 0.72));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Busto: encuadre de cabeza y hombros.
  const scale = H / 18;
  drawHuman(g, { ...ap, height: 1, stoop: ap.stoop * 0.5 }, { facing: 'front', flip: false, phase: 0, action: 'idle', t, expr, lod: 0 }, W / 2, H * 0.4 + 43.4 * scale, scale);
  g.restore();
}
