import { RESOURCES } from '../content/resources';
import { TECH_BY_ID } from '../content/techs';
import { record } from '../chronicle';
import type { Region, RegionId } from '../types';
import { clamp } from '../util';
import { causeFor, routesOf, totalTraffic, type Ctx } from '../world';
import { killCharacter, regionRemembers } from './characters';

/**
 * Economía del mundo: producción de alimento, comercio por rutas, hambre,
 * población y migraciones. No hay oro ni madera que acumular: lo que
 * importa es quién depende de quién y qué pasa cuando eso cambia.
 */

/** Condiciones que pueden explicar una escasez (para encadenar consecuencias). */
export const SCARCITY_CAUSES = ['sinComercio', 'aislada', 'degradada', 'guerra', 'fiebre', 'invierno', 'prohibicion', 'explotada', 'transformada'];

/** Consumo diario de alimento (en días de reserva). */
export const CONSUMPTION = 0.84;

export function techMult(r: Region, key: 'food' | 'trade' | 'defense' | 'ecology' | 'insight'): number {
  let m = key === 'food' ? 1 : 0;
  for (const t of r.techs) {
    const v = TECH_BY_ID[t]?.effects[key];
    if (v === undefined) continue;
    if (key === 'food') m *= v;
    else m += v;
  }
  return m;
}

/** Alimento diario (en días de reserva) que produce la región. */
export function production(ctx: Ctx, r: Region): number {
  const res = RESOURCES[r.resource];
  const eco = 0.45 + 0.55 * r.ecology;
  const stab = 0.75 + 0.25 * r.stability;
  const war = r.flags.guerra ? 0.65 : 1;
  const ban = r.resourceBanned ? 0.6 : 1;
  const winter = r.flags.invierno ? 0.35 : 1;
  const fever = r.flags.fiebre ? 0.8 : 1;
  return res.food * eco * techMult(r, 'food') * stab * war * ban * winter * fever;
}

export function updateTraffic(ctx: Ctx): void {
  const { w } = ctx;
  for (const route of w.routes) {
    const a = w.regions[route.a];
    const b = w.regions[route.b];
    let target = 0;
    if (route.status === 'abierta') {
      const ra = a.relations[b.id];
      const opinion = a.isHome ? b.attitude.trust * 2 - 1 : b.isHome ? a.attitude.trust * 2 - 1 : (ra?.opinion ?? 0);
      target = route.baseTraffic * (0.55 + 0.45 * (opinion + 1) * 0.5);
      target *= 1 + 0.3 * (techMult(a, 'trade') + techMult(b, 'trade'));
      if (a.flags.fiebre || b.flags.fiebre) target *= 0.6;
      if ((a.isHome || b.isHome) && w.player.priority === 'comercio') target *= 1.3;
      if ((a.isHome && b.abandoned) || (b.isHome && a.abandoned)) target *= 0.2;
    }
    route.traffic = clamp(route.traffic + (target - route.traffic) * 0.25, 0, 1.5);
  }
}

