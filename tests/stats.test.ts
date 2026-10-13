import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { wireWorld } from '../src/world';
import { chanceOf, chooseFragment, gain } from '../src/world/identity';
import { ensureLife } from '../src/world/life';
import { jobFor, work } from '../src/world/livelihood';
import { heirSecretDay, rumorFragment } from '../src/world/heir';
import { addXp, learnPace, POINTS_PER_LEVEL, spendPoint, statsOf, xpToNext } from '../src/world/stats';
import type { WorldState } from '../src/core/types';

wireWorld();

const world = (seed = 4242): WorldState => {
  const w = createWorld(seed, { eraLength: 0 });
  ensureLife(w);
  return w;
};

describe('nivel y atributos', () => {
  it('se empieza en nivel 1 con puntos por repartir; el heredero trae algo más de cabeza y carisma', () => {
    const id = world().life!.identity!;
    const st = statsOf(id);
    expect(st.level).toBe(1);
    expect(st.points).toBe(POINTS_PER_LEVEL);
    expect(st.base.inteligencia).toBe(4);
    expect(st.base.carisma).toBe(4);
    expect(st.base.ataque).toBe(3);
  });

  it('lo que se practica da experiencia, y cada nivel trae puntos', () => {
    const w = world();
    const st = statsOf(w.life!.identity!);
    const notes = addXp(w, xpToNext(1) + xpToNext(2));
    expect(st.level).toBe(3);
    expect(st.points).toBe(POINTS_PER_LEVEL * 3);
    expect(notes.some((n) => n.big && n.text.includes('nivel 3'))).toBe(true);
    const before = st.xp + st.level * 1000;
    gain(w, 'agricultura', 1);
    expect(st.xp + st.level * 1000).toBeGreaterThan(before);
  });

  it('el ataque también es la fuerza de los oficios: el campo sale mejor, y la persuasión depende del carisma', () => {
    const id = world().life!.identity!;
    const field = chanceOf(id, 'agricultura');
    const talk = chanceOf(id, 'persuasion');
    for (let i = 0; i < 3; i++) spendPoint(id, 'ataque');
    expect(chanceOf(id, 'agricultura')).toBeGreaterThan(field + 0.05);
    expect(chanceOf(id, 'persuasion')).toBeCloseTo(talk, 5);
    expect(spendPoint(id, 'carisma')).toBe(false); // sin puntos
  });

  it('la inteligencia acelera lo que se aprende', () => {
    const id = world().life!.identity!;
    const pace = learnPace(id, true);
    statsOf(id).base.inteligencia += 3;
    expect(learnPace(id, true)).toBeGreaterThan(pace + 0.15);
  });

  it('un oficio duro paga según la fuerza: con pocos brazos, menos; con muchos, más', () => {
    const pay = (arm: number) => {
      const w = world();
      const life = w.life!;
      const f = life.folk.find((x) => x.alive && x.role === 'lenador' && jobFor(w, x))!;
      statsOf(life.identity!).base.ataque = arm;
      const coins = life.identity!.needs.coins;
      const out = work(w, f.id);
      return { coins: life.identity!.needs.coins - coins, lines: out.lines.join(' ') };
    };
    const weak = pay(2);
    const strong = pay(8);
    expect(strong.coins).toBeGreaterThan(weak.coins);
    expect(weak.lines).toContain('Te faltan brazos');
  });
});

describe('el secreto del heredero', () => {
  it('si lo calla, acaba corriendo el rumor; la gente desconfía y luego puede confesar', () => {
    const w = world();
    const life = w.life!;
    const id = life.identity!;
    const past = id.past!;
    for (const f of ['colgante', 'cancion', 'sueno', 'persona']) id.fragments.push({ id: f, day: w.day });
    id.fragments.push({ id: 'verdad', day: w.day });
    chooseFragment(w, 'verdad', 'callar');
    expect(past.claim).toBe('callar');
    const town = life.folk.filter((f) => f.alive && f.regionId === w.player.home);
    const trust = () => town.reduce((t, f) => t + f.trust, 0) / town.length;
    const before = trust();
    let news: string[] = [];
    for (let d = 0; d < 30 && !past.secretOut; d++) news = heirSecretDay(w);
    expect(past.secretOut).toBeDefined();
    expect(news[0]).toContain('rumor');
    expect(trust()).toBeLessThan(before - 0.05);
    expect(life.society!.rumors.some((r) => r.kind === 'p_heredero')).toBe(true);
    const ev = rumorFragment(w, town[0].id)!;
    expect(ev.choices!.map((c) => c.id)).toEqual(['confesar', 'negar']);
    const low = trust();
    chooseFragment(w, 'rumor', 'confesar');
    expect(trust()).toBeGreaterThan(low);
    expect(rumorFragment(w, town[1].id)).toBeNull(); // solo una vez
  });
});
