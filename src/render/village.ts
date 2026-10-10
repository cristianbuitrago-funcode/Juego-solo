import type { WorldState } from '../core/types';
import { darkness, hourOf, type Season } from '../world/clock';
import { marketOf } from '../world/economy';
import { STALL_BACK_DY, stallShown, vendorSpot, type BuildingKind, type Layout } from '../world/layout';
import { ensureLife, housesFor } from '../world/life';
import { marketLook } from '../world/marketview';
import { idx } from '../world/terrain';
import { T, TILE, type FolkRole } from '../world/types';
import type { Appearance } from './appearance';
import type { ChunkCache } from './chunks';
import type { Drawable } from './drawable';
import type { Furniture } from './furniture';
import { drawFlame } from './fx';
import { hash } from './poses';
import type * as S from './sprites';
import type { Action, Pose } from '../visual/figure/types';
import { castShadow, contactShadow, type SunState } from '../visual/light';
import { houseTex, houseWindows, keyTex, snowCapped, WALL_H, type BuildState } from '../visual/env/buildings';
import { drawTree, drawTreeShadow, type TreeKind } from '../visual/env/flora';
import { drawFountainWater, propTex, stallTex } from '../visual/env/props';
import { bannerTex, drawGarland, pavingTex, planterTex, tableTex, treeBedTex } from '../visual/env/plaza';
import { alphaAt, put, silhouette } from '../visual/paint';

/**
 * Lo que se ve de un pueblo: casas según su estado, edificios clave, mobiliario,
 * el carácter de la plaza (pavimento, árboles, terrazas, guirnaldas), faroles,
 * puestos del mercado con quien los atiende, empalizada, torre de vigía y la
 * hoguera del anochecer. Solo dibuja: lee el mundo y usa lo que la escena le presta.
 */
export interface VillageHost {
  w: WorldState;
  l: Layout;
  g: CanvasRenderingContext2D;
  chunks: ChunkCache;
  furniture: Furniture;
  sun: SunState;
  lights: { x: number; y: number; r: number; k: number; flat?: number }[];
  shadowQ: (() => void)[];
  groundQ: (() => void)[];
  seasonFrame: Season;
  wxFrame: string;
  reduceMotion: boolean;
  playerHidden: boolean;
  fireSpots: Map<number, { x: number; y: number }>;
  styleOf(regionId: number): S.Style;
  hueOf(regionId: number): number;
  buildingExists(regionId: number, kind: BuildingKind): boolean;
  puff(x: number, y: number, color: string, size: number): void;
  weatherHere(): string;
  fire(px: number, py: number, t: number, scale?: number): void;
  dress(ap: Appearance, wet: boolean, cold: boolean): Appearance;
  extraAp(id: string, regionId: number, role: FolkRole, age: number, mod?: (ap: Appearance) => void): Appearance;
  lodAt(x: number, y: number): 0 | 1 | 2;
  pushPerson(items: Drawable[], ap: Appearance, pose: Pose, x: number, y: number): void;
}

