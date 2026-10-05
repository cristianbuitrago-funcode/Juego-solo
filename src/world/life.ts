import { record } from '../core/chronicle';
import { distillLegacy } from '../core/legacy';
import { Rng } from '../core/rng';
import { eraTitle } from '../core/simulation';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx, type Ctx } from '../core/world';
import { PLAYER_CULTURE } from '../core/content/cultures';
import { personName } from '../core/content/names';
import { dayOf, yearOf } from './clock';
import { assignHouses, folkTarget, linkCharacter, makeFolk, populate, remember, ROLE_TITLE } from './folk';
import { setupPrologue } from './prologue';
import { chooseParent, comingOfAge, mournDeaths, planToday, societyDay, startFirstStory, welcomeBirth } from './social';
import { ensurePeople, logEvent } from './society';
import { marketOf } from './economy';
import { walkable } from './terrain';
import { findPath } from './path';
import { createIdentity, legacyIdentity, story, syncAuthority, updateStanding, type Identity } from './identity';
import { getLayout, nearestWalkable } from './layout';
import type { Avatar, Folk, Life, TownState } from './types';
import { DAYS_PER_YEAR, T, TH, TW } from './types';

/**
 * Vida del mundo: crea y mantiene la capa explorable. Cada amanecer
 * traduce el estado del motor a cambios visibles: pueblos que crecen o se
 * vacían, casas que arden y se reconstruyen, murallas, vecinos que nacen,
 * envejecen, mueren o emigran, y el paso de las generaciones del jugador.
 */
export const TIERS = ['aldea', 'pueblo', 'villa', 'villa grande', 'ciudad'];
const TIER_CUTS = [300, 650, 1100, 1700];
export const tierOf = (pop: number) => TIER_CUTS.filter((c) => pop >= c).length;

export function housesFor(w: WorldState, regionId: number): number {
  const v = getLayout(w).villages[regionId];
  const r = w.regions[regionId];
  return Math.max(3, Math.min(v.houses.length, Math.round(r.population / (r.isHome ? 60 : 70))));
}

/**
 * Donde despierta el protagonista: a las afueras, entre la hierba, lejos de
 * los caminos y a una caminata del pueblo más cercano.
 */
function wakeSpot(w: WorldState, rng: Rng): { x: number; y: number } {
  const layout = getLayout(w);
  const v = layout.villages[w.player.home];
  const { tiles, region } = layout.terrain;
  const green = (t: number) => t === T.Grass || t === T.Meadow;
  // Se busca un claro verde, sin casas cerca y con el pueblo a una caminata:
  // el primer paisaje que ve el jugador tiene que invitar a explorar.
  const cands: { x: number; y: number; score: number }[] = [];
  for (let k = 0; k < 900; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(20, 56);
    const x = Math.round(v.cx + Math.cos(a) * d);
    const y = Math.round(v.cy + Math.sin(a) * d);
    if (x < 8 || y < 8 || x >= TW - 8 || y >= TH - 8) continue;
    const i = y * TW + x;
    if (!walkable(tiles[i]) || tiles[i] === T.Road || layout.blocked[i]) continue;
    // Lejos del pueblo cuenta en contra: la caminata no debe ser eterna.
    let score = (region[i] === w.player.home ? 6 : 0) + (green(tiles[i]) ? 8 : 0) - Math.max(0, d - 32) * 0.8;
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const j = (y + dy) * TW + x + dx;
        const t = tiles[j];
        if (layout.blocked[j]) score -= 6;
        else if (t === T.Mountain) score -= 0.6;
        else if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) score += green(t) ? 1 : t === T.Forest ? 0.6 : t === T.River || t === T.Field ? 0.4 : -0.6;
      }
    cands.push({ x, y, score });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 6)) if (findPath(w, c.x + 0.5, c.y + 0.5, v.cx + 0.5, v.cy + 0.5).length) return nearestWalkable(layout, c.x + 0.5, c.y + 0.5);
  if (cands.length) return nearestWalkable(layout, cands[0].x + 0.5, cands[0].y + 0.5);
  return nearestWalkable(layout, v.cx + 0.5, v.cy + v.plazaR + 20);
}

