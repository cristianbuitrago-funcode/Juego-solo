import { drawInkIcon, drawInkRow, onInkIconReady } from './inkicons';
import { paintRelief } from './relief';
import { RESOURCES } from '../../core/content/resources';
import { regionAt, WORLD_H, WORLD_W } from '../../core/gen/mapgen';
import { fbm } from '../../core/noise';
import type { WorldState } from '../../core/types';
import { hops } from '../../core/world';
import { regionColor } from './colors';
import { stanceOf } from '../../world/diplomacy';
import { convoyPositions, tradeOf } from '../../world/trade';
import { statesOf } from '../../world/states';
import { TIER_ORDER } from '../../world/atlas';
import { hashString } from '../../core/rng';

const STATE_TINT: [number, number, number][] = [[176, 92, 70], [70, 120, 170], [120, 150, 70], [160, 110, 170], [200, 160, 60], [80, 150, 140]];

/**
 * Mapa 2D interactivo dibujado en canvas.
 * - Capa base (pre-renderizada): papel, mar, regiones teñidas según lo que
 *   el jugador SABE de ellas, fronteras a tinta y niebla en lo desconocido.
 * - Capa dinámica (cada fotograma): río, rutas, comercio, etiquetas,
 *   emisarios en camino, pulsos de pistas y humo.
 * Controles: arrastrar, pellizcar para zoom, tocar, mantener pulsado, doble toque.
 */
export interface MapCallbacks {
  onTap: (regionId: number | null) => void;
  onLongPress: (regionId: number, x: number, y: number) => void;
}

const SCALE = 0.6; // píxeles de la capa base por unidad del mundo
const BW = Math.round(WORLD_W * SCALE);
const BH = Math.round(WORLD_H * SCALE);

