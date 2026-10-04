import { CULTURES, PLAYER_CULTURE } from './content/cultures';
import { RESOURCES } from './content/resources';
import { TECH_BY_ID } from './content/techs';
import type { Ctx } from './world';
import type { Fact, FactKey, Region, WorldState } from './types';

/**
 * Información incompleta. Este módulo traduce el estado verdadero a
 * descriptores imprecisos, y decide cuánto ruido tiene cada observación.
 * La interfaz solo enseña los `Fact` guardados en `w.intel`.
 */

type Scale = { cuts: number[]; labels: string[] };

const SCALES: Partial<Record<FactKey, Scale>> = {
  alimento: { cuts: [2, 5, 10, 18], labels: ['hambruna', 'graneros casi vacíos', 'justos de comida', 'comida suficiente', 'graneros rebosantes'] },
  ecologia: { cuts: [0.25, 0.45, 0.65, 0.85], labels: ['tierra devastada', 'ecosistema degradado', 'tierra cansada', 'tierra sana', 'naturaleza exuberante'] },
  animo: { cuts: [0.25, 0.42, 0.6, 0.8], labels: ['al borde de la revuelta', 'descontentos', 'inquietos', 'tranquilos', 'muy unidos'] },
  tension: { cuts: [0.25, 0.45, 0.65, 0.85], labels: ['en paz', 'alerta', 'recelosos', 'armándose', 'listos para la guerra'] },
  confianza: { cuts: [0.2, 0.38, 0.55, 0.75], labels: ['hostiles contigo', 'desconfiados', 'indiferentes', 'cordiales', 'leales'] },
  poblacion: { cuts: [300, 650, 1100, 1700], labels: ['aldea pequeña', 'pueblo', 'villa', 'villa grande', 'ciudad'] },
};

/** Valor numérico verdadero de una métrica (solo para uso interno). */
export function trueValue(w: WorldState, r: Region, key: FactKey): number {
  switch (key) {
    case 'alimento':
      return r.isHome ? w.player.reserves / 5 : r.food;
    case 'ecologia':
      return r.ecology;
    case 'animo':
      return r.isHome ? w.player.cohesion : r.stability;
    case 'tension':
      return Math.max(r.militancy, ...Object.values(r.relations).map((x) => (x.war ? 1 : x.tension * 0.9)));
    case 'confianza':
      return r.attitude.trust;
    case 'poblacion':
      return r.population;
    default:
      return 0;
  }
}

function scaleIndex(s: Scale, v: number): number {
  let i = 0;
  while (i < s.cuts.length && v >= s.cuts[i]) i++;
  return i;
}

/** Describe un campo. `error` es la probabilidad de desviarse un escalón. */
export function describe(ctx: Ctx, r: Region, key: FactKey, error: number, reliable: boolean): Fact {
  const w = ctx.w;
  const s = SCALES[key];
  if (s) {
    let idx = scaleIndex(s, trueValue(w, r, key));
    if (ctx.rng.chance(error)) idx = Math.max(0, Math.min(s.labels.length - 1, idx + (ctx.rng.chance(0.5) ? 1 : -1)));
    let label = s.labels[idx];
    if (key === 'tension' && Object.values(r.relations).some((x) => x.war) && !ctx.rng.chance(error)) label = 'en guerra';
    return { value: label, level: idx, day: w.day, reliable };
  }
  return { value: describeText(w, r, key), level: 2, day: w.day, reliable };
}

function describeText(w: WorldState, r: Region, key: FactKey): string {
  const culture = r.isHome ? PLAYER_CULTURE : CULTURES.find((c) => c.id === r.culture)!;
  switch (key) {
    case 'recurso':
      return RESOURCES[r.resource].name + (r.resourceBanned ? ' (prohibido)' : '');
    case 'cultura': {
      const t = culture.traits;
      const traits: string[] = [];
      if (t.curiosity > 0.6) traits.push('curiosos');
      if (t.pride > 0.6) traits.push('orgullosos');
      if (t.mercantile > 0.6) traits.push('comerciantes');
      if (t.caution > 0.6) traits.push('precavidos');
      if (t.spirituality > 0.6) traits.push('devotos de la memoria');
      return `${culture.name}${traits.length ? ': ' + traits.join(', ') : ''}`;
    }
    case 'tecnologias':
      return r.techs.length ? r.techs.map((t) => TECH_BY_ID[t].name).join(', ') : 'nada fuera de lo común';
    case 'investigacion':
      return r.research ? `trabajan en ${TECH_BY_ID[r.research.tech].name}` : 'nada nuevo a la vista';
    case 'relaciones': {
      const parts: string[] = [];
      for (const [id, x] of Object.entries(r.relations)) {
        const other = w.regions[Number(id)];
        if (other.isHome) continue;
        if (x.war) parts.push(`en guerra con ${other.name}`);
        else if (x.allied) parts.push(`aliada de ${other.name}`);
        else if (x.opinion < -0.35) parts.push(`recela de ${other.name}`);
        else if (x.opinion > 0.45) parts.push(`amiga de ${other.name}`);
      }
      return parts.length ? parts.join('; ') : 'sin lazos ni rencillas notables';
    }
    case 'necesidades': {
      const n: string[] = [];
      if (r.flags.hambre) n.push('comida');
      if (r.flags.fiebre) n.push('remedios contra la fiebre');
      if (r.flags.aislada) n.push('caminos abiertos');
      if (r.flags.degradada) n.push('que su tierra descanse');
      if (r.flags.guerra) n.push('que acabe la guerra');
      if (r.stability < 0.4) n.push('orden');
      return n.length ? n.join(', ') : 'ninguna urgente';
    }
    default:
      return '—';
  }
}

export const OBS_KEYS: FactKey[] = ['poblacion', 'alimento', 'ecologia', 'animo', 'tension', 'confianza', 'recurso', 'cultura', 'tecnologias', 'relaciones', 'necesidades', 'investigacion'];

/**
 * Observación directa (observador enviado). La desconfianza de la región
 * y la prioridad "conocimiento" cambian la calidad del informe.
 */
export function observe(ctx: Ctx, r: Region, quality: number, keys: FactKey[] = OBS_KEYS): void {
  const intel = ctx.w.intel[r.id];
  const error = Math.max(0.02, 0.28 - quality * 0.25 + (r.attitude.trust < 0.25 ? 0.12 : 0));
  for (const k of keys) intel.facts[k] = describe(ctx, r, k, error, true);
  intel.level = Math.max(intel.level, 2) as 2 | 3;
  intel.lastObserved = ctx.w.day;
}

/** Información de oídas: un solo campo, con bastante ruido. */
export function hearsay(ctx: Ctx, r: Region, key: FactKey, error = 0.35): void {
  const intel = ctx.w.intel[r.id];
  const prev = intel.facts[key];
  // Un rumor no sobrescribe un informe fiable reciente.
  if (prev?.reliable && ctx.w.day - prev.day < 5) return;
  intel.facts[key] = describe(ctx, r, key, error, false);
  if (intel.level === 0) intel.level = 1;
}

/** Datos básicos que se conocen nada más saber que una región existe. */
export function meet(ctx: Ctx, r: Region): void {
  const intel = ctx.w.intel[r.id];
  if (intel.level === 0) intel.level = 1;
  if (!intel.facts.recurso) intel.facts.recurso = describe(ctx, r, 'recurso', 0, true);
  if (!intel.facts.cultura) intel.facts.cultura = describe(ctx, r, 'cultura', 0, true);
  if (!intel.facts.poblacion) intel.facts.poblacion = describe(ctx, r, 'poblacion', 0.4, false);
}
