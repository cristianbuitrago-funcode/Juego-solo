import type { Body } from './body';
import type { Pose } from './types';

/**
 * Del estado de una persona a los ángulos de su esqueleto. Los ángulos se
 * miden desde la vertical hacia abajo; positivo = hacia delante (hacia
 * donde mira, en perfil) o hacia fuera (de frente). Todo es continuo: no
 * hay fotogramas, así que caminar, trabajar o gesticular se ve fluido.
 */
export interface Limb {
  a: number; // ángulo del segmento superior (muslo / brazo)
  b: number; // ángulo relativo del inferior (pierna / antebrazo)
  lift: number; // de frente: cuánto se levanta (escorzo), 0..1
  fist?: boolean;
}

export interface Rig {
  y: number; // desplazamiento vertical del cuerpo (negativo = sube)
  x: number; // vaivén lateral
  lean: number; // inclinación del torso (rad, + adelante)
  breath: number; // escala vertical del torso
  shrug: number; // hombros arriba (+) o caídos (-)
  legs: [Limb, Limb]; // [lejana/izquierda, cercana/derecha]
  arms: [Limb, Limb];
  head: { tilt: number; nod: number; dx: number; dy: number };
  sitting: number; // 0..1
  lying: boolean;
  blink: boolean;
  mouthOpen: boolean;
  item: number; // giro extra del objeto en la mano
  skirt: number; // vaivén de faldas y capas
  cape: number; // la capa se va hacia atrás con la velocidad
}

const S = Math.sin;
const C = Math.cos;
const pos = (v: number) => Math.max(0, v);

/** Parpadeo natural: cada pocos segundos, distinto para cada persona. */
function blinkAt(t: number, seed: number): boolean {
  const period = 3.1 + (seed % 7) * 0.37;
  const ph = (t + (seed % 13) * 0.71) % period;
  return ph < 0.13 || (seed % 5 === 0 && ph > 0.32 && ph < 0.42);
}

