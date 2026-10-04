/** Estadísticas de muchas partidas pasivas (para equilibrar). npm exec vite-node scripts/stats.ts [n] */
import { createWorld } from '../src/core/gen/worldgen';
import { advanceDay } from '../src/core/simulation';

const n = Number(process.argv[2] ?? 20);
let wars = 0, hunger = 0, techs = 0, auto = 0, degraded = 0, transformed = 0, frags = 0, disputes = 0, hidden = 0, total = 0;
const perSeed: string[] = [];
for (let s = 1; s <= n; s++) {
  const w = createWorld(s * 7919);
  while (!w.ended) advanceDay(w);
  const ws = w.counters.wars ?? 0;
  wars += ws;
  hunger += w.entries.filter((e) => e.text.startsWith('El hambre llega')).length;
  techs += w.entries.filter((e) => e.text.includes(' desarrolló ')).length;
  auto += w.regions.filter((r) => r.autonomous).length;
  degraded += w.entries.filter((e) => e.text.includes('se degrada')).length;
  transformed += w.entries.filter((e) => e.text.startsWith('El mundo ha cambiado')).length;
  disputes += w.entries.filter((e) => e.text.startsWith('Disputa')).length;
  frags += w.mystery.fragmentsFound.length;
  hidden += w.entries.filter((e) => !e.known).length;
  total += w.entries.length;
  perSeed.push(`${w.mystery.kind}:${ws}`);
}
const avg = (x: number) => (x / n).toFixed(2);
console.log(`guerras ${avg(wars)} · hambres ${avg(hunger)} · inventos ${avg(techs)} · autónomas ${avg(auto)} · degradaciones ${avg(degraded)} · transformaciones ${avg(transformed)} · disputas ${avg(disputes)} · fragmentos ${avg(frags)} · ocultas ${(hidden / total * 100).toFixed(0)}%`);
console.log(perSeed.join(' '));
