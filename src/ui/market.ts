import { audio } from '../audio/audio';
import { BUSINESS_COST, BUSINESS_READY, VEHICLE_PRICE, acceptContract, buyVehicle, capacityOf, cargoCount, donate, hire, offerContract, openBusiness, playerBuy, playerEco, playerSell, quoteBuy, quoteSell, stockBusiness, withdraw, type Business, type TradeResult } from '../world/business';
import { FOODS, GOOD, GOODS, amountWord, marketOf, priceWord, type Good } from '../world/economy';
import { ROLE_TITLE } from '../world/folk';
import { describeMarket } from '../world/marketview';
import { convoyTalk, distanceOf, learnPrices, tradeOf } from '../world/trade';
import { ensureLife } from '../world/life';
import { seedRumor } from '../world/gossip';
import { story } from '../world/identity';
import type { App } from './app';
import { dialogue } from './world-dialogs';

/**
 * El mercado vivido: se mira, se pregunta, se regatea, se carga. Los
 * números solo aparecen cuando preguntas (y se apuntan en tu cuaderno).
 */
type Choice = { label: string; run: () => void; hint?: string; primary?: boolean };

const coins = (app: App) => ensureLife(app.w!).identity!.needs.coins;
const fmt = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toString();

function result(app: App, title: string, r: TradeResult, back: () => void): void {
  app.notes(r.notes);
  audio.sfx(r.ok ? 'tap' : 'peticion');
  dialogue(app, title, `Llevas ${coins(app)} 🪙 · carga ${cargoCount(playerEco(app.w!))}/${capacityOf(playerEco(app.w!))}`, [r.text], [{ label: 'Seguir', run: back, primary: true }, { label: 'Salir', run: () => app.refresh() }]);
}

/** Mirar el mercado de un pueblo (y, si hay un comerciante, tratar con él). */
export function marketDialog(app: App, regionId: number, merchantId?: string): void {
  const w = app.w!;
  const r = w.regions[regionId];
  const pe = playerEco(w);
  const m = marketOf(w, regionId);
  const life = ensureLife(w);
  const merchant = merchantId ? life.folk.find((f) => f.id === merchantId) : life.folk.find((f) => f.alive && f.regionId === regionId && f.role === 'comerciante' && !(f.p?.away && f.p.away.back > w.day));
  const back = () => marketDialog(app, regionId, merchantId);
  const choices: Choice[] = [];
  choices.push({ label: '🛒 Comprar', run: () => buyMenu(app, regionId, back), primary: true });
  if (cargoCount(pe)) choices.push({ label: '💰 Vender lo que llevas', run: () => sellMenu(app, regionId, back) });
  if (merchant) choices.push({ label: `💬 Preguntar precios a ${merchant.name}`, hint: 'Lo apuntas en tu cuaderno', run: () => askPrices(app, regionId, merchant.id, back) });
  if (merchant) {
    const c = offerContract(w, merchant);
    if (c) choices.push({ label: `📦 Encargo: llevar ${c.qty} de ${GOOD[c.good].name} a ${w.regions[c.to].name}`, hint: `Paga ${c.pay} 🪙 · ${c.due - w.day} días`, run: () => result(app, merchant.name, acceptContract(w, c), back) });
  }
  if ((pe.cargo.semillas ?? 0) > 0) choices.push({ label: `🌱 Dar tu semilla a los campesinos (${fmt(pe.cargo.semillas!)})`, run: () => result(app, 'Los campos', donate(w, regionId, 'semillas', pe.cargo.semillas!), back) });
  const food = FOODS.find((g) => (pe.cargo[g] ?? 0) >= 1);
  if (food) choices.push({ label: `🍞 Repartir tu ${GOOD[food].name} entre quien pasa hambre`, run: () => result(app, r.name, donate(w, regionId, food, pe.cargo[food]!), back) });
  if (pe.vehicle === 'pie') choices.push({ label: `🐴 Comprar una mula (${VEHICLE_PRICE.mula} 🪙)`, hint: 'Cargas 16 en vez de 6', run: () => result(app, r.name, buyVehicle(w, regionId, 'mula'), back) });
  if (pe.vehicle !== 'carreta') choices.push({ label: `🛞 Comprar una carreta (${VEHICLE_PRICE.carreta} 🪙)`, hint: 'Cargas 40', run: () => result(app, r.name, buyVehicle(w, regionId, 'carreta'), back) });
  for (const kind of BUSINESS_READY) {
    if (pe.businesses.some((b) => b.kind === kind && b.regionId === regionId)) continue;
    const label = kind === 'puesto' ? `🏪 Abrir un puesto propio (${BUSINESS_COST.puesto} 🪙)` : kind === 'granja' ? `🌾 Arrendar un campo (${BUSINESS_COST.granja} 🪙)` : `🛞 Montar un negocio de transporte (${BUSINESS_COST.transporte} 🪙)`;
    if (kind === 'transporte' && pe.vehicle !== 'carreta') continue;
    choices.push({ label, run: () => (kind === 'transporte' ? transportSetup(app, regionId, back) : result(app, r.name, openBusiness(w, regionId, kind), back)) });
  }
  const mine = pe.businesses.filter((b) => b.regionId === regionId);
  for (const b of mine) choices.push({ label: `📒 Tu ${b.kind === 'puesto' ? 'puesto' : b.kind === 'granja' ? 'campo' : 'transporte'}`, run: () => businessDialog(app, b.id, back) });
  choices.push({ label: 'Salir', run: () => app.refresh() });
  dialogue(app, `Mercado de ${r.name}`, `Llevas ${coins(app)} 🪙 · carga ${fmt(cargoCount(pe))}/${capacityOf(pe)}`, describeMarket(w, regionId), choices);
  void m;
}

