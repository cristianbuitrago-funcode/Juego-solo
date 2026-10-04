import type { Ctx } from './world';
import { nextId } from './world';
import type { EntryId, Scheduled } from './types';

/**
 * Consecuencias retardadas. Una decisión puede programar efectos que se
 * ejecutan días después (p. ej. el colapso de un ecosistema sobreexplotado,
 * o que se descubra un sabotaje). Los sistemas registran manejadores por tipo.
 */
export type EffectHandler = (ctx: Ctx, s: Scheduled) => void;

const handlers: Record<string, EffectHandler> = {};

export function registerEffect(kind: string, handler: EffectHandler): void {
  handlers[kind] = handler;
}

export function schedule(ctx: Ctx, kind: string, delay: number, data: Scheduled['data'] = {}, causeId?: EntryId): Scheduled {
  const s: Scheduled = { id: nextId(ctx.w, 's'), day: ctx.w.day + Math.max(1, Math.round(delay)), kind, data, causeId };
  ctx.w.scheduled.push(s);
  return s;
}

export function runScheduled(ctx: Ctx): void {
  const due = ctx.w.scheduled.filter((s) => s.day <= ctx.w.day);
  ctx.w.scheduled = ctx.w.scheduled.filter((s) => s.day > ctx.w.day);
  for (const s of due) {
    const h = handlers[s.kind];
    if (h) h(ctx, s);
  }
}
