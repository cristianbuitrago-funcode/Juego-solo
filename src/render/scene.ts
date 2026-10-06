import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import type { WorldState } from '../core/types';
import { darkness, hourOf, SECONDS_PER_MINUTE, seasonOf } from '../world/clock';
import { weatherIn } from '../world/geography';
import { clearMaterials } from '../visual/env/materials';
import { bodyOf } from '../visual/figure/body';
import { drawSmall, drawTree, drawTreeShadow, type SmallKind, type TreeKind } from '../visual/env/flora';
import { playerRegion } from '../world/society';
import { getLayout, doorOf, type BuildingKind, type Layout } from '../world/layout';
import { ensureLife, explore, housesFor } from '../world/life';
import { findPath, passable } from '../world/path';
import { along, roadPath } from '../world/roadnet';
import { routineOf } from '../world/routines';
import { prologueBlocks, prologueItems } from '../world/prologue';
import { overheard } from '../world/gossip';
import { convoyPositions } from '../world/trade';
import { GOOD_COLOR, marketLook } from '../world/marketview';
import type { Good } from '../world/economy';
import { idx, speedOf, walkable } from '../world/terrain';
import { T, TILE, TW, type Folk, type FolkRole } from '../world/types';
import { appearanceOf, playerAppearance, type Appearance } from './appearance';
import { CHUNK, ChunkCache, PAD, type StaticObject } from './chunks';
import type { Action, Expr, Facing, Pose } from '../visual/figure/types';
import { drawFigure, drawFigureShadow, figureTop } from '../visual/figure/figure';
import { castShadow, contactShadow, sunAt, type SunState } from '../visual/light';
import { houseTex, houseWindows, keyTex, snowCapped, WALL_H, type BuildState } from '../visual/env/buildings';
import { animalTex, drawFountainWater, propTex, stallTex, tentTex } from '../visual/env/props';
import { marketOf } from '../world/economy';
import { VQ, resolveTier, setTier, type QualitySetting, type Tier } from '../visual/quality';
import { clearTextures, nextFrame, put, silhouette } from '../visual/paint';
import { drawFire, drawFlame, drawPuff } from './fx';
import { Weather } from '../visual/weather';
import { actionOf, moodOf } from './mood';
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
const hashOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export type Target =
  | { kind: 'folk'; id: string; label: string }
  | { kind: 'building'; regionId: number; building: BuildingKind; label: string }
  | { kind: 'post'; index: number; label: string }
  | { kind: 'place'; id: string; label: string }
  | { kind: 'encounter'; id: string; label: string }
  | { kind: 'messenger'; petitionId: string; label: string }
  | { kind: 'signpost'; regionId: number; label: string }
  | { kind: 'item'; id: string; label: string }
  | { kind: 'convoy'; id: string; label: string }
  | { kind: 'settlement'; id: string; label: string }
  | { kind: 'poi'; id: string; label: string };

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
  dx: number; // última dirección de marcha
  dy: number;
  act: string; // actividad de la rutina
  facing: Facing;
  partner?: string; // con quién conversa
  greeted?: boolean;
  react?: { expr?: Expr; action?: Action; until: number };
  stride?: number; // zancada de su cuerpo (teselas por paso)
}

/** Figurante de las ciudades grandes: da vida a la plaza, no tiene memoria. */
interface Extra extends Ent {
  regionId: number;
  wait: number;
}

interface Animal {
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
}

interface Light {
  x: number; // píxeles de mundo
  y: number;
  r: number;
  k: number;
  flat?: number; // charco de luz en el suelo (elipse aplastada)
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

const BUILDING_LABEL: Record<string, string> = { salon: 'Salón', almacen: 'Almacén', posada: 'Posada', templo: 'Templo', forja: 'Forja', hogar: 'Tu casa', establo: 'Establo', granero: 'Granero' };

/** Zoom de cámara: explorando, junto a alguien y conversando. */
const ZOOM = { explore: 2.6, near: 3.1, talk: 4.4 };

function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export class WorldScene {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D; // mundo (misma superficie que la pantalla, con la transformación de la cámara)
  private screen: CanvasRenderingContext2D; // pantalla (capas de luz, clima, interfaz)
  private l: Layout;
  private chunks: ChunkCache;
  cam = { x: 0, y: 0, z: ZOOM.explore };
  private userZ = 1; // multiplicador del pellizco
  private converseId: string | null = null;
  private apCache = new Map<string, { key: string; ap: Appearance }>();
  private playerLook: unknown = null;
  private wxFrame = 'despejado';
  private playerLookKey = '';
  private extras = new Map<string, Extra>();
  private birds: { x: number; y: number; vx: number; ph: number }[] = [];
  private lights: Light[] = [];
  private socialAcc = 0;
  private folkById = new Map<string, Folk>();
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private ents = new Map<string, Ent>();
  private animals = new Map<number, Animal[]>();
  private particles: Particle[] = [];
  private wfx = new Weather();
  private lastCam = { x: 0, y: 0 };
  private lastDraw = 0;
  private raf = 0;
  private last = performance.now();
  private tickAcc = 0;
  private lodAcc = 0;
  private focusAcc = 0;
  private region = -1;
  private focus: Target | null = null;
  private playerAnim = 0;
  private playerMoving = false;
  /** Velocidad real del jugador (teselas/s): acelera y frena, no salta. */
  private vel = { x: 0, y: 0 };
  /** Segundos quieto (el acercamiento a quien está al lado espera un poco). */
  private stillT = 0;
  private paintsSeen = 0;
  /** Plano de cine en curso (momentos importantes): encuadre, acercamiento, franjas y cámara lenta. */
  private cine: { x?: number; y?: number; z: number; start: number; dur: number; slow: number } | null = null;
  private playerHidden = false;
  private snowCheck = -1e9;
  private snowWeather = '';
  private realDt = 0;
  private joyRun = false;
  /** Anticipación de la cámara, filtrada (no da latigazos al girar). */
  private lookAhead = { x: 0, y: 0 };
  /** Destino tocado: un anillo que se desvanece en el suelo. */
  private tapMark: { x: number; y: number; t: number } | null = null;
  private ro: ResizeObserver | null = null;
  /** Capa de oscuridad nocturna (a media resolución). */
  private dark = document.createElement('canvas');
  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    this.keys.add(e.key.toLowerCase());
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) this.stop();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private playerRun = false;
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
  /** Multiplicador de velocidad del personaje (hambre, cansancio). */
  speed: () => number = () => 1;

  /** Nivel gráfico (LOW–ULTRA, o automático): resolución, texturas, sombras, partículas y gentío. */
  private qualitySetting: QualitySetting = 'auto';
  private frameMs: number[] = [];
  private lastDowngrade = 0;
  setQuality(q: QualitySetting): void {
    this.qualitySetting = q;
    const changed = setTier(resolveTier(q));
    if (changed) (clearTextures(), S.clearSprites(), clearMaterials());
    this.resize();
    if (VQ().crowd === 0) this.extras.clear();
  }
  private get low(): boolean {
    return VQ().tier === 'low';
  }
  private sun: SunState = sunAt(12, 'despejado');
  private shadowQ: (() => void)[] = [];

  /** Una persona en la escena: su sombra (en la pasada de sombras) y su figura (ordenada en profundidad). */
  private pushPerson(items: Drawable[], ap: Appearance, pose: Pose, x: number, y: number): void {
    const g = this.g;
    const sun = this.sun;
    this.shadowQ.push(() => drawFigureShadow(g, ap, x, y, pose.lod === 2 ? null : sun, pose.action === 'sit' || pose.action === 'sleep'));
    items.push({ y, draw: () => drawFigure(g, ap, pose, x, y) });
  }

  /** Solo para revisar escenas (pruebas visuales): fuerza el tiempo que se ve. No toca la simulación. */
  debugWeather: string | null = null;
  private weatherHere(): string {
    return this.debugWeather ?? weatherIn(this.w, playerRegion(this.w));
  }