function buyMenu(app: App, regionId: number, back: () => void): void {
  const w = app.w!;
  const m = marketOf(w, regionId);
  const known = playerEco(w).notes[regionId]?.day === w.day;
  const goods = GOODS.filter((g) => m.stock[g] >= 1).slice(0, 12);
  dialogue(app, '¿Qué compras?', known ? 'Precios de hoy apuntados' : 'Sin preguntar, solo ves si es caro o barato', [], [
    ...goods.map((g) => ({ label: `${GOOD[g].icon} ${GOOD[g].name} · ${amountWord(m, g)} · ${known ? `${fmt(m.price[g])} 🪙` : priceWord(m, g)}`, run: () => qtyMenu(app, regionId, g, true, back) })),
    { label: 'Volver', run: back },
  ]);
}

function sellMenu(app: App, regionId: number, back: () => void): void {
  const w = app.w!;
  const pe = playerEco(w);
  const m = marketOf(w, regionId);
  const goods = (Object.keys(pe.cargo) as Good[]).filter((g) => (pe.cargo[g] ?? 0) >= 1);
  dialogue(app, '¿Qué vendes?', '', [], [...goods.map((g) => ({ label: `${GOOD[g].icon} ${GOOD[g].name} (llevas ${fmt(pe.cargo[g]!)}) · ${priceWord(m, g)}`, run: () => qtyMenu(app, regionId, g, false, back) })), { label: 'Volver', run: back }]);
}

function qtyMenu(app: App, regionId: number, g: Good, buy: boolean, back: () => void): void {
  const w = app.w!;
  const pe = playerEco(w);
  const m = marketOf(w, regionId);
  const max = buy ? Math.min(Math.floor(m.stock[g]), Math.floor(capacityOf(pe) - cargoCount(pe))) : Math.floor(pe.cargo[g] ?? 0);
  const opts = [...new Set([1, 5, 10, max].filter((n) => n >= 1 && n <= max))];
  dialogue(app, `${GOOD[g].icon} ${GOOD[g].name}`, buy ? `Hay ${amountWord(m, g)}` : `Llevas ${fmt(pe.cargo[g] ?? 0)}`, [], [
    ...opts.map((n) => ({ label: buy ? `Comprar ${n} · ${quoteBuy(w, regionId, g, n)} 🪙` : `Vender ${n} · ${quoteSell(w, regionId, g, n)} 🪙`, run: () => result(app, GOOD[g].name, buy ? playerBuy(w, regionId, g, n) : playerSell(w, regionId, g, n), back) })),
    { label: 'Volver', run: back },
  ]);
}

