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
  private solids = new Map<object, { x: number; y: number; rx: number; ry: number }[]>();
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
    for (const st of v.stalls) taken.push({ x: st.x, y: st.y, r: 1.2 });
    for (const p of v.props) if (Math.hypot(p.x - v.cx, p.y - v.cy) < v.plazaR + 2) taken.push({ x: p.x, y: p.y, r: p.kind === 'banco' ? 1.3 : 0.8 });
    const look = plazaLook(this.w().seed, regionId, v.cx, v.cy, v.plazaR, !r.isHome && v.plazaR >= 6, taken, (x, y) => passable(this.w(), this.l(), x, y));
    this.plazas.set(regionId, look);
    return look;
  }

  /** Si aparece dentro de un mueble, se le aparta hacia abajo (hacia la cámara). */
  unstick(me: { x: number; y: number }): void {
    for (let i = 0; i < 16 && this.solidAt(me.x, me.y) && passable(this.w(), this.l(), me.x, me.y + 0.15); i++) me.y += 0.15;
  }

  /**
   * ¿Pisa (x, y) la base de una fuente, un banco, un puesto…? Las teselas bloqueadas
   * son demasiado gruesas para el mobiliario de la plaza: sin esto el jugador se metía
   * dentro de la fuente o atravesaba los bancos.
   */
  solidAt(x: number, y: number): boolean {
    for (const v of this.l().villages) {
      const reach = v.plazaR + 3;
      if (Math.abs(x - v.cx) > reach || Math.abs(y - v.cy) > reach) continue;
      let list = this.solids.get(v);
      if (!list) {
        const F: Partial<Record<string, [number, number, number]>> = {
          fuente: [1.85, 1.25, 0.2], pozo: [1.3, 0.7, 0.2], estatua: [1.2, 0.65, 0.15], banco: [1.25, 0.66, 0.4],
          cartel: [0.3, 0.2, 0.05], farol: [0.25, 0.18, 0.05], barril: [0.5, 0.28, 0.15], cajas: [0.85, 0.36, 0.2],
          carro: [1.7, 0.5, 0.3], abrevadero: [1.15, 0.32, 0.2], heno: [0.95, 0.42, 0.25], lenya: [0.9, 0.3, 0.15],
        };
        list = [];
        for (const p of v.props) {
          const f = F[p.kind];
          if (f) list.push({ x: p.x, y: p.y - f[2], rx: f[0], ry: f[1] });
        }
        for (const st of v.stalls) list.push({ x: st.x, y: st.y - 0.45, rx: 1.25, ry: 0.55 });
        const D = { arbol: [0.75, 0.4], jardinera: [0.85, 0.3], mesa: [1.15, 0.4], estandarte: [0.25, 0.15] } as const;
        for (const d of this.plazaOf(v.regionId).decor) list.push({ x: d.x, y: d.y - 0.1, rx: D[d.kind][0], ry: D[d.kind][1] });
        this.solids.set(v, list);
      }
      for (const c of list) {
        const ex = (x - c.x) / c.rx;
        const ey = (y - c.y) / c.ry;
        if (ex * ex + ey * ey < 1) return true;
      }
    }
    return false;
  }
}
