import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import type { WorldState } from '../core/types';
import { darkness, hourOf, SECONDS_PER_MINUTE, seasonOf, type Season } from '../world/clock';
import { weatherIn } from '../world/geography';
import { clearMaterials } from '../visual/env/materials';
import { drawSmall, drawTree, drawTreeShadow, type SmallKind, type TreeKind } from '../visual/env/flora';
import { playerRegion } from '../world/society';
import { getLayout, doorOf, stallShown, vendorSpot, type BuildingKind, type Layout } from '../world/layout';
import { ensureLife, explore } from '../world/life';
import { findPath, passable } from '../world/path';
import { routineOf } from '../world/routines';
import { prologueBlocks, prologueItems } from '../world/prologue';
import { convoyPositions } from '../world/trade';
import { idx, speedOf, walkable } from '../world/terrain';
import { T, TILE, TW, type Folk, type FolkRole } from '../world/types';
import type { Appearance } from './appearance';
import { CHUNK, ChunkCache, PAD, type StaticObject } from './chunks';
import type { Action, Expr, Facing, Pose } from '../visual/figure/types';
import { drawFigure, drawFigureShadow } from '../visual/figure/figure';
import { contactShadow, sunAt, type SunState } from '../visual/light';
import { houseTex } from '../visual/env/buildings';
import { animalTex, anvilTex, propTex, tentTex } from '../visual/env/props';
import { adaptTier, VQ, resolveTier, setTier, type AdaptState, type QualitySetting } from '../visual/quality';
import { nextFrame, put } from '../visual/paint';
import { drawFire, drawPuff } from './fx';
import { Weather } from '../visual/weather';
import { drawGrade, Lighting } from './lighting';
import { Furniture, settlePeople } from './furniture';
import { actionOf } from './mood';
import * as S from './sprites';
import type { Drawable } from './drawable';
import { postDrawables, roadTraffic } from './traffic';
import { drawEdgeArrows, drawLabels, drawMarkers } from './overlay';
import { moveAnimals, type Animal } from './animals';
import { drawBirds, moveBirds, type Bird } from './birds';
import { apOf, dress, entPose, extraAp, hash, lodAt, marchPose, playerAp, playerPose, strideOf } from './poses';
import { villageDrawables } from './village';
import { drawWet } from './wet';

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

