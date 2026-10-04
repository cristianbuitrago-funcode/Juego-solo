import { CULTURES, PLAYER_CULTURE } from '../content/cultures';
import { personName, regionName, RELATIVES } from '../content/names';
import { RESOURCE_IDS } from '../content/resources';
import { ROLES, ROLE_IDS } from '../content/roles';
import { record } from '../chronicle';
import { meet, observe } from '../intel';
import type { Legacy } from '../legacy';
import { Rng } from '../rng';
import { setupMystery } from '../systems/mystery';
import { setupObjectives } from '../systems/objectives';
import type { Character, Culture, Emotions, Region, Relation, Route, WorldState } from '../types';
import { clamp } from '../util';
import { commitCtx, hops, type Ctx } from '../world';
import { generateLayout, WORLD_H, WORLD_W } from './mapgen';

export const SAVE_VERSION = 2;
/** Versiones antiguas que se pueden migrar al cargar. */
export const MIN_SAVE_VERSION = 1;

export interface WorldOptions {
  regionCount?: number;
  eraLength?: number;
  legacy?: Legacy;
}

/**
 * Crea un mundo nuevo a partir de una semilla. Todo lo que hace distinta a
 * una partida (geografía, culturas, recursos, personajes, relaciones,
 * misterio, objetivos y rival) se decide aquí.
 */
export function createWorld(seed: number, opts: WorldOptions = {}): WorldState {
  const count = opts.regionCount ?? 9;
  const layout = generateLayout(seed, count);
  const rng = new Rng(seed);
  const n = layout.sites.length;

  // Hogar del jugador: bien conectado y no demasiado lejos del centro.
  let homeId = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = layout.centers[i];
    const dc = Math.hypot(c.x - WORLD_W / 2, c.y - WORLD_H / 2);
    const score = Math.min(layout.neighbors[i].length, 4) - dc / 350 + rng.next() * 0.5;
    if (score > bestScore) (bestScore = score), (homeId = i);
  }

  // Culturas: menos culturas que regiones, para que haya afinidades naturales.
  const pool = rng.shuffle([...CULTURES]).slice(0, Math.max(3, Math.ceil((n - 1) * 0.7)));
  const cultures: Culture[] = [...pool];

  // Recursos: variedad garantizada. El nacimiento del río es minero (lo usa un misterio).
  const resources = rng.shuffle([...RESOURCE_IDS, ...rng.shuffle([...RESOURCE_IDS]).slice(0, Math.max(0, n - RESOURCE_IDS.length))]);
  const usedNames = new Set<string>();
  const regions: Region[] = [];
  for (let i = 0; i < n; i++) {
    const isHome = i === homeId;
    const culture = isHome ? PLAYER_CULTURE : rng.pick(pool);
    let resource = resources[i % resources.length];
    if (layout.coastal[i] && rng.chance(0.35)) resource = rng.pick(['pesca', 'sal']);
    if (layout.river[0] === i) resource = rng.pick(['hierro', 'arcilla']);
    if (isHome) resource = 'grano';
    regions.push({
      id: i,
      name: regionName(rng, usedNames),
      culture: culture.id,
      isHome,
      center: layout.centers[i],
      site: layout.sites[i],
      neighbors: [...new Set(layout.neighbors[i])],
      coastal: layout.coastal[i],
      riverOrder: layout.river.indexOf(i),
      resource,
      population: Math.round(rng.range(280, 1500)),
      food: rng.range(8, 16),
      ecology: rng.range(0.62, 0.95),
      pressure: rng.range(0.1, 0.3),
      stability: rng.range(0.55, 0.85),
      militancy: rng.range(0.05, 0.25),
      selfReliance: rng.range(0.15, 0.4),
      dependency: 0,
      techs: [],
      research: null,
      attitude: { trust: rng.range(0.35, 0.55), fear: rng.range(0.05, 0.2), resentment: rng.range(0, 0.15), gratitude: 0.1 },
      relations: {},
      lastAttention: 0,
      patternsSeen: {},
      flags: {},
      favored: false,
      abandoned: false,
      resourceBanned: false,
      autonomous: false,
      foodHistory: [],
    });
  }
  regions[homeId].population = 600;

  const allCultures = [PLAYER_CULTURE, ...cultures];
  const cultureOf = (r: Region) => allCultures.find((c) => c.id === r.culture)!;

  // Relaciones entre vecinos: afinidad cultural + azar + viejos rencores del legado.
  for (const r of regions) {
    for (const nb of r.neighbors) {
      if (r.relations[nb]) continue;
      const o = regions[nb];
      let opinion = r.culture === o.culture ? rng.range(0.25, 0.55) : rng.range(-0.3, 0.4);
      let grievance = 0;
      for (const g of opts.legacy?.grudges ?? []) {
        if ((g.a === r.culture && g.b === o.culture) || (g.b === r.culture && g.a === o.culture)) {
          opinion -= g.strength;
          grievance += g.strength * 0.6;
        }
      }
      const make = (): Relation => ({ opinion: clamp(opinion, -1, 1), grievance: clamp(grievance), allied: false, war: false, tension: clamp(-opinion * 0.3) });
      r.relations[nb] = make();
      o.relations[r.id] = make();
    }
  }

  // Rutas comerciales: una por frontera.
  const routes: Route[] = [];
  for (const r of regions)
    for (const nb of r.neighbors)
      if (nb > r.id) {
        const base = clamp(0.25 + (cultureOf(r).traits.mercantile + cultureOf(regions[nb]).traits.mercantile) * 0.3 + rng.range(-0.1, 0.1));
        routes.push({ id: routes.length, a: r.id, b: nb, status: 'abierta', traffic: base, baseTraffic: base });
      }

  const w: WorldState = {
    version: SAVE_VERSION,
    seed,
    rngState: rng.state,
    day: 1,
    eraLength: opts.eraLength ?? 60,
    regions,
    routes,
    cultures,
    characters: [],
    rumors: [],
    clues: [],
    intel: {},
    entries: [],
    scheduled: [],
    missions: [],
    hypotheses: [],
    petitions: [],
    objectives: [],
    mystery: { kind: 'ninguno', culpritRegion: -1, fragmentsFound: [], solved: false, failedGuesses: 0, nextGuessDay: 0, triggerDay: 0, revealed: false },
    player: {
      home: homeId,
      reserves: 60,
      cohesion: 0.7,
      agents: 3,
      credibility: 0.6,
      priority: 'comercio',
      laws: { hospitalidad: false, secreto: false, racionamiento: false },
      patterns: {},
      actionsToday: 0,
      guardReady: 0,
    },
    river: layout.river,
    counters: {},
    lastWarDay: 10, // la paz cuenta desde el día 10: los primeros días no valen
    ended: false,
    legacyNotes: [],
    mood: 'calma',
  };
  for (const r of regions) w.intel[r.id] = { level: 0, lastObserved: -99, facts: {}, observerStationed: false };

  const ctx: Ctx = { w, rng, fresh: [] };
  createCharacters(ctx, allCultures, opts.legacy);
  chooseRival(ctx);

  // Lo que sabes al empezar: tu hogar a fondo, tus vecinos de oídas.
  observe(ctx, regions[homeId], 1);
  w.intel[homeId].level = 3;
  const d = hops(w, homeId);
  for (const r of regions) {
    if (d[r.id] === 1) {
      meet(ctx, r);
      for (const c of w.characters) if (c.regionId === r.id && c.role === 'lider') c.known = true;
    }
  }

  setupMystery(ctx);
  setupObjectives(ctx);

  record(ctx, {
    kind: 'evento',
    text: `Tu gente se asienta en ${regions[homeId].name}. Los vecinos os observan con curiosidad.`,
    regions: [homeId],
    known: true,
    importance: 2,
  });
  if (opts.legacy && opts.legacy.games > 0) {
    w.legacyNotes.push(`Este mundo guarda ecos de ${opts.legacy.games} ${opts.legacy.games === 1 ? 'era anterior' : 'eras anteriores'}.`);
  }
  commitCtx(ctx);
  return w;
}

