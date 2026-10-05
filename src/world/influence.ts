import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { GOOD, type Good } from './economy';
import { levelOf, reputation } from './identity';
import { playerEco } from './business';
import { orgsOf, repOf } from './orgs';
import { govOf, isAdviser, playerSeat } from './politics';
import { polOf, SCALE_NAME, type Scale } from './polstate';
import { topScale } from './politics';

/**
 * Influencia: el jugador no empieza con poder. Lo gana con lo que sabe,
 * lo que tiene, a quién conoce, qué grupos le respaldan, qué ha hecho y con
 * quién se ha aliado. Hay seis formas de poder, y se puede ser muy poderoso
 * sin gobernar nada (un mercader rico, una sabia a la que todos consultan).
 */
export type PowerKind = 'politico' | 'economico' | 'social' | 'militar' | 'conocimiento' | 'diplomatico';

export const POWER: Record<PowerKind, { name: string; icon: string }> = {
  politico: { name: 'Político', icon: '🏛' },
  economico: { name: 'Económico', icon: '🪙' },
  social: { name: 'Social', icon: '🤝' },
  militar: { name: 'Militar', icon: '🛡' },
  conocimiento: { name: 'Conocimiento', icon: '📜' },
  diplomatico: { name: 'Diplomático', icon: '🕊' },
};

export const INFLUENCE: { name: string; hint: string }[] = [
  { name: 'Desconocido', hint: 'Nadie cuenta contigo para nada.' },
  { name: 'Conocido', hint: 'Saben quién eres; te saludan, te dan trabajo.' },
  { name: 'Respetado', hint: 'Tu opinión pesa; algún grupo te tiene en cuenta.' },
  { name: 'Influyente', hint: 'Mueves voluntades: grupos, dinero o información te respaldan.' },
  { name: 'Figura política', hint: 'Tienes un sitio donde se decide: un asiento, un cargo, una causa propia.' },
  { name: 'Líder', hint: 'Gobiernas, diriges un gran grupo o tus tratados ordenan la comarca.' },
];

export function powerOf(w: WorldState): Record<PowerKind, number> {
  const life = w.life!;
  const id = life.identity!;
  const pol = polOf(w);
  const pe = playerEco(w);
  // Político: cargos, asientos y grupos que diriges o representas.
  let politico = 0;
  for (const r of w.regions) {
    const rank = id.rank[r.id] ?? 0;
    politico = Math.max(politico, rank >= 6 ? 1 : rank >= 5 ? 0.65 : rank >= 4 ? 0.45 : 0);
    if (govOf(w, r.id).ruler === 'jugador') politico = 1;
    if (playerSeat(w, r.id)) politico = Math.max(politico, 0.6);
    else if (isAdviser(w, r.id)) politico = Math.max(politico, 0.45);
  }
  for (const o of orgsOf(w)) {
    if (o.player.rank === 4) politico = Math.max(politico, 0.5 + o.standing * 0.4);
    else if (o.player.rank === 3) politico = Math.max(politico, 0.5);
    else if (o.player.rank === 2) politico = Math.max(politico, 0.25);
  }
  // Económico: dinero, mercancía, negocios, encargos.
  const cargo = Object.entries(pe.cargo).reduce((s, [g, n]) => s + (n ?? 0) * GOOD[g as Good].base, 0);
  const economico = clamp(id.needs.coins / 220 + cargo / 300 + pe.businesses.length * 0.14 + pe.contracts.filter((c) => !c.done).length * 0.03 + (pe.vehicle === 'carreta' ? 0.08 : pe.vehicle === 'mula' ? 0.04 : 0));
  // Social: gente que te aprecia, en todos los pueblos.
  let friends = 0;
  for (const f of life.folk) if (f.alive && f.lastMet >= 0 && f.trust > 0.6 && f.resentment < 0.3) friends++;
  const bestRep = Math.max(0, ...w.regions.map((r) => reputation(w, r.id)));
  const social = clamp(friends / 45 + bestRep / 120);
  // Militar: la guardia te respeta, sabes pelear, has estado en batallas.
  const guard = Math.max(0, ...orgsOf(w).filter((o) => o.kind === 'guardia').map((o) => repOf(w, o) * (o.player.rank >= 2 ? 1.3 : 1)));
  const battles = pol.wars.reduce((s, x) => s + x.battles.filter((b) => b.player).length, 0);
  const militar = clamp(guard * 0.4 + levelOf(id, 'combate') * 0.1 + levelOf(id, 'liderazgo') * 0.06 + (id.deeds.combatir ?? 0) * 0.02 + battles * 0.12);
  // Conocimiento: secretos, aciertos, saberes.
  const secrets = pol.secrets.filter((s) => s.known).length;
  const hits = pol.forecasts.filter((f) => f.result === 'acierto').length;
  const conocimiento = clamp(secrets * 0.08 + hits * 0.06 + levelOf(id, 'k:politica') * 0.07 + levelOf(id, 'k:economia') * 0.06 + levelOf(id, 'k:historia') * 0.03 + levelOf(id, 'investigacion') * 0.05);
  // Diplomático: tratados, cargos fuera, pueblos que te aprecian.
  const treaties = pol.treaties.filter((t) => t.by === 'jugador').length;
  const roles = pol.roles.filter((r) => !r.lost).reduce((s, r) => s + (r.kind === 'diplomatico' ? 0.35 : r.kind === 'consejero' ? 0.2 : 0.15), 0);
  const known = w.regions.filter((r) => (id.standing[r.id] ?? 0) >= 2).length;
  const diplomatico = clamp(treaties * 0.18 + roles + Math.max(0, known - 1) * 0.08 + levelOf(id, 'diplomacia') * 0.05);
  return { politico, economico, social, militar, conocimiento, diplomatico };
}

