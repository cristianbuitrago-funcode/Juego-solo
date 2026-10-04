/**
 * Fachada del núcleo para la interfaz. La UI nunca modifica el mundo
 * directamente: llama a estas funciones.
 */
import { record } from './chronicle';
import { createHypothesis, type HypoSpec } from './systems/hypotheses';
import { conclude, foundFragment } from './systems/mystery';
import type { Rumor, WorldState } from './types';
import { commitCtx, makeCtx } from './world';

export { ACTIONS, ACTION_LEVEL, AUTHORITY_NAMES, answerPetition, authorityReason, hasAuthority, freeAgents, performAction, talkTo, type ActionDef, type Params } from './actions';
export { createWorld } from './gen/worldgen';
export { advanceDay, continueEra, eraTitle, type DayReport } from './simulation';

export function proposeHypothesis(w: WorldState, spec: HypoSpec): string {
  const ctx = makeCtx(w);
  const h = createHypothesis(ctx, spec);
  record(ctx, { kind: 'descubrimiento', text: `Formulaste una hipótesis: ${h.text}`, regions: [spec.regionId], known: true });
  commitCtx(ctx);
  return h.text;
}

export function formConclusion(w: WorldState, optionId: string): ReturnType<typeof conclude> {
  const ctx = makeCtx(w);
  const r = conclude(ctx, optionId);
  commitCtx(ctx);
  return r;
}

/** Pares de rumores conocidos que se contradicen o se reflejan (A teme a B y B teme a A). */
export function contradictions(w: WorldState): [Rumor, Rumor][] {
  const known = w.rumors.filter((r) => r.known && (r.kind === 'ataque' || r.kind === 'traicion'));
  const out: [Rumor, Rumor][] = [];
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) {
      const a = known[i];
      const b = known[j];
      if (a.about === b.target && b.about === a.target && Math.abs(a.day - b.day) <= 3) out.push([a, b]);
    }
  return out;
}

/** Comparar dos testimonios: puede revelar un fragmento de la verdad oculta. */
export function compareRumors(w: WorldState, aId: string, bId: string): string {
  const a = w.rumors.find((r) => r.id === aId);
  const b = w.rumors.find((r) => r.id === bId);
  if (!a || !b) return 'No encuentras esos testimonios.';
  const key = `cmp_${[aId, bId].sort().join('_')}`;
  if (w.counters[key]) return 'Ya comparaste estos testimonios.';
  w.counters[key] = 1;
  const ctx = makeCtx(w);
  let msg: string;
  if (a.origin === 'manipulador' && b.origin === 'manipulador' && w.mystery.kind === 'manipulador') {
    foundFragment(ctx, 'm_cruzados');
    msg = 'Los dos rumores aparecieron casi a la vez y se reflejan como en un espejo. Demasiada casualidad: alguien los sembró.';
  } else if (a.truth !== b.truth) msg = 'Los testimonios no encajan: al menos uno de los dos es falso. Investigar uno de ellos aclararía el otro.';
  else if (!a.truth && !b.truth) msg = 'Ambos pueblos se temen mutuamente. Quizás los dos estén equivocados.';
  else msg = 'Ambos testimonios parecen coherentes entre sí. Puede que la tensión sea real en los dos lados.';
  record(ctx, { kind: 'informacion', text: `Comparaste testimonios: ${msg}`, regions: [a.about, b.about], known: true });
  commitCtx(ctx);
  return msg;
}
