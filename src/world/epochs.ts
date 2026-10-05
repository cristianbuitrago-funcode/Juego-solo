import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { marketOf, foodDays } from './economy';
import { geoOf } from './geography';
import { natureOf } from './nature';
import { logEvent, playerRegion } from './society';
import { recordHist } from './history';
import { gensOf } from './genstate';
import { govOf } from './politics';
import { GOV } from './polstate';
import { addPoi, freeSpot } from './settlements';
import { cultureOf } from './culture';
import { atlasOf, TIER_ORDER } from './atlas';
import { DAYS_PER_YEAR } from './types';

/**
 * El paso de las épocas. Cada diez años el mundo pone nombre a lo que ha
 * vivido (no lo decide un guion: sale de lo que de verdad pasó). Muy de vez
 * en cuando ocurre algo raro —una figura excepcional, una gran migración,
 * una veta nunca vista, una tierra que nadie conocía—. Y el mundo guarda una
 * foto de sí mismo cada año, para poder contar cómo ha cambiado a quien
 * vuelve después de mucho tiempo.
 */
export const ERA_SPAN = DAYS_PER_YEAR * 10;

export function epochsDay(w: WorldState, rng: Rng): string[] {
  const a = atlasOf(w);
  const out: string[] = [];
  if (!a.eras.length) a.eras.push({ from: 1, name: 'Los tiempos de antes', why: 'Nadie recuerda bien cómo empezó todo.' });
  if (w.day % DAYS_PER_YEAR === 0) snapshotWorld(w);
  if (w.day % ERA_SPAN === 0) out.push(...nameEra(w));
  // Acontecimientos raros: como mucho uno cada tres años.
  if (w.day > DAYS_PER_YEAR * 3 && w.day - a.lastRare > DAYS_PER_YEAR * 3 && rng.chance(0.012)) {
    const text = rareEvent(w, rng);
    if (text) {
      a.lastRare = w.day;
      out.push(text);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Épocas
// ---------------------------------------------------------------------------
const ERA_NAMES: Record<string, string[]> = {
  guerra: ['Los años de hierro', 'El tiempo de las espadas', 'La década de la sangre'],
  crisis: ['Los años flacos', 'El tiempo de la penuria', 'La década gris'],
  descubrimiento: ['El tiempo de los saberes', 'Los años de las novedades', 'La década despierta'],
  fundacion: ['Los años de las fundaciones', 'El tiempo de los caminos nuevos', 'La década de las aldeas'],
  tratado: ['La larga paz', 'El tiempo de los pactos', 'Los años tranquilos'],
  gobierno: ['El tiempo de las revueltas', 'Los años de los cambios', 'La década inquieta'],
  calma: ['Los años quietos', 'El tiempo sin historia', 'La década lenta'],
};

function nameEra(w: WorldState): string[] {
  const a = atlasOf(w);
  const from = w.day - ERA_SPAN;
  const ev = gensOf(w).history.filter((e) => e.day > from && e.day <= w.day);
  const score: Record<string, number> = { guerra: 0, crisis: 0, descubrimiento: 0, fundacion: 0, tratado: 0, gobierno: 0 };
  for (const e of ev) {
    const k = e.kind === 'rebelion' || e.kind === 'ley' ? 'gobierno' : e.kind === 'paz' ? 'tratado' : e.kind === 'pueblo' ? 'fundacion' : e.kind;
    if (k in score) score[k] += e.importance;
  }
  const top = Object.entries(score).sort((x, y) => y[1] - x[1])[0];
  const key = top[1] >= 4 ? top[0] : 'calma';
  const names = ERA_NAMES[key];
  const used = new Set(a.eras.map((e) => e.name));
  const name = names.find((n) => !used.has(n)) ?? `${names[0]} (otra vez)`;
  const why = {
    guerra: 'Hubo más guerras que cosechas.',
    crisis: 'El hambre, los desastres y la pobreza marcaron estos años.',
    descubrimiento: 'Llegaron saberes y técnicas nuevas.',
    fundacion: 'Se levantaron lugares nuevos y se abrieron caminos.',
    tratado: 'Los pueblos se entendieron y firmaron pactos.',
    gobierno: 'Cayeron gobiernos y cambiaron las leyes.',
    calma: 'No pasó gran cosa: la gente trabajó y vivió.',
  }[key]!;
  const last = a.eras[a.eras.length - 1];
  if (last) last.to = w.day;
  a.eras.push({ from: w.day, name, why });
  // El nombre lo pone quien mira atrás: la época que acaba.
  const text = `Los años que acaban ya tienen nombre: «${name}». ${why}`;
  recordHist(w, { kind: 'pueblo', regionId: w.player.home, text, importance: 2, fame: 0.5, witnessed: true });
  return [text];
}

export function currentEra(w: WorldState): string {
  const a = atlasOf(w);
  return a.eras[a.eras.length - 1]?.name ?? 'Los tiempos de antes';
}

// ---------------------------------------------------------------------------
// Acontecimientos raros
// ---------------------------------------------------------------------------
function rareEvent(w: WorldState, rng: Rng): string | null {
  const kind = rng.pick(['figura', 'migracion', 'veta', 'ignota'] as const);
  if (kind === 'figura') {
    // Alguien excepcional: una sabia, un inventor, una líder que lo cambia todo.
    const pool = w.life!.folk.filter((f) => f.alive && f.age > 25 && f.age < 60);
    if (!pool.length) return null;
    const f = rng.pick(pool);
    const r = w.regions[f.regionId];
    const what = rng.pick([
      { t: 'sabe curar lo que nadie cura', fx: () => (r.stability = clamp(r.stability + 0.1)) },
      { t: 'ha inventado una forma nueva de trabajar el campo', fx: () => (marketOf(w, r.id).prosperity = clamp(marketOf(w, r.id).prosperity + 0.08)) },
      { t: 'arrastra a la gente con sus palabras', fx: () => (r.militancy = clamp(r.militancy + 0.1)) },
      { t: 'construye como nadie: puentes, molinos, murallas', fx: () => (marketOf(w, r.id).treasury += 30) },
    ]);
    what.fx();
    const text = `En ${r.name} se habla de ${f.name}, que ${what.t}. De toda la isla vienen a verle.`;
    logEvent(w, r.id, 'personaje', text, [f.id]);
    recordHist(w, { kind: 'hazana', regionId: r.id, text, actor: f.name, importance: 3, fame: 0.7, witnessed: playerRegion(w) === r.id });
    return text;
  }
  if (kind === 'migracion') {
    // Una gran migración: de donde se pasa hambre (o hay guerra) a donde hay tierra.
    const from = [...w.regions].sort((x, y) => foodDays(w, x.id) - (x.flags.guerra ? 5 : 0) - (foodDays(w, y.id) - (y.flags.guerra ? 5 : 0)))[0];
    // Van adonde hay comida y tierra (nunca a otro sitio con hambre).
    const to = [...from.neighbors].filter((id) => foodDays(w, id) > 2 && !w.regions[id].flags.guerra).sort((x, y) => geoOf(w, y).capacity + foodDays(w, y) / 20 - geoOf(w, x).capacity - foodDays(w, x) / 20)[0];
    if (to === undefined || from.population < 200) return null;
    const n = Math.round(from.population * 0.18);
    from.population -= n;
    w.regions[to].population += n;
    const a = atlasOf(w);
    const c = cultureOf(w, from.id);
    a.exposure[c.id] = (a.exposure[c.id] ?? 0) + (playerRegion(w) === to ? 10 : 0);
    const text = `Gran migración: unas ${n} personas dejan ${from.name} y llegan a ${w.regions[to].name} con lo que pueden cargar. Traen su lengua, su comida y sus costumbres.`;
    logEvent(w, to, 'migracion', text, []);
    recordHist(w, { kind: 'pueblo', regionId: to, text, importance: 3, fame: 0.6, witnessed: true });
    return text;
  }
  if (kind === 'veta') {
    const cands = w.regions.filter((r) => geoOf(w, r.id).mix.montana > 0.15);
    if (!cands.length) return null;
    const r = rng.pick(cands);
    natureOf(w, r.id).mineral = 1;
    const m = marketOf(w, r.id);
    m.stock.hierro += 30;
    m.treasury += 20;
    r.population += 40;
    const spot = freeSpot(w, r.id, rng);
    if (spot) addPoi(w, { kind: 'cantera', name: 'La veta nueva', regionId: r.id, x: spot.x, y: spot.y, text: 'Una herida en la montaña que brilla al sol. Hay gente cavando a todas horas.' });
    const text = `En ${r.name} han encontrado una veta de hierro como no se había visto nunca. Llega gente de todas partes.`;
    logEvent(w, r.id, 'descubrimiento', text, []);
    recordHist(w, { kind: 'descubrimiento', regionId: r.id, text, importance: 3, fame: 0.6, witnessed: true });
    return text;
  }
  // Una tierra que nadie conocía: un valle escondido con las ruinas de gente muy antigua.
  const cands = w.regions.filter((r) => w.intel[r.id].level < 2 && !r.isHome);
  const r = cands.length ? rng.pick(cands) : rng.pick(w.regions);
  const spot = freeSpot(w, r.id, new Rng(hashString(`ignota:${w.seed}:${w.day}`)));
  if (!spot) return null;
  addPoi(w, { kind: 'ruinas', name: 'Templo de los antiguos', regionId: r.id, x: spot.x, y: spot.y, text: 'Columnas de una piedra que no es de aquí, y grabados de gente que vestía como nadie viste hoy. ¿Quiénes vivían en la isla antes que todos?', clue: 'antiguos' });
  const text = `Unos pastores de ${r.name} han encontrado, tras un paso que nadie usaba, un valle escondido con ruinas muy antiguas.`;
  logEvent(w, r.id, 'descubrimiento', text, []);
  recordHist(w, { kind: 'descubrimiento', regionId: r.id, text, importance: 3, fame: 0.65, witnessed: true });
  return text;
}

// ---------------------------------------------------------------------------
// Fotos del mundo y «cómo ha cambiado»
// ---------------------------------------------------------------------------
type Snap = ReturnType<typeof atlasOf>['snapshots'][number];

export function takeSnapshot(w: WorldState): Snap {
  const a = atlasOf(w);
  const pol = w.life?.politics;
  return {
    day: w.day,
    govs: w.regions.map((r) => (pol ? govOf(w, r.id).system : 'consejo')),
    owners: w.regions.map((r) => pol?.owner[r.id] ?? r.id),
    tiers: a.settlements.map((s) => (s.state === 'vivo' ? TIER_ORDER.indexOf(s.tier) : -1)),
    pops: w.regions.map((r) => Math.round(r.population)),
    techs: w.regions.reduce((s, r) => s + r.techs.length, 0),
    settlements: a.settlements.filter((s) => s.state === 'vivo').length,
  };
}

export function snapshotWorld(w: WorldState): void {
  const a = atlasOf(w);
  a.snapshots.push(takeSnapshot(w));
  // Se guardan las de los últimos 10 años y una de cada 5 años antes (el guardado sigue siendo pequeño).
  a.snapshots = a.snapshots.filter((s, i) => i >= a.snapshots.length - 10 || Math.round(s.day / DAYS_PER_YEAR) % 5 === 0).slice(-40);
}

/** Cuánto ha cambiado el mundo entre dos fotos (0 = nada, 1 = irreconocible). */
export function worldDiff(x: Snap, y: Snap): number {
  const n = x.govs.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    if (x.govs[i] !== y.govs[i]) d += 1;
    if (x.owners[i] !== y.owners[i]) d += 1.5;
    d += Math.min(1, Math.abs(x.pops[i] - y.pops[i]) / Math.max(100, x.pops[i]));
  }
  d += Math.abs(y.settlements - x.settlements) * 0.7 + Math.abs(y.techs - x.techs) * 0.3;
  return clamp(d / (n * 2));
}

/** Lo que ha cambiado en el mundo desde un día (para quien vuelve tras años, o para el heredero). */
export function worldSince(w: WorldState, since: number): string[] {
  const a = atlasOf(w);
  const old = [...a.snapshots].reverse().find((s) => s.day <= since) ?? a.snapshots[0];
  if (!old || w.day - old.day < DAYS_PER_YEAR) return [];
  const now = takeSnapshot(w);
  const out: string[] = [];
  const years = Math.round((w.day - old.day) / DAYS_PER_YEAR);
  for (const r of w.regions) {
    const i = r.id;
    if (w.intel[i].level === 0 && !r.isHome) continue;
    if (old.owners[i] !== now.owners[i]) out.push(now.owners[i] === i ? `${r.name} vuelve a ser libre.` : `${r.name} ahora responde ante ${w.regions[now.owners[i]].name}.`);
    else if (old.govs[i] !== now.govs[i]) out.push(`En ${r.name} ya no hay ${GOV[old.govs[i] as keyof typeof GOV]?.name ?? old.govs[i]}: ahora, ${GOV[now.govs[i] as keyof typeof GOV]?.name ?? now.govs[i]}.`);
    const dp = now.pops[i] - old.pops[i];
    if (Math.abs(dp) > Math.max(60, old.pops[i] * 0.2)) out.push(`${r.name} ${dp > 0 ? 'ha crecido mucho' : 'se ha vaciado'}: ${dp > 0 ? 'casas nuevas por todas partes' : 'casas cerradas y campos sin labrar'}.`);
  }
  const born = a.settlements.filter((s) => s.founded > old.day && s.state === 'vivo');
  if (born.length) out.push(`Hay lugares nuevos: ${born.slice(0, 3).map((s) => s.name).join(', ')}${born.length > 3 ? '…' : ''}.`);
  const lost = a.settlements.filter((s) => s.state !== 'vivo' && s.history[s.history.length - 1]?.day > old.day);
  if (lost.length) out.push(`Otros ya no existen: ${lost.slice(0, 3).map((s) => s.name).join(', ')}.`);
  const eras = a.eras.filter((e) => e.from > old.day);
  if (eras.length) out.push(`La gente habla de ${eras.map((e) => `«${e.name}»`).join(' y ')}.`);
  if (now.techs > old.techs) out.push('Se trabaja de otra manera: han llegado técnicas nuevas.');
  if (out.length) out.unshift(`Han pasado ${years} año${years === 1 ? '' : 's'}. El mundo ya no es el que conocías.`);
  return out.slice(0, 8);
}
