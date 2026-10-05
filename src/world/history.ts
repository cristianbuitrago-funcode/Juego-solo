import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { folkById, logEvent } from './society';
import { seedRumor } from './gossip';
import { DAYS_PER_YEAR } from './types';
import type { Folk } from './types';
import { gensOf, gid, type HistEvent, type HistKind, type House } from './genstate';
import { heirloomDeed } from './estate';

/**
 * La memoria histórica. Solo se archiva lo importante (rendimiento en
 * Android): guerras, tratados, gobiernos, crisis, fundaciones, personajes,
 * y lo que hizo el protagonista. Lo que pasó queda escrito tal cual; lo que
 * se cuenta, cambia con los años: de hecho a recuerdo, de recuerdo a
 * leyenda, de leyenda a mito… o al olvido. Las hazañas muy recordadas
 * tienen monumento y fiesta; las demás se van borrando.
 */
export function recordHist(w: WorldState, e: Omit<HistEvent, 'id' | 'day'> & { day?: number }): HistEvent | undefined {
  if (!w.life) return undefined;
  const g = gensOf(w);
  const day = e.day ?? w.day;
  if (g.history.some((x) => x.text === e.text && Math.abs(x.day - day) < 3)) return undefined;
  const ev: HistEvent = { ...e, id: gid(w, 'e'), day };
  g.history.push(ev);
  if (ev.gen !== undefined && ev.importance >= 2) heirloomDeed(w, ev.text);
  if (g.history.length > g.scale.historyCap) {
    // Se olvida lo menos recordado y más antiguo (nunca lo del linaje del jugador con monumento).
    let worst = -1;
    let wv = Infinity;
    for (let i = 0; i < g.history.length; i++) {
      const x = g.history[i];
      if (x.monument) continue;
      const v = x.fame * x.importance + (x.gen !== undefined ? 0.5 : 0) - (w.day - x.day) / 4000;
      if (v < wv) (wv = v), (worst = i);
    }
    if (worst >= 0) g.history.splice(worst, 1);
  }
  return ev;
}

const ENTRY_KIND: Record<string, HistKind> = { conflicto: 'guerra', diplomacia: 'tratado', tecnologia: 'descubrimiento', descubrimiento: 'descubrimiento', migracion: 'pueblo', ecologia: 'crisis', evento: 'crisis', consecuencia: 'crisis', personaje: 'muerte', accion: 'ley', informacion: 'descubrimiento' };
const LOG_KIND: Record<string, HistKind> = { guerra: 'guerra', tratado: 'tratado', gobierno: 'gobierno', rebelion: 'rebelion', frontera: 'frontera', eleccion: 'gobierno' };

/** Cada día: se archiva lo importante que ha pasado en el mundo. */
export function archiveDay(w: WorldState): void {
  const g = gensOf(w);
  const life = w.life!;
  // Del motor: solo lo de importancia máxima (y lo que hizo el jugador).
  const start = Math.max(0, w.entries.findIndex((e) => Number(e.id.slice(1)) > g.entryMark));
  if (start >= 0) for (let i = start; i < w.entries.length; i++) {
    const e = w.entries[i];
    const n = Number(e.id.slice(1));
    if (n <= g.entryMark) continue;
    g.entryMark = Math.max(g.entryMark, n);
    if (e.importance < 3 && !(e.byPlayer && e.importance >= 2)) continue;
    if (e.byPlayer && e.kind === 'personaje') continue; // las muertes y relevos del linaje se archivan aparte
    recordHist(w, { day: e.day, kind: ENTRY_KIND[e.kind] ?? 'crisis', regionId: e.regions[0] ?? w.player.home, text: e.text, actor: e.byPlayer ? life.player.name : undefined, gen: e.byPlayer ? life.player.generation : undefined, importance: e.importance, fame: e.importance === 3 ? 0.55 : 0.35, witnessed: e.known, src: 'cronica' });
  }
  // De la política: guerras, tratados, gobiernos, rebeliones, fronteras.
  const pol = life.politics;
  if (pol) {
    for (const x of pol.log) {
      if (x.day <= g.logMark || !LOG_KIND[x.kind]) continue;
      if (x.kind === 'eleccion' && /sigue al frente/.test(x.text)) continue;
      recordHist(w, { day: x.day, kind: LOG_KIND[x.kind], regionId: x.regionId, text: x.text, importance: x.kind === 'guerra' || x.kind === 'gobierno' || x.kind === 'frontera' ? 3 : 2, fame: 0.45, witnessed: x.regionId === w.player.home || life.visited[x.regionId] !== undefined });
    }
    g.logMark = Math.max(g.logMark, ...pol.log.map((x) => x.day), g.logMark);
    for (const l of pol.legacy) {
      if ((l as { archived?: boolean }).archived) continue;
      (l as { archived?: boolean }).archived = true;
      recordHist(w, { day: l.day, kind: l.kind === 'tratado' || l.kind === 'paz' ? 'paz' : l.kind === 'organizacion' ? 'fundacion' : l.kind === 'ley' ? 'ley' : l.kind === 'cargo' || l.kind === 'gobierno' ? 'gobierno' : 'hazana', regionId: l.regionId, text: l.text.replace(/^Logró/, `${l.by} logró`).replace(/^Fundó/, `${l.by} fundó`), actor: l.by, gen: l.gen, importance: l.kind === 'derrota' || l.kind === 'traicion' ? 1 : 2, fame: l.kind === 'paz' || l.kind === 'gobierno' ? 0.7 : 0.5, witnessed: true });
    }
  }
}

