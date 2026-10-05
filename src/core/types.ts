/**
 * Tipos del modelo de mundo.
 *
 * Regla de diseño: el estado "verdadero" (Region, Character, Rumor...) nunca se
 * muestra directamente al jugador. La interfaz solo lee `Intel` (lo que el
 * jugador sabe, con fecha y fiabilidad), `Clue` (pistas indirectas) y las
 * entradas de la crónica marcadas como conocidas.
 */

export type RegionId = number;
export type EntryId = string;

/** Métodos con los que el jugador resuelve problemas. El mundo aprende estos patrones. */
export type Method = 'ayuda' | 'fuerza' | 'dialogo' | 'engano' | 'informacion' | 'comercio' | 'abandono';

export type Priority = 'comercio' | 'seguridad' | 'conocimiento' | 'ecologia';

export interface CultureTraits {
  curiosity: number; // investiga y copia tecnologías
  pride: number; // tolera mal las ofensas, disputas tecnológicas
  mercantile: number; // depende y disfruta del comercio
  caution: number; // se arma ante el miedo
  spirituality: number; // da importancia a la memoria y los augurios
}

export interface Culture {
  id: string;
  name: string; // "los Velmari"
  adjective: string; // "velmari"
  hue: number; // tono de color en el mapa
  traits: CultureTraits;
  syllables: string[]; // para generar nombres de personas
}

/** Una condición activa en una región, con la entrada de crónica que la causó. */
export interface Flag {
  since: number;
  causeId?: EntryId;
  data?: Record<string, number | string>;
}

export interface Relation {
  opinion: number; // -1..1
  grievance: number; // 0..1, agravios acumulados (decae muy lento)
  allied: boolean;
  war: boolean;
  tension: number; // 0..1, calor del conflicto latente
  tensionCause?: EntryId;
}

export interface Attitude {
  trust: number;
  fear: number;
  resentment: number;
  gratitude: number;
}

export interface Region {
  id: RegionId;
  name: string;
  culture: string;
  isHome: boolean;
  center: { x: number; y: number };
  site: { x: number; y: number }; // semilla del diagrama de Voronoi (para redibujar el mapa)
  neighbors: RegionId[];
  coastal: boolean;
  riverOrder: number; // -1 si el río no pasa; 0 = nacimiento
  resource: string;
  population: number; // personas
  food: number; // días de reserva de alimento
  ecology: number; // 0..1
  pressure: number; // 0..1, presión de extracción sobre el recurso
  stability: number; // 0..1
  militancy: number; // 0..1, preparación para el conflicto
  selfReliance: number; // 0..1, capacidad de resolver sola sus problemas
  dependency: number; // 0..1, dependencia de la ayuda del jugador
  techs: string[];
  research: { tech: string; progress: number; causeId?: EntryId } | null;
  attitude: Attitude; // hacia el jugador
  relations: Record<number, Relation>;
  lastAttention: number; // último día en que el jugador intervino
  patternsSeen: Partial<Record<Method, number>>;
  flags: Record<string, Flag>;
  favored: boolean; // política: región favorecida
  abandoned: boolean; // política: región abandonada
  resourceBanned: boolean; // política: recurso prohibido
  autonomous: boolean; // desarrolló sus propias instituciones
  foodHistory: number[]; // últimos días (para hipótesis)
}

export interface Route {
  id: number;
  a: RegionId;
  b: RegionId;
  status: 'abierta' | 'cerrada' | 'bloqueada';
  closedCause?: EntryId;
  traffic: number; // 0..1, comercio que fluye
  baseTraffic: number;
}

export interface Memory {
  day: number;
  kind: string; // clave de plantilla de diálogo
  weight: number; // -1..1 (negativo = ofensa)
  about: 'jugador' | RegionId;
  entryId?: EntryId;
  vars?: Record<string, string>;
}

export interface Emotions {
  trust: number;
  fear: number;
  resentment: number;
  gratitude: number;
  ambition: number;
  curiosity: number;
}

export interface Character {
  id: string;
  name: string;
  role: string; // clave de ROLES
  regionId: RegionId;
  alive: boolean;
  known: boolean; // el jugador sabe de su existencia
  emotions: Emotions;
  memories: Memory[];
  relative: string; // "mi hermano", "mi hija"... para recuerdos de pérdida
  secret?: string; // papel en el misterio
  lastSpoke: number;
}

export type RumorKind = 'ataque' | 'hambre' | 'tecnologia' | 'traicion' | 'riqueza' | 'enfermedad';

export interface Rumor {
  id: string;
  day: number;
  kind: RumorKind;
  about: RegionId; // de quién se habla
  target?: RegionId; // contra quién (ataque/traición)
  heardIn: RegionId; // dónde lo oyó el jugador
  text: string;
  truth: boolean;
  origin: 'natural' | 'malentendido' | 'jugador' | 'manipulador' | 'exageracion';
  believers: RegionId[]; // regiones que lo creen
  investigated: boolean;
  verdict?: 'cierto' | 'falso' | 'confuso';
  known: boolean; // el jugador lo ha oído
  causeId?: EntryId;
  expires: number;
  note?: string; // explicación tras investigarlo
}

export type ClueKind =
  | 'militar'
  | 'construccion'
  | 'hambre'
  | 'ecologia'
  | 'animo'
  | 'comercio'
  | 'misterio'
  | 'migracion'
  | 'salud'
  | 'clima'
  | 'ruido';

export interface Clue {
  id: string;
  day: number;
  regionId: RegionId;
  kind: ClueKind;
  text: string;
  genuine: boolean; // falso indicio (el jugador no lo ve)
  fragment?: string; // pista del misterio
  read: boolean;
}

