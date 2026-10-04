import { record } from '../chronicle';
import type { Objective, WorldState } from '../types';
import { clamp } from '../util';
import { type Ctx } from '../world';
import { mysteryQuestion } from './mystery';

/**
 * Objetivos múltiples: algunos visibles desde el principio, otros se
 * descubren jugando (la verdad oculta, el rival, la crisis).
 * Cada plantilla define cómo se crea y cómo avanza.
 */
interface ObjectiveDef {
  kind: string;
  make: (ctx: Ctx) => Objective | undefined;
  update: (ctx: Ctx, o: Objective) => void;
}

const base = (kind: string, title: string, description: string, hidden = false, data: Objective['data'] = {}): Objective => ({
  id: kind, kind, title, description, hidden, status: 'activo', progress: 0, data,
});

function largestAlliance(w: WorldState): number {
  const seen = new Set<number>();
  let best = 0;
  for (const r of w.regions) {
    if (seen.has(r.id) || r.isHome) continue;
    const stack = [r.id];
    seen.add(r.id);
    let n = 0;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      for (const [id, rel] of Object.entries(w.regions[c].relations)) if (rel.allied && !seen.has(Number(id))) seen.add(Number(id)), stack.push(Number(id));
    }
    best = Math.max(best, n);
  }
  return best;
}

export const OBJECTIVES: ObjectiveDef[] = [
  {
    kind: 'paz',
    make: () => base('paz', 'Paz duradera', 'Que pasen 35 días seguidos sin ninguna guerra en el mundo.'),
    update: (ctx, o) => {
      const days = ctx.w.day - ctx.w.lastWarDay;
      o.progress = clamp(days / 35);
      if (days >= 35) o.status = 'cumplido';
    },
  },
  {
    kind: 'cooperacion',
    make: () => base('cooperacion', 'Tejer la cooperación', 'Que al menos tres regiones queden unidas por alianzas.'),
    update: (ctx, o) => {
      const n = largestAlliance(ctx.w);
      o.progress = clamp((n - 1) / 2);
      if (n >= 3) o.status = 'cumplido';
    },
  },
  {
    kind: 'sostenible',
    make: () => base('sostenible', 'Sociedad sostenible', 'A partir del día 40, mantener 7 días seguidos sin tierras degradadas ni hambre.'),
    update: (ctx, o) => {
      const w = ctx.w;
      const ok = w.regions.every((r) => r.isHome || (r.ecology >= 0.45 && !r.flags.hambre));
      o.data.streak = ok && w.day >= 40 ? Number(o.data.streak ?? 0) + 1 : 0;
      o.progress = w.day < 40 ? clamp((w.day / 40) * 0.5) * (ok ? 1 : 0.5) : clamp(0.5 + Number(o.data.streak) / 14);
      if (Number(o.data.streak) >= 7) o.status = 'cumplido';
    },
  },
  {
    kind: 'experimentos',
    make: () => base('experimentos', 'El método', 'Confirmar tres hipótesis correctas sobre el mundo.'),
    update: (ctx, o) => {
      const n = ctx.w.counters.hypoCorrect ?? 0;
      o.progress = clamp(n / 3);
      if (n >= 3) o.status = 'cumplido';
    },
  },
  {
    kind: 'verdad',
    make: (ctx) => base('verdad', 'La verdad oculta', mysteryQuestion(ctx.w), true),
    update: (ctx, o) => {
      const m = ctx.w.mystery;
      if (m.revealed) o.hidden = false;
      o.progress = m.solved ? 1 : clamp(m.fragmentsFound.length / 4);
      if (m.solved) o.status = 'cumplido';
    },
  },
  {
    kind: 'rival',
    make: (ctx) => {
      const id = ctx.w.counters.rival;
      if (id === undefined) return undefined;
      return base('rival', 'Cambiar una opinión', `Conseguir que ${ctx.w.regions[id].name}, que desconfía de ti, llegue a confiar en tu gente.`, true, { region: id });
    },
    update: (ctx, o) => {
      const w = ctx.w;
      const r = w.regions[Number(o.data.region)];
      if (w.counters.rivalMet) o.hidden = false;
      o.progress = clamp((r.attitude.trust - 0.15) / 0.45);
      if (r.attitude.trust >= 0.6 && r.attitude.resentment < 0.45) o.status = 'cumplido';
    },
  },
  {
    kind: 'sobrevivir',
    make: (ctx) => (ctx.w.mystery.kind === 'invierno' ? base('sobrevivir', 'Sobrevivir al invierno', 'Llegar al deshielo con tu gente unida.', true) : undefined),
    update: (ctx, o) => {
      const w = ctx.w;
      if (w.mystery.fragmentsFound.length > 0 || w.day >= w.mystery.triggerDay) o.hidden = false;
      const end = w.mystery.triggerDay + 12;
      o.progress = clamp(w.day / end);
      if (w.day >= end) o.status = w.player.cohesion >= 0.35 ? 'cumplido' : 'fallido';
    },
  },
  {
    kind: 'fiebre',
    make: (ctx) => (ctx.w.mystery.kind === 'rio' ? base('fiebre', 'Detener la fiebre', 'Que ninguna región sufra la fiebre durante 8 días seguidos, tras descubrir su causa.', true) : undefined),
    update: (ctx, o) => {
      const w = ctx.w;
      if (w.mystery.revealed) o.hidden = false;
      const sick = w.regions.some((r) => r.flags.fiebre);
      o.data.streak = !sick && w.mystery.solved ? Number(o.data.streak ?? 0) + 1 : 0;
      o.progress = w.mystery.solved ? clamp(0.5 + Number(o.data.streak) / 16) : clamp(w.mystery.fragmentsFound.length / 8);
      if (Number(o.data.streak) >= 8) o.status = 'cumplido';
    },
  },
];

export function setupObjectives(ctx: Ctx): void {
  const { w, rng } = ctx;
  const visible = rng.shuffle(['paz', 'cooperacion', 'sostenible', 'experimentos']).slice(0, 3);
  for (const def of OBJECTIVES) {
    if (['paz', 'cooperacion', 'sostenible', 'experimentos'].includes(def.kind) && !visible.includes(def.kind)) continue;
    const o = def.make(ctx);
    if (o) w.objectives.push(o);
  }
}

export function tickObjectives(ctx: Ctx): void {
  const { w } = ctx;
  for (const o of w.objectives) {
    if (o.status !== 'activo') continue;
    const wasHidden = o.hidden;
    OBJECTIVES.find((d) => d.kind === o.kind)?.update(ctx, o);
    if (wasHidden && !o.hidden) record(ctx, { kind: 'descubrimiento', text: `Nuevo objetivo descubierto: ${o.title}.`, regions: [w.player.home], known: true, importance: 3 });
    if ((o.status as Objective['status']) === 'cumplido') {
      w.player.cohesion = clamp(w.player.cohesion + 0.05);
      record(ctx, { kind: 'descubrimiento', text: `Objetivo cumplido: ${o.title}.`, regions: [w.player.home], known: true, importance: 3 });
    }
  }
}
