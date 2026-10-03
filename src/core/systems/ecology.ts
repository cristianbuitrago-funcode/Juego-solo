import { RESOURCES } from '../content/resources';
import { record } from '../chronicle';
import { clamp } from '../util';
import { causeFor, totalTraffic, type Ctx } from '../world';
import { techMult } from './economy';

/**
 * Ecosistemas. Exportar mucho, sobreexplotar o crecer demasiado desgasta la
 * tierra. El daño llega con retraso y, pasado cierto punto, el ecosistema
 * se transforma de forma permanente (el recurso de la región cambia).
 */

/** Qué queda cuando un ecosistema colapsa. */
const TRANSFORM: Record<string, { to: string; text: string }> = {
  pesca: { to: 'sal', text: 'donde había bancos de peces ahora hay marismas salobres' },
  grano: { to: 'lana', text: 'los campos agotados se han convertido en pastizales' },
  hierbas: { to: 'arcilla', text: 'el bosque de hierbas se ha secado y deja barro rojo' },
  hierro: { to: 'arcilla', text: 'las minas se han inundado de lodo' },
  lana: { to: 'hierbas', text: 'los pastos abandonados se llenan de matorral silvestre' },
  ambar: { to: 'hierbas', text: 'los viejos pinos han caído y crece el sotobosque' },
  sal: { to: 'pesca', text: 'el mar ha recuperado las salinas' },
  arcilla: { to: 'grano', text: 'el limo de las orillas se ha vuelto tierra fértil' },
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function tickEcology(ctx: Ctx): void {
  const { w } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    const res = RESOURCES[r.resource];
    let target = 0.12 + totalTraffic(w, r.id) * 0.18 * res.tradeValue + (r.population / 1500) * 0.15;
    if (r.flags.explotada) target += 0.45;
    if (w.player.priority === 'ecologia' && r.neighbors.includes(w.player.home)) target -= 0.06;
    if (r.resourceBanned) target = 0.03;
    r.pressure = clamp(r.pressure + (target - r.pressure) * 0.15);
    const recovery = (0.006 + techMult(r, 'ecology')) * (1 - r.ecology);
    const before = r.ecology;
    r.ecology = clamp(r.ecology + recovery - r.pressure * 0.022 * res.fragility, 0.05, 1);

    if (before >= 0.42 && r.ecology < 0.42 && !r.flags.degradada) {
      const e = record(ctx, { kind: 'ecologia', text: `El ecosistema de ${r.name} se degrada: ${lowerFirst(res.depleted.replace('{R}', r.name))}`, regions: [r.id], causeId: causeFor(r, ['explotada', 'transformada']), importance: 2 });
      r.flags.degradada = { since: w.day, causeId: e.id };
    }
    if (r.flags.degradada && r.ecology > 0.56) {
      record(ctx, { kind: 'ecologia', text: `La tierra de ${r.name} se ha recuperado.`, regions: [r.id], causeId: r.flags.degradada.causeId });
      delete r.flags.degradada;
    }
    if (r.ecology < 0.2 && !r.flags.transformada) {
      const t = TRANSFORM[r.resource];
      const e = record(ctx, { kind: 'ecologia', text: `El mundo ha cambiado en ${r.name}: ${t.text}. Ahora viven de ${RESOURCES[t.to].name}.`, regions: [r.id], causeId: r.flags.degradada?.causeId, importance: 3 });
      r.flags.transformada = { since: w.day, causeId: e.id, data: { from: r.resource } };
      r.resource = t.to;
      r.ecology = 0.45;
      r.pressure = 0.1;
      r.stability = clamp(r.stability - 0.15);
    }
  }
}
