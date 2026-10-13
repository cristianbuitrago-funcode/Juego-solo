import type { WorldState } from '../core/types';
import { hourOf } from '../world/clock';
import { ensureLife } from '../world/life';
import type { Layout } from '../world/layout';
import { findPath, passable } from '../world/path';
import { geoOf } from '../world/geography';
import { idx } from '../world/terrain';
import { T } from '../world/types';
import { injure } from '../world/generations';
import { levelOf } from '../world/identity';
import { STAT_BASE, statOf } from '../world/stats';
import { ANIMAL_HALF } from '../visual/env/animals';
import type { Furniture } from './furniture';
import { hash } from './poses';
import type * as S from './sprites';

/**
 * Animales de los pueblos cercanos: rebaños según la comida y la tierra, caballos
 * junto al establo, perros por las calles y patos en el agua. Aparecen al acercarse
 * el jugador y se olvidan al alejarse.
 */
export interface Animal {
  kind: S.AnimalKind;
  x: number;
  y: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  flip: boolean;
  anim: number;
  water?: boolean; // patos: solo nadan
  v: number;
  /** Fieras (lobo, oso): cómo están reaccionando al jugador ahora. */
  mood?: WildMood;
  /** Segundos que faltan para que el oso pueda volver a cargar. */
  cool?: number;
  /** El oso ya te avisó con una carga en este encuentro: si insistes, ataca de verdad. */
  warned?: boolean;
  /** Ya avisó de esto en este encuentro (no repetir el mensaje). */
  told?: string;
  /** Lobos de noche: la res del pueblo a la que van, y su guarida para volver. */
  prey?: Animal;
  den?: { x: number; y: number };
  /** Camino que sigue (rodeando casas y vallas) y cuánto lleva sin avanzar. */
  route?: { x: number; y: number }[];
  routeAge?: number;
  stuck?: number;
}

export type WildMood = 'calma' | 'mira' | 'huye' | 'carga' | 'retrocede' | 'acecha' | 'asalta' | 'vuelve' | 'ataca';
/** Lo que el jugador debería saber de una fiera (la app lo convierte en un aviso). */
export type WildEvent = 'mira' | 'huye' | 'carga' | 'acecha' | 'asalto' | 'presa' | 'ahuyentados' | 'zarpazo' | 'esquiva';
export interface WildInfo {
  regionId?: number;
  prey?: S.AnimalKind;
  by?: 'guardia' | 'jugador';
}
/** De noche (los lobos se atreven a acercarse). */
export const wildNight = (h: number) => h >= 21.5 || h < 5.5;
const LIVESTOCK = new Set<S.AnimalKind>(['oveja', 'gallina', 'vaca']);
// Cada pueblo sufre como mucho un asalto por noche (la noche se cuenta de mediodía a mediodía).
const raided = new WeakMap<Animal[], number>();

export interface AnimalsHost {
  w: WorldState;
  l: Layout;
  furniture: Furniture;
  animals: Map<number, Animal[]>;
  /** Una fiera ha reaccionado al jugador de una forma que conviene contarle. */
  onWild?(kind: 'lobo' | 'oso', what: WildEvent, info?: WildInfo): void;
}

