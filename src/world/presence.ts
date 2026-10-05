import { tavernPolitics } from './poltalk';
import { record, revealRegionHistory } from '../core/chronicle';
import { meet, observe } from '../core/intel';
import { foundFragment, mysteryHooks } from '../core/systems/mystery';
import { makeKnown, verdictOf } from '../core/systems/rumors';
import type { FactKey, WorldState } from '../core/types';
import { commitCtx, makeCtx } from '../core/world';
import { remember } from './folk';
import { getLayout, type Place } from './layout';
import { ensureLife } from './life';
import type { Folk } from './types';

/**
 * Estar allí. Recorrer una región en persona da información directa y
 * fiable (lo ves con tus propios ojos), descubre lugares y permite hacer en
 * persona lo que desde casa requiere enviar emisarios.
 */
const SEEN: FactKey[] = ['alimento', 'animo', 'ecologia', 'poblacion', 'necesidades', 'recurso', 'cultura'];

/** Se llama al entrar en una región y cada hora de juego mientras sigas en ella. */
export function presenceTick(w: WorldState, regionId: number, nearVillage: boolean): string[] {
  const life = ensureLife(w);
  const r = w.regions[regionId];
  const ctx = makeCtx(w);
  const notes: string[] = [];
  const intel = w.intel[regionId];
  const firstEver = intel.level === 0;
  meet(ctx, r);
  if (nearVillage && !r.isHome) {
    const keys = intel.level >= 2 ? SEEN : [...SEEN, 'tension' as FactKey];
    observe(ctx, r, 0.85, keys);
    for (const c of w.characters) if (c.regionId === regionId && c.alive && c.role === 'lider') c.known = true;
    if (life.visited[regionId] !== w.day) {
      const hidden = revealRegionHistory(w, regionId, w.day - 12, 2);
      for (const e of hidden) notes.push(`Ves con tus propios ojos: ${e.text}`);
      mysteryHooks.observe(ctx, r);
    }
  }
  if (firstEver) notes.push(`Primera vez que pisas ${r.name}.`);
  life.visited[regionId] = w.day;
  commitCtx(ctx);
  return notes;
}

/** Los lugares se descubren al acercarse a ellos. */
export function discoverNear(w: WorldState, x: number, y: number): Place | null {
  const life = ensureLife(w);
  for (const p of getLayout(w).places) {
    const st = (life.places[p.id] ??= { discovered: false });
    if (st.discovered || Math.hypot(p.x - x, p.y - y) > 7) continue;
    st.discovered = true;
    st.day = w.day;
    const ctx = makeCtx(w);
    record(ctx, { kind: 'descubrimiento', text: `Descubriste ${p.name.toLowerCase().startsWith('lugar') ? 'un lugar sin mapa' : p.name.toLowerCase()} en ${w.regions[p.regionId].name}.`, regions: [p.regionId], known: true, byPlayer: true });
    commitCtx(ctx);
    return p;
  }
  return null;
}

const EXAMINE: Record<string, string[]> = {
  cueva: ['El eco devuelve tus pasos. En el fondo hay marcas de antorchas recientes.', 'Huesos de animales y restos de una hoguera. Alguien vive aquí a ratos.'],
  ruinas: ['Piedras talladas con símbolos que no reconoces.', 'Un muro caído y, bajo él, cerámica de otra época.'],
  camino: ['Losas antiguas, más anchas que las de cualquier camino actual. Llevan hacia el interior.'],
  campamento: ['Ceniza todavía tibia. Han dejado prisa y huellas.'],
  bosque: ['Árboles enormes con cintas atadas en las ramas. Un lugar de ofrendas.'],
  mina: ['Galerías apuntaladas. El aire huele a metal.'],
  templo: ['Un altar partido. Las inscripciones hablan de inviernos y de cosechas.'],
  abandonada: ['Las puertas abiertas, la mesa puesta. Se fueron de golpe.'],
  puesto: ['Un puesto de comercio en el cruce. El tablón de anuncios está lleno de avisos viejos.'],
  secreto: ['Una piedra que brilla débilmente al tocarla. Nadie te creería.'],
  circulo: ['Siete piedras en círculo. Las sombras forman algo parecido a un mapa.'],
};

const FRAGMENT_SCENES: Record<string, string> = {
  m_pagos: 'Entre los restos, una bolsa de monedas y una lista de compradores de armas de ambos bandos.',
  f_vertidos: 'Del fondo de la galería sale un arroyo rojizo que va a parar directamente al río.',
  i_escarcha: 'Dentro hace un frío antinatural: el hielo de las paredes no se ha derretido en todo el verano.',
  r_camara: 'Tras los escombros, una puerta sellada cubierta de inscripciones. Algo muy antiguo duerme aquí.',
  r_mapa: 'Las sombras de las piedras señalan, al mediodía, un valle concreto.',
  i_anales: 'En el altar, unos anales grabados en piedra: «un invierno de cien días, cada siete generaciones».',
};

