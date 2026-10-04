import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { getLayout } from './layout';
import type { Folk, FolkRole, Life } from './types';

/**
 * La sociedad: cada vecino es una persona con carácter, necesidades,
 * emociones, objetivos, gustos, recuerdos propios y una red de lazos con los
 * demás (familia, amistades, rivalidades). Este módulo guarda los datos y
 * las utilidades básicas; la vida diaria se decide en `social.ts`.
 *
 * Tres niveles de detalle:
 * - principales (tier 1): personajes con nombre del motor, líderes, quienes
 *   tienen papel en una historia o a quienes el jugador trata a menudo;
 * - secundarios (tier 2): el resto de vecinos con nombre;
 * - población: el gentío de las ciudades (solo en la escena, sin datos).
 */
export const TRAITS = ['amable', 'desconfiado', 'ambicioso', 'timido', 'curioso', 'trabajador', 'perezoso', 'orgulloso', 'generoso', 'egoista', 'valiente', 'cobarde', 'reservado', 'sociable'] as const;
export type Trait = (typeof TRAITS)[number];

export const NEEDS = ['comida', 'dinero', 'descanso', 'seguridad', 'trabajo', 'vivienda', 'relaciones', 'ocio'] as const;
export type NeedId = (typeof NEEDS)[number];

export type Feeling = 'felicidad' | 'tristeza' | 'miedo' | 'enojo' | 'estres';
export type Emotion = Feeling | 'calma';

/** Un recuerdo propio de un vecino (sobre otra persona, el jugador o el pueblo). */
export interface Mem {
  day: number;
  kind: string;
  about?: string; // 'jugador' o id de un vecino
  with?: string; // otra persona implicada
  text: string;
  w: number; // -1..1: cuánto le importa y en qué sentido
  i: number; // intensidad actual (0..1): se apaga con el tiempo
  src: 'visto' | 'oido' | 'propio';
}

export type GoalKind = 'ahorrar' | 'casarse' | 'puesto' | 'aprender' | 'mudarse' | 'venganza' | 'reconciliarse' | 'cuidar' | 'descansar';
export interface Goal {
  kind: GoalKind;
  target?: string;
  since: number;
}

/** Lo que hace hoy fuera de su rutina (una boda, una discusión, guardar cama…). */
export interface Plan {
  day: number;
  from: number; // hora
  to: number;
  x: number;
  y: number;
  activity: string;
  with?: string;
  inside?: boolean;
  event?: string;
}

export interface Persona {
  v: 1;
  tier: 1 | 2;
  t: Record<Trait, number>; // 0..100
  needs: Record<NeedId, number>; // 0 carencia … 1 cubierta
  emo: Record<Feeling, number>; // 0..1
  coins: number;
  goals: Goal[];
  likes: string;
  dislikes: string;
  mem: Mem[];
  events: { day: number; text: string }[]; // acontecimientos personales
  jobs: { role: FolkRole; from: number }[]; // historial de oficios
  sick?: number; // enfermo hasta ese día
  mourning?: number; // de luto hasta ese día
  away?: { to: number; back: number; why: string }; // de viaje
  plans: Plan[];
}

export type Kin = 'pareja' | 'hermanos' | 'progenitor' | 'expareja';

/** Un lazo entre dos vecinos. `aff` es el afecto (-100..100); `fam`, cuánto se tratan (0..100). */
export interface Tie {
  a: string;
  b: string;
  kin?: Kin;
  parent?: string; // si kin = progenitor: quién es el padre o la madre
  aff: number;
  fam: number;
  since: number;
  last: number;
  work?: boolean; // trabajan juntos o hacen tratos
}

export interface SocialEvent {
  id: string;
  day: number;
  regionId: number;
  kind: string;
  text: string;
  who: string[];
  arc?: string;
}

