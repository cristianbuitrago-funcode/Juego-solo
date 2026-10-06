import { CULTURES } from '../core/content/cultures';
import { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { getTerrain, idx, inside, type Terrain } from './terrain';
import { T, TH, TW, WORLD_SCALE } from './types';

/**
 * Disposición física del mundo: pueblos (plaza, edificios clave, ranuras de
 * casas, campos, puestos de mercado), caminos trazados sobre el terreno con
 * puentes sobre el río, puestos fronterizos y lugares por descubrir.
 * Es determinista a partir de la semilla; lo que cambia con el tiempo
 * (qué casas existen, cuáles arden, murallas…) vive en `Life.towns`.
 */
export type BuildingKind = 'casa' | 'salon' | 'almacen' | 'posada' | 'templo' | 'forja' | 'hogar' | 'establo' | 'granero';

export type PropKindL = 'banco' | 'farol' | 'barril' | 'cajas' | 'fuente' | 'pozo' | 'estatua' | 'valla' | 'vallaV' | 'heno' | 'lenya' | 'carro' | 'cartel' | 'abrevadero';

export interface Prop {
  kind: PropKindL;
  x: number; // teselas (pies del objeto)
  y: number;
  v: number;
}

export interface Building {
  kind: BuildingKind;
  x: number; // esquina superior izquierda (teselas)
  y: number;
  w: number;
  h: number;
  slot?: number; // índice de casa
}

export interface Village {
  regionId: number;
  cx: number;
  cy: number;
  plazaR: number;
  keys: Building[]; // salón, almacén, posada, templo, forja (y tu casa en el hogar)
  houses: Building[]; // ranuras ordenadas de dentro hacia fuera
  fields: { x: number; y: number; w: number; h: number }[];
  stalls: { x: number; y: number }[];
  wallR: number;
  props: Prop[]; // fuente, bancos, faroles, barriles, vallas, heno…
  sign: { x: number; y: number }; // poste del cruce de caminos
  lamps: { x: number; y: number }[]; // faroles que se encienden de noche
}

export interface Road {
  routeId: number;
  a: number;
  b: number;
  path: { x: number; y: number }[]; // teselas, de a hacia b
}

export interface Post {
  routeId: number;
  a: number;
  b: number;
  x: number;
  y: number;
  pathIndex: number;
}

export type PlaceKind = 'cueva' | 'ruinas' | 'camino' | 'campamento' | 'bosque' | 'mina' | 'templo' | 'abandonada' | 'puesto' | 'secreto' | 'circulo';

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  regionId: number;
  x: number;
  y: number;
  fragment?: string; // fragmento del misterio que se descubre al examinarlo
}

export interface Layout {
  terrain: Terrain;
  villages: Village[]; // índice = id de región
  roads: Road[];
  posts: Post[];
  places: Place[];
  blocked: Uint8Array; // edificios (1) y otros obstáculos estáticos
}

const cache = new Map<number, Layout>();

export function getLayout(w: WorldState): Layout {
  const hit = cache.get(w.seed);
  if (hit) return hit;
  const l = buildLayout(w);
  cache.set(w.seed, l);
  if (cache.size > 2) cache.delete(cache.keys().next().value!);
  return l;
}

const natural = (t: number) => t === T.Grass || t === T.Meadow || t === T.Forest || t === T.Sand || t === T.Clay || t === T.Rock || t === T.Salt;

