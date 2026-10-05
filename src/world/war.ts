import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, entry, makeCtx } from '../core/world';
import { record } from '../core/chronicle';
import { endWar } from '../core/systems/conflict';
import { FOODS, foodDays, marketOf, type Good } from './economy';
import { nearTiles, waterOf } from './farming';
import { seedRumor } from './gossip';
import { chanceOf, deed, gain, levelOf, story, type GainNote } from './identity';
import { migrate } from './arcs';
import { mournDeaths } from './social';
import { folkById, logEvent, memorize, playerRegion, trait } from './society';
import { T } from './types';
import { playerEco } from './business';
import { adjustRep, orgsOf } from './orgs';
import { govOf, recordDecision } from './politics';
import { relOf, signTreaty, treatiesOf } from './diplomacy';
import { die, healthOf, injure } from './generations';
import { createHeirloom } from './estate';
import { nid, polOf, type Army, type Battle, type Terrain, type War } from './polstate';

/**
 * La guerra, cuando llega, es un asunto de recursos: soldados que comen,
 * armas que se gastan, carros que llevan el grano al frente, gente que se
 * cansa, terreno que ayuda a quien se defiende, quien manda y lo que se sabe
 * del enemigo. Sale de causas (hambre, agravios, tierras, comercio cortado),
 * se puede evitar, y deja casas quemadas, viudas, precios disparados y
 * fronteras nuevas. El jugador puede luchar, abastecer, espiar, mediar,
 * comerciar, ayudar a los refugiados… o mantenerse al margen.
 */
export const TERRAIN_NAME: Record<Terrain, string> = { llano: 'campo abierto', bosque: 'el bosque', monte: 'las montañas', rio: 'el río', ciudad: 'las murallas' };
const TERRAIN_BONUS: Record<Terrain, number> = { llano: 1, bosque: 1.3, monte: 1.5, rio: 1.25, ciudad: 1.6 };

export function terrainOf(w: WorldState, regionId: number): Terrain {
  const t = w.life!.towns[regionId];
  if (t?.walls) return 'ciudad';
  const mountain = nearTiles(w, regionId, (x) => x === T.Mountain || x === T.Rock);
  const forest = nearTiles(w, regionId, (x) => x === T.Forest);
  if (mountain > 40) return 'monte';
  if (forest > 60) return 'bosque';
  if (w.regions[regionId].riverOrder >= 0 || waterOf(w, regionId) > 0.7) return 'rio';
  return 'llano';
}

export const activeWars = (w: WorldState) => polOf(w).wars.filter((x) => x.status === 'activa');
export const warOf = (w: WorldState, regionId: number) => activeWars(w).find((x) => x.a === regionId || x.b === regionId || Object.values(x.allies).some((l) => l.includes(regionId)));
export const enemyOf = (war: War, side: number) => (war.a === side ? war.b : war.a);

function raiseArmy(w: WorldState, regionId: number): Army {
  const r = w.regions[regionId];
  const guard = orgsOf(w, regionId).find((o) => o.kind === 'guardia');
  const m = marketOf(w, regionId);
  const soldiers = Math.round(r.population * 0.035 * (0.5 + r.militancy) + (guard?.members.length ?? 0) * 4);
  const lead = guard?.leader && guard.leader !== 'jugador' ? guard.leader : undefined;
  return { regionId, soldiers, morale: clamp(0.55 + r.stability * 0.3), supply: Math.min(10, FOODS.reduce((s, g) => s + m.stock[g], 0) / Math.max(1, soldiers * 0.12)), weapons: clamp(m.stock.armas / Math.max(1, soldiers * 0.08)), transport: 0.4, fatigue: 0, leader: lead, intel: 0.1, hungryDays: 0 };
}