export interface Society {
  v: 1;
  seq: number;
  ties: Record<string, Tie>;
  rumors: import('./gossip').SRumor[];
  arcs: import('./arcs').Arc[];
  events: SocialEvent[];
  approaches: import('./gossip').Approach[];
  market: Record<number, import('./economy').Market>;
  memDay: number; // hasta qué día se han convertido en rumores los recuerdos del jugador
  heard: string[]; // acontecimientos que el jugador conoce (vistos o contados)
  festivals: { regionId: number; day: number; kind: 'boda' | 'fiesta' | 'funeral'; who: string[] }[];
  facts: Record<string, string[]>; // lo que el jugador sabe de cada vecino (contado por otros)
  lastSeen: Record<number, number>; // último día que el jugador estuvo en cada región (para ponerle al día)
}

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
export function societyOf(w: WorldState): Society {
  const life = w.life!;
  return (life.society ??= { v: 1, seq: 0, ties: {}, rumors: [], arcs: [], events: [], approaches: [], market: {}, memDay: w.day - 1, heard: [], festivals: [], facts: {}, lastSeen: {} });
}

export const keyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function tieOf(w: WorldState, a: string, b: string): Tie | undefined {
  return societyOf(w).ties[keyOf(a, b)];
}

// Índices en memoria (no se guardan): lazos por persona y vecinos por id.
const tieIndex = new WeakMap<Society, Map<string, Tie[]>>();
const folkIndex = new WeakMap<Folk[], { n: number; map: Map<string, Folk> }>();

function indexOf(s: Society): Map<string, Tie[]> {
  let idx = tieIndex.get(s);
  if (!idx) {
    idx = new Map();
    for (const t of Object.values(s.ties)) {
      (idx.get(t.a) ?? idx.set(t.a, []).get(t.a)!).push(t);
      (idx.get(t.b) ?? idx.set(t.b, []).get(t.b)!).push(t);
    }
    tieIndex.set(s, idx);
  }
  return idx;
}

export function ensureTie(w: WorldState, a: string, b: string): Tie {
  const s = societyOf(w);
  const k = keyOf(a, b);
  let t = s.ties[k];
  if (!t) {
    t = s.ties[k] = { a: a < b ? a : b, b: a < b ? b : a, aff: 0, fam: 0, since: w.day, last: w.day };
    const idx = tieIndex.get(s);
    if (idx) {
      (idx.get(t.a) ?? idx.set(t.a, []).get(t.a)!).push(t);
      (idx.get(t.b) ?? idx.set(t.b, []).get(t.b)!).push(t);
    }
  }
  return t;
}

/** Borra un lazo que ya no significa nada. */
export function dropTie(w: WorldState, t: Tie): void {
  const s = societyOf(w);
  delete s.ties[keyOf(t.a, t.b)];
  const idx = tieIndex.get(s);
  if (idx) for (const id of [t.a, t.b]) {
    const list = idx.get(id);
    if (list) list.splice(list.indexOf(t), 1);
  }
}

export function tiesOf(w: WorldState, id: string): Tie[] {
  return indexOf(societyOf(w)).get(id) ?? [];
}

export const other = (t: Tie, id: string) => (t.a === id ? t.b : t.a);

export function folkById(w: WorldState, id: string): Folk | undefined {
  const list = w.life!.folk;
  let c = folkIndex.get(list);
  if (!c || c.n !== list.length) {
    c = { n: list.length, map: new Map(list.map((f) => [f.id, f])) };
    folkIndex.set(list, c);
  }
  return c.map.get(id);
}

/** Cambia el afecto entre dos personas (y lo que se tratan). */
export function bond(w: WorldState, a: string, b: string, daff: number, dfam = 2): Tie {
  const t = ensureTie(w, a, b);
  t.aff = Math.max(-100, Math.min(100, t.aff + daff));
  t.fam = Math.max(0, Math.min(100, t.fam + dfam));
  t.last = w.day;
  return t;
}

/** Cómo se llevan, en palabras (nunca se muestran cifras al jugador). */
export type Standing = 'desconocido' | 'conocido' | 'frecuente' | 'amigo' | 'amigo cercano' | 'aliado' | 'rival' | 'enemigo';
export function standingOf(t: Tie | undefined): Standing {
  if (!t) return 'desconocido';
  if (t.aff <= -60) return 'enemigo';
  if (t.aff <= -25) return 'rival';
  if (t.aff >= 60) return t.work ? 'aliado' : 'amigo cercano';
  if (t.aff >= 30) return t.work && t.aff >= 45 ? 'aliado' : 'amigo';
  if (t.fam >= 45) return 'frecuente';
  if (t.fam >= 12) return 'conocido';
  return 'desconocido';
}

export function partnerOf(w: WorldState, id: string): string | undefined {
  const t = tiesOf(w, id).find((x) => x.kin === 'pareja');
  return t ? other(t, id) : undefined;
}

