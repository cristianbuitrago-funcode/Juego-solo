import { record } from '../chronicle';
import { schedule } from '../effects';
import type { Region, RegionId } from '../types';
import { clamp } from '../util';
import { leaderOf, routeBetween, type Ctx } from '../world';
import { killCharacter, regionRemembers } from './characters';
import { techMult } from './economy';

/**
 * Conflictos. La guerra no es el centro del juego: es lo que ocurre cuando
 * la prevención falla. Antes de estallar, deja pistas (movimientos
 * nocturnos, forjas, exploradores heridos) y a veces peticiones de mediación.
 */
export function tickConflict(ctx: Ctx): void {
  const { w, rng } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    for (const [idStr, rel] of Object.entries(r.relations)) {
      const id = Number(idStr);
      const o = w.regions[id];
      if (o.isHome || rel.war) continue;
      if (rel.tension > 0.72 && r.militancy > 0.6 && rel.opinion < -0.2) {
        // El mundo aprendió que el jugador media: primero le piden ayuda.
        if ((w.player.patterns.dialogo ?? 0) >= 3 && !r.flags[`pidioMediacion_${id}`]) {
          r.flags[`pidioMediacion_${id}`] = { since: w.day };
          schedule(ctx, 'peticionMediacion', 0.1, { a: r.id, b: id });
          continue;
        }
        if (rng.chance(0.18)) startWar(ctx, r, o);
      }
    }
    // Incursiones contra tu gente si el rencor es enorme.
    if (r.neighbors.includes(w.player.home) && r.attitude.resentment > 0.72 && r.militancy > 0.6 && rng.chance(0.06)) raidHome(ctx, r);
  }
  for (const r of w.regions) {
    for (const [idStr, rel] of Object.entries(r.relations)) {
      const id = Number(idStr);
      if (rel.war && id > r.id) tickWar(ctx, r, w.regions[id]);
    }
  }
}

export function startWar(ctx: Ctx, attacker: Region, defender: Region): void {
  const { w } = ctx;
  const rel = attacker.relations[defender.id];
  const back = defender.relations[attacker.id];
  rel.war = back.war = true;
  rel.allied = back.allied = false;
  const route = routeBetween(w, attacker.id, defender.id);
  if (route) route.status = 'bloqueada';
  const e = record(ctx, { kind: 'conflicto', text: `Estalla la guerra: ${attacker.name} ataca a ${defender.name}.`, regions: [attacker.id, defender.id], causeId: rel.tensionCause ?? attacker.flags.preparando?.causeId, importance: 3, known: true });
  attacker.flags.guerra = { since: w.day, causeId: e.id, data: { with: defender.id } };
  defender.flags.guerra = { since: w.day, causeId: e.id, data: { with: attacker.id } };
  regionRemembers(ctx, defender.id, 'guerra', -0.6, e.id, { X: attacker.name }, attacker.id);
  regionRemembers(ctx, attacker.id, 'guerra', -0.3, e.id, { X: defender.name }, defender.id);
  w.lastWarDay = w.day;
  w.counters.wars = (w.counters.wars ?? 0) + 1;
  // Los aliados del defensor se indignan con el atacante.
  for (const [allyId, ar] of Object.entries(defender.relations)) {
    if (ar.allied && attacker.relations[Number(allyId)]) {
      attacker.relations[Number(allyId)].tension = clamp(attacker.relations[Number(allyId)].tension + 0.3);
      w.regions[Number(allyId)].relations[attacker.id].opinion -= 0.3;
    }
  }
}

function strength(ctx: Ctx, r: Region, enemy: RegionId): number {
  let s = (r.population / 100) * (0.5 + r.militancy) * (1 + techMult(r, 'defense')) * (0.6 + r.stability * 0.4);
  for (const [id, rel] of Object.entries(r.relations)) {
    if (rel.allied && Number(id) !== enemy) s += (ctx.w.regions[Number(id)].population / 100) * 0.3;
  }
  return s;
}

function tickWar(ctx: Ctx, a: Region, b: Region): void {
  const { w, rng } = ctx;
  const sa = strength(ctx, a, b.id);
  const sb = strength(ctx, b, a.id);
  for (const [x, sx, sy] of [[a, sa, sb], [b, sb, sa]] as const) {
    const loss = 0.012 * (sy / (sx + sy)) * 2 * (1 - techMult(x, 'defense') * 0.5);
    x.population *= 1 - loss;
    x.food = Math.max(0, x.food - 0.4);
    x.stability = clamp(x.stability - 0.02 * (sy / (sx + sy)) * 2);
    if (rng.chance(0.05)) killCharacter(ctx, x.id, x.flags.guerra?.causeId, 'en la guerra');
  }
  const days = w.day - (a.flags.guerra?.since ?? w.day);
  const exhausted = a.stability < 0.22 || b.stability < 0.22 || days > 9 + rng.int(0, 6);
  if (exhausted) endWar(ctx, a, b, sa >= sb ? a : b, 'agotamiento');
}

export function endWar(ctx: Ctx, a: Region, b: Region, winner: Region | null, how: string): void {
  const { w } = ctx;
  const rel = a.relations[b.id];
  const back = b.relations[a.id];
  rel.war = back.war = false;
  rel.tension = back.tension = 0.35;
  const route = routeBetween(w, a.id, b.id);
  if (route && route.status === 'bloqueada') route.status = 'abierta';
  const cause = a.flags.guerra?.causeId;
  let text: string;
  if (winner) {
    const loser = winner === a ? b : a;
    const tribute = Math.min(loser.food, 4);
    loser.food -= tribute;
    winner.food += tribute;
    loser.relations[winner.id].grievance = clamp(loser.relations[winner.id].grievance + 0.5);
    loser.relations[winner.id].opinion = clamp(loser.relations[winner.id].opinion - 0.3, -1, 1);
    text = `Termina la guerra entre ${a.name} y ${b.name} por ${how}. ${winner.name} impone sus condiciones; ${loser.name} no lo olvidará.`;
  } else {
    rel.opinion = back.opinion = clamp(Math.max(rel.opinion, -0.2) + 0.1, -1, 1);
    text = `Termina la guerra entre ${a.name} y ${b.name} por ${how}.`;
  }
  record(ctx, { kind: 'conflicto', text, regions: [a.id, b.id], causeId: cause, importance: 3, known: true });
  delete a.flags.guerra;
  delete b.flags.guerra;
  a.militancy *= 0.6;
  b.militancy *= 0.6;
  w.lastWarDay = w.day;
}

function raidHome(ctx: Ctx, r: Region): void {
  const { w } = ctx;
  const leader = leaderOf(w, r.id);
  const loss = Math.min(w.player.reserves, 15);
  w.player.reserves -= loss;
  w.player.cohesion = clamp(w.player.cohesion - 0.08);
  r.militancy *= 0.8;
  const cause = leader?.memories.filter((m) => m.about === 'jugador' && m.weight < 0).pop()?.entryId;
  record(ctx, { kind: 'conflicto', text: `Gente de ${r.name} asaltó tus almacenes durante la noche. Se llevaron provisiones.`, regions: [r.id, w.player.home], causeId: cause, importance: 3, known: true });
}
