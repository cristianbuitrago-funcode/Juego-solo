import { record } from '../chronicle';
import type { Region } from '../types';
import { clamp } from '../util';
import { leaderOf, routeBetween, type Ctx } from '../world';
import { regionRemembers } from './characters';
import { cultureTraits } from './tech';

/**
 * Relaciones entre regiones y alianzas. El comercio acerca, la competencia
 * y los rumores separan, y los agravios se olvidan muy despacio.
 * La tensión acumulada alimenta la militancia (preparación para el conflicto).
 */
export function tickRelations(ctx: Ctx): void {
  const { w, rng } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    const traits = cultureTraits(ctx, r);
    const leader = leaderOf(w, r.id);
    let maxTension = 0;
    for (const [idStr, rel] of Object.entries(r.relations)) {
      const id = Number(idStr);
      const o = w.regions[id];
      if (o.isHome) continue;
      const route = routeBetween(w, r.id, id);
      const trade = route?.status === 'abierta' ? route.traffic : 0;
      // Opinión: el comercio la mejora, la escasez compartida y los agravios la empeoran.
      let drift = trade * 0.005 - rel.grievance * 0.005 + (0 - rel.opinion) * 0.002;
      if (r.flags.hambre && o.food > 12) drift -= 0.01; // envidia del vecino próspero
      if (r.resource === o.resource && (r.flags.hambre || o.flags.hambre)) drift -= 0.008;
      rel.opinion = clamp(rel.opinion + drift, -1, 1);
      rel.grievance = clamp(rel.grievance - 0.0015);
      // Tensión objetivo: desconfianza + desesperación + ambición del líder + rumores creídos.
      const believedThreat = w.rumors.filter((x) => x.believers.includes(r.id) && x.about === id && (x.kind === 'ataque' || x.kind === 'traicion')).length;
      let target = Math.max(0, -rel.opinion) * 0.85 + rel.grievance * 0.3 + believedThreat * 0.22;
      if (r.flags.hambre && o.food > 8) target += 0.3; // desesperación ante el vecino que tiene
      target += (leader?.emotions.ambition ?? 0.3) * 0.2 - 0.06;
      if (o.militancy > 0.55) target += 0.12 * traits.caution; // ver que el otro se arma asusta
      if (rel.allied) target *= 0.3;
      if (rel.war) target = 1;
      rel.tension = clamp(rel.tension + (target - rel.tension) * 0.12);
      maxTension = Math.max(maxTension, rel.tension);
    }
    // Militancia: se prepara según la amenaza percibida, el miedo y la cautela.
    const forceRep = Math.min(3, w.player.patterns.fuerza ?? 0) * 0.04;
    const mTarget = clamp(maxTension * (0.55 + traits.caution * 0.6) + r.attitude.fear * 0.2 + forceRep + (r.attitude.resentment > 0.7 ? 0.15 : 0));
    r.militancy = clamp(r.militancy + (mTarget - r.militancy) * 0.1);
    if (r.militancy > 0.55 && !r.flags.preparando) {
      const worst = Object.entries(r.relations).filter(([id]) => !w.regions[Number(id)].isHome).sort((a, b) => b[1].tension - a[1].tension)[0];
      const e = record(ctx, { kind: 'conflicto', text: `${r.name} se está armando${worst ? ` por miedo a ${w.regions[Number(worst[0])].name}` : ''}.`, regions: [r.id], causeId: worst?.[1].tensionCause, importance: 1 });
      r.flags.preparando = { since: w.day, causeId: e.id };
    } else if (r.militancy < 0.4 && r.flags.preparando) {
      delete r.flags.preparando;
    }
  }
  tickAlliances(ctx, rng.next());
}

function tickAlliances(ctx: Ctx, roll: number): void {
  const { w } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    for (const [idStr, rel] of Object.entries(r.relations)) {
      const id = Number(idStr);
      if (id < r.id || w.regions[id].isHome) continue;
      const other = w.regions[id];
      const back = other.relations[r.id];
      if (!rel.allied && rel.opinion > 0.55 && back.opinion > 0.55) {
        // Un enemigo común acelera las alianzas.
        const common = commonThreat(ctx, r, other);
        if (common || roll < 0.03) {
          rel.allied = back.allied = true;
          const e = record(ctx, { kind: 'diplomacia', text: `${r.name} y ${other.name} sellan una alianza${common ? ` frente a ${common.name}` : ''}.`, regions: [r.id, id], importance: 2 });
          regionRemembers(ctx, r.id, 'alianza', 0.3, e.id, { X: other.name }, id);
          regionRemembers(ctx, id, 'alianza', 0.3, e.id, { X: r.name }, r.id);
        }
      } else if (rel.allied && (rel.opinion < 0.05 || back.opinion < 0.05)) {
        rel.allied = back.allied = false;
        record(ctx, { kind: 'diplomacia', text: `La alianza entre ${r.name} y ${other.name} se ha roto.`, regions: [r.id, id], causeId: rel.tensionCause, importance: 2 });
      }
    }
  }
}

function commonThreat(ctx: Ctx, a: Region, b: Region): Region | undefined {
  for (const [idStr, ra] of Object.entries(a.relations)) {
    const rb = b.relations[Number(idStr)];
    if (rb && ra.tension > 0.45 && rb.tension > 0.45) return ctx.w.regions[Number(idStr)];
  }
  return undefined;
}
