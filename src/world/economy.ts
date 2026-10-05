import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { routesOf } from '../core/world';
import { seasonOf, weatherOf } from './clock';
import { eatSeeds, farmDay, farmOf, nearTiles, waterOf, type FarmNews } from './farming';
import { societyOf, trait } from './society';
import type { Folk, FolkRole } from './types';
import { T } from './types';

/**
 * Economía viva de cada pueblo. Nada aparece de la nada:
 *
 *   MINA → HIERRO → HERRERO → HERRAMIENTAS → CAMPESINO → TRIGO → MERCADO → FAMILIAS
 *   BOSQUE → MADERA → CARPINTERO → MUEBLES · REBAÑO → LANA → TEJEDOR → ROPA …
 *
 * Cada productor vende lo que hace al mercado (y cobra de la caja del
 * comercio); cada familia compra lo que necesita según lo que tiene (las
 * ricas comen carne y fruta; las pobres, pan y verdura). El dinero pasa de
 * mano en mano: productores, comerciantes, artesanos, familias y las arcas
 * del pueblo (una pequeña tasa sobre lo vendido paga a guardias y consejo).
 * Los precios salen de lo que hay y de lo que se gasta; los salarios, de lo
 * que gana de verdad cada oficio.
 */
export type Good =
  | 'trigo' | 'verdura' | 'fruta' | 'carne' | 'pescado'
  | 'madera' | 'piedra' | 'hierro'
  | 'herramientas' | 'ropa' | 'armas' | 'muebles' | 'medicinas'
  | 'semillas' | 'lana' | 'sal' | 'ambar';

export interface GoodDef {
  name: string;
  base: number; // precio de referencia
  weight: number; // lo que cuesta transportarlo (por unidad)
  kind: 'alimento' | 'material' | 'producto' | 'especial';
  icon: string;
}

export const GOOD: Record<Good, GoodDef> = {
  trigo: { name: 'trigo', base: 1, weight: 0.6, kind: 'alimento', icon: '🌾' },
  verdura: { name: 'verdura', base: 1, weight: 0.7, kind: 'alimento', icon: '🥬' },
  fruta: { name: 'fruta', base: 1.4, weight: 0.7, kind: 'alimento', icon: '🍎' },
  carne: { name: 'carne', base: 2.6, weight: 0.8, kind: 'alimento', icon: '🍖' },
  pescado: { name: 'pescado', base: 1.6, weight: 0.8, kind: 'alimento', icon: '🐟' },
  madera: { name: 'madera', base: 1, weight: 1, kind: 'material', icon: '🪵' },
  piedra: { name: 'piedra', base: 1, weight: 1.3, kind: 'material', icon: '🪨' },
  hierro: { name: 'hierro', base: 2.6, weight: 1.1, kind: 'material', icon: '⛏' },
  herramientas: { name: 'herramientas', base: 5, weight: 0.5, kind: 'producto', icon: '🔨' },
  ropa: { name: 'ropa', base: 3.5, weight: 0.3, kind: 'producto', icon: '🧵' },
  armas: { name: 'armas', base: 8, weight: 0.6, kind: 'producto', icon: '⚔' },
  muebles: { name: 'muebles', base: 6, weight: 1.2, kind: 'producto', icon: '🪑' },
  medicinas: { name: 'medicinas', base: 4, weight: 0.2, kind: 'producto', icon: '🌿' },
  semillas: { name: 'semillas', base: 1.6, weight: 0.5, kind: 'especial', icon: '🌱' },
  lana: { name: 'lana', base: 1.6, weight: 0.5, kind: 'material', icon: '🐑' },
  sal: { name: 'sal', base: 3, weight: 0.6, kind: 'especial', icon: '🧂' },
  ambar: { name: 'ámbar', base: 12, weight: 0.1, kind: 'especial', icon: '🟠' },
};
export const GOODS = Object.keys(GOOD) as Good[];
export const FOODS: Good[] = ['trigo', 'verdura', 'fruta', 'carne', 'pescado'];
export const BASE_PRICE = Object.fromEntries(GOODS.map((g) => [g, GOOD[g].base])) as Record<Good, number>;
const zero = () => Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<Good, number>;

