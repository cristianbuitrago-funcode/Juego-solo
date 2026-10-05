import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { CULTURES } from '../core/content/cultures';
import { personName } from '../core/content/names';
import { TECHS } from '../core/content/techs';
import { GOODS, marketOf, type Good } from './economy';
import { stanceOf, STANCE_WORD } from './diplomacy';
import { logEvent, playerRegion } from './society';
import { recordHist } from './history';
import { atlasOf, aid, type Realm } from './atlas';
import { GOV, type GovSystem } from './polstate';
import { govOf } from './politics';
import { knowOf, techName } from './knowledge';

/**
 * Estados: los pueblos que comparten dueño (por conquista o pacto) o
 * federación forman una entidad política con nombre, capital, gobierno,
 * población, riqueza, ejército y relaciones. Más allá del mar hay tierras
 * lejanas —reinos que no se pisan pero existen— con los que se puede
 * contactar, comerciar, aprender… o sufrir un saqueo.
 */
export interface State {
  id: string;
  name: string;
  regions: number[];
  capital: number;
  system: GovSystem;
  population: number;
  wealth: number;
  army: number;
  cultures: string[];
}

const PREFIX: Record<GovSystem, string> = {
  monarquia: 'Reino de', republica: 'República de', federacion: 'Federación de', militar: 'Protectorado de', consejo: 'Liga de', familias: 'Señorío de', tribal: 'Tribus de', ciudad: 'Ciudad libre de', autonoma: 'Comunidad de', confederacion: 'Confederación de', alcalde: 'Villa de',
};