/** Las causas de una guerra (lo que llevó a ella), para la crónica. */
function causesOf(w: WorldState, a: number, b: number): string[] {
  const out: string[] = [];
  const ra = relOf(w, a, b);
  if (foodDays(w, a) < 1.5) out.push(`el hambre en ${w.regions[a].name}`);
  if (ra.grievance > 0.3) out.push('viejos agravios');
  if (polOf(w).claims.some((c) => c.a === a && c.b === b)) out.push('una disputa por tierras');
  if (govOf(w, b).laws.comercio === 'cerrado' || govOf(w, a).laws.comercio === 'cerrado') out.push('el comercio cortado');
  const cause = entry(w, ra.tensionCause);
  if (cause) out.push(cause.text.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()));
  if (!out.length) out.push('la desconfianza');
  return out;
}

function startWorldWar(w: WorldState, a: number, b: number): War {
  const pol = polOf(w);
  const war: War = { id: nid(w, 'g'), a, b, since: w.day, causes: causesOf(w, a, b), status: 'activa', front: b, armies: { [a]: raiseArmy(w, a), [b]: raiseArmy(w, b) }, battles: [], occupied: [], nextBattle: w.day + 2, allies: { [a]: [], [b]: [] } };
  pol.wars.push(war);
  // Los pactos de defensa: quien tiene un pacto con el atacado acude.
  for (const t of treatiesOf(w, b)) {
    const ally = t.a === b ? t.b : t.a;
    if ((t.kind === 'defensa' || t.kind === 'alianza') && ally !== a) war.allies[b].push(ally);
  }
  for (const t of treatiesOf(w, a)) {
    const ally = t.a === a ? t.b : t.a;
    if (t.kind === 'alianza' && ally !== b && !war.allies[b].includes(ally)) war.allies[a].push(ally);
  }
  const text = `${w.regions[a].name} y ${w.regions[b].name} están en guerra. Por qué: ${war.causes.join(', ')}.`;
  for (const id of [a, b]) logEvent(w, id, 'guerra', text, []);
  pol.log.push({ day: w.day, regionId: a, kind: 'guerra', text });
  return war;
}

function armyPower(w: WorldState, war: War, side: number, defending: boolean): number {
  const army = war.armies[side];
  let p = army.soldiers * (0.5 + army.morale) * (0.4 + Math.min(1, army.weapons) * 0.6) * (army.supply > 0 ? 1 : 0.55) * (1 - army.fatigue * 0.4) * (1 + army.intel * 0.3);
  const lead = army.leader ? folkById(w, army.leader) : undefined;
  if (lead) p *= 0.85 + (trait(lead, 'valiente') + trait(lead, 'ambicioso')) / 400;
  if (defending) p *= TERRAIN_BONUS[terrainOf(w, war.front)];
  for (const ally of war.allies[side] ?? []) p += w.regions[ally].population * 0.008;
  return p;
}

