import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { getLayout } from '../src/world/layout';
import { passable } from '../src/world/path';
import { Furniture } from '../src/render/furniture';

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
