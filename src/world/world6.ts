import { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { natureDay } from './nature';
import { knowledgeDay } from './knowledge';
import { ensurePois, settlementsDay } from './settlements';
import { roadsDay } from './roads';
import { ensureRealms, realmsDay } from './states';
import { disastersDay } from './disasters';
import { epochsDay } from './epochs';
import { aimsDay } from './aims';
import { cultureOf } from './culture';
import { playerRegion } from './society';
import { atlasOf } from './atlas';

/**
 * Un día del mundo completo (Fase 6). Todo está conectado: la geografía
 * decide el clima y lo que da la tierra; los recursos se gastan y se
 * recuperan; las técnicas viajan con la gente; la gente funda lugares
 * nuevos y abandona otros; los caminos usados mejoran y los olvidados se
 * pierden; la costa levanta puertos y el mar trae tierras lejanas; la
 * naturaleza a veces golpea; los años se agrupan en épocas con nombre.
 * Corre siempre, esté donde esté el protagonista, y no usa el azar del motor.
 */
export function atlasDay(w: WorldState): string[] {
  if (!w.life?.society) return [];
  const a = atlasOf(w);
  const rng = new Rng((w.seed ^ Math.imul(w.day, 0x3b9a73c9) ^ 0xa71a5) >>> 0);
  ensurePois(w);
  ensureRealms(w);
  for (const r of w.regions) natureDay(w, r.id);
  knowledgeDay(w);
  const out = [...settlementsDay(w, rng), ...roadsDay(w, rng), ...disastersDay(w, rng), ...realmsDay(w, rng), ...epochsDay(w, rng), ...aimsDay(w)];
  // Oír una lengua a diario es la mejor manera de aprenderla.
  const here = playerRegion(w);
  if (here >= 0) {
    const c = cultureOf(w, here).id;
    a.exposure[c] = (a.exposure[c] ?? 0) + 1;
  }
  return [...new Set(out)];
}
