import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { seasonOf, weatherOf } from './clock';
import { societyOf, trait } from './society';
import type { Folk } from './types';

/**
 * Economía de cada pueblo (base para la Fase 3). Quien trabaja la tierra o
 * el agua produce comida; el minero saca mineral; el artesano lo convierte en
 * herramientas; el carpintero trabaja la madera. Todos comen. Los
 * comerciantes compran y venden, y cuando falta algo lo traen de fuera (si
 * los caminos están abiertos). Los precios suben y bajan con la escasez y el
 * dinero pasa de unas manos a otras.
 */
export type Good = 'comida' | 'herramientas' | 'mineral' | 'madera';
export const GOODS: Good[] = ['comida', 'herramientas', 'mineral', 'madera'];
export const BASE_PRICE: Record<Good, number> = { comida: 1, herramientas: 4, mineral: 2, madera: 1 };

export interface Market {
  stock: Record<Good, number>;
  price: Record<Good, number>;
  made: Record<Good, number>; // producido ayer
  eaten: number; // comida consumida ayer
  hungry: number; // personas que se quedaron sin comer ayer
  shock?: { factor: number; until: number; why: string }; // mala cosecha, plaga…
  imported: number;
  exported: number;
  prosperity: number; // 0..1, media de lo cubiertas que están las necesidades
}

const SEASON_FOOD: Record<string, number> = { primavera: 0.95, verano: 1.25, otono: 1.45, otoño: 1.45, invierno: 0.45 };

export function marketOf(w: WorldState, regionId: number): Market {
  const s = societyOf(w);
  return (s.market[regionId] ??= {
    stock: { comida: 30, herramientas: 6, mineral: 5, madera: 8 },
    price: { ...BASE_PRICE },
    made: { comida: 0, herramientas: 0, mineral: 0, madera: 0 },
    eaten: 0,
    hungry: 0,
    imported: 0,
    exported: 0,
    prosperity: 0.6,
  });
}

/** ¿Está trabajando hoy? (enfermo, de viaje o de luto no trabaja). */
export function working(w: WorldState, f: Folk): boolean {
  const p = f.p;
  if (!f.alive || !p) return false;
  if (p.sick !== undefined && p.sick >= w.day) return false;
  if (p.away && p.away.back > w.day) return false;
  if (p.mourning !== undefined && p.mourning >= w.day && trait(f, 'trabajador') < 70) return false;
  return f.age >= 14 && f.role !== 'nino' && f.role !== 'anciano';
}

/** El factor de lo que da la tierra: estación, clima, el estado de la región en el motor y las desgracias. */
export function harvestFactor(w: WorldState, regionId: number): number {
  const r = w.regions[regionId];
  const m = marketOf(w, regionId);
  const engine = clamp((r.isHome ? w.player.reserves / 5 : r.food) / 10, 0.3, 1.5);
  const weather = weatherOf(w, w.day);
  const wx = weather === 'tormenta' ? 0.55 : weather === 'nieve' ? 0.6 : weather === 'lluvia' ? 0.95 : 1;
  const shock = m.shock && m.shock.until >= w.day ? m.shock.factor : 1;
  const eco = clamp(0.55 + r.ecology * 0.6, 0.5, 1.15);
  return (SEASON_FOOD[seasonOf(w.day)] ?? 1) * wx * (r.flags.hambre ? 0.45 : 1) * engine * shock * eco;
}

