/**
 * Capa del mundo explorable ("vida"). El motor estratégico (src/core) sigue
 * siendo la fuente de verdad; esta capa le da cuerpo: terreno, pueblos,
 * vecinos con rutina y memoria, el personaje del jugador y su linaje.
 * Todo lo persistente vive en `WorldState.life` y se guarda con la partida.
 */
export const TILE = 16; // píxeles de mundo por tesela
export const WORLD_SCALE = 2; // unidades del mapa estratégico por tesela
export const TW = 500;
export const TH = 750;

export const enum T {
  Deep = 0,
  Sea = 1,
  River = 2,
  Sand = 3,
  Grass = 4,
  Meadow = 5,
  Forest = 6,
  Field = 7,
  Rock = 8,
  Mountain = 9,
  Marsh = 10,
  Salt = 11,
  Clay = 12,
  Road = 13,
  Bridge = 14,
  Plaza = 15,
}

export type FolkRole =
  | 'campesino'
  | 'pescador'
  | 'pastor'
  | 'comerciante'
  | 'guardia'
  | 'artesano'
  | 'nino'
  | 'anciano'
  | 'lider'
  | 'sanadora'
  | 'exploradora'
  | 'posadero'
  | 'minero'
  | 'carpintero'
  | 'lenador'
  | 'tejedor';

export interface FolkMemory {
  day: number;
  kind: string; // ayuda, comida, ofensa, salvado, rechazo, refugio, conversacion, mentira, fuerza...
  weight: number; // -1..1
  gen: number; // generación del jugador que lo provocó
}

/** Un vecino del mundo: persiste, envejece, recuerda y puede morir o emigrar. */
export interface Folk {
  id: string;
  name: string;
  regionId: number;
  role: FolkRole;
  age: number;
  born: number; // día de nacimiento (para cumpleaños)
  house: number; // índice de ranura de casa en su pueblo
  alive: boolean;
  charId?: string; // personaje con nombre del motor
  trust: number;
  fear: number;
  gratitude: number;
  resentment: number;
  honesty: number; // 0..1: probabilidad de decir la verdad
  memories: FolkMemory[];
  lastMet: number; // último día que habló con el jugador (-1 nunca)
  origin?: number; // región de la que emigró
  parentId?: string;
  gender?: 'f' | 'm';
  /** La persona: carácter, necesidades, emociones, objetivos, recuerdos propios (Fase 2). */
  p?: import('./society').Persona;
  /** Día en que murió (para archivar a los muertos con el tiempo). */
  died?: number;
  /** Lo que ha aprendido de otros (de su familia, del jugador): habilidad → nivel. */
  learned?: Partial<Record<import('./genstate').LearnKey, number>>;
  /** Familia (casa) a la que pertenece. */
  houseId?: string;
}

export interface Kin {
  name: string;
  relation: 'hijo' | 'hija' | 'aprendiz' | 'sobrino' | 'sobrina' | 'pareja' | 'hermano' | 'hermana' | 'nieto' | 'nieta' | 'amigo' | 'amiga' | 'madre' | 'padre';
  age: number;
  /** El vecino de carne y hueso (Fase 5: la familia vive en el mundo). */
  folkId?: string;
  adopted?: boolean;
}

export interface Ancestor {
  name: string;
  fromDay: number;
  toDay: number;
  title: string;
  relation: string; // relación con el siguiente
  fem?: boolean;
  age?: number;
  /** Su crónica de vida (Fase 5). */
  chronicle?: string[];
}

export interface Avatar {
  name: string;
  x: number; // en teselas
  y: number;
  age: number;
  birthDay: number;
  since: number; // día en que tomó el relevo
  generation: number;
  family: Kin[];
  lineage: Ancestor[];
  inventory: { comida: number; hierbas: number; reliquias: number };
  pendingDeath: boolean;
  /** Cómo y cuándo murió (Fase 5). */
  death?: { day: number; cause: string; text: string; regionId: number };
  /** De dónde viene (para quien hereda: «Nació en…»). */
  origin?: string;
  /** Aspecto elegido por el jugador (capa, túnica, pelo…); lo interpreta el render. */
  look?: { cloak: string; tunic: string; hair: string; hairColor: string; fem: boolean; beard: string; skin: number };
}

export interface TownState {
  houses: number; // casas en pie (ranuras 0..houses-1)
  burned: number[]; // ranuras quemadas por la guerra
  abandoned: number; // casas abandonadas por la despoblación (al final de la lista)
  walls: boolean;
  tower: boolean;
  tier: number; // 0 aldea … 4 ciudad
}

export interface Caravan {
  id: string;
  to: number;
  depart: number; // minuto absoluto
  arrive: number;
  kind: 'provisiones' | 'regalo';
}

export interface Encounter {
  id: string;
  kind: string;
  regionId: number;
  x: number;
  y: number;
  day: number;
  folkA?: string;
  folkB?: string;
  otherRegion?: number;
  truth: string; // qué ocurre de verdad
  rumorId?: string;
  resolved: boolean;
  learned: string[]; // qué ha averiguado el jugador
  announced: boolean;
}

export interface PlaceState {
  discovered: boolean;
  day?: number;
  examined?: boolean;
}

export interface Life {
  version: 1;
  clock: number; // minutos absolutos desde el amanecer del día 1
  player: Avatar;
  folk: Folk[];
  towns: Record<number, TownState>;
  places: Record<string, PlaceState>;
  explored: number[]; // bitset por bloques de 4×4 teselas
  caravans: Caravan[];
  encounters: Encounter[];
  visited: Record<number, number>; // último día en cada región
  listened: Record<number, number>; // último día que escuchaste en la posada
  observed: Record<number, number>; // último minuto con observación directa
  nextEncounter: number;
  seq: number;
  /** Quién es el protagonista: habilidades, pasado, reputación, crónica personal. */
  identity?: import('./identity').Identity;
  /** Los primeros días: el prólogo jugable (solo en partidas nuevas). */
  prologue?: import('./prologue').Prologue;
  /** La sociedad: lazos entre vecinos, rumores, conflictos, mercado, acontecimientos. */
  society?: import('./society').Society;
  /** Política, organizaciones, diplomacia, información y guerra (Fase 4). */
  politics?: import('./polstate').Politics;
  /** Generaciones, herencia y memoria histórica (Fase 5). */
  gens?: import('./genstate').Generations;
  /** El mundo completo: asentamientos, caminos, naturaleza, desastres, técnicas, estados, tierras lejanas (Fase 6). */
  atlas?: import('./atlas').Atlas;
}

export const DAY_MINUTES = 1440;
export const DAYS_PER_YEAR = 20;
export const DAYS_PER_SEASON = 5;
