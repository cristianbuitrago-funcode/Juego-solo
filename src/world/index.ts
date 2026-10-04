import { onAction } from '../core/actions';
import { registerSystem } from '../core/simulation';
import type { WorldState } from '../core/types';
import { dailyLife, ensureLife } from './life';
import { DAY_MINUTES } from './types';

/**
 * Conecta el mundo explorable con el motor:
 * - cada amanecer, después de los sistemas del motor, se actualiza la vida;
 * - cada decisión tomada puede tener una expresión física (caravanas…).
 */
let wired = false;

export function wireWorld(): void {
  if (wired) return;
  wired = true;
  registerSystem('vida', (ctx) => dailyLife(ctx.w));
  onAction((w: WorldState, actionId, params) => {
    const life = ensureLife(w);
    if (actionId === 'ayuda' || actionId === 'regalo') {
      const s = [...w.scheduled].reverse().find((x) => x.kind === 'caravanaLlega');
      const arriveDay = actionId === 'ayuda' && s ? s.day : w.day + 2;
      life.caravans.push({
        id: `k${++life.seq}`,
        to: Number(params.region),
        depart: life.clock,
        arrive: Math.max(life.clock + 240, (arriveDay - 1) * DAY_MINUTES),
        kind: actionId === 'ayuda' ? 'provisiones' : 'regalo',
      });
    }
  });
}

export { ensureLife };
