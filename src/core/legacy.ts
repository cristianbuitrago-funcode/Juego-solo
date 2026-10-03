import type { WorldState } from './types';
import { storage } from './storage';

/**
 * Legado entre partidas: el mundo recuerda incluso cuando empiezas de nuevo.
 * Los agravios y favores se guardan por cultura, y como las culturas se
 * repiten entre partidas, reaparecen como viejas canciones y rencores.
 */
export interface Legacy {
  games: number;
  grudges: { a: string; b: string; strength: number; text: string }[];
  favors: { culture: string; strength: number; text: string }[];
  wrongs: { culture: string; strength: number; text: string }[];
  titles: string[];
}

const KEY = 'ecos_legado_v1';

export function loadLegacy(): Legacy {
  try {
    const raw = storage.get(KEY);
    if (raw) return JSON.parse(raw) as Legacy;
  } catch {
    /* legado corrupto: empezar limpio */
  }
  return { games: 0, grudges: [], favors: [], wrongs: [], titles: [] };
}

export function saveLegacy(l: Legacy): void {
  storage.set(KEY, JSON.stringify(l));
}

/** Al terminar una era, se destilan los recuerdos que sobrevivirán. */
export function distillLegacy(w: WorldState, title: string): Legacy {
  const l = loadLegacy();
  l.games++;
  l.titles = [...l.titles, title].slice(-10);
  const cultureOf = (id: number) => w.regions[id].culture;
  // Guerras que el jugador provocó o en las que intervino.
  for (const e of w.entries) {
    if (e.kind !== 'conflicto' || !e.text.startsWith('Estalla')) continue;
    if (e.regions.length < 2) continue;
    const root = rootOfEntry(w, e.causeId);
    const provoked = root?.byPlayer;
    const a = cultureOf(e.regions[0]);
    const b = cultureOf(e.regions[1]);
    if (a === b) continue;
    l.grudges.push({ a, b, strength: provoked ? 0.5 : 0.3, text: provoked ? 'un extranjero enfrentó a nuestros pueblos' : 'hubo guerra entre nuestros pueblos' });
  }
  for (const r of w.regions) {
    if (r.isHome) continue;
    if (r.attitude.gratitude > 0.6) l.favors.push({ culture: r.culture, strength: r.attitude.gratitude * 0.4, text: 'alguien como tú nos ayudó cuando nadie lo hizo' });
    if (r.attitude.resentment > 0.6) l.wrongs.push({ culture: r.culture, strength: r.attitude.resentment * 0.4, text: 'alguien como tú nos traicionó' });
  }
  // Solo los recuerdos más fuertes perduran.
  l.grudges = l.grudges.sort((x, y) => y.strength - x.strength).slice(0, 8);
  l.favors = l.favors.sort((x, y) => y.strength - x.strength).slice(0, 6);
  l.wrongs = l.wrongs.sort((x, y) => y.strength - x.strength).slice(0, 6);
  saveLegacy(l);
  return l;
}

function rootOfEntry(w: WorldState, id?: string) {
  let cur = w.entries.find((e) => e.id === id);
  let guard = 0;
  while (cur?.causeId && guard++ < 50) {
    const p = w.entries.find((e) => e.id === cur!.causeId);
    if (!p) break;
    cur = p;
  }
  return cur;
}
