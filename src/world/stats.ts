import type { WorldState } from '../core/types';
import type { GainNote, Identity, SkillId } from './identity';

/**
 * Nivel y atributos del protagonista, al modo de un juego de rol: todo lo que hace le da
 * experiencia, al subir de nivel gana puntos y los reparte entre cinco atributos. En este mundo
 * no hay magia: en su lugar está el carisma. Ningún atributo es solo para pelear: el ataque es
 * la fuerza de los brazos, que también sirve para cavar, forjar, serrar o bajar a la mina; la
 * defensa es el aguante, que también hace que el trabajo canse menos.
 *
 * Los atributos no sustituyen a las habilidades (lo que sabes hacer): las empujan. Cada habilidad
 * se apoya en uno o dos atributos (SKILL_STATS) y su probabilidad de éxito sube o baja con ellos.
 */
export type StatId = 'ataque' | 'defensa' | 'inteligencia' | 'agilidad' | 'carisma';

export const STATS: Record<StatId, { name: string; icon: string; desc: string; uses: string }> = {
  ataque: { name: 'Ataque', icon: '💪', desc: 'La fuerza de tus brazos.', uses: 'Pelear, pero también cavar, forjar, serrar, cargar y bajar a la mina: los oficios duros pagan más a quien tiene fuerza.' },
  defensa: { name: 'Defensa', icon: '🛡', desc: 'El aguante del cuerpo.', uses: 'Resistir golpes, el frío y el camino. El trabajo te cansa menos.' },
  inteligencia: { name: 'Inteligencia', icon: '🧠', desc: 'Lo deprisa que entiendes las cosas.', uses: 'Aprendes antes (sobre todo los conocimientos), curas mejor, investigas y calculas precios.' },
  agilidad: { name: 'Agilidad', icon: '🪶', desc: 'Manos rápidas y pies ligeros.', uses: 'Sigilo, trabajos finos de artesanía, moverte por el monte. Caminas algo más deprisa.' },
  carisma: { name: 'Carisma', icon: '✨', desc: 'Lo que provocas al hablar (aquí no hay magia: hay gente).', uses: 'Convencer, negociar, liderar y regatear.' },
};
export const STAT_IDS = Object.keys(STATS) as StatId[];

/** En qué atributos se apoya cada habilidad (pesos que suman 1). */
export const SKILL_STATS: Record<SkillId, [StatId, number][]> = {
  combate: [['ataque', 0.6], ['defensa', 0.4]],
  agricultura: [['ataque', 0.6], ['defensa', 0.4]],
  artesania: [['ataque', 0.5], ['agilidad', 0.5]],
  supervivencia: [['defensa', 0.5], ['agilidad', 0.5]],
  sigilo: [['agilidad', 0.7], ['inteligencia', 0.3]],
  medicina: [['inteligencia', 0.7], ['agilidad', 0.3]],
  investigacion: [['inteligencia', 1]],
  comercio: [['inteligencia', 0.5], ['carisma', 0.5]],
  diplomacia: [['carisma', 0.6], ['inteligencia', 0.4]],
  persuasion: [['carisma', 1]],
  liderazgo: [['carisma', 0.7], ['defensa', 0.3]],
};

/** Valor de partida de un atributo: el de una persona corriente. */
export const STAT_BASE = 3;
export const POINTS_PER_LEVEL = 3;

export interface Stats {
  level: number;
  xp: number; // experiencia dentro del nivel actual
  points: number; // puntos sin repartir
  base: Record<StatId, number>;
}

/** Experiencia para pasar del nivel `lv` al siguiente. */
export const xpToNext = (lv: number): number => Math.round(30 * lv ** 1.4);

/** Los atributos del protagonista (las partidas antiguas los reciben al abrirse). */
export function statsOf(id: Identity): Stats {
  if (!id.stats) {
    const base = Object.fromEntries(STAT_IDS.map((s) => [s, STAT_BASE])) as Record<StatId, number>;
    // Criado en una corte: algo más de cabeza y de don de gentes que la media.
    if (id.past?.heir) {
      base.inteligencia += 1;
      base.carisma += 1;
    }
    id.stats = { level: 1, xp: 0, points: POINTS_PER_LEVEL, base };
  }
  return id.stats;
}

export function statOf(id: Identity, s: StatId): number {
  return statsOf(id).base[s];
}

/** Cuánto empujan los atributos a una habilidad: unos 4 puntos de probabilidad por punto sobre lo corriente. */
export function statBonus(id: Identity, skill: SkillId): number {
  const st = statsOf(id).base;
  const v = SKILL_STATS[skill].reduce((t, [s, k]) => t + st[s] * k, 0);
  return Math.max(-0.08, Math.min(0.28, (v - STAT_BASE) * 0.04));
}

/** Multiplicador de lo que se aprende (la inteligencia acelera; más los saberes que las manos). */
export function learnPace(id: Identity, knowledge: boolean): number {
  return 1 + (statOf(id, 'inteligencia') - STAT_BASE) * (knowledge ? 0.07 : 0.03);
}

/** Multiplicador del cansancio al trabajar (la defensa es aguante). */
export function fatiguePace(id: Identity): number {
  return Math.max(0.6, 1 - (statOf(id, 'defensa') - STAT_BASE) * 0.05);
}

/** Multiplicador de la velocidad al andar (la agilidad). */
export function walkPace(id: Identity): number {
  return Math.max(0.9, Math.min(1.2, 1 + (statOf(id, 'agilidad') - STAT_BASE) * 0.025));
}

/** Gana experiencia; al subir de nivel da puntos para repartir y lo cuenta. */
export function addXp(w: WorldState, amount: number): GainNote[] {
  const id = w.life?.identity;
  if (!id || amount <= 0) return [];
  const st = statsOf(id);
  st.xp += amount;
  const notes: GainNote[] = [];
  while (st.xp >= xpToNext(st.level)) {
    st.xp -= xpToNext(st.level);
    st.level++;
    st.points += POINTS_PER_LEVEL;
    notes.push({ text: `¡Subes a nivel ${st.level}! Tienes ${st.points} punto${st.points > 1 ? 's' : ''} para repartir en «Quién soy».`, big: true });
  }
  return notes;
}

/** Pone un punto en un atributo. */
export function spendPoint(id: Identity, s: StatId): boolean {
  const st = statsOf(id);
  if (st.points <= 0 || st.base[s] >= 20) return false;
  st.points--;
  st.base[s]++;
  return true;
}