function buildLayout(w: WorldState): Layout {
  const terrain = getTerrain(w);
  // El trazado escribe plazas y caminos en las teselas del terreno (que está en caché). Si se
  // vuelve a construir (otra partida abierta entre medias, otra instancia del módulo), debe partir
  // del terreno original: si no, los pueblos se colocan en otro sitio y no casan con lo guardado.
  if (terrain.natural) terrain.tiles.set(terrain.natural);
  else terrain.natural = terrain.tiles.slice();
  const tiles = terrain.tiles;
  const blocked = new Uint8Array(TW * TH);
  const rng = new Rng(w.seed ^ 0x5bd1e995);

  const free = (x: number, y: number, bw: number, bh: number, regionId: number, margin = 1) => {
    for (let j = -margin; j < bh + margin; j++)
      for (let i = -margin; i < bw + margin; i++) {
        const tx = x + i;
        const ty = y + j;
        if (!inside(tx, ty)) return false;
        const k = idx(tx, ty);
        if (blocked[k] || terrain.region[k] !== regionId) return false;
        if (j >= 0 && j < bh && i >= 0 && i < bw && !natural(tiles[k])) return false;
        if (tiles[k] === T.River || tiles[k] === T.Sea || tiles[k] === T.Mountain || tiles[k] === T.Plaza) return false;
      }
    return true;
  };
  const occupy = (b: Building) => {
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) blocked[idx(b.x + i, b.y + j)] = 1;
  };

  // 1) Pueblos.
  const villages: Village[] = w.regions.map((r) => {
    let cx = Math.round(r.center.x / WORLD_SCALE);
    let cy = Math.round(r.center.y / WORLD_SCALE);
    // Busca un claro cercano para la plaza.
    let best = { x: cx, y: cy, score: -Infinity };
    for (let d = 0; d < 26; d += 2)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = Math.round(cx + Math.cos(a) * d);
        const y = Math.round(cy + Math.sin(a) * d);
        if (!inside(x, y) || terrain.region[idx(x, y)] !== r.id) continue;
        let ok = 0;
        for (let j = -6; j <= 6; j += 2) for (let i = -6; i <= 6; i += 2) if (inside(x + i, y + j) && natural(tiles[idx(x + i, y + j)]) && tiles[idx(x + i, y + j)] !== T.Rock) ok++;
        const score = ok - d * 0.15;
        if (score > best.score) best = { x, y, score };
      }
    cx = best.x;
    cy = best.y;
    const plazaR = r.isHome ? 6 : 5 + (r.population > 900 ? 1 : 0);
    for (let j = -plazaR; j <= plazaR; j++)
      for (let i = -plazaR; i <= plazaR; i++) {
        if (i * i + j * j > plazaR * plazaR + 1 || !inside(cx + i, cy + j)) continue;
        const k = idx(cx + i, cy + j);
        if (tiles[k] !== T.River) tiles[k] = T.Plaza;
      }
    // Claro del pueblo: la gente tala el bosque y drena la marisma alrededor de sus casas.
    const clearR = plazaR + 36;
    for (let j = -clearR; j <= clearR; j++)
      for (let i = -clearR; i <= clearR; i++) {
        const x = cx + i;
        const y = cy + j;
        if (!inside(x, y) || i * i + j * j > clearR * clearR) continue;
        const k = idx(x, y);
        if (terrain.region[k] !== r.id) continue;
        const edge = i * i + j * j > (clearR - 4) * (clearR - 4) && terrain.variant[k] < 110;
        if ((tiles[k] === T.Forest && !edge) || (tiles[k] === T.Marsh && i * i + j * j < 100)) tiles[k] = T.Grass;
      }
    return { regionId: r.id, cx, cy, plazaR, keys: [], houses: [], fields: [], stalls: [], wallR: 0, props: [], sign: { x: cx + 0.5, y: cy + plazaR - 0.6 }, lamps: [] };
  });

  // 2) Edificios clave alrededor de la plaza y ranuras de casas.
  for (const v of villages) {
    const r = w.regions[v.regionId];
    const traits = CULTURES.find((c) => c.id === r.culture)?.traits;
    // Tamaños en teselas: una persona mide 3 teselas; una casa, 5 × 3.
    const wanted: [BuildingKind, number, number][] = [['salon', 8, 5], ['almacen', 6, 4], ['posada', 6, 4]];
    if (r.isHome) wanted.push(['hogar', 5, 3]);
    if (!r.isHome && (traits?.spirituality ?? 0.5) >= 0.45) wanted.push(['templo', 6, 6]);
    if (!r.isHome) wanted.push(['forja', 5, 3]);
    if (r.population > 500 || r.resource === 'lana' || r.resource === 'grano') wanted.push(['establo', 6, 3]);
    if (r.resource === 'grano' || r.resource === 'lana' || r.isHome) wanted.push(['granero', 5, 4]);
    let angle = rng.next() * Math.PI * 2;
    for (const [kind, bw, bh] of wanted) {
      for (let tries = 0; tries < 60; tries++) {
        const d = v.plazaR + 3 + Math.floor(tries / 12) * 3;
        const a = angle + (tries % 12) * (Math.PI / 6);
        const x = Math.round(v.cx + Math.cos(a) * (d + bw / 2) - bw / 2);
        const y = Math.round(v.cy + Math.sin(a) * (d + bh / 2) - bh / 2);
        if (!free(x, y, bw, bh, v.regionId)) continue;
        const b: Building = { kind, x, y, w: bw, h: bh };
        v.keys.push(b);
        occupy(b);
        angle = a + Math.PI / 2.4;
        break;
      }
    }
    // Ranuras de casas en anillos (de dentro hacia fuera: el pueblo crece hacia fuera).
    for (let d = v.plazaR + 7; d < 46 && v.houses.length < 40; d += 5.5) {
      const count = Math.floor((2 * Math.PI * d) / 7.5);
      const off = rng.next() * Math.PI * 2;
      for (let k = 0; k < count; k++) {
        const a = off + (k / count) * Math.PI * 2;
        const hw = rng.chance(0.35) ? 4 : 5;
        const x = Math.round(v.cx + Math.cos(a) * d + rng.range(-0.8, 0.8) - hw / 2);
        const y = Math.round(v.cy + Math.sin(a) * d + rng.range(-0.8, 0.8) - 1.5);
        if (!free(x, y, hw, 3, v.regionId)) continue;
        const b: Building = { kind: 'casa', x, y, w: hw, h: 3, slot: v.houses.length };
        v.houses.push(b);
        occupy(b);
      }
    }
    // Puestos de mercado en el borde de la plaza.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      v.stalls.push({ x: v.cx + 0.5 + Math.cos(a) * (v.plazaR - 1.6), y: v.cy + 0.5 + Math.sin(a) * (v.plazaR - 1.6) });
    }
  }

  // 3) Caminos con A* sobre una rejilla gruesa (2×2 teselas).
  const roads: Road[] = [];
  const roadCells = new Uint8Array((TW >> 1) * (TH >> 1));
  for (const route of w.routes) {
    const a = villages[route.a];
    const b = villages[route.b];
    const path = findRoad(terrain, blocked, roadCells, a.cx, a.cy, b.cx, b.cy);
    if (!path.length) continue;
    for (const p of path) roadCells[(p.y >> 1) * (TW >> 1) + (p.x >> 1)] = 1;
    roads.push({ routeId: route.id, a: route.a, b: route.b, path });
  }
  // Pintar caminos y puentes.
  for (const road of roads)
    for (let i = 0; i < road.path.length; i++) {
      const p = road.path[i];
      const q = road.path[Math.min(road.path.length - 1, i + 1)];
      for (let s = 0; s <= 1; s++) {
        const x0 = Math.round(p.x + ((q.x - p.x) * s) / 2);
        const y0 = Math.round(p.y + ((q.y - p.y) * s) / 2);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]]) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (!inside(x, y)) continue;
          const k = idx(x, y);
          const t = tiles[k];
          if (t === T.River) tiles[k] = T.Bridge;
          else if (t === T.Sea || t === T.Deep) continue;
          else if (t !== T.Plaza && t !== T.Sea && t !== T.Deep && t !== T.Bridge) tiles[k] = T.Road;
          if (!blocked[k]) continue;
          blocked[k] = 0; // un camino nunca queda tapado
        }
      }
    }

  // 4) Campos de cultivo alrededor de cada pueblo.
  for (const v of villages) {
    const r = w.regions[v.regionId];
    const n = r.resource === 'grano' ? 12 : r.resource === 'lana' ? 5 : r.resource === 'hierro' || r.resource === 'sal' ? 3 : 6;
    for (let tries = 0; tries < 160 && v.fields.length < n; tries++) {
      const a = rng.next() * Math.PI * 2;
      const d = rng.range(30, 54);
      const fw = rng.int(7, 11);
      const fh = rng.int(5, 7);
      const x = Math.round(v.cx + Math.cos(a) * d - fw / 2);
      const y = Math.round(v.cy + Math.sin(a) * d - fh / 2);
      let ok = true;
      for (let j = 0; j < fh && ok; j++)
        for (let i = 0; i < fw && ok; i++) {
          if (!inside(x + i, y + j)) ok = false;
          else {
            const k = idx(x + i, y + j);
            const t = tiles[k];
            ok = (t === T.Grass || t === T.Meadow || t === T.Clay) && !blocked[k] && terrain.region[k] === v.regionId;
          }
        }
      if (!ok) continue;
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) tiles[idx(x + i, y + j)] = T.Field;
      v.fields.push({ x, y, w: fw, h: fh });
      // Vallas alrededor del campo (con un hueco para entrar).
      for (let i = 0; i < fw; i += 1.15) {
        v.props.push({ kind: 'valla', x: x + i + 0.55, y: y - 0.1, v: 0 });
        if (i < fw / 2 - 1 || i > fw / 2 + 0.5) v.props.push({ kind: 'valla', x: x + i + 0.55, y: y + fh + 0.1, v: 0 });
      }
      for (let j = 0; j < fh; j += 1.2) {
        v.props.push({ kind: 'vallaV', x: x - 0.1, y: y + j + 1, v: 0 });
        v.props.push({ kind: 'vallaV', x: x + fw + 0.1, y: y + j + 1, v: 0 });
      }
    }
    furnish(v, w.regions[v.regionId], tiles, blocked, rng, w.seed);
  }

  // 5) Puestos fronterizos donde un camino cruza de una región a otra.
  const posts: Post[] = [];
  for (const road of roads) {
    for (let i = 1; i < road.path.length; i++) {
      const p = road.path[i];
      const reg = terrain.region[idx(p.x, p.y)];
      if (reg >= 0 && reg !== road.a) {
        const q = road.path[Math.max(0, i - 2)];
        posts.push({ routeId: road.routeId, a: road.a, b: road.b, x: q.x, y: q.y, pathIndex: Math.max(0, i - 2) });
        break;
      }
    }
  }

  const places = makePlaces(w, terrain, villages, blocked, rng);
  for (const v of villages) {
    const far = v.houses.length ? Math.max(...v.houses.map((h) => Math.hypot(h.x + 1 - v.cx, h.y + 1 - v.cy))) : 8;
    v.wallR = far + 3;
  }
  return { terrain, villages, roads, posts, places, blocked };
}

