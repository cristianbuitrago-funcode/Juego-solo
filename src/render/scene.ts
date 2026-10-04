import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import type { WorldState } from '../core/types';
import { darkness, hourOf, SECONDS_PER_MINUTE, seasonOf, weatherOf } from '../world/clock';
import { getLayout, doorOf, type BuildingKind, type Layout } from '../world/layout';
import { ensureLife, explore, housesFor } from '../world/life';
import { findPath, passable } from '../world/path';
import { along, roadPath } from '../world/roadnet';
import { routineOf } from '../world/routines';
import { idx, speedOf } from '../world/terrain';
import { TILE, TW, type Folk } from '../world/types';
import { CHUNK, ChunkCache } from './chunks';
import * as S from './sprites';

/**
 * Escena del mundo explorable: cámara que sigue al personaje, terreno por
 * fragmentos, objetos ordenados en profundidad, vecinos con rutinas,
 * animales, caravanas, soldados, refugiados, día y noche, y clima.
 *
 * Simulación por proximidad: solo los vecinos cercanos al jugador caminan
 * de verdad. Los lejanos "viven" en su rutina abstracta y se materializan
 * en el sitio correcto cuando el jugador se acerca.
 */
export type Target =
  | { kind: 'folk'; id: string; label: string }
  | { kind: 'building'; regionId: number; building: BuildingKind; label: string }
  | { kind: 'post'; index: number; label: string }
  | { kind: 'place'; id: string; label: string }
  | { kind: 'encounter'; id: string; label: string }
  | { kind: 'messenger'; petitionId: string; label: string }
  | { kind: 'signpost'; regionId: number; label: string };

export interface SceneCallbacks {
  advance(minutes: number): void;
  onRegion(regionId: number, prev: number): void;
  onFocus(t: Target | null): void;
  onArrive(t: Target): void;
  onTick(): void; // cada ~1 s real (presencia, descubrimientos, encuentros)
}

interface Ent {
  x: number;
  y: number;
  path: { x: number; y: number }[];
  tx: number;
  ty: number;
  inside: boolean;
  frame: number;
  flip: boolean;
  moving: boolean;
  anim: number;
}