export function examinePlace(w: WorldState, placeId: string): string[] {
  const life = ensureLife(w);
  const p = getLayout(w).places.find((x) => x.id === placeId);
  if (!p) return [];
  const st = (life.places[p.id] ??= { discovered: true });
  const ctx = makeCtx(w);
  const lines = [ctx.rng.pick(EXAMINE[p.kind] ?? ['Nada fuera de lo común.'])];
  if (!st.examined) {
    st.examined = true;
    if (p.fragment && foundFragment(ctx, p.fragment)) lines.push(FRAGMENT_SCENES[p.fragment] ?? 'Encuentras algo que encaja con la verdad oculta del mundo.');
    if (p.kind === 'bosque' || p.kind === 'cueva' || p.kind === 'campamento') {
      life.player.inventory.hierbas += 2;
      lines.push('Recoges hierbas medicinales.');
    }
    if (p.kind === 'ruinas' || p.kind === 'templo' || p.kind === 'secreto' || p.kind === 'camino') {
      life.player.inventory.reliquias++;
      lines.push('Te guardas un objeto antiguo.');
    }
    const rev = revealRegionHistory(w, p.regionId, w.day - 60, 1);
    for (const e of rev) lines.push(`Restos recientes te hacen comprender: ${e.text}`);
  }
  commitCtx(ctx);
  return lines;
}

/** Escuchar conversaciones en la posada (una vez al día por pueblo). */
export function listenTavern(w: WorldState, regionId: number): string[] {
  const life = ensureLife(w);
  if (life.listened[regionId] === w.day) return ['Ya has escuchado lo que se dice hoy aquí. Vuelve mañana.'];
  life.listened[regionId] = w.day;
  const ctx = makeCtx(w);
  const r = w.regions[regionId];
  const lines: string[] = [];
  const rumors = w.rumors.filter((x) => !x.known && w.day <= x.expires && (x.heardIn === regionId || x.believers.includes(regionId) || x.about === regionId)).slice(0, 2);
  for (const ru of rumors) {
    makeKnown(ctx, ru);
    lines.push(`En una mesa del fondo: «${ru.text}»`);
  }
  observe(ctx, r, 0.7, ['tension', 'animo', 'relaciones']);
  const rev = revealRegionHistory(w, regionId, w.day - 20, 1);
  for (const e of rev) lines.push(`Alguien comenta: «${e.text}»`);
  lines.push(...tavernPolitics(w, regionId, ctx.rng));
  if (!lines.length) lines.push('Se habla del tiempo, de la cosecha y de amores. Nada que no supieras.');
  commitCtx(ctx);
  return lines;
}

/** Comprobar en persona un rumor sobre la región donde estás: no hace falta enviar a nadie. */
export function checkRumorInPerson(w: WorldState, rumorId: string): string {
  const ru = w.rumors.find((x) => x.id === rumorId);
  if (!ru) return 'Ese rumor ya nadie lo recuerda.';
  const ctx = makeCtx(w);
  const note = verdictOf(ctx, ru);
  record(ctx, { kind: 'informacion', text: `Comprobaste en persona: «${ru.text}» — ${ru.verdict?.toUpperCase()}. ${note}`, regions: [ru.about], causeId: ru.causeId, known: true, importance: 2, byPlayer: true });
  mysteryHooks.rumor(ctx, ru);
  commitCtx(ctx);
  return `${ru.verdict?.toUpperCase()}. ${note}`;
}

/** Escuchar a los ancianos del templo. */
export function templeElders(w: WorldState, regionId: number): string[] {
  const ctx = makeCtx(w);
  const lines: string[] = ['Los ancianos hablan despacio, mirando al fuego.'];
  const rev = revealRegionHistory(w, regionId, 0, 2);
  for (const e of rev) lines.push(`«Recordamos cuando… ${e.text.charAt(0).toLowerCase()}${e.text.slice(1)}»`);
  if (w.mystery.kind === 'invierno' && foundFragment(ctx, 'i_cancion')) lines.push('«Cuando las grullas huyan en verano, guarda el grano dos veces», canta uno de ellos.');
  if (lines.length === 1) lines.push('«Todo lo que hagas quedará en la memoria de este valle.»');
  commitCtx(ctx);
  return lines;
}

/** Los vecinos presentes recuerdan lo que haces delante de ellos. */
export function witnesses(w: WorldState, folk: Folk[], kind: string, weight: number): void {
  const gen = ensureLife(w).player.generation;
  for (const f of folk) remember(f, { day: w.day, kind, weight }, gen);
}