export interface Market {
  stock: Record<Good, number>;
  price: Record<Good, number>;
  demand: Record<Good, number>; // gasto diario medio (con inercia)
  made: Partial<Record<Good, number>>; // producido ayer
  cash: number; // dinero del comercio (lo que tienen los puestos para comprar)
  treasury: number; // arcas del pueblo
  eaten: number;
  hungry: number; // personas que no comieron bastante ayer
  imported: number;
  exported: number;
  prosperity: number; // 0..1 (interno: nunca se enseña como número)
  history: { day: number; food: number; pop: number; prosperity: number; hungry: number }[];
  wages: Partial<Record<FolkRole, number>>; // lo que gana de verdad cada oficio al día
  news: Record<number, { day: number; price: Partial<Record<Good, number>> }>; // lo que este mercado sabe de otros
  bridge?: number; // último valor de alimento enviado al motor
  closedStalls: number; // puestos cerrados (comerciantes arruinados o sin nada que vender)
  shock?: { factor: number; until: number; why: string };
  mine?: boolean; // se encontró una veta de hierro
  v: 3;
}

/** Lo que produce cada tierra además de lo común (recursos regionales). */
export function specialtyOf(w: WorldState, regionId: number): Good[] {
  const r = w.regions[regionId];
  switch (r.resource) {
    case 'pesca': return ['pescado', 'sal'];
    case 'grano': return ['trigo', 'semillas'];
    case 'hierro': return ['hierro', 'herramientas'];
    case 'lana': return ['lana', 'ropa', 'carne'];
    case 'sal': return ['sal'];
    case 'hierbas': return ['medicinas'];
    case 'arcilla': return ['piedra'];
    case 'ambar': return ['ambar', 'madera'];
    default: return [];
  }
}