export function warDay(w: WorldState, rng: Rng): string[] {
  const pol = polOf(w);
  const out: string[] = [];
  // Guerras que el motor ha empezado (por tensión) y que aún no tienen ejército.
  for (const r of w.regions) for (const [idStr, rel] of Object.entries(r.relations)) {
    const id = Number(idStr);
    if (rel.war && id > r.id && !activeWars(w).some((x) => (x.a === r.id && x.b === id) || (x.a === id && x.b === r.id))) {
      // Ataca quien estaba más armado (el que se preparaba para la guerra).
      const attacker = r.militancy >= w.regions[id].militancy ? r.id : id;
      const war = startWorldWar(w, attacker, attacker === r.id ? id : r.id);
      if (war.a === w.player.home || war.b === w.player.home || playerRegion(w) === war.a || playerRegion(w) === war.b) out.push(`Guerra entre ${w.regions[war.a].name} y ${w.regions[war.b].name}.`);
    }
  }
  for (const war of activeWars(w)) out.push(...warTick(w, rng, war));
  // Reconstrucción: las casas quemadas se levantan con madera y piedra del mercado.
  for (const r of w.regions) {
    const t = w.life!.towns[r.id];
    if (!t?.burned.length || r.flags.guerra) continue;
    const m = marketOf(w, r.id);
    if (m.stock.madera >= 2 && m.stock.piedra >= 1) {
      m.stock.madera -= 2;
      m.stock.piedra -= 1;
      m.demand.madera += 0.1;
    }
  }
  // Territorios ocupados: pagan tributo y se resisten.
  for (const [idStr, owner] of Object.entries(pol.owner)) {
    const id = Number(idStr);
    if (owner === id) continue;
    const m = marketOf(w, id);
    const tribute = Math.min(m.treasury, 0.6);
    m.treasury -= tribute;
    marketOf(w, owner).treasury += tribute;
    for (const o of orgsOf(w, id)) o.discontent = clamp(o.discontent + 0.01);
    // Si el ocupante se debilita o la gente se harta, se recupera la independencia.
    const occupiedFor = w.day - (w.regions[id].flags.ocupada?.since ?? w.day);
    if (occupiedFor > 25 && rng.chance(0.03 + (w.regions[owner].stability < 0.4 ? 0.05 : 0))) {
      pol.owner[id] = id;
      delete w.regions[id].flags.ocupada;
      const text = `${w.regions[id].name} expulsa a la gente de ${w.regions[owner].name} y recupera su independencia.`;
      logEvent(w, id, 'guerra', text, []);
      pol.log.push({ day: w.day, regionId: id, kind: 'frontera', text });
      const ctx = makeCtx(w);
      record(ctx, { kind: 'conflicto', text, regions: [id, owner], importance: 3, known: true });
      commitCtx(ctx);
      out.push(text);
    }
  }
  return out;
}

function warTick(w: WorldState, rng: Rng, war: War): string[] {
  const out: string[] = [];
  const near = (id: number) => playerRegion(w) === id || w.player.home === id || war.playerSide !== undefined;
  for (const side of [war.a, war.b]) {
    const army = war.armies[side];
    const m = marketOf(w, side);
    // Suministro: los soldados comen del mercado de su pueblo (y eso encarece la comida de todos).
    const need = army.soldiers * 0.012;
    let got = 0;
    for (const g of FOODS) {
      const take = Math.min(m.stock[g], need - got);
      m.stock[g] -= take;
      got += take;
      if (got >= need) break;
    }
    const pay = Math.min(m.treasury, got * 0.5);
    m.treasury -= pay;
    // Llevarlo al frente cuesta: sin carros, llega menos (más aún si el frente está lejos).
    const away = war.front !== side;
    const delivered = got * (away ? 0.4 + army.transport * 0.6 : 1);
    army.supply = clamp(army.supply + delivered / Math.max(1, army.soldiers * 0.012) - 1, 0, 15);
    army.hungryDays = army.supply <= 0 ? army.hungryDays + 1 : 0;
    army.weapons = clamp(army.weapons + Math.min(m.stock.armas, 0.3) / Math.max(1, army.soldiers * 0.08));
    m.stock.armas = Math.max(0, m.stock.armas - 0.3);
    m.demand.armas += 0.05;
    army.fatigue = clamp(army.fatigue + (away ? 0.03 : 0.015));
    army.morale = clamp(army.morale - (army.hungryDays > 0 ? 0.04 : 0) - army.fatigue * 0.01 + (w.regions[side].stability - 0.5) * 0.01);
    // Al ejército le falta comida: un secreto que vale mucho.
    if (army.supply < 3 && !polOf(w).secrets.some((s) => s.kind === 'ejercito' && s.other === side && s.expires > w.day)) {
      const holders = w.life!.folk.filter((f) => f.alive && f.regionId === side && (f.role === 'guardia' || f.role === 'comerciante')).map((f) => f.id);
      polOf(w).secrets.push({ id: nid(w, 's'), kind: 'ejercito', regionId: side, other: side, day: w.day, text: `Al ejército de ${w.regions[side].name} le falta comida: no aguantará muchos días más.`, hint: `Dicen que los soldados de ${w.regions[side].name} comen una vez al día.`, holders, testimonies: [], known: false, suspected: false, used: [], public: false, expires: w.day + 10 });
    }
  }
  if (w.day >= war.nextBattle) {
    const b = battle(w, rng, war);
    war.battles.push(b);
    war.nextBattle = w.day + 3 + rng.int(0, 2);
    if (near(war.a) || near(war.b)) out.push(b.text);
  }
  // Rendición o agotamiento.
  for (const side of [war.a, war.b]) {
    const army = war.armies[side];
    if (army.morale < 0.15 || army.soldiers < 4 || army.hungryDays >= 5) {
      out.push(...finishWar(w, war, enemyOf(war, side), army.hungryDays >= 5 ? 'hambre' : 'derrota'));
      return out;
    }
  }
  if (w.day - war.since > 30 && war.armies[war.a].morale < 0.4 && war.armies[war.b].morale < 0.4) out.push(...finishWar(w, war, undefined, 'agotamiento'));
  return out;
}