/** El comerciante te dice lo que vale cada cosa aquí… y lo que sabe de otros pueblos. */
function askPrices(app: App, regionId: number, merchantId: string, back: () => void): void {
  const w = app.w!;
  const pe = playerEco(w);
  const m = marketOf(w, regionId);
  const f = ensureLife(w).folk.find((x) => x.id === merchantId)!;
  pe.notes[regionId] = { day: w.day, price: Object.fromEntries(GOODS.map((g) => [g, Math.round(m.price[g] * 10) / 10])) };
  const here = GOODS.filter((g) => m.stock[g] >= 1).slice(0, 8).map((g) => `${GOOD[g].icon} ${GOOD[g].name}: ${fmt(m.price[g])}`).join(' · ');
  const lines = [`«Aquí, hoy: ${here}.»`];
  // Lo que sabe de otros mercados (por las caravanas): eso también vale dinero.
  const news = Object.entries(m.news).filter(([id]) => Number(id) !== regionId).sort((a, b) => b[1].day - a[1].day).slice(0, 2);
  for (const [id, n] of news) {
    const other = Number(id);
    const best = GOODS.filter((g) => n.price[g] !== undefined).sort((a, b) => n.price[b]! / m.price[b] - n.price[a]! / m.price[a])[0];
    const age = w.day - n.day;
    lines.push(`«En ${w.regions[other].name}${age > 0 ? ` (hace ${age} días)` : ''}, ${GOOD[best].name} se pagaba a ${fmt(n.price[best]!)}.${n.price[best]! > m.price[best] * 1.5 ? ' Si lo llevas, sacas tajada.' : ''}»`);
    const old = pe.notes[other];
    if (!old || old.day < n.day) pe.notes[other] = { day: n.day, price: { ...n.price } };
  }
  f.lastMet = w.day;
  app.notes([]);
  dialogue(app, f.name, `${ROLE_TITLE[f.role]} · lo apuntas en tu cuaderno`, lines, [{ label: 'Seguir', run: back, primary: true }]);
}

function transportSetup(app: App, regionId: number, back: () => void): void {
  const w = app.w!;
  const m = marketOf(w, regionId);
  const dests = w.regions.filter((r) => r.id !== regionId && Number.isFinite(distanceOf(w, regionId, r.id)) && distanceOf(w, regionId, r.id) < 240).slice(0, 5);
  const goods = GOODS.filter((g) => m.stock[g] >= 5).slice(0, 5);
  if (!dests.length || !goods.length) return void dialogue(app, 'Transporte', '', ['Desde aquí no hay caminos abiertos (o nada que llevar).'], [{ label: 'Volver', run: back }]);
  dialogue(app, 'Transporte', '¿Adónde irá tu carreta?', [], [
    ...dests.map((d) => ({ label: `🛞 A ${d.name}`, run: () => dialogue(app, 'Transporte', `¿Qué llevará a ${d.name}?`, [], [...goods.map((g) => ({ label: `${GOOD[g].icon} ${GOOD[g].name}`, run: () => result(app, 'Transporte', openBusiness(w, regionId, 'transporte', { to: d.id, good: g }), back) })), { label: 'Volver', run: back }]) })),
    { label: 'Volver', run: back },
  ]);
}

