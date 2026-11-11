import { describe, expect, it } from 'vitest';
import { syllableAt, voiceFor, VOICE_OVERRIDES, VOICE_PRESETS } from '../src/audio/voice';
import { BondWatch, tierOf } from '../src/world/bonds';
import { createWorld } from '../src/core/api';
import { ensureLife } from '../src/world/life';
import { wireWorld } from '../src/world';

describe('voces de los personajes', () => {
  it('la misma persona tiene siempre la misma voz, y distinta de la de su vecino', () => {
    const a = voiceFor({ id: 'v1', age: 30, fem: false, role: 'campesino' });
    expect(voiceFor({ id: 'v1', age: 30, fem: false, role: 'campesino' })).toEqual(a);
    expect(voiceFor({ id: 'v2', age: 30, fem: false, role: 'campesino' }).pitch).not.toBe(a.pitch);
  });

  it('la edad y el género mandan en el tono', () => {
    const man = voiceFor({ id: 'x', age: 35, fem: false });
    const woman = voiceFor({ id: 'x', age: 35, fem: true });
    const child = voiceFor({ id: 'x', age: 8, fem: false });
    expect(woman.pitch).toBeGreaterThan(man.pitch * 1.3);
    expect(child.pitch).toBeGreaterThan(woman.pitch);
    expect(voiceFor({ id: 'x', age: 70, fem: false }).speed).toBeLessThan(man.speed);
  });

  it('una voz fijada a mano manda sobre la generada', () => {
    VOICE_OVERRIDES['Nori'] = 'grave';
    VOICE_OVERRIDES['rol:posadero'] = { pitch: 150 };
    try {
      expect(voiceFor({ id: 'v9', name: 'Nori', age: 40, fem: false }).pitch).toBe(VOICE_PRESETS.grave.pitch);
      expect(voiceFor({ id: 'v8', name: 'Otro', role: 'posadero', age: 40, fem: true }).pitch).toBe(150);
    } finally {
      delete VOICE_OVERRIDES['Nori'];
      delete VOICE_OVERRIDES['rol:posadero'];
    }
  });

  it('las sílabas salen de las vocales del texto y la pregunta sube al final', () => {
    const t = '«¿Dónde la viste?»';
    expect(syllableAt(t, 0)).toBeNull(); // «
    expect(syllableAt(t, t.indexOf('ó'))?.vowel).toBe('o');
    expect(syllableAt('aire', 1)).toBeNull(); // diptongo: una sola sílaba
    const ask = 'Vienes mañana?';
    const tell = 'Vienes mañana.';
    const i = ask.lastIndexOf('a');
    expect(syllableAt(ask, i)!.bend).toBeGreaterThan(syllableAt(tell, i)!.bend + 3);
    expect(syllableAt('Fuera!', 4)!.stress).toBeGreaterThan(0.5);
  });
});

describe('lo que cambia entre tú y los demás', () => {
  wireWorld();
  const w = createWorld(77, { eraLength: 0 });
  const folk = ensureLife(w).folk.filter((f) => f.alive);

  it('los niveles crecen con el tamaño del cambio', () => {
    expect(tierOf(0.01)).toBe(0);
    expect(tierOf(0.05)).toBe(1);
    expect(tierOf(-0.15)).toBe(2);
    expect(tierOf(0.4)).toBe(3);
  });

  it('sin cambios no hay nada que enseñar', () => {
    const bw = new BondWatch();
    bw.sync(w);
    expect(bw.diff(w).folk).toHaveLength(0);
  });

  it('un detalle es un gesto sin texto; algo grande, un aviso con nombre', () => {
    const bw = new BondWatch();
    bw.sync(w);
    const [a, b] = folk;
    a.trust += 0.04;
    b.gratitude += 0.4;
    b.trust += 0.1;
    const d = bw.diff(w).folk;
    const small = d.find((c) => c.folk === a)!;
    const big = d.find((c) => c.folk === b)!;
    expect(small.tier).toBe(1);
    expect(small.text).toBe('');
    expect(big.tier).toBe(3);
    expect(big.good).toBe(true);
    expect(big.sign).toBe('corazon');
    expect(big.text.length).toBeGreaterThan(5);
    expect(d[0]).toBe(big); // lo que más pesa, primero
    expect(bw.diff(w).folk).toHaveLength(0); // ya está visto
  });

  it('lo que contradice lo que pensaba de ti pesa más', () => {
    const bw = new BondWatch();
    const [, , a, b] = folk;
    for (const f of [a, b]) (f.memories = []), (f.fear = 0), (f.gratitude = 0);
    (a.trust = 0.9), (a.resentment = 0); // confiaba en ti
    (b.trust = 0.45), (b.resentment = 0.05); // le eras indiferente
    bw.sync(w);
    a.resentment += 0.12;
    b.resentment += 0.12;
    const d = bw.diff(w).folk;
    const ca = d.find((c) => c.folk === a)!;
    const cb = d.find((c) => c.folk === b)!;
    expect(ca.turn).toBe(true);
    expect(cb.turn).toBe(false);
    expect(Math.abs(ca.delta)).toBeGreaterThan(Math.abs(cb.delta));
    expect(ca.good).toBe(false);
  });

  it('cuando cambia medio pueblo, la noticia es el pueblo', () => {
    const bw = new BondWatch();
    bw.sync(w);
    const town = folk.filter((f) => f.regionId === folk[0].regionId).slice(0, 8);
    for (const f of town) f.trust = Math.max(0, f.trust - 0.08);
    const d = bw.diff(w);
    expect(d.town?.regionId).toBe(folk[0].regionId);
    expect(d.town?.good).toBe(false);
    expect(d.town?.count).toBe(town.filter((f) => d.folk.some((c) => c.folk === f)).length);
  });
});