function battle(w: WorldState, rng: Rng, war: War): Battle {
  const att = war.front === war.b ? war.a : war.b;
  const def = war.front;
  const pa = armyPower(w, war, att, false) * rng.range(0.75, 1.25);
  const pd = armyPower(w, war, def, true) * rng.range(0.75, 1.25);
  const winner = pa > pd ? att : def;
  const loser = winner === att ? def : att;
  const ratio = Math.min(pa, pd) / Math.max(pa, pd);
  const losses: Record<number, number> = {};
  for (const side of [att, def]) {
    const army = war.armies[side];
    const lost = Math.max(1, Math.round(army.soldiers * (side === loser ? 0.16 : 0.07) * (1.2 - ratio * 0.4)));
    army.soldiers = Math.max(0, army.soldiers - lost);
    w.regions[side].population = Math.max(40, w.regions[side].population - lost);
    losses[side] = lost;
    army.morale = clamp(army.morale + (side === winner ? 0.08 : -0.15));
    army.fatigue = clamp(army.fatigue + 0.12);
    army.weapons = clamp(army.weapons - 0.1);
    // Mueren vecinos con nombre (sobre todo de la guardia).
    if (rng.chance(side === loser ? 0.7 : 0.35)) killFolk(w, rng, side, war);
  }
  const terrain = terrainOf(w, def);
  const t = w.life!.towns[def];
  if (winner === att && t && t.houses > 2) {
    const slot = rng.int(0, t.houses - 1);
    if (!t.burned.includes(slot)) t.burned.push(slot);
  }
  // Si el defensor pierde y está agotado, el atacante ocupa el pueblo: la frontera se mueve.
  if (winner === att && war.armies[def].morale < 0.3 && !war.occupied.includes(def)) occupy(w, war, def, att);
  // Si el atacante pierde una y otra vez, el frente cambia de lado.
  else if (winner === def && war.armies[att].morale < 0.35 && war.front === def) war.front = att;
  const text = `Batalla en ${TERRAIN_NAME[terrain]} de ${w.regions[def].name}: ${winner === def ? `${w.regions[def].name} resiste` : `${w.regions[att].name} se impone`}. Caen ${losses[att] + losses[def]} entre los dos bandos.`;
  for (const id of [att, def]) logEvent(w, id, 'batalla', text, []);
  polOf(w).log.push({ day: w.day, regionId: def, kind: 'batalla', text });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'conflicto', text, regions: [att, def], importance: 2, causeId: w.regions[def].flags.guerra?.causeId });
  commitCtx(ctx);
  return { day: w.day, at: def, terrain, winner, losses, text };
}

function killFolk(w: WorldState, rng: Rng, regionId: number, war: War): void {
  const pool = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && (f.role === 'guardia' || (f.age >= 18 && f.age < 50 && rng.chance(0.15))) && !f.charId);
  const f = pool.length ? rng.pick(pool) : undefined;
  if (!f) return;
  f.alive = false;
  f.died = w.day;
  logEvent(w, regionId, 'muerte', `${f.name} ha muerto en la guerra contra ${w.regions[enemyOf(war, regionId)].name}.`, [f.id]);
  mournDeaths(w, [f]);
}

