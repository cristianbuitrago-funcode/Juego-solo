import type { WorldState } from '../core/types';
import type { Good } from './economy';

/**
 * Estado de la Fase 6 («el mundo completo»). Vive en `life.atlas` y se guarda
 * con la partida. La semilla genera el mundo base (geografía, clima,
 * culturas, lenguas, lugares, tierras lejanas): eso no se guarda, se
 * reconstruye. Aquí solo se guarda lo que la historia ha cambiado:
 * asentamientos nuevos o arruinados, caminos que mejoran o se pierden,
 * puertos, recursos naturales gastados, desastres, técnicas que viajan con
 * la gente, estados, contactos con tierras lejanas, épocas y objetivos.
 */
export type SettlementTier = 'campamento' | 'aldea' | 'pueblo' | 'ciudad' | 'metropolis';
export const TIER_NAME: Record<SettlementTier, string> = { campamento: 'campamento', aldea: 'aldea', pueblo: 'pueblo', ciudad: 'ciudad', metropolis: 'metrópolis' };
export const TIER_ORDER: SettlementTier[] = ['campamento', 'aldea', 'pueblo', 'ciudad', 'metropolis'];

/** Un asentamiento nuevo (fundado por la gente del mundo o por el jugador). */
export interface Settlement {
  id: string;
  name: string;
  regionId: number;
  x: number; // tesela
  y: number;
  founded: number;
  founders: string; // de dónde vinieron
  people: number; // habitantes (abstractos)
  tier: SettlementTier;
  state: 'vivo' | 'abandonado' | 'ruinas';
  why: string;
  byPlayer?: boolean;
  history: { day: number; text: string }[];
  port?: boolean;
}

/** Un lugar con historia que aparece con los años (ruinas, monumentos, restos de una batalla…). */
export interface Poi {
  id: string;
  kind: 'ruinas' | 'monumento' | 'batalla' | 'cueva' | 'oasis' | 'pecio' | 'cantera';
  name: string;
  regionId: number;
  x: number;
  y: number;
  day: number;
  text: string;
  found?: number;
  clue?: string; // pista del pasado del protagonista (para sus descendientes)
}

export interface Road {
  quality: number; // 0..1: sendero → camino → calzada
  used: number; // volumen reciente
  built?: number; // día en que se abrió (si es nuevo)
  last?: number; // volumen acumulado la última vez que se miró
}

export interface NatureStock {
  bosque: number; // 0..1 de su capacidad
  caza: number;
  pesca: number;
  mineral: number;
}

export interface Disaster {
  id: string;
  kind: 'inundacion' | 'incendio' | 'terremoto' | 'tormenta' | 'deslizamiento' | 'erupcion' | 'sequia';
  regionId: number;
  day: number;
  severity: number; // 0..1
  recovered: number; // 0..1
  aidFrom: number[];
  text: string;
  abandoned?: boolean;
}

/** Una técnica que viaja con la gente (conecta con las tecnologías del motor). */
export interface Know {
  tech: string; // id de la tecnología del motor
  regionId: number;
  adoption: number; // 0..1: cuántos la practican
  carriers: string[]; // vecinos que la saben
  from?: number; // de dónde llegó
  since: number;
}

/** Tierras lejanas, más allá del mar: existen aunque no se pisen. */
export interface Realm {
  id: string;
  name: string;
  people: string; // gentilicio
  culture: string;
  government: string;
  power: number; // 0..1
  exports: Good[];
  imports: Good[];
  techs: string[];
  attitude: number; // -1..1 hacia la isla
  contact?: number; // día del primer contacto
  ruler: string;
  history: { day: number; text: string }[];
}

export interface Era {
  from: number;
  to?: number;
  name: string;
  why: string;
}

export type AimId = 'pasado' | 'granja' | 'riqueza' | 'fundar' | 'liderar' | 'explorar' | 'familia' | 'dinastia' | 'tranquila' | 'saber' | 'paz';
export interface Aim {
  id: AimId;
  since: number;
  gen: number;
  done?: number;
}

export interface Atlas {
  v: 1;
  seq: number;
  settlements: Settlement[];
  pois: Poi[];
  roads: Record<number, Road>; // por id de ruta del motor
  seaRoutes: { a: number; b: number; since: number }[];
  ports: Record<number, number>; // región → día en que se hizo el puerto
  nature: Record<number, NatureStock>;
  disasters: Disaster[];
  knows: Know[];
  playerTechs: string[]; // técnicas que el protagonista ha aprendido (y puede enseñar)
  realms: Realm[];
  eras: Era[];
  aims: Aim[];
  exposure: Record<string, number>; // cultura → días oyendo su lengua
  lastRare: number; // último acontecimiento raro (para que sigan siendo raros)
  snapshots: { day: number; govs: string[]; owners: number[]; tiers: number[]; pops: number[]; techs: number; settlements: number }[];
  lastTick: Record<number, number>; // región → último día simulado en detalle (simulación por niveles)
}

export function atlasOf(w: WorldState): Atlas {
  const life = w.life!;
  return (life.atlas ??= {
    v: 1, seq: 0, settlements: [], pois: [], roads: {}, seaRoutes: [], ports: {}, nature: {}, disasters: [], knows: [], playerTechs: [], realms: [], eras: [], aims: [], exposure: {}, lastRare: -999, snapshots: [], lastTick: {},
  });
}

export const aid = (w: WorldState, p: string) => `${p}${++atlasOf(w).seq}`;