export function villageDrawables(sc: VillageHost, regionId: number, items: Drawable[], inView: (x: number, y: number, m?: number) => boolean, t: number, cold: boolean): void {
  const w = sc.w;
  const g = sc.g;
  const life = ensureLife(w);
  const v = sc.l.villages[regionId];
  const r = w.regions[regionId];
  const town = life.towns[regionId];
  const st = sc.styleOf(regionId);
  const hue = sc.hueOf(regionId);
  const night = darkness(life.clock) > 0.3;
  const snowRoofs = sc.chunks.snowyRegion(regionId, sc.seasonFrame);
  const wet = sc.wxFrame === 'lluvia' || sc.wxFrame === 'tormenta';
  const vsec = t / 1000;
  const built = Math.min(v.houses.length, town?.houses ?? 3);
  const wealth = Math.max(0, Math.min(1, marketOf(w, regionId).prosperity));
  const target = housesFor(w, regionId);
  const abandonedFrom = built - (town?.abandoned ?? 0);
  v.houses.forEach((b, i) => {
    if (i > built || (i === built && target <= built)) return;
    const bx = (b.x + b.w / 2) * TILE;
    const by = (b.y + b.h) * TILE;
    if (!inView(bx, by)) return;
    const state = houseState(sc, regionId, i, built, abandonedFrom, wealth);
    // De noche, las ventanas de las casas habitadas se encienden (no todas a la vez).
    const lit = (state === 'normal' || state === 'restaurada' || state === 'deteriorada') && night && (hash(`${regionId}:${i}`) < 0.82 || hourOf(life.clock) < 23);
    const wins = st.shape === 'redondo' ? [{ x: -b.w * 8 + 12, y: -32, w: 11, h: 11 }] : houseWindows(b.w);
    if (lit) for (const wn of wins) sc.lights.push({ x: bx + wn.x + wn.w / 2, y: by + wn.y + wn.h / 2, r: 20, k: 0.8 });
    const ht0 = houseTex(st, state, i % 3, b.w, wealth);
    const ht = snowRoofs && state !== 'destruida' ? snowCapped(ht0, -WALL_H - 3) : ht0;
    const sun = sc.sun;
    sc.shadowQ.push(() => castShadow(g, silhouette(ht), ht.w, ht.h, ht.ax, ht.ay, bx, by, sun, 0.62));
    items.push({
      y: by,
      box: { x0: bx - ht.ax, y0: by - ht.ay, x1: bx - ht.ax + ht.w, y1: by - 4 },
      solidAt: (x, y) => alphaAt(ht, x - bx, y - by),
      draw: () => {
        put(g, ht, bx, by);
        if (lit) for (const wn of wins) litWindow(sc, bx + wn.x, by + wn.y, wn.w, wn.h, t + i * 300);
      },
    });
    if (state === 'quemada' && !sc.reduceMotion && Math.random() < 0.06) sc.puff(bx, by - 50, 'rgba(60,55,50,', 2);
    if (state === 'normal' && st.shape !== 'redondo' && !sc.reduceMotion && Math.random() < 0.006 && (hourOf(life.clock) < 9 || hourOf(life.clock) > 17 || cold)) sc.puff(bx + b.w * 8 - 17.5 - (i % 3 % 2) * 20, by - 96, 'rgba(205,205,205,', 1.1);
  });
  const food = r.isHome ? w.player.reserves / 5 : r.food;
  for (const b of v.keys) {
    if (!sc.buildingExists(regionId, b.kind)) continue;
    const bx = (b.x + b.w / 2) * TILE;
    const by = (b.y + b.h) * TILE;
    if (!inView(bx, by)) continue;
    const extra = b.kind === 'almacen' ? (food < 4 ? 'vacio' : '') : b.kind === 'salon' ? `hsl(${hue} 55% 45%)` : '';
    const kt0 = keyTex(b.kind, st, extra, wealth);
    const kt = snowRoofs ? snowCapped(kt0, -kt0.h * 0.42) : kt0;
    const sun = sc.sun;
    sc.shadowQ.push(() => castShadow(g, silhouette(kt), kt.w, kt.h, kt.ax, kt.ay, bx, by, sun, 0.62));
    items.push({ y: by, draw: () => put(g, kt, bx, by), box: { x0: bx - kt.ax, y0: by - kt.ay, x1: bx - kt.ax + kt.w, y1: by - 4 }, solidAt: (x, y) => alphaAt(kt, x - bx, y - by) });
    if (night && (b.kind === 'posada' || b.kind === 'salon' || b.kind === 'templo' || b.kind === 'hogar')) {
      // La puerta abierta deja salir la luz de dentro: brilla y dibuja un charco cálido delante.
      sc.lights.push({ x: bx, y: by - 16, r: 24, k: 1 });
      sc.lights.push({ x: bx, y: by + 6, r: b.kind === 'posada' ? 80 : 60, k: 0.9, flat: 0.5 });
    }
    if (b.kind === 'forja') {
      const working = hourOf(life.clock) > 8 && hourOf(life.clock) < (r.militancy > 0.55 ? 23 : 18);
      if (working) sc.lights.push({ x: bx - 14, y: by - 14, r: 34, k: 0.9 });
      if (working && !sc.reduceMotion && Math.random() < (r.militancy > 0.55 ? 0.14 : 0.05)) sc.puff(bx + 16, by - 96, 'rgba(70,65,60,', 1.6);
    }
  }
  // Mobiliario: bancos, faroles, fuente, barriles, carros, heno…
  for (const pr of v.props) {
    const px = pr.x * TILE;
    const py = pr.y * TILE;
    if (!inView(px, py)) continue;
    const frozen = pr.kind === 'fuente' && snowRoofs && (sc.seasonFrame === 'invierno' || sc.wxFrame === 'nieve');
    const lampOn = night || ['lluvia', 'tormenta', 'niebla'].includes(sc.wxFrame);
    const pt0 = propTex(pr.kind, pr.kind === 'fuente' ? (frozen ? 1 : 0) : pr.kind === 'farol' ? (lampOn ? 1 : 0) : pr.v);
    // Con nieve, lo que tiene una cara de arriba (bancos, carteles, cajas, heno, carros) se cubre.
    const capped = snowRoofs && (pr.kind === 'banco' || pr.kind === 'cartel' || pr.kind === 'cajas' || pr.kind === 'barril' || pr.kind === 'heno' || pr.kind === 'carro' || pr.kind === 'abrevadero' || pr.kind === 'lenya');
    const pt = capped ? snowCapped(pt0, -pt0.ay + Math.max(3, pt0.h * 0.2)) : pt0;
    // El poste del cruce, a escala humana (algo más alto que una persona, no el doble).
    const ps = pr.kind === 'cartel' ? 0.72 : 1;
    // Lo alto proyecta sombra; lo bajo (bancos, vallas, barriles, heno…) solo se asienta con una sombra de contacto.
    const tall = pr.kind === 'farol' || pr.kind === 'cartel' || pr.kind === 'fuente' || pr.kind === 'pozo' || pr.kind === 'carro' || pr.kind === 'estatua';
    if (tall) sc.shadowQ.push(() => castShadow(g, silhouette(pt), pt.w, pt.h, pt.ax, pt.ay, px, py, sc.sun, 0.5, ps));
    else sc.shadowQ.push(() => contactShadow(g, px + (pr.kind === 'vallaV' ? 0 : pt.w / 2 - pt.ax), py, pr.kind === 'vallaV' ? 4 : pt.w * 0.5, pr.kind === 'vallaV' ? pt.h * 0.35 : 3, 0.35));
    if (pr.kind === 'fuente' && !frozen) items.push({ y: py, draw: () => (put(g, pt, px, py), drawFountainWater(g, px, py, sc.reduceMotion ? 0 : t)) });
    else items.push({ y: py, draw: () => put(g, pt, px, py, false, ps), box: pr.kind === 'farol' || pr.kind === 'cartel' || pr.kind === 'valla' || pr.kind === 'vallaV' ? undefined : { x0: px - pt.ax, y0: py - pt.ay, x1: px - pt.ax + pt.w, y1: py - 2 } });
  }
  // Lo propio de esta plaza: pavimento con dibujo, árboles, jardineras, terrazas, estandartes, guirnaldas.
  {
    const pl = sc.furniture.plazaOf(regionId);
    const season = sc.seasonFrame;
    const ox = (v.cx + 0.5) * TILE;
    const oy = (v.cy + 0.5) * TILE;
    if (pl.paving && inView(ox, oy, v.plazaR * TILE)) {
      const tiles = sc.l.terrain.tiles;
      const pt = pavingTex(pl.paving, v.plazaR, TILE, String(regionId), (dx, dy) => tiles[idx(Math.floor(v.cx + 0.5 + dx), Math.floor(v.cy + 0.5 + dy))] === T.Plaza);
      sc.groundQ.push(() => put(g, pt, ox, oy));
    }
    const sec = t / 1000;
    const windK = sc.wxFrame === 'viento' || sc.wxFrame === 'tormenta' ? 1 : 0.25;
    const me = life.player;
    const focus = { x: me.x * TILE, y: me.y * TILE };
    for (const d of pl.decor) {
      const dx = d.x * TILE;
      const dy = d.y * TILE;
      if (!inView(dx, dy, 60)) continue;
      if (d.kind === 'arbol') {
        const kind: TreeKind = d.v % 3 === 0 ? 'abedul' : 'frutal';
        const bed = treeBedTex(snowRoofs);
        const sun = sc.sun;
        sc.groundQ.push(() => put(g, bed, dx, dy));
        sc.shadowQ.push(() => drawTreeShadow(g, kind, season, d.v, dx, dy, sun, snowRoofs));
        items.push({ y: dy, draw: () => void (drawTree(g, kind, season, d.v, dx, dy, sec, windK, snowRoofs, focus) && (sc.playerHidden = true)) });
      } else {
        // Nevando, las jardineras se ven en su versión de invierno y las mesas con su capa de nieve.
        const tx0 = d.kind === 'jardinera' ? planterTex(snowRoofs ? 'invierno' : season, d.v) : d.kind === 'mesa' ? tableTex((hue + 20) % 360, d.v) : bannerTex(hue, regionId);
        const tx = snowRoofs && d.kind === 'mesa' ? snowCapped(tx0, -tx0.ay + tx0.h * 0.3) : tx0;
        if (d.kind === 'estandarte' || d.kind === 'mesa') sc.shadowQ.push(() => castShadow(g, silhouette(tx), tx.w, tx.h, tx.ax, tx.ay, dx, dy, sc.sun, 0.45));
        else sc.shadowQ.push(() => contactShadow(g, dx, dy, tx.w * 0.5, 3, 0.35));
        items.push({ y: dy, draw: () => put(g, tx, dx, dy) });
      }
    }
    for (const [a, b] of pl.garlands) {
      const la = v.lamps[a];
      const lb = v.lamps[b];
      if (!la || !lb) continue;
      const x0 = la.x * TILE;
      const y0 = la.y * TILE + 4;
      const x1 = lb.x * TILE;
      const y1 = lb.y * TILE + 4;
      if (!inView((x0 + x1) / 2, (y0 + y1) / 2, 80)) continue;
      // Se ordena por la línea de los faroles: quien está delante (más abajo) se dibuja encima;
      // antes se sumaban 3 casillas y la guirnalda cruzaba las piernas de quien pasaba delante.
      items.push({ y: Math.max(y0, y1) + 1, draw: () => drawGarland(g, x0, y0, x1, y1, hue, sc.reduceMotion ? 0 : t, windK) });
    }
  }
  const gloomy = ['lluvia', 'tormenta', 'niebla'].includes(sc.weatherHere());
  if (night || gloomy) for (const lp of v.lamps) {
    const px = lp.x * TILE;
    const py = lp.y * TILE + 9; // cabeza del farol (el farol mide ~43 px)
    if (!inView(px, py)) continue;
    // La lámpara y, sobre todo, el charco de luz que deja en el suelo.
    sc.lights.push({ x: px, y: py, r: 20, k: 0.9 });
    sc.lights.push({ x: px, y: py + 38, r: 72, k: 1, flat: 0.55 });
    items.push({ y: py + 39, draw: () => flame(sc, px, py, t) });
  }
  // Mercado: lo que hay se ve en los puestos; los que cierran, se quedan vacíos.
  const look = marketLook(w, regionId);
  v.stalls.slice(0, Math.min(v.stalls.length, 6)).forEach((s, i) => {
    // Sin comerciante, el puesto está cerrado (vacío y con el toldo apagado), pero está: el
    // mercado se lee como mercado y no hay un obstáculo invisible donde estaba.
    const stallGoods = look.stalls[i] ?? [];
    // Un puesto no se monta encima del poste de caminos.
    if (!stallShown(v, s)) return;
    const open = stallGoods.length > 0;
    // Nevando no hay fruta fresca: raíces, quesos, pieles, leña y tarros.
    const WINTER = ['#8a6a4a', '#d8c89a', '#6a5a4a', '#e6dfd0', '#7a4a3a', '#a08060'];
    const goods = snowRoofs && open ? stallGoods.map((_, j) => WINTER[(j + i) % WINTER.length]) : stallGoods;
    const stx0 = stallTex(open, `hsl(${(hue + i * 40) % 360} ${open ? 50 : 18}% ${open ? 55 : 40}%)`, i, open ? goods : undefined);
    const stx = snowRoofs ? snowCapped(stx0, -stx0.ay + stx0.h * 0.16) : stx0;
    // En dos capas: postes y toldo detrás de quien atiende; mostrador y género delante (si no,
    // el toldo le tapaba la cabeza). La sombra y la oclusión siguen usando el puesto entero.
    const tint = `hsl(${(hue + i * 40) % 360} ${open ? 50 : 18}% ${open ? 55 : 40}%)`;
    const cap = (t: typeof stx0) => (snowRoofs ? snowCapped(t, -t.ay + t.h * 0.16) : t);
    const stBack = cap(stallTex(open, tint, i, open ? goods : undefined, 'back'));
    const stFront = cap(stallTex(open, tint, i, open ? goods : undefined, 'front'));
    items.push({ y: s.y * TILE + STALL_BACK_DY, draw: () => put(g, stBack, s.x * TILE, s.y * TILE) });
    items.push({ y: s.y * TILE, draw: () => put(g, stFront, s.x * TILE, s.y * TILE), box: { x0: s.x * TILE - stx.ax, y0: s.y * TILE - stx.ay * 0.6, x1: s.x * TILE - stx.ax + stx.w, y1: s.y * TILE - 2 } });
    // Puesto abierto y de día: alguien lo atiende detrás del mostrador, pregona y despacha.
    const hh = hourOf(life.clock);
    if (open && hh >= 7 && hh < 19.5 && inView(s.x * TILE, s.y * TILE)) {
      const id = `v:${regionId}:${i}`;
      const ap = sc.dress(sc.extraAp(id, regionId, 'comerciante', 24 + Math.floor(hash(id, 3) * 40)), wet, cold);
      const me = life.player;
      const near = Math.hypot(me.x - s.x, me.y - s.y) < 4;
      const beat = Math.floor(vsec + hash(id) * 7);
      const action: Action = near ? (beat % 3 === 0 ? 'wave' : 'talk') /* a quien se acerca se le saluda, no se le señala */ : beat % 7 === 0 ? 'point' : beat % 5 === 0 ? 'talk' : 'idle';
      const pose: Pose = { facing: 'front', flip: me.x < s.x, phase: 0, action, t: vsec + i * 3.1, expr: near ? 'feliz' : 'neutral', lod: sc.lodAt(s.x, s.y), hood: cold && hash(id, 9) < 0.5, heavy: cold, wet };
      const vs = vendorSpot(s);
      sc.pushPerson(items, ap, pose, vs.x * TILE, vs.y * TILE);
      // En la mitad de los puestos abiertos, alguien compra: delante del mostrador, de espaldas,
      // señalando el género (si el jugador no está justo ahí).
      const cx = s.x + (hash(id, 12) < 0.5 ? -0.55 : 0.55);
      const cy = s.y + 1.05;
      if (hash(id, w.day) < 0.5 && !(Math.abs(me.x - cx) < 1.2 && Math.abs(me.y - cy) < 1.6)) {
        const cid = `c:${regionId}:${i}:${w.day}`;
        const cap = sc.dress(sc.extraAp(cid, regionId, hash(cid) < 0.5 ? 'campesino' : 'artesano', 18 + Math.floor(hash(cid, 3) * 50)), wet, cold);
        const cbeat = Math.floor(vsec / 1.7 + hash(cid) * 5);
        const cpose: Pose = { facing: 'back', flip: false, phase: 0, action: cbeat % 3 === 0 ? 'point' : 'talk', t: vsec + i * 1.7, expr: 'neutral', lod: sc.lodAt(cx, cy), hood: cold && hash(cid, 9) < 0.5, heavy: cold, wet };
        sc.pushPerson(items, cap, cpose, cx * TILE, cy * TILE);
      }
    }
  });
  void food;
  // Empalizada.
  if (town?.walls) {
    const R = v.wallR;
    const steps = Math.floor((2 * Math.PI * R) / 1.1);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = v.cx + 0.5 + Math.cos(a) * R;
      const y = v.cy + 0.5 + Math.sin(a) * R;
      const k = idx(Math.floor(x), Math.floor(y));
      const tt = sc.l.terrain.tiles[k];
      if (tt === 13 || tt === 14 || tt === 2 || tt === 1 || tt === 0 || tt === 9) continue; // puertas en los caminos
      const px = x * TILE;
      const py = y * TILE;
      if (!inView(px, py)) continue;
      items.push({
        y: py,
        draw: () => {
          g.fillStyle = '#5e4128';
          g.fillRect(px - 3.5, py - 36, 7, 36);
          g.fillStyle = '#7d5a3a';
          g.fillRect(px - 3.5, py - 36, 3, 36);
          g.fillStyle = '#8a6440';
          g.beginPath();
          g.moveTo(px - 3.5, py - 36);
          g.lineTo(px, py - 43);
          g.lineTo(px + 3.5, py - 36);
          g.fill();
          g.fillStyle = 'rgba(40,28,18,0.7)';
          g.fillRect(px - 4, py - 28, 8, 2);
          g.fillRect(px - 4, py - 12, 8, 2);
        },
      });
    }
  }
  if (town?.tower) {
    const px = (v.cx + v.plazaR + 1.5) * TILE;
    const py = (v.cy - v.plazaR) * TILE;
    if (night) sc.lights.push({ x: px, y: py - 106, r: 56, k: 1 });
    items.push({
      y: py,
      draw: () => {
        // Torre de vigía de madera: cuatro pies, plataforma y tejadillo.
        g.strokeStyle = '#5e4128';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(px - 14, py);
        g.lineTo(px - 9, py - 92);
        g.moveTo(px + 14, py);
        g.lineTo(px + 9, py - 92);
        g.stroke();
        g.lineWidth = 1.8;
        g.beginPath();
        for (let k = 0; k < 4; k++) {
          const y0 = py - k * 23;
          g.moveTo(px - 13 + k * 1.2, y0);
          g.lineTo(px + 12 - k * 1.2, y0 - 23);
          g.moveTo(px + 13 - k * 1.2, y0);
          g.lineTo(px - 12 + k * 1.2, y0 - 23);
        }
        g.stroke();
        g.fillStyle = '#7d5a3a';
        g.fillRect(px - 16, py - 100, 32, 10);
        g.fillStyle = '#6b4a2e';
        g.beginPath();
        g.moveTo(px - 19, py - 120);
        g.lineTo(px, py - 134);
        g.lineTo(px + 19, py - 120);
        g.fill();
        g.fillRect(px - 15, py - 120, 3, 20);
        g.fillRect(px + 12, py - 120, 3, 20);
        if (night || Math.floor(t / 700) % 2) flame(sc, px, py - 106, t);
      },
    });
  }
  // Hoguera de la plaza al anochecer.
  const hh = hourOf(life.clock);
  if ((hh > 19 || hh < 1) && !r.abandoned && sc.weatherHere() !== 'lluvia' && sc.weatherHere() !== 'tormenta') {
    const spot = fireSpot(sc, regionId);
    const px = spot.x * TILE;
    const py = spot.y * TILE;
    sc.lights.push({ x: px, y: py - 8, r: 70, k: 1 });
    items.push({ y: py, draw: () => sc.fire(px, py, t, 1.2) });
    if (!sc.reduceMotion && Math.random() < 0.05) sc.puff(px, py - 26, 'rgba(120,110,100,', 1);
  }
}