/** El nivel de influencia (0..5): no hace falta llegar arriba. */
export function influenceLevel(w: WorldState): number {
  const id = w.life?.identity;
  if (!id) return 0;
  const p = powerOf(w);
  const vals = Object.values(p).sort((a, b) => b - a);
  const total = vals[0] + vals[1] * 0.7 + vals[2] * 0.5;
  const maxStanding = Math.max(0, ...Object.values(id.standing));
  const ruler = w.regions.some((r) => govOf(w, r.id).ruler === 'jugador');
  const bigLeader = orgsOf(w).some((o) => o.player.rank === 4 && o.standing > 0.55 && o.members.length >= 6);
  const pol = polOf(w);
  if (ruler || (bigLeader && p.politico >= 0.75) || pol.treaties.filter((t) => t.by === 'jugador').length >= 3) return 5;
  if (p.politico >= 0.5 && total >= 0.9) return 4;
  if (total >= 0.95 || (total >= 0.7 && (p.politico >= 0.25 || p.diplomatico >= 0.3))) return 3;
  if (total >= 0.4 && (maxStanding >= 2 || orgsOf(w).some((o) => o.player.rank >= 1))) return 2;
  if (maxStanding >= 1 || total >= 0.15) return 1;
  return 0;
}

/** Cómo te ven: frases, nunca cifras. */
export function influenceLines(w: WorldState): string[] {
  const p = powerOf(w);
  const lines: string[] = [];
  const word = (v: number) => (v >= 0.75 ? 'enorme' : v >= 0.5 ? 'grande' : v >= 0.25 ? 'algo' : v > 0.05 ? 'poco' : 'ninguno');
  const top = (Object.keys(p) as PowerKind[]).sort((a, b) => p[b] - p[a]);
  for (const k of top) if (p[k] > 0.05) lines.push(`${POWER[k].icon} Poder ${POWER[k].name.toLowerCase()}: ${word(p[k])}.`);
  if (!lines.length) lines.push('No tienes poder de ningún tipo. Aún.');
  const sc: Scale = topScale(w);
  if (polOf(w).decisions.length) lines.push(`Lo más grande en lo que has influido: ${SCALE_NAME[sc]}.`);
  return lines;
}