function occupy(w: WorldState, war: War, region: number, by: number): void {
  const pol = polOf(w);
  war.occupied.push(region);
  pol.owner[region] = by;
  w.regions[region].flags.ocupada = { since: w.day, data: { by } };
  // Saqueo: la comida y las arcas del vencido pasan al vencedor.
  const m = marketOf(w, region);
  const mm = marketOf(w, by);
  for (const g of FOODS) {
    const take = m.stock[g] * 0.3;
    m.stock[g] -= take;
    mm.stock[g] += take;
  }
  mm.treasury += m.treasury * 0.5;
  m.treasury *= 0.5;
  // Refugiados: familias que huyen a otro pueblo.
  const rng = new Rng(hashString(`ref:${region}:${w.day}`));
  const fleeing = w.life!.folk.filter((f) => f.alive && f.regionId === region && f.age >= 18 && f.p && !f.charId && f.role !== 'lider' && rng.chance(0.15));
  const safe = w.regions[region].neighbors.filter((n) => n !== by && !warOf(w, n));
  for (const f of fleeing.slice(0, 3)) if (safe.length) migrate(w, f, rng.pick(safe), true);
  const text = `${w.regions[by].name} ocupa ${w.regions[region].name}. ${fleeing.length ? 'Familias enteras huyen por los caminos.' : ''}`;
  logEvent(w, region, 'guerra', text, []);
  pol.log.push({ day: w.day, regionId: region, kind: 'frontera', text });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'conflicto', text, regions: [region, by], importance: 3, known: true });
  commitCtx(ctx);
}

/** Fin de la guerra: el motor la cierra; aquí quedan las condiciones y las cicatrices. */
export function finishWar(w: WorldState, war: War, winner: number | undefined, how: string, byPlayer = false): string[] {
  war.status = 'terminada';
  const A = w.regions[war.a];
  const B = w.regions[war.b];
  const ctx = makeCtx(w);
  endWar(ctx, A, B, winner === undefined ? null : w.regions[winner], how === 'paz' ? 'un tratado de paz' : how === 'hambre' ? 'hambre en las filas' : how);
  commitCtx(ctx);
  const loser = winner === undefined ? undefined : enemyOf(war, winner);
  const terms = winner !== undefined && loser !== undefined ? { tribute: 0.8, payer: loser } : undefined;
  signTreaty(w, 'paz', war.a, war.b, byPlayer ? 'jugador' : 'mundo', terms);
  // Lo ocupado: el vencedor se lo queda (si ganó); si no, vuelve a su dueño.
  for (const id of war.occupied) if (winner === undefined || polOf(w).owner[id] !== winner) {
    polOf(w).owner[id] = id;
    delete w.regions[id].flags.ocupada;
  }
  const text = winner !== undefined ? `Termina la guerra: ${w.regions[winner].name} vence a ${w.regions[loser!].name}${war.occupied.length ? ' y se queda con tierras ajenas' : ''}.` : `Termina la guerra entre ${A.name} y ${B.name}, sin vencedores.`;
  war.ended = { day: w.day, text, winner };
  for (const id of [war.a, war.b]) {
    logEvent(w, id, 'guerra', text, []);
    // Las cicatrices: el pueblo recuerda (y quien perdió a alguien, más).
    for (const f of w.life!.folk.filter((x) => x.alive && x.regionId === id && x.p)) memorize(w, f, { kind: 'guerra', text: `La guerra contra ${w.regions[enemyOf(war, id)].name}.`, w: -0.5, src: 'propio' });
  }
  polOf(w).log.push({ day: w.day, regionId: war.a, kind: 'guerra', text });
  if (war.playerSide !== undefined) {
    const won = winner === war.playerSide;
    story(w, won ? `Estuvo en el bando vencedor de la guerra entre ${A.name} y ${B.name}.` : winner === undefined ? `Vivió la guerra entre ${A.name} y ${B.name}, que nadie ganó.` : `Estuvo en el bando derrotado de la guerra entre ${A.name} y ${B.name}.`, won ? 'logro' : 'error');
  }
  return [text];
}

