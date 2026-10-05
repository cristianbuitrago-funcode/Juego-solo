import type { Rng } from '../core/rng';
import { roadFactor } from './roads';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { seasonOf } from './clock';
import { weatherIn } from './geography';
import { FOODS, GOOD, GOODS, marketOf, type Good, type Market } from './economy';
import { seedRumor } from './gossip';
import { roadPath } from './roadnet';
import { folkById, logEvent, societyOf } from './society';
import type { Folk } from './types';
import { tariffOf, tradeAllowed } from './politics';
import { secretRoute } from './intrigue';

/**
 * Comercio entre pueblos. Los comerciantes miran lo que saben de otros
 * mercados (no todo: lo que les contaron las últimas caravanas), compran
 * donde sobra y venden donde falta, siempre que el viaje merezca la pena:
 * la distancia y el peso encarecen el transporte, los caminos cerrados lo
 * impiden, la guerra y el bandidaje lo hacen arriesgado. Además de los
 * comerciantes del pueblo, hay carreteros de paso que llevan los excedentes
 * de una tierra a otra.
 *
 * Cada caravana existe de verdad: sale a una hora, recorre el camino (el
 * jugador puede cruzársela), puede retrasarse por una tormenta, quedarse
 * parada si cierran un camino, buscar otro, ser asaltada o llegar y vender.
 */
export interface Convoy {
  id: string;
  kind: 'mercader' | 'carretero' | 'jugador';
  owner: string; // id del vecino, 'carretero' o id del negocio del jugador
  ownerName: string;
  from: number;
  to: number;
  cargo: Partial<Record<Good, number>>;
  cost: number; // lo que costó la carga
  depart: number; // minuto absoluto
  arrive: number;
  status: 'viaje' | 'retrasada' | 'atacada' | 'llegada';
  stopAt?: number; // si va a ser asaltada: en qué punto del viaje (0..1)
  guarded?: boolean;
  note?: string;
}

export interface TradeState {
  convoys: Convoy[];
  volume: Record<string, number>; // comercio acumulado por par de pueblos (base para la diplomacia de la Fase 4)
  routesOpened: string[];
}

