/**
 * Simulación sin interfaz para equilibrar el juego:
 *   npm run sim -- [semilla] [días] [estrategia]
 * Estrategias: pasivo | aleatorio
 */
import { ACTIONS, performAction, type Params } from '../src/core/actions';
import { createWorld } from '../src/core/gen/worldgen';
import { Rng } from '../src/core/rng';
import { advanceDay } from '../src/core/simulation';
import type { WorldState } from '../src/core/types';

const seed = Number(process.argv[2] ?? 1234);
const days = Number(process.argv[3] ?? 60);
const strategy = process.argv[4] ?? 'pasivo';

const w: WorldState = createWorld(seed);
const rng = new Rng(seed + 7);

function randomAction(w: WorldState): void {
  const regions = w.regions.filter((r) => !r.isHome);
  const r = rng.pick(regions);
  const id = rng.pick(Object.keys(ACTIONS));
  const def = ACTIONS[id];
  const p: Params = { region: r.id };
  if (def.target === 'par') {
    const nb = r.neighbors.filter((n) => !w.regions[n].isHome);
    if (!nb.length) return;
    p.other = rng.pick(nb);
    p.kind = 'ataque';
  }
  if (def.target === 'ruta') p.route = rng.int(0, w.routes.length - 1);
  if (def.target === 'rumor') {
    const ru = w.rumors.filter((x) => x.known);
    if (!ru.length) return;
    p.rumor = rng.pick(ru).id;
    p.claim = rng.chance(0.5) ? 'cierto' : 'falso';
  }
  if (id === 'prioridad' || id === 'ley') return;
  performAction(w, id, p);
}

console.log(`Semilla ${seed} · misterio: ${w.mystery.kind} · regiones: ${w.regions.map((r) => r.name).join(', ')}`);
for (let d = 0; d < days && !w.ended; d++) {
  if (strategy === 'aleatorio') for (let i = 0; i < 2; i++) randomAction(w);
  const rep = advanceDay(w);
  for (const e of w.entries.filter((e) => e.day === rep.day && e.importance >= 2)) console.log(`D${e.day} ${e.known ? ' ' : '?'} [${e.kind}] ${e.text}`);
}
console.log('\n--- Estado final ---');
for (const r of w.regions)
  console.log(
    `${r.name.padEnd(18)} pop ${Math.round(r.population).toString().padStart(5)} food ${r.food.toFixed(1).padStart(5)} eco ${r.ecology.toFixed(2)} stab ${r.stability.toFixed(2)} mil ${r.militancy.toFixed(2)} trust ${r.attitude.trust.toFixed(2)} techs ${r.techs.join(',')} ${Object.keys(r.flags).join(',')}`,
  );
console.log('Jugador', JSON.stringify(w.player));
console.log('Objetivos', w.objectives.map((o) => `${o.title}:${o.status}:${o.progress.toFixed(2)}${o.hidden ? '(oculto)' : ''}`).join(' | '));
console.log(`Entradas ${w.entries.length} · pistas ${w.clues.length} · rumores ${w.rumors.length} · fragmentos ${w.mystery.fragmentsFound.length} · guerras ${w.counters.wars ?? 0}`);
