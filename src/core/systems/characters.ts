import { MEMORY_LINES, MOOD_LINES } from '../content/dialogue';
import { personName } from '../content/names';
import { RESOURCES } from '../content/resources';
import { ROLES } from '../content/roles';
import { record } from '../chronicle';
import { hearsay } from '../intel';
import type { Character, Emotions, EntryId, Memory, RegionId, WorldState } from '../types';
import { clamp, fill } from '../util';
import { charactersOf, rootOf, type Ctx } from '../world';

/**
 * Personajes con memoria. Cada recuerdo modifica sus emociones al crearse y
 * sigue influyendo en lo que dicen y en cómo reacciona su región.
 */

const MAX_MEMORIES = 14;

/** Cómo afecta cada tipo de recuerdo a las emociones (por unidad de peso). */
const EMOTION_IMPACT: Record<string, Partial<Emotions>> = {
  ayuda: { gratitude: 0.35, trust: 0.2 },
  ayudaRepetida: { gratitude: 0.05 },
  negada: { resentment: 0.2, trust: -0.15 },
  quitar: { resentment: 0.4, trust: -0.25 },
  muerte: { resentment: 0.5, fear: 0.2, trust: -0.3 },
  fuerza: { fear: 0.4, resentment: 0.3, trust: -0.2 },
  mediacion: { trust: 0.25, gratitude: 0.15 },
  mediacionFallida: { trust: -0.05 },
  rutaCerrada: { resentment: 0.2, trust: -0.1 },
  rutaAbierta: { trust: 0.1, gratitude: 0.1 },
  verdad: { trust: 0.25 },
  mentira: { trust: -0.4, resentment: 0.25 },
  espia: { trust: -0.25, fear: 0.1 },
  sabotaje: { resentment: 0.5, fear: 0.2, trust: -0.35 },
  abandono: { trust: -0.2, resentment: 0.1 },
  favor: { gratitude: 0.15, trust: 0.1 },
  guerra: { fear: 0.25, resentment: 0.1 },
  alianza: { trust: 0.2, gratitude: 0.15 },
  alianzaRota: { resentment: 0.35, trust: -0.25 },
  invento: { ambition: 0.15 },
  robo: { resentment: 0.15 },
  refugio: { gratitude: 0.45, trust: 0.25 },
  rechazo: { resentment: 0.3, trust: -0.2 },
  prohibicion: { resentment: 0.25, trust: -0.1 },
  rumor: { fear: 0.1, curiosity: 0.1 },
};

export function addMemory(c: Character, m: Memory): void {
  c.memories.push(m);
  const impact = EMOTION_IMPACT[m.kind];
  if (impact) {
    const k = Math.min(1, Math.abs(m.weight) + 0.5);
    for (const [emo, v] of Object.entries(impact) as [keyof Emotions, number][]) c.emotions[emo] = clamp(c.emotions[emo] + v * k);
  }
  if (c.memories.length > MAX_MEMORIES) {
    // Se olvidan primero los recuerdos débiles y antiguos.
    c.memories.sort((a, b) => Math.abs(b.weight) * 10 + b.day * 0.05 - (Math.abs(a.weight) * 10 + a.day * 0.05));
    c.memories.length = MAX_MEMORIES;
    c.memories.sort((a, b) => a.day - b.day);
  }
}

/** Añade un recuerdo a todos los personajes de una región. */
export function regionRemembers(ctx: Ctx, regionId: RegionId, kind: string, weight: number, entryId?: EntryId, vars?: Record<string, string>, about: Memory['about'] = 'jugador'): void {
  for (const c of charactersOf(ctx.w, regionId)) addMemory(c, { day: ctx.w.day, kind, weight, about, entryId, vars });
}