export function tradeOf(w: WorldState): TradeState {
  const s = societyOf(w) as ReturnType<typeof societyOf> & { trade?: TradeState };
  return (s.trade ??= { convoys: [], volume: {}, routesOpened: [] });
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Distancia por camino abierto (en casillas); Infinity si no se puede ir. */
export function distanceOf(w: WorldState, a: number, b: number): number {
  if (a === b) return 0;
  const p = roadPath(w, a, b, true);
  return p.length ? p.length : Infinity;
}

/** Lo que cuesta llevar una unidad (peso × distancia). */
export function transportCost(g: Good, dist: number): number {
  return (GOOD[g].weight * dist) / 85;
}

/** Riesgo de un viaje: guerra, bandidos, caminos inseguros. */
export function riskOf(w: WorldState, a: number, b: number): number {
  const A = w.regions[a];
  const B = w.regions[b];
  let r = 0.015;
  if (A.flags.guerra || B.flags.guerra || A.relations[b]?.war) r += 0.22;
  if (A.flags.bandidos || B.flags.bandidos) r += 0.14;
  if (Math.min(A.stability, B.stability) < 0.4) r += 0.05;
  // La ley de seguridad de cada pueblo: más guardia, caminos más seguros.
  for (const id of [a, b]) {
    const sec = w.life?.politics?.govs[id]?.laws.seguridad;
    if (sec === 'alta') r -= 0.03;
    else if (sec === 'baja') r += 0.04;
  }
  if (secretRoute(w, a, b)) r *= 0.5; // el paso del monte que pocos conocen
  r *= roadFactor(w, a, b).risk; // una calzada vigilada es más segura que un sendero de maleza
  return clamp(r, 0.005, 0.6);
}

/** Lo que un mercado sabe de los precios de otro (puede estar anticuado). */
export function knownPrices(w: WorldState, here: number, there: number): { day: number; price: Partial<Record<Good, number>> } | undefined {
  const m = marketOf(w, here);
  if (!m.news[there] && w.regions[here].neighbors.includes(there)) learnPrices(m, there, marketOf(w, there), w.day - 3);
  return m.news[there];
}

export function learnPrices(into: Market, regionId: number, from: Market, day: number): void {
  const old = into.news[regionId];
  if (old && old.day >= day) return;
  into.news[regionId] = { day, price: Object.fromEntries(GOODS.map((g) => [g, Math.round(from.price[g] * 100) / 100])) };
}

// ---------------------------------------------------------------------------
// Cada día: los comerciantes deciden viajes; los carreteros de paso, también
// ---------------------------------------------------------------------------
const CAPACITY = 26;

function surplus(m: Market, g: Good, people: number): number {
  // La comida solo sale si sobra de verdad (más de una semana para todos).
  if (FOODS.includes(g)) {
    const total = FOODS.reduce((s, x) => s + m.stock[x], 0);
    const free = total - people * 0.8 * 7;
    return Math.max(0, Math.min(m.stock[g] - m.demand[g] * 2, free));
  }
  return Math.max(0, m.stock[g] - m.demand[g] * 3 - 1);
}

/** El reloj de la simulación (en las pruebas sin escena, el día manda). */
export function nowOf(w: WorldState): number {
  return Math.max(w.life!.clock, (w.day - 1) * 1440 + 30);
}

/** Busca el mejor negocio desde un pueblo con lo que se sabe de los demás. */
export function bestDeal(w: WorldState, from: number, people: number, budget: number, cap = CAPACITY): { to: number; good: Good; qty: number; profit: number; dist: number } | null {
  const m = marketOf(w, from);
  let best: { to: number; good: Good; qty: number; profit: number; dist: number } | null = null;
  for (const r of w.regions) {
    if (r.id === from || !tradeAllowed(w, from, r.id)) continue;
    const dist = distanceOf(w, from, r.id);
    if (!Number.isFinite(dist) || dist > 260) continue;
    const news = knownPrices(w, from, r.id);
    if (!news) continue;
    const risk = riskOf(w, from, r.id);
    for (const g of GOODS) {
      const there = news.price[g];
      if (!there) continue;
      const unit = there * 0.86 * (1 - risk) * (1 - tariffOf(w, from, r.id)) - m.price[g] * 1.04 - transportCost(g, dist);
      if (unit <= 0.05) continue;
      const qty = Math.floor(Math.min(cap, surplus(m, g, people), budget / Math.max(0.1, m.price[g])));
      if (qty < 3) continue;
      const profit = unit * qty;
      if (!best || profit > best.profit) best = { to: r.id, good: g, qty, profit, dist };
    }
  }
  return best;
}

export function tradeDay(w: WorldState, rng: Rng, regionId: number, people: Folk[]): void {
  const t = tradeOf(w);
  const m = marketOf(w, regionId);
  const r = w.regions[regionId];
  // Con los puestos cerrados en protesta no sale ninguna caravana del pueblo.
  if (r.flags.boicot) return;
  // Comerciantes del pueblo.
  for (const f of people) {
    if (f.role !== 'comerciante' || !f.p || f.p.away || (f.p.sick ?? -1) >= w.day || f.p.coins < 8) continue;
    if (t.convoys.some((c) => c.owner === f.id && c.status !== 'llegada')) continue;
    if (!rng.chance(0.5)) continue;
    const deal = bestDeal(w, regionId, people.length, f.p.coins * 0.8);
    if (!deal || deal.profit < 2.5) continue;
    const cost = deal.qty * m.price[deal.good];
    f.p.coins -= cost;
    m.cash += cost;
    m.stock[deal.good] -= deal.qty;
    const hours = deal.dist / 0.45 / 60;
    f.p.away = { to: deal.to, back: w.day + Math.max(2, Math.ceil((hours * 2) / 24) + 1), why: 'viaje' };
    depart(w, rng, { kind: 'mercader', owner: f.id, ownerName: f.name, from: regionId, to: deal.to, cargo: { [deal.good]: deal.qty }, cost });
  }
  // Carreteros de paso: llevan excedentes por las rutas abiertas según el tráfico del camino.
  for (const route of w.routes) {
    if (route.status !== 'abierta' || (route.a !== regionId && route.b !== regionId)) continue;
    const other = route.a === regionId ? route.b : route.a;
    if (!tradeAllowed(w, regionId, other) || !rng.chance(0.22 + route.traffic * 0.3)) continue;
    const there = marketOf(w, other);
    const dist = distanceOf(w, regionId, other);
    if (!Number.isFinite(dist)) continue;
    let pick: Good | null = null;
    let gain = 1.15;
    for (const g of GOODS) {
      if (surplus(m, g, people.length) < 4) continue;
      const k = (there.price[g] - transportCost(g, dist)) / Math.max(0.1, m.price[g]);
      if (k > gain) (gain = k), (pick = g);
    }
    if (!pick) continue;
    const qty = Math.floor(Math.min(14, surplus(m, pick, people.length)));
    m.stock[pick] -= qty;
    depart(w, rng, { kind: 'carretero', owner: 'carretero', ownerName: `un carretero de ${r.name}`, from: regionId, to: other, cargo: { [pick]: qty }, cost: qty * m.price[pick] });
  }
}

/** Sale una caravana. El riesgo se decide al salir (sin que nadie lo sepa). */
export function depart(w: WorldState, rng: Rng, o: Omit<Convoy, 'id' | 'depart' | 'arrive' | 'status'> & { guarded?: boolean }): Convoy {
  const t = tradeOf(w);
  const life = w.life!;
  const dist = distanceOf(w, o.from, o.to);
  const hour = (life.clock % 1440) / 60 + 6;
  const start = nowOf(w) + Math.max(0, (8 - hour) * 60) + rng.int(0, 120);
  // Una carreta va despacio: medio paso por minuto.
  // El estado del camino y lo abrupto del terreno cuentan.
  const minutes = Math.max(240, (dist / 0.45 / roadFactor(w, o.from, o.to).speed) * (o.kind === 'jugador' ? 1.05 : 1));
  const c: Convoy = { ...o, id: `cv${++societyOf(w).seq}`, depart: start, arrive: start + minutes, status: 'viaje' };
  const risk = riskOf(w, o.from, o.to) * (o.guarded ? 0.35 : 1);
  if (rng.chance(risk)) c.stopAt = rng.range(0.25, 0.8);
  if (weatherIn(w, o.from) === 'tormenta' || (seasonOf(w.day) === 'invierno' && weatherIn(w, o.from) === 'nieve')) {
    c.arrive += 240;
    c.note = 'el mal tiempo la retrasa';
  }
  t.convoys.push(c);
  if (t.convoys.length > 80) t.convoys.splice(0, t.convoys.length - 80);
  return c;
}

/**
 * Avanza las caravanas hasta ahora (cada hora de juego y al amanecer): las
 * que llegan venden; las asaltadas pierden la carga; si el camino se cierra,
 * esperan o buscan otro.
 */
export function convoyTick(w: WorldState): string[] {
  const t = tradeOf(w);
  const life = w.life!;
  const now = nowOf(w);
  const out: string[] = [];
  for (const c of t.convoys) {
    if (c.status === 'llegada' || c.status === 'atacada') continue;
    if (c.stopAt !== undefined && now >= c.depart + (c.arrive - c.depart) * c.stopAt) {
      c.status = 'atacada';
      const lost = Object.entries(c.cargo).map(([g, n]) => `${n!.toFixed(0)} de ${GOOD[g as Good].name}`).join(', ');
      const text = `Han asaltado ${c.kind === 'jugador' ? 'tu carreta' : `la caravana de ${c.ownerName}`} en el camino de ${w.regions[c.from].name} a ${w.regions[c.to].name}. Llevaba ${lost}.`;
      logEvent(w, c.from, 'asalto', text, c.kind === 'mercader' ? [c.owner] : []);
      const witnesses = life.folk.filter((f) => f.alive && f.regionId === c.to && f.role === 'comerciante').map((f) => f.id);
      seedRumor(w, { regionId: c.to, kind: 'asalto', subject: c.kind === 'mercader' ? c.owner : witnesses[0] ?? 'jugador', witnesses, versions: [`La caravana de ${c.ownerName} no ha llegado: la asaltaron en el camino.`, 'Dicen que hay bandidos en los caminos y que nadie está seguro.', 'Dicen que los bandidos son gente del propio pueblo.'], tone: -0.3 });
      out.push(text);
      continue;
    }
    if (now < c.arrive) continue;
    // ¿Sigue abierto el camino? Si no, espera o busca otro.
    if (!Number.isFinite(distanceOf(w, c.from, c.to))) {
      if (c.status !== 'retrasada') {
        c.status = 'retrasada';
        c.note = 'el camino está cortado';
      }
      c.arrive = now + 360;
      continue;
    }
    arrive(w, c);
    out.push(`Ha llegado ${c.kind === 'jugador' ? 'tu carreta' : `la caravana de ${c.ownerName}`} a ${w.regions[c.to].name}.`);
  }
  t.convoys = t.convoys.filter((c) => !((c.status === 'llegada' || c.status === 'atacada') && now - c.arrive > 1440 * 3));
  return out;
}

function arrive(w: WorldState, c: Convoy): void {
  const t = tradeOf(w);
  c.status = 'llegada';
  const dest = marketOf(w, c.to);
  const src = marketOf(w, c.from);
  let paid = 0;
  const owner = c.kind === 'mercader' ? folkById(w, c.owner) : undefined;
  // Aranceles: lo que viene de fuera paga a la entrada (salvo tratado de comercio).
  const duty = tariffOf(w, c.from, c.to);
  for (const [g, n] of Object.entries(c.cargo) as [Good, number][]) {
    if (c.kind === 'carretero') {
      // El carretero vende al precio de allí; el pueblo de origen cobra su parte.
      const value = n * dest.price[g] * 0.85;
      const gross = Math.min(dest.cash, value);
      const pay = gross * (1 - duty);
      dest.cash -= gross;
      dest.treasury += gross - pay;
      dest.stock[g] += n;
      src.cash += Math.min(pay, c.cost);
      dest.treasury += Math.max(0, pay - c.cost) * 0.5;
      paid += pay;
    } else {
      // Quien trae la mercancía la vende a buen precio (mejor que el productor local).
      const gross = Math.min(dest.cash, n * dest.price[g] * 0.88);
      const pay = gross * (1 - duty);
      dest.cash -= gross;
      dest.treasury += gross - pay;
      dest.stock[g] += n;
      if (owner?.p) owner.p.coins += pay;
      paid += pay;
    }
  }
  if (c.kind === 'jugador') {
    const biz = (societyOf(w) as { player?: { businesses: { id: string; cash: number; log: { day: number; text: string }[] }[] } }).player?.businesses.find((b) => b.id === c.owner);
    if (biz) {
      biz.cash += paid;
      biz.log.push({ day: w.day, text: `La carreta llegó a ${w.regions[c.to].name} y vendió por ${paid.toFixed(0)} monedas.` });
    }
  }
  // Las noticias viajan con las caravanas: cada pueblo sabe un poco más del otro.
  learnPrices(src, c.to, dest, w.day);
  learnPrices(dest, c.from, src, w.day);
  const key = pairKey(c.from, c.to);
  t.volume[key] = Math.round(((t.volume[key] ?? 0) + paid) * 10) / 10;
  if (!t.routesOpened.includes(key) && c.kind === 'mercader') {
    t.routesOpened.push(key);
    logEvent(w, c.from, 'ruta', `${c.ownerName} ha abierto una ruta de comercio con ${w.regions[c.to].name}.`, [c.owner]);
  }
}

/** Dónde están ahora las caravanas (para dibujarlas y cruzárselas en el camino). */
export function convoyPositions(w: WorldState): { c: Convoy; x: number; y: number; dx: number }[] {
  const t = tradeOf(w);
  const now = nowOf(w);
  const out: { c: Convoy; x: number; y: number; dx: number }[] = [];
  for (const c of t.convoys) {
    if (c.status === 'llegada' || now < c.depart) continue;
    const path = roadPath(w, c.from, c.to);
    if (path.length < 2) continue;
    let k = clamp((now - c.depart) / Math.max(1, c.arrive - c.depart));
    if (c.status === 'atacada') k = c.stopAt ?? 0.5;
    if (c.status === 'retrasada') k = Math.min(k, 0.5);
    const i = Math.min(path.length - 2, Math.floor(k * (path.length - 1)));
    const a = path[i];
    const b = path[i + 1];
    const f = k * (path.length - 1) - i;
    out.push({ c, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: b.x - a.x });
  }
  return out;
}

/** Lo que cuenta quien conduce una caravana (y los precios que el jugador apunta). */
export function convoyTalk(w: WorldState, id: string): { lines: string[]; cargo: Partial<Record<Good, number>> } {
  const c = tradeOf(w).convoys.find((x) => x.id === id);
  if (!c) return { lines: [], cargo: {} };
  const from = w.regions[c.from].name;
  const to = w.regions[c.to].name;
  if (c.status === 'atacada') return { lines: ['Una carreta volcada en la cuneta. Cajas rotas, huellas de muchos pies. Ni rastro de quien la llevaba.', 'Aún queda algo de la carga entre los restos.'], cargo: Object.fromEntries(Object.entries(c.cargo).map(([g, n]) => [g, Math.floor(n! * 0.35)])) };
  const what = Object.entries(c.cargo).map(([g, n]) => `${Math.round(n!)} de ${GOOD[g as Good].name}`).join(' y ');
  const src = marketOf(w, c.from);
  const main = Object.keys(c.cargo)[0] as Good;
  const lines = [`«Vengo de ${from} y voy a ${to} con ${what}.»`, src.price[main] < GOOD[main].base * 0.9 ? `«En ${from} sobra y está barato. En ${to} se paga bien.»` : `«Allí tampoco sobra, pero en ${to} hace más falta.»`];
  if (c.note) lines.push(`«Vamos con retraso: ${c.note}.»`);
  if (c.stopAt !== undefined) lines.push('Mira a los lados del camino más de lo normal.');
  return { lines, cargo: c.cargo };
}
