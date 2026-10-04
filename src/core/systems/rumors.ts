import { record } from '../chronicle';
import type { EntryId, RegionId, Rumor, RumorKind } from '../types';
import { clamp, fill } from '../util';
import { hops, nextId, routeBetween, type Ctx } from '../world';
import { techMult } from './economy';

/**
 * Rumores: información que puede ser cierta, falsa o un malentendido.
 * Las regiones que creen un rumor actúan en consecuencia (miedo, tensión,
 * menos comercio), así que un rumor falso puede convertirse en verdad.
 */
const TEMPLATES: Record<RumorKind, string[]> = {
  ataque: ['Dicen que {A} está preparando un ataque contra {B}.', 'Se cuenta que {A} reúne gente armada cerca de {B}.'],
  traicion: ['Se cuenta que {A} planea traicionar a {B}.', 'Dicen que {A} negocia en secreto contra {B}.'],
  hambre: ['Dicen que en {A} ya no queda comida.', 'Se cuenta que {A} raciona el pan.'],
  riqueza: ['Se dice que {A} esconde graneros llenos.', 'Dicen que {A} se ha hecho rica con el comercio.'],
  tecnologia: ['Se rumorea que {A} fabrica algo que cambiará el mundo.', 'Dicen que en {A} han descubierto un secreto.'],
  enfermedad: ['Dicen que en {A} hay una fiebre contagiosa.', 'Se cuenta que nadie debería comerciar con {A}: hay enfermedad.'],
};

export interface RumorSpec {
  kind: RumorKind;
  about: RegionId;
  target?: RegionId;
  heardIn: RegionId;
  truth: boolean;
  origin: Rumor['origin'];
  believers: RegionId[];
  causeId?: EntryId;
  forceKnown?: boolean;
}

export function createRumor(ctx: Ctx, s: RumorSpec): Rumor {
  const { w, rng } = ctx;
  const A = w.regions[s.about].name;
  const B = s.target !== undefined ? w.regions[s.target].name : 'sus vecinos';
  const text = fill(rng.pick(TEMPLATES[s.kind]), { A, B });
  const e = record(ctx, { kind: 'informacion', text: `Un rumor se extiende: «${text}»`, regions: [s.about, ...(s.target !== undefined ? [s.target] : [])], causeId: s.causeId, known: false, byPlayer: s.origin === 'jugador' });
  const rumor: Rumor = {
    id: nextId(w, 'r'),
    day: w.day,
    kind: s.kind,
    about: s.about,
    target: s.target,
    heardIn: s.heardIn,
    text,
    truth: s.truth,
    origin: s.origin,
    believers: [...new Set(s.believers)],
    investigated: false,
    known: false,
    causeId: e.id,
    expires: w.day + rng.int(12, 18),
  };
  w.rumors.push(rumor);
  // Las regiones que lo creen ligan su tensión a este rumor (para la cadena causal).
  if (s.kind === 'ataque' || s.kind === 'traicion') {
    for (const b of rumor.believers) {
      const rel = w.regions[b].relations[s.about];
      if (rel) {
        rel.tensionCause = e.id;
        rel.opinion = clamp(rel.opinion - 0.12, -1, 1);
      }
    }
  }
  if (s.forceKnown || hearsRumor(ctx, rumor)) makeKnown(ctx, rumor);
  return rumor;
}

export function makeKnown(ctx: Ctx, rumor: Rumor): void {
  if (rumor.known) return;
  rumor.known = true;
  const intel = ctx.w.intel[rumor.about];
  if (intel.level === 0) intel.level = 1;
}

/** ¿Llega el rumor a oídos del jugador? */
function hearsRumor(ctx: Ctx, r: Rumor): boolean {
  const { w, rng } = ctx;
  const where = w.regions[r.heardIn];
  if (where.isHome) return true;
  const intel = w.intel[r.heardIn];
  const d = hops(w, w.player.home)[r.heardIn];
  let p = d === 1 ? 0.35 : d === 2 ? 0.15 : 0.05;
  if (intel.observerStationed) p += 0.5;
  if (where.attitude.trust > 0.55) p += 0.25;
  if ((w.player.patterns.informacion ?? 0) >= 3) p += 0.15; // te traen noticias porque las compartes
  if (w.player.priority === 'conocimiento') p += 0.15;
  return rng.chance(p);
}