function createCharacters(ctx: Ctx, cultures: Culture[], legacy?: Legacy): void {
  const { w, rng } = ctx;
  const used = new Set<string>();
  for (const r of w.regions) {
    if (r.isHome) continue;
    const culture = cultures.find((c) => c.id === r.culture)!;
    const roles = ['lider', rng.pick(ROLE_IDS.filter((x) => x !== 'lider'))];
    if (r.population > 1100) roles.push(rng.pick(ROLE_IDS.filter((x) => !roles.includes(x))));
    for (const role of roles) {
      const bias = ROLES[role].bias;
      const e: Emotions = {
        trust: clamp(r.attitude.trust + rng.range(-0.15, 0.15) + (bias.trust ?? 0)),
        fear: clamp(r.attitude.fear + rng.range(0, 0.15) + (bias.fear ?? 0)),
        resentment: clamp(r.attitude.resentment + rng.range(0, 0.1) + (bias.resentment ?? 0)),
        gratitude: clamp(0.1 + (bias.gratitude ?? 0)),
        ambition: clamp(rng.range(0.15, 0.7) + (bias.ambition ?? 0)),
        curiosity: clamp(culture.traits.curiosity * 0.6 + rng.range(0, 0.4) + (bias.curiosity ?? 0)),
      };
      const c: Character = {
        id: `c${w.characters.length + 1}`,
        name: personName(rng, culture.syllables, used),
        role,
        regionId: r.id,
        alive: true,
        known: false,
        emotions: e,
        memories: [],
        relative: rng.pick(RELATIVES),
        lastSpoke: -99,
      };
      // Recuerdos heredados de partidas anteriores.
      if (legacy && (role === 'anciana' || role === 'poeta' || role === 'lider')) {
        const grudge = legacy.grudges.find((g) => g.a === r.culture || g.b === r.culture);
        const favor = legacy.favors.find((f) => f.culture === r.culture);
        const wrong = legacy.wrongs.find((f) => f.culture === r.culture);
        if (grudge) {
          const otherCulture = grudge.a === r.culture ? grudge.b : grudge.a;
          const other = cultures.find((x) => x.id === otherCulture);
          if (other) c.memories.push({ day: 0, kind: 'legado', weight: -0.4, about: 'jugador', vars: { X: other.name } });
        }
        if (favor) {
          c.memories.push({ day: 0, kind: 'legado', weight: 0.4, about: 'jugador', vars: { X: 'nadie' } });
          c.emotions.trust = clamp(c.emotions.trust + favor.strength);
        }
        if (wrong) c.emotions.resentment = clamp(c.emotions.resentment + wrong.strength);
      }
      w.characters.push(c);
    }
  }
}

/** Una región empieza mal predispuesta contigo: convencerla es un objetivo oculto. */
function chooseRival(ctx: Ctx): void {
  const { w, rng } = ctx;
  const d = hops(w, w.player.home);
  const candidates = w.regions.filter((r) => !r.isHome && d[r.id] >= 2);
  const rival = candidates.length ? rng.pick(candidates) : w.regions.find((r) => !r.isHome)!;
  rival.attitude.trust = 0.15;
  rival.attitude.resentment = 0.5;
  for (const c of w.characters.filter((x) => x.regionId === rival.id)) {
    c.emotions.trust = 0.12;
    c.emotions.resentment = clamp(c.emotions.resentment + 0.45);
  }
  w.counters.rival = rival.id;
}
