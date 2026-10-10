import { describe, expect, it } from 'vitest';
import { hudShiftFor } from '../src/render/screenbox';

describe('zona segura del HUD', () => {
  it('baja la escena lo que falta, no la mitad', () => {
    // Una cara 40 px dentro de una franja de 100 (línea en 106): sin bajar estaba en 66.
    expect(hudShiftFor([66], 100, 0)).toBe(40);
    // Ya bajada 20, se ve en 86: sigue pidiendo 40 en total (antes pedía 20 y se quedaba ahí).
    expect(hudShiftFor([86], 100, 20)).toBe(40);
    // Ya bajada del todo, se ve justo en la línea: mantiene los 40 (no vuelve a subir y tiembla).
    expect(hudShiftFor([106], 100, 40)).toBe(40);
  });
  it('sin caras en la franja no baja; con tope', () => {
    expect(hudShiftFor([300, 500], 100, 0)).toBe(0);
    expect(hudShiftFor([], 100, 30)).toBe(0);
    expect(hudShiftFor([-10], 100, 0)).toBe(70);
    expect(hudShiftFor([-80], 100, 0)).toBe(0);
    expect(hudShiftFor([50], 0, 0)).toBe(0);
  });
});
