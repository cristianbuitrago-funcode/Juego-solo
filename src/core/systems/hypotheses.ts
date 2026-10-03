import { record } from '../chronicle';
import { trueValue } from '../intel';
import type { HypoMetric, Hypothesis, Region, RegionId, WorldState } from '../types';
import { nextId, type Ctx } from '../world';

/**
 * Hipótesis: el jugador formula una predicción, el mundo sigue su curso y
 * al vencer el plazo se evalúa. Una hipótesis evaluada revela también parte
 * de lo que ocurrió (algunas causas ocultas), como recompensa por pensar.
 */
export const METRIC_LABEL: Record<HypoMetric, string> = {
  alimento: 'su reserva de alimento',
  confianza: 'su confianza en ti',
  estabilidad: 'su estabilidad',
  ecologia: 'la salud de su tierra',
  tension: 'su tensión con los vecinos',
  poblacion: 'su población',
};

const THRESHOLD: Record<HypoMetric, number> = { alimento: 1.5, confianza: 0.05, estabilidad: 0.05, ecologia: 0.03, tension: 0.06, poblacion: 0.02 };

export function metricValue(w: WorldState, r: Region, m: HypoMetric): number {
  switch (m) {
    case 'alimento':
      return trueValue(w, r, 'alimento');
    case 'confianza':
      return r.attitude.trust;
    case 'estabilidad':
      return r.isHome ? w.player.cohesion : r.stability;
    case 'ecologia':
      return r.ecology;
    case 'tension':
      return trueValue(w, r, 'tension');
    case 'poblacion':
      return r.population;
  }
}

export interface HypoSpec {
  kind: Hypothesis['kind'];
  regionId: RegionId;
  otherId?: RegionId;
  metric?: HypoMetric;
  direction?: 'sube' | 'baja' | 'igual';
  rumorId?: string;
  claimTrue?: boolean;
  days: number;
  note?: string;
  linkedAction?: string;
  /** Valor de partida medido antes de la acción ligada (si la hay). */
  baseline?: number;
}

export function describeHypothesis(w: WorldState, s: HypoSpec): string {
  const r = w.regions[s.regionId];
  const o = s.otherId !== undefined ? w.regions[s.otherId] : undefined;
  switch (s.kind) {
    case 'metrica': {
      const dir = s.direction === 'sube' ? 'aumentará' : s.direction === 'baja' ? 'disminuirá' : 'se mantendrá';
      return `Creo que en ${r.name} ${METRIC_LABEL[s.metric!]} ${dir} en ${s.days} días.`;
    }
    case 'rumor': {
      const ru = w.rumors.find((x) => x.id === s.rumorId);
      return `Creo que el rumor «${ru?.text ?? '…'}» es ${s.claimTrue ? 'cierto' : 'falso'}.`;
    }
    case 'conflicto':
      return s.claimTrue ? `Creo que ${r.name} y ${o?.name} entrarán en guerra antes de ${s.days} días.` : `Creo que no habrá guerra entre ${r.name} y ${o?.name} en ${s.days} días.`;
    case 'tecnologia':
      return `Creo que ${r.name} ${s.claimTrue ? 'desarrollará' : 'no desarrollará'} una técnica nueva en ${s.days} días.`;
  }
}

export function createHypothesis(ctx: Ctx, s: HypoSpec): Hypothesis {
  const { w } = ctx;
  const r = w.regions[s.regionId];
  const h: Hypothesis = {
    id: nextId(w, 'h'),
    created: w.day,
    dueDay: w.day + s.days,
    kind: s.kind,
    regionId: s.regionId,
    otherId: s.otherId,
    metric: s.metric,
    direction: s.direction,
    rumorId: s.rumorId,
    claimTrue: s.claimTrue,
    baseline: s.metric ? (s.baseline ?? metricValue(w, r, s.metric)) : undefined,
    text: describeHypothesis(w, s),
    note: s.note ?? '',
    linkedAction: s.linkedAction,
  };
  w.hypotheses.push(h);
  return h;
}