// ---------------------------------------------------------------------------
// Lo que puede hacer el jugador en una guerra (todo opcional)
// ---------------------------------------------------------------------------
/** Alistarse: luchar en la próxima batalla del lado de `side`. */
export function enlist(w: WorldState, war: War, side: number): { lines: string[]; notes: GainNote[] } {
  const id = w.life!.identity!;
  const rng = new Rng(hashString(`alista:${war.id}:${w.day}`));
  war.playerSide = side;
  const army = war.armies[side];
  const skill = levelOf(id, 'combate');
  const lead = levelOf(id, 'liderazgo');
  army.soldiers += 1;
  army.morale = clamp(army.morale + 0.02 + lead * 0.03);
  const notes = [...gain(w, 'combate', 1.2), ...gain(w, 'liderazgo', lead > 0 ? 0.6 : 0.2)];
  id.needs.fatigue = Math.min(1, id.needs.fatigue + 0.45);
  deed(id, 'combatir');
  const hurt = !rng.chance(chanceOf(id, 'combate', 1.5));
  createHeirloom(w, 'espada', `La espada de ${w.life!.player.name}`, `La empuñó por primera vez en la guerra entre ${w.regions[war.a].name} y ${w.regions[war.b].name}.`);
  if (hurt) {
    id.needs.hunger = Math.min(1, id.needs.hunger + 0.2);
    // Una herida de verdad (y, si el cuerpo ya no aguanta, la muerte en el campo).
    const sev = rng.range(0.25, 0.7) * (1.4 - (id.vigor?.body ?? 1) * 0.4);
    injure(w, sev, `una batalla en ${w.regions[war.front].name}`);
    if (sev > 0.6 && healthOf(w).value < 0.35 && rng.chance(0.35)) die(w, 'guerra', `en la batalla de ${w.regions[war.front].name}`);
  }
  // Pelear la batalla ahora mismo.
  const b = battle(w, rng, war);
  b.player = side === b.winner ? 'victoria' : 'derrota';
  war.battles.push(b);
  war.nextBattle = w.day + 3;
  for (const o of orgsOf(w, side).filter((x) => x.kind === 'guardia')) adjustRep(w, o, 0.2);
  for (const o of orgsOf(w, enemyOf(war, side))) adjustRep(w, o, -0.2);
  w.life!.identity!.score[side] = (w.life!.identity!.score[side] ?? 0) + 5;
  w.life!.identity!.score[enemyOf(war, side)] = (w.life!.identity!.score[enemyOf(war, side)] ?? 0) - 8;
  story(w, `Luchó por ${w.regions[side].name} en ${TERRAIN_NAME[b.terrain]}.`, 'decision');
  recordDecision(w, 'territorio', side, `Luchó en la guerra por ${w.regions[side].name}.`);
  w.life!.clock += 300;
  return { lines: [b.text, skill >= 2 ? 'Peleas como si lo hubieras hecho toda la vida. Quizá lo hiciste.' : 'El miedo te cierra la garganta, pero aguantas.', hurt ? 'Sales con un corte en el brazo y sin fuerzas.' : 'Sales entero, de milagro.'], notes };
}

