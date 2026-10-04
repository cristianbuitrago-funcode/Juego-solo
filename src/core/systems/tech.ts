import { TECHS, TECH_BY_ID } from '../content/techs';
import { record } from '../chronicle';
import type { Region } from '../types';
import { clamp } from '../util';
import { causeFor, routeBetween, type Ctx } from '../world';
import { regionRemembers } from './characters';
import { SCARCITY_CAUSES } from './economy';

/**
 * Tecnologías emergentes: nacen de la necesidad. Se difunden por las rutas
 * entre regiones amigas, y provocan disputas entre regiones orgullosas.
 */

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function cultureTraits(ctx: Ctx, r: Region) {
  return ctx.w.cultures.find((c) => c.id === r.culture)?.traits ?? { curiosity: 0.6, pride: 0.4, mercantile: 0.5, caution: 0.4, spirituality: 0.5 };
}

export function tickTech(ctx: Ctx): void {
  const { w, rng } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    const traits = cultureTraits(ctx, r);
    if (!r.research) {
      // ¿Qué invento empuja la situación actual?
      let best: { id: string; p: number } | undefined;
      for (const t of TECHS) {
        if (r.techs.includes(t.id)) continue;
        const p = t.pressure(r, w) * (0.5 + traits.curiosity) * (0.6 + r.selfReliance);
        if (!best || p > best.p) best = { id: t.id, p };
      }
      if (best && best.p > 0.45 && rng.chance(0.12 * best.p)) {
        const cause = causeFor(r, [...SCARCITY_CAUSES, 'hambre', 'engañada']);
        const e = record(ctx, { kind: 'tecnologia', text: `En ${r.name} empezaron a trabajar en algo nuevo.`, regions: [r.id], causeId: cause });
        r.research = { tech: best.id, progress: 0, causeId: e.id };
      }
      continue;
    }
    // Las regiones dependientes de la ayuda investigan menos.
    const speed = (0.035 + 0.04 * traits.curiosity + 0.04 * r.selfReliance) * (r.flags.guerra ? 0.5 : 1) * (1 - r.dependency * 0.6) * (r.autonomous ? 1.3 : 1);
    r.research.progress += speed;
    if (r.research.progress >= 1) {
      const def = TECH_BY_ID[r.research.tech];
      if (r.techs.includes(def.id)) {
        // Lo aprendieron de otros antes de terminar: el esfuerzo no se pierde del todo.
        r.selfReliance = clamp(r.selfReliance + 0.05);
        r.research = null;
        continue;
      }
      r.techs.push(def.id);
      const e = record(ctx, { kind: 'tecnologia', text: `${r.name} desarrolló ${def.name}: ${lowerFirst(def.description)}`, regions: [r.id], causeId: r.research.causeId, importance: 3, known: ctx.rng.chance(0.5) || undefined });
      regionRemembers(ctx, r.id, 'invento', 0.3, e.id, undefined, r.id);
      r.selfReliance = clamp(r.selfReliance + 0.1);
      r.stability = clamp(r.stability + 0.08);
      // Una región que inventa algo se vuelve más importante: el comercio la busca.
      for (const route of w.routes) if (route.a === r.id || route.b === r.id) route.baseTraffic = clamp(route.baseTraffic * 1.2, 0, 1.2);
      r.flags[`invento_${def.id}`] = { since: w.day, causeId: e.id };
      r.research = null;
    }
  }
  diffuse(ctx);
}

/** Difusión: copiar, compartir o disputar un invento. */
function diffuse(ctx: Ctx): void {
  const { w, rng } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    for (const t of r.techs) {
      for (const nbId of r.neighbors) {
        const nb = w.regions[nbId];
        if (nb.isHome || nb.techs.includes(t)) continue;
        const route = routeBetween(w, r.id, nbId);
        if (!route || route.status !== 'abierta') continue;
        const rel = r.relations[nbId];
        const p = 0.025 * route.traffic * (0.4 + cultureTraits(ctx, nb).curiosity);
        if (!rng.chance(p)) continue;
        const origin = r.flags[`invento_${t}`]?.causeId;
        nb.techs.push(t);
        if (rel.opinion > 0.15 || rel.allied) {
          record(ctx, { kind: 'tecnologia', text: `${r.name} compartió ${TECH_BY_ID[t].name} con ${nb.name}.`, regions: [r.id, nbId], causeId: origin });
          rel.opinion = clamp(rel.opinion + 0.1, -1, 1);
          nb.relations[r.id].opinion = clamp(nb.relations[r.id].opinion + 0.15, -1, 1);
        } else if (cultureTraits(ctx, r).pride > 0.45 && origin) {
          // Disputa tecnológica: una región copia el invento de otra.
          const e = record(ctx, { kind: 'conflicto', text: `Disputa tecnológica: ${nb.name} copió ${TECH_BY_ID[t].name} de ${r.name}, que lo considera un robo.`, regions: [r.id, nbId], causeId: origin, importance: 2 });
          rel.opinion = clamp(rel.opinion - 0.3, -1, 1);
          rel.grievance = clamp(rel.grievance + 0.25);
          rel.tension = clamp(rel.tension + 0.2);
          rel.tensionCause = e.id;
          nb.relations[r.id].tension = clamp(nb.relations[r.id].tension + 0.1);
          nb.relations[r.id].tensionCause = e.id;
          regionRemembers(ctx, r.id, 'robo', -0.4, e.id, { X: nb.name }, nbId);
          r.flags.disputa = { since: w.day, causeId: e.id, data: { with: nbId, tech: t } };
        } else {
          record(ctx, { kind: 'tecnologia', text: `${nb.name} aprendió ${TECH_BY_ID[t].name} observando a ${r.name}.`, regions: [r.id, nbId], causeId: origin });
        }
      }
    }
  }
}