export function createLife(w: WorldState): Life {
  const rng = new Rng(w.seed ^ 0x2545f491);
  const start = wakeSpot(w, rng);
  // Despierta sin nombre, sin familia y sin nada: solo un colgante.
  const avatar: Avatar = {
    name: 'Sin nombre',
    x: start.x,
    y: start.y,
    age: 27,
    birthDay: w.day,
    since: w.day,
    generation: 1,
    family: [],
    lineage: [],
    inventory: { comida: 0, hierbas: 0, reliquias: 0 },
    pendingDeath: false,
  };
  const life: Life = {
    version: 1,
    clock: 60, // 07:00 del día 1
    player: avatar,
    folk: [],
    towns: {},
    places: {},
    explored: new Array(Math.ceil(((TW >> 2) * (TH >> 2)) / 32)).fill(0),
    caravans: [],
    encounters: [],
    visited: { [w.player.home]: w.day },
    listened: {},
    observed: {},
    nextEncounter: 40,
    seq: 0,
  };
  for (const r of w.regions) {
    const tier = tierOf(r.population);
    life.towns[r.id] = { houses: housesFor(w, r.id), burned: [], abandoned: 0, walls: r.militancy > 0.55, tower: false, tier };
  }
  populate(life, w, rng, (id) => life.towns[id].houses);
  life.clock = (w.day - 1) * 1440 + 40; // 06:40: despierta con el alba
  explore(life, avatar.x, avatar.y, 10);
  w.life = life;
  const id = createIdentity(w, life);
  life.identity = id;
  // Alguien de su tierra le conoció.
  const past = id.past!;
  const candidates = life.folk.filter((f) => f.regionId === past.origin && f.age >= 30 && f.role !== 'lider' && f.role !== 'nino' && !f.charId);
  past.link = (candidates[0] ?? life.folk.find((f) => f.regionId === past.origin && f.role !== 'nino'))?.id;
  life.visited = {};
  story(w, 'Despertó junto a un camino, sin recordar quién era ni cómo había llegado allí.', 'despertar');
  syncAuthority(w);
  setupPrologue(w, life);
  // Fase 2: cada vecino es una persona con su carácter, su familia y su red de lazos.
  ensurePeople(w);
  startFirstStory(w);
  planToday(w);
  return life;
}

/** Asegura que la partida tenga capa de vida (las partidas antiguas se migran). */
export function ensureLife(w: WorldState): Life {
  if (!w.life) w.life = createLife(w);
  if (!w.life.identity) {
    // Partidas anteriores: el protagonista ya gobernaba; sigue haciéndolo.
    w.life.identity = legacyIdentity(w, w.life);
    syncAuthority(w);
  }
  if (!w.life.society) ensurePeople(w);
  return w.life;
}

// ---------------------------------------------------------------------------
// Exploración (niebla del mapa)
// ---------------------------------------------------------------------------
const BW = TW >> 2;
export function explore(life: Life, x: number, y: number, radius = 11): void {
  const bx = Math.floor(x / 4);
  const by = Math.floor(y / 4);
  const r = Math.ceil(radius / 4);
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++) {
      if (i * i + j * j > r * r) continue;
      const cx = bx + i;
      const cy = by + j;
      if (cx < 0 || cy < 0 || cx >= BW || cy >= TH >> 2) continue;
      const bit = cy * BW + cx;
      life.explored[bit >> 5] |= 1 << (bit & 31);
    }
}

export function isExplored(life: Life, x: number, y: number): boolean {
  const bit = Math.floor(y / 4) * BW + Math.floor(x / 4);
  return ((life.explored[bit >> 5] ?? 0) & (1 << (bit & 31))) !== 0;
}