interface Particle {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  r: number;
}

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private baseCtx: CanvasRenderingContext2D;
  /** Montañas, bosques, juncos y olas a tinta (solo lo conocido). */
  private relief = document.createElement('canvas');
  private regionMap = new Int16Array(BW * BH);
  private grain = new Uint8Array(BW * BH);
  private edge = new Uint8Array(BW * BH); // 1 frontera, 2 costa, 3 orilla
  private image: ImageData | null = null;
  private w: WorldState | null = null;
  private riverPath: { x: number; y: number }[] = [];
  private cam = { x: WORLD_W / 2, y: WORLD_H / 2, z: 0.4 };
  private minZ = 0.2;
  private maxZ = 3;
  private dpr = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture = { moved: false, startX: 0, startY: 0, t0: 0, pinchDist: 0, pinchZ: 0, lastTap: 0, longTimer: 0 as number };
  private particles: Particle[] = [];
  private raf = 0;
  private dirty = true;
  selected: number | null = null;
  /** Posición del jugador en unidades del mapa (para dibujar dónde estás). */
  player: { x: number; y: number } | null = null;
  highlights = new Set<number>(); // regiones con pistas nuevas hoy
  smokeAt = new Set<number>();
  reduceMotion = false;
  /** Capa estratégica: territorios y relaciones, comercio, conflictos (o la vista normal). */
  layer: 'normal' | 'politica' | 'estados' | 'comercio' | 'conflictos' = 'normal';

  constructor(private parent: HTMLElement, private cb: MapCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.base.width = BW;
    this.base.height = BH;
    this.baseCtx = this.base.getContext('2d')!;
    this.bindInput();
    onInkIconReady(() => this.markDirty());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private ro: ResizeObserver | null = null;
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    onInkIconReady(null);
    this.canvas.remove();
  }

  // -------------------------------------------------------------------------
  // Construcción de la capa base
  // -------------------------------------------------------------------------
  setWorld(w: WorldState): void {
    const sameMap = this.w?.seed === w.seed;
    this.w = w;
    if (!sameMap) {
      const sites = w.regions.map((r) => r.site);
      for (let j = 0; j < BH; j++)
        for (let i = 0; i < BW; i++) {
          const x = i / SCALE;
          const y = j / SCALE;
          this.regionMap[j * BW + i] = regionAt(x, y, w.seed, sites);
          this.grain[j * BW + i] = Math.round(fbm(x / 9, y / 9, w.seed + 999, 2) * 255);
        }
      for (let j = 0; j < BH; j++)
        for (let i = 0; i < BW; i++) {
          const k = j * BW + i;
          const a = this.regionMap[k];
          let e = 0;
          for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= BW || nj >= BH) continue;
            const b = this.regionMap[nj * BW + ni];
            if (a >= 0 && b < 0) e = 2;
            else if (a < 0 && b >= 0) e = 3;
            else if (a >= 0 && b !== a && e === 0) e = 1;
          }
          this.edge[k] = e;
        }
      this.image = this.baseCtx.createImageData(BW, BH);
      this.buildRiver(w);
      this.computeLandBox();
      this.fit();
    }
    this.refresh();
  }

  private buildRiver(w: WorldState): void {
    const pts = w.river.map((id) => ({ ...w.regions[id].center }));
    if (!pts.length) return;
    // Desemboca en el mar más cercano al último tramo.
    const last = pts[pts.length - 1];
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (let j = 0; j < BH; j += 3)
      for (let i = 0; i < BW; i += 3) {
        if (this.regionMap[j * BW + i] >= 0) continue;
        const x = i / SCALE;
        const y = j / SCALE;
        const d = (x - last.x) ** 2 + (y - last.y) ** 2;
        if (d < bd) (bd = d), (best = { x, y });
      }
    if (best) pts.push(best);
    // Suaviza y añade meandros.
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let t = 0; t < 1; t += 0.1) {
        const wob = Math.sin((i * 10 + t * 10) * 1.7 + w.seed) * 18 * Math.sin(t * Math.PI);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        out.push({ x: a.x + dx * t + (-dy / len) * wob, y: a.y + dy * t + (dx / len) * wob });
      }
    }
    out.push(pts[pts.length - 1]);
    this.riverPath = out;
  }

  /** Vuelve a teñir las regiones (tras avanzar un día o cambiar la selección). */
  refresh(): void {
    const w = this.w;
    if (!w || !this.image) return;
    const owner = w.regions.map((r) => w.life?.politics?.owner[r.id] ?? r.id);
    const states = this.layer === 'estados' && w.life?.society ? statesOf(w) : [];
    const lut = w.regions.map((r) => {
      const c = regionColor(w, r.id, r.id === this.selected);
      // Fronteras dinámicas: un territorio ocupado toma el color de quien lo controla.
      if (owner[r.id] !== r.id && w.intel[r.id].level > 0) {
        const o = regionColor(w, owner[r.id], false);
        return c.map((v, i) => Math.round(v * 0.45 + o[i] * 0.55)) as [number, number, number];
      }
      if (this.layer === 'estados' && (w.intel[r.id].level > 0 || r.isHome)) {
        // Cada estado, un color: los pueblos del mismo dueño o federación se tiñen igual.
        const st = states.find((x) => x.regions.includes(r.id));
        if (st && st.regions.length > 1) return c.map((v, i) => Math.round(v * 0.45 + STATE_TINT[hashString(st.id) % STATE_TINT.length][i] * 0.55)) as [number, number, number];
      }
      if (this.layer === 'politica' && w.intel[r.id].level > 0) {
        const fed = w.life?.politics?.federations.find((f) => f.members.includes(r.id));
        if (fed) return c.map((v, i) => Math.round(v * 0.7 + [120, 150, 190][i] * 0.3)) as [number, number, number];
      }
      return c;
    });
    const fog = w.regions.map((r) => w.intel[r.id].level === 0);
    const d = this.image.data;
    for (let k = 0; k < BW * BH; k++) {
      const id = this.regionMap[k];
      const gr = this.grain[k] / 255;
      const e = this.edge[k];
      let r: number, g: number, b: number;
      if (id < 0) {
        const s = 0.96 + gr * 0.08;
        [r, g, b] = e === 3 ? [178, 196, 196] : [90 * s, 122 * s, 136 * s];
      } else {
        const c = lut[id];
        // Acuarela: el pigmento se acumula en manchas (más contraste de grano).
        const s = 0.84 + gr * 0.26;
        r = c[0] * s;
        g = c[1] * s;
        b = c[2] * s;
        if (fog[id]) {
          // Lo desconocido: niebla pintada (nubes de bruma), no un rayado técnico.
          const x = k % BW;
          const y = (k / BW) | 0;
          const cloud = fbm(x / 22, y / 22, w.seed + 77, 3);
          const m = Math.min(1, 0.55 + cloud * 0.5);
          const curl = Math.abs(cloud - 0.5) < 0.025 ? 0.86 : 1; // vetas suaves en la bruma
          r = (r * (1 - m) + 226 * m) * curl;
          g = (g * (1 - m) + 222 * m) * curl;
          b = (b * (1 - m) + 212 * m) * curl;
        }
        if (e === 1) {
          // Entre dueños distintos la frontera se marca más (y cambia si cambia el dueño).
          const x = k % BW;
          const nb = [this.regionMap[k + 1], this.regionMap[k + BW], this.regionMap[k - 1], this.regionMap[k - BW]].find((n) => n !== undefined && n >= 0 && n !== id);
          const hard = nb !== undefined && owner[nb] !== owner[id] && x > 0;
          if (hard) (r *= 0.25), (g *= 0.18), (b *= 0.18);
          else if (nb !== undefined && owner[nb] === owner[id] && owner[id] !== id) (r *= 0.8), (g *= 0.78), (b *= 0.76);
          else (r *= 0.45), (g *= 0.42), (b *= 0.4);
        }
        if (e === 2) (r = 58), (g = 46), (b = 38);
      }
      const o = k * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
    this.baseCtx.putImageData(this.image, 0, 0);
    paintRelief(w, (id) => w.regions[id]?.isHome || w.intel[id]?.level > 0, this.relief);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Cámara
  // -------------------------------------------------------------------------
  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    // Tamaño de maquetación (clientWidth/Height): no le afectan las transformaciones de la animación de entrada.
    const r = { width: this.parent.clientWidth, height: this.parent.clientHeight };
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.minZ = Math.min(r.width / WORLD_W, r.height / WORLD_H) * 0.85;
    this.maxZ = this.minZ * 7;
    if (this.cam.z < this.minZ) this.fit();
    this.dirty = true;
  }

  private land = { x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H };

  /** Encuadra la isla completa (no todo el océano). */
  fit(): void {
    const r = { width: this.parent.clientWidth, height: this.parent.clientHeight };
    const { x0, y0, x1, y1 } = this.land;
    const pad = 40;
    const z = Math.min(r.width / (x1 - x0 + pad * 2), (r.height - 90) / (y1 - y0 + pad * 2));
    this.cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 30 / z, z: Math.max(this.minZ, Math.min(this.maxZ, z)) };
    this.dirty = true;
  }

  private computeLandBox(): void {
    let x0 = BW, y0 = BH, x1 = 0, y1 = 0;
    for (let j = 0; j < BH; j++)
      for (let i = 0; i < BW; i++)
        if (this.regionMap[j * BW + i] >= 0) {
          if (i < x0) x0 = i;
          if (i > x1) x1 = i;
          if (j < y0) y0 = j;
          if (j > y1) y1 = j;
        }
    this.land = { x0: x0 / SCALE, y0: y0 / SCALE, x1: x1 / SCALE, y1: y1 / SCALE };
  }

  focus(regionId: number): void {
    const c = this.w?.regions[regionId]?.center;
    if (!c) return;
    const r = { height: this.parent.clientHeight };
    // Deja sitio para el panel inferior.
    this.cam.x = c.x;
    this.cam.y = c.y + (r.height * 0.3) / this.cam.z;
    this.clampCam();
    this.dirty = true;
  }

  private clampCam(): void {
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z));
    this.cam.x = Math.max(0, Math.min(WORLD_W, this.cam.x));
    this.cam.y = Math.max(0, Math.min(WORLD_H, this.cam.y));
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (sx - r.left - r.width / 2) / this.cam.z + this.cam.x, y: (sy - r.top - r.height / 2) / this.cam.z + this.cam.y };
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (x - this.cam.x) * this.cam.z + r.width / 2, y: (y - this.cam.y) * this.cam.z + r.height / 2 };
  }

  regionAtScreen(sx: number, sy: number): number | null {
    const p = this.toWorld(sx, sy);
    const i = Math.floor(p.x * SCALE);
    const j = Math.floor(p.y * SCALE);
    if (i < 0 || j < 0 || i >= BW || j >= BH) return null;
    const id = this.regionMap[j * BW + i];
    return id >= 0 ? id : null;
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z * factor));
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Entrada táctil
  // -------------------------------------------------------------------------
  private bindInput(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const gs = this.gesture;
      if (this.pointers.size === 1) {
        gs.moved = false;
        gs.startX = e.clientX;
        gs.startY = e.clientY;
        gs.t0 = performance.now();
        clearTimeout(gs.longTimer);
        gs.longTimer = window.setTimeout(() => {
          if (!gs.moved && this.pointers.size === 1) {
            const id = this.regionAtScreen(gs.startX, gs.startY);
            gs.moved = true; // evita el toque al soltar
            if (id !== null) this.cb.onLongPress(id, gs.startX, gs.startY);
          }
        }, 480);
      } else if (this.pointers.size === 2) {
        clearTimeout(gs.longTimer);
        gs.moved = true;
        const [a, b] = [...this.pointers.values()];
        gs.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        gs.pinchZ = this.cam.z;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const gs = this.gesture;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 1) {
        if (Math.hypot(cur.x - gs.startX, cur.y - gs.startY) > 8) gs.moved = true;
        if (gs.moved) {
          this.cam.x -= (cur.x - prev.x) / this.cam.z;
          this.cam.y -= (cur.y - prev.y) / this.cam.z;
          this.clampCam();
          this.dirty = true;
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const target = gs.pinchZ * (dist / Math.max(1, gs.pinchDist));
        this.zoomAt(mid.x, mid.y, target / this.cam.z);
        // Desplazamiento con dos dedos.
        const pm = e.pointerId === [...this.pointers.keys()][0] ? { x: (prev.x + b.x) / 2, y: (prev.y + b.y) / 2 } : { x: (a.x + prev.x) / 2, y: (a.y + prev.y) / 2 };
        this.cam.x -= (mid.x - pm.x) / this.cam.z;
        this.cam.y -= (mid.y - pm.y) / this.cam.z;
        this.clampCam();
      }
    });
    const up = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const gs = this.gesture;
      clearTimeout(gs.longTimer);
      if (this.pointers.size === 0 && !gs.moved && performance.now() - gs.t0 < 450) {
        const now = performance.now();
        if (now - gs.lastTap < 300) {
          this.zoomAt(e.clientX, e.clientY, 1.7);
          gs.lastTap = 0;
          return;
        }
        gs.lastTap = now;
        this.cb.onTap(this.regionAtScreen(e.clientX, e.clientY));
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }

  // -------------------------------------------------------------------------
  // Dibujo
  // -------------------------------------------------------------------------
  markDirty(): void {
    this.dirty = true;
  }

  private frame(t: number): void {
    const w = this.w;
    if (!w) return;
    const animate = !this.reduceMotion;
    if (!this.dirty && !animate) return;
    this.dirty = false;
    const g = this.g;
    const cw = this.canvas.width / this.dpr;
    const ch = this.canvas.height / this.dpr;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#5a7a88';
    g.fillRect(0, 0, cw, ch);
    // Transformación mundo → pantalla.
    const z = this.cam.z;
    g.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (cw / 2 - this.cam.x * z), this.dpr * (ch / 2 - this.cam.y * z));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.base, 0, 0, WORLD_W, WORLD_H);
    g.drawImage(this.relief, 0, 0, WORLD_W, WORLD_H);
    this.drawRiver(g);
    this.drawRoutes(g, t);
    this.drawLayer(g, t);
    this.drawAtlas(g);
    this.drawGlyphs(g);
    this.drawParticles(g, animate);
    // Capa en coordenadas de pantalla (texto nítido a cualquier zoom).
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawMissions(g, t);
    this.drawLabels(g, t, animate);
    if (this.player) {
      const p = this.toScreen(this.player.x, this.player.y);
      const pulse = animate ? (Math.sin(t / 300) + 1) / 2 : 0.5;
      g.strokeStyle = `rgba(233,180,76,${0.4 + pulse * 0.5})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y, 10 + pulse * 6, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#e9b44c';
      g.strokeStyle = '#2b1e15';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.font = '700 13px Alegreya, Georgia, serif';
      g.textAlign = 'center';
      // Encima del marcador: debajo va el nombre del pueblo.
      g.textBaseline = 'bottom';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(244,233,206,0.9)';
      g.strokeText('Estás aquí', p.x, p.y - 18);
      g.fillStyle = '#2b1e15';
      g.fillText('Estás aquí', p.x, p.y - 18);
    }
    // Marco de pergamino: los bordes del mapa se oscurecen y amarillean.
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.frameTex || this.frameTex.width !== Math.round(cw) || this.frameTex.height !== Math.round(ch)) this.frameTex = parchmentFrame(Math.round(cw), Math.round(ch));
    g.drawImage(this.frameTex, 0, 0, cw, ch);
  }
  private frameTex: HTMLCanvasElement | null = null;

  private drawRiver(g: CanvasRenderingContext2D): void {
    if (this.riverPath.length < 2) return;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [width, color] of [[9, '#3e5868'], [5, '#7fa6b8']] as const) {
      g.beginPath();
      g.moveTo(this.riverPath[0].x, this.riverPath[0].y);
      for (let i = 1; i < this.riverPath.length; i++) g.lineTo(this.riverPath[i].x, this.riverPath[i].y);
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
    }
  }

  private routeCurve(a: { x: number; y: number }, b: { x: number; y: number }, id: number) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = ((id * 37) % 7) * 6 - 18;
    return { cx: mx + (-dy / len) * off, cy: my + (dx / len) * off };
  }

  private drawRoutes(g: CanvasRenderingContext2D, t: number): void {
    const w = this.w!;
    const d = hops(w, w.player.home);
    for (const route of w.routes) {
      const ia = w.intel[route.a];
      const ib = w.intel[route.b];
      if (ia.level === 0 && ib.level === 0) continue;
      const a = w.regions[route.a].center;
      const b = w.regions[route.b].center;
      const { cx, cy } = this.routeCurve(a, b, route.id);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo(cx, cy, b.x, b.y);
      const open = route.status === 'abierta';
      g.setLineDash(open ? [10, 8] : route.status === 'cerrada' ? [4, 6] : []);
      g.strokeStyle = open ? 'rgba(70,48,30,0.75)' : '#a3362b';
      g.lineWidth = open ? 3.2 : 4.5;
      g.stroke();
      g.setLineDash([]);
      if (!open) {
        // Marca de cierre en el centro.
        const mx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
        const my = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
        g.strokeStyle = '#a3362b';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(mx - 9, my - 9);
        g.lineTo(mx + 9, my + 9);
        g.moveTo(mx + 9, my - 9);
        g.lineTo(mx - 9, my + 9);
        g.stroke();
      } else if (!this.reduceMotion && (d[route.a] <= 1 || d[route.b] <= 1 || ia.observerStationed || ib.observerStationed)) {
        // Carros de comercio visibles cerca de casa.
        const n = Math.max(1, Math.round(route.traffic * 3));
        for (let i = 0; i < n; i++) {
          const s = ((t / 9000 + i / n + route.id * 0.13) % 1 + 1) % 1;
          const x = (1 - s) ** 2 * a.x + 2 * (1 - s) * s * cx + s * s * b.x;
          const y = (1 - s) ** 2 * a.y + 2 * (1 - s) * s * cy + s * s * b.y;
          g.fillStyle = '#f3e3b5';
          g.strokeStyle = '#4a3324';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, 4, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
    }
  }

  /** Capas estratégicas: relaciones y tratados, comercio y caravanas, guerras y protestas. Solo lo que sabes. */
  private drawLayer(g: CanvasRenderingContext2D, t: number): void {
    const w = this.w!;
    const pol = w.life?.politics;
    if (!pol || this.layer === 'normal') return;
    const known = (id: number) => w.regions[id].isHome || w.intel[id].level > 0;
    const seen = new Set<string>();
    if (this.layer === 'politica') {
      for (const r of w.regions) for (const idStr of Object.keys(r.relations)) {
        const id = Number(idStr);
        const key = `${Math.min(r.id, id)}-${Math.max(r.id, id)}`;
        if (seen.has(key) || !known(r.id) || !known(id)) continue;
        seen.add(key);
        const st = stanceOf(w, r.id, id);
        const a = r.center;
        const b = w.regions[id].center;
        const color = { amistad: '#4f8a3a', neutralidad: 'rgba(80,70,60,0.35)', tension: '#d08a2a', rivalidad: '#b0402a', alianza: '#2f6fb0', guerra: '#a01818' }[st];
        g.setLineDash(st === 'guerra' ? [6, 5] : st === 'neutralidad' ? [3, 6] : []);
        g.strokeStyle = color;
        g.lineWidth = st === 'alianza' || st === 'guerra' ? 6 : 4;
        g.beginPath();
        g.moveTo(a.x + (b.x - a.x) * 0.18, a.y + (b.y - a.y) * 0.18);
        g.lineTo(a.x + (b.x - a.x) * 0.82, a.y + (b.y - a.y) * 0.82);
        g.stroke();
        g.setLineDash([]);
        const tr = pol.treaties.filter((x) => !x.broken && x.until >= w.day && ((x.a === r.id && x.b === id) || (x.a === id && x.b === r.id)));
        if (tr.length) {
          g.font = '16px system-ui, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          drawInkRow(g, tr.map((x) => ({ comercio: '⚖', fronteras: '⛳', defensa: '🛡', recursos: '📦', alianza: '🤝', paz: '🕊' })[x.kind]), (a.x + b.x) / 2, (a.y + b.y) / 2, 20);
        }
      }
      for (const c of pol.claims) if (known(c.a) && known(c.b)) {
        const a = w.regions[c.a].center;
        const b = w.regions[c.b].center;
        g.font = '14px system-ui, sans-serif';
        drawInkIcon(g, '⚑', a.x * 0.4 + b.x * 0.6, a.y * 0.4 + b.y * 0.6, 18);
      }
    }
    if (this.layer === 'comercio') {
      const vol = (w.life!.society as unknown as { trade?: { volume: Record<string, number> } })?.trade?.volume ?? tradeOf(w).volume;
      for (const route of w.routes) {
        if (!known(route.a) && !known(route.b)) continue;
        const v = vol[`${Math.min(route.a, route.b)}-${Math.max(route.a, route.b)}`] ?? 0;
        if (v <= 0) continue;
        const a = w.regions[route.a].center;
        const b = w.regions[route.b].center;
        const { cx, cy } = this.routeCurve(a, b, route.id);
        g.strokeStyle = 'rgba(214,160,40,0.55)';
        g.lineWidth = Math.min(16, 3 + Math.sqrt(v) * 0.6);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.quadraticCurveTo(cx, cy, b.x, b.y);
        g.stroke();
      }
      for (const p of convoyPositions(w)) {
        if (!known(p.c.from) && !known(p.c.to)) continue;
        g.fillStyle = p.c.status === 'atacada' ? '#a3362b' : p.c.kind === 'jugador' ? '#e9b44c' : '#f3e3b5';
        g.strokeStyle = '#4a3324';
        g.lineWidth = 2;
        g.beginPath();
        g.rect(p.x * 2 - 6, p.y * 2 - 4, 12, 8);
        g.fill();
        g.stroke();
      }
    }
    if (this.layer === 'conflictos') {
      const pulse = this.reduceMotion ? 0.5 : (Math.sin(t / 300) + 1) / 2;
      for (const war of pol.wars.filter((x) => x.status === 'activa')) {
        if (!known(war.a) && !known(war.b)) continue;
        const f = w.regions[war.front].center;
        g.strokeStyle = `rgba(160,24,24,${0.4 + pulse * 0.5})`;
        g.lineWidth = 5;
        g.beginPath();
        g.arc(f.x, f.y, 34 + pulse * 8, 0, Math.PI * 2);
        g.stroke();
      }
      g.font = '18px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const r of w.regions) {
        if (!known(r.id)) continue;
        const icons: string[] = [];
        if (pol.wars.some((x) => x.status === 'activa' && x.front === r.id)) icons.push('⚔');
        if (pol.owner[r.id] !== undefined && pol.owner[r.id] !== r.id) icons.push('⛓');
        const orgs = pol.orgs.filter((o) => o.regionId === r.id && !o.dissolved && o.action);
        if (orgs.some((o) => o.action!.kind === 'motin')) icons.push('🔥');
        else if (orgs.length) icons.push('✊');
        if ((pol.rebellions[r.id]?.stage ?? 0) >= 2 && (w.intel[r.id].level >= 2 || r.isHome)) icons.push('🗡');
        if (pol.secrets.some((s) => s.known && !s.public && s.regionId === r.id)) icons.push('🗝');
        if (icons.length) drawInkRow(g, icons, r.center.x + 34, r.center.y - 30, 22);
      }
    }
  }

  /** Lo que la historia ha puesto en el mapa: asentamientos, ruinas, puertos y rutas por mar (solo lo que sabes). */
  private drawAtlas(g: CanvasRenderingContext2D): void {
    const w = this.w!;
    const a = w.life?.atlas;
    if (!a) return;
    const known = (id: number) => w.regions[id].isHome || w.intel[id].level > 0;
    // Rutas por mar: líneas discontinuas entre puertos.
    g.setLineDash([4, 6]);
    g.strokeStyle = 'rgba(40,70,110,0.55)';
    g.lineWidth = 3;
    for (const sr of a.seaRoutes) if (known(sr.a) && known(sr.b)) {
      const A = w.regions[sr.a].center;
      const B = w.regions[sr.b].center;
      g.beginPath();
      g.moveTo(A.x, A.y);
      g.quadraticCurveTo((A.x + B.x) / 2 + 60, (A.y + B.y) / 2, B.x, B.y);
      g.stroke();
    }
    g.setLineDash([]);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [id] of Object.entries(a.ports)) if (known(Number(id))) {
      const c = w.regions[Number(id)].center;
      g.font = '16px system-ui, sans-serif';
      drawInkIcon(g, '⚓', c.x - 30, c.y + 26, 20);
    }
    for (const s of a.settlements) {
      if (!known(s.regionId)) continue;
      const x = s.x * 2;
      const y = s.y * 2;
      if (s.state !== 'vivo') {
        drawInkIcon(g, '🏚', x, y, 16);
        continue;
      }
      const size = 3 + TIER_ORDER.indexOf(s.tier) * 2;
      g.fillStyle = s.byPlayer ? '#e9b44c' : '#f3e3b5';
      g.strokeStyle = '#4a3324';
      g.lineWidth = 2;
      g.beginPath();
      g.rect(x - size, y - size, size * 2, size * 2);
      g.fill();
      g.stroke();
      g.font = '600 11px Alegreya, Georgia, serif';
      g.fillStyle = '#2b1e15';
      g.fillText(s.name, x, y + size + 9);
    }
    for (const p of a.pois) if (p.found !== undefined) {
      g.font = '13px system-ui, sans-serif';
      drawInkIcon(g, { ruinas: '🏚', monumento: '🗿', batalla: '⚔', cueva: '🕳', oasis: '🌴', pecio: '⛵', cantera: '⛏' }[p.kind], p.x * 2, p.y * 2, 18);
    }
    // Nombres de los estados (capa «Estados»).
    if (this.layer === 'estados' && w.life?.society) for (const st of statesOf(w)) if (st.regions.length > 1 && known(st.capital)) {
      const c = w.regions[st.capital].center;
      g.font = '700 15px Alegreya, Georgia, serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(244,233,206,0.9)';
      g.strokeText(st.name, c.x, c.y + 44);
      g.fillStyle = '#3a2418';
      g.fillText(st.name, c.x, c.y + 44);
    }
  }

  private drawGlyphs(g: CanvasRenderingContext2D): void {
    const w = this.w!;
    g.strokeStyle = 'rgba(60,42,30,0.65)';
    g.lineWidth = 2;
    for (const r of w.regions) {
      if (w.intel[r.id].level === 0) continue;
      const res = RESOURCES[r.resource];
      const x = r.center.x - 46;
      const y = r.center.y + 34;
      g.beginPath();
      switch (res.glyph) {
        case 'olas':
          for (let i = 0; i < 2; i++) {
            g.moveTo(x - 12, y + i * 8);
            g.quadraticCurveTo(x - 6, y - 6 + i * 8, x, y + i * 8);
            g.quadraticCurveTo(x + 6, y + 6 + i * 8, x + 12, y + i * 8);
          }
          break;
        case 'campo':
          for (let i = -1; i <= 1; i++) {
            g.moveTo(x + i * 7, y + 10);
            g.lineTo(x + i * 7, y - 6);
            g.moveTo(x + i * 7, y - 2);
            g.lineTo(x + i * 7 + 4, y - 7);
          }
          break;
        case 'monte':
          g.moveTo(x - 14, y + 8);
          g.lineTo(x - 4, y - 10);
          g.lineTo(x + 4, y + 2);
          g.lineTo(x + 9, y - 5);
          g.lineTo(x + 16, y + 8);
          break;
        case 'bosque':
          for (let i = -1; i <= 1; i += 2) {
            g.moveTo(x + i * 7, y + 10);
            g.lineTo(x + i * 7, y + 2);
            g.moveTo(x + i * 7 - 6, y + 4);
            g.lineTo(x + i * 7, y - 10);
            g.lineTo(x + i * 7 + 6, y + 4);
            g.closePath();
          }
          break;
        case 'cristal':
          g.moveTo(x, y - 10);
          g.lineTo(x + 8, y);
          g.lineTo(x, y + 10);
          g.lineTo(x - 8, y);
          g.closePath();
          break;
        case 'pasto':
          for (let i = -2; i <= 2; i++) {
            g.moveTo(x + i * 5, y + 8);
            g.lineTo(x + i * 5 + (i % 2) * 3, y - 4);
          }
          break;
      }
      g.stroke();
    }
  }

  private drawParticles(g: CanvasRenderingContext2D, animate: boolean): void {
    const w = this.w!;
    if (animate) {
      for (const id of this.smokeAt) {
        if (Math.random() < 0.12) {
          const c = w.regions[id].center;
          this.particles.push({ x: c.x + 30 + Math.random() * 10, y: c.y - 10, vy: -0.5 - Math.random() * 0.4, life: 0, max: 120 + Math.random() * 60, r: 5 });
        }
      }
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const p of this.particles) {
      if (animate) {
        p.life++;
        p.y += p.vy;
        p.x += Math.sin(p.life / 14) * 0.3;
        p.r += 0.06;
      }
      const a = 0.45 * (1 - p.life / p.max);
      g.fillStyle = `rgba(80,74,70,${a})`;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawMissions(g: CanvasRenderingContext2D, t: number): void {
    const w = this.w!;
    const h = w.regions[w.player.home].center;
    for (const m of w.missions) {
      const r = w.regions[m.regionId].center;
      const span = Math.max(1, m.returnDay - m.start);
      const elapsed = w.day - m.start + (this.reduceMotion ? 0.5 : ((t / 4000) % 1) * 0.6);
      const k = Math.min(1, elapsed / span);
      // Ida (0..0.5) y vuelta (0.5..1).
      const s = k < 0.5 ? k * 2 : 2 - k * 2;
      const p = this.toScreen(h.x + (r.x - h.x) * s, h.y + (r.y - h.y) * s);
      g.fillStyle = '#f7efd9';
      g.strokeStyle = '#3a2a1f';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#3a2a1f';
      g.font = '600 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      drawInkIcon(g, m.kind === 'observar' ? '👁' : m.kind === 'espiar' ? '👂' : m.kind === 'investigar' ? '🔎' : m.kind === 'sabotaje' ? '🔥' : '✉', p.x, p.y, 14, false);
    }
  }

  private drawLabels(g: CanvasRenderingContext2D, t: number, animate: boolean): void {
    const w = this.w!;
    const pulse = animate ? (Math.sin(t / 380) + 1) / 2 : 0.5;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const r of w.regions) {
      const intel = w.intel[r.id];
      const p = this.toScreen(r.center.x, r.center.y);
      if (this.highlights.has(r.id)) {
        g.strokeStyle = `rgba(255,236,170,${0.35 + pulse * 0.5})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(p.x, p.y, 22 + pulse * 10, 0, Math.PI * 2);
        g.stroke();
      }
      if (r.id === this.selected) {
        g.strokeStyle = '#fff6d8';
        g.lineWidth = 3;
        g.setLineDash([6, 5]);
        g.beginPath();
        g.arc(p.x, p.y, 30, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      // Marcador central.
      g.fillStyle = r.isHome ? '#e9b44c' : intel.level === 0 ? '#9a948a' : '#f3e6c4';
      g.strokeStyle = '#2f2219';
      g.lineWidth = 2;
      g.beginPath();
      if (r.isHome) {
        g.moveTo(p.x, p.y - 12);
        g.lineTo(p.x + 11, p.y - 2);
        g.lineTo(p.x + 8, p.y + 9);
        g.lineTo(p.x - 8, p.y + 9);
        g.lineTo(p.x - 11, p.y - 2);
        g.closePath();
        g.fill();
        g.stroke();
      } else {
        // Un pueblo: dos casitas con tejado (o una sombra de casa si aún no lo conoces).
        for (const [dx, s0] of [[-4, 0.85], [4, 1]] as const) {
          const hx = p.x + dx;
          const sz = 6 * s0;
          g.beginPath();
          g.rect(hx - sz * 0.75, p.y - sz * 0.2, sz * 1.5, sz * 1.1);
          g.fill();
          g.stroke();
          g.beginPath();
          g.moveTo(hx - sz, p.y - sz * 0.15);
          g.lineTo(hx, p.y - sz * 1.15);
          g.lineTo(hx + sz, p.y - sz * 0.15);
          g.closePath();
          g.fillStyle = intel.level === 0 ? '#7a746a' : '#b0583a';
          g.fill();
          g.stroke();
          g.fillStyle = intel.level === 0 ? '#9a948a' : '#f3e6c4';
        }
      }
      // Nombre.
      const name = intel.level === 0 ? '¿?' : r.name;
      g.font = `${r.isHome ? 700 : 600} ${r.isHome ? 15 : 14}px Alegreya, Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      // Evita que las etiquetas se pisen: prueba debajo, más abajo y encima.
      const tw = g.measureText(name).width;
      let ly = p.y + 12;
      for (const off of [12, 30, -36, 48]) {
        const box = { x0: p.x - tw / 2 - 2, y0: p.y + off, x1: p.x + tw / 2 + 2, y1: p.y + off + 17 };
        ly = p.y + off;
        if (!placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
          placed.push(box);
          break;
        }
      }
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(244,233,206,0.92)';
      g.strokeText(name, p.x, ly);
      g.fillStyle = '#2b1e15';
      g.fillText(name, p.x, ly);
      // Iconos de estado según lo que se sabe.
      const icons: string[] = [];
      const f = intel.facts;
      if (intel.observerStationed) icons.push('👁');
      if (f.alimento && f.alimento.level <= 1) icons.push('🍂');
      if (f.tension && (f.tension.value === 'en guerra' || f.tension.level >= 3)) icons.push(f.tension.value === 'en guerra' ? '⚔' : '🔥');
      if (r.flags.guerra && intel.level > 0) icons.includes('⚔') || icons.push('⚔');
      if (w.petitions.some((x) => x.regionId === r.id)) icons.push('❗');
      if (w.rumors.some((x) => x.known && x.about === r.id && !x.investigated && w.day - x.day < 6)) icons.push('💬');
      if (icons.length) drawInkRow(g, icons, p.x, p.y - 24, 16);
    }
  }
}

/** Bordes de pergamino envejecido (se pinta una vez por tamaño de pantalla). */
function parchmentFrame(W: number, H: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, 'rgba(60,40,20,0)');
  v.addColorStop(0.75, 'rgba(70,46,22,0.18)');
  v.addColorStop(1, 'rgba(48,30,14,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  // Filete doble tinta y oro.
  g.strokeStyle = 'rgba(43,30,21,0.55)';
  g.lineWidth = 2;
  g.strokeRect(7, 7, W - 14, H - 14);
  g.strokeStyle = 'rgba(201,160,82,0.7)';
  g.lineWidth = 1;
  g.strokeRect(11, 11, W - 22, H - 22);
  // Rosa de los vientos en una esquina.
  const x = W - 46;
  const y = H - 96;
  g.save();
  g.translate(x, y);
  g.globalAlpha = 0.75;
  g.strokeStyle = 'rgba(43,30,21,0.8)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, 0, 20, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const L = i % 2 ? 13 : 26;
    g.fillStyle = i % 2 ? 'rgba(201,160,82,0.9)' : i === 0 ? 'rgba(160,50,30,0.95)' : 'rgba(43,30,21,0.85)';
    g.beginPath();
    g.moveTo(Math.cos(a) * L, Math.sin(a) * L);
    g.lineTo(Math.cos(a + 0.3) * 4, Math.sin(a + 0.3) * 4);
    g.lineTo(Math.cos(a - 0.3) * 4, Math.sin(a - 0.3) * 4);
    g.closePath();
    g.fill();
  }
  g.fillStyle = 'rgba(43,30,21,0.9)';
  g.font = '700 11px Alegreya, Georgia, serif';
  g.textAlign = 'center';
  g.fillText('N', 0, -30);
  g.restore();
  return c;
}

