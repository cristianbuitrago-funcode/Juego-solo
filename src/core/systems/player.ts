import { record } from '../chronicle';
import type { Mood } from '../types';
import { clamp } from '../util';
import { home, routesOf, type Ctx } from '../world';

/** Tu civilización: provisiones, cohesión y emisarios. */
export function tickPlayer(ctx: Ctx): void {
  const { w } = ctx;
  const p = w.player;
  const h = home(w);
  const trade = routesOf(w, h.id).reduce((s, r) => s + (r.status === 'abierta' ? r.traffic : 0), 0);
  let income = 1.1 * (h.flags.invierno ? 0.4 : 1) + Math.sqrt(trade) * (p.priority === 'comercio' ? 0.9 : 0.55);
  let upkeep = 2.0 + (h.population - 600) / 500;
  if (p.laws.racionamiento) upkeep *= 0.6;
  if (p.priority === 'ecologia') income -= 0.3;
  upkeep += w.regions.filter((r) => r.favored).length * 0.6;
  if (!w.sim?.worldEconomy) p.reserves = clamp(p.reserves + income - upkeep, 0, 100);

  let cohesionTarget = 0.68;
  if (p.laws.racionamiento) cohesionTarget -= 0.12;
  if (p.laws.secreto) cohesionTarget -= 0.04;
  if (p.reserves <= 0) {
    cohesionTarget = 0.1;
    if (!h.flags.hambre) {
      const e = record(ctx, { kind: 'consecuencia', text: 'Tu gente pasa hambre. Los almacenes están vacíos.', regions: [h.id], known: true, importance: 3 });
      h.flags.hambre = { since: w.day, causeId: e.id };
    }
  } else if (p.reserves > 10 && h.flags.hambre) delete h.flags.hambre;
  const warsNear = h.neighbors.filter((n) => w.regions[n].flags.guerra).length;
  cohesionTarget -= warsNear * 0.08;
  p.cohesion = clamp(p.cohesion + (cohesionTarget - p.cohesion) * 0.04);
  if (p.priority === 'conocimiento' && p.agents < 4) p.agents = 4;
  if (p.priority !== 'conocimiento' && p.agents > 3) p.agents = 3;
  p.actionsToday = 0;
}

export function computeMood(ctx: Ctx): Mood {
  const { w } = ctx;
  if (w.regions.some((r) => r.flags.invierno) || w.player.cohesion < 0.3 || w.regions.filter((r) => r.flags.hambre || r.flags.fiebre).length >= 3) return 'crisis';
  if (Object.values(w.regions).some((r) => r.flags.guerra)) return 'crisis';
  if (ctx.fresh.some((e) => e.kind === 'descubrimiento' && e.importance >= 2)) return 'descubrimiento';
  if (w.regions.some((r) => r.militancy > 0.55)) return 'tension';
  return 'calma';
}
