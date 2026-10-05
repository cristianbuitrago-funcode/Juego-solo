import type { WorldState } from '../core/types';
import type { Good } from './economy';
import type { FolkRole } from './types';

/**
 * Estado de la Fase 4: política, influencia, organizaciones, diplomacia,
 * información y guerra. Vive en `life.politics` y se guarda con la partida.
 * Aquí solo están los datos y las definiciones; la lógica está repartida en
 * politics.ts (leyes, gobiernos, votaciones), orgs.ts (grupos y descontento),
 * diplomacy.ts (tratados y negociación), intrigue.ts (secretos), war.ts
 * (guerra, frentes y fronteras) y forecast.ts (hipótesis sobre el mundo).
 *
 * Nada de esto da poder al jugador por sí mismo: todo se gana con
 * reputación, relaciones, dinero, conocimiento y lo que hace.
 */

// ---------------------------------------------------------------------------
// Leyes: pocas, pero cada una mueve la economía y la vida de la gente
// ---------------------------------------------------------------------------
export type LawId = 'impuestos' | 'comercio' | 'propiedad' | 'agricultura' | 'trabajo' | 'seguridad' | 'migracion' | 'educacion' | 'recursos';

export interface LawDef {
  name: string;
  options: string[];
  label: Record<string, string>; // cómo lo dice la gente
  effect: Record<string, string>; // lo que se nota (sin cifras)
}

export const LAWS: Record<LawId, LawDef> = {
  impuestos: {
    name: 'impuestos', options: ['bajo', 'medio', 'alto'],
    label: { bajo: 'impuestos bajos', medio: 'impuestos moderados', alto: 'impuestos altos' },
    effect: { bajo: 'Los puestos ganan más; las arcas, menos: menos guardias y menos ayuda.', medio: 'La tasa de siempre sobre lo que se vende.', alto: 'Las arcas se llenan, pero los comerciantes ganan menos y algunos cierran o se van.' },
  },
  comercio: {
    name: 'comercio', options: ['libre', 'aranceles', 'cerrado'],
    label: { libre: 'comercio libre', aranceles: 'aranceles a lo que viene de fuera', cerrado: 'mercado cerrado a los forasteros' },
    effect: { libre: 'Las caravanas entran sin pagar.', aranceles: 'Lo de fuera paga a la entrada: protege a los de aquí, encarece lo que falta.', cerrado: 'No entran caravanas extranjeras salvo las de pueblos con tratado.' },
  },
  propiedad: {
    name: 'propiedad', options: ['comunal', 'privada'],
    label: { comunal: 'tierra comunal', privada: 'tierra en manos de cada familia' },
    effect: { comunal: 'Lo del campo se reparte: nadie se queda sin pan, pero se trabaja con menos ganas.', privada: 'Cada quien guarda lo suyo: más esfuerzo y más diferencias entre ricos y pobres.' },
  },
  agricultura: {
    name: 'agricultura', options: ['libre', 'granero'],
    label: { libre: 'cada quien vende su cosecha', granero: 'granero común para los malos años' },
    effect: { libre: 'Toda la cosecha va al mercado.', granero: 'Las arcas guardan grano en la cosecha y lo sacan cuando falta.' },
  },
  trabajo: {
    name: 'trabajo', options: ['libre', 'gremios'],
    label: { libre: 'cualquiera puede ejercer cualquier oficio', gremios: 'los oficios los controlan los gremios' },
    effect: { libre: 'Cualquiera cambia de oficio cuando quiere.', gremios: 'Los artesanos cobran más y nadie de fuera entra en sus oficios.' },
  },
  seguridad: {
    name: 'seguridad', options: ['baja', 'normal', 'alta'],
    label: { baja: 'poca guardia', normal: 'la guardia de siempre', alta: 'mucha guardia' },
    effect: { baja: 'Las arcas ahorran, pero los caminos son menos seguros.', normal: 'La guardia de siempre.', alta: 'Caminos seguros y bandidos a raya; también menos paciencia con quien protesta.' },
  },
  migracion: {
    name: 'migración', options: ['abierta', 'cerrada'],
    label: { abierta: 'puertas abiertas a quien llega', cerrada: 'no se acoge a forasteros' },
    effect: { abierta: 'Quien llega puede quedarse.', cerrada: 'No se acepta a gente nueva.' },
  },
  educacion: {
    name: 'educación', options: ['ninguna', 'escuela'],
    label: { ninguna: 'sin escuela', escuela: 'escuela pagada por todos' },
    effect: { ninguna: 'Cada familia enseña lo que sabe.', escuela: 'Las arcas pagan una escuela: cuesta, pero con el tiempo se trabaja mejor.' },
  },
  recursos: {
    name: 'recursos', options: ['libre', 'protegidos'],
    label: { libre: 'bosques y minas para quien los trabaje', protegidos: 'bosques y minas protegidos' },
    effect: { libre: 'Se tala y se cava sin límite.', protegidos: 'Menos madera y hierro, pero la tierra se recupera.' },
  },
};
export const LAW_IDS = Object.keys(LAWS) as LawId[];
export type Laws = Record<LawId, string>;

