import type { WorldState } from '../core/types';
import { darkness, hourOf } from '../world/clock';
import { GOOD_COLOR } from '../world/marketview';
import type { Good } from '../world/economy';
import { ensureLife } from '../world/life';
import type { Layout } from '../world/layout';
import { along, roadPath } from '../world/roadnet';
import { convoyPositions } from '../world/trade';
import { TILE, type FolkRole } from '../world/types';
import type { Appearance } from './appearance';
import type { Drawable } from './drawable';
import type { Expr, Pose } from '../visual/figure/types';
import { castShadow, type SunState } from '../visual/light';
import { drawFigure } from '../visual/figure/figure';
import { propTex, tentTex } from '../visual/env/props';
import { bannerTex } from '../visual/env/plaza';
import { put, silhouette } from '../visual/paint';
import * as S from './sprites';

/**
 * Lo que pasa fuera de los pueblos: puestos fronterizos (guardias, barreras y, en
 * guerra, dos bandos frente a frente con sus campamentos) y el tráfico de los
 * caminos (caravanas reales, refugiados, soldados en marcha). Solo dibuja: lee el
 * mundo y usa lo que la escena le presta.
 */
export interface TrafficHost {
  w: WorldState;
  l: Layout;
  g: CanvasRenderingContext2D;
  sun: SunState;
  lights: { x: number; y: number; r: number; k: number; flat?: number }[];
  shadowQ: (() => void)[];
  extraAp(id: string, regionId: number, role: FolkRole, age: number, mod?: (ap: Appearance) => void): Appearance;
  pushPerson(items: Drawable[], ap: Appearance, pose: Pose, x: number, y: number): void;
  marchPose(dx: number, dy: number, t: number, expr: Expr, px: number, py: number, ap: Appearance): Pose;
  hueOf(regionId: number): number;
  lodAt(x: number, y: number): 0 | 1 | 2;
  weatherHere(): string;
  fire(px: number, py: number, t: number, scale?: number): void;
}

export function postDrawables(s: TrafficHost, p: { routeId: number; a: number; b: number; x: number; y: number; pathIndex: number }, items: Drawable[], t: number): void {
  const w = s.w;
  const g = s.g;
  const route = w.routes[p.routeId];
  const a = w.regions[p.a];
  const b = w.regions[p.b];
  const px = p.x * TILE;
  const py = p.y * TILE;
  const closed = route.status !== 'abierta';
  const owner = a.isHome ? b : a;
  items.push({ y: py + 4, draw: () => S.drawSprite(g, S.post(`hsl(${s.hueOf(owner.id)} 60% 45%)`, closed), px - 30, py + 4) });
  if (closed) items.push({ y: py + 6, draw: () => S.drawSprite(g, S.barricade(), px + 4, py + 6) });
  if (darkness(ensureLife(w).clock) > 0.3) s.lights.push({ x: px - 30, y: py - 40, r: 44, k: 0.9 });
  const sec = t / 1000;
  const lifeW = ensureLife(w);
  const weather = s.weatherHere();
  // Guardias según la tensión; campamentos si hay guerra.
  const war = a.relations[b.id]?.war;
  const mil = Math.max(a.militancy, b.militancy, a.relations[b.id]?.tension ?? 0);
  const guards = war ? 8 : mil > 0.55 ? 4 : mil > 0.35 ? 2 : route.status === 'cerrada' ? 2 : 1;
  if (war) {
    // Dos bandos frente a frente a cada lado de la barrera, con sus estandartes.
    for (const [k, side] of [[-1, a], [1, b]] as const) {
      const bt = bannerTex(s.hueOf(side.id), side.id);
      const bx = px + k * 92;
      const by = py + 4;
      s.shadowQ.push(() => castShadow(g, silhouette(bt), bt.w, bt.h, bt.ax, bt.ay, bx, by, s.sun, 0.45));
      items.push({ y: by, draw: () => put(g, bt, bx, by, k > 0) });
    }
  }
  for (let i = 0; i < guards; i++) {
    const side = i % 2 ? a : b;
    const row = i >> 1;
    const sx = war ? px + (i % 2 ? -1 : 1) * (34 + (row % 2) * 22) : px + (i % 2 ? -1 : 1) * (26 + row * 20);
    const sy = war ? py + 6 + row * 14 : py + 18 + row * 10;
    const ap = s.extraAp(`g:${p.routeId}:${side.id}:${i}`, side.id, 'guardia', 24 + i * 5);
    const me = lifeW.player;
    const close = Math.hypot(me.x * TILE - sx, me.y * TILE - sy) < 70;
    const pose: Pose = {
      facing: close && !war ? 'front' : 'side',
      // En guerra se miran unos a otros: cada bando hacia la barrera.
      flip: war ? i % 2 === 0 : i % 2 === 0,
      phase: 0,
      // Solo la primera fila baja la lanza hacia la barrera; la de atrás la lleva en alto y
      // grita (bajarla o señalar ahí apuntaría a la espalda de los suyos).
      action: war ? (row % 2 === 0 ? (Math.floor(sec / 2.2 + i * 0.7) % 3 === 0 ? 'argue' : 'fight') : Math.floor(sec / 1.6 + i) % 3 === 0 ? 'argue' : 'look') : close ? 'idle' : 'look',
      t: sec + i,
      expr: war ? (row % 2 === 0 ? 'hostil' : 'enfadado') : mil > 0.55 ? 'desconfianza' : 'neutral',
      lod: s.lodAt(sx / TILE, sy / TILE),
      hood: weather === 'lluvia' || weather === 'tormenta',
      heavy: weather === 'nieve',
    };
    s.pushPerson(items, ap, pose, sx, sy);
  }
  if (war) {
    for (let i = 0; i < 3; i++) {
      const tx = px + (i - 1) * 70;
      const ty = py - 70 - (i % 2) * 16;
      items.push({ y: ty, draw: () => put(g, tentTex(`hsl(${s.hueOf(i % 2 ? a.id : b.id)} 35% 50%)`), tx, ty) });
    }
    s.lights.push({ x: px, y: py - 50, r: 64, k: 1 });
    items.push({ y: py - 40, draw: () => s.fire(px, py - 40, t, 1.1) });
  }
}

