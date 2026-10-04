import { personName } from '../core/content/names';
import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import type { Rng } from '../core/rng';
import type { Character, WorldState } from '../core/types';
import { clamp } from '../core/util';
import type { Folk, FolkMemory, FolkRole, Life } from './types';

/**
 * Vecinos: la gente corriente del mundo. Tienen edad, familia, una casa,
 * un oficio, una rutina y memoria. No todos reaccionan igual ante lo mismo.
 */
const ROLE_OF_CHARACTER: Record<string, FolkRole> = {
  lider: 'lider', mercader: 'comerciante', anciana: 'anciano', poeta: 'anciano',
  exploradora: 'exploradora', sanadora: 'sanadora', herrero: 'artesano',
};

export const ROLE_TITLE: Record<FolkRole, string> = {
  campesino: 'campesino', pescador: 'pescador', pastor: 'pastora', comerciante: 'comerciante', guardia: 'guardia',
  artesano: 'artesano', nino: 'niño', anciano: 'anciano', lider: 'líder', sanadora: 'sanadora', exploradora: 'exploradora',
};

function rolesFor(resource: string): FolkRole[] {
  switch (resource) {
    case 'pesca':
      return ['pescador', 'pescador', 'campesino'];
    case 'lana':
      return ['pastor', 'pastor', 'campesino'];
    case 'hierro':
      return ['artesano', 'artesano', 'campesino'];
    case 'sal':
    case 'arcilla':
      return ['artesano', 'campesino', 'pescador'];
    default:
      return ['campesino', 'campesino', 'pastor'];
  }
}

export function folkTarget(population: number, isHome: boolean): number {
  return isHome ? 12 : Math.max(7, Math.min(20, Math.round(population / 65)));
}

export function makeFolk(life: Life, w: WorldState, rng: Rng, regionId: number, role: FolkRole, age: number, used: Set<string>, extra: Partial<Folk> = {}): Folk {
  const r = w.regions[regionId];
  const culture = r.isHome ? PLAYER_CULTURE : (CULTURES.find((c) => c.id === r.culture) ?? PLAYER_CULTURE);
  const f: Folk = {
    id: `v${++life.seq}`,
    name: personName(rng, culture.syllables, used),
    regionId,
    role,
    age,
    born: w.day - (age % 20),
    house: 0,
    alive: true,
    trust: clamp(r.attitude.trust + rng.range(-0.15, 0.15)),
    fear: clamp(r.attitude.fear + rng.range(0, 0.1)),
    gratitude: 0.1,
    resentment: clamp(r.attitude.resentment + rng.range(0, 0.1)),
    honesty: rng.range(0.55, 1),
    memories: [],
    lastMet: -1,
    ...extra,
  };
  return f;
}

/** Crea los vecinos iniciales de cada región (y enlaza a los personajes con nombre). */
export function populate(life: Life, w: WorldState, rng: Rng, houseCount: (regionId: number) => number): void {
  const used = new Set(w.characters.map((c) => c.name));
  for (const r of w.regions) {
    const pool = rolesFor(r.resource);
    // Personajes del motor.
    for (const c of w.characters.filter((x) => x.regionId === r.id && x.alive)) linkCharacter(life, w, c, rng);
    const n = folkTarget(r.population, r.isHome);
    const roles: FolkRole[] = ['comerciante', 'guardia', 'nino', ...(r.isHome ? (['anciano', 'lider', 'sanadora'] as FolkRole[]) : (['anciano', 'guardia'] as FolkRole[]))];
    while (roles.length < n) roles.push(rng.pick(pool));
    for (const role of roles.slice(0, n)) {
      const age = role === 'nino' ? rng.int(5, 12) : role === 'anciano' ? rng.int(62, 78) : rng.int(18, 55);
      life.folk.push(makeFolk(life, w, rng, r.id, role, age, used));
    }
  }
  assignHouses(life, w, houseCount);
}

export function linkCharacter(life: Life, w: WorldState, c: Character, rng: Rng): Folk {
  const existing = life.folk.find((f) => f.charId === c.id);
  if (existing) return existing;
  const f: Folk = {
    id: `v${++life.seq}`,
    name: c.name,
    regionId: c.regionId,
    role: ROLE_OF_CHARACTER[c.role] ?? 'anciano',
    age: c.role === 'anciana' ? rng.int(64, 80) : rng.int(28, 58),
    born: w.day,
    house: 0,
    alive: c.alive,
    charId: c.id,
    trust: c.emotions.trust,
    fear: c.emotions.fear,
    gratitude: c.emotions.gratitude,
    resentment: c.emotions.resentment,
    honesty: c.emotions.resentment > 0.6 ? 0.4 : 0.8,
    memories: [],
    lastMet: -1,
  };
  life.folk.push(f);
  return f;
}

/** Cada vecino vive en una casa existente de su pueblo. */
export function assignHouses(life: Life, w: WorldState, houseCount: (regionId: number) => number): void {
  for (const r of w.regions) {
    const n = Math.max(1, houseCount(r.id));
    life.folk.filter((f) => f.regionId === r.id && f.alive).forEach((f, i) => (f.house = i % n));
  }
}

export function remember(f: Folk, m: Omit<FolkMemory, 'gen'>, gen: number): void {
  f.memories.push({ ...m, gen });
  if (f.memories.length > 8) f.memories.splice(0, f.memories.length - 8);
  if (m.weight > 0) {
    f.gratitude = clamp(f.gratitude + m.weight * 0.5);
    f.trust = clamp(f.trust + m.weight * 0.3);
    f.resentment = clamp(f.resentment - m.weight * 0.2);
  } else {
    f.resentment = clamp(f.resentment - m.weight * 0.5);
    f.trust = clamp(f.trust + m.weight * 0.3);
    if (m.kind === 'fuerza' || m.kind === 'muerte') f.fear = clamp(f.fear - m.weight * 0.4);
  }
}

/** Disposición a ayudar y a compartir información (0..1). */
export function openness(f: Folk, w: WorldState): number {
  const c = f.charId ? w.characters.find((x) => x.id === f.charId) : undefined;
  const trust = c ? (c.emotions.trust + f.trust) / 2 : f.trust;
  const res = c ? Math.max(c.emotions.resentment, f.resentment) : f.resentment;
  return clamp(trust * 0.7 + f.gratitude * 0.4 - res * 0.5 - f.fear * 0.2 + 0.15);
}