export function kinOf(w: WorldState, id: string): { id: string; rel: string }[] {
  const out: { id: string; rel: string }[] = [];
  for (const t of tiesOf(w, id)) {
    if (!t.kin || t.kin === 'expareja') continue;
    const o = other(t, id);
    const g = folkById(w, o)?.gender;
    const rel = t.kin === 'pareja' ? 'pareja' : t.kin === 'hermanos' ? (g === 'f' ? 'hermana' : 'hermano') : t.parent === o ? (g === 'f' ? 'madre' : 'padre') : g === 'f' ? 'hija' : 'hijo';
    out.push({ id: o, rel });
  }
  return out;
}

export function trait(f: Folk, k: Trait): number {
  return f.p?.t[k] ?? 50;
}

export function logEvent(w: WorldState, regionId: number, kind: string, text: string, who: string[], arc?: string): SocialEvent {
  const s = societyOf(w);
  const e: SocialEvent = { id: `s${++s.seq}`, day: w.day, regionId, kind, text, who, arc };
  s.events.push(e);
  if (s.events.length > 160) s.events.splice(0, s.events.length - 160);
  for (const id of who) {
    const f = folkById(w, id);
    if (f?.p) {
      f.p.events.push({ day: w.day, text });
      if (f.p.events.length > (f.p.tier === 1 ? 14 : 6)) f.p.events.shift();
    }
  }
  return e;
}

// ---------------------------------------------------------------------------
// Memoria: lo importante dura; lo menor se olvida
// ---------------------------------------------------------------------------
/** Recuerda algo. Si ya recordaba algo igual hace poco, el recuerdo se refuerza en vez de duplicarse. */
export function memorize(w: WorldState, f: Folk, m: Omit<Mem, 'i' | 'day'> & { i?: number }): Mem | undefined {
  const p = f.p;
  if (!p) return undefined;
  const same = p.mem.find((x) => x.kind === m.kind && x.about === m.about && x.with === m.with && w.day - x.day < 12);
  if (same) {
    same.i = Math.min(1, same.i + 0.25);
    same.w = Math.max(-1, Math.min(1, same.w + m.w * 0.3));
    same.day = w.day;
    return same;
  }
  const mem: Mem = { ...m, day: w.day, i: m.i ?? Math.min(1, 0.45 + Math.abs(m.w) * 0.6) };
  p.mem.push(mem);
  const cap = p.tier === 1 ? 16 : 7;
  if (p.mem.length > cap) {
    // Se olvida antes lo menos importante, no lo más antiguo.
    p.mem.sort((a, b) => b.i * (0.4 + Math.abs(b.w)) - a.i * (0.4 + Math.abs(a.w)));
    p.mem.length = cap;
  }
  return mem;
}

/** Clase de recuerdo: reciente, personal o histórico (lo que no se olvida). */
export function memTier(m: Mem): 'reciente' | 'personal' | 'historica' {
  if (Math.abs(m.w) >= 0.75 || m.kind === 'muerte' || m.kind === 'boda' || m.kind === 'traicion') return 'historica';
  if (m.about && m.about !== 'pueblo') return 'personal';
  return 'reciente';
}

/** Cada día los recuerdos pierden fuerza según su gravedad. Los vínculos fuertes los mantienen. */
export function fadeMemories(w: WorldState, f: Folk): void {
  const p = f.p;
  if (!p) return;
  for (const m of p.mem) {
    const tier = memTier(m);
    const base = tier === 'historica' ? 0.0015 : tier === 'personal' ? 0.012 : 0.045;
    // Lo que tiene que ver con la familia se olvida más despacio.
    const kin = m.about && m.about !== 'jugador' && tieOf(w, f.id, m.about)?.kin ? 0.5 : 1;
    // Quien es rencoroso (orgulloso, desconfiado) recuerda las ofensas.
    const grudge = m.w < 0 ? 1 - (trait(f, 'orgulloso') + trait(f, 'desconfiado') - 100) / 300 : 1 - (trait(f, 'amable') - 50) / 250;
    m.i -= base * kin * grudge;
  }
  p.mem = p.mem.filter((m) => m.i > 0.05);
  // Recuerdos que tienen del jugador (memoria antigua del juego): lo menor caduca con los años.
  f.memories = f.memories.filter((m) => {
    const age = w.day - m.day;
    const a = Math.abs(m.weight);
    return a >= 0.75 || age < (a >= 0.45 ? 100 : a >= 0.3 ? 60 : 30);
  });
}

