import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import type { WorldState } from '../core/types';
import type { Season } from '../world/clock';
import type { Layout } from '../world/layout';
import { idx, inside } from '../world/terrain';
import { T, TH, TILE, TW } from '../world/types';
import { geoOf } from '../world/geography';
import { VQ } from '../visual/quality';
import { materialTexture, MT, type Material } from '../visual/env/materials';

/** Material de detalle de cada tipo de tesela (0 = ninguno). */
const MATS: Material[] = ['hierba', 'hierba', 'pradera', 'bosque', 'surcos', 'camino', 'arcilla', 'adoquin', 'arena', 'sal', 'roca', 'barro', 'tablas'];
const MAT_OF: Partial<Record<number, number>> = { [T.Grass]: 1, [T.Meadow]: 2, [T.Forest]: 3, [T.Field]: 4, [T.Road]: 5, [T.Clay]: 6, [T.Plaza]: 7, [T.Sand]: 8, [T.Salt]: 9, [T.Rock]: 10, [T.Mountain]: 10, [T.Marsh]: 11, [T.Bridge]: 12 };
/** Muestras alrededor de un punto para saber si hay orilla cerca (desplazamiento x, y y peso). */
const SHORE: [number, number, number][] = [[3, 0, 1], [-3, 0, 1], [0, 3, 1], [0, -3, 1], [6, 0, 0.6], [-6, 0, 0.6], [0, 6, 0.6], [0, -6, 0.6], [10, 0, 0.3], [-10, 0, 0.3], [0, 10, 0.3], [0, -10, 0.3]];

/** Ruido de valor suave (0..1), determinista. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/**
 * Suelo del mundo dibujado por fragmentos (24×24 teselas) que se guardan en
 * caché. Solo se vuelven a pintar cuando cambia la estación o el estado de
 * los campos (hambre, abandono). Los árboles, rocas y montañas son objetos
 * aparte para poder ordenarlos en profundidad con las personas.
 */
export const CHUNK = 24;

const CPX = CHUNK * TILE;

export interface StaticObject {
  x: number; // píxeles de mundo (pies)
  y: number;
  kind: 'arbol' | 'roca' | 'pico' | 'junco' | 'arbusto' | 'mojon' | 'hierba' | 'flores';
  tree?: 'roble' | 'pino' | 'abedul' | 'sauce' | 'frutal';
  v: number;
  region: number;
}

interface ChunkEntry {
  key: string;
  canvas: HTMLCanvasElement;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}


export class ChunkCache {
  private chunks = new Map<string, ChunkEntry>();
  private baseCanvas?: HTMLCanvasElement;
  private tmpCanvas?: HTMLCanvasElement;
  private maskCanvas?: HTMLCanvasElement;
  private objects = new Map<string, StaticObject[]>();
  private grass: [number, number, number][] = [];
  constructor(private w: WorldState, private l: Layout) {
    // Cada región tiñe ligeramente su vegetación: las fronteras se notan sin dibujar líneas.
    this.grass = w.regions.map((r) => {
      const hue = (r.isHome ? PLAYER_CULTURE : CULTURES.find((c) => c.id === r.culture) ?? PLAYER_CULTURE).hue;
      const shift = ((hue % 60) - 30) * 0.12;
      // Verde natural, algo apagado; una tierra degradada amarillea.
      return hsl(88 + shift - (r.ecology < 0.5 ? 16 : 0), Math.max(22, Math.min(44, 36 + (r.ecology - 0.6) * 26)), 40);
    });
  }

  private nearVillage(tx: number, ty: number): boolean {
    return this.l.villages.some((v) => Math.hypot(v.cx - tx, v.cy - ty) < v.plazaR + 30);
  }

  setWorld(w: WorldState): void {
    this.w = w;
  }

  /** Clave común del estado visual (la estación); cada fragmento añade el de sus propias regiones. */
  stateKey(season: Season): string {
    return season;
  }