// ---------------------------------------------------------------------------
// Sistemas de gobierno: no son nombres, cada uno decide de otra manera
// ---------------------------------------------------------------------------
export type GovSystem = 'consejo' | 'alcalde' | 'monarquia' | 'republica' | 'familias' | 'militar' | 'federacion';

export const GOV: Record<GovSystem, { name: string; how: string; elections: boolean }> = {
  consejo: { name: 'consejo', how: 'Deciden los representantes de los grupos del pueblo, por mayoría.', elections: false },
  alcalde: { name: 'alcaldía', how: 'Decide quien ocupa la alcaldía, escuchando a sus consejeros. Se elige cada cierto tiempo.', elections: true },
  monarquia: { name: 'señorío', how: 'Decide quien gobierna, a su manera; el cargo pasa a su familia.', elections: false },
  republica: { name: 'asamblea', how: 'Vota todo el pueblo en la plaza; se elige a quien habla por todos.', elections: true },
  familias: { name: 'consejo de familias', how: 'Deciden las cabezas de las familias más ricas; cuanto más tiene una casa, más pesa su voto.', elections: false },
  militar: { name: 'gobierno de la guardia', how: 'Manda quien manda la guardia. La seguridad va primero y las protestas se aplastan.', elections: false },
  federacion: { name: 'federación', how: 'El pueblo decide lo suyo en consejo; el comercio, la seguridad y la migración se acuerdan con los pueblos federados.', elections: false },
};

export interface Gov {
  system: GovSystem;
  ruler?: string; // id de vecino o 'jugador'
  council: string[]; // quienes votan (ids de vecino o 'jugador')
  since: number;
  legitimacy: number; // 0..1: cuánto aceptan su autoridad
  repression: number; // 0..1: mano dura reciente
  laws: Laws;
  nextElection?: number;
  federation?: string;
  history: { day: number; text: string }[];
  /** Consejo del jugador al gobernante (si es consejero): ley → valor recomendado. */
  advice?: Partial<Record<LawId, string>>;
}

// ---------------------------------------------------------------------------
// Organizaciones
// ---------------------------------------------------------------------------
export type OrgKind = 'comerciantes' | 'agricultores' | 'artesanos' | 'guardia' | 'sabios' | 'familias' | 'comunidad' | 'clandestino';

export interface OrgDef {
  title: string; // «Gremio de comerciantes»
  roles: FolkRole[];
  objective: string;
  interests: Partial<Record<LawId, Record<string, number>>>;
}

