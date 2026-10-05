import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { atlasOf, type NatureStock } from './atlas';
import { geoOf } from './geography';

/**
 * Ecosistemas: el bosque da madera y caza, el río y el mar dan peces, la
 * montaña da mineral. Lo que se saca se agota y, si se deja descansar (o se
 * protege por ley), se recupera. Un bosque talado sin medida da cada vez
 * menos; una mina vieja, menos hierro.
 */
const KEY = { lenador: 'bosque', pastor: 'caza', pescador: 'pesca', minero: 'mineral' } as const;

export function natureOf(w: WorldState, regionId: number): NatureStock {
  return (atlasOf(w).nature[regionId] ??= { bosque: 1, caza: 1, pesca: 1, mineral: 1 });
}

/** Cuánto de cada recurso cabe en la región (según su geografía). */
function capacity(w: WorldState, regionId: number, k: keyof NatureStock): number {
  const g = geoOf(w, regionId);
  const r = w.regions[regionId];
  switch (k) {
    case 'bosque': return 60 + g.mix.bosque * 900;
    case 'caza': return 30 + (g.mix.bosque + g.mix.llanura * 0.4) * 300;
    case 'pesca': return 30 + (g.coast ? 400 : 0) + (g.river ? 200 : 0) + g.mix.pantano * 300;
    case 'mineral': return 40 + g.mix.montana * 1200 + (r.resource === 'hierro' ? 500 : 0);
  }
}

/** Lo que rinde hoy el oficio que vive de la naturaleza (1 = todo lo que quiera). */
export function natureFactor(w: WorldState, regionId: number, role: string): number {
  if (!w.life?.atlas) return 1;
  const k = KEY[role as keyof typeof KEY];
  if (!k) return 1;
  const s = natureOf(w, regionId)[k];
  return 0.35 + 0.65 * Math.pow(clamp(s), 0.7);
}

/** Lo que se ha sacado hoy, se descuenta. */
export function harvestNature(w: WorldState, regionId: number, role: string, amount: number): void {
  if (!w.life?.atlas) return;
  const k = KEY[role as keyof typeof KEY];
  if (!k || amount <= 0) return;
  const n = natureOf(w, regionId);
  n[k] = clamp(n[k] - amount / capacity(w, regionId, k));
}

/** Cada día la naturaleza se recupera un poco (más si se protege y si la tierra está sana). */
export function natureDay(w: WorldState, regionId: number): void {
  const n = natureOf(w, regionId);
  const r = w.regions[regionId];
  const protectedLaw = w.life?.politics?.govs[regionId]?.laws.recursos === 'protegidos';
  const k = (protectedLaw ? 2 : 1) * (0.5 + r.ecology * 0.5);
  n.bosque = clamp(n.bosque + 0.0025 * k * (1 - n.bosque));
  n.caza = clamp(n.caza + 0.006 * k * (1 - n.caza) * (0.4 + n.bosque * 0.6));
  n.pesca = clamp(n.pesca + 0.008 * k * (1 - n.pesca));
  n.mineral = clamp(n.mineral + 0.0004 * (1 - n.mineral)); // el mineral casi no vuelve
  // La tierra lo nota: un bosque arrasado degrada la región (el motor lo ve).
  if (n.bosque < 0.3) r.ecology = clamp(r.ecology - 0.001);
}

export function describeNature(w: WorldState, regionId: number): string[] {
  const n = natureOf(w, regionId);
  const g = geoOf(w, regionId);
  const out: string[] = [];
  if (g.mix.bosque > 0.1) out.push(n.bosque > 0.7 ? 'Los bosques están espesos.' : n.bosque > 0.4 ? 'Se nota la tala en los bosques.' : 'Del bosque quedan tocones y claros.');
  if (g.coast || g.river) out.push(n.pesca > 0.6 ? 'Las aguas dan buena pesca.' : 'Los pescadores vuelven con poco.');
  if (g.mix.montana > 0.15) out.push(n.mineral > 0.6 ? 'Las vetas aún dan mineral.' : 'Las minas están casi agotadas.');
  if (n.caza < 0.4) out.push('Apenas se ve caza.');
  return out;
}
