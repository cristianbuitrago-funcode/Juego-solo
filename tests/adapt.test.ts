import { describe, expect, it } from 'vitest';
import { adaptTier, type AdaptState } from '../src/visual/quality';

const fresh = (): AdaptState => ({ calm: 0, sinceChange: 60000, gpuCapped: false, bestGap: 1e9 });

describe('nivel gráfico adaptativo', () => {
  it('baja si el dibujo pasa de 16 ms (p95)', () => {
    expect(adaptTier('high', 'ultra', 20, 16.7, fresh())).toBe('medium');
  });
  it('baja de ALTA si el móvil no pasa de ~40 fps desde el arranque (GPU)', () => {
    expect(adaptTier('high', 'high', 5, 33, fresh())).toBe('medium');
  });
  it('una pantalla a 30 Hz no acaba en BAJA', () => {
    const st = fresh();
    expect(adaptTier('medium', 'high', 5, 33, st)).toBe('medium');
  });
  it('tras bajar por la GPU no vuelve a subir (sin vaivén)', () => {
    const st = fresh();
    let tier = adaptTier('high', 'high', 5, 33, st);
    expect(tier).toBe('medium');
    for (let i = 0; i < 6; i++) {
      st.sinceChange = 60000;
      tier = adaptTier(tier, 'high', 4, 33, st);
    }
    expect(tier).toBe('medium');
  });
  it('sube tras dos ventanas tranquilas si la pantalla va a 60 Hz', () => {
    const st = fresh();
    expect(adaptTier('medium', 'high', 4, 16.7, st)).toBe('medium');
    expect(adaptTier('medium', 'high', 4, 16.7, st)).toBe('high');
  });
  it('no sube por encima del nivel detectado', () => {
    const st = fresh();
    adaptTier('high', 'high', 4, 16.7, st);
    expect(adaptTier('high', 'high', 4, 16.7, st)).toBe('high');
  });
});