export function tickEconomy(ctx: Ctx): void {
  const { w } = ctx;
  updateTraffic(ctx);
  const delta = new Array(w.regions.length).fill(0);

  for (const r of w.regions) {
    if (r.isHome) continue;
    delta[r.id] += production(ctx, r) - CONSUMPTION;
  }
  // Comercio: los bienes se cambian por alimento y los mercados igualan reservas.
  for (const route of w.routes) {
    if (route.status !== 'abierta' || route.traffic < 0.02) continue;
    const a = w.regions[route.a];
    const b = w.regions[route.b];
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (x.isHome) continue;
      const res = RESOURCES[x.resource];
      const partnerFood = y.isHome ? w.player.reserves / 5 : y.food;
      const income = route.traffic * 0.25 * res.tradeValue * (1 + techMult(x, 'trade')) * (partnerFood > 4 ? 1 : 0.25) * (x.resourceBanned ? 0.3 : 1);
      delta[x.id] += income;
      if (!y.isHome) delta[y.id] -= income * 0.55;
    }
    if (!a.isHome && !b.isHome) {
      const flow = 0.06 * route.traffic * (b.food - a.food);
      delta[a.id] += flow;
      delta[b.id] -= flow;
    }
  }

  for (const r of w.regions) {
    if (r.isHome) continue;
    r.food = clamp(r.food + delta[r.id], 0, 30);
    if (r.food > 25) r.food -= (r.food - 25) * 0.3; // se echa a perder
    r.foodHistory.push(Math.round(r.food * 10) / 10);
    if (r.foodHistory.length > 30) r.foodHistory.shift();
    updateTradeFlags(ctx, r);
    updateHunger(ctx, r);
    // Población.
    if (r.food > 10) r.population *= 1.0025;
    else if (r.food < 3) r.population *= 0.993;
    if (r.food <= 0.01) {
      r.population *= 0.985;
      if (ctx.rng.chance(0.03)) killCharacter(ctx, r.id, r.flags.hambre?.causeId, 'durante la hambruna');
    }
    r.population = Math.max(60, r.population);
  }
  tickMigration(ctx);
}

function updateTradeFlags(ctx: Ctx, r: Region): void {
  const { w } = ctx;
  const open = routesOf(w, r.id).filter((x) => x.status === 'abierta');
  if (!open.length && !r.flags.aislada) {
    const closedBy = routesOf(w, r.id).map((x) => x.closedCause).filter(Boolean).pop();
    const e = record(ctx, { kind: 'consecuencia', text: `${r.name} ha quedado aislada: ya no le queda ningún camino abierto.`, regions: [r.id], causeId: closedBy, importance: 2 });
    r.flags.aislada = { since: w.day, causeId: e.id };
  } else if (open.length && r.flags.aislada) {
    delete r.flags.aislada;
  }
  const traffic = totalTraffic(w, r.id);
  if (traffic < 0.25 && !r.flags.sinComercio && !r.flags.aislada) {
    const closedBy = routesOf(w, r.id).filter((x) => x.status !== 'abierta').map((x) => x.closedCause).filter(Boolean).pop();
    const e = record(ctx, { kind: 'consecuencia', text: `${r.name} ha perdido a sus comerciantes. Los mercados se apagan.`, regions: [r.id], causeId: closedBy ?? causeFor(r, ['guerra', 'fiebre']), importance: 2 });
    r.flags.sinComercio = { since: w.day, causeId: e.id };
  } else if (traffic > 0.45 && r.flags.sinComercio) {
    delete r.flags.sinComercio;
  }
}

function updateHunger(ctx: Ctx, r: Region): void {
  const { w } = ctx;
  if (r.food < 3 && !r.flags.hambre) {
    const cause = causeFor(r, SCARCITY_CAUSES);
    const e = record(ctx, { kind: 'consecuencia', text: `El hambre llega a ${r.name}.`, regions: [r.id], causeId: cause, importance: 2 });
    r.flags.hambre = { since: w.day, causeId: e.id };
  } else if (r.food > 7 && r.flags.hambre) {
    const cause = r.flags.hambre.causeId;
    const how = r.techs.some((t) => (TECH_BY_ID[t].effects.food ?? 1) > 1) ? 'gracias a sus nuevas técnicas' : r.dependency > 0.3 ? 'gracias a la ayuda recibida' : 'por sus propios medios';
    record(ctx, { kind: 'consecuencia', text: `${r.name} dejó atrás el hambre ${how}.`, regions: [r.id], causeId: cause });
    delete r.flags.hambre;
  }
  if (r.flags.hambre) r.stability = clamp(r.stability - 0.008);
  else r.stability = clamp(r.stability + (0.68 - r.stability) * 0.02);
}

