import type { Appearance } from '../../render/appearance';

/**
 * Proporciones de una persona (en píxeles de mundo; los pies en y = 0 y la
 * cabeza hacia arriba, y negativo). Un adulto mide ~31: unas seis cabezas,
 * proporción humana algo estilizada para que la cara se lea en un móvil.
 * Los niños tienen la cabeza proporcionalmente más grande y las piernas más
 * cortas; la vejez encorva y acorta.
 */
export interface Body {
  H: number; // altura total
  head: number; // alto de la cabeza (de coronilla a barbilla)
  headW: number; // media anchura de la cabeza
  neck: number;
  leg: number; // de la cadera al suelo
  thigh: number;
  shin: number;
  torso: number; // de la cadera a los hombros
  shoulder: number; // media anchura de hombros
  waist: number;
  hip: number; // media anchura de cadera
  hipJoint: number; // separación de las piernas (media)
  upperArm: number;
  foreArm: number;
  armW: number;
  thighW: number;
  shinW: number;
  child: boolean;
  teen: boolean;
  old: boolean;
  stoop: number;
}

const cache = new WeakMap<Appearance, Body>();

export function bodyOf(ap: Appearance): Body {
  const hit = cache.get(ap);
  if (hit) return hit;
  const child = ap.age < 13 || ap.height < 0.8;
  const teen = !child && ap.age < 18;
  const old = ap.age >= 60;
  const H = 31 * ap.height;
  const head = 5.7 * (0.6 + 0.4 * ap.height) * (child ? 1.04 : 1);
  const neck = (child ? 0.6 : 1) * ap.height;
  const leg = H * (child ? 0.42 : teen ? 0.47 : 0.465);
  const torso = H - head - neck - leg;
  const b = ap.build;
  const f = ap.fem;
  const ageW = child ? 0.78 : teen ? 0.9 : 1;
  // Con los años (y con la buena mesa) la cintura se ensancha; el adolescente aún es estrecho de hombros.
  const girth = 1 + Math.max(0, b - 1.08) * 1.4 + (ap.age > 42 ? Math.min(0.1, (ap.age - 42) / 160) : 0);
  const sh = teen ? 0.9 : 1;
  const out: Body = {
    H,
    head,
    headW: head * (child ? 0.44 : 0.385) * (0.94 + ap.jaw * 0.06),
    neck,
    leg,
    thigh: leg * 0.5,
    shin: leg * 0.5,
    torso,
    shoulder: (f ? 3.45 : 4.05) * b * ageW * sh,
    waist: (f ? 2.25 : 2.65) * b * ageW * girth,
    hip: (f ? 3.05 : 2.75) * b * ageW,
    hipJoint: (f ? 1.45 : 1.4) * b * ageW,
    upperArm: H * 0.19,
    foreArm: H * 0.165,
    armW: (f ? 1.35 : 1.55) * b * ageW,
    thighW: (f ? 2.05 : 2.15) * b * ageW,
    shinW: (f ? 1.5 : 1.6) * b * ageW,
    child,
    teen,
    old,
    stoop: ap.stoop,
  };
  cache.set(ap, out);
  return out;
}