  constructor(private parent: HTMLElement, public w: WorldState, private cb: SceneCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-canvas';
    parent.appendChild(this.canvas);
    this.screen = this.canvas.getContext('2d')!;
    this.g = this.screen;
    this.l = getLayout(w);
    for (const c of prologueBlocks(w)) this.l.blocked[idx(c.x, c.y)] = 1;
    this.chunks = new ChunkCache(w, this.l);
    const life = ensureLife(w);
    this.cam.x = life.player.x * TILE;
    this.cam.y = life.player.y * TILE;
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
    const loop = (t: number) => {
      const dt0 = Math.min(0.05, (t - this.last) / 1000);
      const cine = this.cineAmount();
      const dt = this.cine ? dt0 * (1 - (1 - this.cine.slow) * cine) : dt0;
      this.last = t;
      if (!this.paused) {
        this.converseId = null; // sin diálogo abierto no hay conversación
        this.realDt = dt0; // el jugador se mueve a tiempo real aunque el mundo vaya a cámara lenta
        this.update(dt);
      }
      this.updateCamera(dt0);
      // Tapado por el diario o el mapa (opacos), el mundo no se pinta; detrás de un
      // diálogo, que lo deja ver en penumbra y quieto, basta un fotograma de cada tres.
      this.frameNo++;
      if (!this.covered && (!this.paused || this.frameNo % 3 === 0)) {
        const w0 = performance.now();
        this.draw(t);
        // Se mide el trabajo de dibujo (no el intervalo entre fotogramas: un móvil a 30 Hz no es lento).
        if (!this.paused) this.watchFrames(performance.now() - w0);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /**
   * En automático, si el dispositivo no llega (el 95 % de los fotogramas de
   * los últimos segundos tarda más de 22 ms), se baja un nivel gráfico.
   */
  /** Tapado por una pantalla opaca (diario, mapa): no hace falta pintar el mundo. */
  covered = false;
  private frameNo = 0;
  private calmWindows = 0;
  /**
   * En automático, el nivel se adapta al dispositivo midiendo cuánto tarda en
   * pintarse cada fotograma: si el 95 % pasa de 16 ms, baja un nivel; si dos
   * tandas seguidas se quedan por debajo de 7 ms, sube (sin pasar del detectado).
   */
  private watchFrames(ms: number): void {
    if (this.qualitySetting !== 'auto' || document.hidden || ms > 250 || ms <= 0) return;
    this.frameMs.push(ms);
    if (this.frameMs.length < 240) return;
    const sorted = [...this.frameMs].sort((a, b) => a - b);
    this.frameMs.length = 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const now = performance.now();
    const order: Tier[] = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(VQ().tier);
    const cap = order.indexOf(resolveTier('auto'));
    let next = i;
    if (p95 > 16 && i > 0 && now - this.lastDowngrade > 15000) next = i - 1;
    this.calmWindows = p95 < 7 ? this.calmWindows + 1 : 0;
    if (this.calmWindows >= 2 && i < cap && now - this.lastDowngrade > 30000) next = i + 1;
    if (next === i) return;
    this.lastDowngrade = now;
    this.calmWindows = 0;
    setTier(order[next]);
    clearTextures();
    S.clearSprites();
    this.resize();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.remove();
  }

  setWorld(w: WorldState): void {
    this.w = w;
    this.chunks.setWorld(w);
  }

  /**
   * Momento importante: la cámara se acerca despacio (al jugador o a un punto,
   * en teselas), aparecen franjas de cine y el tiempo se ralentiza un poco.
   */
  cinematic(o: { x?: number; y?: number; zoom?: number; seconds?: number; slow?: number } = {}): void {
    if (this.reduceMotion) return;
    this.cine = { x: o.x, y: o.y, z: o.zoom ?? 1.22, start: performance.now(), dur: (o.seconds ?? 3.2) * 1000, slow: o.slow ?? 0.45 };
  }
  /** 0..1..0: cuánto pesa el plano de cine ahora (entra y sale suave). */
  private cineAmount(): number {
    const c = this.cine;
    if (!c) return 0;
    const u = (performance.now() - c.start) / c.dur;
    if (u >= 1) {
      this.cine = null;
      return 0;
    }
    const e = (v: number) => v * v * (3 - 2 * v);
    return u < 0.2 ? e(u / 0.2) : u > 0.75 ? e((1 - u) / 0.25) : 1;
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

  /** Conversación en curso: la cámara se acerca y ambos se miran. */
  converse(id: string | null): void {
    this.converseId = id;
    const e = id ? this.ents.get(id) : undefined;
    if (e) e.react = { action: 'talk', until: performance.now() + 2600 };
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

  /** Vecinos visibles a menos de `radius` teselas del jugador. */
  folkNear(radius: number): string[] {
    const me = ensureLife(this.w).player;
    const out: string[] = [];
    for (const [id, e] of this.ents) if (!e.inside && Math.hypot(e.x - me.x, e.y - me.y) <= radius) out.push(id);
    return out;
  }

  /** Alguien viene hacia ti por su cuenta (para hablarte). */
  summonId: string | null = null;
  summon(id: string | null): void {
    this.summonId = id;
  }

  distanceTo(id: string): number {
    const e = this.ents.get(id);
    const me = ensureLife(this.w).player;
    return e && !e.inside ? Math.hypot(e.x - me.x, e.y - me.y) : Infinity;
  }

  folkPosition(id: string): { x: number; y: number } | undefined {
    const e = this.ents.get(id);
    return e && !e.inside ? { x: e.x, y: e.y } : undefined;
  }

  // -------------------------------------------------------------------------
  // Entrada: joystick virtual, tocar para caminar, pellizcar para zoom.
  // -------------------------------------------------------------------------
  private resize(): void {
    this.dpr = Math.min(VQ().dpr, window.devicePixelRatio || 1);
    const r = this.parent.getBoundingClientRect();
    this.vw = r.width;
    this.vh = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.dark.width = Math.max(1, Math.ceil(r.width / 2));
    this.dark.height = Math.max(1, Math.ceil(r.height / 2));
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
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.userZ };
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
        this.userZ = Math.max(0.55, Math.min(2.2, this.pinch.z * (d / Math.max(1, this.pinch.d))));
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
        // Un toque corto en la zona del joystick sigue siendo un toque.
        if (p && Math.hypot(p.x - p.sx, p.y - p.sy) < 12 && performance.now() - p.t < 350 && !this.pointers.size) this.tap(e.clientX, e.clientY);
        return;
      }
      if (!p || this.pointers.size) return;
      const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
      if (moved < 12 && performance.now() - p.t < 350) this.tap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userZ = Math.max(0.55, Math.min(2.2, this.userZ * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    }, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
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
    this.tapMark = { x: p.x, y: p.y, t: performance.now() };
    this.walkTo(p.x, p.y);
  }

  // -------------------------------------------------------------------------
  // Actualización
  // -------------------------------------------------------------------------
  private update(dt: number): void {
    const w = this.w;
    const life = ensureLife(w);
    this.cb.advance((dt / SECONDS_PER_MINUTE) * this.timeScale);
    this.movePlayer(this.realDt || dt);
    const me = life.player;

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
    this.moveExtras(dt);
    this.moveAnimals(dt);
    this.moveBirds(dt);
    this.socialAcc += dt;
    if (this.socialAcc > 0.3) {
      this.socialAcc = 0;
      this.social();
    }
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

  /** Hacia dónde y cuánto mira la cámara: suave, más cerca junto a la gente. */
  private zoomTarget(): { x: number; y: number; z: number } {
    const me = ensureLife(this.w).player;
    const conv = this.converseId ? this.ents.get(this.converseId) : undefined;
    if (conv && !conv.inside) {
      // La hoja del diálogo tapa la mitad inferior: la pareja se encuadra arriba.
      const z = Math.min(5, ZOOM.talk * Math.max(0.85, this.userZ));
      return { x: ((me.x + conv.x) / 2) * TILE, y: ((me.y + conv.y) / 2) * TILE - 16 + (this.vh * 0.2) / z, z };
    }
    const near = this.focus?.kind === 'folk' || this.focus?.kind === 'encounter' || this.focus?.kind === 'messenger';
    // La cámara mira un poco hacia donde se camina (más al correr) y solo se acerca a quien está al lado tras un rato quieto.
    const look = this.reduceMotion ? 0 : 1;
    const cine = this.cineAmount();
    if (cine > 0 && this.cine) {
      const cx = (this.cine.x ?? me.x) * TILE;
      const cy = (this.cine.y ?? me.y) * TILE - 14;
      return { x: cx, y: cy, z: Math.min(4.6, ZOOM.explore * this.userZ * (1 + (this.cine.z - 1) * cine)) };
    }
    return {
      x: (me.x + this.lookAhead.x * look) * TILE,
      y: (me.y + this.lookAhead.y * look * 0.8) * TILE - 10,
      z: Math.max(1, Math.min(4.5, (near && this.stillT > 1.4 ? ZOOM.near : ZOOM.explore) * this.userZ)),
    };
  }

  private updateCamera(dt: number): void {
    // La anticipación sigue a la velocidad con retraso (≈0,5 s): al dar media vuelta no salta.
    const kl = 1 - Math.exp(-dt * 2);
    this.lookAhead.x += (this.vel.x * 0.38 - this.lookAhead.x) * kl;
    this.lookAhead.y += (this.vel.y * 0.38 - this.lookAhead.y) * kl;
    const tg = this.zoomTarget();
    // Suavizado exponencial (igual a 30 que a 120 fps) con una zona muerta pequeña.
    const k = 1 - Math.exp(-dt * 5.5);
    const ex = tg.x - this.cam.x;
    const ey = tg.y - this.cam.y;
    const dead = 3;
    const ed = Math.hypot(ex, ey);
    if (ed > dead) {
      const f = (ed - dead) / ed;
      this.cam.x += ex * f * k;
      this.cam.y += ey * f * k;
    }
    const zk = 1 - Math.exp(-dt * (this.pinch ? 14 : this.converseId ? 3 : 1.4));
    // Curva suave: el zoom empieza y termina despacio.
    const dz = tg.z - this.cam.z;
    this.cam.z += dz * zk * Math.min(1, 0.35 + Math.abs(dz) * 1.2);
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
        // Analógico: cuanto más se aleja el dedo, más rápido; muy lejos, se corre.
        const amt = Math.min(1, 0.35 + (len - 8) / 40);
        dx = (jx / len) * amt;
        dy = (jy / len) * amt;
        // Se corre al llevar el dedo al anillo exterior (con histéresis: no parpadea en el borde).
        this.joyRun = this.joyRun ? len > 42 : len > 50;
        if (this.joyRun) run = true;
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
    const want = !!(dx || dy);
    const tile = this.l.terrain.tiles[idx(Math.floor(me.x), Math.floor(me.y))];
    // Escala humana: una persona mide ~1,9 teselas; andar ≈ 1,6 pasos dobles por segundo.
    const top = (run ? 6.4 : 3.2) * speedOf(tile) * this.speed();
    // Inercia: arranca en ~0,12 s y frena en ~0,08 s.
    const kv = 1 - Math.exp(-dt * (want ? 20 : 34));
    this.vel.x += (dx * top - this.vel.x) * kv;
    this.vel.y += (dy * top - this.vel.y) * kv;
    const v = Math.hypot(this.vel.x, this.vel.y);
    if (!want && v < 0.25) (this.vel.x = 0), (this.vel.y = 0);
    this.playerMoving = want || v > 0.6;
    this.playerRun = run && v > 5;
    this.stillT = this.playerMoving ? 0 : this.stillT + dt;
    if (!this.playerMoving && v === 0) return;
    if (want) this.facing = { x: dx, y: dy };
    const nx = me.x + this.vel.x * dt;
    const ny = me.y + this.vel.y * dt;
    const ox = me.x;
    const oy = me.y;
    const ok = (x: number, y: number) => passable(this.w, this.l, x, y);
    if (ok(nx, ny)) (me.x = nx), (me.y = ny);
    else if (ok(nx, me.y)) me.x = nx;
    else if (ok(me.x, ny)) me.y = ny;
    else if (this.path.length) {
      // Atascado: si ya está al lado de lo que buscaba, cuenta como llegar.
      this.path.shift();
      const t = this.pending;
      const at = t && !this.path.length ? this.targetPos(t) : undefined;
      this.pending = this.path.length ? this.pending : null;
      if (t && at && Math.hypot(at.x - me.x, at.y - me.y) < 2.5) this.cb.onArrive(t);
    }
    // El paso sigue al avance real (contra una pared no se camina en el sitio) y a la
    // zancada de este cuerpo: los pies no patinan.
    const moved = Math.hypot(me.x - ox, me.y - oy);
    const pap = this.apCache.get('@player')?.ap;
    this.playerAnim += (moved / strideOf(pap, this.playerRun)) * Math.PI;
    if (moved < 0.002 && !want) this.playerMoving = false;
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
        e = { x: t.x, y: t.y, path: [], tx: t.x, ty: t.y, inside: t.inside, frame: 0, flip: hash(f.id, 2) < 0.5, moving: false, anim: hash(f.id) * 10, dx: 0, dy: 1, act: t.activity, facing: 'front' };
        this.ents.set(f.id, e);
        continue;
      }
      e.act = t.activity;
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
    this.updateExtras();
  }

  /** Las ciudades grandes tienen gentío: figurantes que pasean por la plaza. */
  private updateExtras(): void {
    const w = this.w;
    const me = ensureLife(w).player;
    const keep = new Set<string>();
    const h = hourOf(ensureLife(w).clock);
    const weather = this.weatherHere();
    const out = h < 7 || h > 21 || weather === 'lluvia' || weather === 'tormenta';
    for (const v of this.l.villages) {
      const r = w.regions[v.regionId];
      if (out || this.low || r.abandoned || r.population < 800 || Math.hypot(v.cx - me.x, v.cy - me.y) > 44) continue;
      const n = Math.min(VQ().crowd, Math.floor((r.population - 600) / 110) * (r.flags.hambre || r.flags.guerra ? 0.5 : 1));
      for (let i = 0; i < n; i++) {
        const id = `x:${v.regionId}:${i}`;
        keep.add(id);
        if (this.extras.has(id)) continue;
        const p = this.plazaPoint(v.regionId, hash(id), hash(id, 1));
        this.extras.set(id, { ...p, path: [], tx: p.x, ty: p.y, inside: false, frame: 0, flip: false, moving: false, anim: i, dx: 0, dy: 1, act: 'pasea', facing: 'front', regionId: v.regionId, wait: hash(id, 3) * 6 });
      }
    }
    for (const id of [...this.extras.keys()]) if (!keep.has(id)) this.extras.delete(id);
  }

  private plazaPoint(regionId: number, a: number, b: number): { x: number; y: number } {
    const v = this.l.villages[regionId];
    const ang = a * Math.PI * 2;
    const d = 2.4 + b * (v.plazaR - 2.8);
    return { x: v.cx + 0.5 + Math.cos(ang) * d, y: v.cy + 0.5 + Math.sin(ang) * d };
  }

  private moveExtras(dt: number): void {
    for (const [id, e] of this.extras) {
      if (!e.path.length) {
        e.moving = false;
        e.wait -= dt;
        if (e.wait <= 0) {
          const p = this.plazaPoint(e.regionId, Math.random(), Math.random());
          e.path = [p];
          e.wait = 3 + Math.random() * 9;
          e.act = Math.random() < 0.4 ? 'charla' : 'pasea';
        }
        continue;
      }
      this.step(e, dt, 1.9 + hash(id) * 0.6);
    }
  }

  /** Avanza una entidad por su camino. */
  private step(e: Ent, dt: number, speed: number): void {
    const n = e.path[0];
    const d = Math.hypot(n.x - e.x, n.y - e.y);
    if (d < 0.2) {
      e.path.shift();
      return;
    }
    const sp = Math.min(d, speed * dt * this.timeScale ** 0.5);
    e.dx = (n.x - e.x) / d;
    e.dy = (n.y - e.y) / d;
    e.x += e.dx * sp;
    e.y += e.dy * sp;
    e.flip = e.dx < 0;
    e.moving = true;
    e.inside = false;
    e.anim += (sp / (e.stride ?? 0.9)) * Math.PI;
  }

  /**
   * Vida social a la vista: quien charla busca a alguien con quien hablar y
   * se miran; quien ve llegar al jugador se gira hacia él, le saluda si le
   * aprecia o se sorprende si no le conoce.
   */
  private social(): void {
    const life = ensureLife(this.w);
    const me = life.player;
    const now = performance.now();
    const all: [string, Ent][] = [...this.ents, ...this.extras];
    for (const [id, e] of all) {
      e.partner = undefined;
      if (e.moving || e.inside) continue;
      const f = this.folkById.get(id);
      const dme = Math.hypot(me.x - e.x, me.y - e.y);
      if (f && (dme < 2.8 || id === this.converseId)) {
        this.faceTo(e, me.x, me.y);
        if (!e.greeted) {
          e.greeted = true;
          if (f.lastMet < 0) e.react = { expr: 'sorpresa', until: now + 1400 };
          else if (f.trust > 0.6 || f.gratitude > 0.45) e.react = { expr: 'feliz', action: 'wave', until: now + 1700 };
          else if (f.resentment > 0.45) e.react = { expr: 'hostil', action: 'cross', until: now + 2200 };
        }
        continue;
      }
      if (dme > 4) e.greeted = false;
      const act = actionOf(e.act);
      if (act === 'talk' || /charla|pasea/.test(e.act)) {
        let best: [string, Ent] | null = null;
        let bd = 2.2;
        for (const [oid, o] of all) {
          if (oid === id || o.moving || o.inside) continue;
          const d = Math.hypot(o.x - e.x, o.y - e.y);
          if (d < bd) (bd = d), (best = [oid, o]);
        }
        if (best) {
          e.partner = best[0];
          this.faceTo(e, best[1].x, best[1].y);
        }
      } else if (act === 'work' || act === 'hammer' || act === 'fish') {
        e.facing = 'side';
      } else e.facing = 'front';
    }
  }

  private faceTo(e: Ent, x: number, y: number): void {
    const dx = x - e.x;
    const dy = y - e.y;
    if (Math.abs(dx) > 0.45 || Math.abs(dx) > Math.abs(dy) * 0.8) {
      e.facing = 'side';
      e.flip = dx < 0;
    } else e.facing = dy < 0 ? 'back' : 'front';
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
    if (f.id === this.summonId) {
      const me = ensureLife(this.w).player;
      return { x: me.x + 0.9, y: me.y + 0.2, inside: false, activity: 'se acerca a ti' };
    }
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
      this.step(e, dt, 2.3);
    }
  }

  private moveBirds(dt: number): void {
    const h = hourOf(ensureLife(this.w).clock);
    const weather = this.weatherHere();
    const want = this.reduceMotion || this.low || h < 6.5 || h > 20 || weather === 'lluvia' || weather === 'tormenta' || weather === 'nieve' ? 0 : 7;
    const vw = this.vw / this.cam.z;
    const vh = this.vh / this.cam.z;
    this.birds = this.birds.filter((b) => Math.abs(b.x - this.cam.x) < vw && Math.abs(b.y - this.cam.y) < vh);
    if (this.birds.length < want && Math.random() < dt * 0.4) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y0 = this.cam.y - vh * 0.4 + Math.random() * vh * 0.5;
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) this.birds.push({ x: this.cam.x - dir * (vw * 0.55 + i * 14), y: y0 + (i % 2) * 9 + i * 4, vx: dir * (55 + Math.random() * 10), ph: Math.random() * 6 });
    }
    for (const b of this.birds) {
      b.x += b.vx * dt;
      b.y += Math.sin(b.ph + b.x / 60) * 0.2;
      b.ph += dt * 11;
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
          if (Math.random() < dt * (a.kind === 'perro' ? 0.8 : 0.3)) {
            const R = a.kind === 'perro' ? 14 : a.kind === 'caballo' ? 4 : a.water ? 3 : 8;
            a.tx = a.hx + (Math.random() - 0.5) * R;
            a.ty = a.hy + (Math.random() - 0.5) * R * 0.75;
            const tt = this.l.terrain.tiles[idx(Math.floor(a.tx), Math.floor(a.ty))];
            const ok = a.water ? tt === 2 || tt === 1 || tt === 10 : passable(this.w, this.l, a.tx, a.ty);
            if (!ok) (a.tx = a.x), (a.ty = a.y);
          }
          continue;
        }
        const sp = Math.min(d, ({ ciervo: 1.6, perro: 2.2, caballo: 0.8, pato: 0.5 } as Record<string, number>)[a.kind] ?? 0.7) * dt;
        const nx = a.x + ((a.tx - a.x) / d) * sp;
        const ny = a.y + ((a.ty - a.y) / d) * sp;
        // Los animales no atraviesan vallas, fuentes ni casas: si el paso está cortado, se paran.
        if (!a.water && !passable(this.w, this.l, nx, ny)) {
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
      if (passable(w, this.l, x, y)) out.push({ kind: 'perro', x, y, hx: v.cx + 0.5, hy: v.cy + 0.5, tx: x, ty: y, flip: false, anim: i, v: i });
    }
    // Patos donde hay agua cerca.
    for (let k = 0; k < 40; k++) {
      const x = v.cx + 0.5 + (hash(`${regionId}pato`, k) - 0.5) * 50;
      const y = v.cy + 0.5 + (hash(`${regionId}pato`, k + 99) - 0.5) * 50;
      const tt = this.l.terrain.tiles[idx(Math.floor(x), Math.floor(y))];
      if (tt !== 2 && tt !== 10) continue;
      for (let i = 0; i < 3; i++) out.push({ kind: 'pato', x: x + i * 0.4, y: y + (i % 2) * 0.3, hx: x, hy: y, tx: x, ty: y, flip: i % 2 === 0, anim: i, water: true, v: i });
      break;
    }
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
      case 'settlement': {
        const st = life.atlas?.settlements.find((x) => x.id === t.id);
        return st ? { x: st.x + 0.5, y: st.y + 2 } : undefined;
      }
      case 'poi': {
        const p = life.atlas?.pois.find((x) => x.id === t.id);
        return p ? { x: p.x + 0.5, y: p.y + 0.5 } : undefined;
      }
      case 'encounter': {
        const e = life.encounters.find((x) => x.id === t.id);
        return e ? { x: e.x, y: e.y } : undefined;
      }
      case 'messenger':
        return this.messengers().find((m) => m.id === t.petitionId);
      case 'signpost':
        return this.l.villages[t.regionId].sign;
      case 'item':
        return prologueItems(w).find((x) => x.id === t.id);
      case 'convoy':
        return convoyPositions(w).find((x) => x.c.id === t.id);
    }
  }

