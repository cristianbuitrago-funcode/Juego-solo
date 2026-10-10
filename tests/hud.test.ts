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
  it('sin saltos: quien entra por el borde pide poco y crece poco a poco', () => {
    let prev = hudShiftFor([-1], 100, 0);
    expect(prev).toBe(0);
    for (let y = 0; y <= 60; y++) {
      const v = hudShiftFor([y], 100, 0);
      expect(Math.abs(v - prev)).toBeLessThan(6);
      prev = v;
    }
  });
  it('sin caras en la franja no baja; con tope', () => {
    expect(hudShiftFor([300, 500], 100, 0)).toBe(0);
    expect(hudShiftFor([], 100, 30)).toBe(0);
    expect(hudShiftFor([30], 100, 0)).toBe(70);
    // Por encima del borde (cortada por el marco) no cuenta, ni aunque la bajada la meta en la franja.
    expect(hudShiftFor([-10], 100, 0)).toBe(0);
    expect(hudShiftFor([30], 100, 60)).toBe(0);
    expect(hudShiftFor([50], 0, 0)).toBe(0);
  });
});
