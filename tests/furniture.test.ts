import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { getLayout } from '../src/world/layout';
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
        for (let k = 0; k < 4; k++) settlePeople(people, me, f, ok);
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
        }
      }
      expect(checked).toBeGreaterThan(60);
    }
  });
});
