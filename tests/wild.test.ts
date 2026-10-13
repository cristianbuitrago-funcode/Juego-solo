import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { getLayout } from '../src/world/layout';
import { passable } from '../src/world/path';
import { Furniture } from '../src/render/furniture';
import { reactWild, type Animal, type WildEvent } from '../src/render/animals';

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
});