export function dominantEmotion(c: Character): keyof Emotions | 'neutral' {
  let best: keyof Emotions | 'neutral' = 'neutral';
  let bv = 0.45;
  for (const [k, v] of Object.entries(c.emotions) as [keyof Emotions, number][]) if (v > bv) (bv = v), (best = k);
  return best;
}

/** Lo que dice un personaje cuando hablas con él: saludo, recuerdos y preocupación actual. */
export function speak(ctx: Ctx, c: Character): string[] {
  const { w, rng } = ctx;
  const r = w.regions[c.regionId];
  const lines: string[] = [];
  const mood = dominantEmotion(c);
  lines.push(fill(rng.pick(MOOD_LINES[mood]), { R: r.name }));

  // Recuerdos más intensos y recientes, sin repetir el mismo tipo.
  const ranked = [...c.memories].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) + (b.day - a.day) * 0.01);
  const said = new Set<string>();
  for (const m of ranked) {
    if (said.has(m.kind) || said.size >= 2) continue;
    const tpl = MEMORY_LINES[m.kind];
    if (!tpl) continue;
    said.add(m.kind);
    const other = typeof m.about === 'number' ? w.regions[m.about]?.name : undefined;
    lines.push(fill(rng.pick(tpl), { d: w.day - m.day, R: r.name, X: m.vars?.X ?? other ?? 'los vecinos', rel: c.relative, res: RESOURCES[r.resource].name }));
  }

  // Preocupación actual. Un personaje resentido o ambicioso puede mentir.
  const lies = c.emotions.resentment > 0.65 || (c.emotions.ambition > 0.75 && r.dependency > 0.4);
  const concern = currentConcern(w, c, lies);
  if (concern) lines.push(concern);
  // Hablar deja información de oídas sobre su región (posiblemente sesgada).
  hearsay(ctx, r, 'alimento', lies ? 0.7 : 0.2);
  hearsay(ctx, r, 'animo', lies ? 0.6 : 0.25);
  c.known = true;
  c.lastSpoke = w.day;
  return lines;
}

function currentConcern(w: WorldState, c: Character, lies: boolean): string | undefined {
  const r = w.regions[c.regionId];
  const hungry = r.food < 5;
  if (lies && !hungry) return 'Nuestros graneros están vacíos. Necesitamos tu ayuda cuanto antes.';
  if (lies && hungry) return 'Estamos bien. No necesitamos nada de ti.';
  if (r.flags.guerra) return 'La guerra lo devora todo. Cada día hay menos manos en los campos.';
  if (hungry) return 'La comida escasea. Los niños lo notan antes que nadie.';
  if (r.flags.fiebre) return 'La fiebre se extiende. Nadie sabe de dónde viene.';
  if (r.flags.aislada) return 'Desde que los caminos se cerraron, estamos solos.';
  const worst = Object.entries(r.relations).filter(([id]) => !w.regions[Number(id)].isHome).sort((a, b) => a[1].opinion - b[1].opinion)[0];
  if (worst && worst[1].tension > 0.45) return `No confío en ${w.regions[Number(worst[0])].name}. Algo traman.`;
  if (r.research && c.emotions.trust > 0.5) return 'Trabajamos en algo nuevo. Pronto lo verás.';
  if (c.role === 'mercader') return 'Los caminos son la sangre del mundo. Cuídalos.';
  if (c.role === 'anciana') return 'Todo lo que hagas quedará en la memoria de este valle.';
  return undefined;
}