// ---------------------------------------------------------------------------
// Cada amanecer
// ---------------------------------------------------------------------------
export function dailyLife(w: WorldState): void {
  const life = ensureLife(w);
  const ctx = makeCtx(w);
  ctx.rng = new Rng(w.seed ^ (w.day * 2654435761));
  syncCharacters(ctx, life);
  for (const r of w.regions) updateTown(ctx, life, r.id);
  folkLifecycle(ctx, life);
  // La sociedad: economía, necesidades, emociones, lazos, acontecimientos, rumores, conflictos.
  societyDay(w);
  ageAvatar(ctx, life);
  const news = updateStanding(w);
  const id = life.identity;
  if (id) for (const n of news) (id.inbox ??= []).push(n.text);
  life.caravans = life.caravans.filter((c) => c.arrive > life.clock);
  life.encounters = life.encounters.filter((e) => !e.resolved && w.day - e.day < 2);
  // dailyLife usa su propio RNG: no altera la secuencia aleatoria del motor.
}

function syncCharacters(ctx: Ctx, life: Life): void {
  const { w, rng } = ctx;
  for (const c of w.characters) {
    const f = life.folk.find((x) => x.charId === c.id);
    if (!f && c.alive) linkCharacter(life, w, c, rng);
    else if (f && !c.alive && f.alive) f.alive = false;
  }
}

function updateTown(ctx: Ctx, life: Life, regionId: number): void {
  const { w, rng } = ctx;
  const r = w.regions[regionId];
  const t: TownState = (life.towns[regionId] ??= { houses: housesFor(w, regionId), burned: [], abandoned: 0, walls: false, tower: false, tier: tierOf(r.population) });
  const target = housesFor(w, regionId);
  // Crecimiento y decadencia: una casa nueva cada pocos días, o casas que se vacían.
  // Construir cuesta madera y piedra (y alguien que la venda): sin materiales, la gente se apiña.
  if (target > t.houses && rng.chance(0.5) && buildHouse(w, regionId)) t.houses++;
  if (target < t.houses - 2) t.abandoned = Math.min(t.houses - 2, t.houses - target);
  else if (t.abandoned > 0 && target >= t.houses) t.abandoned--;
  // Guerra: arden casas. Paz: se reconstruyen.
  if (r.flags.guerra) {
    if (rng.chance(0.4) && t.houses > 2) {
      const slot = rng.int(0, t.houses - 1);
      if (!t.burned.includes(slot)) {
        if (!t.burned.length) record(ctx, { kind: 'conflicto', text: `Arden casas en ${r.name}.`, regions: [regionId], causeId: r.flags.guerra.causeId, importance: 2 });
        t.burned.push(slot);
      }
    }
  } else if (t.burned.length && rng.chance(0.35)) {
    if (!r.flags.reconstruyendo) {
      const e = record(ctx, { kind: 'consecuencia', text: `${r.name} empieza a reconstruir las casas quemadas.`, regions: [regionId], causeId: findWarEnd(w, regionId), importance: 2 });
      r.flags.reconstruyendo = { since: w.day, causeId: e.id };
    }
    t.burned.pop();
    if (!t.burned.length) delete r.flags.reconstruyendo;
  }
  // Murallas y torres según la militancia y las técnicas.
  const wantWalls = r.militancy > 0.55 || r.techs.includes('empalizadas');
  if (wantWalls && !t.walls) {
    t.walls = true;
    record(ctx, { kind: 'conflicto', text: `${r.name} levanta una empalizada alrededor del pueblo.`, regions: [regionId], causeId: r.flags.preparando?.causeId ?? r.flags.invento_empalizadas?.causeId, importance: 2 });
  }
  if (r.techs.includes('senales') && !t.tower) {
    t.tower = true;
    record(ctx, { kind: 'tecnologia', text: `En una colina de ${r.name} se alza una torre de señales.`, regions: [regionId], causeId: r.flags.invento_senales?.causeId });
  }
  // Rango: aldea → pueblo → villa → ciudad (o al revés).
  const tier = tierOf(r.population);
  if (tier !== t.tier) {
    const up = tier > t.tier;
    record(ctx, {
      kind: 'evento',
      text: up ? `${r.name} ha crecido: ya es ${tier === 4 ? 'una ciudad' : `una ${TIERS[tier]}`}.` : `${r.name} se ha ido vaciando: ahora es apenas ${tier === 0 ? 'una aldea' : `una ${TIERS[tier]}`}.`,
      regions: [regionId],
      causeId: up ? r.flags[Object.keys(r.flags).find((k) => k.startsWith('invento_')) ?? '']?.causeId : (r.flags.hambre?.causeId ?? r.flags.guerra?.causeId),
      importance: 2,
    });
    t.tier = tier;
  }
}

