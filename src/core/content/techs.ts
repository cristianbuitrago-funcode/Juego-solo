import type { Region, WorldState } from '../types';

/**
 * Tecnologías emergentes. No hay árbol de habilidades: una región inventa
 * algo cuando sus circunstancias la empujan a ello (escasez, aislamiento,
 * guerra, curiosidad...). `pressure` devuelve cuánto empuja la situación
 * actual hacia este invento (0 = nada).
 */
export interface TechDef {
  id: string;
  name: string;
  description: string;
  pressure: (r: Region, w: WorldState) => number;
  effects: {
    food?: number; // multiplica la producción de alimento
    ecology?: number; // recuperación diaria extra del ecosistema
    defense?: number; // reduce pérdidas en guerra
    trade?: number; // aumenta el atractivo comercial
    insight?: number; // la región entiende mejor los rumores
  };
  clue: string; // pista indirecta mientras se investiga
}

const hungry = (r: Region) => (r.flags.hambre ? 1 : r.food < 6 ? 0.5 : 0);
const isolated = (r: Region) => (r.flags.aislada ? 1 : 0);

export const TECHS: TechDef[] = [
  {
    id: 'terrazas', name: 'cultivo en terrazas', description: 'Campos escalonados que producen alimento incluso en laderas pobres.',
    pressure: (r) => hungry(r) * 0.8 + isolated(r) * 0.6, effects: { food: 1.35 },
    clue: 'En {R} mueven piedras por las laderas, día tras día.',
  },
  {
    id: 'salazon', name: 'salazón y ahumado', description: 'Conservar alimentos durante meses.',
    pressure: (r) => (r.resource === 'pesca' || r.resource === 'sal' ? 0.6 : 0.2) + hungry(r) * 0.5, effects: { food: 1.15, trade: 0.25 },
    clue: 'Hay humo constante sobre {R}, pero no huele a forja.',
  },
  {
    id: 'rotacion', name: 'rotación de tierras', description: 'Dejar descansar la tierra para que el ecosistema se recupere.',
    pressure: (r) => (r.ecology < 0.45 ? 1 : 0) + (r.flags.degradada ? 0.6 : 0), effects: { ecology: 0.012, food: 1.05 },
    clue: 'Los de {R} han dejado campos enteros sin sembrar. Nadie sabe por qué.',
  },
  {
    id: 'empalizadas', name: 'empalizadas y vigías', description: 'Defensas que reducen el daño de los conflictos.',
    pressure: (r) => r.militancy * 0.8 + (r.flags.guerra ? 1 : 0) + r.attitude.fear * 0.4, effects: { defense: 0.4 },
    clue: 'Alguien está construyendo algo en la frontera de {R}.',
  },
  {
    id: 'telares', name: 'telares de pedal', description: 'Producción textil propia que sustituye importaciones.',
    pressure: (r) => isolated(r) * 0.7 + (r.resource === 'lana' ? 0.5 : 0) + (r.flags.sinComercio ? 0.6 : 0), effects: { trade: 0.35 },
    clue: 'Desde {R} llega un repiqueteo de madera que dura toda la noche.',
  },
  {
    id: 'remedios', name: 'boticas de remedios', description: 'Conocimiento médico que frena las fiebres.',
    pressure: (r) => (r.flags.fiebre ? 1.2 : 0) + (r.resource === 'hierbas' ? 0.4 : 0), effects: { insight: 0.1 },
    clue: 'En {R} hierven calderos con olores amargos.',
  },
  {
    id: 'senales', name: 'torres de señales', description: 'Hogueras en colinas que transmiten noticias en horas.',
    pressure: (r, w) => (r.flags.engañada ? 1 : 0) + w.rumors.filter((x) => x.believers.includes(r.id)).length * 0.15, effects: { insight: 0.35 },
    clue: 'Por la noche se ven fuegos encendiéndose y apagándose en las colinas de {R}.',
  },
  {
    id: 'acequias', name: 'acequias', description: 'Canales que reparten el agua y multiplican las cosechas.',
    pressure: (r) => (r.riverOrder >= 0 ? 0.4 : 0) + hungry(r) * 0.4 + (r.flags.sequia ? 1 : 0), effects: { food: 1.25, ecology: 0.004 },
    clue: 'En {R} cavan zanjas largas que van hacia el río.',
  },
  {
    id: 'fuelles', name: 'hornos de fuelle', description: 'Metal mejor y más barato. Cambia el equilibrio de fuerzas.',
    pressure: (r) => (r.resource === 'hierro' ? 0.7 : 0) + r.militancy * 0.4, effects: { trade: 0.3, defense: 0.25 },
    clue: 'Las forjas de {R} rugen con un sonido nuevo, más agudo.',
  },
];

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));