export function statesOf(w: WorldState): State[] {
  const pol = w.life?.politics;
  const owner = (id: number) => pol?.owner[id] ?? id;
  const groups = new Map<string, number[]>();
  for (const r of w.regions) {
    const fed = pol?.govs[r.id]?.federation;
    const key = fed ? `f:${fed}` : `r:${owner(r.id)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r.id);
  }
  const out: State[] = [];
  for (const [key, regions] of groups) {
    const capital = key.startsWith('r:') ? Number(key.slice(2)) : regions.sort((a, b) => w.regions[b].population - w.regions[a].population)[0];
    const g = govOf(w, capital);
    const fedName = key.startsWith('f:') ? pol?.federations.find((f) => `f:${f.id}` === key)?.name : undefined;
    const single = regions.length === 1;
    const name = fedName ?? (single && (g.system === 'consejo' || g.system === 'alcalde') ? w.regions[capital].name : `${PREFIX[g.system]} ${w.regions[capital].name}`);
    out.push({
      id: key,
      name,
      regions,
      capital,
      system: g.system,
      population: Math.round(regions.reduce((s, id) => s + w.regions[id].population, 0) + atlasOf(w).settlements.filter((x) => regions.includes(x.regionId) && x.state === 'vivo').reduce((s, x) => s + x.people, 0)),
      wealth: Math.round(regions.reduce((s, id) => s + (w.life?.society ? marketOf(w, id).treasury + marketOf(w, id).cash * 0.2 : 0), 0)),
      army: Math.round(regions.reduce((s, id) => s + w.regions[id].population * 0.035 * (0.5 + w.regions[id].militancy), 0)),
      cultures: [...new Set(regions.map((id) => w.regions[id].culture))],
    });
  }
  return out;
}

/** Cómo se llevan dos estados (lo peor que pasa entre sus pueblos vecinos). */
export function stateRelation(w: WorldState, a: State, b: State): string {
  const order = ['guerra', 'rivalidad', 'tension', 'neutralidad', 'amistad', 'alianza'];
  let worst = 'neutralidad';
  for (const x of a.regions) for (const y of b.regions) {
    if (!w.regions[x].relations[y]) continue;
    const st = stanceOf(w, x, y);
    if (order.indexOf(st) < order.indexOf(worst)) worst = st;
  }
  return STANCE_WORD[worst as keyof typeof STANCE_WORD];
}

export function describeStates(w: WorldState): string[] {
  return statesOf(w).filter((s) => s.regions.some((r) => w.intel[r].level > 0 || w.regions[r].isHome)).map((s) => `${s.name}: ${s.regions.length > 1 ? `${s.regions.length} territorios` : 'un territorio'}, ${GOV[s.system].name}, unas ${Math.round(s.population / 50) * 50} almas${s.army > 60 ? ', ejército grande' : ''}.`);
}

// ---------------------------------------------------------------------------
// Tierras lejanas (más allá del mar)
// ---------------------------------------------------------------------------
const SYSTEMS = ['un rey', 'una reina', 'un consejo de mercaderes', 'un emperador', 'las tribus', 'una asamblea'];

export function ensureRealms(w: WorldState): void {
  const a = atlasOf(w);
  if (a.realms.length) return;
  const rng = new Rng(hashString(`lejos:${w.seed}`));
  const used = new Set(w.cultures.map((c) => c.id));
  const pool = CULTURES.filter((c) => !used.has(c.id));
  const n = 3 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const c = pool[i % Math.max(1, pool.length)] ?? CULTURES[i % CULTURES.length];
    const name = personName(rng, c.syllables, new Set(a.realms.map((r) => r.name)));
    const ex = rng.shuffle([...GOODS].filter((g) => g !== 'semillas')).slice(0, 2) as Good[];
    const im = rng.shuffle([...GOODS].filter((g) => !ex.includes(g))).slice(0, 2) as Good[];
    a.realms.push({ id: aid(w, 'rl'), name, people: c.adjective, culture: c.id, government: rng.pick(SYSTEMS), power: rng.range(0.3, 0.9), exports: ex, imports: im, techs: rng.shuffle(TECHS.map((t) => t.id)).slice(0, 2), attitude: rng.range(-0.3, 0.6), ruler: personName(rng, c.syllables, new Set()), history: [] });
  }
}

/** Un año (o unos días) en las tierras lejanas, y lo que llega de ellas por mar. */
export function realmsDay(w: WorldState, rng: Rng): string[] {
  const a = atlasOf(w);
  const out: string[] = [];
  const ports = Object.keys(a.ports).map(Number);
  // Sus propias historias (que llegan como noticias si hay contacto).
  if (w.day % 20 === 0) for (const r of a.realms) {
    r.power = clamp(r.power + rng.range(-0.08, 0.08));
    if (rng.chance(0.15)) {
      const text = rng.chance(0.5) ? `En ${r.name} hay ${rng.pick(['un nuevo soberano', 'guerra con sus vecinos', 'una gran hambruna', 'una cosecha nunca vista'])}.` : `${r.ruler}, de ${r.name}, ha muerto; le sucede ${personName(rng, CULTURES.find((c) => c.id === r.culture)?.syllables ?? ['a', 'na'], new Set())}.`;
      r.history.push({ day: w.day, text });
      if (r.contact !== undefined && ports.length) logEvent(w, ports[0], 'lejos', `Dicen los marineros: ${text.charAt(0).toLowerCase()}${text.slice(1)}`, []);
    }
  }
  if (!ports.length) return out;
  // Primer contacto: algo raro y memorable.
  for (const r of a.realms) {
    if (r.contact !== undefined || !rng.chance(0.004)) continue;
    r.contact = w.day;
    const port = rng.pick(ports);
    const text = `Llega a ${w.regions[port].name} un barco de ${r.name}, una tierra de la que nadie había oído hablar. Los gobierna ${r.government}.`;
    logEvent(w, port, 'lejos', text, []);
    recordHist(w, { kind: 'descubrimiento', regionId: port, text, importance: 3, fame: 0.7, witnessed: true });
    out.push(text);
    break;
  }
  // Comercio, saberes y gente de las tierras con las que hay contacto.
  for (const r of a.realms.filter((x) => x.contact !== undefined)) {
    const port = ports[(hashString(r.id) >>> 0) % ports.length];
    const m = marketOf(w, port);
    if (w.day % 3 === 0 && r.attitude > -0.3) {
      for (const g of r.exports) m.stock[g] += 1.5 * r.power;
      for (const g of r.imports) {
        const n = Math.min(m.stock[g] * 0.05, 2);
        m.stock[g] -= n;
        m.cash += n * m.price[g] * 1.1;
      }
    }
    // Sus técnicas llegan con sus marineros.
    for (const t of r.techs) if (!w.regions[port].techs.includes(t) && !knowOf(w, port, t) && rng.chance(0.002)) {
      a.knows.push({ tech: t, regionId: port, adoption: 0.06, carriers: [], since: w.day });
      const text = `Los marineros de ${r.name} enseñan en ${w.regions[port].name} ${techName(t)}.`;
      recordHist(w, { kind: 'descubrimiento', regionId: port, text, importance: 2, fame: 0.4, witnessed: playerRegion(w) === port });
    }
    // Un saqueo (muy raro): si les tratamos mal y son fuertes.
    if (r.attitude < -0.4 && r.power > 0.7 && rng.chance(0.002)) {
      for (const g of GOODS) m.stock[g] *= 0.6;
      m.treasury *= 0.4;
      const t = w.life!.towns[port];
      if (t && t.houses > 3) t.burned.push(t.houses - 1);
      const text = `Barcos de ${r.name} saquean ${w.regions[port].name}.`;
      recordHist(w, { kind: 'guerra', regionId: port, text, importance: 3, fame: 0.6, witnessed: true });
      out.push(text);
    }
    r.attitude = clamp(r.attitude + (rng.range(-0.01, 0.012)), -1, 1);
  }
  return out;
}

export function describeRealms(w: WorldState): string[] {
  return atlasOf(w).realms.filter((r) => r.contact !== undefined).map((r: Realm) => `${r.name} (gente ${r.people}): los gobierna ${r.government}. Venden ${r.exports.join(' y ')}; compran ${r.imports.join(' y ')}. ${r.attitude > 0.3 ? 'Nos tienen aprecio.' : r.attitude < -0.3 ? 'No se fían de nosotros.' : ''}`);
}