export function tickHypotheses(ctx: Ctx): void {
  const { w } = ctx;
  for (const h of w.hypotheses) {
    if (h.result || w.day < h.dueDay) continue;
    evaluate(ctx, h);
  }
}

function evaluate(ctx: Ctx, h: Hypothesis): void {
  const { w } = ctx;
  const r = w.regions[h.regionId];
  const since = (e: { day: number }) => e.day >= h.created && e.day <= w.day;
  switch (h.kind) {
    case 'metrica': {
      const m = h.metric!;
      const now = metricValue(w, r, m);
      const base = h.baseline ?? now;
      const thr = m === 'poblacion' ? base * THRESHOLD[m] : THRESHOLD[m];
      const delta = now - base;
      if (h.direction === 'igual') h.result = Math.abs(delta) < thr ? 'correcta' : Math.abs(delta) < thr * 2.5 ? 'parcial' : 'incorrecta';
      else {
        const signed = h.direction === 'sube' ? delta : -delta;
        h.result = signed > thr ? 'correcta' : signed > 0 ? 'parcial' : 'incorrecta';
      }
      const word = Math.abs(delta) < thr ? 'apenas cambió' : delta > 0 ? (Math.abs(delta) > thr * 3 ? 'aumentó mucho' : 'aumentó') : Math.abs(delta) > thr * 3 ? 'disminuyó mucho' : 'disminuyó';
      h.explanation = `${capital(METRIC_LABEL[m])} ${word}.`;
      // Pistas sobre el porqué, para aprender del experimento.
      if (m === 'alimento' && Math.abs(delta) < thr && w.routes.some((rt) => (rt.a === r.id || rt.b === r.id) && rt.status === 'abierta' && rt.traffic > 0.3))
        h.explanation += ' Parte de lo que tenían se repartió por sus mercados con los vecinos.';
      if (m === 'confianza' && delta < 0 && r.attitude.resentment > 0.5) h.explanation += ' Algo les dolió más que tus gestos.';
      break;
    }
    case 'rumor': {
      const ru = w.rumors.find((x) => x.id === h.rumorId);
      h.result = ru && ru.truth === h.claimTrue ? 'correcta' : 'incorrecta';
      h.explanation = ru ? `El rumor era ${ru.truth ? 'cierto' : 'falso'}.` : 'El rumor se perdió en el tiempo.';
      break;
    }
    case 'conflicto': {
      const war = w.entries.some((e) => since(e) && e.text.startsWith('Estalla la guerra') && e.regions.includes(h.regionId) && e.regions.includes(h.otherId!));
      h.result = war === h.claimTrue ? 'correcta' : 'incorrecta';
      h.explanation = war ? 'Hubo guerra.' : 'No hubo guerra.';
      break;
    }
    case 'tecnologia': {
      const inv = w.entries.some((e) => since(e) && e.kind === 'tecnologia' && e.regions[0] === h.regionId && e.text.includes('desarrolló'));
      h.result = inv === h.claimTrue ? 'correcta' : 'incorrecta';
      h.explanation = inv ? 'Desarrollaron algo nuevo.' : 'No inventaron nada nuevo.';
      break;
    }
  }
  // Recompensa: se revelan causas ocultas de lo ocurrido en la región durante el experimento.
  const hidden = w.entries.filter((e) => !e.known && since(e) && e.regions.includes(h.regionId)).slice(-2);
  for (const e of hidden) e.known = true;
  if (hidden.length) h.explanation += ` Al observar con atención descubres: ${hidden.map((e) => e.text).join(' ')}`;
  if (h.result === 'correcta') w.counters.hypoCorrect = (w.counters.hypoCorrect ?? 0) + 1;
  record(ctx, { kind: 'descubrimiento', text: `Hipótesis ${h.result}: ${h.text}`, regions: [h.regionId], known: true, importance: 2 });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