export function moveAnimals(s: AnimalsHost, dt: number): void {
  const life = ensureLife(s.w);
  const me = life.player;
  const h = hourOf(life.clock);
  const night = wildNight(h);
  const nightId = Math.floor((life.clock / 60 + 6 - 12) / 24);
  for (const v of s.l.villages) {
    const far = Math.hypot(v.cx - me.x, v.cy - me.y) > 60;
    if (far) {
      s.animals.delete(v.regionId);
      continue;
    }
    let list = s.animals.get(v.regionId);
    if (!list) {
      list = spawnAnimals(s, v.regionId);
      s.animals.set(v.regionId, list);
    }
    if (night && raided.get(list) !== nightId && Math.random() < dt / 25) {
      raided.set(list, nightId);
      startRaid(s, v.regionId, list);
    }
    for (const a of [...list]) {
      if (a.kind === 'lobo' && (a.mood === 'asalta' || a.mood === 'vuelve')) {
        raidStep(s, v.regionId, list, a, me, dt);
        continue;
      }
      if ((a.kind === 'lobo' || a.kind === 'oso') && reactWild(s, a, me, dt, night)) continue;
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (d < 0.2) {
        if (Math.random() < dt * (a.kind === 'perro' ? 0.8 : 0.3)) {
          const R = a.kind === 'perro' ? 14 : a.kind === 'caballo' || a.kind === 'gato' ? 4 : a.water ? 3 : a.kind === 'lobo' ? 7 : a.kind === 'oso' ? 5 : 8;
          a.tx = a.hx + (Math.random() - 0.5) * R;
          a.ty = a.hy + (Math.random() - 0.5) * R * 0.75;
          const tt = s.l.terrain.tiles[idx(Math.floor(a.tx), Math.floor(a.ty))];
          const ok = a.water ? tt === 2 || tt === 1 || tt === 10 : passable(s.w, s.l, a.tx, a.ty) && !animalBlocked(s, a.kind, a.tx, a.ty) && !crowded(list, a, a.tx, a.ty, me);
          if (!ok) (a.tx = a.x), (a.ty = a.y);
        }
        continue;
      }
      const sp = Math.min(d, ({ ciervo: 1.6, perro: 2.2, caballo: 0.8, pato: 0.5, gato: 1.1, lobo: 2, oso: 0.6 } as Record<string, number>)[a.kind] ?? 0.7) * dt;
      const nx = a.x + ((a.tx - a.x) / d) * sp;
      const ny = a.y + ((a.ty - a.y) / d) * sp;
      // Los animales no atraviesan vallas, fuentes ni casas: si el paso está cortado, se paran.
      // (si ya estaba encajado, se le deja salir)
      if (!a.water && (!passable(s.w, s.l, nx, ny) || (animalBlocked(s, a.kind, nx, ny) && !animalBlocked(s, a.kind, a.x, a.y)))) {
        a.tx = a.x;
        a.ty = a.y;
        continue;
      }
      a.flip = a.tx < a.x;
      a.x = nx;
      a.y = ny;
      a.anim += dt * 6;
    }
  }
}

const halfOf = (kind: Animal['kind']) => ANIMAL_HALF[kind];

/**
 * Fieras frente al jugador. El lobo es receloso: a unas 8 casillas se para y te mira, y si te
 * acercas a menos de 4 huye corriendo y se va a otra parte del bosque. El oso no huye: se planta
 * y te mira; si llegas a menos de 2,6 casillas hace una carga de aviso (arremete unos pasos y se
 * para antes de alcanzarte) y luego retrocede despacio sin darte la espalda. Ninguno ataca: es un
 * aviso. Devuelve true si este fotograma ha decidido ella cómo se mueve el animal.
 */