/**
 * Mobiliario con función: fuente o pozo en la plaza, bancos donde se sientan
 * los ancianos, faroles que se encienden de noche, barriles y cajas junto a
 * la posada y el almacén, heno junto al granero, abrevadero en el establo,
 * y calles que unen cada puerta con la plaza.
 */
function furnish(v: Village, r: { isHome: boolean }, tiles: Uint8Array, blocked: Uint8Array, rng: Rng, seed: number): void {
  const add = (kind: Prop['kind'], x: number, y: number, block = false) => {
    v.props.push({ kind, x, y, v: rng.int(0, 5) });
    if (block) blocked[idx(Math.floor(x), Math.floor(y - 0.3))] = 1;
  };
  // Calles: de cada puerta a la plaza.
  const street = (fx: number, fy: number, wide: boolean) => {
    const steps = Math.ceil(Math.hypot(v.cx - fx, v.cy - fy) * 1.5);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(fx + ((v.cx - fx) * s) / steps);
      const y = Math.round(fy + ((v.cy - fy) * s) / steps);
      for (const [dx, dy] of wide ? [[0, 0], [1, 0], [0, 1]] : [[0, 0]]) {
        if (!inside(x + dx, y + dy)) continue;
        const k = idx(x + dx, y + dy);
        if (tiles[k] === T.Plaza) return;
        if (!blocked[k] && (tiles[k] === T.Grass || tiles[k] === T.Meadow || tiles[k] === T.Forest || tiles[k] === T.Clay || tiles[k] === T.Sand)) tiles[k] = T.Road;
      }
    }
  };
  for (const b of v.keys) street(b.x + b.w / 2, b.y + b.h + 0.6, true);
  // Las casas solo tienen un sendero corto ante la puerta: el pueblo sigue siendo verde.
  for (const b of v.houses)
    for (let s = 0; s < 2; s++) {
      const k = idx(Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h + s));
      if (!blocked[k] && (tiles[k] === T.Grass || tiles[k] === T.Meadow || tiles[k] === T.Clay)) tiles[k] = T.Road;
    }
  // Plaza: cada pueblo la suya. El centro depende de su tamaño (en casas, que no
  // cambia) y de su suerte: fuente, pozo o el monumento a alguien; bancos y faroles
  // tampoco se repiten igual. Generador propio por pueblo: la disposición no depende
  // del estado del mundo (al recargar una partida, el pueblo sigue igual).
  const pr = new Rng(((seed >>> 0) * 31 + v.regionId * 7919 + 17) >>> 0);
  const size = v.houses.length;
  const center = r.isHome ? 'fuente' : size > 30 && pr.chance(0.5) ? 'estatua' : size > 14 ? (pr.chance(0.75) ? 'fuente' : 'estatua') : 'pozo';
  add(center, v.cx + 0.5, v.cy + 1.6, false);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blocked[idx(v.cx + dx, v.cy + dy)] = 1;
  // Cuatro bancos (los ancianos van a sentarse en ellos), girados a gusto de cada pueblo.
  const benches = 4;
  const turn = r.isHome ? Math.PI / 4 : Math.PI / 4 + Math.round(pr.next() * 3) * (Math.PI / 8);
  // Los puestos giran con los bancos: cada plaza tiene su trazado y nunca se pisan.
  const spin = turn - Math.PI / 4;
  if (spin) for (const st of v.stalls) {
    const dx = st.x - (v.cx + 0.5);
    const dy = st.y - (v.cy + 0.5);
    st.x = v.cx + 0.5 + dx * Math.cos(spin) - dy * Math.sin(spin);
    st.y = v.cy + 0.5 + dx * Math.sin(spin) + dy * Math.cos(spin);
  }
  for (let k = 0; k < benches; k++) {
    let a = (k / benches) * Math.PI * 2 + turn;
    // El banco que caería sobre el poste de caminos (al sur) se corre a un lado.
    const bx = v.cx + 0.5 + Math.cos(a) * (v.plazaR - 0.6);
    const by = v.cy + 0.5 + Math.sin(a) * (v.plazaR - 0.6);
    if (Math.hypot(bx - (v.sign.x + 1.2), by - (v.sign.y + 0.4)) < 2.6) a -= Math.PI / 5;
    add('banco', v.cx + 0.5 + Math.cos(a) * (v.plazaR - 0.6), v.cy + 0.5 + Math.sin(a) * (v.plazaR - 0.6));
  }
  // Los faroles conservan su corona de seis (bloquean el paso: moverlos cambia por dónde camina la gente).
  const lamps = 6;
  const lturn = 0;
  for (let k = 0; k < lamps; k++) {
    const a = (k / lamps) * Math.PI * 2 + lturn;
    const p = { x: v.cx + 0.5 + Math.cos(a) * (v.plazaR + 0.6), y: v.cy + 0.5 + Math.sin(a) * (v.plazaR + 0.6) };
    add('farol', p.x, p.y, true);
    v.lamps.push({ x: p.x, y: p.y - 3 });
  }
  add('cartel', v.sign.x + 1.2, v.sign.y + 0.4);
  for (const b of v.keys) {
    const door = { x: b.x + b.w / 2, y: b.y + b.h + 0.6 };
    if (b.kind === 'posada' || b.kind === 'almacen' || b.kind === 'forja') {
      add('barril', b.x - 0.4, b.y + b.h - 0.1);
      add('cajas', b.x + b.w + 0.6, b.y + b.h - 0.1);
    }
    if (b.kind === 'almacen') add('carro', b.x + b.w + 2.4, b.y + b.h + 1.6);
    if (b.kind === 'granero') {
      add('heno', b.x - 1.2, b.y + b.h + 0.4);
      add('heno', b.x + b.w + 1.2, b.y + b.h + 0.8);
    }
    if (b.kind === 'establo') add('abrevadero', door.x + 3, door.y + 0.8);
    if (b.kind === 'salon' || b.kind === 'templo' || b.kind === 'posada') {
      add('farol', door.x - 2.4, door.y + 0.2, true);
      v.lamps.push({ x: door.x - 2.4, y: door.y - 2.8 });
    }
  }
  for (const b of v.houses) if (rng.chance(0.25)) add(rng.chance(0.5) ? 'lenya' : 'barril', b.x + b.w + 0.5, b.y + b.h - 0.2);
}