  /** Fragmentos pintados desde el arranque (la escena lo usa para no pintar dos en un fotograma). */
  paints = 0;
  /** Regiones donde está nevando ahora (lo decide la escena con el tiempo de cada región). */
  snowing = new Set<number>();
  private regionsIn = new Map<string, number[]>();
  /** Regiones que tocan un fragmento: solo su hambre o su abandono obligan a repintarlo. */
  private localKey(cx: number, cy: number): string {
    const id = `${cx},${cy}`;
    let regs = this.regionsIn.get(id);
    if (!regs) {
      const set = new Set<number>();
      const reg = this.l.terrain.region;
      for (let ty = cy * CHUNK; ty < Math.min(TH, cy * CHUNK + CHUNK); ty += 2) for (let tx = cx * CHUNK; tx < Math.min(TW, cx * CHUNK + CHUNK); tx += 2) set.add(reg[idx(tx, ty)]);
      regs = [...set].filter((r) => r >= 0);
      this.regionsIn.set(id, regs);
    }
    let k = '';
    for (const r of regs) {
      const R = this.w.regions[r];
      k += (R.flags.hambre ? 1 : 0) + (R.ecology < 0.42 ? 2 : 0) + (R.flags.invierno ? 4 : 0) + (this.snowing.has(r) ? 8 : 0);
    }
    return k;
  }

  has(cx: number, cy: number, stateKey: string): boolean {
    const hit = this.chunks.get(`${cx},${cy}`);
    return !!hit && hit.key === `${stateKey}:${this.localKey(cx, cy)}@${VQ().terrainRes}`;
  }