export function reactWild(s: Pick<AnimalsHost, 'w' | 'l' | 'furniture' | 'onWild'>, a: Animal, me: { x: number; y: number }, dt: number, night = false): boolean {
  const kind = a.kind as 'lobo' | 'oso';
  const dx = me.x - a.x;
  const dy = me.y - a.y;
  const dp = Math.hypot(dx, dy) || 0.001;
  const say = (what: WildEvent) => {
    if (a.told?.includes(what)) return;
    a.told = (a.told ?? '') + what;
    s.onWild?.(kind, what);
  };
  // Un paso hacia (tx, ty); se para si el camino está cortado. Devuelve true al llegar.
  const step = (tx: number, ty: number, speed: number, face: 'avance' | 'jugador') => {
    a.tx = tx;
    a.ty = ty;
    const d = Math.hypot(tx - a.x, ty - a.y);
    a.flip = face === 'jugador' ? me.x < a.x : tx < a.x;
    if (d < 0.2) return true;
    const sp = Math.min(d, speed * dt);
    const nx = a.x + ((tx - a.x) / d) * sp;
    const ny = a.y + ((ty - a.y) / d) * sp;
    if (!passable(s.w, s.l, nx, ny) || (animalBlocked(s, a.kind, nx, ny) && !animalBlocked(s, a.kind, a.x, a.y))) {
      a.tx = a.x;
      a.ty = a.y;
      return true;
    }
    a.x = nx;
    a.y = ny;
    a.anim += dt * 6 * Math.max(1, speed / 1.5);
    return false;
  };
  // Un sitio libre a `dist` casillas en la dirección (ux, uy), o girando un poco si está cortado.
  const away = (ux: number, uy: number, dist: number) => {
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const x = a.x + (ux * c - uy * sn) * dist;
      const y = a.y + (ux * sn + uy * c) * dist;
      if (passable(s.w, s.l, x, y) && !animalBlocked(s, a.kind, x, y)) return { x, y };
    }
    return { x: a.x, y: a.y };
  };
  a.cool = Math.max(0, (a.cool ?? 0) - dt);
  if (dp > 14) (a.told = undefined), (a.warned = false); // lejos: el próximo encuentro empieza de nuevo
  if (kind === 'lobo') {
    if (a.mood === 'huye') {
      if (step(a.tx, a.ty, 3.6, 'avance') || dp > 12) {
        a.mood = 'calma';
        // Su sitio pasa a ser donde ha ido a parar (no vuelve enseguida adonde estabas).
        a.hx = a.x;
        a.hy = a.y;
      }
      return true;
    }
    // De noche se crecen: solo huyen si te les echas encima, y antes te siguen a distancia.
    if (dp < (night ? 2.5 : 4)) {
      const t = away(-dx / dp, -dy / dp, 9);
      a.mood = 'huye';
      a.tx = t.x;
      a.ty = t.y;
      say('huye');
      return step(t.x, t.y, 3.6, 'avance'), true;
    }
    if (night && dp < 11) {
      a.mood = 'acecha';
      // Se acerca despacio hasta unas 5 casillas y ahí se queda, mirándote.
      if (dp > 5.5) step(a.x + (dx / dp) * (dp - 5), a.y + (dy / dp) * (dp - 5), 1.3, 'avance');
      else step(a.x, a.y, 0, 'jugador');
      say('acecha');
      return true;
    }
    if (dp < 8) {
      a.mood = 'mira';
      step(a.x, a.y, 0, 'jugador');
      say('mira');
      return true;
    }
    a.mood = 'calma';
    return false;
  }
  // Oso.
  // Si ya te avisó y vuelves a acercarte, ataca de verdad: arremete hasta alcanzarte.
  const attack = () => {
    a.mood = 'ataca';
    a.tx = me.x;
    a.ty = me.y;
    return true;
  };
  if (a.mood === 'ataca') {
    step(me.x, me.y, 5, 'avance');
    if (Math.hypot(me.x - a.x, me.y - a.y) < 1) {
      bearSwipe(s);
      a.mood = 'retrocede';
      a.cool = 12;
      a.warned = false;
      const t = away(-dx / dp, -dy / dp, 7);
      a.tx = t.x;
      a.ty = t.y;
    }
    return true;
  }
  // (la carga de aviso le deja a una casilla de ti: solo cuenta como insistir si te le echas encima
  // cuando ya se está retirando, pasado un segundo y medio)
  if (a.warned && dp < 1.7 && a.mood !== 'carga' && (a.cool ?? 0) < 6.5) return attack();
  if (a.mood === 'carga') {
    if (step(a.tx, a.ty, 4.5, 'avance')) {
      a.mood = 'retrocede';
      const t = away(-dx / dp, -dy / dp, 6);
      a.tx = t.x;
      a.ty = t.y;
    }
    return true;
  }
  if (a.mood === 'retrocede') {
    if (step(a.tx, a.ty, 0.7, 'jugador') || dp > 8) {
      a.mood = dp < 8 ? 'mira' : 'calma';
      a.hx = a.x;
      a.hy = a.y;
    }
    return true;
  }
  if (dp < 2.6 && a.cool <= 0) {
    if (a.warned) return attack();
    a.warned = true;
    // Arremete hasta quedarse a una casilla de ti, sin llegar a tocarte.
    const reach = Math.max(0, dp - 1.1);
    a.mood = 'carga';
    a.cool = 8;
    a.tx = a.x + (dx / dp) * reach;
    a.ty = a.y + (dy / dp) * reach;
    say('carga');
    return true;
  }
  if (dp < 8) {
    a.mood = 'mira';
    step(a.x, a.y, 0, 'jugador');
    say('mira');
    return true;
  }
  a.mood = 'calma';
  return false;
}

