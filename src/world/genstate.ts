import type { WorldState } from '../core/types';
import type { SkillId, KnowId } from './identity';

/**
 * Estado de la Fase 5: generaciones, muerte, herencia y legado. Vive en
 * `life.gens` y se guarda con la partida. La lógica está en
 * generations.ts (etapas de la vida, salud, muerte, familia, enseñanza),
 * estate.ts (testamento, herencia, disputas, deudas, objetos con historia,
 * dinastía), succession.ts (quién continúa y cómo) e history.ts (archivo
 * histórico, leyendas que se deforman, monumentos, línea temporal).
 */
export type LearnKey = SkillId | `k:${KnowId}`;

/** Lo que el protagonista es para alguien (sobrevive a los años y, a veces, a la muerte). */
export interface Bond {
  folk: string;
  kind: 'amistad' | 'pareja' | 'hijo' | 'aprendiz' | 'mentor' | 'rival' | 'expareja' | 'socio';
  affection: number; // 0..1
  since: number;
  taught: number; // lecciones dadas
  gen: number; // generación del jugador que lo forjó
  adopted?: boolean;
}

export interface Condition {
  kind: 'fiebre' | 'herida' | 'achaques' | 'hambre' | 'agotamiento';
  since: number;
  until?: number;
  severity: number; // 0..1
  why: string;
}

export interface Health {
  value: number; // 0..1
  conditions: Condition[];
  incapacitated: boolean;
}

export interface Heirloom {
  id: string;
  name: string;
  kind: 'colgante' | 'espada' | 'anillo' | 'herramienta' | 'cuaderno' | 'llave' | 'otro';
  made: number;
  origin: string;
  holder: string; // 'jugador', id de vecino, 'pueblo:<id>' o 'perdido'
  owners: { name: string; folk?: string; gen?: number; from: number; to?: number }[];
  deeds: { day: number; text: string }[];
}

export type Asset = 'monedas' | 'casa' | 'carga' | 'conocimiento' | `negocio:${string}` | `objeto:${string}`;
export type Beneficiary = 'heredero' | 'pueblo' | `vecino:${string}` | `grupo:${string}`;

export interface Will {
  day: number;
  lines: { asset: Asset; to: Beneficiary }[];
}

export interface Dispute {
  id: string;
  day: number;
  asset: string; // qué se disputa (en palabras)
  value: number;
  claimants: string[]; // ids de vecino (o 'jugador')
  status: 'abierta' | 'dividida' | 'cedida' | 'juicio' | 'ruptura';
  regionId: number;
  text?: string;
}

export interface Debt {
  id: string;
  to: string; // id de vecino o 'pueblo:<id>'
  amount: number;
  why: string;
  due: number;
  paid?: boolean;
}

/** La familia del protagonista vista desde fuera: nombre, fama, poder a lo largo de las generaciones. */
export interface Dynasty {
  name: string;
  founded: number;
  fame: Record<string, number>; // 'honesta', 'comerciante', 'política', 'guerrera', 'sabia', 'generosa', 'traidora'…
  members: { name: string; gen: number; from: number; to: number; age: number; title: string; cause: string; role: string }[];
  power: { gen: number; day: number; value: number }[];
}

export type HistKind = 'llegada' | 'muerte' | 'nacimiento' | 'boda' | 'guerra' | 'paz' | 'tratado' | 'gobierno' | 'rebelion' | 'crisis' | 'fundacion' | 'negocio' | 'ley' | 'descubrimiento' | 'frontera' | 'familia' | 'pueblo' | 'herencia' | 'hazana';

/** Un acontecimiento que el mundo recuerda. La verdad queda; lo que se cuenta, cambia. */
export interface HistEvent {
  id: string;
  day: number;
  kind: HistKind;
  regionId: number;
  text: string; // lo que pasó de verdad
  actor?: string; // nombre de quien lo hizo
  gen?: number; // si lo hizo el jugador, en qué generación
  importance: 1 | 2 | 3;
  fame: number; // 0..1: cuánto se cuenta
  witnessed: boolean; // lo vio el jugador (o alguien de su linaje)
  monument?: boolean;
  feast?: boolean; // se recuerda cada año
  src?: string;
}

/** Familias del mundo (también las de los vecinos). */
export interface House {
  id: string;
  name: string; // «los de Brena»
  regionId: number;
  founded: number;
  founder: string;
  power: number; // 0..1 (interno)
  peak: number;
  trade: string; // a qué se dedican
  fallen?: number;
}

export interface Generations {
  v: 1;
  seq: number;
  bonds: Record<string, Bond>;
  health: Health;
  heirlooms: Heirloom[];
  will?: Will;
  disputes: Dispute[];
  debts: Debt[];
  dynasty: Dynasty;
  history: HistEvent[];
  houses: House[];
  entryMark: number; // hasta qué entrada del motor se ha archivado
  logMark: number;
  wantsChildren?: boolean;
  partnerSince?: number;
  /** Vecino del que salió el protagonista actual (si era alguien del mundo). */
  self?: string;
  /** Para la Fase 6: escala del mundo y nivel de detalle histórico por región. */
  scale: { regions: number; historyCap: number };
  lastYear: number;
}

export function gensOf(w: WorldState): Generations {
  const life = w.life!;
  return (life.gens ??= {
    v: 1, seq: 0, bonds: {}, health: { value: 1, conditions: [], incapacitated: false }, heirlooms: [], disputes: [], debts: [],
    dynasty: { name: '', founded: w.day, fame: {}, members: [], power: [] },
    history: [], houses: [], entryMark: 0, logMark: 0, scale: { regions: w.regions.length, historyCap: 400 }, lastYear: 0,
  });
}

export const gid = (w: WorldState, p: string) => `${p}${++gensOf(w).seq}`;

/** Cómo se nombra al protagonista en la historia (quien no recuerda su nombre es «el forastero»). */
export const playerLabel = (w: WorldState) => (w.life!.player.name === 'Sin nombre' ? 'el forastero' : w.life!.player.name);
