import type { WorldState } from '../core/types';
import type { Layout } from '../world/layout';
import { passable } from '../world/path';
import { plazaLook, type PlazaLook } from '../visual/env/plaza';

/**
 * El mobiliario de los pueblos como obstáculo fino para el jugador (elipses en
 * teselas: la base de la fuente, de un banco, de un puesto) y el carácter de cada
 * plaza. Solo afecta al jugador en la escena: la simulación sigue usando teselas.
 */
export class Furniture {
  private solids = new Map<object, { x: number; y: number; rx: number; ry: number; tall?: number; wide?: number }[]>();
  private plazas = new Map<number, PlazaLook>();

  constructor(
    private w: () => WorldState,
    private l: () => Layout,
  ) {}

  /** Otra partida: los pueblos son otros. */
  clear(): void {
    this.solids.clear();
    this.plazas.clear();
  }

  /** El carácter de cada plaza (pavimento y adornos), elegido una vez por pueblo. */
  plazaOf(regionId: number): PlazaLook {
    const hit = this.plazas.get(regionId);
    if (hit) return hit;
    const v = this.l().villages[regionId];
    const r = this.w().regions[regionId];
    const taken: { x: number; y: number; r: number }[] = [{ x: v.cx + 0.5, y: v.cy + 1.3, r: 2.8 }, { x: v.sign.x + 1.2, y: v.sign.y + 0.4, r: 1.4 }];
    for (const st of v.stalls) taken.push({ x: st.x, y: st.y, r: 1.05 });
    for (const p of v.props) if (Math.hypot(p.x - v.cx, p.y - v.cy) < v.plazaR + 2) taken.push({ x: p.x, y: p.y - (p.kind === 'banco' ? 0.4 : 0), r: p.kind === 'banco' ? 1.15 : 0.7 });
    const look = plazaLook(this.w().seed, regionId, v.cx, v.cy, v.plazaR, !r.isHome && v.plazaR >= 6, taken, (x, y) => passable(this.w(), this.l(), x, y));
    this.plazas.set(regionId, look);
    return look;
  }

  /** Si aparece dentro de un mueble, se le lleva al sitio libre más cercano (preferiblemente delante). */
  unstick(me: { x: number; y: number }, wide = false): void {
    // El cuerpo ocupa algo más que un punto: se mira un poco a cada lado.
    // Al llegar, además, que no quede justo detrás de algo alto (farol, árbol, estandarte) que lo tape.
    const clear = (x: number, y: number) => !this.solidAt(x, y) && (!wide || (!this.solidAt(x - 0.35, y) && !this.solidAt(x + 0.35, y) && !this.solidAt(x, y - 0.3) && !this.hiddenAt(x, y)));
    if (clear(me.x, me.y)) return;
    const ok = (x: number, y: number) => clear(x, y) && passable(this.w(), this.l(), x, y);
    for (let r = 0.25; r <= 3; r += 0.25)
      for (let k = 0; k < 12; k++) {
        // Empieza por abajo (hacia la cámara) y gira a ambos lados.
        const a = Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = me.x + Math.cos(a) * r;
        const y = me.y + Math.sin(a) * r;
        if (ok(x, y)) {
          me.x = x;
          me.y = y;
          return;
        }
      }
  }

  /**
   * ¿Pisa (x, y) la base de una fuente, un banco, un puesto…? Las teselas bloqueadas
   * son demasiado gruesas para el mobiliario de la plaza: sin esto el jugador se metía
   * dentro de la fuente o atravesaba los bancos.
   */
  solidAt(x: number, y: number): boolean {
    for (const c of this.near(x, y)) {
      const ex = (x - c.x) / c.rx;
      const ey = (y - c.y) / c.ry;
      if (ex * ex + ey * ey < 1) return true;
    }
    return false;
  }

  /** ¿Taparía al jugador en (x, y) algo alto que está justo delante (más abajo en pantalla)? */
  hiddenAt(x: number, y: number): boolean {
    // `tall`: cuánto sube el objeto en teselas; `wide`: media anchura de lo que tapa (la copa de un árbol, el farol).
    for (const c of this.near(x, y)) if (c.tall && c.y > y && c.y - y < c.tall && Math.abs(c.x - x) < (c.wide ?? 0.6)) return true;
    return false;
  }

  private *near(x: number, y: number): Generator<{ x: number; y: number; rx: number; ry: number; tall?: number; wide?: number }> {
    for (const v of this.l().villages) {
      const reach = v.plazaR + 3;
      if (Math.abs(x - v.cx) > reach || Math.abs(y - v.cy) > reach) continue;
      let list = this.solids.get(v);
      if (!list) {
        const F: Partial<Record<string, [number, number, number]>> = {
          fuente: [1.85, 1.25, 0.2], pozo: [1.3, 0.7, 0.2], estatua: [1.2, 0.65, 0.15], banco: [1.25, 0.95, 0.2],
          cartel: [0.55, 0.38, 0.1], farol: [0.45, 0.32, 0.08], barril: [0.5, 0.28, 0.15], cajas: [0.85, 0.36, 0.2],
          carro: [1.7, 0.5, 0.3], abrevadero: [1.15, 0.32, 0.2], heno: [0.95, 0.42, 0.25], lenya: [0.9, 0.3, 0.15],
        };
        list = [];
        for (const p of v.props) {
          const f = F[p.kind];
          if (f) list.push({ x: p.x, y: p.y - f[2], rx: f[0], ry: f[1], tall: TALL[p.kind], wide: TALL[p.kind] && 0.7 });
        }
        for (const st of v.stalls) if (Math.hypot(st.x - (v.sign.x + 1.2), st.y - (v.sign.y + 0.4)) >= 2.6) list.push({ x: st.x, y: st.y - 0.45, rx: 1.25, ry: 0.55 });
        const D = { arbol: [0.75, 0.4], jardinera: [0.85, 0.3], mesa: [1.15, 0.4], estandarte: [0.25, 0.15] } as const;
        for (const d of this.plazaOf(v.regionId).decor) list.push({ x: d.x, y: d.y - 0.1, rx: D[d.kind][0], ry: D[d.kind][1], tall: d.kind === 'arbol' ? 3.2 : d.kind === 'estandarte' ? 2.4 : undefined, wide: d.kind === 'arbol' ? 1.5 : 0.6 });
        this.solids.set(v, list);
      }
      yield* list;
    }
  }
}

const TALL: Partial<Record<string, number>> = { farol: 2.4, cartel: 1.6, estatua: 2 };