/** Abastecer al ejército con lo que llevas (comida, armas, medicinas). */
export function supplyArmy(w: WorldState, war: War, side: number, sell: boolean): { lines: string[]; notes: GainNote[] } {
  const pe = playerEco(w);
  const id = w.life!.identity!;
  const army = war.armies[side];
  const m = marketOf(w, side);
  let food = 0;
  let arms = 0;
  let pay = 0;
  for (const [g, n] of Object.entries(pe.cargo) as [Good, number][]) {
    if (FOODS.includes(g)) food += n;
    else if (g === 'armas') arms += n;
    else continue;
    pay += n * m.price[g] * (sell ? 1.1 : 0);
    delete pe.cargo[g];
  }
  if (!food && !arms) return { lines: ['No llevas nada que le sirva a un ejército: ni comida ni armas.'], notes: [] };
  army.supply = clamp(army.supply + food / Math.max(1, army.soldiers * 0.012), 0, 15);
  army.weapons = clamp(army.weapons + arms / Math.max(1, army.soldiers * 0.08));
  army.morale = clamp(army.morale + 0.03);
  if (sell) {
    const paid = Math.min(pay, m.treasury + 10);
    m.treasury = Math.max(0, m.treasury - paid);
    id.needs.coins += paid;
    story(w, `Vendió suministros al ejército de ${w.regions[side].name}.`, 'decision');
    for (const o of orgsOf(w, side).filter((x) => x.kind === 'comerciantes')) adjustRep(w, o, 0.08);
    return { lines: [`Te pagan ${Math.round(paid)} monedas. A precio de guerra.`, '(Hay quien dirá que te haces rico con la sangre ajena.)'], notes: gain(w, 'comercio', 0.6) };
  }
  for (const o of orgsOf(w, side)) adjustRep(w, o, 0.1);
  w.life!.identity!.score[side] = (w.life!.identity!.score[side] ?? 0) + 4;
  story(w, `Regaló suministros al ejército de ${w.regions[side].name}.`, 'decision');
  recordDecision(w, 'territorio', side, `Abasteció al ejército de ${w.regions[side].name}.`);
  return { lines: ['Los soldados descargan tu carga entre vítores. Esta noche comerán.'], notes: [] };
}

/** Espiar al enemigo: averiguar su suministro (un secreto que vale una batalla). */
export function spyArmy(w: WorldState, war: War, target: number): { lines: string[]; notes: GainNote[] } {
  const id = w.life!.identity!;
  const rng = new Rng(hashString(`espia:${war.id}:${w.day}:${target}`));
  const notes = gain(w, 'sigilo', 0.9);
  w.life!.clock += 240;
  if (!rng.chance(chanceOf(id, 'sigilo', 1.5))) {
    id.score[target] = (id.score[target] ?? 0) - 10;
    return { lines: [`Te descubren cerca del campamento de ${w.regions[target].name}. Escapas por poco; allí ya saben tu cara.`], notes };
  }
  const army = war.armies[target];
  const side = enemyOf(war, target);
  war.armies[side].intel = clamp(war.armies[side].intel + 0.25);
  const lines = [`Cuentas tiendas y fuegos. ${army.soldiers > war.armies[side].soldiers ? 'Son más que los vuestros.' : 'Son menos de lo que dicen.'}`, army.supply < 3 ? 'Los sacos de grano están casi vacíos: no aguantarán mucho.' : 'Tienen comida para días.', army.morale < 0.4 ? 'Las caras están largas. Nadie canta.' : 'Hay ánimo en el campamento.'];
  const s = polOf(w).secrets.find((x) => x.kind === 'ejercito' && x.other === target && !x.known);
  if (s) {
    s.known = true;
    lines.push('(Ahora sabes algo que puede decidir la guerra.)');
  }
  recordDecision(w, 'territorio', target, `Espió al ejército de ${w.regions[target].name}.`);
  return { lines, notes };
}