/** Una casa nueva se hace con madera y piedra del mercado (si las hay). */
function buildHouse(w: WorldState, regionId: number): boolean {
  if (!w.life?.society) return true;
  const m = marketOf(w, regionId);
  if (m.stock.madera < 6 || m.stock.piedra < 4) return false;
  m.stock.madera -= 6;
  m.stock.piedra -= 4;
  const pay = Math.min(m.treasury, 4);
  m.treasury -= pay;
  m.cash += pay;
  return true;
}

function findWarEnd(w: WorldState, regionId: number): string | undefined {
  return [...w.entries].reverse().find((e) => e.kind === 'conflicto' && e.text.startsWith('Termina la guerra') && e.regions.includes(regionId))?.id;
}

function folkLifecycle(ctx: Ctx, life: Life): void {
  const { w, rng } = ctx;
  const used = new Set(life.folk.map((f) => f.name));
  const died: Folk[] = [];
  for (const f of life.folk) {
    if (!f.alive) continue;
    const r = w.regions[f.regionId];
    if ((w.day - f.born) % DAYS_PER_YEAR === 0 && w.day !== f.born) {
      f.age++;
      if (f.role === 'nino' && f.age >= 15) {
        f.role = comingOfAge(w, rng, f);
        f.p?.jobs.push({ role: f.role, from: w.day });
        if (f.p) logEvent(w, f.regionId, 'oficio', `${f.name} ya es mayor: empieza a trabajar de ${ROLE_TITLE[f.role]}.`, [f.id]);
      }
    }
    if (f.charId) continue; // los personajes con nombre los gestiona el motor
    let p = f.age > 64 ? (f.age - 64) * 0.003 : 0;
    if (r.flags.hambre) p += w.sim?.worldEconomy ? 0.002 : 0.004;
    if (r.flags.guerra) p += f.role === 'guardia' ? 0.03 : 0.008;
    if (r.flags.fiebre) p += 0.004;
    if (rng.chance(p)) {
      f.alive = false;
      died.push(f);
      const cause = r.flags.guerra?.causeId ?? r.flags.hambre?.causeId ?? r.flags.fiebre?.causeId;
      const how = f.age > 64 && !cause ? 'de vieja' : r.flags.guerra ? 'en la guerra' : r.flags.hambre ? 'durante la escasez' : r.flags.fiebre ? 'de fiebre' : '';
      if (f.lastMet >= 0) record(ctx, { kind: 'personaje', text: `Te enteras de que ${f.name}, a quien conociste en ${r.name}, murió ${how}.`.replace(' murió de vieja', ' murió de vieja edad'), regions: [f.regionId], causeId: cause, known: true });
    }
    // Emigración: los vecinos se van con las familias que huyen.
    // Con la economía viva, las migraciones las decide population.ts (con nombre y motivo).
    const mig = w.sim?.worldEconomy ? undefined : r.flags.emigrando;
    if (mig && rng.chance(0.12) && f.role !== 'lider') {
      const to = Number(mig.data?.to);
      if (!Number.isNaN(to) && w.regions[to]) {
        f.origin = f.regionId;
        f.regionId = to;
        if (w.regions[to].isHome) remember(f, { day: w.day, kind: 'refugio', weight: 0.6 }, life.player.generation);
        if (f.lastMet >= 0) record(ctx, { kind: 'migracion', text: `${f.name} dejó ${r.name} con su familia rumbo a ${w.regions[to].name}.`, regions: [r.id, to], causeId: mig.causeId, known: true });
      }
    }
  }
  // Nacimientos: si hay sitio y comida, nacen niños.
  for (const r of w.regions) {
    const alive = life.folk.filter((f) => f.alive && f.regionId === r.id && !f.charId);
    const want = folkTarget(r.population, r.isHome);
    const food = r.isHome ? w.player.reserves / 5 : r.food;
    if (alive.length < want && food > 7 && rng.chance(0.15)) {
      const parent = chooseParent(w, rng, alive) ?? rng.pick(alive.filter((f) => f.age >= 18 && f.age < 50).length ? alive.filter((f) => f.age >= 18 && f.age < 50) : alive);
      const baby = makeFolk(life, w, rng, r.id, 'nino', 0, used, { parentId: parent?.id });
      baby.born = w.day;
      life.folk.push(baby);
      welcomeBirth(w, baby, parent);
      if (parent && parent.lastMet >= 0) record(ctx, { kind: 'personaje', text: `A ${parent.name}, de ${r.name}, le ha nacido un hijo: ${baby.name}.`, regions: [r.id], known: true });
    }
  }
  // Las familias y los amigos lloran a sus muertos (y heredan).
  mournDeaths(w, died);
  // Los muertos olvidados se archivan (se conserva a quien conociste).
  life.folk = life.folk.filter((f) => f.alive || f.lastMet >= 0 || f.charId);
  assignHouses(life, w, (id) => life.towns[id]?.houses ?? 3);
}