// ---------------------------------------------------------------------------
// Creación de la persona
// ---------------------------------------------------------------------------
const LIKES = ['la miel', 'el pescado fresco', 'la cerveza de la posada', 'las canciones viejas', 'las flores silvestres', 'las historias de viajeros', 'el pan recién hecho', 'los días de mercado', 'el silencio del alba', 'las apuestas', 'los caballos', 'el olor de la lluvia', 'las fiestas', 'los dulces'];
const DISLIKES = ['el frío', 'los forasteros que preguntan mucho', 'el ruido', 'las deudas', 'los guardias', 'el humo de la forja', 'madrugar', 'las mentiras', 'la gente presumida', 'los perros', 'el barro', 'perder el tiempo'];

const ROLE_BIAS: Partial<Record<FolkRole, Partial<Record<Trait, number>>>> = {
  comerciante: { ambicioso: 22, sociable: 15, desconfiado: 8, curioso: 6 },
  guardia: { valiente: 25, desconfiado: 15, orgulloso: 10 },
  campesino: { trabajador: 15, reservado: 6 },
  pastor: { reservado: 15, timido: 8 },
  pescador: { valiente: 8, trabajador: 10 },
  artesano: { trabajador: 18, orgulloso: 10, curioso: 8 },
  anciano: { reservado: 10, desconfiado: 6, curioso: 5 },
  lider: { ambicioso: 20, orgulloso: 15, valiente: 10, sociable: 10 },
  sanadora: { amable: 22, generoso: 15, curioso: 12 },
  exploradora: { curioso: 25, valiente: 15 },
  nino: { curioso: 20, sociable: 12, timido: 4 },
  posadero: { sociable: 25, amable: 10, curioso: 10 },
  minero: { trabajador: 15, valiente: 12, reservado: 8 },
  carpintero: { trabajador: 15, orgulloso: 8 },
};