// ---------------------------------------------------------------------------
// A* para caminos
// ---------------------------------------------------------------------------
function roadCost(t: number): number {
  switch (t) {
    case T.Road:
    case T.Plaza:
      return 0.6;
    case T.Grass:
    case T.Meadow:
    case T.Clay:
    case T.Field:
      return 1;
    case T.Sand:
    case T.Salt:
      return 1.6;
    case T.Forest:
      return 2.2;
    case T.Rock:
      return 3;
    case T.Marsh:
      return 4;
    case T.Mountain:
      return 14;
    case T.River:
    case T.Bridge:
      return 18;
    default:
      return Infinity;
  }
}

class Heap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number): void {
    const a = this.items;
    const q = this.prio;
    a.push(item);
    q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= q[i]) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      [q[i], q[parent]] = [q[parent], q[i]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const q = this.prio;
    const top = a[0];
    const li = a.pop()!;
    const lp = q.pop()!;
    if (a.length) {
      a[0] = li;
      q[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [q[i], q[m]] = [q[m], q[i]];
        i = m;
      }
    }
    return top;
  }
}

export { Heap };

function findRoad(terrain: Terrain, blocked: Uint8Array, roadCells: Uint8Array, ax: number, ay: number, bx: number, by: number): { x: number; y: number }[] {
  const GW = TW >> 1;
  const GH = TH >> 1;
  const cost = (cx: number, cy: number) => {
    const x = cx * 2 + 1;
    const y = cy * 2 + 1;
    const k = idx(x, y);
    if (roadCells[cy * GW + cx]) return 0.45;
    if (blocked[k] || blocked[idx(x - 1, y - 1)]) return 30;
    return roadCost(terrain.tiles[k]);
  };
  const start = (ay >> 1) * GW + (ax >> 1);
  const goal = (by >> 1) * GW + (bx >> 1);
  const g = new Float32Array(GW * GH).fill(Infinity);
  const from = new Int32Array(GW * GH).fill(-1);
  const closed = new Uint8Array(GW * GH);
  const heap = new Heap();
  g[start] = 0;
  heap.push(start, 0);
  const gx = goal % GW;
  const gy = (goal / GW) | 0;
  while (heap.size) {
    const c = heap.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) break;
    const cx = c % GW;
    const cy = (c / GW) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const step = cost(nx, ny);
        if (!Number.isFinite(step)) continue;
        const n = ny * GW + nx;
        const ng = g[c] + step * (dx && dy ? 1.414 : 1);
        if (ng < g[n]) {
          g[n] = ng;
          from[n] = c;
          heap.push(n, ng + Math.hypot(nx - gx, ny - gy) * 1.1);
        }
      }
  }
  if (from[goal] < 0) return [];
  const out: { x: number; y: number }[] = [];
  for (let c = goal; c >= 0; c = from[c]) out.push({ x: (c % GW) * 2 + 1, y: ((c / GW) | 0) * 2 + 1 });
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Lugares por descubrir
// ---------------------------------------------------------------------------
const PLACE_NAMES: Record<PlaceKind, string[]> = {
  cueva: ['Cueva de los Susurros', 'Gruta del Eco', 'Boca de Piedra'],
  ruinas: ['Ruinas sin nombre', 'Muros caídos', 'Restos de un fortín'],
  camino: ['Camino antiguo', 'Calzada olvidada'],
  campamento: ['Campamento de cazadores', 'Hogueras frías'],
  bosque: ['Arboleda sagrada', 'Bosque de los Ancianos'],
  mina: ['Mina abandonada', 'Galería de los mineros'],
  templo: ['Templo derruido', 'Santuario del Alba'],
  abandonada: ['Granja abandonada', 'Casa vacía'],
  puesto: ['Puesto comercial', 'Venta del cruce'],
  secreto: ['Lugar sin mapa', 'Claro escondido'],
  circulo: ['Círculo de piedras', 'Menhires del viento'],
};