export const ORG: Record<OrgKind, OrgDef> = {
  comerciantes: {
    title: 'Gremio de comerciantes', roles: ['comerciante', 'posadero'], objective: 'que el dinero corra y los caminos estén abiertos',
    interests: { impuestos: { bajo: 1, medio: 0, alto: -1 }, comercio: { libre: 1, aranceles: -0.5, cerrado: -1 }, seguridad: { baja: -0.5, normal: 0.2, alta: 0.4 }, trabajo: { libre: 0.4, gremios: -0.3 }, propiedad: { privada: 0.4, comunal: -0.3 }, migracion: { abierta: 0.3, cerrada: -0.2 } },
  },
  agricultores: {
    title: 'Hermandad de labradores', roles: ['campesino', 'pastor', 'pescador'], objective: 'que el trabajo del campo dé para vivir',
    interests: { impuestos: { bajo: 0.8, medio: 0, alto: -0.8 }, comercio: { libre: -0.3, aranceles: 0.6, cerrado: 0.1 }, agricultura: { libre: -0.2, granero: 0.6 }, propiedad: { comunal: 0.4, privada: -0.2 }, recursos: { libre: 0.3, protegidos: -0.2 }, migracion: { abierta: -0.1, cerrada: 0.2 } },
  },
  artesanos: {
    title: 'Gremio de artesanos', roles: ['artesano', 'carpintero', 'tejedor', 'minero', 'lenador'], objective: 'que los oficios se respeten y se paguen bien',
    interests: { trabajo: { gremios: 1, libre: -0.6 }, comercio: { aranceles: 0.6, libre: -0.3, cerrado: 0 }, recursos: { libre: 0.6, protegidos: -0.6 }, impuestos: { bajo: 0.5, medio: 0, alto: -0.5 }, educacion: { escuela: 0.3, ninguna: 0 } },
  },
  guardia: {
    title: 'La guardia', roles: ['guardia'], objective: 'el orden y una guardia bien pagada',
    interests: { seguridad: { alta: 1, normal: 0.2, baja: -1 }, impuestos: { alto: 0.6, medio: 0.2, bajo: -0.6 }, migracion: { cerrada: 0.5, abierta: -0.3 } },
  },
  sabios: {
    title: 'Círculo de sabios', roles: ['sanadora', 'exploradora', 'anciano'], objective: 'el saber, la salud y cuidar la tierra',
    interests: { educacion: { escuela: 1, ninguna: -0.8 }, recursos: { protegidos: 0.8, libre: -0.4 }, migracion: { abierta: 0.5, cerrada: -0.4 }, impuestos: { medio: 0.3, alto: 0, bajo: -0.1 } },
  },
  familias: {
    title: 'Las viejas familias', roles: [], objective: 'conservar lo que tienen y lo que mandan',
    interests: { impuestos: { bajo: 1, medio: 0, alto: -1 }, propiedad: { privada: 1, comunal: -1 }, trabajo: { gremios: 0.4, libre: -0.1 }, migracion: { cerrada: 0.4, abierta: -0.2 }, seguridad: { alta: 0.4, normal: 0.1, baja: -0.4 } },
  },
  comunidad: {
    title: 'Asamblea de vecinos', roles: [], objective: 'que nadie pase hambre ni se quede fuera',
    interests: { agricultura: { granero: 0.8, libre: -0.3 }, impuestos: { bajo: -0.1, medio: 0.3, alto: 0.1 }, migracion: { abierta: 0.4, cerrada: -0.2 }, educacion: { escuela: 0.6, ninguna: -0.2 }, propiedad: { comunal: 0.6, privada: -0.4 }, seguridad: { baja: -0.3, normal: 0.2, alta: -0.1 } },
  },
  clandestino: {
    title: 'Los del pozo', roles: [], objective: 'acabar con quienes mandan',
    interests: { seguridad: { baja: 1, normal: 0, alta: -1 } },
  },
};

/** 0 nada · 1 colaborador · 2 miembro · 3 representante · 4 líder. */
export const ORG_RANK = ['ajeno', 'colaborador', 'miembro', 'representante', 'líder'];

export interface OrgTask {
  id: string;
  kind: 'entregar' | 'convencer' | 'patrullar' | 'investigar' | 'aportar';
  good?: Good;
  n?: number;
  target?: string; // vecino a convencer
  secret?: string;
  until: number;
  text: string;
}

export interface Org {
  id: string;
  regionId: number;
  kind: OrgKind;
  name: string;
  members: string[];
  leader?: string;
  founded: number;
  founder?: 'jugador';
  funds: number;
  standing: number; // 0..1: peso público del grupo en el pueblo
  discontent: number; // 0..1
  hot: number; // días seguidos con mucho descontento
  grievance?: string;
  goal?: { law: LawId; value: string };
  cause?: { law: LawId; value: string }; // grupos fundados por el jugador
  action?: { kind: 'protesta' | 'huelga' | 'boicot' | 'motin' | 'desobediencia'; since: number; until: number; answered?: string };
  hidden: boolean; // los clandestinos no se ven hasta que se descubren
  known: boolean; // el jugador sabe que existe
  player: { rep: number; rank: number; tasks: number; joined?: number; expelled?: number; invited?: number; task?: OrgTask; lastHelp?: number };
  history: { day: number; text: string }[];
  dissolved?: number;
}

// ---------------------------------------------------------------------------
// Propuestas y votaciones
// ---------------------------------------------------------------------------
export type Pressure = 'argumento' | 'favor' | 'cobro' | 'informacion' | 'chantaje' | 'soborno';