/** El género, coherente con el dibujo del personaje (misma semilla que su apariencia). */
export function genderFor(f: Folk): 'f' | 'm' {
  let s = (hashString(f.id) ^ (f.charId ? 0x9e37 : 0)) >>> 0 || 1;
  s = (s + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const roll = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return roll < (f.role === 'sanadora' || f.role === 'exploradora' ? 0.85 : f.role === 'guardia' ? 0.25 : 0.48) ? 'f' : 'm';
}

export function makePersona(w: WorldState, f: Folk): Persona {
  const rng = new Rng(hashString(f.id) ^ w.seed);
  const bias = ROLE_BIAS[f.role] ?? {};
  const v = (k: Trait, base = 50) => Math.round(clamp((base + (bias[k] ?? 0) + rng.range(-32, 32)) / 100) * 100);
  const t = {} as Record<Trait, number>;
  t.amable = v('amable');
  t.desconfiado = v('desconfiado', 45 + (1 - f.honesty) * 20);
  t.ambicioso = v('ambicioso', 45);
  t.curioso = v('curioso');
  t.trabajador = v('trabajador', 55);
  t.orgulloso = v('orgulloso', 45);
  t.generoso = v('generoso', 0.6 * t.amable + 20);
  t.valiente = v('valiente');
  t.sociable = v('sociable');
  // Los opuestos no son simétricos del todo: se puede ser algo tímido y sociable.
  t.perezoso = Math.round(clamp((100 - t.trabajador + rng.range(-15, 15)) / 100) * 100);
  t.egoista = Math.round(clamp((100 - t.generoso + rng.range(-15, 15)) / 100) * 100);
  t.cobarde = Math.round(clamp((100 - t.valiente + rng.range(-15, 15)) / 100) * 100);
  t.reservado = Math.round(clamp((100 - t.sociable + rng.range(-12, 12)) / 100) * 100);
  t.timido = Math.round(clamp((t.reservado * 0.6 + rng.range(0, 40) - (f.role === 'lider' ? 25 : 0)) / 100) * 100);
  const coins = f.role === 'comerciante' || f.role === 'lider' ? rng.int(14, 30) : f.role === 'nino' ? rng.int(0, 2) : rng.int(3, 12);
  return {
    v: 1,
    tier: f.charId || f.role === 'lider' ? 1 : 2,
    t,
    needs: { comida: 0.7, dinero: 0.5, descanso: 0.7, seguridad: 0.7, trabajo: 0.7, vivienda: 0.8, relaciones: 0.5, ocio: 0.5 },
    emo: { felicidad: 0.4, tristeza: 0.1, miedo: 0.1, enojo: 0.1, estres: 0.2 },
    coins,
    goals: [],
    likes: rng.pick(LIKES),
    dislikes: rng.pick(DISLIKES),
    mem: [],
    events: [],
    jobs: [{ role: f.role, from: w.day - rng.int(5, 200) }],
    plans: [],
  };
}

/**
 * Da una persona a cada vecino que aún no la tiene y teje la red social de
 * cada pueblo: parejas que comparten casa, hijos, hermanos, amistades entre
 * vecinos y compañeros de oficio, y alguna enemistad vieja.
 */
export function ensurePeople(w: WorldState): void {
  const life = w.life!;
  const fresh: Folk[] = [];
  for (const f of life.folk) {
    if (!f.gender) f.gender = genderFor(f);
    if (!f.p) {
      f.p = makePersona(w, f);
      fresh.push(f);
    }
  }
  if (!fresh.length) return;
  const byRegion = new Map<number, Folk[]>();
  for (const f of fresh) if (f.alive) (byRegion.get(f.regionId) ?? byRegion.set(f.regionId, []).get(f.regionId)!).push(f);
  for (const [regionId, list] of byRegion) weave(w, life, regionId, list);
}

function weave(w: WorldState, life: Life, regionId: number, fresh: Folk[]): void {
  const rng = new Rng(w.seed ^ (regionId * 2246822519) ^ w.day);
  const all = life.folk.filter((f) => f.alive && f.regionId === regionId);
  // Hogares: se forman parejas, y los niños viven con una pareja (o con un adulto) que podría ser su familia.
  const free = rng.shuffle(fresh.filter((f) => f.age >= 18 && f.role !== 'lider' && !f.charId && !partnerOf(w, f.id)));
  const couples: [Folk, Folk][] = [];
  while (free.length > 1) {
    const x = free.shift()!;
    const j = free.findIndex((y) => Math.abs(y.age - x.age) <= 14 && (x.age < 60 || y.age >= 55));
    if (j < 0 || !rng.chance(0.68)) continue;
    const y = free.splice(j, 1)[0];
    y.house = x.house;
    const t = ensureTie(w, x.id, y.id);
    Object.assign(t, { kin: 'pareja', aff: rng.int(30, 88), fam: 92, since: w.day - rng.int(20, 300) });
    couples.push([x, y]);
  }
  const kids = fresh.filter((f) => f.age < 18);
  for (const k of kids) {
    const fit = couples.filter(([x, y]) => Math.min(x.age, y.age) - k.age >= 17 && Math.max(x.age, y.age) - k.age <= 45);
    const singleParent = all.filter((p) => p.age - k.age >= 17 && p.age - k.age <= 45 && p.age < 60 && !p.charId && p.role !== 'lider');
    const parents: Folk[] = fit.length ? [...rng.pick(fit)] : singleParent.length ? [rng.pick(singleParent)] : [];
    for (const p of parents) Object.assign(ensureTie(w, p.id, k.id), { kin: 'progenitor', parent: p.id, aff: rng.int(45, 95), fam: 95 });
    if (parents[0]) {
      k.house = parents[0].house;
      if (!k.parentId) k.parentId = parents[0].id;
    }
  }
  // Hermanos: los hijos de una misma casa.
  for (let i = 0; i < kids.length; i++)
    for (let j = i + 1; j < kids.length; j++) if (kids[i].house === kids[j].house && kids[i].parentId && kids[i].parentId === kids[j].parentId) Object.assign(ensureTie(w, kids[i].id, kids[j].id), { kin: 'hermanos', aff: rng.int(10, 80), fam: 90 });
  // Los mayores: algunos son padre o madre de un adulto del pueblo.
  for (const old of fresh.filter((f) => f.age >= 58 && !f.charId)) {
    const child = all.find((c) => c !== old && old.age - c.age >= 18 && old.age - c.age <= 42 && c.age >= 18 && !tiesOf(w, c.id).some((t) => t.kin === 'progenitor' && t.parent !== c.id));
    if (child && rng.chance(0.6)) Object.assign(ensureTie(w, old.id, child.id), { kin: 'progenitor', parent: old.id, aff: rng.int(10, 90), fam: 75 });
  }
  // Los hijos que ya se han ido de casa (el motor enlaza padre e hijo con parentId).
  for (const f of fresh) {
    const parent = f.parentId ? all.find((x) => x.id === f.parentId) : undefined;
    if (parent && !tieOf(w, parent.id, f.id)?.kin) Object.assign(ensureTie(w, parent.id, f.id), { kin: 'progenitor', parent: parent.id, aff: rng.int(30, 90), fam: 70 });
  }
  // Hermanos adultos: algunos vecinos de edad parecida son familia aunque no vivan juntos.
  const singles = all.filter((f) => f.age >= 18 && f.age < 60 && fresh.includes(f));
  for (let n = 0; n < Math.floor(singles.length / 5); n++) {
    const x = rng.pick(singles);
    const y = rng.pick(singles);
    if (x === y || Math.abs(x.age - y.age) > 12 || tieOf(w, x.id, y.id)?.kin) continue;
    Object.assign(ensureTie(w, x.id, y.id), { kin: 'hermanos', aff: rng.int(-20, 80), fam: rng.int(40, 80) });
  }
  // Conocidos: todos se conocen un poco; algunos son amigos, otros no se soportan.
  for (const f of fresh) {
    for (const o of all) {
      if (o === f || tieOf(w, f.id, o.id)) continue;
      const sameJob = o.role === f.role || (f.role === 'comerciante' && (o.role === 'campesino' || o.role === 'artesano'));
      const near = Math.abs(o.house - f.house) <= 1;
      const compat = compatibility(f, o);
      const fam = rng.int(8, 30) + (sameJob ? 20 : 0) + (near ? 15 : 0);
      const aff = Math.round(compat * 40 + rng.range(-20, 25) + (sameJob ? 5 : 0));
      if (fam < 14 && Math.abs(aff) < 20) continue;
      const t = ensureTie(w, f.id, o.id);
      Object.assign(t, { aff, fam, since: w.day - rng.int(10, 400), work: sameJob && f.role !== 'nino' });
    }
  }
}

/** Cuánto encajan dos caracteres (-1..1): los amables con los amables, los orgullosos chocan. */
export function compatibility(a: Folk, b: Folk): number {
  const d = (k: Trait) => Math.abs(trait(a, k) - trait(b, k)) / 100;
  const warm = (trait(a, 'amable') + trait(b, 'amable')) / 200;
  const pride = (trait(a, 'orgulloso') + trait(b, 'orgulloso')) / 200;
  const social = 1 - d('sociable');
  return clamp(warm * 0.9 + social * 0.4 - pride * 0.7 - d('ambicioso') * 0.3 - 0.15, -1, 1);
}

// ---------------------------------------------------------------------------
// Emoción y expresión
// ---------------------------------------------------------------------------
export function emotionOf(f: Folk): Emotion {
  const e = f.p?.emo;
  if (!e) return 'calma';
  let best: Feeling = 'felicidad';
  for (const k of ['tristeza', 'miedo', 'enojo', 'estres', 'felicidad'] as Feeling[]) if (e[k] > e[best]) best = k;
  if (e[best] < 0.35) return 'calma';
  return best;
}

export const EMOTION_WORD: Record<Emotion, string> = { felicidad: 'de buen humor', tristeza: 'con el ánimo por los suelos', miedo: 'con miedo', enojo: 'de mal humor', estres: 'con mucho agobio', calma: 'en calma' };

/** La región en la que está el jugador ahora mismo. */
export function playerRegion(w: WorldState): number {
  const l = getLayout(w);
  const me = w.life!.player;
  const r = l.terrain.region[Math.floor(me.y) * 500 + Math.floor(me.x)];
  return r >= 0 ? r : w.player.home;
}

/** Los vecinos que importan para la historia: más memoria, objetivos y conversación propia. */
export function promote(f: Folk): void {
  if (f.p) f.p.tier = 1;
}

export function shortName(w: WorldState, id: string): string {
  if (id === 'jugador') return 'el forastero';
  return folkById(w, id)?.name ?? 'alguien';
}
