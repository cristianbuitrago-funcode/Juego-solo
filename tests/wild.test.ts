import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { getLayout } from '../src/world/layout';
import { passable } from '../src/world/path';
import { Furniture } from '../src/render/furniture';
import { ensureLife } from '../src/world/life';
import { healthOf } from '../src/world/generations';
import { raidStep, reactWild, startRaid, type Animal, type WildEvent } from '../src/render/animals';

describe('fieras frente al jugador', () => {
  const w = createWorld(4242);
  const l = getLayout(w);
  const furniture = new Furniture(() => w, () => l);
  // Un claro abierto lejos del primer pueblo, con sitio alrededor.
  const v = l.villages[0];
  let spot = { x: 0, y: 0 };
  for (let k = 0; k < 400 && !spot.x; k++) {
    const x = v.cx + 30 + (k % 20);
    const y = v.cy + Math.floor(k / 20) - 10;
    let open = true;
    for (let dx = -6; dx <= 6 && open; dx += 1.5) for (let dy = -6; dy <= 6 && open; dy += 1.5) open = passable(w, l, x + dx, y + dy);
    if (open) spot = { x, y };
  }
  const make = (kind: 'lobo' | 'oso'): Animal => ({ kind, x: spot.x, y: spot.y, hx: spot.x, hy: spot.y, tx: spot.x, ty: spot.y, flip: false, anim: 0, v: 0 });

  it('hay un claro de prueba', () => expect(spot.x).toBeGreaterThan(0));

  it('el lobo te mira de lejos y huye si te acercas', () => {
    const said: WildEvent[] = [];
    const host = { w, l, furniture, onWild: (_k: string, e: WildEvent) => said.push(e) };
    const a = make('lobo');
    reactWild(host, a, { x: spot.x - 6, y: spot.y }, 0.1);
    expect(a.mood).toBe('mira');
    expect(a.flip).toBe(true); // te mira (estás a su izquierda)
    const me = { x: spot.x - 3, y: spot.y };
    for (let i = 0; i < 60; i++) reactWild(host, a, me, 0.1);
    expect(Math.hypot(a.x - me.x, a.y - me.y)).toBeGreaterThan(7);
    expect(said).toEqual(['mira', 'huye']);
  });

  it('el oso carga de aviso sin tocarte y luego retrocede', () => {
    const said: WildEvent[] = [];
    const host = { w, l, furniture, onWild: (_k: string, e: WildEvent) => said.push(e) };
    const a = make('oso');
    const me = { x: spot.x - 2.4, y: spot.y };
    let closest = 99;
    let backed = false;
    for (let i = 0; i < 80; i++) {
      reactWild(host, a, me, 0.1);
      closest = Math.min(closest, Math.hypot(a.x - me.x, a.y - me.y));
      if (a.mood === 'retrocede') backed = true;
    }
    expect(said[0]).toBe('carga');
    expect(closest).toBeGreaterThan(0.9);
    expect(closest).toBeLessThan(1.6);
    expect(backed).toBe(true);
    expect(Math.hypot(a.x - me.x, a.y - me.y)).toBeGreaterThan(closest + 1);
  });

  it('de noche el lobo se acerca a unas 5 casillas y solo huye si te le echas encima', () => {
    const host = { w, l, furniture };
    const a = make('lobo');
    const me = { x: spot.x - 9, y: spot.y };
    // (4 s: antes de que se atreva a morder)
    for (let i = 0; i < 40; i++) reactWild(host, a, me, 0.1, true);
    const d = Math.hypot(a.x - me.x, a.y - me.y);
    expect(a.mood).toBe('acecha');
    expect(d).toBeGreaterThan(4.5);
    expect(d).toBeLessThan(6.5);
    // A 3,5 de día huiría; de noche aguanta.
    const near = { x: a.x - 3.5, y: a.y };
    reactWild(host, a, near, 0.1, true);
    expect(a.mood).not.toBe('huye');
  });

  it('asalto nocturno: sin nadie que lo impida, los lobos se llevan una res y vuelven a su guarida', () => {
    const said: WildEvent[] = [];
    const host = { w, l, furniture, onWild: (_k: string, e: WildEvent) => said.push(e) };
    const wolf = make('lobo');
    const sheep: Animal = { kind: 'oveja', x: spot.x + 4, y: spot.y, hx: spot.x + 4, hy: spot.y, tx: spot.x + 4, ty: spot.y, flip: false, anim: 0, v: 0 };
    const list = [wolf, sheep];
    expect(startRaid(host, 0, list)).toBe(true);
    const far = { x: spot.x - 40, y: spot.y };
    for (let i = 0; i < 200 && list.includes(sheep); i++) raidStep(host, 0, list, wolf, far, 0.1);
    expect(list.includes(sheep)).toBe(false);
    expect(said).toEqual(['asalto', 'presa']);
    for (let i = 0; i < 200 && wolf.mood === 'vuelve'; i++) raidStep(host, 0, list, wolf, far, 0.1);
    expect(wolf.mood).toBe('calma');
    expect(Math.hypot(wolf.x - spot.x, wolf.y - spot.y)).toBeLessThan(0.5);
  });

  it('con el jugador delante, el asalto se frustra y la res se salva', () => {
    const said: WildEvent[] = [];
    const host = { w, l, furniture, onWild: (_k: string, e: WildEvent) => said.push(e) };
    const wolf = make('lobo');
    const sheep: Animal = { kind: 'oveja', x: spot.x + 4, y: spot.y, hx: spot.x + 4, hy: spot.y, tx: spot.x + 4, ty: spot.y, flip: false, anim: 0, v: 0 };
    const list = [wolf, sheep];
    startRaid(host, 0, list);
    const me = { x: spot.x + 2, y: spot.y + 0.5 };
    for (let i = 0; i < 40; i++) raidStep(host, 0, list, wolf, me, 0.1);
    expect(list.includes(sheep)).toBe(true);
    expect(said).toContain('ahuyentados');
    expect(wolf.mood === 'vuelve' || wolf.mood === 'calma').toBe(true);
  });

  it('si insistes después del aviso, el oso ataca de verdad y te hiere', () => {
    ensureLife(w);
    const said: WildEvent[] = [];
    const host = { w, l, furniture, onWild: (_k: string, e: WildEvent) => said.push(e) };
    const a = make('oso');
    const before = healthOf(w).value;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // sin esquivar
    try {
      // Primer acercamiento: solo la carga de aviso.
      const me = { x: spot.x - 2.4, y: spot.y };
      for (let i = 0; i < 30; i++) reactWild(host, a, me, 0.1);
      expect(said).toContain('carga');
      expect(said).not.toContain('zarpazo');
      expect(healthOf(w).value).toBe(before);
      // Insiste: se le pega.
      for (let i = 0; i < 40 && !said.includes('zarpazo'); i++) reactWild(host, a, { x: a.x - 1.2, y: a.y }, 0.1);
      expect(said).toContain('zarpazo');
      expect(healthOf(w).value).toBeLessThan(before);
      expect(healthOf(w).conditions.some((c) => c.why === 'el zarpazo de un oso')).toBe(true);
      expect(a.mood).toBe('retrocede');
    } finally {
      spy.mockRestore();
    }
  });

  it('de noche, tras acecharte un rato, un lobo se lanza a morder; en el pueblo no se atreve', () => {
    ensureLife(w);
    const said: WildEvent[] = [];
    const host = { w, l, furniture, onWild: (_k: string, e: WildEvent) => said.push(e) };
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // sin esquivar
    try {
      const a = make('lobo');
      const before = healthOf(w).value;
      const me = { x: spot.x - 6, y: spot.y };
      for (let i = 0; i < 200 && !said.includes('mordisco'); i++) reactWild(host, a, me, 0.1, true);
      expect(said).toContain('mordisco');
      expect(healthOf(w).conditions.some((c) => c.why === 'el mordisco de un lobo')).toBe(true);
      expect(healthOf(w).value).toBeLessThan(before);
      expect(a.mood).toBe('huye');
      // En la plaza de un pueblo: acecha, pero no muerde.
      const v = l.villages[0];
      const town = { x: v.cx + 0.5, y: v.cy + 0.5 };
      const b: Animal = { ...make('lobo'), x: town.x + 6, y: town.y, hx: town.x + 6, hy: town.y, tx: town.x + 6, ty: town.y };
      said.length = 0;
      for (let i = 0; i < 200; i++) reactWild(host, b, town, 0.1, true);
      expect(said).not.toContain('mordisco');
      // De día, ni se acerca.
      const c = make('lobo');
      said.length = 0;
      for (let i = 0; i < 200; i++) reactWild(host, c, me, 0.1, false);
      expect(said).not.toContain('mordisco');
    } finally {
      spy.mockRestore();
    }
  });
});