  private messengers(): { id: string; x: number; y: number; regionId: number }[] {
    const w = this.w;
    const v = this.l.villages[w.player.home];
    const hall = v.keys.find((k) => k.kind === 'salon');
    if (!hall) return [];
    const d = doorOf(hall);
    return w.petitions.slice(0, 4).map((p, i) => ({ id: p.id, x: d.x - 2.4 + i * 1.6, y: d.y + 1.8, regionId: p.regionId }));
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
      if (f) consider({ kind: 'folk', id, label: f.name }, e.x, e.y - 1);
    }
    for (const m of this.messengers()) consider({ kind: 'messenger', petitionId: m.id, label: `Mensajero de ${w.regions[m.regionId].name}` }, m.x, m.y - 1);
    for (const v of this.l.villages) {
      if (Math.hypot(v.cx - x, v.cy - y) > 40) continue;
      for (const b of v.keys) {
        if (!this.buildingExists(v.regionId, b.kind)) continue;
        const d = doorOf(b);
        const id = life.identity;
        const label = b.kind === 'hogar' && id?.mode === 'forastero' && !id.housed ? 'Casa vacía' : BUILDING_LABEL[b.kind];
        consider({ kind: 'building', regionId: v.regionId, building: b.kind, label }, d.x, d.y, radius * 0.9);
      }
      consider({ kind: 'signpost', regionId: v.regionId, label: 'Cruce de caminos' }, v.sign.x + 1.2, v.sign.y, radius * 0.8);
    }
    this.l.posts.forEach((p, i) => consider({ kind: 'post', index: i, label: 'Puesto fronterizo' }, p.x, p.y, radius * 1.3));
    for (const cv of convoyPositions(w)) consider({ kind: 'convoy', id: cv.c.id, label: cv.c.status === 'atacada' ? 'Una carreta volcada' : cv.c.kind === 'jugador' ? 'Tu carreta' : `Caravana de ${cv.c.ownerName}` }, cv.x, cv.y, radius * 1.4);
    for (const it of prologueItems(w)) if (it.label) consider({ kind: 'item', id: it.id, label: it.label }, it.x, it.y, radius * 1.1);
    for (const p of this.l.places) if (life.places[p.id]?.discovered) consider({ kind: 'place', id: p.id, label: p.name }, p.x + 0.5, p.y + 0.5, radius * 1.3);
    // Lo que la historia ha levantado (o tirado): asentamientos, ruinas, monumentos, cuevas…
    if (life.atlas) {
      for (const st of life.atlas.settlements) consider({ kind: 'settlement', id: st.id, label: st.state === 'vivo' ? st.name : st.state === 'ruinas' ? `Ruinas de ${st.name}` : `${st.name} (abandonado)` }, st.x + 0.5, st.y + 2, radius * 1.6);
      for (const p of life.atlas.pois) consider({ kind: 'poi', id: p.id, label: p.found !== undefined ? p.name : '¿Qué es eso?' }, p.x + 0.5, p.y + 0.5, radius * 1.3);
    }
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
    // El mundo se dibuja directamente a la resolución de la pantalla, con
    // suavizado: las texturas pintadas se ven nítidas a cualquier zoom.
    nextFrame();
    const dz = this.dpr * z;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2f5468';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dz, 0, 0, dz, this.dpr * (this.vw / 2 - this.cam.x * z), this.dpr * (this.vh / 2 - this.cam.y * z));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    this.sun = sunAt(hourOf(life.clock), this.weatherHere());
    this.shadowQ = [];
    const x0 = this.cam.x - this.vw / 2 / z;
    const y0 = this.cam.y - this.vh / 2 / z;
    const x1 = this.cam.x + this.vw / 2 / z;
    const y1 = this.cam.y + this.vh / 2 / z;
    const season = seasonOf(w.day);
    const weather = this.weatherHere();
    this.wxFrame = weather;
    const look = (season === 'invierno' || weather === 'nieve' ? 'invierno' : season) as S.SeasonLook;
    // Dónde nieva ahora (el suelo se cubre por regiones).
    // (una vez por segundo basta: el tiempo de cada región cambia por horas)
    if (t - this.snowCheck > 1000 || this.snowWeather !== weather) {
      this.snowCheck = t;
      this.snowWeather = weather;
      const snowNow = this.chunks.snowing;
      snowNow.clear();
      const pr = playerRegion(w);
      w.regions.forEach((_, i) => {
        if ((i === pr ? weather : weatherIn(w, i)) === 'nieve') snowNow.add(i);
      });
    }
    const stateKey = this.chunks.stateKey(season);
    const CPX = CHUNK * TILE;
    const cx0 = Math.max(0, Math.floor(x0 / CPX));
    const cy0 = Math.max(0, Math.floor(y0 / CPX));
    const cx1 = Math.floor(x1 / CPX);
    const cy1 = Math.floor(y1 / CPX);
    // Caben los fragmentos visibles y un anillo alrededor (nunca se desaloja uno que se ve).
    this.chunks.capacity = (cx1 - cx0 + 3) * (cy1 - cy0 + 3) + 1;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) g.drawImage(this.chunks.get(cx, cy, season, stateKey), cx * CPX - PAD, cy * CPX - PAD, CPX + PAD * 2, CPX + PAD * 2);
    // Si este fotograma no ha tenido que pintar suelo, se adelanta un vecino (hacia donde se camina).
    if (this.chunks.paints === this.paintsSeen) this.chunks.prewarm(Math.floor(this.cam.x / CPX), Math.floor(this.cam.y / CPX), Math.sign(this.vel.x), Math.sign(this.vel.y), season, stateKey);
    this.paintsSeen = this.chunks.paints;

    // Suelo mojado: más oscuro, con charcos que reflejan y ondas de lluvia.
    if (weather === 'lluvia' || weather === 'tormenta') this.drawWet(g, x0, y0, x1, y1, t, weather === 'tormenta');
    const items: Drawable[] = [];
    const reg0 = playerRegion(w);
    const snowyHere = reg0 >= 0 && this.chunks.snowyRegion(reg0, season);
    this.lights = [];
    this.folkById.clear();
    for (const f of life.folk) if (f.alive) this.folkById.set(f.id, f);
    const wet = weather === 'lluvia' || weather === 'tormenta';
    const cold = weather === 'nieve' || season === 'invierno';
    const sec = t / 1000;
    const inView = (px: number, py: number, m = 60) => px > x0 - m && px < x1 + m && py > y0 - m && py < y1 + m * 1.5;

    // Objetos estáticos del terreno.
    for (let cy = Math.max(0, Math.floor((y0 - 40) / CPX)); cy <= Math.floor((y1 + 60) / CPX); cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        for (const o of this.chunks.objectsOf(cx, cy)) {
          if (!inView(o.x, o.y)) continue;
          this.drawStatic(o, look, t, snowyHere, items);
        }

    // Pueblos.
    for (const v of this.l.villages) {
      if (!inView(v.cx * TILE, v.cy * TILE, 34 * TILE)) continue;
      this.villageDrawables(v.regionId, items, inView, t, cold);
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
    // Asentamientos y lugares con historia (Fase 6).
    if (life.atlas) this.atlasDrawables(life.atlas, items, inView);
    // Lo que dejó el prólogo por el mundo: la cabaña, la mochila, la caja.
    for (const it of prologueItems(w)) {
      if (!inView(it.x * TILE, it.y * TILE)) continue;
      if (it.id === 'cabana') {
        const st = this.styleOf(w.player.home);
        const ct = houseTex(st, 'abandonada', 1, 4, 0.2);
        items.push({ y: (it.y + 1) * TILE, draw: () => put(g, ct, it.x * TILE, (it.y + 1) * TILE) });
      } else items.push({ y: it.y * TILE, draw: () => S.drawSprite(g, S.prologueProp(it.id as 'mochila'), it.x * TILE, it.y * TILE) });
    }
    // Caminantes de los caminos: caravanas, refugiados, soldados en marcha, viajeros.
    this.roadTraffic(items, inView, t);
    // Vecinos: figura completa cerca, simplificada a media distancia, silueta lejos.
    for (const [id, e] of this.ents) {
      if (e.inside || !inView(e.x * TILE, e.y * TILE)) continue;
      const f = this.folkById.get(id);
      if (!f) continue;
      const ap = this.dress(this.apOf(f), wet, cold);
      e.stride = strideOf(ap, false);
      const pose = this.entPose(id, e, f, sec, wet, cold);
      this.pushPerson(items, ap, pose, e.x * TILE, e.y * TILE);
    }
    // Gentío de las ciudades grandes.
    for (const [id, e] of this.extras) {
      if (!inView(e.x * TILE, e.y * TILE)) continue;
      const roles: FolkRole[] = ['campesino', 'comerciante', 'artesano', 'campesino', 'anciano', 'nino', 'pastor', 'comerciante'];
      const ap = this.dress(this.extraAp(id, e.regionId, roles[Math.floor(hash(id, 4) * roles.length)], 14 + Math.floor(hash(id, 5) * 50)), wet, cold);
      e.stride = strideOf(ap, false);
      const pose = this.entPose(id, e, undefined, sec, wet, cold);
      this.pushPerson(items, ap, pose, e.x * TILE, e.y * TILE);
    }
    // Mensajeros esperando ante tu salón.
    for (const m of this.messengers()) {
      const ap = this.extraAp(`m:${m.id}`, m.regionId, 'exploradora', 30, (a) => (a.outfit.item = 'saco'));
      const pose: Pose = { facing: 'front', flip: false, phase: 0, action: Math.floor(sec / 3 + m.x) % 3 === 0 ? 'look' : 'idle', t: sec + m.x, expr: 'preocupado', lod: this.lodAt(m.x, m.y), hood: wet || cold, heavy: cold };
      this.pushPerson(items, ap, pose, m.x * TILE, m.y * TILE);
    }
    // Animales.
    for (const list of this.animals.values())
      for (const a of list) {
        if (!inView(a.x * TILE, a.y * TILE)) continue;
        const moving = Math.hypot(a.tx - a.x, a.ty - a.y) > 0.2;
        items.push({ y: a.y * TILE + (a.water ? -2 : 0), draw: () => put(g, animalTex(a.kind, moving ? Math.floor(a.anim) % 4 : 0, a.v), a.x * TILE, a.y * TILE, a.flip) });
      }
    // Jugador.
    const me = life.player;
    const pap = this.dress(this.playerAp(darkness(life.clock) > 0.3), wet, cold);
    const ppose = this.playerPose(sec, wet, cold);
    this.pushPerson(items, pap, ppose, me.x * TILE, me.y * TILE);
    if (darkness(life.clock) > 0.3) this.lights.push({ x: me.x * TILE + (ppose.flip ? -10 : 10), y: me.y * TILE - 14, r: 72, k: 1 });

    // Las sombras van antes que todo lo que se alza sobre el suelo.
    for (const sh of this.shadowQ) sh();
    items.sort((a, b) => a.y - b.y);
    this.playerHidden = false;
    for (const it of items) it.draw();
    // Si el follaje tapa al protagonista, se le sigue viendo en transparencia (no se pierde nunca).
    if (this.playerHidden) {
      g.save();
      g.globalAlpha = 0.5;
      drawFigure(g, pap, ppose, me.x * TILE, me.y * TILE);
      g.restore();
    }

    this.drawParticles(g, t);
    this.drawBirds(g);
    this.drawMarkers(g, t);
    // Lluvia, nieve y viento, en coordenadas de pantalla.
    {
      const dt = this.lastDraw ? Math.min(0.1, (t - this.lastDraw) / 1000) : 1 / 60;
      this.lastDraw = t;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // Las partículas se desplazan con el mundo cuando se mueve la cámara.
      const cdx = (this.lastCam.x - this.cam.x) * z;
      const cdy = (this.lastCam.y - this.cam.y) * z;
      this.lastCam = { x: this.cam.x, y: this.cam.y };
      this.wfx.draw(g, weather, this.vw, this.vh, t, this.paused && !this.converseId ? 0 : dt, this.reduceMotion, Math.abs(cdx) < 50 ? cdx : 0, Math.abs(cdy) < 50 ? cdy : 0);
    }
    const sg = this.screen;
    this.drawScreen(sg, t, weather, life);
  }

  /** Capa de pantalla: luz del día, noche, clima, joystick, etiquetas. */
  private drawScreen(g: CanvasRenderingContext2D, t: number, weather: string, life: ReturnType<typeof ensureLife>): void {
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawGrade(g, hourOf(life.clock), weather);
    this.drawNight(g, weather);
    this.drawLabels(g);
    this.drawEdgeArrows(g, t);
    const cine = this.cineAmount();
    if (cine > 0) {
      // Franjas de cine (2,35:1 aproximado) que entran y salen.
      const bar = this.vh * 0.11 * cine;
      g.fillStyle = '#0b0806';
      g.fillRect(0, 0, this.vw, bar);
      g.fillRect(0, this.vh - bar, this.vw, bar);
    }
    if (this.joy) {
      g.fillStyle = 'rgba(243,232,207,0.18)';
      g.strokeStyle = 'rgba(243,232,207,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.joy.bx, this.joy.by, 56, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      // Anillo interior: dentro se camina; al cruzarlo, se corre (se ilumina).
      g.strokeStyle = this.joyRun ? 'rgba(231,199,126,0.95)' : 'rgba(243,232,207,0.28)';
      g.lineWidth = this.joyRun ? 3 : 1.5;
      g.setLineDash([4, 5]);
      g.beginPath();
      g.arc(this.joy.bx, this.joy.by, 46, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
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

  /** Lluvia en el suelo: oscurece la tierra y pinta charcos con reflejo y ondas en caminos y plazas. */
  private drawWet(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, t: number, storm: boolean): void {
    // El suelo empapado se oscurece (antes de las sombras y las figuras).
    g.fillStyle = storm ? 'rgba(14,20,32,0.3)' : 'rgba(18,26,40,0.24)';
    g.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    const tiles = this.l.terrain.tiles;
    for (let ty = Math.floor(y0 / TILE); ty <= Math.ceil(y1 / TILE); ty++)
      for (let tx = Math.floor(x0 / TILE); tx <= Math.ceil(x1 / TILE); tx++) {
        const tt = tiles[idx(Math.max(0, tx), Math.max(0, ty))];
        if (tt !== T.Road && tt !== T.Plaza && tt !== T.Clay) continue;
        const h2 = Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663);
        const hh = ((Math.imul(h2 ^ (h2 >>> 13), 1274126177) >>> 0) % 1000) / 1000;
        if (hh > 0.09) continue;
        const cx = tx * TILE + 3 + ((hh * 7919) % 1) * 10;
        const cy = ty * TILE + 4 + ((hh * 104729) % 1) * 8;
        const rx = 4 + ((hh * 31) % 1) * 7;
        // Charco sin contorno: forma irregular (dos óvalos), oscuro por dentro y
        // con el cielo reflejado en una franja; un brillo fino en el borde.
        g.fillStyle = 'rgba(40,52,70,0.42)';
        g.beginPath();
        g.ellipse(cx, cy, rx, rx * 0.34, 0, 0, Math.PI * 2);
        g.ellipse(cx + rx * 0.45, cy + rx * 0.1, rx * 0.6, rx * 0.26, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(176,192,214,0.32)';
        g.beginPath();
        g.ellipse(cx - rx * 0.1, cy - rx * 0.06, rx * 0.7, rx * 0.12, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(230,238,250,0.35)';
        g.lineWidth = 0.4;
        g.beginPath();
        g.ellipse(cx, cy, rx * 0.95, rx * 0.32, 0, Math.PI * 1.1, Math.PI * 1.6);
        g.stroke();
        if (this.reduceMotion) continue;
        // Ondas: anillos que nacen y se abren.
        for (let k = 0; k < 2; k++) {
          const ph = ((t / 900 + hh * 7 + k * 0.5) % 1);
          g.strokeStyle = `rgba(220,232,245,${(0.5 * (1 - ph)).toFixed(3)})`;
          g.lineWidth = 0.35;
          g.beginPath();
          g.ellipse(cx + (k - 0.5) * rx * 0.5, cy, 0.5 + ph * rx * 0.4, (0.5 + ph * rx * 0.4) * 0.36, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
  }

  /** Árboles, matorrales, hierba alta, flores, juncos y rocas (pintados), con su sombra. */
  private drawStatic(o: StaticObject, look: S.SeasonLook, t: number, snowy: boolean, items: Drawable[]): void {
    const g = this.g;
    const r = o.region >= 0 ? this.w.regions[o.region] : undefined;
    const sec = t / 1000;
    const wind = this.wxFrame === 'viento' || this.wxFrame === 'tormenta' ? 1 : 0.2;
    switch (o.kind) {
      case 'arbol': {
        let kind: TreeKind = (o.tree ?? 'roble') as TreeKind;
        // Un ecosistema degradado deja árboles muertos.
        if (r && r.ecology < 0.42 && o.v % 3 !== 0) kind = 'muerto';
        const sun = this.sun;
        this.shadowQ.push(() => drawTreeShadow(g, kind, look, o.v, o.x, o.y, sun, snowy));
        const me = ensureLife(this.w).player;
        const focus = { x: me.x * TILE, y: me.y * TILE };
        items.push({ y: o.y, draw: () => void (drawTree(g, kind, look, o.v, o.x, o.y, sec, wind, snowy, focus) && (this.playerHidden = true)) });
        break;
      }
      case 'arbusto':
      case 'junco':
      case 'hierba':
      case 'flores':
      case 'roca':
        // En los niveles bajos se pinta menos hierba alta y flores (las rocas, siempre).
        if (o.kind !== 'roca' && ((o.v * 2654435761) >>> 0) % 1000 > VQ().grass * 1000) break;
        items.push({ y: o.y, draw: () => drawSmall(g, o.kind as SmallKind, look, o.v, o.x, o.y, sec, snowy) });
        break;
      case 'pico':
        items.push({ y: o.y, draw: () => S.drawSprite(g, S.peak(o.v), o.x, o.y) });
        break;
      case 'mojon':
        items.push({ y: o.y, draw: () => S.drawSprite(g, S.boundaryStone(), o.x, o.y) });
        break;
    }
  }

  private hueOf(regionId: number): number {
    const r = this.w.regions[regionId];
    return (r.isHome ? PLAYER_CULTURE : CULTURES.find((c) => c.id === r.culture) ?? PLAYER_CULTURE).hue;
  }

  /** Asentamientos que nacen y mueren, ruinas, monumentos, cuevas, pecios… en el mundo físico. */
  private atlasDrawables(a: NonNullable<ReturnType<typeof ensureLife>['atlas']>, items: Drawable[], inView: (x: number, y: number, m?: number) => boolean): void {
    const g = this.g;
    for (const st of a.settlements) {
      if (!inView(st.x * TILE, st.y * TILE, 12 * TILE)) continue;
      const style = this.styleOf(st.regionId);
      const n = st.state === 'ruinas' ? 3 : { campamento: 3, aldea: 4, pueblo: 6, ciudad: 8, metropolis: 10 }[st.tier];
      for (let i = 0; i < n; i++) {
        // Las casas en corro alrededor del centro (siempre en el mismo sitio).
        const ang = (i / n) * Math.PI * 2 + hash(st.id, i) * 0.5;
        const rad = 3 + (i % 2) * 2.5 + n * 0.2;
        const tx = st.x + Math.cos(ang) * rad * 1.4;
        const ty = st.y + Math.sin(ang) * rad;
        // Solo se construye en tierra firme y libre (nunca sobre el agua ni encima de otra cosa).
        const k = idx(Math.floor(tx), Math.floor(ty));
        if (!walkable(this.l.terrain.tiles[k]) || this.l.blocked[k]) continue;
        const hx = tx * TILE;
        const hy = ty * TILE;
        if (st.state === 'ruinas' || (st.tier === 'campamento' && st.state === 'vivo')) {
          if (st.state === 'ruinas') {
            const spr = S.placeSprite('ruinas');
            items.push({ y: hy, draw: () => S.drawSprite(g, spr, hx, hy) });
          } else {
            const tt = tentTex(style.roof);
            items.push({ y: hy, draw: () => put(g, tt, hx, hy) });
          }
        } else {
          const ht = houseTex(style, st.state === 'abandonado' ? 'abandonada' : 'normal', Math.floor(hash(st.id, i + 9) * 3), 3 + (i % 2), 0.4);
          items.push({ y: hy, draw: () => put(g, ht, hx, hy) });
        }
      }
      if (st.state === 'vivo' && st.tier !== 'campamento') items.push({ y: (st.y + 0.5) * TILE, draw: () => put(g, propTex('pozo'), st.x * TILE, (st.y + 0.5) * TILE) });
    }
    for (const p of a.pois) {
      if (!inView(p.x * TILE, p.y * TILE)) continue;
      const kind = { ruinas: p.clue === 'antiguos' ? 'templo' : 'ruinas', monumento: 'circulo', batalla: 'campamento', cueva: 'cueva', oasis: 'bosque', pecio: 'abandonada', cantera: 'mina' }[p.kind];
      items.push({ y: p.y * TILE + 16, draw: () => S.drawSprite(g, S.placeSprite(kind), p.x * TILE + 8, p.y * TILE + 16) });
    }
  }

  private styleOf(regionId: number): S.Style {
    const r = this.w.regions[regionId];
    return S.styleFor(r.isHome ? 'eco' : r.culture, this.hueOf(regionId));
  }

  private villageDrawables(regionId: number, items: Drawable[], inView: (x: number, y: number, m?: number) => boolean, t: number, cold: boolean): void {
    const w = this.w;
    const g = this.g;
    const life = ensureLife(w);
    const v = this.l.villages[regionId];
    const r = w.regions[regionId];
    const town = life.towns[regionId];
    const st = this.styleOf(regionId);
    const hue = this.hueOf(regionId);
    const night = darkness(life.clock) > 0.3;
    const snowRoofs = this.chunks.snowyRegion(regionId, seasonOf(w.day));
    const built = Math.min(v.houses.length, town?.houses ?? 3);
    const wealth = Math.max(0, Math.min(1, marketOf(w, regionId).prosperity));
    const target = housesFor(w, regionId);
    const abandonedFrom = built - (town?.abandoned ?? 0);
    v.houses.forEach((b, i) => {
      if (i > built || (i === built && target <= built)) return;
      const bx = (b.x + b.w / 2) * TILE;
      const by = (b.y + b.h) * TILE;
      if (!inView(bx, by)) return;
      const state = this.houseState(regionId, i, built, abandonedFrom, wealth);
      // De noche, las ventanas de las casas habitadas se encienden (no todas a la vez).
      const lit = (state === 'normal' || state === 'restaurada' || state === 'deteriorada') && night && (hash(`${regionId}:${i}`) < 0.82 || hourOf(life.clock) < 23);
      const wins = st.shape === 'redondo' ? [{ x: -b.w * 8 + 12, y: -32, w: 11, h: 11 }] : houseWindows(b.w);
      if (lit) for (const wn of wins) this.lights.push({ x: bx + wn.x + wn.w / 2, y: by + wn.y + wn.h / 2, r: 20, k: 0.8 });
      const ht0 = houseTex(st, state, i % 3, b.w, wealth);
      const ht = snowRoofs && state !== 'destruida' ? snowCapped(ht0, -WALL_H - 3) : ht0;
      const sun = this.sun;
      this.shadowQ.push(() => castShadow(g, silhouette(ht), ht.w, ht.h, ht.ax, ht.ay, bx, by, sun, 0.62));
      items.push({
        y: by,
        draw: () => {
          put(g, ht, bx, by);
          if (lit) for (const wn of wins) this.litWindow(bx + wn.x, by + wn.y, wn.w, wn.h, t + i * 300);
        },
      });
      if (state === 'quemada' && !this.reduceMotion && Math.random() < 0.06) this.puff(bx, by - 50, 'rgba(60,55,50,', 2);
      if (state === 'normal' && st.shape !== 'redondo' && !this.reduceMotion && Math.random() < 0.006 && (hourOf(life.clock) < 9 || hourOf(life.clock) > 17 || cold)) this.puff(bx + b.w * 8 - 17.5 - (i % 3 % 2) * 20, by - 96, 'rgba(205,205,205,', 1.1);
    });
    const food = r.isHome ? w.player.reserves / 5 : r.food;
    for (const b of v.keys) {
      if (!this.buildingExists(regionId, b.kind)) continue;
      const bx = (b.x + b.w / 2) * TILE;
      const by = (b.y + b.h) * TILE;
      if (!inView(bx, by)) continue;
      const extra = b.kind === 'almacen' ? (food < 4 ? 'vacio' : '') : b.kind === 'salon' ? `hsl(${hue} 55% 45%)` : '';
      const kt0 = keyTex(b.kind, st, extra, wealth);
      const kt = snowRoofs ? snowCapped(kt0, -kt0.h * 0.42) : kt0;
      const sun = this.sun;
      this.shadowQ.push(() => castShadow(g, silhouette(kt), kt.w, kt.h, kt.ax, kt.ay, bx, by, sun, 0.62));
      items.push({ y: by, draw: () => put(g, kt, bx, by) });
      if (night && (b.kind === 'posada' || b.kind === 'salon' || b.kind === 'templo' || b.kind === 'hogar')) {
        // La puerta abierta deja salir la luz de dentro: brilla y dibuja un charco cálido delante.
        this.lights.push({ x: bx, y: by - 16, r: 24, k: 1 });
        this.lights.push({ x: bx, y: by + 6, r: b.kind === 'posada' ? 80 : 60, k: 0.9, flat: 0.5 });
      }
      if (b.kind === 'forja') {
        const working = hourOf(life.clock) > 8 && hourOf(life.clock) < (r.militancy > 0.55 ? 23 : 18);
        if (working) this.lights.push({ x: bx - 14, y: by - 14, r: 34, k: 0.9 });
        if (working && !this.reduceMotion && Math.random() < (r.militancy > 0.55 ? 0.14 : 0.05)) this.puff(bx + 16, by - 96, 'rgba(70,65,60,', 1.6);
      }
    }
    // Mobiliario: bancos, faroles, fuente, barriles, carros, heno…
    for (const pr of v.props) {
      const px = pr.x * TILE;
      const py = pr.y * TILE;
      if (!inView(px, py)) continue;
      const frozen = pr.kind === 'fuente' && snowRoofs && seasonOf(w.day) === 'invierno';
      const lampOn = night || ['lluvia', 'tormenta', 'niebla'].includes(this.wxFrame);
      const pt = propTex(pr.kind, pr.kind === 'fuente' ? (frozen ? 1 : 0) : pr.kind === 'farol' ? (lampOn ? 1 : 0) : pr.v);
      // El poste del cruce, a escala humana (algo más alto que una persona, no el doble).
      const ps = pr.kind === 'cartel' ? 0.72 : 1;
      // Lo alto proyecta sombra; lo bajo (bancos, vallas, barriles, heno…) solo se asienta con una sombra de contacto.
      const tall = pr.kind === 'farol' || pr.kind === 'cartel' || pr.kind === 'fuente' || pr.kind === 'pozo' || pr.kind === 'carro' || pr.kind === 'estatua';
      if (tall) this.shadowQ.push(() => castShadow(g, silhouette(pt), pt.w, pt.h, pt.ax, pt.ay, px, py, this.sun, 0.5, ps));
      else this.shadowQ.push(() => contactShadow(g, px + (pr.kind === 'vallaV' ? 0 : pt.w / 2 - pt.ax), py, pr.kind === 'vallaV' ? 4 : pt.w * 0.5, pr.kind === 'vallaV' ? pt.h * 0.35 : 3, 0.35));
      if (pr.kind === 'fuente' && !frozen) items.push({ y: py, draw: () => (put(g, pt, px, py), drawFountainWater(g, px, py, this.reduceMotion ? 0 : t)) });
      else items.push({ y: py, draw: () => put(g, pt, px, py, false, ps) });
    }
    const gloomy = ['lluvia', 'tormenta', 'niebla'].includes(this.weatherHere());
    if (night || gloomy) for (const lp of v.lamps) {
      const px = lp.x * TILE;
      const py = lp.y * TILE + 9; // cabeza del farol (el farol mide ~43 px)
      if (!inView(px, py)) continue;
      // La lámpara y, sobre todo, el charco de luz que deja en el suelo.
      this.lights.push({ x: px, y: py, r: 20, k: 0.9 });
      this.lights.push({ x: px, y: py + 38, r: 100, k: 1, flat: 0.55 });
      items.push({ y: py + 39, draw: () => this.flame(px, py, t) });
    }
    // Mercado: lo que hay se ve en los puestos; los que cierran, se quedan vacíos.
    const look = marketLook(w, regionId);
    v.stalls.slice(0, Math.min(v.stalls.length, 6)).forEach((s, i) => {
      const stallGoods = look.stalls[i];
      if (stallGoods === undefined) return; // sin comerciante: no hay puesto
      const open = stallGoods.length > 0;
      items.push({ y: s.y * TILE, draw: () => put(g, stallTex(open, `hsl(${(hue + i * 40) % 360} ${open ? 50 : 18}% ${open ? 55 : 40}%)`, i, open ? stallGoods : undefined), s.x * TILE, s.y * TILE) });
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
        const tt = this.l.terrain.tiles[k];
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
      if (night) this.lights.push({ x: px, y: py - 106, r: 56, k: 1 });
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
          if (night || Math.floor(t / 700) % 2) this.flame(px, py - 106, t);
        },
      });
    }
    // Hoguera de la plaza al anochecer.
    const hh = hourOf(life.clock);
    if ((hh > 19 || hh < 1) && !r.abandoned && this.weatherHere() !== 'lluvia' && this.weatherHere() !== 'tormenta') {
      const spot = this.fireSpot(regionId);
      const px = spot.x * TILE;
      const py = spot.y * TILE;
      this.lights.push({ x: px, y: py - 8, r: 70, k: 1 });
      items.push({ y: py, draw: () => this.fire(px, py, t, 1.2) });
      if (!this.reduceMotion && Math.random() < 0.05) this.puff(px, py - 26, 'rgba(120,110,100,', 1);
    }
  }

  /**
   * Estado visual de una casa, leído de la simulación: en obra (el pueblo
   * crece), quemada (guerra), destruida (quemada mientras la guerra sigue),
   * abandonada (se fue la gente), deteriorada (pobreza), restaurada (se
   * reconstruye) o normal.
   */
  private houseState(regionId: number, i: number, built: number, abandonedFrom: number, wealth: number): BuildState {
    const r = this.w.regions[regionId];
    const town = ensureLife(this.w).towns[regionId];
    const hh = hash(`${regionId}:${i}`, 7);
    if (i === built) return 'obra';
    if (town?.burned.includes(i)) return r.flags.guerra && hh < 0.35 ? 'destruida' : 'quemada';
    if (i >= abandonedFrom) return 'abandonada';
    if (r.flags.reconstruyendo && hh < 0.6) return 'restaurada';
    if (wealth < 0.38 && hh < (0.38 - wealth) * 2.6) return 'deteriorada';
    return 'normal';
  }

  /** Hueco más despejado de la plaza para la hoguera (lejos de puestos, bancos y fuente). */
  private fireSpots = new Map<number, { x: number; y: number }>();
  private fireSpot(regionId: number): { x: number; y: number } {
    const hit = this.fireSpots.get(regionId);
    if (hit) return hit;
    const v = this.l.villages[regionId];
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
    this.fireSpots.set(regionId, best);
    return best;
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
    items.push({ y: py + 4, draw: () => S.drawSprite(g, S.post(`hsl(${this.hueOf(owner.id)} 60% 45%)`, closed), px - 30, py + 4) });
    if (closed) items.push({ y: py + 6, draw: () => S.drawSprite(g, S.barricade(), px + 4, py + 6) });
    if (darkness(ensureLife(w).clock) > 0.3) this.lights.push({ x: px - 30, y: py - 40, r: 44, k: 0.9 });
    const sec = t / 1000;
    const lifeW = ensureLife(w);
    const weather = this.weatherHere();
    // Guardias según la tensión; campamentos si hay guerra.
    const war = a.relations[b.id]?.war;
    const mil = Math.max(a.militancy, b.militancy, a.relations[b.id]?.tension ?? 0);
    const guards = war ? 6 : mil > 0.55 ? 4 : mil > 0.35 ? 2 : route.status === 'cerrada' ? 2 : 1;
    for (let i = 0; i < guards; i++) {
      const side = i % 2 ? a : b;
      const sx = px + (i % 2 ? -1 : 1) * (26 + (i >> 1) * 20);
      const sy = py + 18 + (i >> 1) * 10;
      const ap = this.extraAp(`g:${p.routeId}:${side.id}:${i}`, side.id, 'guardia', 24 + i * 5);
      const me = lifeW.player;
      const close = Math.hypot(me.x * TILE - sx, me.y * TILE - sy) < 70;
      const pose: Pose = {
        facing: close ? 'front' : 'side',
        flip: i % 2 === 0,
        phase: 0,
        action: war ? (Math.floor(sec / 2 + i) % 3 ? 'look' : 'point') : close ? 'idle' : 'look',
        t: sec + i,
        expr: war ? 'enfadado' : mil > 0.55 ? 'desconfianza' : 'neutral',
        lod: this.lodAt(sx / TILE, sy / TILE),
        hood: weather === 'lluvia' || weather === 'tormenta',
        heavy: weather === 'nieve',
      };
      this.pushPerson(items, ap, pose, sx, sy);
    }
    if (war) {
      for (let i = 0; i < 3; i++) {
        const tx = px + (i - 1) * 70;
        const ty = py - 70 - (i % 2) * 16;
        items.push({ y: ty, draw: () => put(g, tentTex(`hsl(${this.hueOf(i % 2 ? a.id : b.id)} 35% 50%)`), tx, ty) });
      }
      this.lights.push({ x: px, y: py - 50, r: 64, k: 1 });
      items.push({ y: py - 40, draw: () => this.fire(px, py - 40, t, 1.1) });
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
          const ap = this.extraAp(`s:${road.routeId}:${i}`, side, 'guardia', 22 + i * 3);
          const pose = this.marchPose(pos.dx, pos.dy, t / 1000 + i * 1.3, 'enfadado', px, py, ap);
          this.pushPerson(items, ap, pose, px, py);
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
        const ap = this.extraAp(`r:${r.id}:${i}`, r.id, role, role === 'nino' ? 9 : role === 'anciano' ? 66 : 30, (a) => {
          a.outfit.item = role === 'anciano' ? 'baston' : 'saco';
          a.outfit.patches = true;
        });
        const pose = this.marchPose(pos.dx, pos.dy, t / 1000 + i, i % 2 ? 'triste' : 'miedo', px, py, ap);
        this.pushPerson(items, ap, pose, px, py);
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
      const driver = this.extraAp(`c:${c.id}`, w.player.home, 'comerciante', 34);
      const dpose = this.marchPose(pos.dx, pos.dy, t / 1000, 'neutral', px, py, driver);
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

  private fire(px: number, py: number, t: number, scale = 1): void {
    drawFire(this.g, px, py, t, scale >= 1.15, this.reduceMotion);
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
      drawPuff(g, p.x, p.y, p.r, p.color, 0.5 * (1 - p.life / p.max));
    }
  }

  /** "!" sobre los encuentros, y resaltado del objetivo enfocado. */
  private drawMarkers(g: CanvasRenderingContext2D, t: number): void {
    const life = ensureLife(this.w);
    // La caja perdida destella de vez en cuando: miel al sol.
    for (const it of prologueItems(this.w)) {
      if (it.id !== 'caja' || (!this.reduceMotion && Math.floor(t / 180) % 9 > 2)) continue;
      const X = Math.round(it.x * TILE + 5);
      const Y = Math.round(it.y * TILE - 16);
      g.fillStyle = '#fff6c8';
      g.fillRect(X, Y - 2, 1, 5);
      g.fillRect(X - 2, Y, 5, 1);
      g.fillStyle = '#ffd36a';
      g.fillRect(X, Y, 1, 1);
    }
    for (const e of life.encounters) {
      if (e.resolved) continue;
      const bob = this.reduceMotion ? 0 : Math.sin(t / 250) * 2;
      g.fillStyle = '#f3e8cf';
      g.strokeStyle = '#2b1e15';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(e.x * TILE, Math.round(e.y * TILE - 44 + bob), 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#b5562d';
      g.font = 'bold 8px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('!', e.x * TILE, Math.round(e.y * TILE - 43.5 + bob));
    }
    // Foco: un resplandor cálido en el suelo bajo quien o lo que se puede usar (no bajo el propio jugador).
    const f = this.focus ? this.targetPos(this.focus) : undefined;
    const meP = ensureLife(this.w).player;
    if (f && Math.hypot(f.x - meP.x, f.y - meP.y) > 0.7) {
      const fx = f.x * TILE;
      const fy = f.y * TILE;
      const pulse = 0.75 + Math.sin(performance.now() / 420) * 0.25;
      g.save();
      g.translate(fx, fy);
      g.scale(1, 0.38);
      const gr = g.createRadialGradient(0, 0, 2, 0, 0, 12);
      gr.addColorStop(0, `rgba(255,226,150,${(0.42 * pulse).toFixed(3)})`);
      gr.addColorStop(0.65, `rgba(255,210,120,${(0.18 * pulse).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(255,210,120,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, 12, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // Destino tocado: un anillo que se abre y se apaga.
    if (this.tapMark) {
      // Se queda hasta llegar: un aro dorado que late, con contorno oscuro para verse sobre cualquier suelo.
      if (!this.path.length && !this.pending) this.tapMark = null;
      else {
        const age = ((performance.now() - this.tapMark.t) / 900) % 1;
        const r = 6 + age * 9;
        const x = this.tapMark.x * TILE;
        const y = this.tapMark.y * TILE;
        g.lineWidth = 2.2;
        g.strokeStyle = `rgba(30,20,10,${(0.45 * (1 - age)).toFixed(3)})`;
        g.beginPath();
        g.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 1.2;
        g.strokeStyle = `rgba(240,205,130,${(0.95 * (1 - age)).toFixed(3)})`;
        g.stroke();
        g.fillStyle = 'rgba(240,205,130,0.85)';
        g.beginPath();
        g.ellipse(x, y, 2, 0.9, 0, 0, Math.PI * 2);
        g.fill();
      }
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
      const f = this.folkById.get(id);
      if (!f || f.lastMet < 0 || id === this.converseId) continue;
      const ap0 = this.apCache.get(id)?.ap;
      const p = this.toScreen(e.x * TILE, e.y * TILE - (ap0 ? figureTop(ap0) + 4 : 35));
      g.font = '600 12px Alegreya, Georgia, serif';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(30,25,20,0.7)';
      g.strokeText(f.name, p.x, p.y);
      g.fillStyle = '#f6ecd2';
      g.fillText(f.name, p.x, p.y);
    }
    // Lo que se oye al pasar: frases sueltas de quienes charlan cerca (y gritos de quienes discuten).
    let bubbles = 0;
    const slot = Math.floor(performance.now() / 5200);
    for (const [id, e] of this.ents) {
      if (bubbles >= 2 || e.inside || !e.partner || id > e.partner || Math.hypot(e.x - me.x, e.y - me.y) > 6.5) continue;
      const a = this.folkById.get(id);
      const b = this.folkById.get(e.partner);
      const o = this.ents.get(e.partner);
      if (!a || !b || !o) continue;
      const angry = /discute|pelea/.test(e.act);
      const text = angry ? (slot % 2 ? '«¡Eso es mentira!»' : '«¡No vuelvas a hablarme así!»') : overheard(w, slot % 2 ? a : b, slot % 2 ? b : a, slot + hashOf(id));
      if (!text || (slot + hashOf(id)) % 3 === 2) continue;
      bubbles++;
      const p = this.toScreen(((e.x + o.x) / 2) * TILE, Math.min(e.y, o.y) * TILE - 46);
      g.font = 'italic 12px Alegreya, Georgia, serif';
      const wpx = Math.min(240, g.measureText(text).width + 14);
      g.fillStyle = angry ? 'rgba(120,30,25,0.82)' : 'rgba(30,25,20,0.72)';
      g.beginPath();
      g.roundRect(p.x - wpx / 2, p.y - 20, wpx, 20, 8);
      g.fill();
      g.fillStyle = '#f6ecd2';
      g.fillText(text.length > 38 ? `${text.slice(0, 36)}…»` : text, p.x, p.y - 4);
    }
    // Nombre del pueblo al acercarse a la plaza.
    for (const v of this.l.villages) {
      const d = Math.hypot(v.cx - me.x, v.cy - me.y);
      if (d > 16) continue;
      const p = this.toScreen((v.cx + 0.5) * TILE, (v.cy - v.plazaR - 1) * TILE);
      g.globalAlpha = Math.min(1, (16 - d) / 6);
      g.font = '700 17px Alegreya, Georgia, serif';
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

  /**
   * Noche: una capa de oscuridad azulada con huecos donde hay luz (ventanas,
   * faroles, hogueras, tu farol) y, encima, un halo cálido aditivo.
   */
  private drawNight(g: CanvasRenderingContext2D, weather: string): void {
    const life = ensureLife(this.w);
    const d = darkness(life.clock);
    const gloom = weather === 'tormenta' ? 0.45 : weather === 'lluvia' || weather === 'niebla' ? 0.3 : 0;
    // Cuánto se notan las luces: de noche del todo; con lluvia o niebla, algo.
    const glow = Math.max(d, gloom * 0.6);
    if (glow <= 0.01) return;
    const vis: { x: number; y: number; r: number; k: number; flat: number }[] = [];
    const cap = VQ().lights;
    for (const l of this.lights) {
      const p = this.toScreen(l.x, l.y);
      const r = l.r * this.cam.z;
      if (p.x < -r || p.y < -r || p.x > this.vw + r || p.y > this.vh + r) continue;
      vis.push({ x: p.x, y: p.y, r, k: l.k, flat: l.flat ?? 1 });
      if (vis.length >= cap) break;
    }
    if (d > 0.01) {
      // Oscuridad de luna (azul frío, a media resolución) con huecos de caída
      // suave donde hay luz: lo iluminado conserva sus colores de verdad y lo
      // demás queda en penumbra azulada. Una sola pasada de pantalla.
      const dc = this.dark.getContext('2d')!;
      const W = this.dark.width;
      const H = this.dark.height;
      const sx = W / this.vw;
      dc.globalCompositeOperation = 'source-over';
      dc.clearRect(0, 0, W, H);
      const a = Math.min(0.8, d * 1.05);
      const sky = dc.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, `rgba(18,28,64,${(a * 0.9).toFixed(3)})`);
      sky.addColorStop(1, `rgba(8,12,34,${a.toFixed(3)})`);
      dc.fillStyle = sky;
      dc.fillRect(0, 0, W, H);
      dc.globalCompositeOperation = 'destination-out';
      dc.imageSmoothingQuality = 'low';
      const hole = lightSprite('hole');
      for (const l of vis) {
        dc.globalAlpha = Math.min(1, l.k);
        dc.drawImage(hole, (l.x - l.r) * sx, (l.y - l.r * l.flat) * sx, l.r * 2 * sx, l.r * 2 * l.flat * sx);
      }
      dc.globalAlpha = 1;
      dc.globalCompositeOperation = 'source-over';
      g.imageSmoothingQuality = 'low';
      g.drawImage(this.dark, 0, 0, this.vw, this.vh);
    }
    // 4) El fuego tiñe de ámbar lo que toca (aditivo).
    g.globalCompositeOperation = 'lighter';
    // Texturas suaves ampliadas: el filtrado bilineal basta (el bicúbico de «high» es muy caro al ampliar).
    g.imageSmoothingQuality = 'low';
    const warm = lightSprite('warm');
    // Solo las luces que de verdad iluminan alrededor (faroles, hogueras, puertas):
    // las ventanas ya brillan por sí mismas. Cada halo es mucha superficie que pintar.
    for (const l of vis) {
      if (l.r < 26 * this.cam.z) continue;
      g.globalAlpha = Math.min(1, 0.3 * glow * l.k);
      g.drawImage(warm, l.x - l.r * 0.8, l.y - l.r * 0.8 * l.flat, l.r * 1.6, l.r * 1.6 * l.flat);
    }
    // Suelo mojado: cada charco de luz se refleja alargado hacia abajo, como en el adoquín empapado.
    if (weather === 'lluvia' || weather === 'tormenta') {
      const refl = lightSprite('reflect');
      for (const l of vis) {
        if (l.flat === 1) continue;
        const ww = l.r * 0.22;
        g.globalAlpha = Math.min(1, 0.55 * l.k);
        g.drawImage(refl, l.x - ww, l.y - l.r * 0.1, ww * 2, l.r * 0.9);
      }
      g.globalAlpha = 1;
    }
    // Lo que emite luz (cristal de las farolas, ventanas, llamas) brilla por encima de la oscuridad.
    const core = lightSprite('core');
    for (const l of vis) {
      if (l.flat !== 1 || l.r > 60 * this.cam.z) continue;
      const rr = Math.min(l.r * 0.42, 16 * this.cam.z);
      g.globalAlpha = Math.min(1, 0.9 * glow * l.k);
      g.drawImage(core, l.x - rr, l.y - rr, rr * 2, rr * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /**
   * Luz del día por franjas: madrugada fría y violácea, mañana suave,
   * mediodía limpio, tarde dorada, atardecer anaranjado con la luz baja
   * desde el oeste. Con nubes o lluvia, todo se vuelve gris, frío y menos
   * saturado. Los tintes de cada franja se combinan en un solo color de
   * multiplicar y otro de aclarar: dos pasadas de pantalla, no nueve.
   */
  private drawGrade(g: CanvasRenderingContext2D, h: number, weather: string): void {
    const W = this.vw;
    const H = this.vh;
    const bump = (c: number, wdt: number) => Math.max(0, 1 - Math.abs(h - c) / wdt);
    const rain = weather === 'lluvia' || weather === 'tormenta';
    const grey = weather === 'nublado' || rain || weather === 'niebla' || weather === 'nieve' ? 1 : 0;
    const clear = 1 - grey * 0.75;
    const dawn = bump(6.2, 1.6);
    const morning = bump(9, 2);
    const noon = bump(12.8, 1.8);
    const afternoon = bump(16.2, 2);
    const dusk = bump(18.9, 1.9);
    const mul = [1, 1, 1];
    const scr = [0, 0, 0];
    const M = (r: number, gg: number, b: number, a: number) => {
      if (a <= 0) return;
      mul[0] *= 1 - a * (1 - r / 255);
      mul[1] *= 1 - a * (1 - gg / 255);
      mul[2] *= 1 - a * (1 - b / 255);
    };
    const Sc = (r: number, gg: number, b: number, a: number) => {
      if (a <= 0) return;
      scr[0] = 1 - (1 - scr[0]) * (1 - (a * r) / 255);
      scr[1] = 1 - (1 - scr[1]) * (1 - (a * gg) / 255);
      scr[2] = 1 - (1 - scr[2]) * (1 - (a * b) / 255);
    };
    M(150, 150, 215, dawn * 0.4);
    Sc(255, 200, 205, dawn * 0.1 * clear);
    Sc(255, 244, 226, morning * 0.06 * clear);
    M(236, 242, 255, morning * 0.12 * clear); // sombras de la mañana algo frías
    Sc(255, 252, 240, noon * 0.06 * clear);
    M(255, 214, 160, afternoon * 0.26 * clear); // tarde dorada
    Sc(255, 196, 120, afternoon * 0.07 * clear);
    M(255, 140, 80, dusk * 0.5 * clear);
    M(170, 110, 160, dusk * 0.12);
    // Lluvia y tormenta: menos luz y más fría.
    // (gris azulado: apaga a la vez la luz y el color, sin una pasada aparte de saturación)
    M(118, 130, 150, rain ? (weather === 'tormenta' ? 0.66 : 0.55) : grey * 0.28);
    if (weather === 'nieve') Sc(200, 215, 235, 0.1);
    // Mezclas estándar (source-over): multiplicar o aclarar a pantalla completa obliga a
    // la GPU a copiar el fondo en cada pasada, y en muchos móviles es carísimo.
    overMultiply(g, mul[0], mul[1], mul[2], W, H);
    overScreen(g, scr[0], scr[1], scr[2], W, H);
    g.globalCompositeOperation = 'source-over';
    if (!VQ().grade) return;
    // Resplandor del sol bajo (por la mañana desde el este; al atardecer, desde el oeste).
    const low = Math.max(dawn * 0.6 + morning * 0.25, dusk + afternoon * 0.35) * clear;
    if (low > 0.02) {
      const fromWest = h > 12;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = Math.min(1, low) * 0.7;
      g.drawImage(lightSprite(fromWest ? 'sunW' : 'sunE'), 0, 0, W, H);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    // Viñeta suave (textura cacheada): centra la mirada en el protagonista.
    g.globalAlpha = 0.8 + grey * 0.25;
    g.drawImage(lightSprite('vignette'), 0, 0, W, H);
    g.globalAlpha = 1;
  }

  private litWindow(x: number, y: number, w: number, h: number, t: number): void {
    const g = this.g;
    const flick = this.reduceMotion ? 0 : Math.sin(t / 340) * 0.05 + Math.sin(t / 97) * 0.03;
    g.fillStyle = `rgba(255,${196 + Math.round(flick * 200)},110,0.95)`;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,240,190,0.85)';
    g.fillRect(x + 1.5, y + h * 0.45, w - 3, h * 0.5);
    g.fillStyle = 'rgba(90,60,30,0.55)';
    g.fillRect(x + w / 2 - 0.5, y, 1, h);
    g.fillRect(x, y + h / 2 - 0.5, w, 1);
  }

  /** Llama de farol o de antorcha. */
  private flame(x: number, y: number, t: number): void {
    drawFlame(this.g, x, y, t, this.reduceMotion);
  }

  private drawBirds(g: CanvasRenderingContext2D): void {
    if (!this.birds.length) return;
    // Vuelan alto: su sombra cae lejos, en el suelo, y eso dice que están en el aire.
    g.fillStyle = 'rgba(20,16,24,0.16)';
    for (const b of this.birds) {
      g.beginPath();
      g.ellipse(b.x + 10, b.y + 26, 2.2, 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(40,34,36,0.85)';
    g.fillStyle = 'rgba(40,34,36,0.9)';
    g.lineWidth = 0.7;
    for (const b of this.birds) {
      const k = Math.sin(b.ph) * 1.8;
      g.beginPath();
      g.moveTo(b.x - 3, b.y - k);
      g.quadraticCurveTo(b.x - 1.4, b.y - 1.6 - k * 0.3, b.x, b.y);
      g.quadraticCurveTo(b.x + 1.4, b.y - 1.6 - k * 0.3, b.x + 3, b.y - k);
      g.stroke();
      g.beginPath();
      g.ellipse(b.x, b.y + 0.2, 0.9, 0.55, 0, 0, Math.PI * 2);
      g.fill();
    }
  }



  // -------------------------------------------------------------------------
  // Aspecto y postura de las personas
  // -------------------------------------------------------------------------
  /** Nivel de detalle por distancia al jugador (y por zoom). */
  private lodAt(x: number, y: number): 0 | 1 | 2 {
    const me = ensureLife(this.w).player;
    const d = Math.hypot(x - me.x, y - me.y) * (this.cam.z < 0.85 ? 1.6 : 1);
    const q = VQ();
    return d < q.lodNear ? 0 : d < q.lodMid ? 1 : 2;
  }

  /**
   * Ropa según el tiempo: con nieve, capa de abrigo con piel; con lluvia,
   * capa encerada con capucha. Solo para quien no lleva ya una.
   */
  // Una variante por combinación de tiempo: volver de la lluvia al sol no obliga a repintar a nadie.
  private dressed = new WeakMap<Appearance, Record<string, Appearance>>();
  private dress(ap: Appearance, wet: boolean, cold: boolean): Appearance {
    if ((!wet && !cold) || ap.age < 6) return ap;
    const key = `${wet}:${cold}`;
    let c = this.dressed.get(ap);
    if (!c) this.dressed.set(ap, (c = {}));
    if (c[key]) return c[key];
    const o = ap.outfit;
    const cloak = o.cloak ? { ...o.cloak, fur: o.cloak.fur || cold, hood: true } : { color: cold ? S.shade(o.topColor, 0.72) : '#5d5446', fur: cold, hood: true, clasp: '#8a7a5a' };
    const out: Appearance = { ...ap, outfit: { ...o, cloak, hat: wet && o.hat === 'paja' ? undefined : o.hat } };
    c[key] = out;
    return out;
  }

  private apOf(f: Folk): Appearance {
    const key = `${f.age < 16 ? 0 : f.age >= 58 ? 2 : 1}:${f.role}:${f.charId ?? ''}`;
    const c = this.apCache.get(f.id);
    if (c && c.key === key) return c.ap;
    const ap = appearanceOf(this.w, f);
    this.apCache.set(f.id, { key, ap });
    return ap;
  }

  /** Aspecto de figurantes (soldados, refugiados, mensajeros, gentío). */
  private extraAp(id: string, regionId: number, role: FolkRole, age: number, mod?: (ap: Appearance) => void): Appearance {
    const key = `${regionId}:${role}`;
    const c = this.apCache.get(id);
    if (c && c.key === key) return c.ap;
    if (this.apCache.size > 1600) {
      // Se olvidan los más antiguos poco a poco (no todos de golpe: eso repintaría a todo el mundo).
      let n = 200;
      for (const k of this.apCache.keys()) {
        if (k === '@player' || n-- <= 0) continue;
        this.apCache.delete(k);
      }
    }
    const f: Folk = { id, name: id, regionId, role, age, born: 0, house: 0, alive: true, trust: 0.5, fear: 0, gratitude: 0, resentment: 0, honesty: 0.5, memories: [], lastMet: -1 };
    const ap = appearanceOf(this.w, f);
    mod?.(ap);
    this.apCache.set(id, { key, ap });
    return ap;
  }

  private playerAp(lantern: boolean): Appearance {
    const p = ensureLife(this.w).player;
    if (this.playerLook !== p.look) (this.playerLook = p.look), (this.playerLookKey = JSON.stringify(p.look ?? ''));
    const key = `${p.name}:${p.generation}:${p.age >= 58 ? 1 : 0}:${lantern}:${this.playerLookKey}`;
    const c = this.apCache.get('@player');
    if (c && c.key === key) return c.ap;
    const ap = playerAppearance(p);
    if (lantern) ap.outfit.item = 'farol';
    this.apCache.set('@player', { key, ap });
    return ap;
  }

  private entPose(id: string, e: Ent, f: Folk | undefined, sec: number, wet: boolean, cold: boolean): Pose {
    const now = performance.now();
    const react = e.react && e.react.until > now ? e.react : undefined;
    let facing = e.facing;
    let action: Action;
    if (e.moving) {
      facing = Math.abs(e.dy) > Math.abs(e.dx) * 1.3 ? (e.dy > 0 ? 'front' : 'back') : 'side';
      action = 'walk';
    } else if (id === this.converseId) {
      action = Math.floor(sec / 1.8) % 3 === 2 ? 'nod' : 'talk';
    } else if (react?.action) action = react.action;
    else {
      action = actionOf(e.act);
      if (e.partner) {
        // Dos que charlan: uno habla y gesticula, el otro escucha y asiente.
        const turn = Math.floor(sec / 2.8 + (id < e.partner ? 0 : 1)) % 2 === 0;
        action = turn ? (Math.floor(sec / 2.8) % 4 === 1 ? 'point' : 'talk') : Math.floor(sec / 0.9) % 5 === 0 ? 'nod' : 'listen';
      } else if (action === 'talk') action = 'idle';
      else if (action === 'idle' && Math.floor(sec / 4 + hash(id) * 9) % 6 === 0) action = 'look';
    }
    // Con lluvia, los que no pueden refugiarse se cubren con los brazos.
    if (wet && !e.moving && (action === 'idle' || action === 'look')) action = 'cross';
    const expr: Expr = react?.expr ?? (f ? moodOf(this.w, f) : hash(id, 8) < 0.3 ? 'feliz' : 'neutral');
    // Con lluvia: quien puede, saca un paraguas encerado; los demás, la capucha.
    const umbrella = wet && (action === 'walk' || action === 'idle' || action === 'look' || action === 'talk' || action === 'listen') && (f?.role === 'comerciante' || f?.role === 'lider' || hash(id, 11) < 0.22);
    return { facing, flip: e.flip, phase: e.anim, action, t: sec + hash(id) * 20, expr, lod: this.lodAt(e.x, e.y), hood: (wet && !umbrella) || (cold && hash(id, 31) < 0.6), heavy: cold, umbrella, wet };
  }

  private playerPose(sec: number, wet: boolean, cold: boolean): Pose {
    const conv = this.converseId ? this.ents.get(this.converseId) : undefined;
    const me = ensureLife(this.w).player;
    let fx = this.facing.x;
    let fy = this.facing.y;
    if (conv && !this.playerMoving) (fx = conv.x - me.x), (fy = conv.y - me.y);
    const side = Math.abs(fx) > 0.45 || Math.abs(fx) > Math.abs(fy) * 0.8;
    const facing: Facing = side ? 'side' : fy < 0 ? 'back' : 'front';
    const action: Action = this.playerMoving ? (this.playerRun ? 'run' : 'walk') : conv ? 'listen' : 'idle';
    return { facing, flip: fx < 0, phase: this.playerAnim, action, t: sec, expr: 'neutral', lod: 0, hood: wet || cold, heavy: cold, wet };
  }

  /** Postura de quien camina por un camino (soldados, refugiados, arrieros). */
  private marchPose(dx: number, dy: number, t: number, expr: Expr, px: number, py: number, ap: Appearance): Pose {
    const facing: Facing = Math.abs(dy) > Math.abs(dx) * 1.3 ? (dy > 0 ? 'front' : 'back') : 'side';
    const weather = this.weatherHere();
    // La fase sale de la posición en el camino: el paso va al ritmo del avance.
    const along = Math.abs(dx) >= Math.abs(dy) ? px : py;
    const phase = (along / (strideOf(ap, false) * TILE)) * Math.PI;
    return { facing, flip: dx < 0, phase, action: 'walk', t, expr, lod: this.lodAt(px / TILE, py / TILE), hood: weather === 'lluvia' || weather === 'tormenta', heavy: weather === 'nieve' };
  }
}

export { TW };

/** Texturas de luz pintadas una vez (sin crear degradados en cada fotograma). */
const lightCache = new Map<string, HTMLCanvasElement>();
function lightSprite(kind: 'hole' | 'warm' | 'core' | 'reflect' | 'moon' | 'sunW' | 'sunE' | 'vignette'): HTMLCanvasElement {
  const hit = lightCache.get(kind);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const S = kind === 'vignette' || kind === 'sunW' || kind === 'sunE' || kind === 'moon' ? 128 : 96;
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const h = S / 2;
  const radial = (stops: [number, string][], cx = h, cy = h, r0 = 0, r1 = h) => {
    const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };
  switch (kind) {
    case 'hole': // caída suave tipo 1/(1+d²)
      radial([[0, 'rgba(0,0,0,1)'], [0.2, 'rgba(0,0,0,0.92)'], [0.42, 'rgba(0,0,0,0.62)'], [0.65, 'rgba(0,0,0,0.3)'], [0.85, 'rgba(0,0,0,0.1)'], [1, 'rgba(0,0,0,0)']]);
      break;
    case 'reflect': {
      // Reflejo vertical en el suelo mojado: estrecho, más fuerte arriba, con rizos horizontales.
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, 'rgba(255,200,120,0.75)');
      gr.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = gr;
      for (let y = 0; y < S; y += 3) {
        const w = h * (0.35 + Math.sin(y * 0.9) * 0.25 + (1 - y / S) * 0.3);
        g.fillRect(h - w, y, w * 2, 2);
      }
      break;
    }
    case 'core': // núcleo de una luz: casi blanco cálido en el centro
      radial([[0, 'rgba(255,240,200,0.95)'], [0.25, 'rgba(255,200,120,0.6)'], [0.6, 'rgba(255,150,60,0.18)'], [1, 'rgba(255,120,40,0)']]);
      break;
    case 'warm':
      radial([[0, 'rgba(255,190,110,0.9)'], [0.3, 'rgba(255,150,70,0.5)'], [0.7, 'rgba(220,100,40,0.14)'], [1, 'rgba(200,80,30,0)']]);
      break;
    case 'moon': {
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, 'rgba(90,120,190,0.55)');
      gr.addColorStop(1, 'rgba(90,120,190,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
      break;
    }
    case 'sunW':
    case 'sunE': {
      const west = kind === 'sunW';
      radial([[0, west ? 'rgba(255,170,90,0.3)' : 'rgba(255,200,150,0.3)'], [1, 'rgba(255,170,90,0)']], west ? S * 1.05 : -S * 0.05, S * 0.15, 0, S * 0.9);
      break;
    }
    case 'vignette':
      radial([[0, 'rgba(12,8,18,0)'], [0.45, 'rgba(12,8,18,0)'], [1, 'rgba(12,8,18,0.36)']], h, h * 0.96, 0, h * 1.42);
      break;
  }
  lightCache.set(kind, c);
  return c;
}

/**
 * Aproxima «multiplicar por (r,g,b)» con una mezcla normal: un velo de color
 * con la opacidad que oscurece igual un tono medio. Mucho más barato.
 */
function overMultiply(g: CanvasRenderingContext2D, r: number, gg: number, b: number, W: number, H: number): void {
  const mx = Math.max(r, gg, b);
  if (mx > 0.995 && Math.min(r, gg, b) > 0.995) return;
  const a = Math.min(0.95, 1 - (r + gg + b) / 3 + (mx - Math.min(r, gg, b)) * 0.35);
  if (a <= 0.004) return;
  // Color del velo para que un gris medio (0,5) quede en 0,5·c.
  const k = (c: number) => Math.round(Math.max(0, Math.min(1, (0.5 * c - 0.5 * (1 - a)) / a)) * 255);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = `rgba(${k(r)},${k(gg)},${k(b)},${a.toFixed(3)})`;
  g.fillRect(0, 0, W, H);
}

/** «Aclarar» con un velo claro y transparente (exacto si los tres canales son iguales). */
function overScreen(g: CanvasRenderingContext2D, r: number, gg: number, b: number, W: number, H: number): void {
  const a = Math.max(r, gg, b);
  if (a <= 0.004) return;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = `rgba(${Math.round((r / a) * 255)},${Math.round((gg / a) * 255)},${Math.round((b / a) * 255)},${a.toFixed(3)})`;
  g.fillRect(0, 0, W, H);
}

/** Zancada (teselas por paso) de un cuerpo andando o corriendo: así el ciclo de piernas sigue al avance. */
function strideOf(ap: Appearance | undefined, run: boolean): number {
  const leg = ap ? bodyOf(ap).leg : 14.4;
  return (2 * leg * Math.sin(run ? 0.78 : 0.52)) / TILE;
}