/** Deriva diaria: las emociones se calman lentamente; los recuerdos fuertes no. */
export function tickCharacters(ctx: Ctx): void {
  const { w } = ctx;
  for (const c of w.characters) {
    if (!c.alive) continue;
    const r = w.regions[c.regionId];
    const strongPos = c.memories.filter((m) => m.about === 'jugador' && m.weight > 0.5).length;
    const strongNeg = c.memories.filter((m) => m.about === 'jugador' && m.weight < -0.5).length;
    c.emotions.resentment = clamp(c.emotions.resentment - 0.004 + strongNeg * 0.002);
    c.emotions.gratitude = clamp(c.emotions.gratitude - 0.004 + strongPos * 0.002);
    c.emotions.fear = clamp(c.emotions.fear + (r.flags.guerra ? 0.01 : -0.006));
    c.emotions.trust = clamp(c.emotions.trust + (r.attitude.trust - c.emotions.trust) * 0.03);
    // La región adopta lentamente el sentir de sus personajes (sobre todo el líder).
    const k = c.role === 'lider' ? 0.03 : 0.012;
    r.attitude.trust = clamp(r.attitude.trust + (c.emotions.trust - r.attitude.trust) * k);
    r.attitude.resentment = clamp(r.attitude.resentment + (c.emotions.resentment - r.attitude.resentment) * k);
    r.attitude.gratitude = clamp(r.attitude.gratitude + (c.emotions.gratitude - r.attitude.gratitude) * k);
    r.attitude.fear = clamp(r.attitude.fear + (c.emotions.fear - r.attitude.fear) * k);
  }
}

/**
 * Muerte de un personaje. Si la cadena causal empezó en una decisión del
 * jugador, sus allegados lo recordarán como responsable.
 */
export function killCharacter(ctx: Ctx, regionId: RegionId, causeId: EntryId | undefined, how: string): Character | undefined {
  const { w, rng } = ctx;
  const pool = charactersOf(w, regionId);
  if (!pool.length) return undefined;
  const victim = rng.pick(pool);
  // A veces no muere el personaje sino su familiar: el personaje lo recuerda.
  if (rng.chance(0.6)) {
    const root = rootOf(w, causeId);
    const blame = root?.byPlayer ? 'jugador' : regionId;
    addMemory(victim, { day: w.day, kind: 'muerte', weight: root?.byPlayer ? -0.9 : -0.6, about: blame, entryId: causeId });
    record(ctx, { kind: 'personaje', text: `${victim.name} de ${w.regions[regionId].name} perdió a ${victim.relative.replace('mi ', 'su ')} ${how}.`, regions: [regionId], causeId, importance: 2 });
    return undefined;
  }
  victim.alive = false;
  const e = record(ctx, { kind: 'personaje', text: `${victim.name}, ${ROLES[victim.role].title} de ${w.regions[regionId].name}, murió ${how}.`, regions: [regionId], causeId, importance: 3 });
  for (const c of charactersOf(w, regionId)) addMemory(c, { day: w.day, kind: 'muerte', weight: -0.6, about: rootOf(w, causeId)?.byPlayer ? 'jugador' : regionId, entryId: e.id, vars: {} });
  if (victim.role === 'lider') succeed(ctx, regionId, victim, e.id);
  return victim;
}

/** Un nuevo líder hereda parte de la memoria del anterior. */
function succeed(ctx: Ctx, regionId: RegionId, old: Character, causeId: EntryId): void {
  const { w, rng } = ctx;
  const culture = w.cultures.find((c) => c.id === w.regions[regionId].culture);
  const name = personName(rng, culture?.syllables ?? ['a', 'ne', 'ro'], new Set(w.characters.map((c) => c.name)));
  const heir: Character = {
    id: `c${w.characters.length + 1}`,
    name,
    role: 'lider',
    regionId,
    alive: true,
    known: old.known,
    emotions: { ...old.emotions, ambition: clamp(rng.range(0.2, 0.8)) },
    memories: old.memories.filter((m) => Math.abs(m.weight) > 0.4).slice(-6),
    relative: rng.pick(['mi hermano', 'mi hermana', 'mi tío', 'mi tía']),
    lastSpoke: -99,
  };
  w.characters.push(heir);
  record(ctx, { kind: 'personaje', text: `${name} toma el mando en ${w.regions[regionId].name}. Hereda los recuerdos de ${old.name}.`, regions: [regionId], causeId, importance: 2 });
}