// ---------------------------------------------------------------------------
// La historia se deforma
// ---------------------------------------------------------------------------
export type Telling = 'hecho' | 'recuerdo' | 'leyenda' | 'mito' | 'olvidado';
export const TELLING_NAME: Record<Telling, string> = { hecho: 'hecho', recuerdo: 'recuerdo', leyenda: 'leyenda', mito: 'mito', olvidado: 'verdad olvidada' };

export function tellingOf(w: WorldState, e: HistEvent): Telling {
  const years = (w.day - e.day) / DAYS_PER_YEAR;
  if (e.fame < 0.12 && years > 8) return 'olvidado';
  if (years < 3) return 'hecho';
  if (years < 12 || e.fame < 0.3) return 'recuerdo';
  if (years < 35 || e.fame < 0.55) return 'leyenda';
  return 'mito';
}

/** Cómo se cuenta hoy lo que pasó (la verdad, exagerada con los años). */
export function retell(w: WorldState, e: HistEvent): string {
  const t = tellingOf(w, e);
  if (t === 'hecho') return e.text;
  const R = w.regions[e.regionId]?.name ?? 'estas tierras';
  const who = e.actor ? epithet(w, e, t) : 'la gente de entonces';
  const big: Partial<Record<HistKind, [string, string, string]>> = {
    crisis: [`${who} ayudó a ${R} cuando faltó de todo.`, `${who} salvó a ${R} del hambre.`, `${who} hizo brotar trigo en la tierra seca de ${R}.`],
    hazana: [`${who} ayudó a la gente de ${R}.`, `${who} salvó a ${R}.`, `${who} derrotó a un ejército entero para salvar ${R}.`],
    paz: [`${who} negoció la paz.`, `${who} acabó con la guerra con una sola palabra.`, `${who} hizo que los reyes de todas las tierras se arrodillaran ante la paz.`],
    tratado: [`Se firmó un tratado en ${R}.`, `${who} unió a los pueblos con un pacto.`, `${who} selló con sangre la unión de los pueblos.`],
    guerra: [`Hubo guerra en ${R}.`, `La gran guerra de ${R} duró años.`, `En ${R} se libró la guerra que casi acaba con el mundo.`],
    fundacion: [`${who} fundó algo en ${R}.`, `${who} fundó ${R}.`, `${who} levantó ${R} con sus propias manos.`],
    negocio: [`${who} abrió un negocio en ${R}.`, `${who} hizo rica a ${R} con su comercio.`, `${who} trajo el oro a ${R}.`],
    ley: [`${who} cambió las leyes de ${R}.`, `${who} dio a ${R} sus leyes.`, `${who} escribió la ley que aún hoy nos gobierna.`],
    gobierno: [`Cambió el gobierno de ${R}.`, `${who} gobernó ${R} con mano firme.`, `${who} fue el primer soberano de ${R}.`],
    muerte: [`${e.text}`, `${who} murió, y con su muerte cambió todo.`, `Dicen que ${who} no murió: se fue al monte y volverá.`],
    llegada: [`Un desconocido llegó a ${R} sin recordar quién era.`, `${who} llegó de ninguna parte.`, `${who} cayó del cielo junto al camino de ${R}.`],
    rebelion: [`Hubo una revuelta en ${R}.`, `El pueblo de ${R} se alzó contra sus amos.`, `El día en que ${R} se liberó para siempre.`],
    frontera: [`Cambiaron las fronteras de ${R}.`, `${R} conquistó tierras ajenas.`, `${R} fue, una vez, dueña de todas las tierras.`],
  };
  const v = big[e.kind];
  if (!v) return t === 'olvidado' ? `Algo pasó en ${R}, hace mucho. Ya nadie recuerda bien qué.` : e.text;
  if (t === 'olvidado') return `Algo pasó en ${R} hace mucho. Ya nadie recuerda bien qué.`;
  return v[t === 'recuerdo' ? 0 : t === 'leyenda' ? 1 : 2];
}