/** Migraciones: el hambre y la guerra mueven a la gente, y la gente mueve costumbres y saberes. */
function tickMigration(ctx: Ctx): void {
  const { w, rng } = ctx;
  for (const r of w.regions) {
    if (r.isHome || r.population < 200) continue;
    if (!r.flags.hambre && !r.flags.guerra) {
      delete r.flags.emigrando;
      continue;
    }
    const options = r.neighbors
      .map((id) => w.regions[id])
      .filter((d) => !d.relations[r.id]?.war && !d.flags.guerra && routesOf(w, r.id).some((x) => (x.a === d.id || x.b === d.id) && x.status !== 'bloqueada'));
    if (!options.length) continue;
    const foodOf = (d: Region) => (d.isHome ? w.player.reserves / 5 : d.food);
    options.sort((a, b) => foodOf(b) - foodOf(a));
    let dest = options[0];
    if (dest.isHome && !w.player.laws.hospitalidad) {
      if (!r.flags.rechazados) {
        r.flags.rechazados = { since: w.day };
        const e = record(ctx, { kind: 'migracion', text: `Familias de ${r.name} llegaron a tus puertas y fueron rechazadas por tus leyes.`, regions: [r.id, dest.id], causeId: r.flags.emigrando?.causeId ?? causeFor(r, ['hambre', 'guerra']), importance: 2, known: true });
        regionRemembers(ctx, r.id, 'rechazo', -0.5, e.id);
      }
      dest = options[1];
      if (!dest) continue;
    }
    const migrants = Math.round(r.population * 0.025);
    r.population -= migrants;
    if (!r.flags.emigrando) {
      const e = record(ctx, { kind: 'migracion', text: `Familias de ${r.name} emigran hacia ${dest.name}.`, regions: [r.id, dest.id], causeId: causeFor(r, ['hambre', 'guerra']), importance: 2 });
      r.flags.emigrando = { since: w.day, causeId: e.id, data: { to: dest.id } };
    }
    if (dest.isHome) {
      dest.population += migrants;
      w.player.reserves = clamp(w.player.reserves - migrants / 40, 0, 100);
      if (!r.flags.acogidos) {
        r.flags.acogidos = { since: w.day };
        regionRemembers(ctx, r.id, 'refugio', 0.7, r.flags.emigrando?.causeId);
        r.attitude.gratitude = clamp(r.attitude.gratitude + 0.2);
      }
    } else {
      dest.food = (dest.food * dest.population) / (dest.population + migrants);
      dest.population += migrants;
    }
    const key = `mig_${r.id}_${dest.id}`;
    w.counters[key] = (w.counters[key] ?? 0) + migrants;
    if (w.counters[key] > dest.population * 0.1 && !w.counters[`${key}_c`]) {
      w.counters[`${key}_c`] = 1;
      customsChange(ctx, r.id, dest.id);
    }
    if (rng.chance(0.02)) killCharacter(ctx, r.id, r.flags.emigrando?.causeId, 'en el camino del éxodo');
  }
}

/** Los recién llegados cambian las costumbres de su nuevo hogar (y pueden traer técnicas). */
function customsChange(ctx: Ctx, fromId: RegionId, toId: RegionId): void {
  const { w, rng } = ctx;
  const from = w.regions[fromId];
  const to = w.regions[toId];
  const carried = from.techs.filter((t) => !to.techs.includes(t));
  const cause = from.flags.emigrando?.causeId;
  if (carried.length) {
    const t = rng.pick(carried);
    to.techs.push(t);
    record(ctx, { kind: 'tecnologia', text: `Los emigrantes de ${from.name} enseñaron ${TECH_BY_ID[t].name} en ${to.name}.`, regions: [fromId, toId], causeId: cause, importance: 2 });
  } else {
    const what = rng.pick(['sus canciones', 'su manera de cocinar', 'sus fiestas', 'su forma de contar los días']);
    record(ctx, { kind: 'migracion', text: `Las costumbres de ${to.name} cambian: los recién llegados de ${from.name} traen ${what}.`, regions: [fromId, toId], causeId: cause });
  }
  if (!to.isHome && to.relations[fromId]) to.relations[fromId].opinion = clamp(to.relations[fromId].opinion + 0.2, -1, 1);
}