function makePlaces(w: WorldState, terrain: Terrain, villages: Village[], blocked: Uint8Array, rng: Rng): Place[] {
  const places: Place[] = [];
  const tilesOf: Record<number, number[]> = {};
  for (let y = 0; y < TH; y += 3)
    for (let x = 0; x < TW; x += 3) {
      const k = idx(x, y);
      const r = terrain.region[k];
      if (r < 0 || !natural(terrain.tiles[k]) || blocked[k]) continue;
      (tilesOf[r] ??= []).push(k);
    }
  const spot = (regionId: number, prefer: (t: number) => boolean): { x: number; y: number } | null => {
    const v = villages[regionId];
    const pool = (tilesOf[regionId] ?? []).filter((k) => {
      const x = k % TW;
      const y = (k / TW) | 0;
      return Math.hypot(x - v.cx, y - v.cy) > 24 && !places.some((p) => Math.hypot(p.x - x, p.y - y) < 14);
    });
    const preferred = pool.filter((k) => prefer(terrain.tiles[k]));
    const list = preferred.length ? preferred : pool;
    if (!list.length) return null;
    const k = rng.pick(list);
    return { x: k % TW, y: (k / TW) | 0 };
  };
  const add = (regionId: number, kind: PlaceKind, fragment?: string) => {
    const prefer: Record<PlaceKind, (t: number) => boolean> = {
      cueva: (t) => t === T.Rock,
      mina: (t) => t === T.Rock,
      bosque: (t) => t === T.Forest,
      campamento: (t) => t === T.Forest || t === T.Meadow,
      circulo: (t) => t === T.Meadow || t === T.Grass,
      ruinas: () => true,
      camino: () => true,
      templo: () => true,
      abandonada: (t) => t === T.Grass || t === T.Meadow,
      puesto: () => true,
      secreto: (t) => t === T.Forest || t === T.Rock,
    };
    const p = spot(regionId, prefer[kind]);
    if (!p) return;
    places.push({ id: `l${places.length + 1}`, kind, name: rng.pick(PLACE_NAMES[kind]), regionId, x: p.x, y: p.y, fragment });
  };

  for (const r of w.regions) {
    const kinds: PlaceKind[] = ['ruinas', 'camino', 'abandonada', 'puesto', 'campamento'];
    if (r.resource === 'hierro') kinds.push('mina', 'cueva', 'cueva');
    if (r.resource === 'hierbas' || r.resource === 'ambar') kinds.push('bosque', 'bosque');
    if (r.resource === 'lana' || r.resource === 'grano') kinds.push('circulo');
    kinds.push('templo', 'cueva');
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) if (rng.chance(0.8)) add(r.id, rng.pick(kinds));
    if (rng.chance(0.15)) add(r.id, 'secreto'); // algunos lugares no existen en todas las partidas
  }
  // Lugares ligados a la verdad oculta del mundo.
  const m = w.mystery;
  const culprit = m.culpritRegion;
  if (culprit >= 0) {
    if (m.kind === 'manipulador') add(culprit, 'campamento', 'm_pagos');
    if (m.kind === 'rio') add(culprit, 'mina', 'f_vertidos');
    if (m.kind === 'invierno') add(culprit, 'cueva', 'i_escarcha');
    if (m.kind === 'ruinas') {
      add(culprit, 'ruinas', 'r_camara');
      const nb = w.regions[culprit].neighbors.find((n) => !w.regions[n].isHome);
      if (nb !== undefined) add(nb, 'circulo', 'r_mapa');
    }
  }
  if (m.kind === 'invierno') {
    const elder = w.regions.find((r) => !r.isHome && r.id !== culprit);
    if (elder) add(elder.id, 'templo', 'i_anales');
  }
  return places;
}

/** Busca la tesela caminable más cercana (para colocar personas y objetos). */
export function nearestWalkable(l: Layout, x: number, y: number, maxR = 12): { x: number; y: number } {
  const t = l.terrain.tiles;
  for (let r = 0; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = Math.round(x) + dx;
        const ny = Math.round(y) + dy;
        if (!inside(nx, ny)) continue;
        const k = idx(nx, ny);
        const tt = t[k];
        if (!l.blocked[k] && tt !== T.Deep && tt !== T.Sea && tt !== T.River && tt !== T.Mountain) return { x: nx + 0.5, y: ny + 0.5 };
      }
  return { x, y };
}

/** Puerta de un edificio (tesela delante de su fachada, hacia abajo). */
export function doorOf(b: Building): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h + 0.6 };
}

/** Solo para pruebas: construye el trazado de nuevo, sin caché (sobre el mismo terreno en caché). */
export function rebuildLayout(w: WorldState): Layout {
  return buildLayout(w);
}