interface Animal {
  kind: 'vaca' | 'oveja' | 'gallina' | 'ciervo';
  x: number;
  y: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  flip: boolean;
  anim: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

interface Drawable {
  y: number;
  draw: () => void;
}

const BUILDING_LABEL: Record<string, string> = { salon: 'Salón', almacen: 'Almacén', posada: 'Posada', templo: 'Templo', forja: 'Forja', hogar: 'Tu casa' };

function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export class WorldScene {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private l: Layout;
  private chunks: ChunkCache;
  private dark = document.createElement('canvas');
  cam = { x: 0, y: 0, z: 1.7 };
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private ents = new Map<string, Ent>();
  private animals = new Map<number, Animal[]>();
  private particles: Particle[] = [];
  private weatherP: { x: number; y: number; s: number }[] = [];
  private raf = 0;
  private last = performance.now();
  private tickAcc = 0;
  private lodAcc = 0;
  private focusAcc = 0;
  private region = -1;
  private focus: Target | null = null;
  private playerAnim = 0;
  private playerMoving = false;
  private facing = { x: 0, y: 1 };
  private path: { x: number; y: number }[] = [];
  private pending: Target | null = null;
  private follow: string | null = null;
  private joy: { id: number; bx: number; by: number; x: number; y: number } | null = null;
  private pointers = new Map<number, { x: number; y: number; t: number; sx: number; sy: number }>();
  private pinch: { d: number; z: number } | null = null;
  private keys = new Set<string>();
  paused = false;
  /** Destino marcado en el mapa (teselas): se señala con una flecha dorada. */
  waypoint: { x: number; y: number; label: string } | null = null;
  timeScale = 1;
  running = false; // correr
  reduceMotion = false;

  constructor(private parent: HTMLElement, public w: WorldState, private cb: SceneCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-canvas';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.l = getLayout(w);
    this.chunks = new ChunkCache(w, this.l);
    const life = ensureLife(w);
    this.cam.x = life.player.x * TILE;
    this.cam.y = life.player.y * TILE;
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(parent);
    this.resize();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      if (!this.paused) this.update(dt);
      this.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }

  setWorld(w: WorldState): void {
    this.w = w;
    this.chunks.setWorld(w);
  }

  /** Coloca al jugador (viaje rápido, sucesión). */
  teleport(x: number, y: number): void {
    const p = ensureLife(this.w).player;
    p.x = x;
    p.y = y;
    this.cam.x = x * TILE;
    this.cam.y = y * TILE;
    this.path = [];
    this.pending = null;
    this.ents.clear();
  }

  followFolk(id: string | null): void {
    this.follow = id;
    this.path = [];
  }

  stop(): void {
    this.path = [];
    this.pending = null;
    this.follow = null;
  }

  /** Camina hasta un punto (en teselas). */
  walkTo(x: number, y: number, target: Target | null = null): void {
    const p = ensureLife(this.w).player;
    this.follow = null;
    this.pending = target;
    const path = findPath(this.w, p.x, p.y, x, y, 9000);
    this.path = path.length ? path : [{ x, y }];
  }

  folkPosition(id: string): { x: number; y: number } | undefined {
    const e = this.ents.get(id);
    return e && !e.inside ? { x: e.x, y: e.y } : undefined;
  }

  // -------------------------------------------------------------------------
  // Entrada: joystick virtual, tocar para caminar, pellizcar para zoom.
  // -------------------------------------------------------------------------
  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.parent.getBoundingClientRect();
    this.vw = r.width;
    this.vh = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.dark.width = Math.ceil(r.width / 2);
    this.dark.height = Math.ceil(r.height / 2);
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((sx - r.left - this.vw / 2) / this.cam.z + this.cam.x) / TILE, y: ((sy - r.top - this.vh / 2) / this.cam.z + this.cam.y) / TILE };
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.cam.x) * this.cam.z + this.vw / 2, y: (y - this.cam.y) * this.cam.z + this.vh / 2 };
  }

  private bindInput(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 2) {
        this.joy = null;
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
        return;
      }
      // Mitad izquierda inferior: joystick.
      if (e.clientX - r.left < this.vw * 0.5 && e.clientY - r.top > this.vh * 0.35 && e.pointerType !== 'mouse') {
        this.joy = { id: e.pointerId, bx: e.clientX - r.left, by: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top };
        this.stop();
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.z = Math.max(0.7, Math.min(3.2, this.pinch.z * (d / Math.max(1, this.pinch.d))));
        return;
      }
      if (this.joy && this.joy.id === e.pointerId) {
        const r = c.getBoundingClientRect();
        this.joy.x = e.clientX - r.left;
        this.joy.y = e.clientY - r.top;
      }
    });
    const up = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.joy && this.joy.id === e.pointerId) {
        this.joy = null;
        return;
      }
      if (!p || this.pointers.size) return;
      const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
      if (moved < 12 && performance.now() - p.t < 450) this.tap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.z = Math.max(0.7, Math.min(3.2, this.cam.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      this.keys.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) this.stop();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  /** Tocar el mundo: caminar hasta allí, o hasta la persona/lugar tocado. */
  private tap(sx: number, sy: number): void {
    const p = this.toWorld(sx, sy);
    const hit = this.targetAt(p.x, p.y, 1.1);
    if (hit) {
      const pos = this.targetPos(hit.t);
      if (pos) {
        const me = ensureLife(this.w).player;
        if (Math.hypot(pos.x - me.x, pos.y - me.y) < 2.2) {
          this.cb.onArrive(hit.t);
          return;
        }
        this.walkTo(pos.x, pos.y + 0.6, hit.t);
        return;
      }
    }
    this.walkTo(p.x, p.y);
  }

  // -------------------------------------------------------------------------
  // Actualización
  // -------------------------------------------------------------------------
  private update(dt: number): void {
    const w = this.w;
    const life = ensureLife(w);
    this.cb.advance((dt / SECONDS_PER_MINUTE) * this.timeScale);
    this.movePlayer(dt);
    const me = life.player;
    // Cámara con suavizado.
    const k = Math.min(1, dt * 6);
    this.cam.x += (me.x * TILE - this.cam.x) * k;
    this.cam.y += (me.y * TILE - this.cam.y) * k;

    this.tickAcc += dt;
    if (this.tickAcc > 0.5) {
      this.tickAcc = 0;
      explore(life, me.x, me.y, 12);
      const reg = this.l.terrain.region[idx(Math.floor(me.x), Math.floor(me.y))];
      if (reg >= 0 && reg !== this.region) {
        const prev = this.region;
        this.region = reg;
        this.cb.onRegion(reg, prev);
      }
      this.cb.onTick();
    }
    this.lodAcc += dt;
    if (this.lodAcc > 0.6) {
      this.lodAcc = 0;
      this.updateLod();
    }
    this.moveFolk(dt);
    this.moveAnimals(dt);
    this.focusAcc += dt;
    if (this.focusAcc > 0.15) {
      this.focusAcc = 0;
      const t = this.targetAt(me.x, me.y, 2.1)?.t ?? null;
      const key = (x: Target | null) => (x ? `${x.kind}:${'id' in x ? x.id : 'index' in x ? x.index : 'petitionId' in x ? x.petitionId : `${x.regionId}:${'building' in x ? x.building : ''}`}` : '');
      if (key(t) !== key(this.focus)) {
        this.focus = t;
        this.cb.onFocus(t);
      }
    }
  }

  private movePlayer(dt: number): void {
    const life = ensureLife(this.w);
    const me = life.player;
    let dx = 0;
    let dy = 0;
    let run = this.running;
    if (this.joy) {
      const jx = this.joy.x - this.joy.bx;
      const jy = this.joy.y - this.joy.by;
      const len = Math.hypot(jx, jy);
      if (len > 8) {
        dx = jx / len;
        dy = jy / len;
        if (len > 52) run = true;
      }
    } else {
      if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= 1;
      if (this.keys.has('arrowright') || this.keys.has('d')) dx += 1;
      if (this.keys.has('arrowup') || this.keys.has('w')) dy -= 1;
      if (this.keys.has('arrowdown') || this.keys.has('s')) dy += 1;
      if (this.keys.has('shift')) run = true;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
      }
    }
    if (!dx && !dy && this.follow) {
      const pos = this.folkPosition(this.follow);
      if (pos && Math.hypot(pos.x - me.x, pos.y - me.y) > 1.6) {
        const d = Math.hypot(pos.x - me.x, pos.y - me.y);
        dx = (pos.x - me.x) / d;
        dy = (pos.y - me.y) / d;
      }
    }
    if (!dx && !dy && this.path.length) {
      const n = this.path[0];
      const d = Math.hypot(n.x - me.x, n.y - me.y);
      if (d < 0.25) {
        this.path.shift();
        if (!this.path.length && this.pending) {
          const t = this.pending;
          this.pending = null;
          this.cb.onArrive(t);
        }
      } else {
        dx = (n.x - me.x) / d;
        dy = (n.y - me.y) / d;
      }
    }
    this.playerMoving = !!(dx || dy);
    if (!this.playerMoving) return;
    this.facing = { x: dx, y: dy };
    const tile = this.l.terrain.tiles[idx(Math.floor(me.x), Math.floor(me.y))];
    const speed = (run ? 7.2 : 4.2) * speedOf(tile) * dt;
    const nx = me.x + dx * speed;
    const ny = me.y + dy * speed;
    const ok = (x: number, y: number) => passable(this.w, this.l, x, y);
    if (ok(nx, ny)) (me.x = nx), (me.y = ny);
    else if (ok(nx, me.y)) me.x = nx;
    else if (ok(me.x, ny)) me.y = ny;
    else if (this.path.length) this.path.shift();
    this.playerAnim += dt * (run ? 12 : 8);
  }

  /** Materializa los vecinos cercanos y "desmaterializa" los lejanos. */
  private updateLod(): void {
    const w = this.w;
    const life = ensureLife(w);
    const me = life.player;
    const near = new Set<string>();
    const encFolk = this.encounterSpots();
    for (const f of life.folk) {
      if (!f.alive) continue;
      const v = this.l.villages[f.regionId];
      if (Math.hypot(v.cx - me.x, v.cy - me.y) > 80 && !encFolk.has(f.id)) continue;
      const t = this.targetOf(f, encFolk);
      let e = this.ents.get(f.id);
      const dist = e ? Math.hypot(e.x - me.x, e.y - me.y) : Math.hypot(t.x - me.x, t.y - me.y);
      if (dist > 46) {
        if (e) this.ents.delete(f.id);
        continue;
      }
      near.add(f.id);
      if (!e) {
        e = { x: t.x, y: t.y, path: [], tx: t.x, ty: t.y, inside: t.inside, frame: 0, flip: false, moving: false, anim: hash(f.id) * 10 };
        this.ents.set(f.id, e);
        continue;
      }
      if (Math.hypot(t.x - e.tx, t.y - e.ty) > 1.2) {
        e.tx = t.x;
        e.ty = t.y;
        e.inside = false;
        const path = Math.hypot(t.x - e.x, t.y - e.y) < 50 ? findPath(w, e.x, e.y, t.x, t.y, 2500) : [];
        e.path = path.length ? path : [{ x: t.x, y: t.y }];
      }
      (e as Ent & { wantInside?: boolean }).wantInside = t.inside;
    }
    for (const id of [...this.ents.keys()]) if (!near.has(id)) this.ents.delete(id);
  }

  private encounterSpots(): Map<string, { x: number; y: number }> {
    const life = ensureLife(this.w);
    const m = new Map<string, { x: number; y: number }>();
    for (const e of life.encounters) {
      if (e.resolved) continue;
      if (e.folkA) m.set(e.folkA, { x: e.x - 0.7, y: e.y });
      if (e.folkB) m.set(e.folkB, { x: e.x + 0.7, y: e.y });
    }
    return m;
  }

  private targetOf(f: Folk, enc: Map<string, { x: number; y: number }>) {
    const spot = enc.get(f.id);
    if (spot) return { ...spot, inside: false, activity: 'discute' };
    return routineOf(this.w, f, ensureLife(this.w).clock);
  }

  private moveFolk(dt: number): void {
    for (const [, e] of this.ents) {
      const wantInside = (e as Ent & { wantInside?: boolean }).wantInside;
      if (!e.path.length) {
        e.moving = false;
        if (wantInside) e.inside = true;
        continue;
      }
      const n = e.path[0];
      const d = Math.hypot(n.x - e.x, n.y - e.y);
      if (d < 0.2) {
        e.path.shift();
        continue;
      }
      const sp = Math.min(d, 2.3 * dt * this.timeScale ** 0.5);
      e.x += ((n.x - e.x) / d) * sp;
      e.y += ((n.y - e.y) / d) * sp;
      e.flip = n.x < e.x;
      e.moving = true;
      e.inside = false;
      e.anim += dt * 7;
    }
  }

  private moveAnimals(dt: number): void {
    const me = ensureLife(this.w).player;
    for (const v of this.l.villages) {
      const far = Math.hypot(v.cx - me.x, v.cy - me.y) > 60;
      if (far) {
        this.animals.delete(v.regionId);
        continue;
      }
      let list = this.animals.get(v.regionId);
      if (!list) {
        list = this.spawnAnimals(v.regionId);
        this.animals.set(v.regionId, list);
      }
      for (const a of list) {
        const d = Math.hypot(a.tx - a.x, a.ty - a.y);
        if (d < 0.2) {
          if (Math.random() < dt * 0.3) {
            a.tx = a.hx + (Math.random() - 0.5) * 8;
            a.ty = a.hy + (Math.random() - 0.5) * 6;
            if (!passable(this.w, this.l, a.tx, a.ty)) (a.tx = a.x), (a.ty = a.y);
          }
          continue;
        }
        const sp = Math.min(d, (a.kind === 'ciervo' ? 1.6 : 0.7) * dt);
        a.x += ((a.tx - a.x) / d) * sp;
        a.y += ((a.ty - a.y) / d) * sp;
        a.flip = a.tx < a.x;
        a.anim += dt * 6;
      }
    }
  }

  /** Los rebaños crecen o menguan con la comida y la salud de la tierra. */
  private spawnAnimals(regionId: number): Animal[] {
    const w = this.w;
    const r = w.regions[regionId];
    const v = this.l.villages[regionId];
    const food = r.isHome ? w.player.reserves / 5 : r.food;
    const plenty = r.flags.hambre ? 0.25 : Math.min(1.2, 0.4 + food / 20) * (0.5 + r.ecology * 0.6);
    const out: Animal[] = [];
    const herd = (kind: Animal['kind'], n: number, cx: number, cy: number) => {
      for (let i = 0; i < Math.round(n * plenty); i++) {
        const x = cx + (hash(`${regionId}${kind}`, i) - 0.5) * 6;
        const y = cy + (hash(`${regionId}${kind}`, i + 50) - 0.5) * 5;
        if (!passable(w, this.l, x, y)) continue;
        out.push({ kind, x, y, hx: cx, hy: cy, tx: x, ty: y, flip: false, anim: i });
      }
    };
    const field = v.fields[0] ?? { x: v.cx + 10, y: v.cy + 8, w: 4, h: 4 };
    const pasture = { x: field.x + field.w + 4, y: field.y + 2 };
    if (r.resource === 'lana') herd('oveja', 12, pasture.x, pasture.y);
    else if (r.resource === 'grano' || r.isHome) herd('vaca', 4, pasture.x, pasture.y);
    else herd('vaca', 2, pasture.x, pasture.y);
    herd('gallina', 5, v.cx + v.plazaR + 3, v.cy + v.plazaR + 1);
    if ((r.resource === 'hierbas' || r.resource === 'ambar') && r.ecology > 0.55) herd('ciervo', 3, v.cx + 26, v.cy - 18);
    return out;
  }

  // -------------------------------------------------------------------------
  // Objetivos de interacción
  // -------------------------------------------------------------------------
  private targetPos(t: Target): { x: number; y: number } | undefined {
    const w = this.w;
    const life = ensureLife(w);
    switch (t.kind) {
      case 'folk':
        return this.folkPosition(t.id);
      case 'building': {
        const b = this.l.villages[t.regionId].keys.find((k) => k.kind === t.building);
        return b ? doorOf(b) : undefined;
      }
      case 'post':
        return this.l.posts[t.index];
      case 'place': {
        const p = this.l.places.find((x) => x.id === t.id);
        return p ? { x: p.x + 0.5, y: p.y + 0.5 } : undefined;
      }
      case 'encounter': {
        const e = life.encounters.find((x) => x.id === t.id);
        return e ? { x: e.x, y: e.y } : undefined;
      }
      case 'messenger':
        return this.messengers().find((m) => m.id === t.petitionId);
      case 'signpost': {
        const v = this.l.villages[t.regionId];
        return { x: v.cx + 0.5, y: v.cy + 0.5 };
      }
    }
  }

  private messengers(): { id: string; x: number; y: number; regionId: number }[] {
    const w = this.w;
    const v = this.l.villages[w.player.home];
    const hall = v.keys.find((k) => k.kind === 'salon');
    if (!hall) return [];
    const d = doorOf(hall);
    return w.petitions.slice(0, 4).map((p, i) => ({ id: p.id, x: d.x - 1.5 + i * 1.1, y: d.y + 1.2, regionId: p.regionId }));
  }

  /** El objetivo interactuable más cercano a un punto. */
  private targetAt(x: number, y: number, radius: number): { t: Target; d: number } | null {
    const w = this.w;
    const life = ensureLife(w);
    let best: { t: Target; d: number } | null = null;
    const consider = (t: Target, px: number, py: number, r = radius) => {
      const d = Math.hypot(px - x, py - y);
      if (d <= r && (!best || d < best.d)) best = { t, d };
    };
    for (const [id, e] of this.ents) {
      if (e.inside) continue;
      const f = life.folk.find((ff) => ff.id === id);
      if (f) consider({ kind: 'folk', id, label: f.name }, e.x, e.y - 0.4);
    }
    for (const m of this.messengers()) consider({ kind: 'messenger', petitionId: m.id, label: `Mensajero de ${w.regions[m.regionId].name}` }, m.x, m.y);
    for (const v of this.l.villages) {
      if (Math.hypot(v.cx - x, v.cy - y) > 40) continue;
      for (const b of v.keys) {
        if (!this.buildingExists(v.regionId, b.kind)) continue;
        const d = doorOf(b);
        consider({ kind: 'building', regionId: v.regionId, building: b.kind, label: BUILDING_LABEL[b.kind] }, d.x, d.y, radius * 0.9);
      }
      consider({ kind: 'signpost', regionId: v.regionId, label: 'Cruce de caminos' }, v.cx + 0.5, v.cy + 0.5, radius * 0.8);
    }
    this.l.posts.forEach((p, i) => consider({ kind: 'post', index: i, label: 'Puesto fronterizo' }, p.x, p.y, radius * 1.3));
    for (const p of this.l.places) if (life.places[p.id]?.discovered) consider({ kind: 'place', id: p.id, label: p.name }, p.x + 0.5, p.y + 0.5, radius * 1.3);
    // Los encuentros tienen prioridad sobre las personas que participan en ellos.
    for (const e of life.encounters) {
      if (e.resolved) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= radius * 1.6) return { t: { kind: 'encounter', id: e.id, label: '¿Qué ocurre aquí?' }, d };
    }
    return best;
  }

  buildingExists(regionId: number, kind: BuildingKind): boolean {
    const r = this.w.regions[regionId];
    if (kind === 'forja') return r.resource === 'hierro' || r.techs.includes('fuelles') || r.militancy > 0.5 || r.population > 900;
    return true;
  }

  // -------------------------------------------------------------------------
  // Dibujo
  // -------------------------------------------------------------------------
  private draw(t: number): void {
    const w = this.w;
    const life = ensureLife(w);
    const g = this.g;
    const z = this.cam.z;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#2f5468';
    g.fillRect(0, 0, this.vw, this.vh);
    g.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.vw / 2 - this.cam.x * z), this.dpr * (this.vh / 2 - this.cam.y * z));
    g.imageSmoothingEnabled = true;

    const x0 = this.cam.x - this.vw / 2 / z;
    const y0 = this.cam.y - this.vh / 2 / z;
    const x1 = this.cam.x + this.vw / 2 / z;
    const y1 = this.cam.y + this.vh / 2 / z;
    const season = seasonOf(w.day);
    const weather = weatherOf(w, w.day);
    const look = (season === 'invierno' || weather === 'nieve' ? 'invierno' : season) as S.SeasonLook;
    const stateKey = this.chunks.stateKey(season);
    const CPX = CHUNK * TILE;
    const cx0 = Math.max(0, Math.floor(x0 / CPX));
    const cy0 = Math.max(0, Math.floor(y0 / CPX));
    const cx1 = Math.floor(x1 / CPX);
    const cy1 = Math.floor(y1 / CPX);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) g.drawImage(this.chunks.get(cx, cy, season, stateKey), cx * CPX, cy * CPX);
    if (weather === 'nieve' || w.regions.some((r) => r.flags.invierno)) {
      g.fillStyle = 'rgba(240,245,250,0.32)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    const items: Drawable[] = [];
    const inView = (px: number, py: number, m = 60) => px > x0 - m && px < x1 + m && py > y0 - m && py < y1 + m * 1.5;

    // Objetos estáticos del terreno.
    for (let cy = Math.max(0, Math.floor((y0 - 40) / CPX)); cy <= Math.floor((y1 + 60) / CPX); cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        for (const o of this.chunks.objectsOf(cx, cy)) {
          if (!inView(o.x, o.y)) continue;
          items.push({ y: o.y, draw: () => this.drawStatic(o, look) });
        }

    // Pueblos.
    for (const v of this.l.villages) {
      if (!inView(v.cx * TILE, v.cy * TILE, 34 * TILE)) continue;
      this.villageDrawables(v.regionId, items, inView, t);
    }
    // Puestos fronterizos, campamentos de guerra y soldados.
    this.l.posts.forEach((p) => {
      if (!inView(p.x * TILE, p.y * TILE, 200)) return;
      this.postDrawables(p, items, t);
    });
    // Lugares.
    for (const p of this.l.places) {
      if (!inView(p.x * TILE, p.y * TILE)) continue;
      const known = life.places[p.id]?.discovered;
      items.push({ y: p.y * TILE + 16, draw: () => S.drawSprite(g, S.placeSprite(p.kind), p.x * TILE + 8, p.y * TILE + 16, known ? 1 : 0.9) });
    }
    // Caminantes de los caminos: caravanas, refugiados, soldados en marcha, viajeros.
    this.roadTraffic(items, inView, t);
    // Vecinos.
    for (const [id, e] of this.ents) {
      if (e.inside || !inView(e.x * TILE, e.y * TILE)) continue;
      const f = life.folk.find((x) => x.id === id);
      if (!f) continue;
      items.push({ y: e.y * TILE, draw: () => S.drawSprite(g, S.person(this.lookOf(f), e.moving ? 1 + (Math.floor(e.anim) % 2) : 0, e.flip), e.x * TILE, e.y * TILE) });
    }
    // Mensajeros esperando ante tu salón.
    for (const m of this.messengers()) {
      const hue = this.hueOf(m.regionId);
      items.push({ y: m.y * TILE, draw: () => S.drawSprite(g, S.person({ body: `hsl(${hue} 40% 40%)`, skin: '#d9a77a', hair: '#3a2a1a', hat: 'capucha', carry: 'saco' }, Math.floor(t / 500) % 2 ? 0 : 1, false), m.x * TILE, m.y * TILE) });
    }
    // Animales.
    for (const list of this.animals.values())
      for (const a of list) {
        if (!inView(a.x * TILE, a.y * TILE)) continue;
        items.push({ y: a.y * TILE, draw: () => S.drawSprite(g, S.animal(a.kind, Math.floor(a.anim) % 2, a.flip), a.x * TILE, a.y * TILE) });
      }
    // Jugador.
    const me = life.player;
    items.push({
      y: me.y * TILE,
      draw: () => S.drawSprite(g, S.person(this.playerLook(), this.playerMoving ? 1 + (Math.floor(this.playerAnim) % 2) : 0, this.facing.x < -0.1), me.x * TILE, me.y * TILE),
    });

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    this.drawParticles(g, t);
    this.drawMarkers(g, t);

    // Capa de pantalla: noche, clima, joystick, etiquetas.
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawNight(g);
    this.drawWeather(g, weather, t);
    this.drawLabels(g);
    this.drawEdgeArrows(g, t);
    if (this.joy) {
      g.fillStyle = 'rgba(243,232,207,0.18)';
      g.strokeStyle = 'rgba(243,232,207,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.joy.bx, this.joy.by, 56, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const dx = this.joy.x - this.joy.bx;
      const dy = this.joy.y - this.joy.by;
      const len = Math.min(56, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      g.fillStyle = 'rgba(243,232,207,0.75)';
      g.beginPath();
      g.arc(this.joy.bx + Math.cos(a) * len, this.joy.by + Math.sin(a) * len, 24, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawStatic(o: { x: number; y: number; kind: string; v: number; region: number }, look: S.SeasonLook): void {
    const g = this.g;
    const r = o.region >= 0 ? this.w.regions[o.region] : undefined;
    switch (o.kind) {
      case 'arbol': {
        const res = r?.resource ?? 'grano';
        let kind: S.TreeKind = res === 'hierro' || res === 'ambar' ? (o.v % 3 ? 'pino' : 'roble') : res === 'hierbas' ? (o.v % 4 === 0 ? 'abedul' : 'roble') : o.v % 5 === 0 ? 'abedul' : 'roble';
        // Un ecosistema degradado deja árboles muertos.
        if (r && r.ecology < 0.42 && o.v % 3 !== 0) kind = 'muerto';
        S.drawSprite(g, S.tree(kind, look, o.v), o.x, o.y);
        break;
      }
      case 'arbusto':
        S.drawSprite(g, S.tree('arbusto', look, o.v), o.x, o.y);
        break;
      case 'junco':
        S.drawSprite(g, S.tree('junco', look, o.v), o.x, o.y);
        break;
      case 'roca':
        S.drawSprite(g, S.rock(o.v, look === 'invierno'), o.x, o.y);
        break;
      case 'pico':
        S.drawSprite(g, S.peak(o.v), o.x, o.y);
        break;
      case 'mojon':
        S.drawSprite(g, S.boundaryStone(), o.x, o.y);
        break;
    }
  }

  private hueOf(regionId: number): number {
    const r = this.w.regions[regionId];
    return (r.isHome ? PLAYER_CULTURE : CULTURES.find((c) => c.id === r.culture) ?? PLAYER_CULTURE).hue;
  }

  private styleOf(regionId: number): S.Style {
    const r = this.w.regions[regionId];
    return S.styleFor(r.isHome ? 'eco' : r.culture, this.hueOf(regionId));
  }

  private villageDrawables(regionId: number, items: Drawable[], inView: (x: number, y: number, m?: number) => boolean, t: number): void {
    const w = this.w;
    const g = this.g;
    const life = ensureLife(w);
    const v = this.l.villages[regionId];
    const r = w.regions[regionId];
    const town = life.towns[regionId];
    const st = this.styleOf(regionId);
    const hue = this.hueOf(regionId);
    const night = darkness(life.clock) > 0.3;
    const built = Math.min(v.houses.length, town?.houses ?? 3);
    const target = housesFor(w, regionId);
    const abandonedFrom = built - (town?.abandoned ?? 0);
    v.houses.forEach((b, i) => {
      if (i > built || (i === built && target <= built)) return;
      const bx = (b.x + b.w / 2) * TILE;
      const by = (b.y + b.h) * TILE;
      if (!inView(bx, by)) return;
      const state: S.HouseState = i === built ? 'obra' : town?.burned.includes(i) ? 'quemada' : i >= abandonedFrom ? 'abandonada' : 'normal';
      items.push({
        y: by,
        draw: () => {
          S.drawSprite(g, S.house(st, state, i), bx, by);
          if (state === 'normal' && night) {
            g.fillStyle = 'rgba(255,205,110,0.85)';
            g.fillRect(bx - 11, by - 16, 5, 5);
            g.fillRect(bx + 6, by - 16, 5, 5);
          }
        },
      });
      if (state === 'quemada' && !this.reduceMotion && Math.random() < 0.06) this.puff(bx, by - 26, 'rgba(60,55,50,', 1.2);
      if (state === 'normal' && !this.reduceMotion && Math.random() < 0.004 && (hourOf(life.clock) < 9 || hourOf(life.clock) > 18)) this.puff(bx + 9, by - 34, 'rgba(200,200,200,', 0.6);
    });
    const food = r.isHome ? w.player.reserves / 5 : r.food;
    for (const b of v.keys) {
      if (!this.buildingExists(regionId, b.kind)) continue;
      const bx = (b.x + b.w / 2) * TILE;
      const by = (b.y + b.h) * TILE;
      if (!inView(bx, by)) continue;
      const extra = b.kind === 'almacen' ? (food < 4 ? 'vacio' : '') : b.kind === 'salon' ? `hsl(${hue} 55% 45%)` : '';
      items.push({ y: by, draw: () => S.drawSprite(g, S.keyBuilding(b.kind, st, extra), bx, by) });
      if (b.kind === 'forja' && !this.reduceMotion && Math.random() < (r.militancy > 0.55 ? 0.12 : 0.04) && hourOf(life.clock) > 8 && hourOf(life.clock) < 18) this.puff(bx + 8, by - 38, 'rgba(70,65,60,', 1);
    }
    // Mercado: puestos llenos, vacíos o abandonados.
    const traffic = w.routes.filter((x) => (x.a === regionId || x.b === regionId) && x.status === 'abierta').reduce((s, x) => s + x.traffic, 0);
    const active = r.flags.sinComercio ? 2 : Math.max(2, Math.min(v.stalls.length, Math.round(2 + traffic * 3 + (r.population / 400))));
    v.stalls.slice(0, active).forEach((s, i) => {
      const full = food > 5 && !r.flags.hambre && !(r.flags.sinComercio && i > 0);
      items.push({ y: s.y * TILE + 10, draw: () => S.drawSprite(g, S.stall(full, `hsl(${(hue + i * 40) % 360} 50% 55%)`), s.x * TILE + 8, s.y * TILE + 10) });
    });
    // Empalizada.
    if (town?.walls) {
      const R = v.wallR;
      const steps = Math.floor((2 * Math.PI * R) / 1.1);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = v.cx + 0.5 + Math.cos(a) * R;
        const y = v.cy + 0.5 + Math.sin(a) * R;
        const k = idx(Math.floor(x), Math.floor(y));
        const tt = this.l.terrain.tiles[k];
        if (tt === 13 || tt === 14 || tt === 2 || tt === 1 || tt === 0 || tt === 9) continue; // puertas en los caminos
        const px = x * TILE;
        const py = y * TILE;
        if (!inView(px, py)) continue;
        items.push({
          y: py,
          draw: () => {
            g.fillStyle = '#6b4a2e';
            g.fillRect(px - 2, py - 16, 4, 16);
            g.fillStyle = '#8a6440';
            g.beginPath();
            g.moveTo(px - 2, py - 16);
            g.lineTo(px, py - 20);
            g.lineTo(px + 2, py - 16);
            g.fill();
          },
        });
      }
    }
    if (town?.tower) {
      const px = (v.cx + v.plazaR + 1.5) * TILE;
      const py = (v.cy - v.plazaR) * TILE;
      items.push({
        y: py,
        draw: () => {
          g.fillStyle = '#8a7a64';
          g.fillRect(px - 5, py - 46, 10, 46);
          g.fillStyle = '#5a4a3a';
          g.fillRect(px - 8, py - 50, 16, 6);
          if (night || Math.floor(t / 700) % 2) {
            g.fillStyle = 'rgba(255,170,60,0.9)';
            g.beginPath();
            g.arc(px, py - 54, 4, 0, Math.PI * 2);
            g.fill();
          }
        },
      });
    }
    // Hoguera de la plaza al anochecer.
    if (hourOf(life.clock) > 19 || hourOf(life.clock) < 1) {
      const px = (v.cx + 0.5) * TILE;
      const py = (v.cy + 0.5) * TILE;
      items.push({ y: py, draw: () => this.fire(px, py, t) });
    }
  }

  private postDrawables(p: { routeId: number; a: number; b: number; x: number; y: number; pathIndex: number }, items: Drawable[], t: number): void {
    const w = this.w;
    const g = this.g;
    const route = w.routes[p.routeId];
    const a = w.regions[p.a];
    const b = w.regions[p.b];
    const px = p.x * TILE;
    const py = p.y * TILE;
    const closed = route.status !== 'abierta';
    const owner = a.isHome ? b : a;
    items.push({ y: py + 4, draw: () => S.drawSprite(g, S.post(`hsl(${this.hueOf(owner.id)} 60% 45%)`, closed), px - 20, py + 4) });
    if (closed) items.push({ y: py + 2, draw: () => S.drawSprite(g, S.barricade(), px + 2, py + 2) });
    // Guardias según la tensión; campamentos si hay guerra.
    const war = a.relations[b.id]?.war;
    const mil = Math.max(a.militancy, b.militancy, a.relations[b.id]?.tension ?? 0);
    const guards = war ? 6 : mil > 0.55 ? 4 : mil > 0.35 ? 2 : route.status === 'cerrada' ? 2 : 1;
    for (let i = 0; i < guards; i++) {
      const side = i % 2 ? a : b;
      const sx = px + (i % 2 ? -1 : 1) * (14 + (i >> 1) * 12) + Math.sin(t / 900 + i) * 3;
      const sy = py + 10 + (i >> 1) * 6;
      const hue = this.hueOf(side.id);
      items.push({ y: sy, draw: () => S.drawSprite(g, S.person({ body: `hsl(${hue} 30% 35%)`, skin: '#c99a72', hair: '#2a1e14', hat: 'casco', carry: 'lanza' }, war ? Math.floor(t / 300 + i) % 3 : 0, i % 2 === 0), sx, sy) });
    }
    if (war) {
      for (let i = 0; i < 3; i++) {
        const tx = px + (i - 1) * 34;
        const ty = py - 40 - (i % 2) * 10;
        items.push({ y: ty, draw: () => S.drawSprite(g, S.tent(`hsl(${this.hueOf(i % 2 ? a.id : b.id)} 35% 50%)`), tx, ty) });
      }
      items.push({ y: py - 26, draw: () => this.fire(px, py - 26, t) });
    }
  }

  /** Comercio, refugiados, soldados y caravanas por los caminos (solo lo visible). */
  private roadTraffic(items: Drawable[], inView: (x: number, y: number, m?: number) => boolean, t: number): void {
    const w = this.w;
    const g = this.g;
    const life = ensureLife(w);
    const h = hourOf(life.clock);
    const day = h > 6.5 && h < 20;
    const clock = life.clock;
    for (const road of this.l.roads) {
      const route = w.routes[road.routeId];
      const len = road.path.length;
      if (len < 4) continue;
      // Caravanas comerciales: su número depende del tráfico real de la ruta.
      if (route.status === 'abierta' && day) {
        const n = Math.round(route.traffic * 2.2);
        for (let i = 0; i < n; i++) {
          const phase = ((clock * 1.2) / len + i / n + road.routeId * 0.37) % 2;
          const fwd = phase < 1;
          const pos = along(road.path, fwd ? phase : 2 - phase);
          const px = pos.x * TILE;
          const py = pos.y * TILE;
          if (!inView(px, py)) continue;
          const flip = (fwd ? pos.dx : -pos.dx) < 0;
          items.push({ y: py, draw: () => S.drawSprite(g, S.cart(Math.floor(t / 250) % 2, flip, '#d9c08a'), px, py) });
        }
      }
      // Soldados en marcha entre regiones en guerra.
      if (w.regions[road.a].relations[road.b]?.war) {
        for (let i = 0; i < 5; i++) {
          const phase = ((clock * 1.5) / len + i * 0.04) % 1;
          const pos = along(road.path, 0.35 + phase * 0.3);
          const px = pos.x * TILE + (i % 2) * 8;
          const py = pos.y * TILE + (i % 3) * 5;
          if (!inView(px, py)) continue;
          const hue = this.hueOf(i % 2 ? road.a : road.b);
          items.push({ y: py, draw: () => S.drawSprite(g, S.person({ body: `hsl(${hue} 35% 35%)`, skin: '#c99a72', hair: '#2a1e14', hat: 'casco', carry: 'lanza' }, 1 + (Math.floor(t / 200 + i) % 2), pos.dx < 0), px, py) });
        }
      }
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
        const px = pos.x * TILE + (i % 2) * 7;
        const py = pos.y * TILE + (i % 3) * 4;
        if (!inView(px, py)) continue;
        items.push({ y: py, draw: () => S.drawSprite(g, S.person({ body: '#7a6a58', skin: '#d4a57a', hair: '#4a3626', hat: i % 2 ? 'pañuelo' : undefined, carry: 'saco', small: i === 3 }, 1 + (Math.floor(t / 280 + i) % 2), pos.dx < 0), px, py) });
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
      items.push({
        y: py,
        draw: () => {
          S.drawSprite(g, S.cart(Math.floor(t / 300) % 2, pos.dx < 0, c.kind === 'regalo' ? '#c98ad0' : '#e3c070'), px, py);
          S.drawSprite(g, S.person(this.playerLookSmall(), 1 + (Math.floor(t / 300) % 2), pos.dx < 0), px + (pos.dx < 0 ? 22 : -22), py + 2);
          g.fillStyle = '#e9b44c';
          g.fillRect(px - 1, py - 34, 2, 10);
          g.beginPath();
          g.moveTo(px + 1, py - 34);
          g.lineTo(px + 9, py - 31);
          g.lineTo(px + 1, py - 28);
          g.fill();
        },
      });
    }
  }

  private fire(px: number, py: number, t: number): void {
    const g = this.g;
    g.fillStyle = '#4a3626';
    g.fillRect(px - 6, py - 2, 12, 3);
    const f = this.reduceMotion ? 0 : Math.sin(t / 90) * 1.5;
    g.fillStyle = '#e8743a';
    g.beginPath();
    g.moveTo(px - 5, py);
    g.quadraticCurveTo(px, py - 14 - f, px + 5, py);
    g.fill();
    g.fillStyle = '#f6c45a';
    g.beginPath();
    g.moveTo(px - 2.5, py);
    g.quadraticCurveTo(px, py - 8 + f, px + 2.5, py);
    g.fill();
  }

  private puff(x: number, y: number, color: string, size: number): void {
    if (this.particles.length > 220) return;
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 0.15, vy: -0.35 - Math.random() * 0.2, life: 0, max: 140 + Math.random() * 80, r: 3 * size, color });
  }

  private drawParticles(g: CanvasRenderingContext2D, t: number): void {
    void t;
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const p of this.particles) {
      p.life++;
      p.x += p.vx + Math.sin(p.life / 20) * 0.1;
      p.y += p.vy;
      p.r += 0.05;
      g.fillStyle = `${p.color}${(0.5 * (1 - p.life / p.max)).toFixed(3)})`;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** "!" sobre los encuentros, y resaltado del objetivo enfocado. */
  private drawMarkers(g: CanvasRenderingContext2D, t: number): void {
    const life = ensureLife(this.w);
    for (const e of life.encounters) {
      if (e.resolved) continue;
      const bob = this.reduceMotion ? 0 : Math.sin(t / 250) * 2;
      g.fillStyle = '#f3e8cf';
      g.strokeStyle = '#2b1e15';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(e.x * TILE, e.y * TILE - 44 + bob, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#b5562d';
      g.font = 'bold 11px system-ui';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('!', e.x * TILE, e.y * TILE - 43 + bob);
    }
    const f = this.focus ? this.targetPos(this.focus) : undefined;
    if (f) {
      g.strokeStyle = 'rgba(255,240,190,0.9)';
      g.lineWidth = 1.5;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.ellipse(f.x * TILE, f.y * TILE + 1, 9, 4, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  }

  private drawLabels(g: CanvasRenderingContext2D): void {
    const w = this.w;
    const life = ensureLife(w);
    const me = life.player;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    // Nombre de las personas cercanas que ya conoces.
    for (const [id, e] of this.ents) {
      if (e.inside || Math.hypot(e.x - me.x, e.y - me.y) > 5) continue;
      const f = life.folk.find((x) => x.id === id);
      if (!f || f.lastMet < 0) continue;
      const p = this.toScreen(e.x * TILE, e.y * TILE - 32);
      g.font = '600 12px Georgia, serif';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(30,25,20,0.7)';
      g.strokeText(f.name, p.x, p.y);
      g.fillStyle = '#f6ecd2';
      g.fillText(f.name, p.x, p.y);
    }
    // Nombre del pueblo al acercarse a la plaza.
    for (const v of this.l.villages) {
      const d = Math.hypot(v.cx - me.x, v.cy - me.y);
      if (d > 16) continue;
      const p = this.toScreen((v.cx + 0.5) * TILE, (v.cy - v.plazaR - 1) * TILE);
      g.globalAlpha = Math.min(1, (16 - d) / 6);
      g.font = '700 17px Georgia, serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(30,25,20,0.65)';
      g.strokeText(w.regions[v.regionId].name, p.x, p.y);
      g.fillStyle = '#f3e3b5';
      g.fillText(w.regions[v.regionId].name, p.x, p.y);
      g.globalAlpha = 1;
    }
  }

  /** Flechas en el borde de la pantalla hacia encuentros cercanos fuera de la vista. */
  private drawEdgeArrows(g: CanvasRenderingContext2D, t: number): void {
    const life = ensureLife(this.w);
    if (this.waypoint) {
      const wp = this.waypoint;
      const p = this.toScreen(wp.x * TILE, wp.y * TILE);
      const cx = this.vw / 2;
      const cy = this.vh / 2;
      const onScreen = p.x > 20 && p.y > 60 && p.x < this.vw - 20 && p.y < this.vh - 20;
      const a = Math.atan2(p.y - cy, p.x - cx);
      const x = onScreen ? p.x : cx + Math.cos(a) * (this.vw / 2 - 40);
      const y = onScreen ? p.y - 30 : cy + Math.sin(a) * (this.vh / 2 - 90);
      g.save();
      g.translate(x, y);
      if (!onScreen) g.rotate(a);
      g.fillStyle = '#e9b44c';
      g.strokeStyle = '#2b1e15';
      g.lineWidth = 2;
      g.beginPath();
      if (onScreen) (g.moveTo(0, 10), g.lineTo(-8, -4), g.lineTo(8, -4));
      else (g.moveTo(16, 0), g.lineTo(-8, -10), g.lineTo(-3, 0), g.lineTo(-8, 10));
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      const dist = Math.hypot(wp.x - life.player.x, wp.y - life.player.y);
      g.font = '600 12px system-ui';
      g.textAlign = 'center';
      g.fillStyle = '#f6ecd2';
      g.strokeStyle = 'rgba(30,25,20,0.7)';
      g.lineWidth = 3;
      const label = `${wp.label} · ${Math.round(dist * 2)} pasos`;
      const ly = onScreen ? y - 14 : y + (Math.sin(a) > 0 ? -18 : 26);
      g.strokeText(label, x, ly);
      g.fillText(label, x, ly);
    }
    for (const e of life.encounters) {
      if (e.resolved) continue;
      const p = this.toScreen(e.x * TILE, e.y * TILE);
      if (p.x > 0 && p.y > 0 && p.x < this.vw && p.y < this.vh) continue;
      const cx = this.vw / 2;
      const cy = this.vh / 2;
      const a = Math.atan2(p.y - cy, p.x - cx);
      const r = Math.min(this.vw, this.vh) / 2 - 34;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * (this.vh / this.vw);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.globalAlpha = 0.6 + Math.sin(t / 300) * 0.3;
      g.fillStyle = '#f3e8cf';
      g.beginPath();
      g.moveTo(12, 0);
      g.lineTo(-8, -8);
      g.lineTo(-4, 0);
      g.lineTo(-8, 8);
      g.closePath();
      g.fill();
      g.restore();
      g.globalAlpha = 1;
    }
  }

  /** Noche: oscuridad con luces de ventanas, hogueras y tu farol. */
  private drawNight(g: CanvasRenderingContext2D): void {
    const life = ensureLife(this.w);
    const d = darkness(life.clock);
    if (d <= 0.01) return;
    const dc = this.dark.getContext('2d')!;
    const W = this.dark.width;
    const H = this.dark.height;
    dc.globalCompositeOperation = 'source-over';
    dc.clearRect(0, 0, W, H);
    dc.fillStyle = `rgba(12,16,38,${d})`;
    dc.fillRect(0, 0, W, H);
    dc.globalCompositeOperation = 'destination-out';
    const light = (wx: number, wy: number, radius: number, k = 1) => {
      const p = this.toScreen(wx, wy);
      const x = p.x / 2;
      const y = p.y / 2;
      const r = (radius * this.cam.z) / 2;
      if (x < -r || y < -r || x > W + r || y > H + r) return;
      const grad = dc.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(0,0,0,${0.95 * k})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      dc.fillStyle = grad;
      dc.beginPath();
      dc.arc(x, y, r, 0, Math.PI * 2);
      dc.fill();
    };
    const me = life.player;
    light(me.x * TILE, me.y * TILE - 10, 90);
    for (const v of this.l.villages) {
      if (Math.hypot(v.cx - me.x, v.cy - me.y) > 50) continue;
      light((v.cx + 0.5) * TILE, (v.cy + 0.5) * TILE, 70, 0.9);
      const built = life.towns[v.regionId]?.houses ?? 3;
      v.houses.slice(0, built).forEach((b, i) => {
        if (life.towns[v.regionId]?.burned.includes(i)) return;
        light((b.x + 1) * TILE, (b.y + 1) * TILE, 30, 0.7);
      });
      for (const k of v.keys) light((k.x + k.w / 2) * TILE, (k.y + k.h) * TILE, 36, 0.8);
    }
    for (const p of this.l.posts) if (Math.hypot(p.x - me.x, p.y - me.y) < 40) light(p.x * TILE, p.y * TILE, 40, 0.7);
    g.drawImage(this.dark, 0, 0, this.vw, this.vh);
    g.globalCompositeOperation = 'source-over';
  }

  private drawWeather(g: CanvasRenderingContext2D, weather: string, t: number): void {
    if (weather === 'despejado' || weather === 'nublado') {
      if (weather === 'nublado') (g.fillStyle = 'rgba(60,70,80,0.12)'), g.fillRect(0, 0, this.vw, this.vh);
      return;
    }
    if (weather === 'niebla') {
      const grad = g.createRadialGradient(this.vw / 2, this.vh / 2, 60, this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.7);
      grad.addColorStop(0, 'rgba(220,225,230,0.05)');
      grad.addColorStop(1, 'rgba(220,225,230,0.65)');
      g.fillStyle = grad;
      g.fillRect(0, 0, this.vw, this.vh);
      return;
    }
    const n = this.reduceMotion ? 30 : weather === 'lluvia' ? 90 : 70;
    while (this.weatherP.length < n) this.weatherP.push({ x: Math.random() * this.vw, y: Math.random() * this.vh, s: 0.5 + Math.random() });
    if (weather === 'lluvia') {
      g.fillStyle = 'rgba(40,50,70,0.15)';
      g.fillRect(0, 0, this.vw, this.vh);
      g.strokeStyle = 'rgba(200,215,235,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      for (const p of this.weatherP) {
        p.y += 14 * p.s;
        p.x -= 2 * p.s;
        if (p.y > this.vh) (p.y = -10), (p.x = Math.random() * this.vw);
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - 3, p.y + 10);
      }
      g.stroke();
    } else {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (const p of this.weatherP) {
        p.y += 1.2 * p.s;
        p.x += Math.sin(t / 900 + p.s * 10) * 0.5;
        if (p.y > this.vh) (p.y = -5), (p.x = Math.random() * this.vw);
        g.beginPath();
        g.arc(p.x, p.y, 1.5 * p.s, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Aspecto de las personas
  // -------------------------------------------------------------------------
  private lookOf(f: Folk): S.Look {
    const hue = this.hueOf(f.regionId);
    const hv = hash(f.id);
    const skin = ['#e8c09a', '#d4a57a', '#b98458', '#8d5f3e', '#f0d2b4'][Math.floor(hv * 5)];
    const hair = f.age > 60 ? '#d8d4cc' : ['#2a1e14', '#5a3a1e', '#8a5a2a', '#c99a52', '#1a1410'][Math.floor(hash(f.id, 3) * 5)];
    const cloth = `hsl(${(hue + Math.floor(hash(f.id, 5) * 50) - 25 + 360) % 360} ${30 + Math.floor(hv * 25)}% ${32 + Math.floor(hash(f.id, 7) * 18)}%)`;
    const r = this.w.regions[f.regionId];
    const hungry = !!r.flags.hambre;
    switch (f.role) {
      case 'guardia':
        return { body: `hsl(${hue} 25% 32%)`, skin, hair, hat: 'casco', carry: 'lanza' };
      case 'campesino':
        return { body: cloth, skin, hair, hat: hash(f.id, 9) < 0.5 ? 'sombrero' : undefined, carry: hungry ? undefined : 'cesta' };
      case 'pescador':
        return { body: '#4a6a8a', skin, hair, hat: 'pañuelo' };
      case 'pastor':
        return { body: cloth, skin, hair, carry: 'cayado' };
      case 'comerciante':
        return { body: `hsl(${(hue + 180) % 360} 45% 38%)`, skin, hair, hat: 'sombrero', carry: hungry ? undefined : 'saco' };
      case 'nino':
        return { body: cloth, skin, hair, small: true };
      case 'anciano':
        return { body: '#6a5a4a', skin, hair: '#e2ded6', carry: 'cayado' };
      case 'lider':
        return { body: `hsl(${hue} 55% 35%)`, skin, hair, hat: 'corona', cape: `hsl(${hue} 60% 28%)` };
      case 'sanadora':
        return { body: '#e8e2d2', skin, hair, hat: 'capucha', carry: 'cesta' };
      case 'exploradora':
        return { body: '#4a6a3a', skin, hair, hat: 'capucha', carry: 'farol' };
      default:
        return { body: '#5a4a3a', skin, hair, hat: 'pañuelo' };
    }
  }

  private playerLook(): S.Look {
    const p = ensureLife(this.w).player;
    const hairs = ['#3a2a1a', '#7a4a22', '#1a1410', '#a8743a', '#5a3a1e'];
    return { body: '#2f5f63', skin: '#e0b48c', hair: p.age > 58 ? '#d8d4cc' : hairs[(p.generation - 1) % hairs.length], cape: '#c9902c', carry: darkness(ensureLife(this.w).clock) > 0.3 ? 'farol' : undefined };
  }

  private playerLookSmall(): S.Look {
    return { body: '#6a5a40', skin: '#d4a57a', hair: '#3a2a1a', hat: 'sombrero' };
  }
}

export { TW };
