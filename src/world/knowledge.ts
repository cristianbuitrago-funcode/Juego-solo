import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { TECH_BY_ID } from '../core/content/techs';
import { routeBetween } from '../core/world';
import type { Good } from './economy';
import { geoOf } from './geography';
import { folkById, logEvent, memorize, playerRegion } from './society';
import type { Folk, FolkRole } from './types';
import { atlasOf, type Know } from './atlas';
import { recordHist } from './history';
import { gain, story, type GainNote } from './identity';

/**
 * El conocimiento como recurso. Una técnica no es «+10 %»: la sabe alguien.
 * Se practica más cuanta más gente la aprende (escuela, gremios, sabios);
 * viaja con quien emigra, con los comerciantes y con el protagonista, que
 * puede aprenderla de quien la sabe y enseñarla en otro pueblo. Cuando una
 * técnica arraiga, la producción cambia de verdad.
 */
const FX: Record<string, Partial<Record<Good, number>>> = {
  terrazas: { trigo: 1.18, verdura: 1.12 },
  rotacion: { trigo: 1.06, verdura: 1.06, fruta: 1.06 },
  acequias: { trigo: 1.15, verdura: 1.2, fruta: 1.1 },
  telares: { ropa: 1.4 },
  fuelles: { herramientas: 1.3, armas: 1.3, hierro: 1.1 },
  remedios: { medicinas: 1.35 },
  salazon: { pescado: 1.08, carne: 1.08 },
};

/** Quién practica cada técnica (los que la enseñan y la llevan consigo). */
const CRAFT: Record<string, FolkRole[]> = {
  terrazas: ['campesino'], rotacion: ['campesino'], acequias: ['campesino'], telares: ['tejedor'], fuelles: ['artesano', 'minero'], remedios: ['sanadora'], salazon: ['pescador', 'comerciante'], empalizadas: ['guardia', 'carpintero'], senales: ['guardia', 'exploradora'],
};

export const techName = (id: string) => TECH_BY_ID[id]?.name ?? id;

export function knowOf(w: WorldState, regionId: number, tech: string): Know | undefined {
  return atlasOf(w).knows.find((k) => k.regionId === regionId && k.tech === tech);
}

/** Cuánto rinde un bien con lo que se sabe en el pueblo (y con el clima y la tierra para los cultivos). */
export function techFactor(w: WorldState, regionId: number, g: Good): number {
  if (!w.life?.atlas) return 1;
  const r = w.regions[regionId];
  let k = 1;
  for (const t of r.techs) {
    const fx = FX[t]?.[g];
    if (!fx) continue;
    const adoption = knowOf(w, regionId, t)?.adoption ?? 1;
    // Las terrazas solo sirven donde hay laderas.
    const fit = t === 'terrazas' ? clamp(geoOf(w, regionId).mix.montana * 3) : 1;
    k *= 1 + (fx - 1) * adoption * fit;
  }
  if (g === 'trigo' || g === 'verdura' || g === 'fruta') k *= geoOf(w, regionId).farm;
  return k;
}

export function startKnow(w: WorldState, regionId: number, tech: string, from: number | undefined, carrier: Folk | undefined, how: string): Know {
  const a = atlasOf(w);
  const k: Know = { tech, regionId, adoption: 0.05, carriers: carrier ? [carrier.id] : [], from, since: w.day };
  a.knows.push(k);
  const text = `${how} ${techName(tech)} a ${w.regions[regionId].name}.`;
  logEvent(w, regionId, 'tecnica', text, carrier ? [carrier.id] : []);
  recordHist(w, { kind: 'descubrimiento', regionId, text, importance: 2, fame: 0.35, witnessed: playerRegion(w) === regionId || regionId === w.player.home });
  return k;
}

