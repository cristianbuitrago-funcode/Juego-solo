import type { WorldState } from '../core/types';
import { stallShown, type Layout } from '../world/layout';
import { passable } from '../world/path';
import { plazaLook, type PlazaLook } from '../visual/env/plaza';
import { FOOT, keepOf, type Footprint } from './footprints';

/**
 * El mobiliario de los pueblos como obstáculo fino para el jugador (elipses en
 * teselas: la base de la fuente, de un banco, de un puesto) y el carácter de cada
 * plaza. Solo afecta al jugador en la escena: la simulación sigue usando teselas.
 */
export class Furniture {
  private solids = new Map<object, Solid[]>();
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
    for (const st of v.stalls) taken.push({ x: st.x, y: st.y, r: keepOf('puesto') });
    for (const p of v.props) if (Math.hypot(p.x - v.cx, p.y - v.cy) < v.plazaR + 2) taken.push({ x: p.x, y: p.y - (p.kind === 'banco' ? 0.4 : 0), r: keepOf(p.kind) });
    const look = plazaLook(this.w().seed, regionId, v.cx, v.cy, v.plazaR, !r.isHome && v.plazaR >= 6, taken, (x, y) => passable(this.w(), this.l(), x, y));
    this.plazas.set(regionId, look);
    return look;
  }

  /** Si aparece dentro de un mueble, se le lleva al sitio libre más cercano (preferiblemente delante). */
  unstick(me: { x: number; y: number }, wide = false, extra?: (x: number, y: number) => boolean): void {
    // El cuerpo ocupa algo más que un punto: se mira un poco a cada lado.
    // Al llegar, además, que no quede justo detrás de algo alto (farol, árbol, estandarte) que lo tape.
    const clear = (x: number, y: number) => !this.solidAt(x, y) && (!wide || (!this.solidAt(x - 0.35, y) && !this.solidAt(x + 0.35, y) && !this.solidAt(x, y - 0.3) && !this.hiddenAt(x, y))) && (!extra || extra(x, y));
    if (clear(me.x, me.y)) return;
    const ok = (x: number, y: number) => clear(x, y) && passable(this.w(), this.l(), x, y);
    for (let r = 0.25; r <= (wide ? 5 : 3); r += 0.25)
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
  hiddenAt(x: number, y: number, front = true): boolean {
    // `tall`: cuánto sube el objeto en teselas; `wide`: media anchura de lo que tapa (la copa de un árbol, el farol).
    for (const c of this.near(x, y)) {
      if (c.tall && c.y > y && c.y - y < c.tall && Math.abs(c.x - x) < (c.wide ?? 0.6)) return true;
      // Y al revés: plantado justo delante de un puesto, taparía a quien atiende detrás.
      if (front && c.front && c.y < y && y - c.y < c.front && Math.abs(c.x - x) < c.rx + 0.4) return true;
    }
    return false;
  }

  /**
   * ¿Hay algo alto (farol, cartel, árbol…) pegado a (x, y) por delante o por detrás? Un
   * cuerpo ancho (un animal) ahí queda con el poste saliéndole del lomo.
   */
  tallNear(x: number, y: number, half: number, reach = 0.9): boolean {
    for (const c of this.near(x, y)) if (c.tall && Math.abs(c.y - y) < reach && Math.abs(c.x - x) < half + (c.wide ?? Math.min(0.35, c.rx))) return true;
    return false;
  }

  /** ¿Taparía (o cortaría) algo alto a una persona de pie en (x, y), por detrás o a su misma altura? */
  blocksPerson(x: number, y: number): boolean {
    return this.hiddenAt(x, y, false) || this.tallNear(x, y, 0.3, 0.6);
  }

  private *near(x: number, y: number): Generator<Solid> {
    for (const v of this.l().villages) {
      const reach = v.plazaR + 3;
      if (Math.abs(x - v.cx) > reach || Math.abs(y - v.cy) > reach) continue;
      let list = this.solids.get(v);
      if (!list) {
        const at = (x: number, y: number, f: Footprint): Solid => ({ x, y: y - f.dy, rx: f.rx, ry: f.ry, tall: f.tall, wide: f.wide, front: f.front });
        list = [];
        for (const p of v.props) if (FOOT[p.kind]) list.push(at(p.x, p.y, FOOT[p.kind]));
        for (const st of v.stalls) if (stallShown(v, st)) list.push(at(st.x, st.y, FOOT.puesto));
        const look = this.plazaOf(v.regionId);
        for (const d of look.decor) list.push(at(d.x, d.y, FOOT[d.kind]));
        // Las guirnaldas no estorban al andar, pero su cuerda cruza la cara de quien se para
        // justo detrás de la línea de faroles: cuentan como algo alto y sin huella.
        for (const [a, b] of look.garlands) {
          const la = v.lamps[a];
          const lb = v.lamps[b];
          if (!la || !lb) continue;
          const n = Math.max(1, Math.ceil(Math.hypot(lb.x - la.x, lb.y - la.y) / 0.6));
          for (let i = 1; i < n; i++) list.push({ x: la.x + ((lb.x - la.x) * i) / n, y: la.y + ((lb.y - la.y) * i) / n, rx: 1e-6, ry: 1e-6, tall: 2.4, wide: 0.45, front: 2.4 }); // (por delante, la cuerda queda justo detrás de la cabeza)
        }
        this.solids.set(v, list);
      }
      yield* list;
    }
  }
}