// ---------------------------------------------------------------------------
// Generaciones del jugador
// ---------------------------------------------------------------------------
function ageAvatar(ctx: Ctx, life: Life): void {
  const { w, rng } = ctx;
  const p = life.player;
  if ((w.day - p.birthDay) % DAYS_PER_YEAR !== 0 || w.day === p.birthDay) return;
  p.age++;
  for (const k of p.family) k.age++;
  // Puede nacer alguien más en la familia (si ha echado raíces en algún sitio).
  const rooted = life.identity?.mode === 'gobernante' || (life.identity?.housed && (life.identity.standing[w.player.home] ?? 0) >= 2);
  if (p.age < 46 && rooted && rng.chance(0.18)) {
    const name = personName(rng, PLAYER_CULTURE.syllables, new Set(p.family.map((k) => k.name)));
    const rel = rng.chance(0.5) ? 'hija' : 'hijo';
    p.family.push({ name, relation: rel, age: 0 });
    record(ctx, { kind: 'personaje', text: `Nace ${name}, ${rel === 'hija' ? 'hija' : 'hijo'} de ${p.name}.`, regions: [w.player.home], known: true, importance: 2, byPlayer: true });
    story(w, `Nació ${rel === 'hija' ? 'su hija' : 'su hijo'} ${name}.`, 'relacion');
  }
  const risk = p.age >= 85 ? 1 : p.age > 58 ? (p.age - 58) * 0.035 : 0;
  if (rng.chance(risk)) p.pendingDeath = true;
}

export function heirs(life: Life): Avatar['family'] {
  return life.player.family.filter((k) => k.age >= 14);
}

/**
 * El personaje muere y otro miembro de la familia toma el relevo. Se hereda la
 * casa, el conocimiento, la reputación y los enemigos: los vecinos recordarán
 * a tu antepasado cuando hablen contigo.
 */