/** Comercio, refugiados, soldados y caravanas por los caminos (solo lo visible). */
export function roadTraffic(s: TrafficHost, items: Drawable[], inView: (x: number, y: number, m?: number) => boolean, t: number): void {
  const w = s.w;
  const g = s.g;
  const life = ensureLife(w);
  const h = hourOf(life.clock);
  const day = h > 6.5 && h < 20;
  const clock = life.clock;
  for (const road of s.l.roads) {
    const len = road.path.length;
    if (len < 4) continue;
    // Soldados en marcha entre regiones en guerra.
    if (w.regions[road.a].relations[road.b]?.war) {
      for (let i = 0; i < 5; i++) {
        const phase = ((clock * 1.5) / len + i * 0.04) % 1;
        const pos = along(road.path, 0.35 + phase * 0.3);
        const px = pos.x * TILE + (i % 2) * 14;
        const py = pos.y * TILE + (i % 3) * 8;
        if (!inView(px, py)) continue;
        const side = i % 2 ? road.a : road.b;
        const ap = s.extraAp(`s:${road.routeId}:${i}`, side, 'guardia', 22 + i * 3);
        const pose = s.marchPose(pos.dx, pos.dy, t / 1000 + i * 1.3, 'enfadado', px, py, ap);
        s.pushPerson(items, ap, pose, px, py);
      }
    }
  }
  // Caravanas de verdad: cada carreta lleva una carga concreta de un pueblo a otro.
  for (const cv of convoyPositions(w)) {
    const px = cv.x * TILE;
    const py = cv.y * TILE;
    if (!inView(px, py)) continue;
    const main = Object.keys(cv.c.cargo)[0] as Good | undefined;
    const color = cv.c.status === 'atacada' ? '#5a4a3a' : main ? GOOD_COLOR[main] : '#d9c08a';
    const moving = cv.c.status === 'viaje' && day;
    items.push({ y: py, draw: () => S.drawSprite(g, S.cart(moving ? Math.floor(t / 250) % 4 : 0, cv.dx < 0, color), px, py) });
    if (cv.c.status === 'atacada') items.push({ y: py + 6, draw: () => put(g, propTex('cajas', 1), px + 26, py + 8) });
  }
  // Refugiados: caminan de verdad de su región a la de destino.
  for (const r of w.regions) {
    const mig = r.flags.emigrando;
    if (!mig) continue;
    const to = Number(mig.data?.to);
    const path = roadPath(w, r.id, to);
    if (!path.length) continue;
    for (let i = 0; i < 4; i++) {
      const phase = ((clock * 0.8) / path.length + i * 0.015 + r.id * 0.21) % 1;
      const pos = along(path, phase);
      const px = pos.x * TILE + (i % 2) * 12;
      const py = pos.y * TILE + (i % 3) * 7;
      if (!inView(px, py)) continue;
      const role: FolkRole = (['campesino', 'anciano', 'campesino', 'nino'] as FolkRole[])[i];
      const ap = s.extraAp(`r:${r.id}:${i}`, r.id, role, role === 'nino' ? 9 : role === 'anciano' ? 66 : 30, (a) => {
        a.outfit.item = role === 'anciano' ? 'baston' : 'saco';
        a.outfit.patches = true;
      });
      const pose = s.marchPose(pos.dx, pos.dy, t / 1000 + i, i % 2 ? 'triste' : 'miedo', px, py, ap);
      s.pushPerson(items, ap, pose, px, py);
    }
  }
  // Tus caravanas: salen del almacén y llegan días después.
  for (const c of life.caravans) {
    const path = roadPath(w, w.player.home, c.to);
    if (!path.length) continue;
    const k = (clock - c.depart) / Math.max(1, c.arrive - c.depart);
    if (k < 0 || k > 1) continue;
    const pos = along(path, k);
    const px = pos.x * TILE;
    const py = pos.y * TILE;
    if (!inView(px, py)) continue;
    const driver = s.extraAp(`c:${c.id}`, w.player.home, 'comerciante', 34);
    const dpose = s.marchPose(pos.dx, pos.dy, t / 1000, 'neutral', px, py, driver);
    items.push({
      y: py + 12,
      draw: () => {
        S.drawSprite(g, S.cart(Math.floor(t / 250) % 4, pos.dx < 0, c.kind === 'regalo' ? '#c98ad0' : '#e3c070'), px, py);
        drawFigure(g, driver, dpose, px + (pos.dx < 0 ? 10 : -10), py + 12);
        g.fillStyle = '#5a3a22';
        g.fillRect(px - 1, py - 78, 2, 26);
        g.fillStyle = '#e9b44c';
        g.beginPath();
        g.moveTo(px + 1, py - 78);
        g.lineTo(px + 15, py - 73);
        g.lineTo(px + 1, py - 68);
        g.fill();
      },
    });
  }
}
