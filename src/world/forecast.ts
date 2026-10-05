import type { WorldState } from '../core/types';
import { GOOD, marketOf, type Good } from './economy';
import { gain, story } from './identity';
import { orgById, orgsOf } from './orgs';
import { lawsOf } from './politics';
import { relOf } from './diplomacy';
import { LAWS, nid, polOf, type Forecast, type ForecastVar, type LawId } from './polstate';

/**
 * Hipótesis sobre el mundo vivo: el jugador elige una variable (el precio
 * de algo, la población, el enfado de un grupo, una votación, una guerra,
 * una ley), hace una predicción y pone un plazo. Al llegar el día se
 * comprueba de verdad: acierto, fallo, acierto a medias… o algo inesperado
 * que nadie vio venir, con la explicación de lo que pasó entre medias.
 */
export function measure(w: WorldState, f: Pick<Forecast, 'variable' | 'regionId' | 'good' | 'orgId' | 'propId' | 'other' | 'law'>): number {
  switch (f.variable) {
    case 'precio':
      return marketOf(w, f.regionId).price[f.good ?? 'trigo'];
    case 'poblacion':
      return w.regions[f.regionId].population;
    case 'prosperidad':
      return marketOf(w, f.regionId).prosperity;
    case 'descontento':
      return orgById(w, f.orgId)?.discontent ?? 0;
    case 'votacion': {
      const p = polOf(w).proposals.find((x) => x.id === f.propId);
      return p?.status === 'aprobada' ? 1 : p?.status === 'rechazada' ? 0 : 0.5;
    }
    case 'guerra':
      return relOf(w, f.regionId, f.other ?? f.regionId).war ? 1 : 0;
    case 'ley':
      return LAWS[f.law ?? 'impuestos'].options.indexOf(lawsOf(w, f.regionId)[f.law ?? 'impuestos']);
  }
}

export function describeForecast(w: WorldState, f: Omit<Forecast, 'id' | 'created' | 'baseline' | 'text'>): string {
  const R = w.regions[f.regionId].name;
  const dir = f.prediction === 'sube' ? 'subirá' : f.prediction === 'baja' ? 'bajará' : f.prediction === 'igual' ? 'seguirá igual' : f.prediction === 'si' ? 'sí' : 'no';
  const days = f.due - w.day;
  switch (f.variable) {
    case 'precio': return `El precio de ${GOOD[f.good ?? 'trigo'].name} en ${R} ${dir} en ${days} días.`;
    case 'poblacion': return `La población de ${R} ${dir} en ${days} días.`;
    case 'prosperidad': return `La vida en ${R} ${f.prediction === 'sube' ? 'mejorará' : f.prediction === 'baja' ? 'empeorará' : 'seguirá igual'} en ${days} días.`;
    case 'descontento': return `El enfado de ${orgById(w, f.orgId)?.name ?? 'un grupo'} ${dir} en ${days} días.`;
    case 'votacion': return `La propuesta ${f.prediction === 'si' ? 'saldrá' : 'no saldrá'} adelante en ${R}.`;
    case 'guerra': return `${f.prediction === 'si' ? 'Habrá' : 'No habrá'} guerra entre ${R} y ${w.regions[f.other ?? 0].name} dentro de ${days} días.`;
    case 'ley': return `En ${days} días, ${R} ${f.prediction === 'si' ? 'habrá cambiado' : 'no habrá cambiado'} su ley de ${LAWS[f.law ?? 'impuestos'].name}.`;
  }
}

export function makeForecast(w: WorldState, o: Omit<Forecast, 'id' | 'created' | 'baseline' | 'text'>): Forecast {
  const f: Forecast = { ...o, id: nid(w, 'h'), created: w.day, baseline: measure(w, o), text: describeForecast(w, o) };
  polOf(w).forecasts.push(f);
  return f;
}

/** Lo que pasó entre medias que pudo torcer la predicción (sacado de lo que de verdad ocurrió). */
function surprises(w: WorldState, f: Forecast): string[] {
  const pol = polOf(w);
  const big = ['guerra', 'batalla', 'rebelion', 'gobierno', 'motin', 'huelga', 'boicot', 'frontera', 'tratado', 'ley'];
  return pol.log.filter((e) => e.day > f.created && e.day <= w.day && (e.regionId === f.regionId || e.regionId === f.other) && big.includes(e.kind)).map((e) => e.text).slice(-3);
}

export function forecastDay(w: WorldState): string[] {
  const out: string[] = [];
  for (const f of polOf(w).forecasts) {
    if (f.result || f.due > w.day) continue;
    const now = measure(w, f);
    const before = f.baseline;
    let result: Forecast['result'];
    let why = '';
    if (f.variable === 'votacion' || f.variable === 'guerra' || f.variable === 'ley') {
      const happened = f.variable === 'ley' ? now !== before : now >= 1;
      const pending = f.variable === 'votacion' && now === 0.5;
      result = pending ? 'parcial' : happened === (f.prediction === 'si') ? 'acierto' : 'fallo';
      why = pending ? 'Aún no se ha votado.' : happened ? 'Ocurrió.' : 'No ocurrió.';
    } else {
      const change = (now - before) / Math.max(0.01, Math.abs(before));
      const moved = Math.abs(change) > 0.05;
      const dir = change > 0 ? 'sube' : 'baja';
      if (f.prediction === 'igual') result = !moved ? 'acierto' : Math.abs(change) < 0.12 ? 'parcial' : 'fallo';
      else if (!moved) result = Math.sign(change) === (f.prediction === 'sube' ? 1 : -1) ? 'parcial' : 'fallo';
      else result = dir === f.prediction ? 'acierto' : 'fallo';
      why = !moved ? 'Apenas cambió.' : `${dir === 'sube' ? 'Subió' : 'Bajó'} ${Math.abs(change) > 0.3 ? 'mucho' : 'algo'}.`;
    }
    // Lo inesperado: un acontecimiento grande que nadie metió en la cuenta.
    const s = surprises(w, f);
    if (s.length && (result === 'fallo' || (result === 'acierto' && s.some((x) => /guerra|levantamiento|gobierno|motín/i.test(x))))) {
      result = 'inesperado';
      why += ` Pero entre medias pasó algo que lo cambió todo: ${s.join(' ')}`;
    }
    f.result = result;
    f.explanation = why.trim();
    if (result === 'acierto') {
      gain(w, f.variable === 'precio' || f.variable === 'prosperidad' ? 'k:economia' : 'k:politica', 1);
      for (const o of orgsOf(w, f.regionId).filter((x) => x.kind === 'sabios')) o.player.rep = Math.min(1, o.player.rep + 0.05);
      story(w, `Acertó una predicción: ${f.text}`, 'conocimiento');
    }
    out.push(`Tu hipótesis («${f.text}»): ${result === 'acierto' ? 'acertaste' : result === 'fallo' ? 'fallaste' : result === 'parcial' ? 'a medias' : 'pasó algo inesperado'}. ${f.explanation}`);
  }
  return out;
}

export const FORECAST_VARS: { v: ForecastVar; label: string }[] = [
  { v: 'precio', label: 'El precio de algo' },
  { v: 'poblacion', label: 'Cuánta gente vive allí' },
  { v: 'prosperidad', label: 'Cómo se vive allí' },
  { v: 'descontento', label: 'El enfado de un grupo' },
  { v: 'votacion', label: 'Una votación' },
  { v: 'guerra', label: 'Si habrá guerra' },
  { v: 'ley', label: 'Si cambiará una ley' },
];

export type { Good, LawId };