export function succeed(w: WorldState, heirName: string, honor = true): string {
  const life = ensureLife(w);
  const ctx = makeCtx(w);
  const old = life.player;
  const heir = old.family.find((k) => k.name === heirName) ?? old.family[0];
  const title = eraTitle(w);
  old.lineage.push({ name: old.name, fromDay: old.since, toDay: w.day, title, relation: heir?.relation ?? 'sucesor' });
  record(ctx, { kind: 'personaje', text: `Muere ${old.name} a los ${old.age} años. Lo recordarán como «${title}». ${heir ? `${heir.name}, ${heir.relation === 'aprendiz' ? 'su aprendiz' : `su ${heir.relation}`}, toma el relevo.` : ''}`, regions: [w.player.home], known: true, importance: 3, byPlayer: true });
  distillLegacy(w, title);
  const others = old.family.filter((k) => k !== heir).map((k) => ({ ...k, relation: (k.relation === 'aprendiz' ? 'aprendiz' : k.relation === 'hija' ? 'sobrina' : 'sobrino') as typeof k.relation }));
  life.player = {
    ...old,
    name: heir?.name ?? old.name,
    age: Math.max(heir?.age ?? 20, 16),
    birthDay: w.day,
    since: w.day,
    generation: old.generation + 1,
    family: others,
    inventory: { comida: old.inventory.comida, hierbas: old.inventory.hierbas, reliquias: old.inventory.reliquias },
    pendingDeath: false,
  };
  // El mundo nota el cambio: un poco de la reputación se diluye.
  for (const r of w.regions) if (!r.isHome) r.attitude.trust = clamp(r.attitude.trust + (0.45 - r.attitude.trust) * 0.15);
  if (life.identity) life.identity = heirIdentity(w, life.identity, old.name, honor);
  commitCtx(ctx);
  return life.player.name;
}

// ---------------------------------------------------------------------------
// Utilidades de tiempo
// ---------------------------------------------------------------------------
export function currentYear(w: WorldState): number {
  return yearOf(w.day);
}

export function syncClock(w: WorldState): void {
  const life = ensureLife(w);
  if (dayOf(life.clock) < w.day) life.clock = (w.day - 1) * 1440 + 30;
}

export function folkOf(w: WorldState, id: string): Folk | undefined {
  return w.life?.folk.find((f) => f.id === id);
}

const TEMPERS = ['inquieto', 'prudente', 'ambicioso', 'compasivo', 'testarudo', 'soñador', 'callado', 'alegre'];

/**
 * Quien hereda no es una copia: tiene su propio carácter, sabe otras cosas y
 * puede honrar el legado familiar… o darle la espalda.
 */
function heirIdentity(w: WorldState, prev: Identity, oldName: string, honor: boolean): Identity {
  const life = w.life!;
  const rng = new Rng(w.seed ^ (w.day * 7919));
  const next: Identity = JSON.parse(JSON.stringify(prev));
  next.lives = [...prev.lives, { name: oldName, story: prev.story }];
  next.story = [];
  next.mode = prev.mode;
  next.named = true;
  next.nickname = life.player.name;
  next.past = null;
  next.fragments = [];
  next.items = prev.items.filter((x) => x !== 'colgante');
  next.latent = {};
  next.talents = [];
  next.offers = [];
  next.worked = {};
  next.vow = undefined;
  next.needs = { hunger: 0.2, fatigue: 0.1, coins: Math.floor(prev.needs.coins / 2), warned: 0 };
  next.temper = rng.pick(TEMPERS);
  // Habilidades propias: lo que aprendió en casa, no lo que sabía su predecesor.
  for (const t of Object.values(next.skills)) Object.assign(t, { xp: 0, level: 0, found: -1, past: false });
  for (const t of Object.values(next.know)) {
    const lv = Math.max(0, t.level - 2);
    Object.assign(t, { xp: [0, 1, 5, 12, 24, 40][lv], level: lv, found: lv ? w.day : -1, past: false });
  }
  const own = rng.pick(Object.keys(next.skills)) as keyof Identity['skills'];
  next.skills[own] = { xp: 5, level: 2, found: w.day };
  next.latent[rng.pick(Object.keys(next.skills))] = 2;
  // La reputación se hereda en parte; los cargos no.
  const keep = honor ? 0.6 : 0.25;
  for (const k of Object.keys(next.score)) next.score[Number(k)] = (next.score[Number(k)] ?? 0) * keep;
  for (const k of Object.keys(next.rank)) next.rank[Number(k)] = honor ? Math.min(4, next.rank[Number(k)] ?? 0) : 0;
  next.story.push({ day: w.day, age: life.player.age, kind: 'despertar', text: honor ? `Tomó el relevo de ${oldName} y decidió honrar su legado.` : `Tomó el relevo de ${oldName}, pero eligió su propio camino.` });
  return next;
}