/** Lo que el jugador sabe de un campo de una región. */
export interface Fact {
  value: string; // descriptor ("graneros casi vacíos")
  level: number; // 0..4 para colorear
  day: number;
  reliable: boolean; // visto por un observador o deducido de rumores
}

export type FactKey =
  | 'poblacion'
  | 'alimento'
  | 'ecologia'
  | 'animo'
  | 'tension'
  | 'confianza'
  | 'recurso'
  | 'cultura'
  | 'tecnologias'
  | 'relaciones'
  | 'necesidades'
  | 'investigacion';

export interface Intel {
  level: 0 | 1 | 2 | 3; // desconocida, rumores, observada, conocida a fondo
  lastObserved: number;
  facts: Partial<Record<FactKey, Fact>>;
  observerStationed: boolean;
}

export type EntryKind =
  | 'accion'
  | 'consecuencia'
  | 'evento'
  | 'descubrimiento'
  | 'conflicto'
  | 'tecnologia'
  | 'diplomacia'
  | 'personaje'
  | 'ecologia'
  | 'migracion'
  | 'informacion';

/** Entrada de la memoria del mundo. `causeId` forma las cadenas de consecuencias. */
export interface Entry {
  id: EntryId;
  day: number;
  kind: EntryKind;
  text: string;
  regions: RegionId[];
  causeId?: EntryId;
  known: boolean;
  importance: 1 | 2 | 3;
  byPlayer?: boolean;
}

/** Consecuencia retardada: se ejecuta cuando llega su día. */
export interface Scheduled {
  id: string;
  day: number;
  kind: string;
  data: Record<string, number | string | boolean>;
  causeId?: EntryId;
}

export interface Mission {
  id: string;
  kind: 'observar' | 'investigar' | 'sabotaje' | 'espiar' | 'diplomacia';
  regionId: RegionId;
  rumorId?: string;
  start: number;
  returnDay: number;
  causeId?: EntryId;
}

export type HypoMetric = 'alimento' | 'confianza' | 'estabilidad' | 'ecologia' | 'tension' | 'poblacion';

export interface Hypothesis {
  id: string;
  created: number;
  dueDay: number;
  kind: 'metrica' | 'rumor' | 'conflicto' | 'tecnologia';
  regionId: RegionId;
  otherId?: RegionId;
  metric?: HypoMetric;
  direction?: 'sube' | 'baja' | 'igual';
  rumorId?: string;
  claimTrue?: boolean;
  baseline?: number;
  text: string;
  note: string; // texto libre del jugador
  result?: 'correcta' | 'parcial' | 'incorrecta';
  explanation?: string;
  linkedAction?: string;
}

export interface Choice {
  label: string;
  action: string; // id de acción
  params: Record<string, number | string>;
  hint?: string;
}

/** Petición o dilema que llega a la pantalla de decisiones. */
export interface Petition {
  id: string;
  day: number;
  expires: number;
  characterId?: string;
  regionId: RegionId;
  title: string;
  text: string;
  choices: Choice[];
  kind: string;
  genuine: boolean; // una petición puede ser exagerada
  causeId?: EntryId;
}

export interface Objective {
  id: string;
  kind: string;
  title: string;
  description: string;
  hidden: boolean; // aún no descubierto por el jugador
  status: 'activo' | 'cumplido' | 'fallido';
  progress: number; // 0..1 (aproximado, mostrado sin cifras exactas)
  data: Record<string, number | string>;
}

export interface Mystery {
  kind: string;
  culpritRegion: RegionId;
  culpritCharacter?: string;
  fragmentsFound: string[];
  solved: boolean;
  failedGuesses: number;
  nextGuessDay: number;
  triggerDay: number; // para crisis programadas (invierno)
  revealed: boolean; // el jugador sabe que hay un misterio
}

export interface Player {
  home: RegionId;
  reserves: number; // provisiones de tu gente (0..100)
  cohesion: number; // 0..1, unidad de tu civilización
  agents: number; // emisarios totales
  credibility: number; // 0..1, cuánto creen lo que dices
  priority: Priority;
  laws: { hospitalidad: boolean; secreto: boolean; racionamiento: boolean };
  patterns: Partial<Record<Method, number>>;
  actionsToday: number;
  guardReady: number; // día en que la guardia vuelve a estar disponible
  /**
   * Autoridad del protagonista en su comunidad (0 forastero … 6 líder). Sin
   * definir: partidas antiguas, en las que el jugador gobierna desde el inicio.
   */
  authority?: number;
}

export interface WorldState {
  /** Qué partes del mundo simula la capa de vida (Fase 3: comida y población salen de la economía de los pueblos). */
  sim?: { worldEconomy?: boolean; worldPolitics?: boolean };
  version: number;
  seed: number;
  rngState: number;
  day: number;
  eraLength: number;
  regions: Region[];
  routes: Route[];
  cultures: Culture[];
  characters: Character[];
  rumors: Rumor[];
  clues: Clue[];
  intel: Record<number, Intel>;
  entries: Entry[];
  scheduled: Scheduled[];
  missions: Mission[];
  hypotheses: Hypothesis[];
  petitions: Petition[];
  objectives: Objective[];
  mystery: Mystery;
  player: Player;
  river: RegionId[];
  counters: Record<string, number>;
  lastWarDay: number;
  ended: boolean;
  outcome?: 'era' | 'colapso';
  legacyNotes: string[];
  mood: Mood;
  /** Capa del mundo explorable (src/world). Opcional: el motor no depende de ella. */
  life?: import('../world/types').Life;
}

export type Mood = 'calma' | 'tension' | 'crisis' | 'descubrimiento';