/** Un día de conocimiento: se practica, se enseña, se difunde. */
export function knowledgeDay(w: WorldState): void {
  const a = atlasOf(w);
  const rng = new Rng(hashString(`saber:${w.seed}:${w.day}`));
  // Las técnicas que el motor ya conoce tienen quien las practique.
  for (const r of w.regions) for (const t of r.techs) {
    let k = knowOf(w, r.id, t);
    if (!k) {
      k = { tech: t, regionId: r.id, adoption: 0.4, carriers: [], since: w.day };
      a.knows.push(k);
    }
  }
  for (const k of a.knows) {
    const r = w.regions[k.regionId];
    const school = w.life?.politics?.govs[k.regionId]?.laws.educacion === 'escuela' ? 1.6 : 1;
    k.adoption = clamp(k.adoption + 0.012 * school * (0.3 + k.adoption) * (1 - k.adoption));
    // Quien la practica (y puede enseñarla o llevársela).
    k.carriers = k.carriers.filter((id) => {
      const f = folkById(w, id);
      return f?.alive && f.regionId === k.regionId;
    });
    if (k.carriers.length < 3 && rng.chance(0.2 * k.adoption)) {
      const roles = CRAFT[k.tech] ?? [];
      const cand = w.life!.folk.find((f) => f.alive && f.regionId === k.regionId && f.age >= 16 && roles.includes(f.role) && !k.carriers.includes(f.id));
      if (cand) k.carriers.push(cand.id);
    }
    // Cuando arraiga, el motor la cuenta como propia.
    if (k.adoption >= 0.35 && !r.techs.includes(k.tech)) {
      r.techs.push(k.tech);
      recordHist(w, { kind: 'descubrimiento', regionId: k.regionId, text: `En ${r.name} ya se practica ${techName(k.tech)}${k.from !== undefined ? `, que llegó de ${w.regions[k.from].name}` : ''}.`, importance: 2, fame: 0.4, witnessed: k.regionId === w.player.home || playerRegion(w) === k.regionId });
    }
  }
  // De boca en boca: los comerciantes hablan de lo que han visto en otros pueblos.
  if (w.day % 3 === 0) for (const r of w.regions) for (const nb of r.neighbors) {
    for (const t of w.regions[nb].techs) {
      if (r.techs.includes(t) || knowOf(w, r.id, t)) continue;
      const route = routeBetween(w, r.id, nb);
      if (!route || route.status !== 'abierta' || !rng.chance(0.003 * (0.3 + route.traffic))) continue;
      startKnow(w, r.id, t, nb, undefined, `Los comerciantes de ${w.regions[nb].name} enseñan`);
    }
  }
}

/** Quien emigra se lleva lo que sabe (lo llama arcs.migrate). */
export function carryKnowledge(w: WorldState, f: Folk, from: number, to: number): void {
  if (!w.life?.atlas) return;
  for (const k of atlasOf(w).knows.filter((x) => x.regionId === from && x.carriers.includes(f.id))) {
    const there = knowOf(w, to, k.tech);
    if (there) {
      if (!there.carriers.includes(f.id)) there.carriers.push(f.id);
      there.adoption = clamp(there.adoption + 0.05);
      continue;
    }
    if (w.regions[to].techs.includes(k.tech)) continue;
    startKnow(w, to, k.tech, from, f, `${f.name}, que llegó de ${w.regions[from].name}, trae`);
  }
}

/** Lo que se puede aprender de alguien (si practica una técnica que el jugador no sabe). */
export function techsOfFolk(w: WorldState, f: Folk): string[] {
  if (!w.life?.atlas) return [];
  return atlasOf(w).knows.filter((k) => k.carriers.includes(f.id) && !atlasOf(w).playerTechs.includes(k.tech)).map((k) => k.tech);
}

export function learnTech(w: WorldState, f: Folk, tech: string): { lines: string[]; notes: GainNote[] } {
  const a = atlasOf(w);
  if (!a.playerTechs.includes(tech)) a.playerTechs.push(tech);
  memorize(w, f, { kind: 'leccion', about: 'jugador', text: `Le enseñé ${techName(tech)}.`, w: 0.3, src: 'propio' });
  w.life!.clock += 180;
  story(w, `Aprendió ${techName(tech)} de ${f.name}.`, 'conocimiento');
  return { lines: [`${f.name} te enseña ${techName(tech)}. Ahora podrías llevarlo a otros pueblos.`], notes: gain(w, 'k:tecnologia', 1) };
}

/** Enseñar una técnica en un pueblo que no la conoce: el protagonista también hace viajar el saber. */
export function teachTech(w: WorldState, f: Folk, tech: string): string {
  const r = w.regions[f.regionId];
  const k = knowOf(w, f.regionId, tech);
  if (k) {
    if (!k.carriers.includes(f.id)) k.carriers.push(f.id);
    k.adoption = clamp(k.adoption + 0.1);
    return `${f.name} ya había oído hablar de ello, pero contigo lo entiende mejor.`;
  }
  if (r.techs.includes(tech)) return 'Aquí eso ya lo saben.';
  const home = w.player.home;
  const nk = startKnow(w, f.regionId, tech, home === f.regionId ? undefined : home, f, `${w.life!.player.name === 'Sin nombre' ? 'El forastero' : w.life!.player.name} enseña`);
  nk.adoption = 0.12;
  story(w, `Llevó ${techName(tech)} a ${r.name}.`, 'logro');
  w.life!.politics?.legacy.push({ day: w.day, gen: w.life!.player.generation, by: w.life!.player.name, kind: 'ruta', regionId: f.regionId, text: `Llevó ${techName(tech)} a ${r.name}.` });
  return `${f.name} te mira trabajar, pregunta, lo intenta. Al final del día ya lo ha entendido. Se lo contará a otros.`;
}

/** Lo que se sabe en un pueblo, en palabras. */
export function describeKnowledge(w: WorldState, regionId: number): string[] {
  return atlasOf(w).knows.filter((k) => k.regionId === regionId).map((k) => `${techName(k.tech).charAt(0).toUpperCase()}${techName(k.tech).slice(1)}: ${k.adoption > 0.7 ? 'lo sabe todo el mundo' : k.adoption > 0.35 ? 'se practica bastante' : 'lo saben unos pocos'}.`);
}