/** Tu negocio: caja, género, gente. */
export function businessDialog(app: App, bizId: string, back: () => void): void {
  const w = app.w!;
  const pe = playerEco(w);
  const b = pe.businesses.find((x) => x.id === bizId);
  if (!b) return back();
  const life = ensureLife(w);
  const here = () => businessDialog(app, bizId, back);
  const staff = b.workers.map((id) => life.folk.find((f) => f.id === id)?.name).filter(Boolean);
  const stock = Object.entries(b.stock).filter(([, n]) => (n ?? 0) >= 0.5).map(([g, n]) => `${fmt(n!)} de ${GOOD[g as Good].name}`).join(', ');
  const lines = [`Caja: ${fmt(b.cash)} monedas.`, stock ? `Género: ${stock}.` : 'No tiene género.', staff.length ? `Trabaja: ${staff.join(', ')} (${b.wage} 🪙 al día).` : 'Nadie trabaja aquí: rinde la mitad.', ...b.log.slice(-3).map((l) => `· ${l.text}`)];
  if (b.route) lines.splice(1, 0, `Ruta: ${GOOD[b.route.good].name} hacia ${w.regions[b.route.to].name}.`);
  const choices: Choice[] = [];
  const cargoGoods = (Object.keys(pe.cargo) as Good[]).filter((g) => (pe.cargo[g] ?? 0) >= 1 && (b.kind === 'puesto' || g === 'semillas'));
  for (const g of cargoGoods.slice(0, 4)) choices.push({ label: `📥 Dejar tu ${GOOD[g].name} (${fmt(pe.cargo[g]!)})`, run: () => result(app, 'Tu negocio', stockBusiness(w, bizId, g, pe.cargo[g]!), here) });
  if (b.cash >= 1) choices.push({ label: `🪙 Sacar ${Math.floor(b.cash)} monedas`, run: () => result(app, 'Tu negocio', withdraw(w, bizId), here) });
  if (b.kind === 'granja' || b.kind === 'puesto') {
    const harvest = (b.stock.trigo ?? 0) >= 1 ? 'trigo' : undefined;
    if (harvest) choices.push({ label: `📤 Cargar la cosecha (${fmt(b.stock.trigo!)})`, run: () => {
      const room = capacityOf(pe) - cargoCount(pe);
      const n = Math.min(room, b.stock.trigo!);
      b.stock.trigo! -= n;
      pe.cargo.trigo = (pe.cargo.trigo ?? 0) + n;
      result(app, 'Tu negocio', { ok: n > 0, text: n > 0 ? `Cargas ${fmt(n)} de trigo.` : 'No te cabe.', notes: [] }, here);
    } });
  }
  if (b.workers.length < 2) choices.push({ label: '🤝 Contratar a alguien', run: () => hireMenu(app, b, here) });
  choices.push({ label: 'Volver', run: back });
  dialogue(app, b.kind === 'puesto' ? 'Tu puesto' : b.kind === 'granja' ? 'Tu campo' : 'Tu transporte', w.regions[b.regionId].name, lines, choices);
}

function hireMenu(app: App, b: Business, back: () => void): void {
  const w = app.w!;
  const life = ensureLife(w);
  const cands = life.folk.filter((f) => f.alive && f.regionId === b.regionId && f.age >= 16 && f.lastMet >= 0 && f.p && !b.workers.includes(f.id) && !(f.p as { employer?: string }).employer && f.role !== 'lider').sort((a, b2) => (a.p!.needs.trabajo - b2.p!.needs.trabajo)).slice(0, 6);
  if (!cands.length) return void dialogue(app, 'Contratar', '', ['No conoces a nadie aquí que pueda trabajar para ti. Habla con la gente.'], [{ label: 'Volver', run: back }]);
  dialogue(app, 'Contratar', '¿A quién? (pagas cada día de la caja del negocio)', [], [
    ...cands.flatMap((f) => [1, 2].map((wage) => ({ label: `${f.name}, ${ROLE_TITLE[f.role]} · ${wage} 🪙/día`, run: () => result(app, f.name, hire(w, b.id, f.id, wage), back) }))),
    { label: 'Volver', run: back },
  ]);
}