export function tickRumors(ctx: Ctx): void {
  const { w, rng } = ctx;
  for (const r of w.regions) {
    if (r.isHome) continue;
    const nbs = r.neighbors.filter((n) => !w.regions[n].isHome);
    const teller = () => rng.pick(r.neighbors);
    if (r.militancy > 0.5 && rng.chance(0.12)) {
      const target = nbs.sort((a, b) => (r.relations[b]?.tension ?? 0) - (r.relations[a]?.tension ?? 0))[0];
      if (target !== undefined) createRumor(ctx, { kind: 'ataque', about: r.id, target, heardIn: teller(), truth: true, origin: 'natural', believers: [target], causeId: r.flags.preparando?.causeId });
    }
    if (r.research && rng.chance(0.05) && nbs.length) {
      // Malentendido: "construyen algo" se interpreta como armas.
      const target = rng.pick(nbs);
      createRumor(ctx, { kind: 'ataque', about: r.id, target, heardIn: teller(), truth: r.militancy > 0.55, origin: 'malentendido', believers: [target], causeId: r.research.causeId });
    }
    if (r.flags.hambre && rng.chance(0.08)) createRumor(ctx, { kind: 'hambre', about: r.id, heardIn: teller(), truth: true, origin: 'natural', believers: [], causeId: r.flags.hambre.causeId });
    if (r.food > 18 && rng.chance(0.03)) createRumor(ctx, { kind: 'riqueza', about: r.id, heardIn: teller(), truth: true, origin: 'natural', believers: nbs.filter((n) => w.regions[n].flags.hambre) });
    if (r.flags.fiebre && rng.chance(0.08)) createRumor(ctx, { kind: 'enfermedad', about: r.id, heardIn: teller(), truth: true, origin: 'natural', believers: nbs, causeId: r.flags.fiebre.causeId });
    if (!r.flags.fiebre && rng.chance(0.006)) createRumor(ctx, { kind: 'enfermedad', about: r.id, heardIn: teller(), truth: false, origin: 'exageracion', believers: nbs.slice(0, 1) });
    if (r.food < 8 && r.dependency > 0.4 && rng.chance(0.03)) createRumor(ctx, { kind: 'hambre', about: r.id, heardIn: r.id, truth: r.food < 3, origin: 'exageracion', believers: [] });
  }

  for (const rumor of w.rumors) {
    if (w.day > rumor.expires) {
      rumor.believers = [];
      continue;
    }
    // Difusión por las rutas.
    for (const b of [...rumor.believers]) {
      for (const n of w.regions[b].neighbors) {
        if (n === rumor.about || rumor.believers.includes(n) || w.regions[n].isHome) continue;
        const route = routeBetween(w, b, n);
        if (route?.status === 'abierta' && rng.chance(0.1 * route.traffic)) rumor.believers.push(n);
      }
    }
    // Las regiones con buenas fuentes descartan los rumores falsos.
    rumor.believers = rumor.believers.filter((b) => rumor.truth || !rng.chance(0.03 + techMult(w.regions[b], 'insight') * 0.3));
    // Efectos de creer el rumor.
    for (const b of rumor.believers) {
      const rel = w.regions[b].relations[rumor.about];
      if (!rel) continue;
      if (rumor.kind === 'ataque' || rumor.kind === 'traicion') {
        rel.opinion = clamp(rel.opinion - 0.012, -1, 1);
        w.regions[b].attitude.fear = clamp(w.regions[b].attitude.fear + 0.004);
      } else if (rumor.kind === 'enfermedad') {
        const route = routeBetween(w, b, rumor.about);
        if (route) route.traffic *= 0.97;
      }
    }
    if (!rumor.known && hearsRumorLate(ctx, rumor)) makeKnown(ctx, rumor);
  }
  // Limpieza: los rumores viejos y desconocidos se olvidan.
  w.rumors = w.rumors.filter((r) => r.known || w.day <= r.expires + 2);
}

function hearsRumorLate(ctx: Ctx, r: Rumor): boolean {
  const intel = ctx.w.intel[r.heardIn];
  return intel.observerStationed ? ctx.rng.chance(0.3) : ctx.rng.chance(0.03);
}

/** Verdicto al investigar un rumor. Devuelve la explicación para el informe. */
export function verdictOf(ctx: Ctx, rumor: Rumor): string {
  const { w } = ctx;
  const A = w.regions[rumor.about];
  rumor.investigated = true;
  if (rumor.truth) {
    rumor.verdict = 'cierto';
    rumor.note = rumor.kind === 'ataque' ? `Es cierto: en ${A.name} se preparan para luchar.` : 'Los observadores confirman el rumor.';
  } else if (rumor.origin === 'malentendido') {
    rumor.verdict = 'confuso';
    rumor.note = A.research
      ? `En ${A.name} construyen algo, pero no son armas: trabajan en una técnica nueva.`
      : `Lo que se vio en ${A.name} no era lo que parecía. No hay preparativos de guerra.`;
  } else {
    rumor.verdict = 'falso';
    rumor.note =
      rumor.origin === 'manipulador'
        ? 'Es falso. Curiosamente, nadie sabe quién lo contó primero: solo recuerdan a un mercader de paso.'
        : rumor.origin === 'jugador'
          ? 'Es falso. Lo sabes bien: lo inventaste tú.'
          : 'Es falso. Alguien exageró lo que vio.';
  }
  return rumor.note;
}
