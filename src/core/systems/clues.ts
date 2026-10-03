import { CLUE_TEXTS } from '../content/clues';
import { RESOURCES } from '../content/resources';
import { TECH_BY_ID } from '../content/techs';
import { hearsay, meet, observe } from '../intel';
import type { Clue, ClueKind, FactKey, Region } from '../types';
import { fill } from '../util';
import { direction, hops, nextId, totalTraffic, type Ctx } from '../world';
import { foundFragment, mysterySignal } from './mystery';

/**
 * Pistas indirectas: cada día llegan algunas observaciones sueltas sobre
 * regiones cercanas. Unas son ciertas, otras ruido. Nunca incluyen números.
 */
interface Signal {
  kind: ClueKind;
  strength: number;
  text?: string;
  fragment?: string;
}

const FACT_FOR: Partial<Record<ClueKind, FactKey>> = {
  militar: 'tension',
  hambre: 'alimento',
  ecologia: 'ecologia',
  animo: 'animo',
  construccion: 'investigacion',
};

function signalsOf(ctx: Ctx, r: Region): Signal[] {
  const { w } = ctx;
  const s: Signal[] = [];
  if (r.militancy > 0.45 || r.flags.guerra) s.push({ kind: 'militar', strength: r.flags.guerra ? 1.2 : r.militancy });
  if (r.research) s.push({ kind: 'construccion', strength: 0.55, text: ctx.rng.chance(0.5) ? TECH_BY_ID[r.research.tech].clue : undefined });
  if (r.food < 5) s.push({ kind: 'hambre', strength: 1 - r.food / 6 });
  if (r.ecology < 0.5) s.push({ kind: 'ecologia', strength: 0.8 - r.ecology, text: ctx.rng.chance(0.5) ? RESOURCES[r.resource].depleted : undefined });
  if (r.stability < 0.42) s.push({ kind: 'animo', strength: 0.6 - r.stability });
  if (r.flags.emigrando) s.push({ kind: 'migracion', strength: 0.7 });
  if (r.flags.fiebre) s.push({ kind: 'salud', strength: 0.8 });
  const traffic = totalTraffic(w, r.id);
  const prev = w.counters[`traffic_${r.id}`] ?? traffic * 100;
  if (Math.abs(traffic * 100 - prev) > 20) s.push({ kind: 'comercio', strength: 0.5 });
  w.counters[`traffic_${r.id}`] = Math.round(traffic * 100);
  const m = mysterySignal(ctx, r);
  if (m) s.push(m);
  return s;
}

export function tickClues(ctx: Ctx): void {
  const { w, rng } = ctx;
  const d = hops(w, w.player.home);
  const pool = w.regions.filter((r) => !r.isHome);
  let count = 2 + (w.player.priority === 'conocimiento' ? 1 : 0) + (rng.chance(0.5) ? 1 : 0);
  const chosen = new Set<number>();
  while (count-- > 0) {
    const r = rng.weighted(pool, (x) => (chosen.has(x.id) ? 0.05 : 1) * ((d[x.id] === 1 ? 1 : d[x.id] === 2 ? 0.5 : 0.2) + (w.intel[x.id].observerStationed ? 1.5 : 0) + x.attitude.trust * 0.3));
    if (!r) break;
    chosen.add(r.id);
    const signals = signalsOf(ctx, r);
    // Si el mundo ha visto tu fuerza, te ocultan más cosas (más ruido).
    const noise = 0.2 + Math.min(2, w.player.patterns.fuerza ?? 0) * 0.06 - (w.intel[r.id].observerStationed ? 0.12 : 0);
    if (!signals.length || rng.chance(noise)) addClue(ctx, r, misleading(ctx, r), false);
    else {
      const sig = rng.weighted(signals, (x) => x.strength)!;
      addClue(ctx, r, sig, true);
    }
  }
  // Observadores destacados envían informes fiables cada dos días.
  for (const r of pool) {
    const intel = w.intel[r.id];
    if (intel.observerStationed && (w.day - intel.lastObserved) >= 2) observe(ctx, r, w.player.priority === 'conocimiento' ? 0.9 : 0.7);
  }
  // Las pistas viejas se archivan.
  if (w.clues.length > 160) w.clues = w.clues.slice(-160);
}

function misleading(ctx: Ctx, r: Region): Signal {
  const kinds: ClueKind[] = ['ruido', 'ruido', 'militar', 'construccion', 'hambre'];
  return { kind: ctx.rng.pick(kinds), strength: 0.3 };
}

function addClue(ctx: Ctx, r: Region, sig: Signal, genuine: boolean): Clue {
  const { w, rng } = ctx;
  const bank = CLUE_TEXTS[sig.kind];
  const tpl = sig.text ?? (bank.length ? rng.pick(bank) : 'Algo extraño ocurre en {R}.');
  const clue: Clue = {
    id: nextId(w, 'p'),
    day: w.day,
    regionId: r.id,
    kind: sig.kind,
    text: fill(tpl, { R: r.name, dir: direction(w, r.id) }),
    genuine,
    fragment: sig.fragment,
    read: false,
  };
  w.clues.push(clue);
  meet(ctx, r);
  const key = FACT_FOR[sig.kind];
  if (key) hearsay(ctx, r, key, genuine ? 0.3 : 0.65);
  if (sig.fragment) foundFragment(ctx, sig.fragment);
  return clue;
}