/**
 * El zarpazo del oso. La agilidad (y saber pelear) da opción a apartarse a tiempo; si no, una
 * herida de verdad (la salud del protagonista: generations.ts), menos grave cuanta más defensa.
 */
function bearSwipe(s: Pick<AnimalsHost, 'w' | 'onWild'>): void {
  const id = s.w.life?.identity;
  if (!id) return;
  const dodge = Math.min(0.6, Math.max(0.05, 0.15 + (statOf(id, 'agilidad') - STAT_BASE) * 0.05 + levelOf(id, 'combate') * 0.03));
  if (Math.random() < dodge) {
    s.onWild?.('oso', 'esquiva');
    return;
  }
  const sev = (0.3 + Math.random() * 0.3) * Math.max(0.5, 1 - (statOf(id, 'defensa') - STAT_BASE) * 0.07);
  injure(s.w, sev, 'el zarpazo de un oso');
  id.needs.fatigue = Math.min(1, id.needs.fatigue + 0.2);
  s.onWild?.('oso', 'zarpazo');
}

/**
 * El cuerpo de un animal es más ancho que un punto: no se planta con un farol o un poste
 * atravesándolo (ni justo delante ni justo detrás de algo alto: el poste le saldría del lomo).
 */
export function animalBlocked(s: Pick<AnimalsHost, 'furniture' | 'w' | 'l'>, kind: Animal['kind'], x: number, y: number): boolean {
  const half = halfOf(kind);
  if (s.furniture.solidAt(x, y) || s.furniture.solidAt(x - half, y) || s.furniture.solidAt(x + half, y) || s.furniture.tallNear(x, y, half)) return true;
  // Justo detrás de una casa o una valla, el tejado le taparía las patas y parecería subido encima.
  return kind !== 'gallina' && !passable(s.w, s.l, x, y + 1.1);
}

/** Cada animal se para con su sitio: ni encima de otro ni pegado al jugador. */
function crowded(list: Animal[], a: Animal, x: number, y: number, me: { x: number; y: number }): boolean {
  if (Math.abs(me.x - x) < 1.2 && Math.abs(me.y - y) < 0.9) return true;
  for (const b of list) if (b !== a && Math.abs(b.tx - x) < halfOf(a.kind) + halfOf(b.kind) + 0.1 && Math.abs(b.ty - y) < 0.6) return true;
  return false;
}

