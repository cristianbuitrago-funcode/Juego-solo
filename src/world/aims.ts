import type { WorldState } from '../core/types';
import { playerEco } from './business';
import { story } from './identity';
import { recordHist } from './history';
import { playerRegion } from './society';
import { atlasOf, type Aim, type AimId } from './atlas';
import { DAYS_PER_YEAR } from './types';

/**
 * No hay un final único. Cada protagonista (y cada heredero) elige qué
 * quiere hacer con su vida: recuperar su pasado, levantar una granja, hacer
 * fortuna, fundar un pueblo, gobernar, recorrer el mundo, criar una familia,
 * fundar una dinastía, vivir en paz… El mundo no espera a nadie: sigue
 * igual se cumpla o no.
 */
export interface AimDef {
  id: AimId;
  name: string;
  text: string;
  check: (w: WorldState) => boolean;
  hint: (w: WorldState) => string;
}

const id = (w: WorldState) => w.life!.identity!;
const me = (w: WorldState) => w.life!.player;
const owned = (w: WorldState, k: string) => playerEco(w).businesses.filter((b) => b.kind === k).length;
const children = (w: WorldState) => me(w).family.filter((k) => k.relation === 'hijo' || k.relation === 'hija').length;
const knownRegions = (w: WorldState) => w.regions.filter((r) => w.intel[r.id].level > 0 || r.isHome).length;

export const AIMS: AimDef[] = [
  { id: 'pasado', name: 'Saber quién fui', text: 'Recuperar el pasado perdido.', check: (w) => id(w).fragments.length >= 5 || atlasOf(w).pois.some((p) => p.clue === 'origen' && p.found !== undefined), hint: (w) => `Recuerdos recuperados: ${id(w).fragments.length} de 5.` },
  { id: 'granja', name: 'Una tierra propia', text: 'Tener una granja que dé de comer.', check: (w) => owned(w, 'granja') >= 1, hint: () => 'Hace falta abrir una granja (unas 14 monedas).' },
  { id: 'riqueza', name: 'Hacer fortuna', text: 'Reunir 300 monedas.', check: (w) => id(w).needs.coins >= 300, hint: (w) => `Llevas ${Math.floor(id(w).needs.coins)} de 300 monedas.` },
  { id: 'fundar', name: 'Fundar un lugar', text: 'Levantar un asentamiento nuevo con gente que te siga.', check: (w) => atlasOf(w).settlements.some((s) => s.byPlayer && s.state === 'vivo'), hint: () => 'Necesitas unas 30 monedas y al menos cuatro personas que confíen en ti.' },
  { id: 'liderar', name: 'Gobernar', text: 'Llegar a dirigir un pueblo.', check: (w) => Object.values(id(w).rank).some((r) => r >= 5), hint: (w) => `Tu mayor reconocimiento: ${Math.max(0, ...Object.values(id(w).standing))} de 6.` },
  { id: 'explorar', name: 'Ver el mundo', text: 'Conocer todas las tierras de la isla y cinco lugares con historia.', check: (w) => knownRegions(w) >= w.regions.length && atlasOf(w).pois.filter((p) => p.found !== undefined).length >= 5, hint: (w) => `Tierras: ${knownRegions(w)}/${w.regions.length}. Lugares: ${atlasOf(w).pois.filter((p) => p.found !== undefined).length}/5.` },
  { id: 'familia', name: 'Una familia', text: 'Criar a dos hijos o hijas.', check: (w) => children(w) >= 2, hint: (w) => `Hijos e hijas: ${children(w)} de 2.` },
  { id: 'dinastia', name: 'Una dinastía', text: 'Que tu linaje llegue a la tercera generación.', check: (w) => me(w).generation >= 3, hint: (w) => `Generación ${me(w).generation} de 3.` },
  { id: 'tranquila', name: 'Una vida tranquila', text: 'Llegar a la vejez con techo, comida y sin deudas.', check: (w) => me(w).age >= 60 && id(w).housed && id(w).needs.coins >= 20, hint: (w) => `Tienes ${me(w).age} años.` },
  { id: 'saber', name: 'Aprender oficios', text: 'Dominar tres técnicas de otros pueblos.', check: (w) => atlasOf(w).playerTechs.length >= 3, hint: (w) => `Técnicas: ${atlasOf(w).playerTechs.length} de 3.` },
  { id: 'paz', name: 'Diez años de paz', text: 'Que tu pueblo pase diez años sin guerra.', check: (w) => !w.life!.gens?.history.some((e) => e.kind === 'guerra' && w.day - e.day < DAYS_PER_YEAR * 10) && w.day > DAYS_PER_YEAR * 10, hint: () => 'Mientras no haya guerra, el tiempo corre a tu favor.' },
];
export const AIM_BY_ID = Object.fromEntries(AIMS.map((a) => [a.id, a])) as Record<AimId, AimDef>;

/** Los objetivos de quien vive ahora (los de las vidas anteriores quedan en el archivo). */
export function myAims(w: WorldState): Aim[] {
  return atlasOf(w).aims.filter((a) => a.gen === me(w).generation);
}

export function chooseAim(w: WorldState, aim: AimId): string {
  const a = atlasOf(w);
  if (myAims(w).some((x) => x.id === aim)) return 'Ya es uno de tus propósitos.';
  if (myAims(w).filter((x) => !x.done).length >= 3) return 'Ya tienes tres propósitos. Nadie puede con todo.';
  a.aims.push({ id: aim, since: w.day, gen: me(w).generation });
  return `Te propones: ${AIM_BY_ID[aim].text.charAt(0).toLowerCase()}${AIM_BY_ID[aim].text.slice(1)}`;
}

export function dropAim(w: WorldState, aim: AimId): void {
  const a = atlasOf(w);
  a.aims = a.aims.filter((x) => !(x.id === aim && x.gen === me(w).generation && !x.done));
}

/** Cada pocos días: ¿se ha cumplido algo? */
export function aimsDay(w: WorldState): string[] {
  if (!w.life?.identity || w.day % 2) return [];
  const out: string[] = [];
  for (const a of myAims(w)) {
    if (a.done) continue;
    if (!AIM_BY_ID[a.id].check(w)) continue;
    a.done = w.day;
    const def = AIM_BY_ID[a.id];
    out.push(`Lo has conseguido: ${def.name.toLowerCase()}.`);
    story(w, `Cumplió lo que se había propuesto: ${def.name.toLowerCase()}.`, 'logro');
    recordHist(w, { kind: 'hazana', regionId: playerRegion(w), text: `${me(w).name} cumple su propósito: ${def.name.toLowerCase()}.`, actor: me(w).name, gen: me(w).generation, importance: 1, fame: 0.25, witnessed: true });
  }
  return out;
}