/**
 * Estado visual de una casa, leído de la simulación: en obra (el pueblo
 * crece), quemada (guerra), destruida (quemada mientras la guerra sigue),
 * abandonada (se fue la gente), deteriorada (pobreza), restaurada (se
 * reconstruye) o normal.
 */
function houseState(sc: VillageHost, regionId: number, i: number, built: number, abandonedFrom: number, wealth: number): BuildState {
  const r = sc.w.regions[regionId];
  const town = ensureLife(sc.w).towns[regionId];
  const hh = hash(`${regionId}:${i}`, 7);
  if (i === built) return 'obra';
  if (town?.burned.includes(i)) return r.flags.guerra && hh < 0.35 ? 'destruida' : 'quemada';
  if (i >= abandonedFrom) return 'abandonada';
  if (r.flags.reconstruyendo && hh < 0.6) return 'restaurada';
  if (wealth < 0.38 && hh < (0.38 - wealth) * 2.6) return 'deteriorada';
  return 'normal';
}

/** Hueco más despejado de la plaza para la hoguera (lejos de puestos, bancos y fuente). */
function fireSpot(sc: VillageHost, regionId: number): { x: number; y: number } {
  const hit = sc.fireSpots.get(regionId);
  if (hit) return hit;
  const v = sc.l.villages[regionId];
  const obstacles = [...v.stalls, ...v.props.map((p) => ({ x: p.x, y: p.y })), { x: v.cx + 0.5, y: v.cy + 1.6 }];
  let best = { x: v.cx + 0.5 - (v.plazaR - 2.4), y: v.cy + 1 };
  let bd = -1;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    for (const r of [v.plazaR - 2.6, v.plazaR - 3.4]) {
      const p = { x: v.cx + 0.5 + Math.cos(a) * r, y: v.cy + 0.5 + Math.sin(a) * r * 0.9 };
      const d = Math.min(...obstacles.map((o) => Math.hypot(o.x - p.x, (o.y - p.y) * 1.4)));
      if (d > bd) (bd = d), (best = p);
    }
  }
  sc.fireSpots.set(regionId, best);
  return best;
}

/** Ventana encendida de noche, con el temblor de la llama de dentro. */
function litWindow(sc: VillageHost, x: number, y: number, w: number, h: number, t: number): void {
  const g = sc.g;
  const flick = sc.reduceMotion ? 0 : Math.sin(t / 340) * 0.05 + Math.sin(t / 97) * 0.03;
  g.fillStyle = `rgba(255,${196 + Math.round(flick * 200)},110,0.95)`;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,240,190,0.85)';
  g.fillRect(x + 1.5, y + h * 0.45, w - 3, h * 0.5);
  g.fillStyle = 'rgba(90,60,30,0.55)';
  g.fillRect(x + w / 2 - 0.5, y, 1, h);
  g.fillRect(x, y + h / 2 - 0.5, w, 1);
}

/** Llama de farol o de antorcha. */
function flame(sc: VillageHost, x: number, y: number, t: number): void {
  drawFlame(sc.g, x, y, t, sc.reduceMotion);
}