export function rigOf(pose: Pose, B: Body, seed: number): Rig {
  const t = pose.t;
  const side = pose.facing === 'side';
  const r: Rig = {
    y: 0,
    x: 0,
    lean: 0,
    breath: 1 + S(t * 1.9 + seed) * 0.012,
    shrug: 0,
    legs: [{ a: 0, b: 0, lift: 0 }, { a: 0, b: 0, lift: 0 }],
    arms: [{ a: 0.06, b: 0.12, lift: 0 }, { a: 0.06, b: 0.12, lift: 0 }],
    head: { tilt: 0, nod: 0, dx: 0, dy: 0 },
    sitting: 0,
    lying: false,
    blink: blinkAt(t, seed),
    mouthOpen: false,
    item: 0,
    skirt: 0,
    cape: 0,
  };
  // Reposo vivo: el peso pasa de un pie a otro, los brazos cuelgan relajados.
  const idleSway = S(t * 0.55 + seed * 0.3);
  r.x = idleSway * 0.18;
  r.arms[0].a = 0.07 + S(t * 0.9 + seed) * 0.02;
  r.arms[1].a = 0.07 - S(t * 0.9 + seed) * 0.02;
  const p = pose.phase;
  switch (pose.action) {
    case 'walk':
    case 'patrol': {
      const k = pose.action === 'patrol' ? 0.7 : 1;
      r.x = 0;
      r.y = (1 - Math.abs(C(p))) * 0.55 - 0.15;
      if (side) {
        r.legs[0] = { a: 0.42 * k * S(p), b: -(0.15 + 0.85 * pos(C(p))) * k, lift: 0 };
        r.legs[1] = { a: -0.42 * k * S(p), b: -(0.15 + 0.85 * pos(-C(p))) * k, lift: 0 };
        r.arms[0] = { a: -0.38 * k * S(p), b: 0.25 + 0.2 * pos(-S(p)), lift: 0 };
        r.arms[1] = { a: 0.38 * k * S(p), b: 0.25 + 0.2 * pos(S(p)), lift: 0 };
        r.lean = 0.04;
      } else {
        r.legs[0] = { a: 0, b: 0, lift: pos(S(p)) };
        r.legs[1] = { a: 0, b: 0, lift: pos(-S(p)) };
        r.arms[0] = { a: 0.08, b: 0.2, lift: pos(-S(p)) * 0.8 };
        r.arms[1] = { a: 0.08, b: 0.2, lift: pos(S(p)) * 0.8 };
        r.x = S(p) * 0.25;
      }
      r.head.nod = S(p * 2) * 0.02;
      r.skirt = S(p) * 0.12;
      r.cape = 0.25;
      if (pose.action === 'patrol') r.arms[1] = { a: 0.15, b: 0.9, lift: 0, fist: true };
      break;
    }
    case 'run': {
      r.y = (1 - Math.abs(C(p))) * 1.2 - 0.9;
      if (side) {
        r.legs[0] = { a: 0.78 * S(p), b: -(0.25 + 1.45 * pos(C(p))), lift: 0 };
        r.legs[1] = { a: -0.78 * S(p), b: -(0.25 + 1.45 * pos(-C(p))), lift: 0 };
        r.arms[0] = { a: -0.85 * S(p), b: 1.35, lift: 0, fist: true };
        r.arms[1] = { a: 0.85 * S(p), b: 1.35, lift: 0, fist: true };
        r.lean = 0.2;
      } else {
        r.legs[0] = { a: 0, b: 0, lift: pos(S(p)) * 1.4 };
        r.legs[1] = { a: 0, b: 0, lift: pos(-S(p)) * 1.4 };
        r.arms[0] = { a: 0.16, b: 1.1, lift: pos(-S(p)), fist: true };
        r.arms[1] = { a: 0.16, b: 1.1, lift: pos(S(p)), fist: true };
        r.x = S(p) * 0.4;
      }
      r.head.nod = 0.06;
      r.skirt = S(p) * 0.22;
      r.cape = 0.7;
      break;
    }
    case 'work': {
      // Azada o siembra: el cuerpo se dobla, los brazos suben y bajan con ritmo.
      const c = (t * 0.9 + seed * 0.1) % 1;
      const swing = c < 0.55 ? c / 0.55 : 1 - (c - 0.55) / 0.45;
      const e = swing * swing * (3 - 2 * swing);
      r.lean = 0.18 + (1 - e) * 0.22;
      r.y = (1 - e) * 0.6;
      r.legs[0] = { a: -0.18, b: 0.1, lift: 0 };
      r.legs[1] = { a: 0.22, b: -0.25, lift: 0 };
      r.arms[0] = { a: 0.4 + e * 1.9, b: 0.3, lift: 0.3 };
      r.arms[1] = { a: 0.55 + e * 1.8, b: 0.2, lift: 0.3 };
      r.item = -0.4 + e * 0.5;
      r.head.nod = 0.1;
      break;
    }
    case 'hammer': {
      const c = (t * 1.6 + seed * 0.1) % 1;
      const up = c < 0.6 ? c / 0.6 : 1 - (c - 0.6) / 0.4;
      r.lean = 0.12;
      r.arms[1] = { a: 0.6 + up * 2.0, b: 0.4 + up * 0.5, lift: 0.4, fist: true };
      r.arms[0] = { a: 0.55, b: 0.9, lift: 0.3 };
      r.legs[0] = { a: -0.12, b: 0.05, lift: 0 };
      r.legs[1] = { a: 0.14, b: -0.1, lift: 0 };
      r.head.nod = 0.12;
      r.item = 0.2 - up * 0.3;
      break;
    }
    case 'fish': {
      r.arms[0] = { a: 1.0, b: 0.3, lift: 0.5, fist: true };
      r.arms[1] = { a: 1.15, b: 0.2, lift: 0.5, fist: true };
      r.item = S(t * 0.8) * 0.06;
      r.head.nod = 0.05;
      break;
    }
    case 'sit':
    case 'rest': {
      r.sitting = 1;
      r.y = B.thigh * 0.85;
      r.legs[0] = { a: 1.45, b: -1.45, lift: 0.6 };
      r.legs[1] = { a: 1.5, b: -1.5, lift: 0.6 };
      r.arms[0] = { a: 0.35, b: 0.6, lift: 0.2 };
      r.arms[1] = { a: 0.3, b: 0.65, lift: 0.2 };
      r.lean = pose.action === 'rest' ? -0.08 : 0.02;
      r.breath = 1 + S(t * 1.3 + seed) * 0.015;
      break;
    }
    case 'sleep': {
      r.sitting = 1;
      r.y = B.thigh * 0.85;
      r.legs[0] = { a: 1.45, b: -1.45, lift: 0.6 };
      r.legs[1] = { a: 1.5, b: -1.5, lift: 0.6 };
      r.arms[0] = { a: 0.4, b: 0.9, lift: 0.3 };
      r.arms[1] = { a: 0.4, b: 0.9, lift: 0.3 };
      r.lean = 0.12;
      r.head = { tilt: 0.25, nod: 0.35, dx: 0, dy: 0.3 };
      r.blink = true;
      r.breath = 1 + S(t * 0.9 + seed) * 0.025;
      break;
    }
    case 'talk':
    case 'argue': {
      // Habla con las manos: una gesticula, la otra acompaña.
      const angry = pose.action === 'argue';
      const g1 = S(t * (angry ? 3.6 : 2.3) + seed);
      const g2 = S(t * (angry ? 2.9 : 1.7) + seed * 2);
      r.arms[1] = { a: 0.55 + g1 * (angry ? 0.45 : 0.3), b: 0.9 + g2 * 0.3, lift: 0.4, fist: angry && g1 > 0.3 };
      r.arms[0] = { a: angry ? 0.5 + g2 * 0.3 : 0.12 + pos(g2) * 0.3, b: angry ? 0.8 : 0.3 + pos(g2) * 0.5, lift: 0.2 };
      r.mouthOpen = S(t * 9 + seed) > -0.1;
      r.head.nod = S(t * 2.1) * 0.05;
      r.head.tilt = S(t * 0.8 + seed) * 0.05;
      r.lean = angry ? 0.1 : 0.02;
      break;
    }
    case 'listen': {
      r.arms[0] = { a: 0.25, b: 1.1, lift: 0.2 };
      r.arms[1] = { a: 0.28, b: 1.15, lift: 0.2 };
      r.head.tilt = 0.09 + S(t * 0.7) * 0.03;
      r.head.nod = pos(S(t * 1.4 + seed)) > 0.92 ? 0.06 : 0;
      break;
    }
    case 'nod':
      r.head.nod = pos(S(t * 6)) * 0.16;
      break;
    case 'shake':
      r.head.dx = S(t * 9) * 0.35;
      r.head.tilt = S(t * 9) * 0.06;
      break;
    case 'look':
      r.head.dx = S(t * 0.9 + seed) * 0.4;
      r.head.tilt = S(t * 0.9 + seed) * 0.04;
      break;
    case 'wave': {
      const w = S(t * 9);
      r.arms[1] = { a: 2.55 + w * 0.12, b: 0.45 + w * 0.35, lift: 0.1 };
      r.head.tilt = -0.06;
      r.mouthOpen = true;
      break;
    }
    case 'cross':
      r.arms[0] = { a: 0.42, b: 1.95, lift: 0.4, fist: true };
      r.arms[1] = { a: 0.42, b: 1.9, lift: 0.4, fist: true };
      r.head.tilt = -0.04;
      break;
    case 'point':
      r.arms[1] = { a: 1.5, b: 0.05, lift: 0.1 };
      r.head.tilt = -0.03;
      r.mouthOpen = S(t * 7) > 0.2;
      break;
    case 'carry':
      r.arms[0] = { a: 0.55, b: 1.4, lift: 0.5 };
      r.arms[1] = { a: 0.55, b: 1.4, lift: 0.5 };
      r.lean = -0.06;
      r.y = (1 - Math.abs(C(p))) * 0.4;
      if (side) {
        r.legs[0] = { a: 0.3 * S(p), b: -(0.12 + 0.6 * pos(C(p))), lift: 0 };
        r.legs[1] = { a: -0.3 * S(p), b: -(0.12 + 0.6 * pos(-C(p))), lift: 0 };
      }
      break;
    case 'eat': {
      const c = (t * 0.5 + seed * 0.1) % 1;
      const up = c < 0.25 ? c / 0.25 : c < 0.5 ? 1 : c < 0.75 ? 1 - (c - 0.5) / 0.25 : 0;
      r.arms[1] = { a: 0.35 + up * 0.75, b: 1.2 + up * 0.9, lift: 0.3 };
      r.arms[0] = { a: 0.3, b: 1.2, lift: 0.3 };
      r.mouthOpen = up > 0.8;
      r.head.nod = 0.06;
      break;
    }
    case 'cry': {
      const sob = pos(S(t * 5)) * 0.4;
      r.arms[0] = { a: 0.8, b: 2.2, lift: 0.5 };
      r.arms[1] = { a: 0.8, b: 2.2, lift: 0.5 };
      r.head.nod = 0.22;
      r.shrug = sob;
      r.lean = 0.12;
      break;
    }
    case 'celebrate': {
      const j = pos(S(t * 7));
      r.y = -j * 1.6;
      r.arms[0] = { a: 2.7 + S(t * 7) * 0.2, b: 0.2, lift: 0, fist: true };
      r.arms[1] = { a: 2.7 - S(t * 7) * 0.2, b: 0.2, lift: 0, fist: true };
      r.mouthOpen = true;
      r.head.tilt = -0.1;
      break;
    }
    case 'fight': {
      const c = (t * 2.2 + seed * 0.1) % 1;
      const hit = c < 0.2 ? c / 0.2 : 1 - (c - 0.2) / 0.8;
      r.lean = 0.14 + hit * 0.1;
      r.legs[0] = { a: -0.35, b: 0.15, lift: 0 };
      r.legs[1] = { a: 0.4, b: -0.35, lift: 0 };
      r.arms[1] = { a: 0.9 + hit * 0.8, b: 1.2 - hit * 1.1, lift: 0.4, fist: true };
      r.arms[0] = { a: 0.9, b: 1.6, lift: 0.4, fist: true };
      r.item = -hit * 0.9;
      break;
    }
  }
  // La edad pesa: la espalda se curva, los pasos son más cortos.
  if (B.stoop > 0 && !r.lying) {
    r.lean += B.stoop * 0.22;
    r.head.nod -= B.stoop * 0.08;
    r.y += B.stoop * 0.4;
  }
  // Lo que se siente se ve en el cuerpo, no solo en la cara.
  bodyLanguage(r, pose);
  return r;
}