function epithet(w: WorldState, e: HistEvent, t: Telling): string {
  if (t === 'recuerdo') return e.actor!;
  const first = e.gen === 1 && e.actor !== undefined;
  if (t === 'leyenda') return first ? `${e.actor}, el forastero sin memoria` : `${e.actor} el Grande`;
  return first ? 'el que vino de ninguna parte' : 'un héroe antiguo';
}

/** Con qué palabras se presenta (información imperfecta). */
export function hedge(w: WorldState, e: HistEvent, source: 'gente' | 'registros' = 'gente'): string {
  const t = tellingOf(w, e);
  if (source === 'registros') return e.witnessed && t === 'hecho' ? '' : t === 'olvidado' || t === 'mito' ? 'Los registros apenas dicen: ' : 'Según los registros, ';
  if (e.witnessed && t === 'hecho') return '';
  return t === 'recuerdo' ? 'Se cuenta que ' : t === 'leyenda' ? 'Dicen los viejos que ' : t === 'mito' ? 'Según la leyenda, ' : 'Algunos creen que ';
}

function seedRumorSafe(w: WorldState, regionId: number, text: string): void {
  const people = w.life!.folk.filter((f) => f.alive && f.regionId === regionId).slice(0, 6).map((f) => f.id);
  if (people.length) seedRumor(w, { regionId, kind: 'historia', subject: people[0], witnesses: people, versions: [text], tone: 0.3, heat: 0.6 });
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const told = (w: WorldState, e: HistEvent, src: 'gente' | 'registros' = 'gente') => {
  const h = hedge(w, e, src);
  const text = src === 'registros' && tellingOf(w, e) !== 'olvidado' ? e.text : retell(w, e);
  return h ? `${h}${lower(text)}` : text;
};

/** Cada año: la fama se apaga o se aviva; las hazañas muy recordadas tienen monumento y fiesta. */
export function historyYear(w: WorldState): string[] {
  const g = gensOf(w);
  const out: string[] = [];
  for (const e of g.history) {
    e.fame = clamp(e.fame * (e.monument || e.feast ? 0.99 : 0.94));
    if (!e.monument && e.gen !== undefined && e.importance >= 2 && e.fame >= 0.6 && (e.kind === 'paz' || e.kind === 'crisis' || e.kind === 'hazana' || e.kind === 'fundacion' || e.kind === 'gobierno')) {
      const t = w.life!.towns[e.regionId];
      const grateful = (w.life!.identity!.score[e.regionId] ?? 0) > 15;
      if (t && grateful) {
        e.monument = true;
        e.feast = e.kind === 'paz' || e.kind === 'crisis';
        ((t as typeof t & { monuments?: string[] }).monuments ??= []).push(e.id);
        const text = `En la plaza de ${w.regions[e.regionId].name} levantan una piedra en memoria de ${e.actor ?? 'quienes lo hicieron posible'}.`;
        logEvent(w, e.regionId, 'pueblo', text, []);
        recordHist(w, { kind: 'pueblo', regionId: e.regionId, text, importance: 2, fame: 0.4, witnessed: true });
        out.push(text);
      }
    }
  }
  // Las fiestas en recuerdo: el aniversario se celebra (y la historia se vuelve a contar).
  for (const e of g.history.filter((x) => x.feast && (w.day - x.day) % DAYS_PER_YEAR === 0 && x.day !== w.day)) {
    e.fame = clamp(e.fame + 0.03);
    logEvent(w, e.regionId, 'fiesta', `${w.regions[e.regionId].name} celebra el día en que ${lower(retell(w, e)).replace(/\.$/, '')}.`, []);
    seedRumorSafe(w, e.regionId, retell(w, e));
  }
  return out;
}

/** Lo que cuenta un viejo del pueblo (la historia según la gente). */
export function legendFor(w: WorldState, f: Folk): string | null {
  const g = gensOf(w);
  const local = g.history.filter((e) => e.regionId === f.regionId && e.importance >= 2 && tellingOf(w, e) !== 'hecho' && tellingOf(w, e) !== 'olvidado');
  if (!local.length || f.age < 45) return null;
  const e = local.sort((a, b) => b.fame - a.fame)[(f.age + w.day) % Math.min(3, local.length)];
  e.fame = clamp(e.fame + 0.01);
  return told(w, e);
}

/** Los registros del templo: más fieles que la gente, pero incompletos. */
export function templeRecords(w: WorldState, regionId: number): string[] {
  const g = gensOf(w);
  const list = g.history.filter((e) => e.regionId === regionId || (e.importance === 3 && e.fame > 0.4)).sort((a, b) => a.day - b.day).slice(-8);
  if (!list.length) return ['Los registros están en blanco: aquí aún no ha pasado nada que merezca escribirse.'];
  return list.map((e) => `Año ${yearOfDay(e.day)}. ${told(w, e, 'registros')}`);
}

export const yearOfDay = (day: number) => Math.floor((day - 1) / DAYS_PER_YEAR) + 1;

/** La línea temporal: lo que se sabe, año por año. */
export function timeline(w: WorldState): { year: number; lines: string[] }[] {
  const g = gensOf(w);
  const byYear = new Map<number, string[]>();
  for (const e of [...g.history].sort((a, b) => a.day - b.day)) {
    if (!e.witnessed && e.fame < 0.3 && e.importance < 3) continue;
    const y = yearOfDay(e.day);
    (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(told(w, e));
  }
  return [...byYear.entries()].map(([year, lines]) => ({ year, lines }));
}

/** La crónica del mundo por temas (lo que el mundo conoce). */
export function worldChronicle(w: WorldState): Record<'guerras' | 'gobiernos' | 'pueblos' | 'familias' | 'descubrimientos', string[]> {
  const g = gensOf(w);
  const pick = (kinds: HistKind[]) => g.history.filter((e) => kinds.includes(e.kind) && (e.witnessed || e.fame >= 0.25)).sort((a, b) => a.day - b.day).slice(-10).map((e) => `Año ${yearOfDay(e.day)}: ${told(w, e)}`);
  return {
    guerras: pick(['guerra', 'paz', 'frontera', 'rebelion']),
    gobiernos: pick(['gobierno', 'ley', 'tratado']),
    pueblos: pick(['pueblo', 'crisis', 'fundacion']),
    familias: housesLines(w),
    descubrimientos: pick(['descubrimiento']),
  };
}

// ---------------------------------------------------------------------------
// Familias del mundo: casas que suben, mandan, comercian y caen
// ---------------------------------------------------------------------------
/** Cada año: las casas del mundo (de los vecinos y la del jugador) ganan o pierden poder. */
export function housesYear(w: WorldState): string[] {
  const life = w.life!;
  const g = gensOf(w);
  const out: string[] = [];
  // Quien no tiene casa la recibe de sus padres, o funda una (las parejas).
  for (const f of life.folk) {
    if (!f.alive || f.houseId) continue;
    const parent = f.parentId ? folkById(w, f.parentId) : undefined;
    if (parent?.houseId) f.houseId = parent.houseId;
    else if (f.age >= 25) {
      const h: House = { id: gid(w, 'c'), name: `los de ${f.name}`, regionId: f.regionId, founded: w.day, founder: f.name, power: 0, peak: 0, trade: f.role };
      g.houses.push(h);
      f.houseId = h.id;
    }
  }
  const pol = life.politics;
  const power = new Map<string, { v: number; n: number; roles: Record<string, number> }>();
  for (const f of life.folk) {
    if (!f.alive || !f.houseId) continue;
    const x = power.get(f.houseId) ?? { v: 0, n: 0, roles: {} };
    x.n++;
    x.v += (f.p?.coins ?? 0) / 150;
    x.roles[f.role] = (x.roles[f.role] ?? 0) + 1;
    if (pol?.govs[f.regionId]?.ruler === f.id) x.v += 0.35;
    if (pol?.orgs.some((o) => o.leader === f.id && !o.dissolved)) x.v += 0.12;
    power.set(f.houseId, x);
  }
  // El poder de cada casa, comparado con las demás (la más fuerte del mundo = 1).
  const raw = (x: { v: number; n: number } | undefined) => (x ? x.v + x.n / 25 : 0);
  const top = Math.max(0.05, ...[...power.values()].map(raw));
  for (const h of g.houses) {
    const x = power.get(h.id);
    const before = h.power;
    h.power = clamp(raw(x) / top);
    if (x) h.trade = Object.entries(x.roles).filter(([r]) => r !== 'nino' && r !== 'anciano').sort((a, b) => b[1] - a[1])[0]?.[0] ?? h.trade;
    if (h.power > h.peak) h.peak = h.power;
    if (!x && !h.fallen && h.peak > 0.15) {
      h.fallen = w.day;
      recordHist(w, { kind: 'familia', regionId: h.regionId, text: `Se extingue la casa de ${h.name.replace(/^los de /, '')}.`, importance: 1, fame: 0.25, witnessed: false });
    } else if (x && !h.fallen && h.peak >= 0.45 && h.power < h.peak * 0.4 && before >= h.peak * 0.4) {
      recordHist(w, { kind: 'familia', regionId: h.regionId, text: `La casa de ${h.name.replace(/^los de /, '')} pierde el poder que tuvo.`, importance: 2, fame: 0.35, witnessed: life.visited[h.regionId] !== undefined });
    }
  }
  // La casa más poderosa de cada pueblo (si cambia, se nota).
  for (const r of w.regions) {
    const top = g.houses.filter((h) => h.regionId === r.id && !h.fallen).sort((a, b) => b.power - a.power)[0];
    const key = `top:${r.id}`;
    const prev = (g as typeof g & { tops?: Record<string, string> }).tops?.[key];
    if (top && top.power > 0.3 && prev !== top.id) {
      ((g as typeof g & { tops?: Record<string, string> }).tops ??= {})[key] = top.id;
      if (prev) {
        const text = `En ${r.name}, ${top.name} pasan a ser la familia más poderosa.`;
        recordHist(w, { kind: 'familia', regionId: r.id, text, importance: 1, fame: 0.3, witnessed: life.visited[r.id] !== undefined });
        out.push(text);
      }
    }
  }
  return out;
}

const TRADE_WORD: Record<string, string> = {
  comerciante: 'comerciantes', posadero: 'posaderos', campesino: 'gente del campo', pastor: 'gente del campo', pescador: 'gente del mar', guardia: 'gente de armas',
  artesano: 'herreros', carpintero: 'artesanos', tejedor: 'artesanos', minero: 'mineros', lenador: 'leñadores', lider: 'gente de gobierno', sanadora: 'sanadoras', exploradora: 'exploradores',
};

export function housesLines(w: WorldState): string[] {
  const g = gensOf(w);
  const dyn = g.dynasty;
  const out: string[] = [];
  if (dyn.name) {
    const last = dyn.power[dyn.power.length - 1]?.value ?? 0;
    const peak = Math.max(0, ...dyn.power.map((p) => p.value));
    out.push(`${dyn.name.charAt(0).toUpperCase()}${dyn.name.slice(1)}: ${dyn.members.length + 1} generaciones${peak > 0.5 && last < peak * 0.5 ? '; tuvo más poder del que tiene' : last >= peak * 0.9 && peak > 0.4 ? '; en lo más alto' : ''}.`);
  }
  for (const h of [...g.houses].filter((x) => !x.fallen).sort((a, b) => b.power - a.power).slice(0, 6)) out.push(`${h.name.charAt(0).toUpperCase() + h.name.slice(1)} (${w.regions[h.regionId].name}): ${h.power > 0.75 ? 'de las familias más poderosas' : h.power > 0.4 ? 'gente con peso' : 'una familia más'}; ${TRADE_WORD[h.trade] ?? 'de oficios varios'}.`);
  for (const h of g.houses.filter((x) => x.fallen).slice(-3)) out.push(`${h.name.charAt(0).toUpperCase() + h.name.slice(1)}: ya no queda nadie.`);
  return out;
}