export interface Ent {
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


const BUILDING_LABEL: Record<string, string> = { salon: 'Salón', almacen: 'Almacén', posada: 'Posada', templo: 'Templo', forja: 'Forja', hogar: 'Tu casa', establo: 'Establo', granero: 'Granero' };

/** Zoom de cámara: explorando, junto a alguien y conversando. */
const ZOOM = { explore: 2.6, near: 3.1, talk: 4.4 };

export class WorldScene {
  readonly canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D; // mundo (misma superficie que la pantalla, con la transformación de la cámara)
  private screen: CanvasRenderingContext2D; // pantalla (capas de luz, clima, interfaz)
  l: Layout;
  chunks: ChunkCache;
  cam = { x: 0, y: 0, z: ZOOM.explore };
  private userZ = 1; // multiplicador del pellizco
  converseId: string | null = null;
  apCache = new Map<string, { key: string; ap: Appearance }>();
  playerLook: unknown = null;
  wxFrame = 'despejado';
  seasonFrame: Season = 'primavera';
  playerLookKey = '';
  private extras = new Map<string, Extra>();
  birds: Bird[] = [];
  lights: Light[] = [];
  private socialAcc = 0;
  folkById = new Map<string, Folk>();
  private dpr = 1;
  vw = 0;
  vh = 0;
  ents = new Map<string, Ent>();
  animals = new Map<number, Animal[]>();
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
  focus: Target | null = null;
  playerAnim = 0;
  playerMoving = false;
  /** Velocidad real del jugador (teselas/s): acelera y frena, no salta. */
  private vel = { x: 0, y: 0 };
  /** Segundos quieto (el acercamiento a quien está al lado espera un poco). */
  private stillT = 0;
  private paintsSeen = 0;
  /** Plano de cine en curso (momentos importantes): encuadre, acercamiento, franjas y cámara lenta. */
  private cine: { x?: number; y?: number; z: number; start: number; dur: number; slow: number } | null = null;
  playerHidden = false;
  /** Qué tapó al jugador en el último fotograma (para revisar escenas). */
  hiddenBy = '';
  /** Huellas sólidas del mobiliario (elipses en teselas): solo frenan al jugador. */
  private snowCheck = -1e9;
  private snowWeather = '';
  private realDt = 0;
  private joyRun = false;
  /** Anticipación de la cámara, filtrada (no da latigazos al girar). */
  private lookAhead = { x: 0, y: 0 };
  /** Destino tocado: un anillo que se desvanece en el suelo. */
  tapMark: { x: number; y: number; t: number } | null = null;
  private ro: ResizeObserver | null = null;
  /** Capa de oscuridad nocturna (a media resolución). */
  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    this.keys.add(e.key.toLowerCase());
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) this.stop();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  playerRun = false;
  facing = { x: 0, y: 1 };
  path: { x: number; y: number }[] = [];
  pending: Target | null = null;
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
  /** Intervalos entre fotogramas (ms) y el mejor ritmo visto: así se nota la carga de la GPU, que no sale en el tiempo de dibujo. */
  private gapMs: number[] = [];
  private adapt: AdaptState = { calm: 0, sinceChange: 0, gpuCapped: false, bestGap: 1e9 };
  private lastFrameT = 0;
  private lastDowngrade = 0;
  setQuality(q: QualitySetting): void {
    this.qualitySetting = q;
    const changed = setTier(resolveTier(q));
    // Las texturas llevan la resolución en su clave: no se vacía el caché de golpe (daba un tirón).
    if (changed) (S.clearSprites(), clearMaterials());
    this.resize();
    if (VQ().crowd === 0) this.extras.clear();
  }
  get low(): boolean {
    return VQ().tier === 'low';
  }
  sun: SunState = sunAt(12, 'despejado');
  shadowQ: (() => void)[] = [];
  private lighting = new Lighting();
  focusGrad: CanvasGradient | null = null;
  /** Lo que se pinta sobre el suelo, antes incluso que las sombras (pavimentos con dibujo). */
  groundQ: (() => void)[] = [];
  furniture = new Furniture(() => this.w, () => this.l);

  /** Una persona en la escena: su sombra (en la pasada de sombras) y su figura (ordenada en profundidad). */
  pushPerson(items: Drawable[], ap: Appearance, pose: Pose, x: number, y: number): void {
    const g = this.g;
    const sun = this.sun;
    this.shadowQ.push(() => drawFigureShadow(g, ap, x, y, pose.lod === 2 ? null : sun, pose.action === 'sit' || pose.action === 'sleep'));
    items.push({ y, draw: () => drawFigure(g, ap, pose, x, y) });
  }

  /** Solo para revisar escenas (pruebas visuales): fuerza el tiempo que se ve. No toca la simulación. */
  debugWeather: string | null = null;
  weatherHere(): string {
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
        if (!this.paused) this.watchFrames(performance.now() - w0, this.lastFrameT ? t - this.lastFrameT : 0);
        this.lastFrameT = this.paused ? 0 : t;
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
  /**
   * En automático, el nivel se adapta al dispositivo midiendo cuánto tarda en
   * pintarse cada fotograma: si el 95 % pasa de 16 ms, baja un nivel; si dos
   * tandas seguidas se quedan por debajo de 7 ms, sube (sin pasar del detectado).
   */
  private watchFrames(ms: number, gap: number): void {
    if (this.qualitySetting !== 'auto' || document.hidden || ms > 250 || ms <= 0) return;
    this.frameMs.push(ms);
    if (gap > 0 && gap < 250) this.gapMs.push(gap);
    if (this.frameMs.length < 240) return;
    const sorted = this.frameMs.sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    this.frameMs.length = 0;
    // Ritmo real de la pantalla: la mediana de los intervalos entre fotogramas.
    let gapMed = 0;
    if (this.gapMs.length > 60) gapMed = this.gapMs.sort((a, c) => a - c)[Math.floor(this.gapMs.length / 2)];
    this.gapMs.length = 0;
    const now = performance.now();
    this.adapt.sinceChange = now - this.lastDowngrade;
    const next = adaptTier(VQ().tier, resolveTier('auto'), p95, gapMed, this.adapt);
    if (next === VQ().tier) return;
    this.lastDowngrade = now;
    setTier(next);
    // Las texturas pintadas llevan la resolución en su clave: las nuevas se pintan según se
    // necesitan y las viejas salen solas del caché (vaciarlo de golpe daba un tirón). Solo se
    // vacía el pequeño caché de sprites antiguos (estructuras), que no la lleva.
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
    this.furniture.clear();
    this.vendorSpots.clear();
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
    this.furniture.unstick(p, true);
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
    this.lighting.resize(r.width, r.height);
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((sx - r.left - this.vw / 2) / this.cam.z + this.cam.x) / TILE, y: ((sy - r.top - this.vh / 2) / this.cam.z + this.cam.y) / TILE };
  }