/** Una caravana en el camino: hablar con quien la lleva, comprarle, o recoger lo que quedó de un asalto. */
export function convoyDialog(app: App, convoyId: string): void {
  const w = app.w!;
  const c = tradeOf(w).convoys.find((x) => x.id === convoyId);
  if (!c) return;
  const pe = playerEco(w);
  const talk = convoyTalk(w, convoyId);
  const src = marketOf(w, c.from);
  // Al hablar con un carretero te enteras de cómo están los precios de donde viene.
  const old = pe.notes[c.from];
  if (!old || old.day < w.day - 1) pe.notes[c.from] = { day: Math.max(w.day - 1, c.depart / 1440 | 0), price: Object.fromEntries(GOODS.map((g) => [g, Math.round(src.price[g] * 10) / 10])) };
  learnPrices(marketOf(w, c.to), c.from, src, w.day - 1);
  const choices: Choice[] = [];
  if (c.status === 'atacada') {
    for (const [g, n] of Object.entries(talk.cargo) as [Good, number][]) {
      if (n < 1) continue;
      choices.push({ label: `📦 Llevarte ${n} de ${GOOD[g].name}`, hint: 'Nadie lo reclama… de momento', run: () => {
        const room = Math.floor(capacityOf(pe) - cargoCount(pe));
        const take = Math.min(room, n);
        if (take <= 0) return result(app, 'Restos', { ok: false, text: 'No te cabe nada más.', notes: [] }, () => app.refresh());
        pe.cargo[g] = (pe.cargo[g] ?? 0) + take;
        c.cargo[g] = Math.max(0, (c.cargo[g] ?? 0) - take / 0.35);
        story(w, `Encontró los restos de una caravana asaltada y se llevó parte de la carga.`, 'decision');
        seedRumor(w, { regionId: c.from, kind: 'p_robo', subject: 'jugador', target: c.kind === 'mercader' ? c.owner : undefined, witnesses: [], heat: 0.4 });
        result(app, 'Restos', { ok: true, text: `Cargas ${take} de ${GOOD[g].name}.`, notes: [] }, () => app.refresh());
      } });
    }
    choices.push({ label: 'Dejarlo estar', run: () => app.refresh() });
    return void dialogue(app, 'Una carreta volcada', `Camino de ${w.regions[c.from].name} a ${w.regions[c.to].name}`, talk.lines, choices);
  }
  for (const [g, n] of (Object.entries(talk.cargo) as [Good, number][]).slice(0, 2)) {
    const unit = Math.max(1, Math.round(src.price[g] * 1.3 * 10) / 10);
    choices.push({ label: `🛒 Comprarle 5 de ${GOOD[g].name} · ${Math.ceil(unit * 5)} 🪙`, run: () => {
      const room = capacityOf(pe) - cargoCount(pe);
      const life = ensureLife(w);
      const cost = Math.ceil(unit * 5);
      if (room < 5) return result(app, c.ownerName, { ok: false, text: 'No te cabe.', notes: [] }, () => convoyDialog(app, convoyId));
      if (life.identity!.needs.coins < cost || n < 5) return result(app, c.ownerName, { ok: false, text: n < 5 ? 'No le queda tanto.' : 'No te llega el dinero.', notes: [] }, () => convoyDialog(app, convoyId));
      life.identity!.needs.coins -= cost;
      c.cargo[g] = n - 5;
      pe.cargo[g] = (pe.cargo[g] ?? 0) + 5;
      result(app, c.ownerName, { ok: true, text: `«Trato hecho.» Cargas 5 de ${GOOD[g].name}.`, notes: [] }, () => convoyDialog(app, convoyId));
    } });
  }
  choices.push({ label: 'Seguir tu camino', run: () => app.refresh(), primary: true });
  dialogue(app, c.kind === 'jugador' ? 'Tu carreta' : `Caravana de ${c.ownerName}`, `Camino de ${w.regions[c.from].name} a ${w.regions[c.to].name}`, talk.lines, choices);
}

/** Tu cuaderno: lo que sabes de los precios (con su antigüedad). */
export function priceBook(app: App): { title: string; lines: string[] }[] {
  const w = app.w!;
  const pe = playerEco(w);
  return Object.entries(pe.notes)
    .sort((a, b) => b[1].day - a[1].day)
    .slice(0, 6)
    .map(([id, n]) => {
      const age = w.day - n.day;
      const top = GOODS.filter((g) => n.price[g] !== undefined).sort((a, b) => n.price[b]! / GOOD[b].base - n.price[a]! / GOOD[a].base);
      const dear = top.slice(0, 3).map((g) => `${GOOD[g].icon}${GOOD[g].name} ${fmt(n.price[g]!)}`);
      const cheap = top.slice(-3).map((g) => `${GOOD[g].icon}${GOOD[g].name} ${fmt(n.price[g]!)}`);
      return { title: `${w.regions[Number(id)].name} · ${age === 0 ? 'hoy' : age === 1 ? 'ayer' : `hace ${age} días`}`, lines: [`Caro: ${dear.join(' · ')}`, `Barato: ${cheap.join(' · ')}`] };
    });
}