/** Un día de economía en un pueblo. Devuelve frases sobre cambios notables (para rumores y conversaciones). */
export function economyDay(w: WorldState, regionId: number, people: Folk[]): string[] {
  const m = marketOf(w, regionId);
  const r = w.regions[regionId];
  const notes: string[] = [];
  const made: Record<Good, number> = { comida: 0, herramientas: 0, mineral: 0, madera: 0 };
  const hf = harvestFactor(w, regionId);
  const effort = (f: Folk) => 0.7 + trait(f, 'trabajador') / 170 - trait(f, 'perezoso') / 400;
  const tools = m.stock.herramientas > 0.5 ? 1 : 0.75; // sin herramientas se trabaja peor
  const earnings = new Map<Folk, number>();
  const earn = (f: Folk, g: Good, n: number) => {
    made[g] += n;
    earnings.set(f, (earnings.get(f) ?? 0) + n * m.price[g] * 0.55);
  };
  for (const f of people) {
    if (!working(w, f)) continue;
    const k = effort(f) * tools;
    switch (f.role) {
      case 'campesino':
        earn(f, 'comida', 3.1 * hf * k);
        earn(f, 'madera', 0.15 * k);
        break;
      case 'pescador':
        earn(f, 'comida', 2.6 * k * (seasonOf(w.day) === 'invierno' ? 0.7 : 1) * (weatherOf(w, w.day) === 'tormenta' ? 0.3 : 1));
        break;
      case 'pastor':
        earn(f, 'comida', 1.8 * k * Math.max(0.6, hf));
        break;
      case 'minero':
        earn(f, 'mineral', 1.2 * k);
        break;
      case 'carpintero':
        earn(f, 'madera', 0.9 * k);
        break;
      case 'artesano': {
        const use = Math.min(m.stock.mineral, 0.7);
        m.stock.mineral -= use;
        earn(f, 'herramientas', (0.25 + use * 0.6) * k);
        break;
      }
      case 'guardia':
      case 'lider':
      case 'sanadora':
      case 'posadero':
      case 'exploradora':
        // Les paga el pueblo (o sus clientes).
        earnings.set(f, (earnings.get(f) ?? 0) + (f.role === 'lider' ? 2 : 1.1) * (r.flags.hambre ? 0.6 : 1));
        break;
    }
  }
  for (const g of GOODS) m.stock[g] += made[g];
  // Consumo: cada casa come de lo que hay; quien no tiene dinero come menos.
  let eaten = 0;
  let hungry = 0;
  for (const f of people) {
    if (!f.alive || !f.p || (f.p.away && f.p.away.back > w.day)) continue;
    const need = f.age < 14 ? 0.5 : 0.85;
    const purse = householdPurse(w, f, people);
    const price = m.price.comida;
    const afford = price > 0 ? purse.coins / (price * 0.5) : need;
    const can = Math.min(need, m.stock.comida, Math.max(f.role === 'campesino' || f.role === 'pastor' || f.role === 'pescador' ? need * 0.6 : 0, afford));
    m.stock.comida -= can;
    eaten += can;
    purse.pay(can * price * 0.5);
    f.p.needs.comida = clamp(f.p.needs.comida * 0.55 + (can / need) * 0.45);
    if (can < need * 0.6) hungry++;
  }
  // Las herramientas se gastan, la madera se quema en invierno.
  m.stock.herramientas = Math.max(0, m.stock.herramientas - people.filter((f) => working(w, f)).length * 0.04);
  m.stock.madera = Math.max(0, m.stock.madera - people.length * (seasonOf(w.day) === 'invierno' ? 0.12 : 0.03));
  // Comerciantes: traen de fuera lo que falta y venden fuera lo que sobra.
  const merchants = people.filter((f) => f.role === 'comerciante' && working(w, f));
  const demand = Math.max(1, people.length * 0.8);
  m.imported = 0;
  m.exported = 0;
  if (merchants.length && !r.flags.sinComercio && !r.flags.guerra) {
    if (m.stock.comida < demand * 2) {
      const n = Math.min(demand * 1.5, (merchants.reduce((s, f) => s + (f.p?.coins ?? 0), 0) + 10) / (m.price.comida * 1.1 + 0.1));
      m.stock.comida += n;
      m.imported = n;
      for (const f of merchants) if (f.p) f.p.coins = Math.max(0, f.p.coins - (n * m.price.comida * 1.1) / merchants.length);
    } else if (m.stock.comida > demand * 10) {
      const n = m.stock.comida - demand * 8;
      m.stock.comida -= n;
      m.exported = n;
      for (const f of merchants) if (f.p) f.p.coins += (n * m.price.comida * 0.6) / merchants.length;
    }
    if (m.stock.mineral < 1 && people.some((f) => f.role === 'artesano')) {
      m.stock.mineral += 1.5;
      for (const f of merchants) if (f.p) f.p.coins = Math.max(0, f.p.coins - 3 / merchants.length);
    }
    // Margen de lo vendido en el pueblo.
    for (const f of merchants) earnings.set(f, (earnings.get(f) ?? 0) + (eaten * m.price.comida * 0.22) / merchants.length);
  }
  for (const [f, c] of earnings) if (f.p) f.p.coins = Math.min(250, f.p.coins + c);
  // Precios: escasez → suben; abundancia → bajan. Con inercia, para que no salten.
  const old = m.price.comida;
  for (const g of GOODS) {
    const days = g === 'comida' ? m.stock.comida / demand : m.stock[g] / Math.max(1, people.length * 0.15);
    const target = BASE_PRICE[g] * clamp(2.6 / (days + 0.6), 0.5, 4.5);
    m.price[g] = Math.round((m.price[g] * 0.6 + target * 0.4) * 100) / 100;
  }
  m.made = made;
  m.eaten = eaten;
  m.hungry = hungry;
  if (m.price.comida > old * 1.25 && m.price.comida > 1.6) notes.push('sube-comida');
  if (m.price.comida < old * 0.8 && old > 1.6) notes.push('baja-comida');
  if (hungry >= Math.max(2, people.length * 0.25)) notes.push('hambre');
  return notes;
}

/** El dinero de una casa se comparte (pareja e hijos). */
function householdPurse(w: WorldState, f: Folk, people: Folk[]): { coins: number; pay: (n: number) => void } {
  const house = people.filter((o) => o.house === f.house && o.p);
  const coins = house.reduce((s, o) => s + o.p!.coins, 0);
  return {
    coins,
    pay: (n: number) => {
      let left = n;
      for (const o of house.sort((a, b) => b.p!.coins - a.p!.coins)) {
        const take = Math.min(o.p!.coins, left);
        o.p!.coins -= take;
        left -= take;
        if (left <= 0) break;
      }
    },
  };
}

/** Precio de la comida en monedas enteras (lo que paga el jugador). */
export function foodPrice(w: WorldState, regionId: number): number {
  return Math.max(1, Math.round(marketOf(w, regionId).price.comida));
}

/** Cómo se ve el mercado: lo que el jugador nota sin cifras. */
export function stallLook(w: WorldState, regionId: number): 'lleno' | 'normal' | 'escaso' | 'vacio' {
  const m = marketOf(w, regionId);
  const people = w.life!.folk.filter((f) => f.alive && f.regionId === regionId).length;
  const days = m.stock.comida / Math.max(1, people * 0.8);
  return days > 5 ? 'lleno' : days > 1.5 ? 'normal' : days > 0.25 ? 'escaso' : 'vacio';
}

/** El jugador compra o vende en el mercado: el inventario cambia de verdad. */
export function trade(w: WorldState, regionId: number, good: Good, n: number): void {
  const m = marketOf(w, regionId);
  m.stock[good] = Math.max(0, m.stock[good] - n);
}
