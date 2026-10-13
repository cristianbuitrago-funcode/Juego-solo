import { describe, expect, it } from 'vitest';
import { STALL_BACK_DY, vendorSpot } from '../src/world/layout';
import { TILE } from '../src/world/types';

describe('puesto del mercado', () => {
  it('quien atiende se dibuja entre el toldo (detrás) y el mostrador (delante)', () => {
    for (const st of [{ x: 10, y: 10 }, { x: 200.5, y: 133.25 }]) {
      const base = st.y * TILE;
      const vendor = vendorSpot(st).y * TILE;
      expect(base + STALL_BACK_DY).toBeLessThan(vendor); // el toldo, antes: nunca le tapa la cara
      expect(vendor).toBeLessThan(base); // el mostrador, después: le tapa las piernas
    }
  });
});