function bodyLanguage(r: Rig, pose: Pose): void {
  const busy = pose.action !== 'idle' && pose.action !== 'look' && pose.action !== 'listen';
  switch (pose.expr) {
    case 'triste':
      r.head.nod += 0.16;
      r.shrug -= 0.45;
      r.lean += 0.05;
      if (!busy) (r.arms[0].a = 0.02), (r.arms[1].a = 0.02);
      break;
    case 'miedo':
      r.shrug += 0.55;
      r.lean -= 0.06;
      if (!busy) r.arms = [{ a: 0.35, b: 1.6, lift: 0.4, fist: true }, { a: 0.35, b: 1.7, lift: 0.4, fist: true }];
      break;
    case 'enfadado':
    case 'hostil':
      r.lean += 0.06;
      r.head.nod -= 0.04;
      r.shrug += 0.15;
      r.arms[0].fist = r.arms[1].fist = true;
      if (!busy && pose.expr === 'hostil') r.arms = [{ a: 0.42, b: 1.95, lift: 0.4, fist: true }, { a: 0.42, b: 1.9, lift: 0.4, fist: true }];
      break;
    case 'cansado':
      r.head.nod += 0.12;
      r.head.tilt += 0.07;
      r.shrug -= 0.3;
      r.lean += 0.06;
      r.breath = 1 + (r.breath - 1) * 1.6;
      break;
    case 'confiado':
      r.head.nod -= 0.07;
      r.lean -= 0.03;
      r.shrug -= 0.05;
      if (!busy) r.arms = [{ a: 0.55, b: 1.75, lift: 0.1 }, { a: 0.55, b: 1.75, lift: 0.1 }]; // brazos en jarras
      break;
    case 'sorpresa':
      r.lean -= 0.07;
      r.head.nod -= 0.08;
      if (!busy) r.arms = [{ a: 0.5, b: 1.2, lift: 0.3 }, { a: 0.5, b: 1.2, lift: 0.3 }];
      break;
    case 'preocupado':
      if (!busy) r.arms[1] = { a: 0.6, b: 2.15, lift: 0.4 }; // la mano a la barbilla
      r.head.nod += 0.05;
      break;
    case 'desconfianza':
      r.head.nod -= 0.05;
      r.head.tilt -= 0.06;
      r.lean -= 0.03;
      break;
    case 'feliz':
    case 'alivio':
      r.head.tilt += 0.04;
      r.shrug -= 0.05;
      break;
  }
}