  toScreen(x: number, y: number): { x: number; y: number } {
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
    this.separate(dt);
    this.settle(dt);
    moveAnimals(this, dt);
    moveBirds(this, dt);
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
    const z = Math.max(1, Math.min(4.5, (near && this.stillT > 1.4 ? ZOOM.near : ZOOM.explore) * this.userZ));
    // Con la botonera de acciones abajo, el encuadre sube un poco: lo que hay delante del
    // jugador (una forja, un puesto) no queda debajo de los botones.
    const ui = this.focus ? (this.vh * 0.09) / z : 0;
    return {
      x: (me.x + this.lookAhead.x * look) * TILE,
      y: (me.y + this.lookAhead.y * look * 0.8) * TILE - 10 + ui,
      z,
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
    this.furniture.unstick(me);
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
    // Si ya está dentro de un mueble (al aparecer o cargar), puede salir libremente.
    const stuck = this.furniture.solidAt(me.x, me.y);
    const ok = (x: number, y: number) => passable(this.w, this.l, x, y) && (stuck || !this.furniture.solidAt(x, y));
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
    // Al correr por tierra o camino se levanta un poco de polvo.
    if (this.playerRun && moved > 0 && !this.reduceMotion && Math.random() < dt * 6) {
      const tt = this.l.terrain.tiles[idx(Math.floor(me.x), Math.floor(me.y))];
      if (tt === T.Road || tt === T.Clay || tt === T.Sand || tt === T.Field) this.puff(me.x * TILE - this.vel.x * 2, me.y * TILE, 'rgba(176,150,112,', 0.55);
    }
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
      if (out || this.low || r.abandoned || r.population < 250 || Math.hypot(v.cx - me.x, v.cy - me.y) > 44) continue;
      // Hasta en una aldea hay alguien de paso por la plaza (antes, por debajo de 800 vecinos, nadie).
      const n = Math.min(VQ().crowd, Math.max(r.population < 500 ? 2 : 3, Math.floor((r.population - 600) / 110)) * (r.flags.hambre || r.flags.guerra ? 0.5 : 1));
      for (let i = 0; i < n; i++) {
        const id = `x:${v.regionId}:${i}`;
        keep.add(id);
        if (this.extras.has(id)) continue;
        const p = this.freePlazaPoint(v.regionId, (k) => hash(id, 40 + k));
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

  /** Un sitio de la plaza libre de mobiliario y sin otro figurante encima (si se puede). */
  private freePlazaPoint(regionId: number, rnd: (k: number) => number): { x: number; y: number } {
    let p = this.plazaPoint(regionId, rnd(0), rnd(1));
    for (let k = 1; k < 8; k++) {
      const crowded = [...this.extras.values()].some((o) => { const q = o.path[0] ?? o; return Math.hypot(q.x - p.x, q.y - p.y) < 1.4; });
      // (tampoco detrás de un puesto: asomaría por encima de la cabeza de quien atiende)
      const byStall = this.l.villages[regionId].stalls.some((st) => Math.abs(st.x - p.x) < 1.3 && st.y - p.y > 0 && st.y - p.y < 1.8);
      if (!this.furniture.solidAt(p.x, p.y) && !this.furniture.blocksPerson(p.x, p.y) && !crowded && !byStall) break;
      p = this.plazaPoint(regionId, rnd(k * 2), rnd(k * 2 + 1));
    }
    return p;
  }

  private moveExtras(dt: number): void {
    for (const [id, e] of this.extras) {
      if (!e.path.length) {
        e.moving = false;
        e.wait -= dt;
        if (e.wait <= 0) {
          const p = this.freePlazaPoint(e.regionId, () => Math.random());
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
    const r = routineOf(this.w, f, ensureLife(this.w).clock);
    // Varios oficios esperan en el mismo punto (la puerta de la forja, del salón…): cada
    // uno se coloca un poco a su aire para no fundirse en una sola figura con tres martillos.
    if (r.inside || f.role === 'anciano' || f.role === 'comerciante') return r;
    return { ...r, x: r.x + (hash(f.id, 21) - 0.5) * 2.6, y: r.y + (hash(f.id, 22) - 0.5) * 0.9 };
  }

  /**
   * Nadie se queda encima de nadie: los que están quietos (en su puesto, a la puerta de
   * la forja, charlando) se apartan poco a poco hasta dejar un hueco mínimo entre sí,
   * sin meterse en muebles ni en sitios por donde no se pasa.
   */
  /**
   * Último paso de colocación, después de todos los empujes: nadie se queda dentro de un
   * mueble (la fuente, un puesto), encima de otra persona quieta ni pegado al jugador. Si
   * pasa, se le lleva al sitio libre más cercano.
   */
  private vendorSpots = new Map<number, { x: number; y: number }[]>();
  private settle(dt: number): void {
    const people: Ent[] = [];
    for (const e of this.ents.values()) if (!e.inside) people.push(e);
    for (const e of this.extras.values()) people.push(e);
    // Quien atiende cada puesto montado (se dibuja detrás del mostrador, ver village.ts).
    const me = ensureLife(this.w).player;
    // (los puestos no se mueven: sus sitios se calculan una vez por pueblo, no en cada fotograma)
    const vendors: { x: number; y: number }[] = [];
    for (const v of this.l.villages) {
      if (Math.abs(v.cx - me.x) >= 40 || Math.abs(v.cy - me.y) >= 40) continue;
      let spots = this.vendorSpots.get(v.regionId);
      if (!spots) this.vendorSpots.set(v.regionId, (spots = v.stalls.slice(0, 6).filter((st) => stallShown(v, st)).map(vendorSpot)));
      for (const sp of spots) vendors.push(sp);
    }
    settlePeople(people, me, this.furniture, (x, y) => passable(this.w, this.l, x, y), vendors, dt);
  }

  private separate(dt: number): void {
    const still: Ent[] = [];
    for (const e of this.ents.values()) if (!e.inside && !e.moving) still.push(e);
    for (const e of this.extras.values()) if (!e.moving) still.push(e);
    // Las figuras son estrechas y altas: dos personas «se funden» si están a menos de un
    // cuerpo de ancho en horizontal y no muy separadas en profundidad. Se apartan de lado.
    const WIDE = 1.05;
    const DEEP = 1.8;
    // Quien trabaja con azada o martillo necesita sitio para el golpe.
    const wideOf = (e: Ent) => (/campo|siembra|cosecha|forja|martill|taller/.test(e.act ?? '') ? 1.7 : WIDE);
    const k = Math.min(1, dt * 4);
    for (let i = 0; i < still.length; i++)
      for (let j = i + 1; j < still.length; j++) {
        const a = still[i];
        const b = still[j];
        const dx = b.x - a.x;
        const wide = Math.max(wideOf(a), wideOf(b));
        if (Math.abs(dx) >= wide || Math.abs(b.y - a.y) >= DEEP) continue;
        const sgn = dx > 0.001 ? 1 : dx < -0.001 ? -1 : i % 2 ? 1 : -1;
        const push = ((wide - Math.abs(dx)) / 2) * k;
        const move = (e: Ent, dir: number) => {
          const nx = e.x + dir * push;
          if (passable(this.w, this.l, nx, e.y) && !this.furniture.solidAt(nx, e.y)) e.x = nx;
        };
        move(a, -sgn);
        move(b, sgn);
      }
    // Nadie se queda quieto justo detrás de algo alto (las tablas del poste de caminos, un
    // farol): se corre de lado hasta quedar a la vista.
    for (const e of still) {
      if (!this.furniture.blocksPerson(e.x, e.y)) continue;
      for (const d of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5]) {
        const nx = e.x + d;
        if (passable(this.w, this.l, nx, e.y) && !this.furniture.solidAt(nx, e.y) && !this.furniture.blocksPerson(nx, e.y)) {
          e.x += (nx - e.x) * k;
          break;
        }
      }
    }
    // Nadie se queda encima del protagonista (al llegar, o si se le para delante): el
    // vecino se aparta del todo hacia su lado; el jugador no se mueve.
    const me = ensureLife(this.w).player;
    // (también quien va andando: si su camino pasa por el sitio del jugador, lo rodea)
    const all: Ent[] = [...still];
    for (const e of this.ents.values()) if (!e.inside && e.moving) all.push(e);
    for (const e of this.extras.values()) if (e.moving) all.push(e);
    for (const e of all) {
      const dx = e.x - me.x;
      const W = wideOf(e);
      if (Math.abs(dx) >= W || Math.abs(e.y - me.y) >= DEEP) continue;
      const dir = dx > 0.001 ? 1 : dx < -0.001 ? -1 : e.x * 7 % 2 > 1 ? 1 : -1;
      const ok = (x: number) => passable(this.w, this.l, x, e.y) && !this.furniture.solidAt(x, e.y);
      const nx = e.x + dir * (W - Math.abs(dx)) * k;
      // (si por ese lado hay un mueble, se va por el otro)
      const ox = e.x - dir * (W + Math.abs(dx)) * k;
      if (ok(nx)) e.x = nx;
      else if (ok(ox)) e.x = ox;
    }
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

  // -------------------------------------------------------------------------
  // Objetivos de interacción
  // -------------------------------------------------------------------------
  targetPos(t: Target): { x: number; y: number } | undefined {
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
      consider({ kind: 'signpost', regionId: v.regionId, label: 'Poste de caminos' }, v.sign.x + 1.2, v.sign.y, radius * 0.8);
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
    // El trueno sacude un instante la cámara (2–3 px), salvo con movimiento reducido.
    const shake = !this.reduceMotion && this.wfx.flash > 0.55 ? (this.wfx.flash - 0.55) * 6 : 0;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    g.setTransform(dz, 0, 0, dz, this.dpr * (this.vw / 2 - this.cam.x * z + sx), this.dpr * (this.vh / 2 - this.cam.y * z + sy));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    this.sun = sunAt(hourOf(life.clock), this.weatherHere());
    this.shadowQ = [];
    this.groundQ = [];
    const x0 = this.cam.x - this.vw / 2 / z;
    const y0 = this.cam.y - this.vh / 2 / z;
    const x1 = this.cam.x + this.vw / 2 / z;
    const y1 = this.cam.y + this.vh / 2 / z;
    // Estación y tiempo se deciden una vez por fotograma; el resto del dibujo los lee de aquí.
    const season = (this.seasonFrame = seasonOf(w.day));
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
    if (weather === 'lluvia' || weather === 'tormenta') drawWet(this, g, x0, y0, x1, y1, t, weather === 'tormenta');
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
      villageDrawables(this, v.regionId, items, inView, t, cold);
    }
    // Puestos fronterizos, campamentos de guerra y soldados.
    this.l.posts.forEach((p) => {
      if (!inView(p.x * TILE, p.y * TILE, 200)) return;
      postDrawables(this, p, items, t);
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
    roadTraffic(this, items, inView, t);
    // Vecinos: figura completa cerca, simplificada a media distancia, silueta lejos.
    const anvils: { x: number; y: number }[] = [];
    for (const [id, e] of this.ents) {
      if (e.inside || !inView(e.x * TILE, e.y * TILE)) continue;
      const f = this.folkById.get(id);
      if (!f) continue;
      const ap = this.dress(apOf(this, f), wet, cold);
      e.stride = strideOf(ap, false);
      const pose = entPose(this, id, e, f, sec, wet, cold);
      // Un yunque por forja: quien llega después a la misma ayuda acarreando, no forma una fila de yunques.
      if (pose.action === 'hammer' && anvils.some((a) => Math.abs(a.x - e.x) < 4 && Math.abs(a.y - e.y) < 2)) {
        // (con un saco tendido parecían ofrecérselo al herrero: mejor mirar el golpe, de brazos cruzados)
        pose.action = 'cross';
        pose.facing = 'side';
        const smith = anvils.find((a) => Math.abs(a.x - e.x) < 4 && Math.abs(a.y - e.y) < 2)!;
        pose.flip = smith.x < e.x;
      }
      this.pushPerson(items, ap, pose, e.x * TILE, e.y * TILE);
      if (pose.action === 'hammer') {
        anvils.push(e);
        // El yunque delante, donde cae el martillo.
        const ax = e.x * TILE + (pose.flip ? -12 : 12);
        const ay = e.y * TILE + 1;
        const an = anvilTex();
        this.shadowQ.push(() => contactShadow(g, ax, ay, 9, 2.5, 0.4));
        // La pieza al rojo sobre el yunque y, en cada golpe, un abanico de chispas.
        const c = (pose.t * 1.3 + ap.seed * 0.1) % 1;
        const strike = Math.floor(pose.t * 1.3 + ap.seed * 0.1);
        items.push({ y: ay, draw: () => {
          put(g, an, ax, ay);
          if (this.low) return;
          const hx = ax + (pose.flip ? 2 : -2);
          const hy = ay - 14;
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = 'rgba(255,120,40,0.85)';
          g.fillRect(hx - 3, hy - 1, 6, 1.6);
          if (c > 0.8 && c < 0.97) {
            const k = (c - 0.8) / 0.17;
            g.lineWidth = 0.8;
            for (let i = 0; i < 7; i++) {
              const a = -Math.PI * (0.1 + 0.8 * hash(`${strike}`, i)) ;
              const r0 = 2 + k * (6 + hash(`${strike}`, i + 9) * 10);
              const x = hx + Math.cos(a) * r0;
              const y = hy + Math.sin(a) * r0 + k * k * 6;
              g.strokeStyle = `rgba(255,${190 + i * 8},90,${(1 - k).toFixed(2)})`;
              g.beginPath();
              g.moveTo(x, y);
              g.lineTo(x - Math.cos(a) * 2.2, y - Math.sin(a) * 2.2);
              g.stroke();
            }
          }
          g.restore();
        } });
      }
    }
    // Gentío de las ciudades grandes.
    for (const [id, e] of this.extras) {
      if (!inView(e.x * TILE, e.y * TILE)) continue;
      const roles: FolkRole[] = ['campesino', 'comerciante', 'artesano', 'campesino', 'anciano', 'nino', 'pastor', 'comerciante'];
      const ap = this.dress(this.extraAp(id, e.regionId, roles[Math.floor(hash(id, 4) * roles.length)], 14 + Math.floor(hash(id, 5) * 50)), wet, cold);
      e.stride = strideOf(ap, false);
      const pose = entPose(this, id, e, undefined, sec, wet, cold);
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
    const pap = this.dress(playerAp(this, darkness(life.clock) > 0.3), wet, cold);
    const ppose = playerPose(this, sec, wet, cold);
    this.pushPerson(items, pap, ppose, me.x * TILE, me.y * TILE);
    if (darkness(life.clock) > 0.3) {
      // Junto a una farola, el farol de mano casi no se nota (dos focos pegados se leían como un error).
      const byLamp = this.l.villages.some((v) => Math.abs(v.cx - me.x) < v.plazaR + 4 && Math.abs(v.cy - me.y) < v.plazaR + 4 && v.lamps.some((lp) => Math.hypot(lp.x - me.x, lp.y - me.y) < 2.6));
      this.lights.push({ x: me.x * TILE + (ppose.flip ? -3.5 : 3.5), y: me.y * TILE - 11, r: byLamp ? 30 : 54, k: byLamp ? 0.3 : 0.8 });
    }

    // Las sombras van antes que todo lo que se alza sobre el suelo.
    for (const gq of this.groundQ) gq();
    for (const sh of this.shadowQ) sh();
    items.sort((a, b) => a.y - b.y);
    this.playerHidden = false;
    this.hiddenBy = '';
    for (const it of items) it.draw();
    if (this.playerHidden) this.hiddenBy = 'árbol';
    // ¿Lo tapa algo dibujado después (una casa o un edificio que está delante)? Primero el
    // rectángulo y, si el sprite lo sabe, sus píxeles: el aire junto al tejado no tapa.
    const covers = (at: (x: number, y: number) => number, px: number, py: number) => [[0, -10], [0, -18], [-3, -14], [3, -14], [0, -24]].some(([dx, dy]) => at(px + dx, py + dy) > 0.5);
    {
      const px = me.x * TILE;
      const py = me.y * TILE;
      for (const it of items)
        if (it.box && it.y > py && it.box.x0 < px + 6 && it.box.x1 > px - 6 && it.box.y0 < py - 8 && it.box.y1 > py - 28 && (!it.solidAt || covers(it.solidAt, px, py))) {
          this.playerHidden = true;
          this.hiddenBy = `box ${Math.round(it.box.x0)},${Math.round(it.box.y0)}-${Math.round(it.box.x1)},${Math.round(it.box.y1)} y=${Math.round(it.y)}`;
          break;
        }
    }
    // Si el follaje tapa al protagonista, se le sigue viendo en transparencia (no se pierde nunca).
    if (this.playerHidden) {
      g.save();
      g.globalAlpha = 0.5;
      drawFigure(g, pap, ppose, me.x * TILE, me.y * TILE);
      g.restore();
    }

    this.drawParticles(g, t);
    drawBirds(this, g);
    drawMarkers(this, g, t);
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
    // darkness() llega a 0,62 en plena noche (lo usa también la simulación): aquí, de 0 a 1.
    const nightK = Math.min(1, darkness(life.clock) / 0.62);
    drawGrade(g, hourOf(life.clock), weather, this.vw, this.vh, nightK > 0.01);
    this.lighting.night(g, weather, nightK, this.lights, this.cam, this.vw, this.vh);
    drawLabels(this, g);
    drawEdgeArrows(this, g, t);
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

  hueOf(regionId: number): number {
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

  styleOf(regionId: number): S.Style {
    const r = this.w.regions[regionId];
    return S.styleFor(r.isHome ? 'eco' : r.culture, this.hueOf(regionId));
  }

  /** Hueco de la hoguera ya elegido en cada plaza (lo calcula village.ts). */
  fireSpots = new Map<number, { x: number; y: number }>();
  fire(px: number, py: number, t: number, scale = 1): void {
    drawFire(this.g, px, py, t, scale >= 1.15, this.reduceMotion);
  }

  puff(x: number, y: number, color: string, size: number): void {
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

  // -------------------------------------------------------------------------
  // Aspecto y postura de las personas (poses.ts)
  // -------------------------------------------------------------------------
  // Una variante por combinación de tiempo: volver de la lluvia al sol no obliga a repintar a nadie.
  dressed = new WeakMap<Appearance, Record<string, Appearance>>();
  /** Nivel de detalle por distancia al jugador (y por zoom). */
  lodAt(x: number, y: number): 0 | 1 | 2 {
    return lodAt(this, x, y);
  }
  dress(ap: Appearance, wet: boolean, cold: boolean): Appearance {
    return dress(this, ap, wet, cold);
  }
  /** Aspecto de figurantes (soldados, refugiados, mensajeros, gentío). */
  extraAp(id: string, regionId: number, role: FolkRole, age: number, mod?: (ap: Appearance) => void): Appearance {
    return extraAp(this, id, regionId, role, age, mod);
  }
  /** Postura de quien camina por un camino (soldados, refugiados, arrieros). */
  marchPose(dx: number, dy: number, t: number, expr: Expr, px: number, py: number, ap: Appearance): Pose {
    return marchPose(this, dx, dy, t, expr, px, py, ap);
  }
}

export { TW };
