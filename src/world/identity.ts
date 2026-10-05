import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import { personName } from '../core/content/names';
import { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import type { Life } from './types';

/**
 * Identidad del protagonista. Despierta sin memoria y sin autoridad: no
 * sabe quién es, qué sabe hacer ni de dónde viene. Se convierte en lo que
 * hace. Las habilidades (lo que puede hacer) y los conocimientos (lo que
 * comprende) aparecen al usarlos; algunos vienen de un pasado olvidado y
 * despiertan de golpe. Su reputación en cada pueblo le abre puertas, y solo
 * con el tiempo puede llegar a tener voz en el consejo… o no. Todo queda en
 * su propia crónica.
 */

// ---------------------------------------------------------------------------
// Habilidades y conocimientos
// ---------------------------------------------------------------------------
export type SkillId = 'combate' | 'agricultura' | 'artesania' | 'comercio' | 'diplomacia' | 'persuasion' | 'medicina' | 'supervivencia' | 'liderazgo' | 'sigilo' | 'investigacion';
export type KnowId = 'historia' | 'geografia' | 'politica' | 'medicina' | 'agricultura' | 'tecnologia' | 'culturas' | 'idiomas' | 'economia';

export const SKILLS: Record<SkillId, { name: string; icon: string; first: string }> = {
  combate: { name: 'Combate', icon: '⚔', first: 'Tus pies se colocan solos. Sabes guardar la distancia.' },
  agricultura: { name: 'Agricultura', icon: '🌾', first: 'La azada pesa menos de lo que esperabas.' },
  artesania: { name: 'Artesanía y reparación', icon: '🔨', first: 'Algo en tus manos parece recordar cómo hacerlo.' },
  comercio: { name: 'Comercio', icon: '⚖', first: 'Los números salen solos: sabes lo que vale cada cosa.' },
  diplomacia: { name: 'Diplomacia', icon: '🤝', first: 'Encuentras las palabras que calman a ambas partes.' },
  persuasion: { name: 'Persuasión', icon: '🗣', first: 'Tu respuesta suena más convincente de lo que pensabas.' },
  medicina: { name: 'Medicina', icon: '🌿', first: 'Sabes dónde apretar y qué hierba usar.' },
  supervivencia: { name: 'Supervivencia y exploración', icon: '🧭', first: 'Lees el terreno como si lo hubieras hecho siempre.' },
  liderazgo: { name: 'Liderazgo', icon: '🔥', first: 'Hablas y la gente se mueve. Te sorprende.' },
  sigilo: { name: 'Sigilo y engaño', icon: '🌒', first: 'Mientes sin que te tiemble la voz. Eso te inquieta.' },
  investigacion: { name: 'Investigación', icon: '🔎', first: 'Ves la contradicción antes que nadie.' },
};

export const KNOWS: Record<KnowId, { name: string; icon: string }> = {
  historia: { name: 'Historia', icon: '📜' },
  geografia: { name: 'Geografía', icon: '🗺' },
  politica: { name: 'Política', icon: '🏛' },
  medicina: { name: 'Saber médico', icon: '⚕' },
  agricultura: { name: 'Saber agrícola', icon: '🌱' },
  tecnologia: { name: 'Técnica', icon: '⚙' },
  culturas: { name: 'Culturas', icon: '🎭' },
  idiomas: { name: 'Idiomas', icon: '💬' },
  economia: { name: 'Economía', icon: '🪙' },
};

/** Experiencia necesaria para cada nivel (0 = aún no descubierto). */
export const LEVEL_XP = [0, 1, 5, 12, 24, 40];
export const MAX_LEVEL = LEVEL_XP.length - 1;

export interface Trait {
  xp: number;
  level: number;
  found: number; // día en que se descubrió (-1: aún no)
  past?: boolean; // despertó de un pasado olvidado
}

// ---------------------------------------------------------------------------
// Talentos únicos: combinaciones que cambian la forma de jugar
// ---------------------------------------------------------------------------
export type TalentId = 'lectura' | 'superviviente' | 'comandante' | 'mercader' | 'investigador' | 'sanador' | 'lengua' | 'sombra';

interface TalentDef {
  name: string;
  desc: string;
  skills: Partial<Record<SkillId, number>>;
  know?: Partial<Record<KnowId, number>>;
}

export const TALENTS: Record<TalentId, TalentDef> = {
  lectura: { name: 'Lectura política', desc: 'Lees lo que quieren de verdad quienes mandan: sus miedos y ambiciones salen en la conversación.', skills: { diplomacia: 3, comercio: 2 }, know: { politica: 3 } },
  superviviente: { name: 'Superviviente', desc: 'El hambre te pesa la mitad y sabes encontrar comida en el campo.', skills: { supervivencia: 3, medicina: 2 }, know: { geografia: 2 } },
  comandante: { name: 'Comandante', desc: 'En las crisis la gente te sigue: puedes organizar a los vecinos y la guardia te escucha aunque no tengas cargo.', skills: { combate: 3, liderazgo: 3 } },
  mercader: { name: 'Ojo de mercader', desc: 'Compras más barato, vendes más caro y adivinas cuánto guarda cada almacén.', skills: { comercio: 3 }, know: { economia: 2 } },
  investigador: { name: 'Mirada de investigador', desc: 'Notas cuándo te mienten y separas el rumor de la verdad.', skills: { investigacion: 3, sigilo: 2 }, know: { historia: 2 } },
  sanador: { name: 'Manos de sanador', desc: 'Puedes atender a los enfermos de un pueblo y frenar una fiebre.', skills: { medicina: 4 }, know: { medicina: 3 } },
  lengua: { name: 'Lengua de plata', desc: 'Convences incluso a quien te guarda rencor.', skills: { persuasion: 4, diplomacia: 2 } },
  sombra: { name: 'Sombra', desc: 'Escuchas lo que se decide a puerta cerrada sin que nadie te vea.', skills: { sigilo: 4 }, know: { politica: 1 } },
};

// ---------------------------------------------------------------------------
// El pasado olvidado
// ---------------------------------------------------------------------------
export type PastRole = 'soldado' | 'mercader' | 'erudito' | 'explorador' | 'sanador' | 'consejero' | 'espia';

export interface Past {
  role: PastRole;
  origin: number; // región de la que viene
  deed: 'bueno' | 'terrible';
  trueName: string;
  family: boolean;
  symbol: string; // lo que hay grabado en el colgante
  link?: string; // vecino de su tierra que le conoció
}

const ROLE_LATENT: Record<PastRole, [string, number][]> = {
  soldado: [['combate', 3], ['liderazgo', 1], ['k:geografia', 1]],
  mercader: [['comercio', 3], ['persuasion', 1], ['k:economia', 2]],
  erudito: [['investigacion', 2], ['k:historia', 3], ['k:idiomas', 2]],
  explorador: [['supervivencia', 3], ['k:geografia', 3], ['medicina', 1]],
  sanador: [['medicina', 3], ['k:medicina', 2], ['k:agricultura', 1]],
  consejero: [['diplomacia', 3], ['persuasion', 2], ['k:politica', 3]],
  espia: [['sigilo', 3], ['investigacion', 1], ['persuasion', 2]],
};

/** Edificio que despierta un recuerdo según lo que fue. */
export const ROLE_OBJECT: Record<PastRole, string> = {
  soldado: 'forja',
  mercader: 'almacen',
  erudito: 'templo',
  explorador: 'cruce',
  sanador: 'templo',
  consejero: 'salon',
  espia: 'posada',
};

export const SYMBOLS = ['dos líneas cruzadas sobre un círculo', 'un ojo abierto dentro de un triángulo', 'una espiga partida', 'tres olas superpuestas', 'una torre con una estrella encima', 'una mano abierta con una llave', 'un ciervo con la cornamenta en llamas'];

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
export type StoryKind = 'despertar' | 'habilidad' | 'conocimiento' | 'talento' | 'memoria' | 'logro' | 'decision' | 'relacion' | 'lugar' | 'error' | 'cargo';

export interface StoryEntry {
  day: number;
  age: number;
  text: string;
  kind: StoryKind;
}

export interface Offer {
  regionId: number;
  level: number; // cargo que te ofrecen
  day: number;
}

export interface Identity {
  v: 1;
  mode: 'forastero' | 'gobernante'; // las partidas antiguas empiezan gobernando
  named: boolean; // conoce su verdadero nombre
  nickname: string;
  skills: Record<SkillId, Trait>;
  know: Record<KnowId, Trait>;
  latent: Record<string, number>; // aptitudes del pasado (ocultas): 'combate', 'k:historia'…
  talents: TalentId[];
  past: Past | null;
  fragments: { id: string; day: number; choice?: string }[];
  needs: { hunger: number; fatigue: number; coins: number; warned: number };
  items: string[]; // objetos con historia (el colgante…)
  housed: boolean; // tiene una casa donde dormir
  deeds: Record<string, number>; // trabajar, ayudar, engañar, comerciar, estudiar, explorar, curar, combatir, crisis…
  score: Record<number, number>; // reputación ganada en cada región
  rank: Record<number, number>; // cargo aceptado en cada región (≥4)
  standing: Record<number, number>; // nivel de reconocimiento por región (0..6)
  offers: Offer[];
  declined: Record<string, number>; // `${región}:${nivel}` → día en que lo rechazaste
  vow?: number; // promesa de reparar el daño en una región
  story: StoryEntry[];
  lives: { name: string; story: StoryEntry[] }[]; // vidas anteriores del linaje
  worked: Record<string, number>; // vecino → último día en que trabajaste con él
  inbox?: string[]; // noticias sobre ti pendientes de contar
  temper?: string; // carácter (los herederos lo traen de nacimiento)
  /** Lo que la edad y la salud hacen al cuerpo y a la mente (Fase 5; lo escribe generations.ts cada día). */
  vigor?: { body: number; mind: number; learn: number; teach: number; social: number };
}

const blankTraits = <K extends string>(ids: K[]): Record<K, Trait> => Object.fromEntries(ids.map((k) => [k, { xp: 0, level: 0, found: -1 }])) as Record<K, Trait>;

export const STANDING: { name: string; hint: string }[] = [
  { name: 'Desconocido', hint: 'Nadie sabe quién eres.' },
  { name: 'Conocido', hint: 'Te saludan por la calle.' },
  { name: 'Apreciado', hint: 'Te abren la puerta y te dan trabajo.' },
  { name: 'De confianza', hint: 'Te piden opinión; puedes asistir al consejo como oyente.' },
  { name: 'Consejero', hint: 'Tu voz cuenta: puedes enviar emisarios e investigar en nombre del pueblo.' },
  { name: 'Miembro del consejo', hint: 'Votas leyes, comercio y ayuda a otros pueblos.' },
  { name: 'Líder', hint: 'Hablas en nombre de todos: alianzas, guerras y fronteras.' },
];

/** Reputación necesaria para cada nivel. */
const STANDING_SCORE = [0, 3, 10, 22, 40, 65, 95];

export function identityOf(life: Life): Identity {
  return life.identity!;
}

/** Identidad nueva: alguien que despierta sin recordar nada. */
export function createIdentity(w: WorldState, life: Life): Identity {
  const rng = new Rng(w.seed ^ 0x51ed27);
  const others = w.regions.filter((r) => !r.isHome && !r.abandoned);
  const home = w.regions[w.player.home];
  // Su tierra es una región lejana: el camino de vuelta forma parte de la historia.
  const far = [...others].sort((a, b) => Math.hypot(b.center.x - home.center.x, b.center.y - home.center.y) - Math.hypot(a.center.x - home.center.x, a.center.y - home.center.y));
  const origin = far[rng.int(0, Math.min(2, far.length - 1))] ?? home;
  const culture = CULTURES.find((c) => c.id === origin.culture) ?? PLAYER_CULTURE;
  const role = rng.pick<PastRole>(['soldado', 'mercader', 'erudito', 'explorador', 'sanador', 'consejero', 'espia']);
  const past: Past = {
    role,
    origin: origin.id,
    deed: rng.chance(0.5) ? 'bueno' : 'terrible',
    trueName: personName(rng, culture.syllables, new Set(life.folk.map((f) => f.name))),
    family: rng.chance(0.6),
    symbol: SYMBOLS[(origin.id * 3 + culture.id.length) % SYMBOLS.length],
  };
  const latent: Record<string, number> = {};
  for (const [k, v] of ROLE_LATENT[role]) latent[k] = v;
  // Un talento escondido que nadie esperaría.
  const odd = rng.pick<SkillId>(['artesania', 'agricultura', 'medicina', 'sigilo', 'persuasion']);
  latent[odd] = Math.max(latent[odd] ?? 0, 2);
  return {
    v: 1,
    mode: 'forastero',
    named: false,
    nickname: 'Sin nombre',
    skills: blankTraits(Object.keys(SKILLS) as SkillId[]),
    know: blankTraits(Object.keys(KNOWS) as KnowId[]),
    latent,
    talents: [],
    past,
    fragments: [],
    needs: { hunger: 0.35, fatigue: 0.1, coins: 0, warned: 0 },
    items: ['colgante'],
    housed: false,
    deeds: {},
    score: {},
    rank: {},
    standing: {},
    offers: [],
    declined: {},
    story: [],
    lives: [],
    worked: {},
  };
}

/** Partidas anteriores a este cambio: siguen gobernando como antes. */
export function legacyIdentity(w: WorldState, life: Life): Identity {
  const id: Identity = {
    v: 1,
    mode: 'gobernante',
    named: true,
    nickname: life.player.name,
    skills: blankTraits(Object.keys(SKILLS) as SkillId[]),
    know: blankTraits(Object.keys(KNOWS) as KnowId[]),
    latent: {},
    talents: [],
    past: null,
    fragments: [],
    needs: { hunger: 0.2, fatigue: 0.2, coins: 8, warned: 0 },
    items: [],
    housed: true,
    deeds: {},
    score: { [w.player.home]: 120 },
    rank: { [w.player.home]: 6 },
    standing: { [w.player.home]: 6 },
    offers: [],
    declined: {},
    story: [],
    lives: [],
    worked: {},
  };
  for (const [k, lv] of [['diplomacia', 2], ['liderazgo', 2]] as const) id.skills[k] = { xp: LEVEL_XP[lv], level: lv, found: w.day };
  id.know.politica = { xp: LEVEL_XP[2], level: 2, found: w.day };
  return id;
}

// ---------------------------------------------------------------------------
// Crónica personal
// ---------------------------------------------------------------------------
export function story(w: WorldState, text: string, kind: StoryKind): void {
  const life = w.life;
  if (!life?.identity) return;
  const id = life.identity;
  const last = id.story[id.story.length - 1];
  if (last && last.text === text) return;
  id.story.push({ day: w.day, age: life.player.age, text, kind });
}

/** Una línea de la crónica, contada en tercera persona como en un libro. */
export function storyLine(e: StoryEntry): string {
  return `A los ${e.age} años, ${e.text.charAt(0).toLowerCase()}${e.text.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Aprender haciendo
// ---------------------------------------------------------------------------
export function levelOf(id: Identity, key: SkillId | `k:${KnowId}`): number {
  if (key.startsWith('k:')) return id.know[key.slice(2) as KnowId]?.level ?? 0;
  return id.skills[key as SkillId]?.level ?? 0;
}

/** Probabilidad de éxito de algo según la habilidad (difficulty 0 fácil … 3 muy difícil). */
export function chanceOf(id: Identity, skill: SkillId, difficulty = 1): number {
  const lv = id.skills[skill].level;
  // La edad cuenta: el cuerpo para lo físico, la experiencia para lo demás.
  const v = id.vigor;
  const age = v ? (['combate', 'agricultura', 'artesania', 'supervivencia', 'sigilo'].includes(skill) ? (v.body - 1) * 0.3 : (v.mind - 1) * 0.35) : 0;
  return Math.max(0.08, Math.min(0.95, 0.42 + lv * 0.13 - difficulty * 0.12 + age));
}

export interface GainNote {
  text: string;
  big?: boolean; // descubrimiento importante (banner)
}

/**
 * Practicar algo. La primera vez se descubre; si viene del pasado, despierta
 * de golpe a un nivel que el personaje no recuerda haber alcanzado.
 */
export function gain(w: WorldState, key: SkillId | `k:${KnowId}`, amount: number): GainNote[] {
  const life = w.life;
  if (!life?.identity) return [];
  const id = life.identity;
  const isKnow = key.startsWith('k:');
  const k = isKnow ? key.slice(2) : key;
  const t: Trait = isKnow ? id.know[k as KnowId] : id.skills[k as SkillId];
  if (!t) return [];
  const latent = id.latent[key] ?? 0;
  const notes: GainNote[] = [];
  const before = t.level;
  // Se aprende más deprisa de joven; los saberes, mejor con los años.
  const v = id.vigor;
  const pace = v ? (isKnow ? (v.learn + v.mind) / 2 : v.learn) : 1;
  t.xp += amount * (1 + latent * 0.35) * pace;
  let lv = 0;
  for (let i = 1; i <= MAX_LEVEL; i++) if (t.xp >= LEVEL_XP[i]) lv = i;
  const name = isKnow ? KNOWS[k as KnowId].name : SKILLS[k as SkillId].name;
  if (before === 0 && lv >= 1) {
    t.found = w.day;
    if (latent > 0) {
      // Despierta del pasado: más de lo que debería saber alguien que empieza.
      lv = Math.max(lv, latent);
      t.xp = Math.max(t.xp, LEVEL_XP[lv]);
      t.past = true;
      const msg = isKnow ? `Lo sabes. No recuerdas haberlo aprendido nunca.` : SKILLS[k as SkillId].first;
      notes.push({ text: `${msg} ${isKnow ? 'Conocimiento' : 'Talento'} descubierto: ${name} (nivel ${lv}).`, big: true });
      story(w, `Descubrió que sabía ${isKnow ? `de ${name.toLowerCase()}` : name.toLowerCase()} sin recordar haberlo aprendido.`, isKnow ? 'conocimiento' : 'habilidad');
      delete id.latent[key];
      fragmentFromSkill(w, key);
    } else {
      notes.push({ text: `Has adquirido conocimientos básicos de ${name.toLowerCase()}.` });
      if (!isKnow) story(w, `Empezó a aprender ${name.toLowerCase()}.`, 'habilidad');
    }
  } else if (lv > before) {
    notes.push({ text: `${name}: nivel ${lv}.`, big: lv >= 3 });
    if (lv >= 3) story(w, `Ya dominaba ${isKnow ? `la ${name.toLowerCase()}` : `el arte de ${name.toLowerCase()}`} (nivel ${lv}).`, isKnow ? 'conocimiento' : 'habilidad');
  }
  t.level = lv;
  for (const n of checkTalents(w)) notes.push(n);
  return notes;
}

export function hasTalent(id: Identity | undefined, t: TalentId): boolean {
  return !!id?.talents.includes(t);
}

function checkTalents(w: WorldState): GainNote[] {
  const id = w.life!.identity!;
  const out: GainNote[] = [];
  for (const [tid, def] of Object.entries(TALENTS) as [TalentId, TalentDef][]) {
    if (id.talents.includes(tid)) continue;
    const ok = Object.entries(def.skills).every(([s, n]) => id.skills[s as SkillId].level >= (n ?? 0)) && Object.entries(def.know ?? {}).every(([s, n]) => id.know[s as KnowId].level >= (n ?? 0));
    if (!ok) continue;
    id.talents.push(tid);
    out.push({ text: `Talento único: ${def.name}. ${def.desc}`, big: true });
    story(w, `Se convirtió en alguien con un don poco común: ${def.name.toLowerCase()}.`, 'talento');
  }
  return out;
}

export function deed(id: Identity, kind: string, n = 1): void {
  id.deeds[kind] = (id.deeds[kind] ?? 0) + n;
}

/** Lo que más ha hecho: «se convierte en lo que hace». */
export function whoAmI(id: Identity): string {
  const top = (Object.entries(id.skills) as [SkillId, Trait][]).filter(([, t]) => t.level > 0).sort((a, b) => b[1].xp - a[1].xp);
  if (!top.length) return 'Aún no sabes qué se te da bien.';
  const words: Record<SkillId, string> = {
    combate: 'alguien que sabe pelear', agricultura: 'gente del campo', artesania: 'alguien de manos hábiles', comercio: 'alguien que sabe tratar',
    diplomacia: 'alguien que sabe mediar', persuasion: 'alguien de buena palabra', medicina: 'alguien que cura', supervivencia: 'alguien de los caminos',
    liderazgo: 'alguien a quien siguen', sigilo: 'alguien de quien no te puedes fiar del todo', investigacion: 'alguien que hace preguntas',
  };
  const a = words[top[0][0]];
  const b = top[1] ? words[top[1][0]] : '';
  return b ? `Te ven como ${a}, y también como ${b}.` : `Te ven como ${a}.`;
}

// ---------------------------------------------------------------------------
// Necesidades: comer, descansar, ganarse la vida
// ---------------------------------------------------------------------------
export interface NeedsTick {
  notes: string[];
  faint: boolean;
}

/** Hambre y cansancio con el paso del tiempo (despierto). */
export function tickNeeds(id: Identity, minutes: number): NeedsTick {
  if (id.mode === 'gobernante') return { notes: [], faint: false };
  const n = id.needs;
  const h = minutes / 60;
  n.hunger = Math.min(1, n.hunger + h * 0.05 * (hasTalent(id, 'superviviente') ? 0.5 : 1));
  n.fatigue = Math.min(1, n.fatigue + h * 0.03 * (id.vigor ? 1.45 - id.vigor.body * 0.45 : 1));
  const notes: string[] = [];
  const level = n.hunger >= 0.95 || n.fatigue >= 0.95 ? 3 : n.hunger >= 0.8 || n.fatigue >= 0.85 ? 2 : n.hunger >= 0.6 ? 1 : 0;
  if (level > n.warned) {
    if (level === 1) notes.push('Te ruge el estómago. Tendrás que comer algo.');
    if (level === 2) notes.push(n.hunger >= 0.8 ? 'Tienes hambre de verdad. Te cuesta concentrarte.' : 'Estás agotado. Necesitas dormir.');
    if (level === 3) notes.push('Te flaquean las piernas. Si no comes o descansas, te vas a desplomar.');
  }
  n.warned = level;
  return { notes, faint: n.hunger >= 1 || n.fatigue >= 1 };
}

export function eat(id: Identity, amount = 0.55): void {
  id.needs.hunger = Math.max(0, id.needs.hunger - amount);
  id.needs.warned = 0;
}

export function rest(id: Identity, full: boolean): void {
  id.needs.fatigue = full ? 0 : Math.max(0, id.needs.fatigue - 0.35);
  id.needs.warned = 0;
}

/** Más lento con hambre o cansancio. */
export function speedFactor(id: Identity | undefined): number {
  if (!id || id.mode === 'gobernante') return 1;
  const age = id.vigor ? 0.7 + Math.min(1, id.vigor.body) * 0.3 : 1;
  return (id.needs.hunger >= 0.85 || id.needs.fatigue >= 0.85 ? 0.72 : 1) * age;
}

// ---------------------------------------------------------------------------
// Reputación, reconocimiento y cargos
// ---------------------------------------------------------------------------
export function addScore(w: WorldState, regionId: number, amount: number): void {
  const id = w.life?.identity;
  if (!id) return;
  id.score[regionId] = (id.score[regionId] ?? 0) + amount * (id.vow === regionId && amount > 0 ? 1.5 : 1);
}

/** Lo que la gente de un pueblo piensa de ti: lo ganado + cómo te recuerdan los vecinos. */
export function reputation(w: WorldState, regionId: number): number {
  const life = w.life!;
  const id = life.identity!;
  const gen = life.player.generation;
  let s = id.score[regionId] ?? 0;
  for (const f of life.folk) {
    if (!f.alive || f.regionId !== regionId || f.lastMet < 0) continue;
    s += 0.6 + (f.gratitude - 0.1) * 4 + (f.trust - 0.5) * 3 - f.resentment * 4;
    for (const m of f.memories) if (m.gen === gen) s += m.weight * 2;
  }
  return s;
}

export function standingOf(w: WorldState, regionId: number): number {
  return w.life?.identity?.standing[regionId] ?? 0;
}

export interface StandingNews {
  text: string;
  regionId: number;
}

/**
 * Recalcula el reconocimiento. Hasta «de confianza» llega solo; los cargos
 * (consejero, miembro del consejo, líder) hay que aceptarlos cuando te los
 * ofrecen, y para el consejo hace falta haber ayudado en una crisis.
 */
export function updateStanding(w: WorldState): StandingNews[] {
  const life = w.life;
  const id = life?.identity;
  if (!life || !id) return [];
  const news: StandingNews[] = [];
  for (const r of w.regions) {
    if (id.mode === 'gobernante' && r.isHome) continue;
    const rep = reputation(w, r.id);
    let byScore = 0;
    for (let i = 1; i < STANDING_SCORE.length; i++) if (rep >= STANDING_SCORE[i]) byScore = i;
    const before = id.standing[r.id] ?? 0;
    let rank = id.rank[r.id] ?? 0;
    // Perder la confianza cuesta el cargo.
    // (Quien gobierna por elección o por la fuerza no pierde el cargo así: lo pierde en las urnas o en la calle.)
    const governs = w.life?.politics?.govs[r.id]?.ruler === 'jugador';
    if (governs) rank = id.rank[r.id] = 6;
    if (rank >= 4 && byScore < rank - 1 && !governs) {
      news.push({ regionId: r.id, text: `El consejo de ${r.name} te retira su confianza. Ya no hablas en su nombre.` });
      story(w, `Perdió su lugar en el consejo de ${r.name}.`, 'error');
      rank = id.rank[r.id] = Math.max(0, byScore >= 4 ? 4 : 0);
    }
    const now = Math.max(Math.min(3, byScore), rank);
    if (now > before && now <= 3) {
      news.push({ regionId: r.id, text: now === 1 ? `En ${r.name} ya saben quién eres.` : now === 2 ? `En ${r.name} te aprecian. Te abren la puerta.` : `En ${r.name} confían en ti. Te piden opinión.` });
      story(w, now === 1 ? `Empezaron a conocerle en ${r.name}.` : now === 2 ? `Se ganó el aprecio de la gente de ${r.name}.` : `Se ganó la confianza de ${r.name}.`, 'relacion');
    }
    id.standing[r.id] = now;
    // Ofertas de cargos: llegan, no se piden.
    const next = now + 1;
    if (next >= 4 && next <= 6 && byScore >= next && !id.offers.some((o) => o.regionId === r.id)) {
      const declinedDay = id.declined[`${r.id}:${next}`];
      const needsCrisis = next >= 5 && (id.deeds[`crisis:${r.id}`] ?? 0) < 1;
      const isLeader = next === 6;
      const chance = isLeader ? 0.2 : 0.5;
      if (!needsCrisis && (declinedDay === undefined || w.day - declinedDay > 12) && pseudo(w.day * 31 + r.id * 7 + next) < chance) {
        id.offers.push({ regionId: r.id, level: next, day: w.day });
        news.push({ regionId: r.id, text: next === 4 ? `En el salón de ${r.name} preguntan por ti. Quieren tu consejo.` : next === 5 ? `El consejo de ${r.name} quiere que te sientes con ellos.` : `En ${r.name} hay quien dice tu nombre para dirigir el pueblo.` });
      }
    }
  }
  syncAuthority(w);
  return news;
}

function pseudo(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Aceptar o rechazar un cargo. Rechazar también es una forma de decidir quién eres. */
export function answerOffer(w: WorldState, regionId: number, accept: boolean): string {
  const id = w.life!.identity!;
  const o = id.offers.find((x) => x.regionId === regionId);
  if (!o) return 'Ya no hay nada que responder.';
  id.offers = id.offers.filter((x) => x !== o);
  const r = w.regions[regionId];
  const title = STANDING[o.level].name.toLowerCase();
  if (!accept) {
    id.declined[`${regionId}:${o.level}`] = w.day;
    story(w, `Rechazó convertirse en ${title} de ${r.name}.`, 'decision');
    return `Les das las gracias, pero no. «Si cambias de idea, aquí estaremos.»`;
  }
  id.rank[regionId] = o.level;
  id.standing[regionId] = Math.max(id.standing[regionId] ?? 0, o.level);
  story(w, o.level === 6 ? `Fue elegido para dirigir ${r.name}.` : `Aceptó ser ${title} de ${r.name}.`, 'cargo');
  syncAuthority(w);
  return o.level === 6 ? `Ahora diriges ${r.name}. Lo que decidas, lo recordarán.` : o.level === 5 ? `Te sientas en el consejo de ${r.name}. Tu voto cuenta.` : `Desde hoy eres consejero en ${r.name}. Te escucharán.`;
}

/** El motor solo deja hacer lo que tu cargo permite en el pueblo donde despertaste. */
export function syncAuthority(w: WorldState): void {
  const id = w.life?.identity;
  if (!id) return;
  if (id.mode === 'gobernante') {
    delete w.player.authority;
    return;
  }
  w.player.authority = id.standing[w.player.home] ?? 0;
}

// ---------------------------------------------------------------------------
// Fragmentos de memoria
// ---------------------------------------------------------------------------
export type FragmentTrigger =
  | { kind: 'colgante' }
  | { kind: 'edificio'; building: string; regionId: number }
  | { kind: 'posada'; regionId: number; hour: number }
  | { kind: 'dormir' }
  | { kind: 'region'; regionId: number }
  | { kind: 'hablar'; folkId: string };

export interface FragmentEvent {
  id: string;
  title: string;
  lines: string[];
  choices?: { id: string; label: string }[];
}

const has = (id: Identity, frag: string) => id.fragments.some((f) => f.id === frag);

function remembered(w: WorldState, frag: string, text: string): void {
  const id = w.life!.identity!;
  id.fragments.push({ id: frag, day: w.day });
  story(w, text, 'memoria');
}

/** ¿Despierta algún recuerdo? Cada fragmento aparece una sola vez. */
export function tryFragment(w: WorldState, trig: FragmentTrigger): FragmentEvent | null {
  const life = w.life;
  const id = life?.identity;
  const past = id?.past;
  if (!life || !id || !past || id.mode === 'gobernante') return null;
  const O = w.regions[past.origin];
  const n = id.fragments.length;
  switch (trig.kind) {
    case 'colgante':
      if (has(id, 'colgante')) return { id: 'colgante', title: 'El colgante', lines: [`Metal oscuro, gastado por los dedos. ${past.symbol.charAt(0).toUpperCase()}${past.symbol.slice(1)}.`, has(id, 'lugar') ? `Ahora sabes que es el símbolo de ${O.name}.` : 'Sigues sin saber qué significa.'] };
      remembered(w, 'colgante', 'Examinó el colgante que llevaba al despertar: un símbolo que no reconocía.');
      return {
        id: 'colgante',
        title: 'El colgante',
        lines: ['Lo llevabas al cuello cuando despertaste. Metal oscuro, gastado de tanto tocarlo.', `Grabado en él: ${past.symbol}.`, 'No sabes qué significa. Pero tus dedos lo buscan cada vez que algo te inquieta.'],
      };
    case 'edificio': {
      const want = ROLE_OBJECT[past.role];
      if (has(id, 'objeto') || trig.building !== want || w.day < 2) return null;
      const T: Record<PastRole, string[]> = {
        soldado: ['En la pared de la forja cuelga una espada de hoja estrecha.', 'La coges sin pensar. El peso, el equilibrio… tu muñeca gira sola y la hoja silba.', 'El herrero te mira de reojo: «Eso no se aprende en un día.»'],
        mercader: ['Sobre una caja del almacén hay un sello de cera con las marcas de un gremio.', 'Sin querer, calculas lo que vale todo lo que hay en la sala. Y aciertas.', '¿Dónde aprendiste a contar así?'],
        erudito: ['En una columna del templo hay una inscripción en una lengua antigua.', 'La lees en voz baja, de corrido. El sacerdote se queda mudo: «Nadie aquí sabe leer eso.»'],
        explorador: ['En el poste del cruce hay un mapa tallado, medio borrado.', 'Tu dedo sigue un camino que no figura en él. Sabes que existe. Sabes adónde lleva.'],
        sanador: ['En el templo, una mujer gime con la pierna hinchada.', 'Antes de pensarlo ya estás pidiendo agua caliente y nombrando hierbas que no recordabas conocer.'],
        consejero: ['En el salón, alguien lee en voz alta un acuerdo entre pueblos.', 'Sabes, sin saber por qué, cuál de las cláusulas es una trampa. Y quién la escribió.'],
        espia: ['En la posada, dos hombres se pasan una nota doblada de una forma muy concreta.', 'Reconoces el doblez. Es una señal. Y tú sabías leerla.'],
      };
      remembered(w, 'objeto', 'Algo de su vida anterior asomó: reconoció lo que nunca recordaba haber visto.');
      return { id: 'objeto', title: 'Algo que conoces', lines: [...T[past.role], '¿Quién eras?'] };
    }
    case 'posada':
      if (has(id, 'cancion') || trig.hour < 19 || w.day < 3) return null;
      remembered(w, 'cancion', `Oyó una canción de ${O.name} y supo cómo terminaba.`);
      return {
        id: 'cancion',
        title: 'Una canción',
        lines: [`Un viajero canta junto al fuego. Habla de ${O.name}, de sus colinas y de la gente que se fue.`, 'Antes de que llegue el último verso, tus labios ya lo están diciendo.', `El viajero te mira: «¿Eres de ${O.name}? Hablas como ellos.»`],
      };
    case 'dormir':
      if (n >= 1 && !has(id, 'sueno') && w.day >= 3) {
        remembered(w, 'sueno', 'Soñó con una vida que no recordaba.');
        return {
          id: 'sueno',
          title: 'Un sueño',
          lines: past.family ? ['Sueñas con una casa de piedra y una voz que te llama por un nombre que no entiendes.', 'Hay alguien más contigo. Pequeño. Te tira de la manga.', 'Al despertar, el nombre se te escapa como agua entre los dedos.'] : ['Sueñas con fuego y con gente corriendo. Tú das órdenes. O las recibes.', past.deed === 'terrible' ? 'Hay humo. Y una sensación de culpa que te dura toda la mañana.' : 'Alguien te da las gracias llorando. No sabes por qué.'],
        };
      }
      if (has(id, 'persona') && !has(id, 'verdad')) return revealTruth(w);
      return null;
    case 'region':
      if (trig.regionId !== past.origin || has(id, 'lugar')) return null;
      remembered(w, 'lugar', `Llegó a ${O.name} y reconoció el camino.`);
      return {
        id: 'lugar',
        title: O.name,
        lines: ['Este camino… Sabes qué hay detrás de la próxima curva antes de verlo.', `En la entrada del pueblo hay un símbolo tallado en piedra: ${past.symbol}. El mismo de tu colgante.`, 'Aquí empezó todo. O aquí terminó.'],
      };
    case 'hablar': {
      if (trig.folkId !== past.link) return null;
      if (!has(id, 'persona')) {
        remembered(w, 'persona', `Alguien de ${O.name} le reconoció y le dijo su verdadero nombre: ${past.trueName}.`);
        const f = life.folk.find((x) => x.id === past.link);
        return {
          id: 'persona',
          title: '¿Eres tú?',
          lines: [`${f?.name ?? 'Alguien'} se queda blanco al verte. «¿${past.trueName}? Te dimos por muerto hace dos inviernos.»`, `«Eras ${roleWord(past.role)}. Te fuiste una noche y no volviste.»`, `Ese nombre, ${past.trueName}, suena a algo tuyo. Pero no lo recuerdas.`],
          choices: [
            { id: 'aceptar', label: `Aceptar tu nombre: ${past.trueName}` },
            { id: 'rechazar', label: `Seguir siendo «${id.nickname}»` },
          ],
        };
      }
      if (!has(id, 'verdad') && id.fragments.length >= 4) return revealTruth(w);
      return null;
    }
  }
}

function revealTruth(w: WorldState): FragmentEvent {
  const id = w.life!.identity!;
  const past = id.past!;
  const O = w.regions[past.origin];
  remembered(w, 'verdad', past.deed === 'bueno' ? `Supo lo que había hecho en ${O.name}: algo que muchos le agradecían.` : `Supo lo que había hecho en ${O.name}: algo que muchos no le perdonaban.`);
  const lines =
    past.deed === 'bueno'
      ? [`Lo recuerdas todo de golpe. Como ${roleWord(past.role)}, sacaste a medio pueblo de ${O.name} de una crecida que nadie vio venir.`, 'Después te fuiste. Nadie supo por qué. Tú tampoco lo sabes todavía.', 'Hay quien aún enciende una vela por ti.']
      : [`Lo recuerdas todo de golpe. Como ${roleWord(past.role)}, diste una orden en ${O.name} que costó muchas casas y muchas vidas.`, 'Huiste esa misma noche. Quizá por eso olvidaste: había cosas que no querías recordar.', 'Hay quien todavía dice tu nombre escupiendo.'];
  return {
    id: 'verdad',
    title: 'Lo que hiciste',
    lines,
    choices:
      past.deed === 'bueno'
        ? [{ id: 'orgullo', label: 'Sentirte orgulloso de quien fuiste' }, { id: 'pagina', label: 'No dejar que eso te defina' }]
        : [{ id: 'reparar', label: `Reparar el daño: ayudar a ${O.name}` }, { id: 'reconocer', label: 'Reconocerlo ante quien te conoció' }, { id: 'callar', label: 'Callarlo y empezar de cero' }],
  };
}

function roleWord(r: PastRole): string {
  return { soldado: 'soldado', mercader: 'mercader', erudito: 'erudito', explorador: 'explorador', sanador: 'sanador', consejero: 'consejero de un señor', espia: 'alguien que vendía secretos' }[r];
}

/** Lo que decides hacer con lo que recuerdas. El pasado explica, no obliga. */
export function chooseFragment(w: WorldState, fragId: string, choice: string): string[] {
  const life = w.life!;
  const id = life.identity!;
  const past = id.past!;
  const O = w.regions[past.origin];
  const frag = id.fragments.find((f) => f.id === fragId);
  if (frag) frag.choice = choice;
  const gen = life.player.generation;
  const originFolk = life.folk.filter((f) => f.alive && f.regionId === past.origin);
  switch (`${fragId}:${choice}`) {
    case 'persona:aceptar':
      id.named = true;
      life.player.name = past.trueName;
      story(w, `Decidió volver a llamarse ${past.trueName}.`, 'decision');
      return [`Desde hoy vuelves a ser ${past.trueName}. Aunque no recuerdes del todo quién era.`];
    case 'persona:rechazar':
      id.named = true;
      story(w, `Supo que se llamaba ${past.trueName}, pero decidió seguir siendo ${id.nickname}.`, 'decision');
      return [`Ese nombre pertenece a otra persona. Tú eres ${id.nickname}.`];
    case 'verdad:orgullo':
      for (const f of originFolk.slice(0, 6)) f.memories.push({ day: w.day, kind: 'ayuda', weight: 0.4, gen });
      story(w, 'Aceptó con orgullo quién había sido.', 'decision');
      return [`En ${O.name}, quien te recuerda te mira de otra forma.`];
    case 'verdad:pagina':
      story(w, 'Decidió que lo que fue no decidiría lo que sería.', 'decision');
      return ['Lo que fuiste explica algunas cosas. No todas. El resto lo decides tú.'];
    case 'verdad:reparar':
      id.vow = past.origin;
      story(w, `Prometió reparar el daño que hizo en ${O.name}.`, 'decision');
      return [`Lo que hagas por ${O.name} contará el doble. Pero no borrará lo que pasó.`];
    case 'verdad:reconocer':
      for (const [i, f] of originFolk.slice(0, 8).entries()) f.memories.push({ day: w.day, kind: i % 3 === 0 ? 'ofensa' : 'honestidad', weight: i % 3 === 0 ? -0.4 : 0.25, gen });
      story(w, `Reconoció ante la gente de ${O.name} lo que había hecho.`, 'decision');
      return ['Algunos te escupen. Otros, para tu sorpresa, te dan la mano por haber tenido el valor de decirlo.'];
    case 'verdad:callar':
      story(w, 'Guardó para sí lo que había hecho.', 'decision');
      return ['Lo guardas. Pero los secretos pesan, y en los pueblos la gente habla.'];
  }
  return [];
}

/** Al despertar una aptitud del pasado, también vuelve un recuerdo. */
function fragmentFromSkill(w: WorldState, key: string): void {
  const id = w.life!.identity!;
  if (has(id, 'manos')) return;
  remembered(w, 'manos', `Su cuerpo recordó algo que su mente había olvidado (${key.startsWith('k:') ? KNOWS[key.slice(2) as KnowId].name : SKILLS[key as SkillId].name}).`);
}

/** Las preguntas abiertas que el jugador tiene sobre sí mismo. */
export function questions(w: WorldState): string[] {
  const id = w.life?.identity;
  if (!id?.past) return [];
  const past = id.past;
  const O = w.regions[past.origin];
  const q: string[] = [];
  if (!id.named) q.push('¿Cómo me llamo?');
  if (!has(id, 'colgante')) q.push('¿Qué es el colgante que llevaba al cuello?');
  else if (!has(id, 'lugar')) q.push(`¿Qué significa ${past.symbol}?`);
  if (!has(id, 'objeto') && !has(id, 'manos')) q.push('¿Qué sabía hacer antes de olvidarlo todo?');
  if (has(id, 'cancion') && !has(id, 'lugar')) q.push(`¿Por qué conozco una canción de ${O.name}?`);
  if (has(id, 'lugar') && !has(id, 'persona')) q.push(`¿Me conoce alguien en ${O.name}?`);
  if (has(id, 'sueno') && !has(id, 'verdad')) q.push(past.family ? '¿Quién era la persona del sueño?' : '¿Qué pasó la noche del fuego?');
  if (has(id, 'persona') && !has(id, 'verdad')) q.push('¿Por qué me fui?');
  if (!q.length) q.push('Ya sabes quién fuiste. La pregunta ahora es quién vas a ser.');
  return q;
}