export function marketOf(w: WorldState, regionId: number): Market {
  const s = societyOf(w);
  const old = s.market[regionId] as Market | undefined;
  if (old && old.v === 3) return old;
  const r = w.regions[regionId];
  const n = Math.max(6, w.life!.folk.filter((f) => f.alive && f.regionId === regionId).length);
  const stock = zero();
  stock.trigo = n * 3;
  stock.verdura = n * 1.2;
  stock.fruta = n * 0.6;
  stock.carne = n * 0.4;
  stock.pescado = waterOf(w, regionId) > 0.5 ? n * 0.6 : n * 0.1;
  stock.madera = 10;
  stock.piedra = 8;
  stock.hierro = r.resource === 'hierro' ? 10 : 3;
  stock.herramientas = 5;
  stock.ropa = 4;
  stock.armas = 1;
  stock.muebles = 2;
  stock.medicinas = r.resource === 'hierbas' ? 6 : 2;
  stock.semillas = 4;
  stock.lana = r.resource === 'lana' ? 8 : 2;
  stock.sal = r.resource === 'sal' || r.resource === 'pesca' ? 6 : 1;
  stock.ambar = r.resource === 'ambar' ? 3 : 0;
  const demand = zero();
  for (const g of FOODS) demand[g] = (n * 0.85) / 5;
  demand.herramientas = n * 0.03;
  demand.ropa = n * 0.03;
  demand.madera = n * 0.06;
  demand.hierro = 0.5;
  demand.muebles = 0.05;
  demand.medicinas = 0.1;
  demand.semillas = 0.2;
  const m: Market = { v: 3, stock, price: { ...BASE_PRICE }, demand, made: {}, cash: 40 + n * 3, treasury: 15, eaten: 0, hungry: 0, imported: 0, exported: 0, prosperity: 0.62, history: [], wages: {}, news: {}, closedStalls: 0 };
  s.market[regionId] = m;
  return m;
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

export const foodStock = (m: Market) => FOODS.reduce((s, g) => s + m.stock[g], 0);
/** Precio medio de la comida (lo que pagaría una familia corriente). */
export const foodIndex = (m: Market) => FOODS.reduce((s, g) => s + m.price[g] / GOOD[g].base, 0) / FOODS.length;

/** Días de comida que quedan en el mercado para la gente del pueblo. */
export function foodDays(w: WorldState, regionId: number): number {
  const m = marketOf(w, regionId);
  const people = w.life!.folk.filter((f) => f.alive && f.regionId === regionId).length;
  return foodStock(m) / Math.max(1, people * 0.8);
}

/** El factor de lo que da la tierra (para compatibilidad: clima y estado de los campos). */
export function harvestFactor(w: WorldState, regionId: number): number {
  const f = farmOf(w, regionId);
  return clamp(f.growth * f.soil * 1.4, 0.2, 1.5);
}

// ---------------------------------------------------------------------------
// Compraventa: siempre contra el inventario real y la caja real
// ---------------------------------------------------------------------------
/** Un productor vende al mercado: el mercado paga lo que puede con su caja. */
function sellToMarket(m: Market, g: Good, n: number, seller?: Folk): number {
  if (n <= 0) return 0;
  const bid = m.price[g] * 0.72;
  const pay = Math.min(m.cash, n * bid);
  m.cash -= pay;
  m.stock[g] += n;
  if (seller?.p) seller.p.coins = Math.min(400, seller.p.coins + pay);
  return pay;
}

/** Alguien compra al mercado: paga (si puede) y el inventario baja. Devuelve lo comprado. */
function buyFromMarket(m: Market, g: Good, n: number, purse: { coins: number; pay: (x: number) => void }): number {
  const can = Math.min(n, m.stock[g], purse.coins / Math.max(0.05, m.price[g]));
  if (can <= 0) return 0;
  const cost = can * m.price[g];
  purse.pay(cost);
  m.stock[g] -= can;
  m.cash += cost * 0.94;
  m.treasury += cost * 0.06; // tasa del mercado
  return can;
}

const personPurse = (f: Folk) => ({ coins: f.p?.coins ?? 0, pay: (x: number) => f.p && (f.p.coins = Math.max(0, f.p.coins - x)) });

/** El dinero de una casa se comparte (pareja e hijos). */
function householdPurse(members: Folk[]): { coins: number; pay: (n: number) => void } {
  return {
    get coins() {
      return members.reduce((s, o) => s + (o.p?.coins ?? 0), 0);
    },
    pay: (n: number) => {
      let left = n;
      for (const o of [...members].sort((a, b) => (b.p?.coins ?? 0) - (a.p?.coins ?? 0))) {
        const take = Math.min(o.p?.coins ?? 0, left);
        if (o.p) o.p.coins -= take;
        left -= take;
        if (left <= 0) break;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Un día de economía en un pueblo
// ---------------------------------------------------------------------------
export interface EconomyNotes {
  notes: string[]; // 'sube-comida', 'baja-comida', 'hambre', 'quiebra:<id>', 'sin-herramientas'…
  farm: FarmNews[];
}

export function economyDay(w: WorldState, regionId: number, people: Folk[]): string[] {
  return economyDayFull(w, regionId, people).notes;
}

export function economyDayFull(w: WorldState, regionId: number, people: Folk[]): EconomyNotes {
  const m = marketOf(w, regionId);
  const r = w.regions[regionId];
  const notes: string[] = [];
  bridgeIn(w, regionId, m, people.length);
  const income = new Map<Folk, number>();
  const add = (f: Folk, c: number) => income.set(f, (income.get(f) ?? 0) + c);
  const workers = people.filter((f) => working(w, f));
  const effort = (f: Folk) => 0.7 + trait(f, 'trabajador') / 170 - trait(f, 'perezoso') / 400;
  // Herramientas: sin ellas se trabaja mucho peor (y se gastan).
  const producers = workers.filter((f) => ['campesino', 'pescador', 'minero', 'lenador', 'carpintero', 'artesano', 'pastor', 'tejedor'].includes(f.role));
  const tools = 0.6 + 0.4 * clamp(m.stock.herramientas / Math.max(1, producers.length * 0.35));
  const wear = producers.length * 0.03;
  if (m.stock.herramientas < 0.5 && producers.length) notes.push('sin-herramientas');
  m.stock.herramientas = Math.max(0, m.stock.herramientas - wear);
  m.demand.herramientas = m.demand.herramientas * 0.8 + wear * 0.2;
  const made = zero();
  const produce = (f: Folk, g: Good, n: number) => {
    if (n <= 0) return;
    made[g] += n;
    add(f, sellToMarket(m, g, n, f));
  };
  // Materias primas.
  const forest = nearTiles(w, regionId, (t) => t === T.Forest);
  const rock = nearTiles(w, regionId, (t) => t === T.Mountain || t === T.Rock);
  const water = waterOf(w, regionId);
  const season = seasonOf(w.day);
  const weather = weatherOf(w, w.day);
  for (const f of workers) {
    const k = effort(f) * tools;
    switch (f.role) {
      case 'pescador':
        produce(f, 'pescado', 2.3 * k * water * clamp(r.ecology + 0.3) * (season === 'invierno' ? 0.6 : 1) * (weather === 'tormenta' ? 0.2 : 1));
        if (r.coastal || r.resource === 'pesca') produce(f, 'sal', 0.15 * k);
        break;
      case 'pastor':
        produce(f, 'carne', 0.55 * k * clamp(r.ecology + 0.3));
        produce(f, 'lana', 0.8 * k);
        break;
      case 'minero': {
        const iron = r.resource === 'hierro' || m.mine ? 1.3 : rock > 20 ? 0.45 : 0.2;
        produce(f, 'hierro', iron * k);
        produce(f, 'piedra', (0.6 + Math.min(1, rock / 40)) * k);
        if (r.resource === 'sal') produce(f, 'sal', 0.8 * k);
        break;
      }
      case 'lenador':
        produce(f, 'madera', (0.8 + Math.min(1.6, forest / 30)) * k);
        if (r.resource === 'ambar') produce(f, 'ambar', 0.06 * k);
        break;
      case 'carpintero': {
        const use = buyFromMarket(m, 'madera', Math.min(m.stock.madera, 1.4 * k), personPurse(f));
        produce(f, 'muebles', use * 0.35);
        produce(f, 'herramientas', use * 0.08);
        break;
      }
      case 'artesano': {
        // El herrero: hierro y algo de madera → herramientas (y armas si hay tensión).
        const iron = Math.min(m.stock.hierro, 1.1 * k);
        const got = buyFromMarket(m, 'hierro', iron, personPurse(f));
        buyFromMarket(m, 'madera', Math.min(m.stock.madera, got * 0.3), personPurse(f));
        const arms = r.flags.guerra || r.militancy > 0.55 ? 0.45 : 0.1;
        produce(f, 'herramientas', got * 0.85 * (1 - arms));
        produce(f, 'armas', got * 0.5 * arms);
        if (got < 0.2 && m.stock.hierro < 0.3) notes.push('sin-hierro');
        break;
      }
      case 'tejedor': {
        const got = buyFromMarket(m, 'lana', Math.min(m.stock.lana, 1.2 * k), personPurse(f));
        produce(f, 'ropa', got * 0.7);
        break;
      }
      case 'sanadora':
        produce(f, 'medicinas', (r.resource === 'hierbas' ? 0.9 : 0.35) * k * clamp(r.ecology + 0.4));
        break;
    }
  }
  // El campo: siembra, crecimiento y cosecha (con las semillas y herramientas que haya).
  const farmers = workers.filter((f) => f.role === 'campesino');
  const fe = farmers.length ? farmers.reduce((s, f) => s + effort(f), 0) / farmers.length : 0;
  const helpers = workers.filter((f) => f.role !== 'campesino' && (f.p?.needs.comida ?? 1) < 0.6 && !['lider', 'guardia'].includes(f.role)).length + people.filter((f) => f.age >= 11 && f.age < 15).length;
  const farmed = farmDay(w, regionId, farmers.length ? fe : 0.8, farmers.length, tools, helpers);
  for (const [g, n] of [['trigo', farmed.trigo], ['verdura', farmed.verdura], ['fruta', farmed.fruta]] as const)
    for (const f of farmers.length ? farmers : workers.slice(0, 1)) produce(f, g, n / Math.max(1, farmers.length));
  // Semilla: los campesinos venden lo que les sobra y compran lo que les falta en primavera.
  const farm = farmOf(w, regionId);
  if (season === 'otoño' && farm.seeds > farm.plots * 1.6 && farmers.length) {
    const extra = farm.seeds - farm.plots * 1.3;
    farm.seeds -= extra;
    produce(farmers[0], 'semillas', extra);
  } else if (season === 'primavera' && farm.seeds < farm.plots - farm.sown && farmers.length) {
    const want = farm.plots - farm.sown - farm.seeds;
    const purse = householdPurse(farmers);
    const got = buyFromMarket(m, 'semillas', want, purse);
    farm.seeds += got;
    m.demand.semillas = m.demand.semillas * 0.7 + want * 0.3;
  }
  // Las familias: comida según lo que tienen; ropa, muebles, leña, medicinas.
  const houses = new Map<number, Folk[]>();
  for (const f of people) if (f.p && !(f.p.away && f.p.away.back > w.day)) (houses.get(f.house) ?? houses.set(f.house, []).get(f.house)!).push(f);
  let eaten = 0;
  let hungry = 0;
  const spent = zero();
  for (const members of houses.values()) {
    const purse = householdPurse(members);
    const wealth = purse.coins / members.length;
    const rich = wealth > 18;
    const poor = wealth < 4;
    const need = members.reduce((s, f) => s + (f.age < 14 ? 0.5 : 0.85), 0) * (rich ? 1.15 : poor ? 0.9 : 1);
    // Orden de preferencia: las casas ricas comen mejor; las pobres, lo más barato.
    const order = rich ? (['carne', 'fruta', 'pescado', 'trigo', 'verdura'] as Good[]) : ([...FOODS].sort((a, b) => m.price[a] - m.price[b]));
    let got = 0;
    // Quien produce comida guarda algo para su casa.
    const own = members.some((f) => ['campesino', 'pastor', 'pescador'].includes(f.role)) ? Math.min(need * 0.45, 1.2) : 0;
    if (own > 0) {
      const g = members.some((f) => f.role === 'pescador') ? 'pescado' : members.some((f) => f.role === 'pastor') ? 'carne' : 'trigo';
      const take = Math.min(own, m.stock[g]);
      m.stock[g] -= take;
      got += take;
    }
    for (const g of order) {
      if (got >= need) break;
      const share = rich ? (need - got) * 0.5 : need - got;
      const b = buyFromMarket(m, g, Math.min(share, need - got), purse);
      got += b;
      spent[g] += b;
    }
    // Con los graneros llenos, el pueblo no deja que nadie pase hambre: las arcas pagan su pan.
    if (got < need * 0.65 && foodStock(m) > people.length * 0.8 * 3 && m.treasury > 1) {
      const aid = { coins: m.treasury, pay: (x: number) => (m.treasury = Math.max(0, m.treasury - x)) };
      for (const g of [...FOODS].sort((a, b) => m.price[a] - m.price[b])) {
        if (got >= need * 0.75) break;
        got += buyFromMarket(m, g, need * 0.75 - got, aid);
      }
    }
    // Si no llega, quien tiene semilla se la come.
    if (got < need * 0.7 && members.some((f) => f.role === 'campesino')) got += eatSeeds(w, regionId, need * 0.7 - got, got < need * 0.3);
    eaten += got;
    const sat = clamp(got / need);
    for (const f of members) if (f.p) f.p.needs.comida = clamp(f.p.needs.comida * 0.5 + sat * 0.5);
    if (sat < 0.65) hungry += members.length;
    // Otros gastos, según el bolsillo.
    if (!poor) {
      spent.ropa += buyFromMarket(m, 'ropa', members.length * (rich ? 0.05 : 0.025), purse);
      if (rich) spent.muebles += buyFromMarket(m, 'muebles', 0.02 * members.length, purse);
    }
    if (season === 'invierno' || weather === 'nieve') spent.madera += buyFromMarket(m, 'madera', 0.25, purse);
    const sick = members.filter((f) => f.p?.sick !== undefined && f.p.sick >= w.day);
    if (sick.length) {
      const med = buyFromMarket(m, 'medicinas', sick.length * 0.3, purse);
      spent.medicinas += med;
      if (med > 0.2) for (const f of sick) if (f.p && f.p.sick! > w.day && trait(f, 'valiente') >= 0) f.p.sick = Math.max(w.day, f.p.sick! - 1);
    }
    // Ocio: los que pueden, gastan en la posada.
    const inn = people.find((f) => f.role === 'posadero' && working(w, f));
    if (inn && !poor && purse.coins > 3) {
      const c = Math.min(purse.coins * 0.04, 0.6);
      purse.pay(c);
      add(inn, c);
      if (inn.p) inn.p.coins += c;
    }
  }
  // Construcción y reparaciones gastan madera y piedra (las pide life.updateTown).
  // Sueldos públicos: guardias, consejo, sanadora y exploradores cobran de las arcas.
  for (const f of workers) {
    if (!['guardia', 'lider', 'exploradora'].includes(f.role)) continue;
    const wage = f.role === 'lider' ? 1.6 : 0.9;
    const pay = Math.min(m.treasury, wage);
    m.treasury -= pay;
    if (f.p) f.p.coins += pay;
    add(f, pay);
  }
  // Comerciantes: se llevan su parte de la caja; si no queda nada, quiebran.
  const merchants = workers.filter((f) => f.role === 'comerciante');
  const sales = GOODS.reduce((s, g) => s + spent[g] * m.price[g], 0);
  for (const f of merchants) {
    const take = Math.min(Math.max(0, m.cash - 25), (sales * 0.14) / merchants.length + 0.3);
    m.cash -= take;
    if (f.p) f.p.coins += take;
    add(f, take);
    if ((f.p?.coins ?? 0) < 0.5 && m.cash < 8 && !notes.some((n) => n.startsWith('quiebra'))) notes.push(`quiebra:${f.id}`);
  }
  // El dinero no se queda quieto: los comerciantes con mucho ahorro compran género; las arcas, obras y grano.
  for (const f of merchants) if (f.p && f.p.coins > 45) {
    const inv = (f.p.coins - 45) * 0.3;
    f.p.coins -= inv;
    m.cash += inv;
  }
  if (m.treasury > 30) {
    const spend = (m.treasury - 30) * 0.3;
    m.treasury -= spend;
    m.cash += spend;
  }
  m.closedStalls = merchants.length ? Math.max(0, merchants.length - Math.floor(m.cash / 20) - 1) : 0;
  // Salarios reales (con inercia): lo que gana de verdad cada oficio.
  const byRole = new Map<FolkRole, number[]>();
  for (const f of workers) (byRole.get(f.role) ?? byRole.set(f.role, []).get(f.role)!).push(income.get(f) ?? 0);
  for (const [role, list] of byRole) m.wages[role] = Math.round(((m.wages[role] ?? list[0]) * 0.8 + (list.reduce((a, b) => a + b, 0) / list.length) * 0.2) * 100) / 100;
  for (const f of workers) if (f.p) (f.p as { income?: number }).income = Math.round(((f.p as { income?: number }).income ?? 0) * 0.8 * 100 + (income.get(f) ?? 0) * 0.2 * 100) / 100;
  // Demanda (con inercia) y precios: escasez → suben; abundancia → bajan.
  const n = Math.max(1, people.length);
  for (const g of FOODS) m.demand[g] = m.demand[g] * 0.8 + (spent[g] + ((n * 0.85) / 5) * 0.3) * 0.2;
  for (const g of GOODS) if (!FOODS.includes(g) && g !== 'herramientas' && g !== 'semillas') m.demand[g] = m.demand[g] * 0.85 + spent[g] * 0.15 + 0.01;
  const oldFood = foodIndex(m);
  const isolated = !routesOf(w, regionId).some((x) => x.status === 'abierta');
  for (const g of GOODS) {
    const days = FOODS.includes(g) ? foodStock(m) / Math.max(0.5, n * 0.8) + m.stock[g] / Math.max(0.2, m.demand[g]) * 0.15 : m.stock[g] / Math.max(0.15, m.demand[g]);
    let target = GOOD[g].base * clamp(2.4 / (days + 0.45), 0.45, 5.5);
    if (r.flags.guerra && (g === 'armas' || FOODS.includes(g) || g === 'medicinas')) target *= 1.25;
    if (isolated && m.stock[g] < m.demand[g] * 3) target *= 1.3;
    m.price[g] = Math.round((m.price[g] * 0.65 + target * 0.35) * 100) / 100;
  }
  m.made = Object.fromEntries(GOODS.filter((g) => made[g] > 0).map((g) => [g, Math.round(made[g] * 10) / 10]));
  m.eaten = eaten;
  m.hungry = hungry;
  const newFood = foodIndex(m);
  if (newFood > oldFood * 1.12 && newFood > 1.5) notes.push('sube-comida');
  if (newFood < oldFood * 0.88 && oldFood > 1.5) notes.push('baja-comida');
  if (hungry >= Math.max(2, people.length * 0.25)) notes.push('hambre');
  // Lo que se echa a perder (la comida no dura para siempre).
  for (const g of ['verdura', 'fruta', 'pescado', 'carne'] as Good[]) m.stock[g] *= 0.94;
  m.stock.trigo *= 0.995;
  for (const g of GOODS) m.stock[g] = Math.round(m.stock[g] * 100) / 100;
  m.cash = Math.round(m.cash * 100) / 100;
  m.treasury = Math.round(m.treasury * 100) / 100;
  bridgeOut(w, regionId, m, people.length);
  return { notes, farm: farmed.news };
}

// ---------------------------------------------------------------------------
// Puente con el motor: el mercado manda; lo que el motor cambie (ayudas,
// saqueos, caravanas) entra como un cambio en el mercado.
// ---------------------------------------------------------------------------
function engineFood(w: WorldState, regionId: number): number {
  const r = w.regions[regionId];
  return r.isHome ? w.player.reserves / 5 : r.food;
}

function bridgeIn(w: WorldState, regionId: number, m: Market, people: number): void {
  if (m.bridge === undefined) return;
  const d = engineFood(w, regionId) - m.bridge;
  if (Math.abs(d) < 0.05) return;
  const units = d * Math.max(1, people * 0.8);
  if (units > 0) m.stock.trigo += units;
  else {
    let left = -units;
    for (const g of FOODS) {
      const take = Math.min(m.stock[g], left);
      m.stock[g] -= take;
      left -= take;
    }
  }
}

function bridgeOut(w: WorldState, regionId: number, m: Market, people: number): void {
  const r = w.regions[regionId];
  const days = clamp(foodStock(m) / Math.max(1, people * 0.8), 0, 30);
  if (r.isHome) w.player.reserves = clamp(days * 5, 0, 100);
  else r.food = days;
  m.bridge = engineFood(w, regionId);
}

/** Prosperidad (interna): comida, empleo, ingresos, seguridad, vivienda, comercio, gente. */
export function prosperityDay(w: WorldState, regionId: number, people: Folk[]): number {
  const m = marketOf(w, regionId);
  const r = w.regions[regionId];
  const t = w.life!.towns[regionId];
  const food = clamp(foodDays(w, regionId) / 6);
  const adults = people.filter((f) => f.age >= 16 && f.role !== 'anciano');
  const employed = adults.length ? adults.filter((f) => (f.p?.needs.trabajo ?? 0.6) > 0.45).length / adults.length : 0.5;
  const money = clamp(people.reduce((s, f) => s + (f.p?.coins ?? 0), 0) / Math.max(1, people.length) / 12);
  const safety = r.flags.guerra ? 0.2 : clamp(1 - r.militancy * 0.4);
  const housing = t ? clamp(1 - (t.burned.length * 0.15) - Math.max(0, r.population / (Math.max(1, t.houses) * 60) - 1)) : 0.7;
  const trade = clamp(routesOf(w, regionId).reduce((s, x) => s + (x.status === 'abierta' ? x.traffic : 0), 0) / 1.5);
  const hungry = 1 - clamp(m.hungry / Math.max(1, people.length));
  const p = food * 0.3 + hungry * 0.25 + employed * 0.1 + money * 0.1 + safety * 0.1 + housing * 0.08 + trade * 0.07;
  m.prosperity = Math.round((m.prosperity * 0.8 + p * 0.2) * 1000) / 1000;
  m.history.push({ day: w.day, food: Math.round(foodIndex(m) * 100) / 100, pop: Math.round(r.population), prosperity: m.prosperity, hungry: m.hungry });
  if (m.history.length > 200) m.history.shift();
  return m.prosperity;
}

// ---------------------------------------------------------------------------
// Lo que el jugador ve y paga
// ---------------------------------------------------------------------------
/** Precio de una comida corriente en monedas enteras. */
export function foodPrice(w: WorldState, regionId: number): number {
  return Math.max(1, Math.round(foodIndex(marketOf(w, regionId))));
}

/** Cómo se ve el mercado: lo que el jugador nota sin cifras. */
export function stallLook(w: WorldState, regionId: number): 'lleno' | 'normal' | 'escaso' | 'vacio' {
  const days = foodDays(w, regionId);
  return days > 5 ? 'lleno' : days > 1.5 ? 'normal' : days > 0.3 ? 'escaso' : 'vacio';
}

/** Cantidad en palabras (información imperfecta: se ve, no se cuenta). */
export function amountWord(m: Market, g: Good): string {
  const s = m.stock[g];
  const d = s / Math.max(0.15, m.demand[g]);
  if (s < 0.5) return 'no hay';
  if (d < 1.5) return 'queda muy poco';
  if (d < 4) return 'poco';
  if (d < 10) return 'bastante';
  return 'mucho';
}

export function priceWord(m: Market, g: Good): string {
  const k = m.price[g] / GOOD[g].base;
  return k > 2.4 ? 'carísimo' : k > 1.5 ? 'caro' : k < 0.7 ? 'barato' : 'a buen precio';
}

/** El jugador compra o vende en el mercado (lo usa el comercio del jugador). */
export function trade(w: WorldState, regionId: number, good: Good | 'comida', n: number): void {
  const m = marketOf(w, regionId);
  if (good === 'comida') {
    let left = n;
    for (const g of [...FOODS].sort((a, b) => m.price[a] - m.price[b])) {
      const take = Math.min(m.stock[g], left);
      m.stock[g] -= take;
      left -= take;
      if (left <= 0) break;
    }
    m.cash += foodPrice(w, regionId) * n;
    return;
  }
  m.stock[good] = Math.max(0, m.stock[good] - n);
}

export { buyFromMarket, sellToMarket, personPurse };
