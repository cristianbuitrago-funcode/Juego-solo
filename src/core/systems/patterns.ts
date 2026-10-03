import { record } from '../chronicle';
import type { EntryId, Method, RegionId } from '../types';
import { clamp } from '../util';
import { routesOf, type Ctx } from '../world';

/**
 * El mundo aprende tus patrones. Si resuelves siempre igual, las regiones
 * se adaptan a ello: dependen de tu ayuda, se arman ante tu fuerza, acuden a
 * tu mediación o desconfían de tus palabras.
 */
interface Lesson {
  threshold: number;
  text: string;
  apply: (ctx: Ctx) => void;
}

export const LESSONS: Partial<Record<Method, Lesson>> = {
  ayuda: {
    threshold: 5,
    text: 'El mundo aprende que repartes ayuda: algunos pueblos dejan de guardar reservas y esperan tus carros.',
    apply: (ctx) => ctx.w.regions.forEach((r) => !r.isHome && (r.dependency = clamp(r.dependency + 0.1))),
  },
  fuerza: {
    threshold: 2,
    text: 'El mundo aprende que resuelves con lanzas: tus vecinos se arman antes de hablar contigo y te cuentan menos.',
    apply: (ctx) => ctx.w.regions.forEach((r) => !r.isHome && (r.attitude.fear = clamp(r.attitude.fear + 0.12))),
  },
  dialogo: {
    threshold: 3,
    text: 'El mundo aprende que medias: los pueblos enfrentados te buscarán antes de llegar a las armas.',
    apply: () => {},
  },
  engano: {
    threshold: 2,
    text: 'Se murmura que tus palabras esconden trampas. Lo que compartes ya no se cree igual.',
    apply: (ctx) => (ctx.w.player.credibility = clamp(ctx.w.player.credibility - 0.15)),
  },
  informacion: {
    threshold: 3,
    text: 'Se sabe que compartes lo que averiguas: ahora más gente te trae noticias.',
    apply: (ctx) => (ctx.w.player.credibility = clamp(ctx.w.player.credibility + 0.1)),
  },
  abandono: {
    threshold: 2,
    text: 'Se sabe que abandonas a quien no te conviene. Los pueblos confían en ti con cautela.',
    apply: (ctx) => ctx.w.regions.forEach((r) => !r.isHome && (r.attitude.trust = clamp(r.attitude.trust - 0.05))),
  },
  comercio: {
    threshold: 4,
    text: 'Los mercaderes saben que tus tratos se cumplen: el comercio empieza a girar a tu alrededor.',
    apply: (ctx) => routesOf(ctx.w, ctx.w.player.home).forEach((r) => (r.baseTraffic = clamp(r.baseTraffic + 0.1, 0, 1.2))),
  },
};

export function notePattern(ctx: Ctx, method: Method, regionId?: RegionId, causeId?: EntryId): void {
  const { w } = ctx;
  const n = (w.player.patterns[method] = (w.player.patterns[method] ?? 0) + 1);
  if (regionId !== undefined) {
    const r = w.regions[regionId];
    r.patternsSeen[method] = (r.patternsSeen[method] ?? 0) + 1;
  }
  const lesson = LESSONS[method];
  if (lesson && n === lesson.threshold) {
    record(ctx, { kind: 'consecuencia', text: lesson.text, regions: [w.player.home], causeId, known: true, importance: 3 });
    lesson.apply(ctx);
  }
}

/** Las regiones desatendidas desarrollan sus propias soluciones. */
export function tickNeglect(ctx: Ctx): void {
  const { w } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    const neglected = w.day - r.lastAttention > 10 || r.abandoned;
    if (!neglected) {
      r.selfReliance = clamp(r.selfReliance - r.dependency * 0.004);
      continue;
    }
    const troubled = r.flags.hambre || r.flags.aislada || r.flags.sinComercio || r.flags.fiebre;
    r.selfReliance = clamp(r.selfReliance + (troubled ? 0.014 : 0.004) * (r.abandoned ? 1.6 : 1));
    r.dependency = clamp(r.dependency - 0.01);
    r.attitude.trust = clamp(r.attitude.trust + (0.33 - r.attitude.trust) * 0.01);
    if (!r.autonomous && r.selfReliance > 0.72) {
      r.autonomous = true;
      const cause = r.flags.hambre?.causeId ?? r.flags.aislada?.causeId ?? r.flags.sinComercio?.causeId;
      record(ctx, { kind: 'consecuencia', text: `${r.name} ha desarrollado sus propias soluciones: un consejo propio decide ahora sin esperar a nadie.`, regions: [r.id], causeId: cause, importance: 3 });
      r.stability = clamp(r.stability + 0.15);
    }
  }
}