type Solid = { x: number; y: number; rx: number; ry: number; tall?: number; wide?: number; front?: number };

/**
 * Último paso de colocación de la gente de la escena, después de todos los empujes: nadie se
 * queda dentro de un mueble (la fuente, un puesto), encima de otra persona quieta ni pegado al
 * jugador. Si pasa, se le lleva al sitio libre más cercano.
 */
export function settlePeople(
  people: { x: number; y: number; moving: boolean }[],
  me: { x: number; y: number },
  furniture: Pick<Furniture, 'solidAt' | 'unstick' | 'blocksPerson'>,
  passable: (x: number, y: number) => boolean,
  /** Figuras que no se mueven de su sitio (quien atiende un puesto): se cuentan, pero no se apartan. */
  fixed: { x: number; y: number }[] = [],
): void {
  // En pantalla una figura mide unas 2 casillas de alto: quien está detrás (más arriba) asoma
  // por encima de la cabeza de quien tiene delante aunque en el suelo estén a una casilla.
  const overlaps = (ax: number, ay: number, bx: number, by: number, w: number) => Math.abs(ax - bx) < w && (by < ay ? ay - by < 1.8 : by - ay < 0.9);
  const still = (e: object) => [...fixed, ...people.filter((o) => o !== e && !o.moving)];
  for (const e of people) {
    const others = still(e);
    const free = (x: number, y: number) => !overlaps(me.x, me.y, x, y, 0.8) && passable(x, y) && !furniture.blocksPerson(x, y) && !others.some((o) => overlaps(o.x, o.y, x, y, 0.65));
    const inside = furniture.solidAt(e.x, e.y);
    if (e.moving && !inside) {
      // Quien pasa de largo no salta de sitio: se abre un poco de lado mientras cruza por
      // detrás de alguien (o de un farol), para no quedar «sentado» en su cabeza.
      const hit = others.find((o) => overlaps(o.x, o.y, e.x, e.y, 0.65)) ?? (furniture.blocksPerson(e.x, e.y) ? { x: e.x - 0.01, y: e.y } : null);
      if (hit) {
        const nx = e.x + (e.x >= hit.x ? 0.09 : -0.09);
        if (passable(nx, e.y) && !furniture.solidAt(nx, e.y)) e.x = nx;
      }
      continue;
    }
    const onMe = overlaps(me.x, me.y, e.x, e.y, 0.8);
    // De dos que se tapan, se aparta el de atrás (el de arriba en pantalla); de un fijo, siempre el otro.
    const onOther =
      fixed.some((o) => overlaps(o.x, o.y, e.x, e.y, 0.65)) ||
      people.some((o) => o !== e && !o.moving && Math.abs(o.x - e.x) < 0.6 && e.y <= o.y && o.y - e.y < 1.8 && (e.y < o.y || e.x < o.x));
    const hidden = furniture.blocksPerson(e.x, e.y);
    if (inside || onMe || onOther || hidden) furniture.unstick(e, false, free);
  }
}