/** Los rebaños crecen o menguan con la comida y la salud de la tierra. */
function spawnAnimals(s: AnimalsHost, regionId: number): Animal[] {
  const w = s.w;
  const r = w.regions[regionId];
  const v = s.l.villages[regionId];
  const food = r.isHome ? w.player.reserves / 5 : r.food;
  const plenty = r.flags.hambre ? 0.25 : Math.min(1.2, 0.4 + food / 20) * (0.5 + r.ecology * 0.6);
  const out: Animal[] = [];
  const herd = (kind: Animal['kind'], n: number, cx: number, cy: number) => {
    for (let i = 0; i < Math.round(n * plenty); i++) {
      const x = cx + (hash(`${regionId}${kind}`, i) - 0.5) * 6;
      const y = cy + (hash(`${regionId}${kind}`, i + 50) - 0.5) * 5;
      if (!passable(w, s.l, x, y) || animalBlocked(s, kind, x, y)) continue;
      if (out.some((b) => Math.abs(b.x - x) < halfOf(kind) + halfOf(b.kind) && Math.abs(b.y - y) < 0.6)) continue;
      out.push({ kind, x, y, hx: cx, hy: cy, tx: x, ty: y, flip: hash(`${regionId}${kind}`, i + 9) < 0.5, anim: i, v: i });
    }
  };
  const field = v.fields[0] ?? { x: v.cx + 10, y: v.cy + 8, w: 4, h: 4 };
  const pasture = { x: field.x + field.w + 4, y: field.y + 2 };
  if (r.resource === 'lana') herd('oveja', 12, pasture.x, pasture.y);
  else if (r.resource === 'grano' || r.isHome) herd('vaca', 4, pasture.x, pasture.y);
  else herd('vaca', 2, pasture.x, pasture.y);
  herd('gallina', 5, v.cx + v.plazaR + 3, v.cy + v.plazaR + 1);
  if ((r.resource === 'hierbas' || r.resource === 'ambar') && r.ecology > 0.55) herd('ciervo', 3, v.cx + 26, v.cy - 18);
  // Caballos junto al establo y perros por las calles.
  const stable = v.keys.find((k) => k.kind === 'establo');
  if (stable) herd('caballo', 2.6, stable.x + stable.w / 2, stable.y + stable.h + 2);
  for (let i = 0; i < (r.population > 700 ? 2 : 1); i++) {
    const x = v.cx + 0.5 + (hash(`${regionId}perro`, i) - 0.5) * 8;
    const y = v.cy + v.plazaR + 1.5;
    if (passable(w, s.l, x, y) && !animalBlocked(s, 'perro', x, y)) out.push({ kind: 'perro', x, y, hx: v.cx + 0.5, hy: v.cy + 0.5, tx: x, ty: y, flip: false, anim: i, v: i });
  }
  // Un gato o dos rondando las casas.
  for (let i = 0; i < (r.population > 500 ? 2 : 1); i++) {
    const b = v.houses[Math.floor(hash(`${regionId}gato`, i) * Math.min(8, v.houses.length))];
    if (!b) break;
    // (junto a una esquina de la casa, no delante de la puerta: ahí trabaja la gente, y en la
    // forja se subía al yunque)
    const x = hash(`${regionId}gato`, i + 3) < 0.5 ? b.x - 0.7 : b.x + b.w + 0.7;
    const y = b.y + b.h - 0.2;
    if (passable(w, s.l, x, y) && !animalBlocked(s, 'gato', x, y)) out.push({ kind: 'gato', x, y, hx: x, hy: y, tx: x, ty: y, flip: hash(`${regionId}gato`, i + 5) < 0.5, anim: i, v: Math.floor(hash(`${regionId}gato`, i + 7) * 3) });
  }
  // Fieras en el bosque, lejos del pueblo: una manada de lobos donde los hay, y algún oso en
  // bosques y montes que no sean cálidos ni áridos.
  const geo = geoOf(w, regionId);
  // (en el bosque si lo hay a esa distancia; si no, en el monte o el prado abierto, nunca en
  // caminos, campos ni plazas)
  const wild = (kind: 'lobo' | 'oso', n: number, salt: number) => {
    for (const ok of [(t: number) => t === T.Forest, (t: number) => t === T.Forest || t === T.Grass || t === T.Meadow]) {
      for (let k = 0; k < 60; k++) {
        const a = hash(`${regionId}${kind}`, k + salt) * Math.PI * 2;
        const d = 32 + hash(`${regionId}${kind}`, k + salt + 70) * 10;
        const x = v.cx + 0.5 + Math.cos(a) * d;
        const y = v.cy + 0.5 + Math.sin(a) * d;
        if (!ok(s.l.terrain.tiles[idx(Math.floor(x), Math.floor(y))]) || !passable(w, s.l, x, y)) continue;
        herd(kind, n / Math.max(0.25, plenty), x, y);
        return;
      }
    }
  };
  const cold = geo.climate === 'frio';
  const hills = geo.biome === 'bosque' || geo.biome === 'montana';
  if (geo.fauna.includes('lobos') || cold || (hills && hash(`${regionId}lobo`, 99) < 0.6)) wild('lobo', 3, 0);
  if (hills && geo.climate !== 'calido' && geo.climate !== 'arido' && hash(`${regionId}oso`, 99) < 0.6) wild('oso', 1, 200);
  // Patos donde hay agua cerca.
  for (let k = 0; k < 40; k++) {
    const x = v.cx + 0.5 + (hash(`${regionId}pato`, k) - 0.5) * 50;
    const y = v.cy + 0.5 + (hash(`${regionId}pato`, k + 99) - 0.5) * 50;
    const tt = s.l.terrain.tiles[idx(Math.floor(x), Math.floor(y))];
    if (tt !== 2 && tt !== 10) continue;
    for (let i = 0; i < 3; i++) out.push({ kind: 'pato', x: x + i * 0.4, y: y + (i % 2) * 0.3, hx: x, hy: y, tx: x, ty: y, flip: i % 2 === 0, anim: i, water: true, v: i });
    break;
  }
  return out;
}

