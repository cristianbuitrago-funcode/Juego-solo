import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { wireWorld } from '../src/world';
import { relOf } from '../src/world/diplomacy';
import { chooseFragment, tryFragment } from '../src/world/identity';
import { ensureLife } from '../src/world/life';
import { ensurePolitics, govOf, politicsDay } from '../src/world/politics';
import type { WorldState } from '../src/core/types';

wireWorld();

function world(seed = 4242): WorldState {
  const w = createWorld(seed, { eraLength: 0 });
  ensureLife(w);
  ensurePolitics(w);
  return w;
}

describe('la historia del jugador: heredero de un reino enemigo', () => {
  it('es el heredero: su tierra es un reino donde reina su familia, enfrentado al pueblo donde despierta', () => {
    for (const seed of [4242, 7, 99]) {
      const w = world(seed);
      const past = w.life!.identity!.past!;
      expect(past.heir).toBe(true);
      expect(past.role).toBe('heredero');
      expect(past.accident).toBeTruthy();
      expect(past.origin).not.toBe(w.player.home);
      const g = govOf(w, past.origin);
      expect(g.system).toBe('monarquia');
      expect(g.ruler).toBe(past.parent);
      const parent = w.life!.folk.find((f) => f.id === past.parent)!;
      expect(parent.regionId).toBe(past.origin);
      expect(parent.age).toBeGreaterThanOrEqual(42);
      expect(relOf(w, w.player.home, past.origin).tension).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('al principio desconfían más de él en el pueblo donde despierta que en su tierra', () => {
    const w = world();
    const past = w.life!.identity!.past!;
    const avg = (rid: number) => {
      const fs = w.life!.folk.filter((f) => f.regionId === rid);
      return fs.reduce((t, f) => t + f.trust, 0) / fs.length;
    };
    expect(avg(w.player.home)).toBeLessThan(avg(past.origin) - 0.08);
  });

  it('la verdad llega con cuatro caminos, y cada uno cambia el mundo', () => {
    const reveal = (w: WorldState) => {
      const life = w.life!;
      const past = life.identity!.past!;
      // Atajos: se dan por vistos los recuerdos previos y habla con quien le reconoce.
      for (const id of ['colgante', 'cancion', 'sueno']) life.identity!.fragments.push({ id, day: w.day });
      expect(tryFragment(w, { kind: 'hablar', folkId: past.link! })?.id).toBe('persona');
      const truth = tryFragment(w, { kind: 'hablar', folkId: past.link! });
      expect(truth?.id).toBe('verdad');
      expect(truth!.choices!.map((c) => c.id)).toEqual(['reclamar', 'paz', 'renunciar', 'callar']);
      return past;
    };
    // Paz: baja la tensión entre los dos reinos.
    {
      const w = world();
      const past = reveal(w);
      const before = relOf(w, w.player.home, past.origin).tension;
      chooseFragment(w, 'verdad', 'paz');
      expect(relOf(w, w.player.home, past.origin).tension).toBeLessThan(before - 0.2);
    }
    // Renunciar: el pueblo donde vive confía más en él.
    {
      const w = world();
      const past = reveal(w);
      const home = w.life!.folk.filter((f) => f.regionId === w.player.home);
      const before = home.reduce((t, f) => t + f.trust, 0);
      chooseFragment(w, 'verdad', 'renunciar');
      expect(home.reduce((t, f) => t + f.trust, 0)).toBeGreaterThan(before);
      expect(past.claim).toBe('renunciar');
    }
    // Reclamar: le ofrecen sitio en la corte y, cuando falta quien reina, hereda el trono.
    {
      const w = world();
      const past = reveal(w);
      chooseFragment(w, 'verdad', 'reclamar');
      expect(w.life!.identity!.offers.some((o) => o.regionId === past.origin)).toBe(true);
      const parent = w.life!.folk.find((f) => f.id === past.parent)!;
      parent.alive = false;
      politicsDay(w);
      expect(govOf(w, past.origin).ruler).toBe('jugador');
      expect(w.life!.identity!.rank[past.origin]).toBe(6);
    }
  });
});
