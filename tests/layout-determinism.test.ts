import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { getLayout, rebuildLayout } from '../src/world/layout';

describe('trazado de pueblos', () => {
  it('se reconstruye idéntico sobre el mismo terreno en caché (no depende de plazas ya pintadas)', () => {
    const w = createWorld(4242);
    const pick = (l: ReturnType<typeof getLayout>) => l.villages.map((v) => [v.cx, v.cy, v.plazaR, Math.round(v.stalls[0].x * 10)]);
    const a = pick(getLayout(w));
    const b = pick(rebuildLayout(w));
    const c = pick(rebuildLayout(w));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});