export interface Proposal {
  id: string;
  regionId: number;
  law: LawId;
  value: string;
  from: string; // id de organización, 'jugador' o 'gobierno'
  day: number;
  voteDay: number;
  status: 'abierta' | 'aprobada' | 'rechazada' | 'retirada';
  sway: Record<string, number>; // votante → presión acumulada
  pressure: Record<string, Pressure[]>;
  heard: string[]; // votantes con quienes el jugador ha hablado (de quienes sabe qué piensan)
  playerVote?: 'si' | 'no' | 'abstencion';
  votes?: Record<string, boolean>;
  why?: string;
  federal?: string;
}

// ---------------------------------------------------------------------------
// Descontento colectivo y rebelión
// ---------------------------------------------------------------------------
export interface Rebellion {
  stage: number; // 0 nada · 1 descontento extendido · 2 oposición · 3 conspiración · 4 levantamiento
  since: number;
  leader?: string;
  orgId?: string; // grupo clandestino
  cause?: string;
  outcome?: { day: number; text: string; won: boolean };
  joined?: boolean; // el jugador se unió
  warned?: boolean; // el jugador avisó a quien gobierna
}

// ---------------------------------------------------------------------------
// Diplomacia
// ---------------------------------------------------------------------------
export type Stance = 'amistad' | 'neutralidad' | 'tension' | 'rivalidad' | 'alianza' | 'guerra';
export type TreatyKind = 'comercio' | 'fronteras' | 'defensa' | 'recursos' | 'alianza' | 'paz';

export const TREATY: Record<TreatyKind, { name: string; what: string; days: number }> = {
  comercio: { name: 'tratado de comercio', what: 'Sus caravanas no pagan aranceles y pueden entrar aunque el mercado esté cerrado.', days: 80 },
  fronteras: { name: 'acuerdo de fronteras', what: 'Fija dónde acaba cada pueblo y apaga las disputas por la tierra.', days: 200 },
  defensa: { name: 'pacto de defensa', what: 'Si atacan a uno, el otro acude.', days: 100 },
  recursos: { name: 'acuerdo de recursos', what: 'Cada pueblo manda al otro lo que le sobra a cambio de lo que le falta.', days: 60 },
  alianza: { name: 'alianza', what: 'Amistad, defensa y comercio: un solo frente.', days: 150 },
  paz: { name: 'tratado de paz', what: 'Termina una guerra y obliga a no volver a empezarla en mucho tiempo.', days: 90 },
};

export interface Treaty {
  id: string;
  kind: TreatyKind;
  a: number;
  b: number;
  day: number;
  until: number;
  by: 'jugador' | 'mundo';
  terms?: { tribute?: number; payer?: number; give?: Good; take?: Good; n?: number; cede?: number };
  broken?: number;
}

export type RoleKind = 'emisario' | 'diplomatico' | 'consejero';
export interface DipRole {
  kind: RoleKind;
  regionId: number; // a quién representa
  since: number;
  mission?: { to: number; treaty: TreatyKind; until: number };
  lost?: number;
}

export interface Federation {
  id: string;
  name: string;
  members: number[];
  since: number;
  laws: Partial<Laws>;
}

// ---------------------------------------------------------------------------
// Información como poder
// ---------------------------------------------------------------------------
export type SecretKind = 'crisis' | 'acaparamiento' | 'apoyos' | 'ruta' | 'conspiracion' | 'corrupcion' | 'ejercito';

export interface Testimony {
  by: string; // vecino que lo contó (o 'documentos', 'mercado')
  day: number;
  text: string;
  truthful: boolean;
}

export interface Secret {
  id: string;
  kind: SecretKind;
  regionId: number;
  about?: string; // vecino u organización
  other?: number; // otra región (rutas, ejércitos)
  day: number;
  text: string; // lo que es verdad
  hint: string; // lo primero que se oye
  holders: string[]; // quién lo sabe
  testimonies: Testimony[];
  known: boolean; // el jugador lo ha confirmado
  suspected: boolean; // el jugador ha oído algo
  used: string[];
  public: boolean; // ya lo sabe todo el mundo
  expires: number;
  data?: Record<string, number | string>;
}

// ---------------------------------------------------------------------------
// Guerra
// ---------------------------------------------------------------------------
export type Terrain = 'llano' | 'bosque' | 'monte' | 'rio' | 'ciudad';

export interface Army {
  regionId: number;
  soldiers: number;
  morale: number; // 0..1
  supply: number; // días de comida que lleva
  weapons: number; // armas por soldado (0..1)
  transport: number; // 0..1: carros y mulas para llevar el suministro
  fatigue: number; // 0..1
  leader?: string;
  intel: number; // 0..1: lo que sabe del enemigo
  hungryDays: number;
}

