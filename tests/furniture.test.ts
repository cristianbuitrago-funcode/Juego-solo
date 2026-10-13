import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { getLayout, stallShown, vendorSpot } from '../src/world/layout';
import { passable } from '../src/world/path';
import { Furniture, settlePeople } from '../src/render/furniture';

describe('mobiliario de las plazas', () => {
  it('al llegar a cualquier punto de una plaza, el jugador queda libre y a la vista', () => {
    for (const seed of [4242, 7, 90210]) {
      const w = createWorld(seed);
      const l = getLayout(w);
      const f = new Furniture(() => w, () => l);
      let tried = 0;
      for (const v of l.villages)
        for (let dy = -v.plazaR; dy <= v.plazaR; dy += 0.7)
          for (let dx = -v.plazaR; dx <= v.plazaR; dx += 0.7) {
            const me = { x: v.cx + 0.5 + dx, y: v.cy + 0.5 + dy };
            if (!passable(w, l, me.x, me.y)) continue;
            tried++;
            f.unstick(me, true);
            expect(f.solidAt(me.x, me.y), `${seed} ${v.regionId} ${dx},${dy}`).toBe(false);
            expect(f.hiddenAt(me.x, me.y), `${seed} ${v.regionId} ${dx},${dy}`).toBe(false);
          }
      expect(tried).toBeGreaterThan(100);
    }
  });
});

describe('colocación final de la gente', () => {
  it('nadie queda dentro de un mueble, encima de otra persona quieta ni pegado al jugador', () => {
    for (const seed of [4242, 7, 90210]) {
      const w = createWorld(seed);
      const l = getLayout(w);
      const f = new Furniture(() => w, () => l);
      const ok = (x: number, y: number) => passable(w, l, x, y);
      let checked = 0;
      for (const v of l.villages) {
        const me = { x: v.cx + 0.5, y: v.cy + v.plazaR - 0.5 };
        f.unstick(me, true);
        // Gente a propósito en sitios malos: en la fuente, apiñada y encima del jugador.
        const people: { x: number; y: number; moving: boolean }[] = [];
        for (let i = 0; i < 12; i++) {
          const a = (i * 2.399) % (Math.PI * 2);
          const d = (i % 6) * 0.45;
          people.push({ x: v.cx + 0.5 + Math.cos(a) * d, y: v.cy + 0.5 + Math.sin(a) * d * 0.7, moving: false });
        }
        people.push({ x: me.x + 0.2, y: me.y, moving: false }, { x: me.x, y: me.y - 0.3, moving: false });
        // Quien atiende el primer puesto: fijo, los demás se apartan de él.
        const fixed = v.stalls.slice(0, 1).map((st) => ({ x: st.x, y: st.y - 0.55 }));
        for (const fx of fixed) people.push({ x: fx.x + 0.1, y: fx.y - 1, moving: false });
        for (let k = 0; k < 4; k++) settlePeople(people, me, f, ok, fixed);
        for (const p of people) {
          if (!ok(p.x, p.y)) continue; // sin sitio en 3 casillas (no pasa en estas plazas, pero no es lo que se mide)
          checked++;
          const at = `${seed} ${v.regionId} ${p.x.toFixed(2)},${p.y.toFixed(2)}`;
          expect(f.solidAt(p.x, p.y), at).toBe(false);
          // En pantalla: una figura mide ~2 casillas; quien está detrás no puede asomar por encima de otra.
          const covers = (a: { x: number; y: number }, b: { x: number; y: number }, w: number) => Math.abs(a.x - b.x) < w && (b.y < a.y ? a.y - b.y < 1.8 : b.y - a.y < 0.9);
          expect(covers(me, p, 0.8), at).toBe(false);
          expect(people.some((o) => o !== p && Math.abs(o.x - p.x) < 0.6 && Math.abs(o.y - p.y) < 1.8), at).toBe(false);
          expect(f.blocksPerson(p.x, p.y), at).toBe(false);
          expect(fixed.some((o) => covers(o, p, 0.65)), at).toBe(false);
        }
      }
      expect(checked).toBeGreaterThan(60);
    }
  });
});

describe('en pantalla', () => {
  it('tras colocarse, nadie queda con la cabeza tapada por un farol, un cartel, un puesto u otra persona', async () => {
    const { figureBox, objectBox, coversHead } = await import('../src/render/screenbox');
    const { FOOT } = await import('../src/render/footprints');
    for (const seed of [4242, 7, 90210]) {
      const w = createWorld(seed);
      const l = getLayout(w);
      const f = new Furniture(() => w, () => l);
      const ok = (x: number, y: number) => passable(w, l, x, y);
      for (const v of l.villages) {
        const me = { x: v.cx + 0.5, y: v.cy + v.plazaR - 0.5 };
        f.unstick(me, true);
        const people: { x: number; y: number; moving: boolean }[] = [];
        for (let i = 0; i < 10; i++) {
          const a = i * 2.17;
          const d = 1.5 + (i % 4) * 0.9;
          people.push({ x: v.cx + 0.5 + Math.cos(a) * d, y: v.cy + 0.5 + Math.sin(a) * d * 0.8, moving: false });
        }
        // Quien atiende cada puesto montado: fijo, nadie debe taparle la cara.
        const vendors = v.stalls.filter((st) => stallShown(v, st)).map(vendorSpot);
        for (let k = 0; k < 4; k++) settlePeople(people, me, f, ok, vendors);
        // Lo alto de la plaza (props y puestos), con la altura de su huella.
        const tall = v.props.filter((p) => FOOT[p.kind]?.tall).map((p) => objectBox(p.x, p.y, FOOT[p.kind].wide ?? 0.5, FOOT[p.kind].tall!));
        for (const st of v.stalls) if (stallShown(v, st)) tall.push(objectBox(st.x, st.y, FOOT.puesto.wide!, FOOT.puesto.tall!));
        for (const vd of vendors) for (const p of people) if (ok(p.x, p.y)) expect(coversHead(figureBox(p.x, p.y), figureBox(vd.x, vd.y)), `${seed} ${v.regionId} cara del comerciante tapada`).toBe(false);
        for (const p of people) {
          if (!ok(p.x, p.y)) continue;
          const pb = figureBox(p.x, p.y);
          const at = `${seed} ${v.regionId} ${p.x.toFixed(2)},${p.y.toFixed(2)}`;
          for (const o of tall) expect(coversHead(o, pb), `${at} tapado por un objeto`).toBe(false);
          for (const q of people) if (q !== p) expect(coversHead(figureBox(q.x, q.y), pb), `${at} tapado por otra persona`).toBe(false);
          expect(coversHead(figureBox(me.x, me.y), pb), `${at} tapado por el jugador`).toBe(false);
        }
      }
    }
  });
});
