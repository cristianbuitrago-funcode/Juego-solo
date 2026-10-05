import { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { seasonOf } from './clock';
import { FOODS, GOOD, GOODS, marketOf, type Good } from './economy';
import { farmOf, giveSeeds } from './farming';
import { ROLE_TITLE } from './folk';
import { seedRumor } from './gossip';
import { deed, gain, story, type GainNote } from './identity';
import { folkById, logEvent, memorize, societyOf } from './society';
import { depart, distanceOf, tradeOf } from './trade';
import type { Folk } from './types';

/**
 * El jugador en la economía, desde abajo: compra y vende (y al hacerlo mueve
 * los precios), carga lo que puede llevar (a pie poco; con mula o carreta,
 * más), acepta encargos, ayuda, y con el tiempo puede abrir un negocio y
 * contratar a alguien. Nadie le avisa de las consecuencias: si se lleva todo
 * el hierro de un pueblo, el herrero se quedará sin nada que forjar.
 */
export type Vehicle = 'pie' | 'mula' | 'carreta';
export type BusinessKind = 'puesto' | 'granja' | 'transporte' | 'taller' | 'herreria' | 'posada';

export interface Business {
  id: string;
  kind: BusinessKind;
  regionId: number;
  opened: number;
  cash: number;
  stock: Partial<Record<Good, number>>;
  workers: string[];
  wage: number;
  route?: { to: number; good: Good };
  sown?: number;
  log: { day: number; text: string }[];
}

export interface Contract {
  id: string;
  from: number;
  to: number;
  good: Good;
  qty: number;
  pay: number;
  due: number;
  merchant: string;
  done?: boolean;
}

export interface PlayerEconomy {
  cargo: Partial<Record<Good, number>>;
  vehicle: Vehicle;
  businesses: Business[];
  contracts: Contract[];
  notes: Record<number, { day: number; price: Partial<Record<Good, number>> }>; // precios que el jugador conoce
  impact: { day: number; regionId: number; good: Good; share: number; buy: boolean }[]; // grandes compras o ventas (sus efectos llegan solos)
}

export function playerEco(w: WorldState): PlayerEconomy {
  const s = societyOf(w) as ReturnType<typeof societyOf> & { player?: PlayerEconomy };
  return (s.player ??= { cargo: {}, vehicle: 'pie', businesses: [], contracts: [], notes: {}, impact: [] });
}

export const CAPACITY: Record<Vehicle, number> = { pie: 6, mula: 16, carreta: 40 };
export const VEHICLE_PRICE: Record<Exclude<Vehicle, 'pie'>, number> = { mula: 14, carreta: 34 };
export const BUSINESS_COST: Record<BusinessKind, number> = { puesto: 20, granja: 14, transporte: 12, taller: 60, herreria: 80, posada: 120 };
/** Negocios que ya funcionan (los demás quedan preparados para más adelante). */
export const BUSINESS_READY: BusinessKind[] = ['puesto', 'granja', 'transporte'];

export const cargoCount = (pe: PlayerEconomy) => Object.values(pe.cargo).reduce((s, n) => s + (n ?? 0), 0);
export const capacityOf = (pe: PlayerEconomy) => CAPACITY[pe.vehicle];

const coins = (w: WorldState) => w.life!.identity!.needs;

/** El jugador apunta lo que vale cada cosa en un mercado (conocimiento que es ventaja). */
export function notePrices(w: WorldState, regionId: number): void {
  const m = marketOf(w, regionId);
  playerEco(w).notes[regionId] = { day: w.day, price: Object.fromEntries(GOODS.map((g) => [g, Math.round(m.price[g] * 10) / 10])) };
}

/** Precio por unidad al comprar n (sube según se vacía el puesto). */
export function quoteBuy(w: WorldState, regionId: number, g: Good, n: number): number {
  const m = marketOf(w, regionId);
  let total = 0;
  for (let i = 0; i < n; i++) total += m.price[g] * (1 + (0.7 * (i + 0.5)) / Math.max(1, m.stock[g]));
  return Math.ceil(total);
}

export function quoteSell(w: WorldState, regionId: number, g: Good, n: number): number {
  const m = marketOf(w, regionId);
  let total = 0;
  for (let i = 0; i < n; i++) total += m.price[g] * 0.8 * Math.max(0.35, 1 - (0.5 * (i + 0.5)) / Math.max(4, m.stock[g] + m.demand[g] * 4));
  return Math.floor(Math.min(total, m.cash));
}

export interface TradeResult {
  ok: boolean;
  text: string;
  notes: GainNote[];
}

export function playerBuy(w: WorldState, regionId: number, g: Good, n: number): TradeResult {
  const pe = playerEco(w);
  const m = marketOf(w, regionId);
  const room = capacityOf(pe) - cargoCount(pe);
  n = Math.min(n, Math.floor(m.stock[g]), room);
  if (n <= 0) return { ok: false, text: room <= 0 ? 'No te cabe nada más. Necesitarías una mula o una carreta.' : `No queda ${GOOD[g].name}.`, notes: [] };
  const cost = quoteBuy(w, regionId, g, n);
  if (coins(w).coins < cost) return { ok: false, text: `Cuesta ${cost} monedas. No te llega.`, notes: [] };
  const before = m.stock[g];
  coins(w).coins -= cost;
  m.cash += cost * 0.94;
  m.treasury += cost * 0.06;
  m.stock[g] -= n;
  // El precio reacciona en el acto.
  m.price[g] = Math.round(m.price[g] * (1 + (0.45 * n) / Math.max(1, before)) * 100) / 100;
  pe.cargo[g] = (pe.cargo[g] ?? 0) + n;
  if (n / Math.max(1, before) > 0.35) pe.impact.push({ day: w.day, regionId, good: g, share: n / before, buy: true });
  if (pe.impact.length > 30) pe.impact.shift();
  deed(w.life!.identity!, 'comerciar');
  notePrices(w, regionId);
  return { ok: true, text: `Compras ${n} de ${GOOD[g].name} por ${cost} monedas.`, notes: gain(w, 'comercio', 0.25 + n * 0.03) };
}

export function playerSell(w: WorldState, regionId: number, g: Good, n: number): TradeResult {
  const pe = playerEco(w);
  const m = marketOf(w, regionId);
  n = Math.min(n, Math.floor(pe.cargo[g] ?? 0));
  if (n <= 0) return { ok: false, text: `No llevas ${GOOD[g].name}.`, notes: [] };
  const pay = quoteSell(w, regionId, g, n);
  if (pay <= 0) return { ok: false, text: 'El mercado no tiene dinero para comprarte nada ahora mismo.', notes: [] };
  const before = m.stock[g] + m.demand[g] * 4;
  m.cash -= pay;
  m.stock[g] += n;
  m.price[g] = Math.round(m.price[g] * Math.max(0.5, 1 - (0.35 * n) / Math.max(2, before)) * 100) / 100;
  pe.cargo[g] = (pe.cargo[g] ?? 0) - n;
  if (!pe.cargo[g]) delete pe.cargo[g];
  coins(w).coins += pay;
  if (n / Math.max(1, before) > 0.5) pe.impact.push({ day: w.day, regionId, good: g, share: n / before, buy: false });
  deed(w.life!.identity!, 'comerciar');
  notePrices(w, regionId);
  return { ok: true, text: `Vendes ${n} de ${GOOD[g].name} por ${pay} monedas.`, notes: gain(w, 'comercio', 0.3 + n * 0.03) };
}

export function buyVehicle(w: WorldState, regionId: number, v: Exclude<Vehicle, 'pie'>): TradeResult {
  const pe = playerEco(w);
  const price = VEHICLE_PRICE[v];
  if (pe.vehicle === v || (pe.vehicle === 'carreta' && v === 'mula')) return { ok: false, text: 'Ya tienes algo mejor.', notes: [] };
  if (coins(w).coins < price) return { ok: false, text: `${v === 'mula' ? 'Una mula' : 'Una carreta con su mula'} cuesta ${price} monedas.`, notes: [] };
  const m = marketOf(w, regionId);
  coins(w).coins -= price;
  m.cash += price;
  if (v === 'carreta') m.stock.madera = Math.max(0, m.stock.madera - 3);
  pe.vehicle = v;
  story(w, v === 'mula' ? 'Compró una mula para cargar mercancía.' : 'Compró una carreta. Ya podía mover mercancía de verdad.', 'logro');
  return { ok: true, text: v === 'mula' ? 'La mula te mira con desconfianza. Pero carga lo que le pongas.' : 'Una carreta de ruedas nuevas. Cabe de todo.', notes: gain(w, 'comercio', 0.5) };
}

/** Dar algo de tu carga. La semilla a los campesinos vale más que el pan: es la cosecha del año que viene. */
export function donate(w: WorldState, regionId: number, g: Good, n: number): TradeResult {
  const pe = playerEco(w);
  n = Math.min(n, Math.floor(pe.cargo[g] ?? 0));
  if (n <= 0) return { ok: false, text: `No llevas ${GOOD[g].name}.`, notes: [] };
  pe.cargo[g] = (pe.cargo[g] ?? 0) - n;
  if (!pe.cargo[g]) delete pe.cargo[g];
  const life = w.life!;
  const people = life.folk.filter((f) => f.alive && f.regionId === regionId && f.p);
  const gen = life.player.generation;
  let who: Folk[] = [];
  if (g === 'semillas') {
    giveSeeds(w, regionId, n);
    who = people.filter((f) => f.role === 'campesino');
  } else if (FOODS.includes(g)) {
    who = [...people].sort((a, b) => a.p!.needs.comida - b.p!.needs.comida).slice(0, Math.max(1, Math.ceil(n / 2)));
    for (const f of who) f.p!.needs.comida = clamp(f.p!.needs.comida + n / who.length / 2);
  } else {
    marketOf(w, regionId).stock[g] += n;
    who = people.filter((f) => f.role === 'comerciante').slice(0, 1);
  }
  for (const f of who.slice(0, 4)) {
    f.memories.push({ day: w.day, kind: g === 'semillas' ? 'ayuda' : 'comida', weight: 0.55, gen });
    f.trust = clamp(f.trust + 0.08);
    f.gratitude = clamp(f.gratitude + 0.2);
    memorize(w, f, { kind: 'ayuda', about: 'jugador', text: g === 'semillas' ? 'Nos trajo semilla cuando no teníamos.' : 'Nos dio de comer.', w: 0.6, src: 'propio' });
  }
  if (who[0]) seedRumor(w, { regionId, kind: 'p_ayuda', subject: 'jugador', target: who[0].id, witnesses: who.map((f) => f.id), heat: 1.1 });
  story(w, g === 'semillas' ? `Llevó ${n} de semilla a los campesinos de ${w.regions[regionId].name}.` : `Repartió ${GOOD[g].name} en ${w.regions[regionId].name}.`, 'decision');
  deed(life.identity!, 'ayudar');
  logEvent(w, regionId, 'ayuda', g === 'semillas' ? `El forastero ha traído semilla para los campos de ${w.regions[regionId].name}.` : `El forastero ha repartido ${GOOD[g].name}.`, who.map((f) => f.id));
  return { ok: true, text: g === 'semillas' ? `Los campesinos se reparten la semilla. ${farmOf(w, regionId).seeds > farmOf(w, regionId).plots ? 'Habrá con qué sembrar.' : 'Aún no llega para todos los campos.'}` : 'Lo repartes entre quienes más lo necesitan.', notes: gain(w, 'diplomacia', 0.4) };
}

// ---------------------------------------------------------------------------
// Negocios
// ---------------------------------------------------------------------------
export function openBusiness(w: WorldState, regionId: number, kind: BusinessKind, opts: { to?: number; good?: Good } = {}): TradeResult {
  const pe = playerEco(w);
  if (!BUSINESS_READY.includes(kind)) return { ok: false, text: 'Nadie te vende un local así todavía. Quizá más adelante.', notes: [] };
  if (pe.businesses.some((b) => b.kind === kind && b.regionId === regionId)) return { ok: false, text: 'Ya tienes uno aquí.', notes: [] };
  if (kind === 'transporte' && pe.vehicle !== 'carreta') return { ok: false, text: 'Para un negocio de transporte necesitas una carreta.', notes: [] };
  const cost = BUSINESS_COST[kind];
  if (coins(w).coins < cost) return { ok: false, text: `Hace falta reunir ${cost} monedas.`, notes: [] };
  coins(w).coins -= cost;
  const m = marketOf(w, regionId);
  m.cash += cost * 0.5;
  m.treasury += cost * 0.5;
  const b: Business = { id: `nb${++societyOf(w).seq}`, kind, regionId, opened: w.day, cash: 0, stock: {}, workers: [], wage: 1, log: [], route: kind === 'transporte' && opts.to !== undefined && opts.good ? { to: opts.to, good: opts.good } : undefined };
  pe.businesses.push(b);
  const what = kind === 'puesto' ? 'un puesto en el mercado' : kind === 'granja' ? 'un campo en arriendo' : 'un negocio de transporte';
  story(w, `Abrió ${what} en ${w.regions[regionId].name}.`, 'logro');
  logEvent(w, regionId, 'negocio', `El forastero ha abierto ${what}.`, []);
  return { ok: true, text: `Ya tienes ${what}.`, notes: gain(w, 'comercio', 1) };
}

/** Meter mercancía de tu carga en tu puesto (o semilla en tu campo). */
export function stockBusiness(w: WorldState, bizId: string, g: Good, n: number): TradeResult {
  const pe = playerEco(w);
  const b = pe.businesses.find((x) => x.id === bizId);
  n = Math.min(n, Math.floor(pe.cargo[g] ?? 0));
  if (!b || n <= 0) return { ok: false, text: 'No llevas eso.', notes: [] };
  pe.cargo[g] = (pe.cargo[g] ?? 0) - n;
  if (!pe.cargo[g]) delete pe.cargo[g];
  b.stock[g] = (b.stock[g] ?? 0) + n;
  return { ok: true, text: `Dejas ${n} de ${GOOD[g].name} en tu ${b.kind === 'granja' ? 'campo' : 'puesto'}.`, notes: [] };
}

export function withdraw(w: WorldState, bizId: string): TradeResult {
  const b = playerEco(w).businesses.find((x) => x.id === bizId);
  if (!b || b.cash < 1) return { ok: false, text: 'No hay nada que sacar.', notes: [] };
  const n = Math.floor(b.cash);
  b.cash -= n;
  coins(w).coins += n;
  return { ok: true, text: `Sacas ${n} monedas de la caja.`, notes: [] };
}

/** Contratar a alguien: acepta si lo que pagas mejora lo que gana (o si no tiene trabajo). */
export function hire(w: WorldState, bizId: string, folkId: string, wage: number): TradeResult {
  const b = playerEco(w).businesses.find((x) => x.id === bizId);
  const f = folkById(w, folkId);
  if (!b || !f?.p) return { ok: false, text: '…', notes: [] };
  const income = (f.p as { income?: number }).income ?? 0.5;
  if (wage < income * 1.1 && f.p.needs.trabajo > 0.45) return { ok: false, text: `«Con eso gano menos que ahora de ${ROLE_TITLE[f.role]}.»`, notes: [] };
  if (f.trust < 0.3) return { ok: false, text: '«No trabajo para gente de la que no me fío.»', notes: [] };
  b.workers.push(f.id);
  b.wage = wage;
  (f.p as { employer?: string }).employer = b.id;
  b.log.push({ day: w.day, text: `Contrataste a ${f.name}.` });
  story(w, `Contrató a ${f.name} para su negocio.`, 'logro');
  return { ok: true, text: `«Trato hecho. Mañana empiezo.»`, notes: gain(w, 'liderazgo', 0.6) };
}

/** Cada día, los negocios del jugador funcionan solos (con sus trabajadores). */
export function businessDay(w: WorldState): void {
  const pe = playerEco(w);
  const rng = new Rng(w.seed ^ Math.imul(w.day, 0x51ed));
  for (const b of pe.businesses) {
    const m = marketOf(w, b.regionId);
    const staff = b.workers.map((id) => folkById(w, id)).filter((f): f is Folk => !!f?.alive && f.regionId === b.regionId);
    // Sueldos: si no se pagan, la gente se va.
    for (const f of staff) {
      if (b.cash >= b.wage) {
        b.cash -= b.wage;
        f.p!.coins += b.wage;
      } else {
        b.workers = b.workers.filter((x) => x !== f.id);
        delete (f.p as { employer?: string }).employer;
        memorize(w, f, { kind: 'impago', about: 'jugador', text: 'No me pagó.', w: -0.5, src: 'propio' });
        b.log.push({ day: w.day, text: `${f.name} se ha ido: no había con qué pagarle.` });
      }
    }
    const hands = b.workers.length;
    if (b.kind === 'puesto') {
      // Vende lo que el mercado no tiene en abundancia, al precio del día.
      for (const g of Object.keys(b.stock) as Good[]) {
        const have = b.stock[g] ?? 0;
        const wanted = Math.max(0, m.demand[g] * 3 - m.stock[g] * 0.5) * (hands ? 1 : 0.5);
        const n = Math.min(have, Math.max(0.5, wanted));
        if (n <= 0) continue;
        const pay = Math.min(m.cash, n * m.price[g] * 0.9);
        if (pay <= 0) continue;
        m.cash -= pay;
        m.stock[g] += n;
        b.stock[g] = have - n;
        if (b.stock[g]! < 0.01) delete b.stock[g];
        b.cash += pay;
      }
    } else if (b.kind === 'granja') {
      const season = seasonOf(w.day);
      if (season === 'primavera' && (b.stock.semillas ?? 0) > 0 && hands) {
        const n = Math.min(b.stock.semillas!, 3 * hands);
        b.stock.semillas! -= n;
        b.sown = (b.sown ?? 0) + n;
      }
      if (season === 'otoño' && b.sown) {
        const f = farmOf(w, b.regionId);
        const crop = (b.sown * (0.8 + f.growth * f.growth * 20) * f.soil) / 5;
        b.stock.trigo = (b.stock.trigo ?? 0) + crop * 0.75;
        b.stock.semillas = (b.stock.semillas ?? 0) + crop * 0.25;
        if (Math.floor((w.day - 1) % 20) === 14) {
          b.log.push({ day: w.day, text: `Cosecha de tu campo: ${Math.round(b.stock.trigo)} de trigo.` });
          b.sown = 0;
        }
      }
    } else if (b.kind === 'transporte' && b.route && hands && pe.vehicle === 'carreta') {
      const busy = tradeOf(w).convoys.some((c) => c.owner === b.id && c.status !== 'llegada' && c.status !== 'atacada');
      if (!busy && Number.isFinite(distanceOf(w, b.regionId, b.route.to))) {
        const g = b.route.good;
        const n = Math.floor(Math.min(30, m.stock[g] * 0.5, b.cash / Math.max(0.1, m.price[g])));
        if (n >= 3) {
          const cost = n * m.price[g];
          b.cash -= cost;
          m.cash += cost;
          m.stock[g] -= n;
          depart(w, rng, { kind: 'jugador', owner: b.id, ownerName: `${staff[0]?.name ?? 'tu carretero'} (tu carreta)`, from: b.regionId, to: b.route.to, cargo: { [g]: n }, cost });
          b.log.push({ day: w.day, text: `Sale tu carreta con ${n} de ${GOOD[g].name} hacia ${w.regions[b.route.to].name}.` });
        }
      }
    }
    if (b.log.length > 12) b.log.splice(0, b.log.length - 12);
  }
}

// ---------------------------------------------------------------------------
// Encargos: llevar mercancía de un comerciante a otro pueblo
// ---------------------------------------------------------------------------
export function offerContract(w: WorldState, merchant: Folk): Contract | null {
  const pe = playerEco(w);
  if (pe.contracts.some((c) => !c.done && c.merchant === merchant.id)) return null;
  const m = marketOf(w, merchant.regionId);
  const dests = w.regions.filter((r) => r.id !== merchant.regionId && Number.isFinite(distanceOf(w, merchant.regionId, r.id)) && distanceOf(w, merchant.regionId, r.id) < 200);
  if (!dests.length) return null;
  const to = dests[(merchant.id.length + w.day) % dests.length];
  const good = (GOODS.filter((g) => m.stock[g] > 8).sort((a, b) => m.stock[b] / GOOD[b].base - m.stock[a] / GOOD[a].base)[0] ?? 'trigo') as Good;
  const qty = Math.min(capacityOf(pe) - cargoCount(pe), 6 + (w.day % 5));
  if (qty < 2) return null;
  const dist = distanceOf(w, merchant.regionId, to.id);
  const pay = Math.max(2, Math.round(dist / 30 + qty * 0.25));
  return { id: `ct${++societyOf(w).seq}`, from: merchant.regionId, to: to.id, good, qty, pay, due: w.day + Math.ceil(dist / 1.4 / 1440) + 3, merchant: merchant.id };
}

export function acceptContract(w: WorldState, c: Contract): TradeResult {
  const pe = playerEco(w);
  const m = marketOf(w, c.from);
  const n = Math.min(c.qty, Math.floor(m.stock[c.good]));
  if (n < 1) return { ok: false, text: 'Al final no hay mercancía que llevar.', notes: [] };
  m.stock[c.good] -= n;
  c.qty = n;
  pe.cargo[c.good] = (pe.cargo[c.good] ?? 0) + n;
  pe.contracts.push(c);
  return { ok: true, text: `Cargas ${n} de ${GOOD[c.good].name}. Hay que llevarlo a ${w.regions[c.to].name} antes de ${c.due - w.day} días.`, notes: [] };
}

/** Al llegar a un pueblo con un encargo, se entrega y se cobra (o se paga el precio de llegar tarde). */
export function deliverContracts(w: WorldState, regionId: number): string[] {
  const pe = playerEco(w);
  const out: string[] = [];
  for (const c of pe.contracts) {
    if (c.done || c.to !== regionId) continue;
    const have = pe.cargo[c.good] ?? 0;
    if (have < c.qty) continue;
    pe.cargo[c.good] = have - c.qty;
    if (!pe.cargo[c.good]) delete pe.cargo[c.good];
    marketOf(w, regionId).stock[c.good] += c.qty;
    c.done = true;
    const late = w.day > c.due;
    const pay = late ? Math.floor(c.pay / 2) : c.pay;
    coins(w).coins += pay;
    const mer = folkById(w, c.merchant);
    if (mer) {
      mer.memories.push({ day: w.day, kind: late ? 'rechazo' : 'trabajo', weight: late ? -0.2 : 0.4, gen: w.life!.player.generation });
      mer.trust = clamp(mer.trust + (late ? -0.03 : 0.07));
    }
    out.push(late ? `Entregas el encargo tarde. Te pagan la mitad: ${pay} monedas.` : `Entregas el encargo de ${mer?.name ?? 'el comerciante'}: ${pay} monedas.`);
    story(w, `Llevó un encargo de ${w.regions[c.from].name} a ${w.regions[c.to].name}.`, 'logro');
  }
  pe.contracts = pe.contracts.filter((c) => !c.done || w.day - c.due < 10);
  return out;
}

/** Las consecuencias de lo que hizo el jugador en un mercado, cuando aparecen (sin avisar antes). */
export function impactEcho(w: WorldState, regionId: number, good: Good): string | null {
  const pe = playerEco(w);
  const hit = pe.impact.find((x) => x.regionId === regionId && x.good === good && x.buy && w.day - x.day <= 20);
  return hit ? `Dicen que hace unos días alguien se llevó casi todo el ${GOOD[good].name} del mercado.` : null;
}
