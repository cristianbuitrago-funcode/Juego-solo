import type { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { seasonOf } from './clock';
import { FOODS, GOODS, marketOf } from './economy';
import { farmOf } from './farming';
import { geoOf, weatherIn } from './geography';
import { getLayout } from './layout';
import { natureOf } from './nature';
import { stanceOf } from './diplomacy';
import { logEvent, playerRegion } from './society';
import { recordHist } from './history';
import { addPoi } from './settlements';
import { atlasOf, aid, type Disaster } from './atlas';

/**
 * Desastres que salen de la geografía y del clima, no de una tirada al azar:
 * el río se desborda tras días de lluvia, el bosque arde en un verano seco,
 * la ladera talada se viene abajo con la tormenta, la montaña tiembla, el
 * volcán despierta. Después viene lo importante: la reconstrucción, la ayuda
 * (o no) de los vecinos, y quien decide irse para siempre.
 */
export const DISASTER_NAME: Record<Disaster['kind'], string> = { inundacion: 'inundación', incendio: 'incendio', terremoto: 'terremoto', tormenta: 'gran tormenta', deslizamiento: 'deslizamiento de tierra', erupcion: 'erupción', sequia: 'sequía' };

const wet = (w: WorldState, id: number, d: number) => {
  const x = weatherIn(w, id, d);
  return x === 'lluvia' || x === 'tormenta';
};

export function disastersDay(w: WorldState, rng: Rng): string[] {
  const a = atlasOf(w);
  const out: string[] = [];
  const season = seasonOf(w.day);
  for (const r of w.regions) {
    if (a.disasters.some((d) => d.regionId === r.id && d.recovered < 0.6)) continue;
    const g = geoOf(w, r.id);
    const n = natureOf(w, r.id);
    const rainDays = [0, 1, 2].filter((k) => wet(w, r.id, w.day - k)).length;
    const today = weatherIn(w, r.id);
    let kind: Disaster['kind'] | null = null;
    let sev = 0;
    if (g.river && rainDays === 3 && rng.chance(0.05)) (kind = 'inundacion'), (sev = rng.range(0.3, 0.8));
    else if (g.mix.bosque > 0.2 && season === 'verano' && (g.climate === 'calido' || g.climate === 'arido') && rainDays === 0 && rng.chance(0.012 * n.bosque)) (kind = 'incendio'), (sev = rng.range(0.3, 0.9));
    // La ladera sin árboles no sujeta la tierra: talar tiene consecuencias.
    else if (g.mix.montana > 0.2 && rainDays >= 2 && n.bosque < 0.45 && rng.chance(0.04 * (1 - n.bosque))) (kind = 'deslizamiento'), (sev = rng.range(0.3, 0.7));
    else if (g.coast && today === 'tormenta' && rng.chance(0.02)) (kind = 'tormenta'), (sev = rng.range(0.2, 0.6));
    else if (g.mix.montana > 0.3 && rng.chance(0.0006)) (kind = 'terremoto'), (sev = rng.range(0.3, 0.9));
    else if (g.volcano && rng.chance(0.0004)) (kind = 'erupcion'), (sev = rng.range(0.6, 1));
    if (kind) out.push(...strike(w, r.id, kind, sev));
  }
  recoverDay(w, rng, out);
  return out;
}

/** Lo que hace un desastre (también se puede provocar desde una prueba). */
export function strike(w: WorldState, regionId: number, kind: Disaster['kind'], sev: number): string[] {
  const a = atlasOf(w);
  const r = w.regions[regionId];
  const m = marketOf(w, regionId);
  const t = w.life!.towns[regionId];
  const f = farmOf(w, regionId);
  const n = natureOf(w, regionId);
  const dead = Math.round(r.population * sev * (kind === 'erupcion' ? 0.08 : kind === 'terremoto' ? 0.04 : 0.015));
  r.population = Math.max(20, r.population - dead);
  const lost = kind === 'incendio' || kind === 'terremoto' || kind === 'erupcion' ? 0.5 : 0.3;
  for (const gd of GOODS) m.stock[gd] *= 1 - lost * sev;
  if (t) for (let i = 0; i < Math.round(sev * (kind === 'tormenta' ? 2 : 4)); i++) {
    const slot = t.houses - 1 - i;
    if (slot > 0 && !t.burned.includes(slot)) t.burned.push(slot);
  }
  if (kind === 'inundacion' || kind === 'deslizamiento' || kind === 'erupcion') f.growth = clamp(f.growth - sev * 0.6);
  if (kind === 'inundacion') f.soil = clamp(f.soil + 0.05); // el limo deja la tierra más fértil
  if (kind === 'erupcion') f.soil = clamp(f.soil + 0.1); // y la ceniza, con los años, también
  if (kind === 'incendio') n.bosque = clamp(n.bosque - sev * 0.5), (n.caza = clamp(n.caza - sev * 0.3));
  r.stability = clamp(r.stability - sev * 0.15);
  const what = DISASTER_NAME[kind];
  const text = {
    inundacion: `El río se desborda en ${r.name}: el agua entra en las casas y se lleva los campos.`,
    incendio: `Arde el bosque de ${r.name}. El humo se ve desde muy lejos.`,
    terremoto: `La tierra tiembla en ${r.name}. Se caen muros y tejados.`,
    tormenta: `Una gran tormenta golpea la costa de ${r.name}: barcas rotas, tejados por el aire.`,
    deslizamiento: `Se viene abajo la ladera de ${r.name}${natureOf(w, regionId).bosque < 0.3 ? ': sin árboles, nada sujetaba la tierra' : ''}.`,
    erupcion: `¡La montaña de ${r.name} escupe fuego! La ceniza lo cubre todo.`,
    sequia: `Una sequía terrible en ${r.name}.`,
  }[kind] + (dead > 0 ? ` Mueren unas ${dead} personas.` : '');
  const d: Disaster = { id: aid(w, 'ds'), kind, regionId, day: w.day, severity: sev, recovered: 0, aidFrom: [], text };
  a.disasters.push(d);
  if (a.disasters.length > 40) a.disasters.splice(0, a.disasters.length - 40);
  logEvent(w, regionId, 'desastre', text, []);
  recordHist(w, { kind: 'crisis', regionId, text, importance: sev > 0.6 ? 3 : 2, fame: 0.4 + sev * 0.4, witnessed: playerRegion(w) === regionId || r.isHome });
  if (sev > 0.75 && (kind === 'erupcion' || kind === 'terremoto')) {
    // Una piedra con los nombres, junto a la plaza del pueblo.
    const v = getLayout(w).villages[regionId];
    addPoi(w, { kind: 'monumento', name: `Piedra de la ${what}`, regionId, x: Math.round(v.cx + v.plazaR + 3), y: Math.round(v.cy), text: `Una piedra con nombres grabados: los que murieron en la ${what} del año ${Math.floor((w.day - 1) / 20) + 1}.` });
  }
  return playerRegion(w) === regionId || r.isHome || sev > 0.6 ? [text] : [];
}

/** Reconstruir: con dinero propio, con ayuda de los vecinos amigos, o yéndose. */
function recoverDay(w: WorldState, rng: Rng, out: string[]): void {
  const a = atlasOf(w);
  for (const d of a.disasters) {
    if (d.recovered >= 1) continue;
    const r = w.regions[d.regionId];
    const m = marketOf(w, d.regionId);
    // Los vecinos amigos mandan comida y madera (una vez).
    if (w.day - d.day === 2) for (const nb of r.neighbors) {
      const st = stanceOf(w, d.regionId, nb);
      if (st !== 'amistad' && st !== 'alianza') continue;
      const mm = marketOf(w, nb);
      for (const g of [...FOODS, 'madera' as const]) {
        const give = Math.min(mm.stock[g] * 0.1, 6);
        mm.stock[g] -= give;
        m.stock[g] += give;
      }
      d.aidFrom.push(nb);
      const rel = r.relations[nb];
      if (rel) rel.opinion = clamp(rel.opinion + 0.1, -1, 1); // la ayuda no se olvida
      logEvent(w, d.regionId, 'ayuda', `Llegan carros de ${w.regions[nb].name} con comida y madera para los damnificados.`, []);
    }
    const pay = Math.min(m.treasury, 3);
    m.treasury -= pay;
    d.recovered = clamp(d.recovered + 0.01 + pay * 0.004 + d.aidFrom.length * 0.004 + r.stability * 0.006);
    // Si tarda mucho y fue muy grave, parte de la gente se va para siempre.
    if (!d.abandoned && d.severity > 0.65 && w.day - d.day > 15 && d.recovered < 0.35 && rng.chance(0.2)) {
      d.abandoned = true;
      const gone = Math.round(r.population * 0.12);
      r.population -= gone;
      const text = `Tras la ${DISASTER_NAME[d.kind]}, unas ${gone} personas dejan ${r.name} para no volver.`;
      logEvent(w, d.regionId, 'migracion', text, []);
      recordHist(w, { kind: 'pueblo', regionId: d.regionId, text, importance: 2, fame: 0.35, witnessed: playerRegion(w) === d.regionId });
      out.push(text);
    }
    if (d.recovered >= 1) {
      const text = `${r.name} se ha levantado de la ${DISASTER_NAME[d.kind]}${d.aidFrom.length ? `, con ayuda de ${d.aidFrom.map((x) => w.regions[x].name).join(' y ')}` : ', sin ayuda de nadie'}.`;
      logEvent(w, d.regionId, 'pueblo', text, []);
      if (playerRegion(w) === d.regionId) out.push(text);
    }
  }
}

export function describeDisasters(w: WorldState, regionId: number): string[] {
  return atlasOf(w).disasters.filter((d) => d.regionId === regionId).slice(-3).map((d) => `Año ${Math.floor((d.day - 1) / 20) + 1}: ${DISASTER_NAME[d.kind]}${d.recovered < 1 ? ` (se recupera: ${Math.round(d.recovered * 100)}%)` : ''}.`);
}
