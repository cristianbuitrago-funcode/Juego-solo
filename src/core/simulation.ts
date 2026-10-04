import { runScheduled } from './effects';
import './actions'; // registra los manejadores de misiones y consecuencias
import { distillLegacy } from './legacy';
import { tickCharacters } from './systems/characters';
import { tickClues } from './systems/clues';
import { tickConflict } from './systems/conflict';
import { tickEconomy } from './systems/economy';
import { tickEcology } from './systems/ecology';
import { tickHypotheses } from './systems/hypotheses';
import { tickMystery } from './systems/mystery';
import { tickObjectives } from './systems/objectives';
import { tickNeglect } from './systems/patterns';
import './systems/petitions';
import { tickPetitions } from './systems/petitions';
import { computeMood, tickPlayer } from './systems/player';
import { tickRelations } from './systems/relations';
import { tickRumors } from './systems/rumors';
import { tickTech } from './systems/tech';
import type { Clue, Entry, Mood, Rumor, WorldState } from './types';
import { record } from './chronicle';
import { commitCtx, makeCtx, type Ctx } from './world';

/**
 * Bucle principal: AVANZAR DÍA. El orden importa: primero llegan las
 * consecuencias retardadas, luego el mundo actúa por su cuenta y por último
 * se genera lo que el jugador llega a percibir (pistas, rumores, peticiones).
 *
 * Para añadir una regla nueva, registra un sistema con `registerSystem`.
 */
export type System = (ctx: Ctx) => void;

const SYSTEMS: { name: string; run: System }[] = [
  { name: 'consecuencias', run: runScheduled },
  { name: 'economía', run: tickEconomy },
  { name: 'ecología', run: tickEcology },
  { name: 'tecnología', run: tickTech },
  { name: 'relaciones', run: tickRelations },
  { name: 'conflicto', run: tickConflict },
  { name: 'misterio', run: tickMystery },
  { name: 'personajes', run: tickCharacters },
  { name: 'abandono', run: tickNeglect },
  { name: 'rumores', run: tickRumors },
  { name: 'pistas', run: tickClues },
  { name: 'peticiones', run: tickPetitions },
  { name: 'jugador', run: tickPlayer },
  { name: 'hipótesis', run: tickHypotheses },
  { name: 'objetivos', run: tickObjectives },
];

export function registerSystem(name: string, run: System, before?: string): void {
  const idx = before ? SYSTEMS.findIndex((s) => s.name === before) : -1;
  if (idx >= 0) SYSTEMS.splice(idx, 0, { name, run });
  else SYSTEMS.push({ name, run });
}

export interface DayReport {
  day: number;
  entries: Entry[]; // conocidas por el jugador
  clues: Clue[];
  rumors: Rumor[];
  newPetitions: number;
  mood: Mood;
  ended: boolean;
}

export function advanceDay(w: WorldState): DayReport {
  if (w.ended) return { day: w.day, entries: [], clues: [], rumors: [], newPetitions: 0, mood: w.mood, ended: true };
  const ctx = makeCtx(w);
  const knownRumors = new Set(w.rumors.filter((r) => r.known).map((r) => r.id));
  const petitionsBefore = new Set(w.petitions.map((p) => p.id));
  const knownBefore = new Set(w.entries.filter((e) => e.known).map((e) => e.id));
  w.day++;
  for (const s of SYSTEMS) s.run(ctx);
  w.mood = computeMood(ctx);
  checkEnd(ctx);
  commitCtx(ctx);
  return {
    day: w.day,
    // Lo nuevo que sabes hoy: entradas creadas hoy o reveladas hoy.
    entries: w.entries.filter((e) => e.known && !knownBefore.has(e.id)),
    clues: w.clues.filter((c) => c.day === w.day),
    rumors: w.rumors.filter((r) => r.known && !knownRumors.has(r.id)),
    newPetitions: w.petitions.filter((p) => !petitionsBefore.has(p.id)).length,
    mood: w.mood,
    ended: w.ended,
  };
}

/** Título final según cómo jugaste: el mundo te recordará así. */
export function eraTitle(w: WorldState): string {
  const p = w.player.patterns;
  const top = (Object.entries(p) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 2) return 'El Testigo Silencioso';
  const titles: Record<string, string> = {
    ayuda: 'La Mano Generosa',
    fuerza: 'La Mano de Hierro',
    dialogo: 'El Mediador',
    engano: 'El Tejedor de Rumores',
    informacion: 'El Portador de Verdades',
    comercio: 'El Señor de los Caminos',
    abandono: 'El Ausente',
  };
  return titles[top[0]] ?? 'El Viajero';
}

function checkEnd(ctx: Ctx): void {
  const { w } = ctx;
  if (w.player.cohesion <= 0.05) {
    w.ended = true;
    w.outcome = 'colapso';
    record(ctx, { kind: 'evento', text: 'Tu gente se dispersa. Ya no queda una civilización que guiar.', regions: [w.player.home], known: true, importance: 3 });
  } else if (w.day >= w.eraLength) {
    w.ended = true;
    w.outcome = 'era';
    record(ctx, { kind: 'evento', text: 'Termina una era. El mundo seguirá recordando lo que hiciste.', regions: [w.player.home], known: true, importance: 3 });
  }
  if (w.ended) distillLegacy(w, eraTitle(w));
}

/** Permite seguir jugando después del final de la era. */
export function continueEra(w: WorldState, extraDays = 30): void {
  if (w.outcome !== 'era') return;
  w.ended = false;
  w.eraLength += extraDays;
}