  /**
   * Precarga en los ratos libres: pinta como mucho un fragmento vecino que
   * falte (el más cercano a donde va la cámara), para que al cruzar una
   * frontera de fragmento no haya que pintar varios de golpe.
   */
  prewarm(cx: number, cy: number, dirX: number, dirY: number, season: Season, stateKey: string): boolean {
    const cand: [number, number, number][] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x * CHUNK >= TW || y * CHUNK >= TH) continue;
        if (this.has(x, y, stateKey)) continue;
        cand.push([x, y, Math.hypot(dx, dy) - (dx * dirX + dy * dirY) * 0.8]);
      }
    if (!cand.length) return false;
    cand.sort((a, b) => a[2] - b[2]);
    this.get(cand[0][0], cand[0][1], season, stateKey);
    return true;
  }

  get(cx: number, cy: number, season: Season, stateKey: string): HTMLCanvasElement {
    const id = `${cx},${cy}`;
    const res = VQ().terrainRes;
    const key = `${stateKey}:${this.localKey(cx, cy)}@${res}`;
    const hit = this.chunks.get(id);
    if (hit && hit.key === key) {
      // Recién usado: al final de la cola.
      this.chunks.delete(id);
      this.chunks.set(id, hit);
      return hit.canvas;
    }
    const canvas = hit?.canvas ?? document.createElement('canvas');
    this.paints++;
    this.paint(canvas, cx, cy, season, res);
    this.chunks.delete(id);
    this.chunks.set(id, { key, canvas });
    // Caben los visibles más un anillo de precarga (memoria: ~W² × 4 bytes cada uno).
    const max = { low: 10, medium: 12, high: 14, ultra: 14 }[VQ().tier];
    while (this.chunks.size > max) this.chunks.delete(this.chunks.keys().next().value!);
    return canvas;
  }

  /**
   * Pinta un fragmento de suelo. Primero el color continuo (una pasada por
   * píxel de mundo): cada material con su tono, manchas de color a dos
   * escalas, el relieve sombreado con luz del noroeste, orillas húmedas y
   * espuma, y bordes orgánicos entre materiales. Después, a la resolución
   * del nivel gráfico, el detalle de cada material (briznas, guijarros,
   * adoquines, grietas, surcos, tablones) solo donde ese material está.
   */
  private paint(canvas: HTMLCanvasElement, cx: number, cy: number, season: Season, res: number): void {
    const { tiles, elev, region } = this.l.terrain;
    // La capa base es suave (manchas, relieve, orillas): se calcula a media
    // resolución (una muestra cada 2 px de mundo) y se amplía con suavizado,
    // que además funde los bordes entre materiales. Cuatro veces menos trabajo.
    const BP = CPX / 2;
    const base = (this.baseCanvas ??= Object.assign(document.createElement('canvas'), { width: BP, height: BP }));
    const bg = base.getContext('2d', { willReadFrequently: true })!;
    const img = bg.createImageData(BP, BP);
    const d = img.data;
    const mats = new Uint8Array(BP * BP);
    // Nieve por región (no por fragmento): su borde sigue al de las regiones, ondulado.
    const snowReg = this.w.regions.map((_, i) => this.snowyRegion(i, season));
    const anySnow = snowReg.some(Boolean);
    const snowA = anySnow ? new Uint8Array(BP * BP) : null;
    const wx0 = cx * CPX;
    const wy0 = cy * CPX;
    const tileAt = (wx: number, wy: number) => tiles[idx(Math.max(0, Math.min(TW - 1, Math.floor(wx / TILE))), Math.max(0, Math.min(TH - 1, Math.floor(wy / TILE))))];
    // Tesela que «posee» un punto, con el borde ondulado por ruido suave.
    let otx = 0;
    let oty = 0;
    const ownerTile = (wx: number, wy: number) => {
      const jx = (vnoise(wx / 29 + 3.1, wy / 29) - 0.5) * 17 + (vnoise(wx / 9, wy / 9 + 7.7) - 0.5) * 5;
      const jy = (vnoise(wx / 29, wy / 29 + 9.4) - 0.5) * 17 + (vnoise(wx / 9 + 4.2, wy / 9) - 0.5) * 5;
      otx = Math.max(0, Math.min(TW - 1, Math.floor((wx + jx) / TILE)));
      oty = Math.max(0, Math.min(TH - 1, Math.floor((wy + jy) / TILE)));
    };
    // ¿Hay agua cerca de cada tesela? (para no consultar 12 teselas por muestra lejos de la costa)
    const tx0 = Math.max(0, cx * CHUNK - 1);
    const ty0 = Math.max(0, cy * CHUNK - 1);
    let anyWater = false;
    for (let ty = ty0; ty < Math.min(TH, ty0 + CHUNK + 2) && !anyWater; ty++) for (let tx = tx0; tx < Math.min(TW, tx0 + CHUNK + 2); tx++) if (tiles[idx(tx, ty)] === T.Sea || tiles[idx(tx, ty)] === T.Deep || tiles[idx(tx, ty)] === T.River) (anyWater = true);
    const elevAt = (wx: number, wy: number) => {
      const fx = wx / TILE - 0.5;
      const fy = wy / TILE - 0.5;
      const x0 = Math.max(0, Math.min(TW - 2, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(TH - 2, Math.floor(fy)));
      const ax = Math.max(0, Math.min(1, fx - x0));
      const ay = Math.max(0, Math.min(1, fy - y0));
      const e00 = elev[idx(x0, y0)];
      const e10 = elev[idx(x0 + 1, y0)];
      const e01 = elev[idx(x0, y0 + 1)];
      const e11 = elev[idx(x0 + 1, y0 + 1)];
      return (e00 * (1 - ax) + e10 * ax) * (1 - ay) + (e01 * (1 - ax) + e11 * ax) * ay;
    };
    const colCache = new Map<number, [number, number, number]>();
    const colorOf = (tx: number, ty: number) => {
      const k = idx(tx, ty);
      let c = colCache.get(k);
      if (!c) colCache.set(k, (c = this.tileColor(tx, ty, season)));
      return c;
    };
    const isWater = (t: number) => t === T.Sea || t === T.Deep || t === T.River;
    for (let py = 0; py < BP; py++) {
      const wy = wy0 + py * 2 + 1;
      for (let px = 0; px < BP; px++) {
        const wx = wx0 + px * 2 + 1;
        ownerTile(wx, wy);
        const k = idx(otx, oty);
        const t = tiles[k];
        const c = colorOf(otx, oty);
        let r = c[0];
        let g = c[1];
        let b = c[2];
        const n1 = vnoise(wx / 70, wy / 70);
        const n2 = vnoise(wx / 17 + 11, wy / 17 + 5);
        const q = (py * BP + px) * 4;
        if (isWater(t)) {
          // Profundidad: más clara y turquesa cerca de la orilla.
          let near = 0;
          for (const [dx, dy, w] of SHORE) if (!isWater(tileAt(wx + dx, wy + dy))) near = Math.max(near, w);
          const deep = t === T.Deep ? 1 : 0;
          r = r * (1 - near * 0.15) + 90 * near * 0.6;
          g = g * (1 - near * 0.1) + 160 * near * 0.5;
          b = b * (1 - near * 0.05) + 170 * near * 0.4;
          const wave = 0.94 + n2 * 0.1 - deep * 0.04;
          r *= wave;
          g *= wave;
          b *= wave;
          if (near > 0.95) (r = 214), (g = 230), (b = 228); // espuma
          mats[py * BP + px] = 0;
        } else {
          // Manchas de color: zonas más amarillas y secas, otras más frescas y frías.
          const warm = (n1 - 0.5) * 0.22;
          const fine = (n2 - 0.5) * 0.12;
          const k2 = 1 + fine;
          r = r * k2 * (1 + warm * 0.9);
          g = g * k2 * (1 + warm * 0.25);
          b = b * k2 * (1 - warm * 0.8);
          // Relieve: luz del noroeste.
          const e = elevAt(wx, wy);
          const ex = elevAt(wx + 6, wy) - e;
          const ey = elevAt(wx, wy + 6) - e;
          const steep = t === T.Mountain || t === T.Rock ? 0.05 : 0.028;
          const shade = Math.max(-0.28, Math.min(0.22, -(ex + ey) * steep));
          if (shade > 0) (r += (255 - r) * shade * 0.6), (g += (255 - g) * shade * 0.55), (b += (255 - b) * shade * 0.35);
          else (r *= 1 + shade), (g *= 1 + shade * 0.95), (b *= 1 + shade * 0.7);
          // Orilla húmeda.
          let wet = 0;
          if (anyWater) for (const [dx, dy, w] of SHORE) if (isWater(tileAt(wx + dx, wy + dy))) wet = Math.max(wet, w);
          if (wet > 0) (r *= 1 - wet * 0.22), (g *= 1 - wet * 0.18), (b *= 1 - wet * 0.08);
          // Desgaste de las plazas: más oscuras y sucias en manchas grandes.
          if (t === T.Plaza) {
            const wear = vnoise(wx / 40 + 5, wy / 40 + 2);
            const dk = 0.9 + wear * 0.14;
            (r *= dk), (g *= dk), (b *= dk * 0.98);
          }
          mats[py * BP + px] = MAT_OF[t] ?? 0;
          const rg = region[k];
          if (snowA && rg >= 0 && snowReg[rg]) {
            // Más fina en caminos y plazas (pisada), con claros donde el viento la barre.
            const trod = t === T.Road || t === T.Plaza || t === T.Bridge ? 0.78 : 1;
            const patch = vnoise(wx / 21 + 13, wy / 21 + 7);
            const fine = vnoise(wx / 5 + 3, wy / 5 + 9);
            snowA[py * BP + px] = Math.round(255 * Math.max(0, Math.min(1, (0.7 + patch * 0.5 - (trod < 1 ? fine * 0.25 : 0)) * trod)));
          }
        }
        d[q] = r;
        d[q + 1] = g;
        d[q + 2] = b;
        d[q + 3] = 255;
      }
    }
    // Bordes de plaza y de camino: una sombra suave donde el empedrado se
    // encuentra con la hierba (bordillo), en vez de un corte de papel.
    const PL = MAT_OF[T.Plaza]!;
    for (let py = 1; py < BP - 1; py++)
      for (let px = 1; px < BP - 1; px++) {
        const i = py * BP + px;
        if (mats[i] !== PL) continue;
        if (mats[i - 1] !== PL || mats[i + 1] !== PL || mats[i - BP] !== PL || mats[i + BP] !== PL) {
          const q = i * 4;
          d[q] *= 0.8;
          d[q + 1] *= 0.8;
          d[q + 2] *= 0.82;
        }
      }
    bg.putImageData(img, 0, 0);
    const W = Math.round(CPX * res);
    canvas.width = W;
    canvas.height = W;
    const fg = canvas.getContext('2d')!;
    fg.imageSmoothingEnabled = true;
    fg.imageSmoothingQuality = 'high';
    fg.drawImage(base, 0, 0, W, W);
    // Detalle de cada material, recortado a donde está.
    const present = new Set<number>();
    for (let i = 0; i < mats.length; i += 3) if (mats[i]) present.add(mats[i]);
    const tmp = (this.tmpCanvas ??= document.createElement('canvas'));
    tmp.width = W;
    tmp.height = W;
    const tg = tmp.getContext('2d')!;
    const mask = (this.maskCanvas ??= Object.assign(document.createElement('canvas'), { width: BP, height: BP }));
    const mg = mask.getContext('2d', { willReadFrequently: true })!;
    const mimg = mg.createImageData(BP, BP);
    tg.imageSmoothingEnabled = true;
    for (const m of present) {
      const name = MATS[m];
      const md = mimg.data;
      for (let i = 0; i < mats.length; i++) md[i * 4 + 3] = mats[i] === m ? 255 : 0;
      mg.putImageData(mimg, 0, 0);
      const texc = materialTexture(name, res, season);
      tg.globalCompositeOperation = 'source-over';
      tg.clearRect(0, 0, W, W);
      const pat = tg.createPattern(texc, 'repeat')!;
      const off = MT * res;
      pat.setTransform(new DOMMatrix().translate(-((wx0 * res) % off), -((wy0 * res) % off)));
      tg.fillStyle = pat;
      tg.fillRect(0, 0, W, W);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(mask, 0, 0, W, W);
      fg.globalAlpha = name === 'adoquin' || name === 'tablas' ? 0.92 : 1;
      fg.drawImage(tmp, 0, 0);
      fg.globalAlpha = 1;
    }
    if (snowA) {
      // Manto de nieve (una sola pasada), con su textura de ventisqueros.
      const md = mimg.data;
      for (let i = 0; i < snowA.length; i++) md[i * 4 + 3] = snowA[i];
      mg.putImageData(mimg, 0, 0);
      const off = MT * res;
      tg.globalCompositeOperation = 'source-over';
      tg.clearRect(0, 0, W, W);
      tg.fillStyle = 'rgba(234,240,248,0.9)';
      tg.fillRect(0, 0, W, W);
      const sp = tg.createPattern(materialTexture('nieve', res, season), 'repeat')!;
      sp.setTransform(new DOMMatrix().translate(-((wx0 * res) % off), -((wy0 * res) % off)));
      tg.fillStyle = sp;
      tg.fillRect(0, 0, W, W);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(mask, 0, 0, W, W);
      fg.drawImage(tmp, 0, 0);
    }
  }

  /** ¿Hay nieve en el suelo de esta región? Tierras frías en invierno, inviernos largos, o nevando ahora. */
  snowyRegion(reg: number, season: Season): boolean {
    if (this.snowing.has(reg)) return true;
    return season === 'invierno' && (geoOf(this.w, reg).climate === 'frio' || this.w.regions.some((r) => r.flags.invierno));
  }

  private tileColor(tx: number, ty: number, season: Season): [number, number, number] {
    const { tiles, region } = this.l.terrain;
    const k = idx(tx, ty);
    const t = tiles[k];
    const reg = region[k];
    const r = reg >= 0 ? this.w.regions[reg] : undefined;
    let base: [number, number, number];
    switch (t) {
      case T.Deep:
        base = [28, 66, 92];
        break;
      case T.Sea:
        base = [40, 98, 122];
        break;
      case T.River:
        base = [52, 112, 132];
        break;
      case T.Sand:
        base = [214, 196, 150];
        break;
      case T.Salt:
        base = [226, 222, 210];
        break;
      case T.Clay:
        base = [170, 112, 78];
        break;
      case T.Rock:
        base = [138, 132, 124];
        break;
      case T.Mountain:
        base = [112, 106, 102];
        break;
      case T.Marsh:
        base = [88, 112, 82];
        break;
      case T.Road:
        base = [168, 142, 104];
        break;
      case T.Bridge:
        base = [128, 96, 62];
        break;
      case T.Plaza:
        base = [170, 160, 140];
        break;
      case T.Forest:
        base = r ? (this.grass[reg].map((c) => c * 0.66) as [number, number, number]) : [70, 104, 60];
        break;
      case T.Meadow:
        base = r ? (this.grass[reg].map((c, n) => c * (n === 1 ? 1.05 : 1.03)) as [number, number, number]) : [150, 172, 100];
        break;
      case T.Field:
        base = fieldColor(season, !!r?.flags.hambre);
        break;
      default:
        base = r ? this.grass[reg] : [120, 150, 88];
    }
    const greenish = t === T.Grass || t === T.Meadow || t === T.Forest;
    if (season === 'primavera' && greenish) base = [base[0] * 0.96, base[1] * 1.04, base[2] * 0.95];
    if (season === 'otoño' && greenish) base = [base[0] * 1.16, base[1] * 0.96, base[2] * 0.72];
    if (season === 'invierno' && greenish) base = [base[0] * 0.86 + 20, base[1] * 0.84 + 18, base[2] * 0.9 + 26];
    if (r && r.ecology < 0.42 && greenish) base = [base[0] * 1.06 + 12, base[1] * 0.9, base[2] * 0.82];
    return base;
  }

  /** Objetos estáticos (árboles, rocas, montañas, juncos, mojones) de un fragmento. */
  objectsOf(cx: number, cy: number): StaticObject[] {
    const id = `${cx},${cy}`;
    const hit = this.objects.get(id);
    if (hit) return hit;
    const out: StaticObject[] = [];
    const { tiles, region, variant } = this.l.terrain;
    for (let j = 0; j < CHUNK; j++)
      for (let i = 0; i < CHUNK; i++) {
        const tx = cx * CHUNK + i;
        const ty = cy * CHUNK + j;
        if (!inside(tx, ty)) continue;
        const k = idx(tx, ty);
        if (this.l.blocked[k]) continue;
        const t = tiles[k];
        const v = variant[k];
        const reg = region[k];
        const ox = tx * TILE + 3 + (v % 10);
        const oy = ty * TILE + 4 + ((v >> 4) % 10);
        const p = v / 255;
        // Variedad: el tipo de árbol depende de la región y de lo que hay cerca.
        const nearWater = tiles[idx(Math.min(TW - 1, tx + 2), ty)] === T.River || tiles[idx(Math.max(0, tx - 2), ty)] === T.River || tiles[idx(tx, Math.min(TH - 1, ty + 2))] === T.River;
        const res = reg >= 0 ? this.w.regions[reg].resource : 'grano';
        const v2 = (v * 7) & 255;
        const kindOf = (): StaticObject['tree'] =>
          nearWater && v2 < 120 ? 'sauce' : res === 'hierro' || res === 'ambar' ? (v2 % 3 ? 'pino' : 'roble') : res === 'hierbas' ? (v2 % 4 === 0 ? 'abedul' : 'roble') : v2 % 6 === 0 ? 'abedul' : v2 % 9 === 0 ? 'pino' : 'roble';
        // Bosque con claros: la densidad sigue un ruido amplio (bosquetes espesos y calveros con luz).
        const grove = vnoise(tx / 7 + 31, ty / 7 + 17);
        const dens = grove < 0.33 ? 0.02 : grove < 0.5 ? 0.08 : 0.15;
        if (t === T.Forest && p < dens) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg, tree: kindOf() });
        else if (t === T.Forest && grove < 0.33 && p > 0.82) out.push({ x: ox, y: oy, kind: v % 3 ? 'hierba' : 'flores', v, region: reg });
        else if ((t === T.Grass || t === T.Meadow) && p < 0.018) out.push({ x: ox, y: oy, kind: 'arbol', v, region: reg, tree: this.nearVillage(tx, ty) ? 'frutal' : kindOf() });
        else if ((t === T.Grass || t === T.Meadow) && p > 0.965) out.push({ x: ox, y: oy, kind: 'arbusto', v, region: reg });
        else if ((t === T.Grass || t === T.Meadow) && p > 0.9) out.push({ x: ox, y: oy, kind: v % 3 ? 'hierba' : 'flores', v, region: reg });
        else if (t === T.Forest && p > 0.9) out.push({ x: ox, y: oy, kind: 'arbusto', v, region: reg });
        else if (t === T.Rock && p < 0.08) out.push({ x: ox, y: oy, kind: 'roca', v, region: reg });
        else if (t === T.Mountain && (tx + (ty % 2) * 2) % 4 === 0 && ty % 3 === 0 && v > 70) out.push({ x: tx * TILE + (v % 32) - 8, y: ty * TILE + 4 + ((v >> 3) % 16), kind: 'pico', v: (v * 13) >> 2, region: reg });
        else if (t === T.Marsh && p < 0.22) out.push({ x: ox, y: oy, kind: 'junco', v, region: reg });
        // Mojones en las fronteras (sin líneas: piedras viejas que marcan el límite).
        if (reg >= 0 && v < 30 && (t === T.Grass || t === T.Meadow)) {
          const right = tx + 1 < TW ? region[idx(tx + 1, ty)] : reg;
          const down = ty + 1 < TH ? region[idx(tx, ty + 1)] : reg;
          if ((right >= 0 && right !== reg) || (down >= 0 && down !== reg)) out.push({ x: tx * TILE + 8, y: ty * TILE + 12, kind: 'mojon', v, region: reg });
        }
      }
    out.sort((a, b) => a.y - b.y);
    this.objects.set(id, out);
    if (this.objects.size > 80) this.objects.delete(this.objects.keys().next().value!);
    return out;
  }
}

function fieldColor(season: Season, hungry: boolean): [number, number, number] {
  if (hungry) return [150, 118, 82];
  switch (season) {
    case 'primavera':
      return [128, 98, 66];
    case 'verano':
      return [190, 160, 84];
    case 'otoño':
      return [172, 128, 70];
    default:
      return [150, 128, 104];
  }
}
