import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { getLayout } from '../src/world/layout';
import { ensureLife } from '../src/world/life';
import { Furniture } from '../src/render/furniture';
import { animalBlocked, moveAnimals, type Animal } from '../src/render/animals';

describe('animales de los pueblos', () => {
  it('ninguno se queda parado con un farol, cartel o mueble atravesándolo, ni encima de otro', () => {
    for (const seed of [4242, 7]) {
      const w = createWorld(seed);
      const l = getLayout(w);
      const furniture = new Furniture(() => w, () => l);
      const host = { w, l, furniture, animals: new Map<number, Animal[]>() };
      const me = ensureLife(w).player;
      for (const v of l.villages) {
        me.x = v.cx + 0.5;
        me.y = v.cy + 0.5;
        host.animals.clear();
        for (let i = 0; i < 400; i++) moveAnimals(host, 0.1);
        const list = (host.animals.get(v.regionId) ?? []).filter((a) => !a.water);
        for (const a of list) {
          const resting = Math.hypot(a.tx - a.x, a.ty - a.y) < 0.2;
          if (!resting) continue;
          const at = `${seed} ${v.regionId} ${a.kind} ${a.x.toFixed(1)},${a.y.toFixed(1)}`;
          expect(animalBlocked(host, a.kind, a.x, a.y), at).toBe(false);
          // Independiente de animalBlocked: ningún poste alto pegado al lomo.
          expect(furniture.tallNear(a.x, a.y, a.kind === 'gallina' ? 0.25 : 0.55), at).toBe(false);
        }
      }
    }
  });
});