/** Paso de un animal hacia (tx, ty) a `speed` casillas/s; se para si el camino está cortado. Devuelve true al llegar. */
function walkTo(s: Pick<AnimalsHost, 'w' | 'l' | 'furniture'>, a: Animal, tx: number, ty: number, speed: number, dt: number): boolean {
  a.tx = tx;
  a.ty = ty;
  const d = Math.hypot(tx - a.x, ty - a.y);
  if (d < 0.25) return true;
  a.flip = tx < a.x;
  const sp = Math.min(d, speed * dt);
  const nx = a.x + ((tx - a.x) / d) * sp;
  const ny = a.y + ((ty - a.y) / d) * sp;
  if (!passable(s.w, s.l, nx, ny)) {
    // Rodea por un lado si tiene delante una casa o una valla.
    const sx = a.x + (-(ty - a.y) / d) * sp;
    const sy = a.y + ((tx - a.x) / d) * sp;
    if (!passable(s.w, s.l, sx, sy)) return false;
    a.x = sx;
    a.y = sy;
  } else {
    a.x = nx;
    a.y = ny;
  }
  a.anim += dt * 6 * Math.max(1, speed / 1.5);
  return false;
}

/**
 * Asalto nocturno: la manada del pueblo baja a por una res (oveja, gallina o vaca). Si no hay
 * ganado, no baja. La guardia y quien explora (scene.ts) o el propio jugador pueden ahuyentarla.
 */
export function startRaid(s: Pick<AnimalsHost, 'onWild'>, regionId: number, list: Animal[]): boolean {
  const wolves = list.filter((a) => a.kind === 'lobo' && a.mood !== 'huye');
  if (!wolves.length) return false;
  const cx = wolves.reduce((t, a) => t + a.x, 0) / wolves.length;
  const cy = wolves.reduce((t, a) => t + a.y, 0) / wolves.length;
  let prey: Animal | undefined;
  let best = Infinity;
  for (const a of list) {
    if (!LIVESTOCK.has(a.kind) || a.water) continue;
    const d = Math.hypot(a.x - cx, a.y - cy);
    if (d < best) (best = d), (prey = a);
  }
  if (!prey) return false;
  for (const w of wolves) {
    w.mood = 'asalta';
    w.prey = prey;
    w.den = { x: w.hx, y: w.hy };
  }
  s.onWild?.('lobo', 'asalto', { regionId });
  return true;
}