/** Ayudar a la gente que huye de la guerra. */
export function helpRefugees(w: WorldState, regionId: number): { lines: string[]; notes: GainNote[] } {
  const pe = playerEco(w);
  const food = FOODS.reduce((s, g) => s + (pe.cargo[g] ?? 0), 0);
  const inv = w.life!.player.inventory;
  if (food < 1 && inv.comida < 1 && inv.hierbas < 1) return { lines: ['No tienes nada que darles.'], notes: [] };
  for (const g of FOODS) delete pe.cargo[g];
  inv.comida = 0;
  const lines = ['Repartes lo que tienes entre las familias que llegan con lo puesto. Un niño no te suelta la mano.'];
  for (const f of w.life!.folk.filter((x) => x.alive && x.regionId === regionId && x.origin !== undefined && x.lastMet >= -1).slice(0, 4)) {
    f.gratitude = Math.min(1, f.gratitude + 0.3);
    f.lastMet = w.day;
    memorize(w, f, { kind: 'refugio', about: 'jugador', text: 'Nos dio de comer cuando huíamos de la guerra.', w: 0.8, src: 'propio' });
  }
  w.life!.identity!.score[regionId] = (w.life!.identity!.score[regionId] ?? 0) + 4;
  story(w, `Ayudó a los refugiados de la guerra en ${w.regions[regionId].name}.`, 'decision');
  recordDecision(w, 'familia', regionId, 'Ayudó a los refugiados.');
  seedRumor(w, { regionId, kind: 'p_comida', subject: 'jugador', target: w.life!.folk.find((x) => x.alive && x.regionId === regionId)?.id, witnesses: w.life!.folk.filter((x) => x.alive && x.regionId === regionId).slice(0, 6).map((x) => x.id) });
  return { lines, notes: gain(w, 'medicina', 0.2) };
}

/** Mediar la paz: hay que convencer a los dos bandos (en persona, a cada uno). */
export function mediationState(w: WorldState, war: War): { a: boolean; b: boolean } {
  const s = (war as War & { mediation?: { a: boolean; b: boolean } }).mediation;
  return s ?? { a: false, b: false };
}

export function mediationAgreed(w: WorldState, war: War, side: number): string[] {
  const x = war as War & { mediation?: { a: boolean; b: boolean } };
  x.mediation ??= { a: false, b: false };
  if (side === war.a) x.mediation.a = true;
  else x.mediation.b = true;
  if (x.mediation.a && x.mediation.b) {
    const winner = war.occupied.length ? enemyOf(war, war.occupied[0]) : undefined;
    const out = finishWar(w, war, winner, 'paz', true);
    story(w, `Medió la paz entre ${w.regions[war.a].name} y ${w.regions[war.b].name}.`, 'logro');
    recordDecision(w, 'territorio', war.a, `Medió la paz entre ${w.regions[war.a].name} y ${w.regions[war.b].name}.`);
    for (const id of [war.a, war.b]) w.life!.identity!.score[id] = (w.life!.identity!.score[id] ?? 0) + 10;
    return out;
  }
  return [`${w.regions[side].name} acepta hablar de paz. Falta convencer a ${w.regions[enemyOf(war, side)].name}.`];
}

/** Lo que se ve de una guerra (sin cifras). */
export function describeWar(w: WorldState, war: War): string[] {
  const lines: string[] = [];
  const A = w.regions[war.a];
  const B = w.regions[war.b];
  lines.push(`${A.name} contra ${B.name}, desde hace ${w.day - war.since} días. Empezó por ${war.causes.join(', ')}.`);
  for (const side of [war.a, war.b]) {
    const army = war.armies[side];
    lines.push(`${w.regions[side].name}: ${army.soldiers > 30 ? 'un ejército grande' : army.soldiers > 12 ? 'un ejército mediano' : 'pocos soldados'}, ${army.morale > 0.6 ? 'con ánimo' : army.morale > 0.35 ? 'cansados' : 'desmoralizados'}, ${army.supply > 6 ? 'bien abastecidos' : army.supply > 2 ? 'con la comida justa' : 'casi sin comida'}.`);
  }
  lines.push(`Se lucha en ${TERRAIN_NAME[terrainOf(w, war.front)]} de ${w.regions[war.front].name}.`);
  if (war.occupied.length) lines.push(`Ocupado: ${war.occupied.map((id) => w.regions[id].name).join(', ')}.`);
  const allies = Object.entries(war.allies).flatMap(([side, list]) => list.map((x) => `${w.regions[x].name} con ${w.regions[Number(side)].name}`));
  if (allies.length) lines.push(`Acuden: ${allies.join('; ')}.`);
  return lines;
}