export interface Battle {
  day: number;
  at: number;
  terrain: Terrain;
  winner: number;
  losses: Record<number, number>;
  text: string;
  player?: string;
}

export interface War {
  id: string;
  a: number; // quien atacó
  b: number;
  since: number;
  causes: string[];
  status: 'activa' | 'terminada';
  front: number; // región donde se combate
  armies: Record<number, Army>;
  battles: Battle[];
  occupied: number[];
  nextBattle: number;
  ended?: { day: number; text: string; winner?: number };
  playerSide?: number;
  allies: Record<number, number[]>; // quién acude a cada bando
}

// ---------------------------------------------------------------------------
// Hipótesis sobre el mundo, decisiones y legado
// ---------------------------------------------------------------------------
export type ForecastVar = 'precio' | 'poblacion' | 'descontento' | 'votacion' | 'guerra' | 'prosperidad' | 'ley';

export interface Forecast {
  id: string;
  created: number;
  due: number;
  variable: ForecastVar;
  regionId: number;
  good?: Good;
  orgId?: string;
  propId?: string;
  other?: number;
  law?: LawId;
  prediction: 'sube' | 'baja' | 'igual' | 'si' | 'no';
  baseline: number;
  text: string;
  result?: 'acierto' | 'fallo' | 'parcial' | 'inesperado';
  explanation?: string;
}

export type Scale = 'persona' | 'familia' | 'pueblo' | 'region' | 'territorio' | 'mundo';
export const SCALES: Scale[] = ['persona', 'familia', 'pueblo', 'region', 'territorio', 'mundo'];
export const SCALE_NAME: Record<Scale, string> = { persona: 'una persona', familia: 'una familia', pueblo: 'un pueblo', region: 'una región', territorio: 'varios pueblos', mundo: 'el mundo conocido' };

export interface Decision {
  day: number;
  scale: Scale;
  regionId: number;
  text: string;
}

/**
 * Lo que queda cuando el protagonista ya no está (preparación de la Fase 5:
 * herencias, linajes, acontecimientos históricos). Cada registro dice quién
 * lo hizo y en qué generación; las leyes, tratados y grupos siguen vivos en
 * el mundo aunque su autor muera.
 */
export interface LegacyRec {
  day: number;
  gen: number;
  by: string;
  kind: 'ley' | 'tratado' | 'organizacion' | 'guerra' | 'paz' | 'ruta' | 'cargo' | 'gobierno' | 'derrota' | 'traicion';
  regionId: number;
  text: string;
  ref?: string;
}

export interface Politics {
  v: 1;
  seq: number;
  govs: Record<number, Gov>;
  orgs: Org[];
  proposals: Proposal[];
  rebellions: Record<number, Rebellion>;
  treaties: Treaty[];
  federations: Federation[];
  roles: DipRole[];
  offers: { kind: RoleKind | 'candidatura' | 'miembro' | 'representante' | 'liderazgo'; regionId: number; orgId?: string; day: number; mission?: DipRole['mission'] }[];
  secrets: Secret[];
  wars: War[];
  owner: Record<number, number>; // territorio → quién lo controla
  claims: { a: number; b: number; since: number; why: string }[];
  granary: Record<number, number>;
  hoards: Record<string, { regionId: number; n: number }>;
  favors: Record<string, number>; // >0 te deben; <0 les debes
  promises: { orgId: string; law: LawId; value: string; until: number; folk: string; kept?: boolean }[];
  delayed: { day: number; kind: string; regionId: number; data: Record<string, string | number> }[];
  candidacy: Record<number, boolean>;
  decisions: Decision[];
  legacy: LegacyRec[];
  forecasts: Forecast[];
  log: { day: number; regionId: number; kind: string; text: string }[];
}

export function polOf(w: WorldState): Politics {
  const life = w.life!;
  return (life.politics ??= {
    v: 1, seq: 0, govs: {}, orgs: [], proposals: [], rebellions: {}, treaties: [], federations: [], roles: [], offers: [], secrets: [], wars: [], owner: {}, claims: [], granary: {}, hoards: {}, favors: {}, promises: [], delayed: [], candidacy: {}, decisions: [], legacy: [], forecasts: [], log: [],
  });
}

export const nid = (w: WorldState, p: string) => `${p}${++polOf(w).seq}`;