/** Ahuyenta a los lobos que asaltan este pueblo: vuelven corriendo a su guarida. */
export function scareRaiders(s: Pick<AnimalsHost, 'onWild'>, regionId: number, list: Animal[], by: 'guardia' | 'jugador'): void {
  let any = false;
  for (const a of list)
    if (a.kind === 'lobo' && a.mood === 'asalta') {
      a.mood = 'vuelve';
      a.prey = undefined;
      any = true;
    }
  if (any) s.onWild?.('lobo', 'ahuyentados', { regionId, by });
}

export function raidStep(s: Pick<AnimalsHost, 'w' | 'l' | 'furniture' | 'onWild'>, regionId: number, list: Animal[], a: Animal, me: { x: number; y: number }, dt: number): void {
  const den = a.den ?? { x: a.hx, y: a.hy };
  // Sigue un camino de verdad hasta (gx, gy): en línea recta se atascaba contra la primera casa.
  const go = (gx: number, gy: number, speed: number): boolean => {
    a.routeAge = (a.routeAge ?? 99) + dt;
    const last = a.route?.[a.route.length - 1];
    if (!a.route || a.routeAge > 2 || !last || Math.hypot(last.x - gx, last.y - gy) > 1.5) {
      a.route = findPath(s.w, a.x, a.y, gx, gy, 3000);
      if (!a.route.length) a.route = [{ x: gx, y: gy }];
      a.routeAge = 0;
    }
    const n = a.route[0];
    const x0 = a.x;
    const y0 = a.y;
    if (walkTo(s, a, n.x, n.y, speed, dt)) a.route.shift();
    // Sin avanzar unos segundos: se rinde (vuelve a la guarida, o se queda donde está si ya volvía).
    a.stuck = Math.hypot(a.x - x0, a.y - y0) < speed * dt * 0.2 ? (a.stuck ?? 0) + dt : 0;
    return !a.route.length && Math.hypot(gx - a.x, gy - a.y) < 0.6;
  };
  if (a.mood === 'vuelve') {
    if (go(den.x, den.y, 3.4) || (a.stuck ?? 0) > 4) {
      a.mood = 'calma';
      a.hx = a.x;
      a.hy = a.y;
      a.tx = a.x;
      a.ty = a.y;
      a.route = undefined;
      a.stuck = 0;
    }
    return;
  }
  // Con el jugador encima (a menos de 3 casillas), la manada se lo piensa y se va.
  if (Math.hypot(me.x - a.x, me.y - a.y) < 3) return scareRaiders(s, regionId, list, 'jugador');
  const prey = a.prey;
  if (!prey || !list.includes(prey) || (a.stuck ?? 0) > 4) {
    a.mood = 'vuelve';
    a.prey = undefined;
    a.route = undefined;
    a.stuck = 0;
    return;
  }
  // La res corre a apartarse (más despacio que el lobo).
  const pd = Math.hypot(prey.x - a.x, prey.y - a.y) || 0.001;
  if (pd < 5) walkTo(s, prey, prey.x + ((prey.x - a.x) / pd) * 1.5, prey.y + ((prey.y - a.y) / pd) * 1.5, prey.kind === 'gallina' ? 1.4 : 1.1, dt);
  if (pd < 2) walkTo(s, a, prey.x, prey.y, 2.6, dt);
  else go(prey.x, prey.y, 2.6);
  if (Math.hypot(prey.x - a.x, prey.y - a.y) < 0.9) {
    list.splice(list.indexOf(prey), 1);
    for (const w of list)
      if (w.kind === 'lobo' && w.mood === 'asalta') {
        w.mood = 'vuelve';
        w.prey = undefined;
        w.route = undefined;
      }
    s.onWild?.('lobo', 'presa', { regionId, prey: prey.kind });
  }
}
