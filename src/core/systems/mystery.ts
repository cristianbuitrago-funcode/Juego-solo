import { personName } from '../content/names';
import { record } from '../chronicle';
import type { Character, ClueKind, Region, Rumor, WorldState } from '../types';
import { clamp } from '../util';
import { charactersOf, hops, type Ctx } from '../world';
import { createRumor } from './rumors';

/**
 * La verdad oculta del mundo. Cada partida elige un misterio que influye en
 * la simulación de forma discreta. El jugador lo descubre reuniendo
 * fragmentos (pistas, investigaciones, espionaje, conversaciones) y
 * formulando una conclusión. Para añadir uno nuevo, añade un MysteryDef.
 */
export interface MysterySignal {
  kind: ClueKind;
  strength: number;
  text?: string;
  fragment?: string;
}

interface Option {
  id: string;
  label: string;
}

interface MysteryDef {
  kind: string;
  question: string; // pregunta que se muestra al jugador
  setup(ctx: Ctx): void;
  tick(ctx: Ctx): void;
  signal(ctx: Ctx, r: Region): MysterySignal | undefined;
  onObserve?(ctx: Ctx, r: Region): string | undefined;
  onSpy?(ctx: Ctx, r: Region): string | undefined;
  onRumor?(ctx: Ctx, rumor: Rumor): string | undefined;
  onTalk?(ctx: Ctx, c: Character): string | undefined;
  fragment(w: WorldState, key: string): string;
  options(w: WorldState): Option[];
  correct(w: WorldState): string;
  resolve(ctx: Ctx): void;
}

const culprit = (w: WorldState) => w.regions[w.mystery.culpritRegion];
const culpritChar = (w: WorldState) => w.characters.find((c) => c.id === w.mystery.culpritCharacter);

// ---------------------------------------------------------------------------
// El manipulador: alguien siembra rumores falsos para enfrentar a los pueblos.
// ---------------------------------------------------------------------------
const manipulador: MysteryDef = {
  kind: 'manipulador',
  question: '¿Quién está detrás de los rumores que enfrentan a los pueblos?',
  setup(ctx) {
    const { w, rng } = ctx;
    const candidates = w.regions.filter((r) => !r.isHome && r.neighbors.filter((n) => !w.regions[n].isHome).length >= 2);
    const m = rng.pick(candidates.length ? candidates : w.regions.filter((r) => !r.isHome));
    w.mystery.culpritRegion = m.id;
    let c = charactersOf(w, m.id).find((x) => x.role === 'mercader');
    if (!c) {
      const culture = w.cultures.find((x) => x.id === m.culture)!;
      c = {
        id: `c${w.characters.length + 1}`,
        name: personName(rng, culture.syllables, new Set(w.characters.map((x) => x.name))),
        role: 'mercader',
        regionId: m.id,
        alive: true,
        known: false,
        emotions: { trust: 0.5, fear: 0.1, resentment: 0.2, gratitude: 0.1, ambition: 0.9, curiosity: 0.4 },
        memories: [],
        relative: 'mi hermano',
        lastSpoke: -99,
      };
      w.characters.push(c);
    }
    c.secret = 'manipulador';
    c.emotions.ambition = 0.9;
    w.mystery.culpritCharacter = c.id;
    w.counters.manipNext = rng.int(4, 7);
  },
  tick(ctx) {
    const { w, rng } = ctx;
    if (w.mystery.solved || w.day < (w.counters.manipNext ?? 0)) return;
    const c = culpritChar(w);
    if (!c?.alive) return;
    w.counters.manipNext = w.day + rng.int(5, 8);
    const d = hops(w, w.mystery.culpritRegion);
    const pairs: [number, number][] = [];
    for (const r of w.regions) {
      if (r.isHome || r.id === w.mystery.culpritRegion || d[r.id] > 2) continue;
      for (const n of r.neighbors) if (n > r.id && !w.regions[n].isHome && n !== w.mystery.culpritRegion && !r.relations[n]?.war) pairs.push([r.id, n]);
    }
    if (!pairs.length) return;
    const [a, b] = rng.pick(pairs);
    const e = record(ctx, { kind: 'informacion', text: `${c.name} siembra discordia entre ${w.regions[a].name} y ${w.regions[b].name}.`, regions: [w.mystery.culpritRegion, a, b], known: false, importance: 2 });
    const kind = rng.chance(0.7) ? 'ataque' : 'traicion';
    // Rumores cruzados: cada uno cree que el otro le amenaza.
    createRumor(ctx, { kind, about: b, target: a, heardIn: a, truth: false, origin: 'manipulador', believers: [a], causeId: e.id });
    createRumor(ctx, { kind, about: a, target: b, heardIn: b, truth: false, origin: 'manipulador', believers: [b], causeId: e.id });
  },
  signal(ctx, r) {
    const { w, rng } = ctx;
    const victim = w.rumors.some((x) => x.origin === 'manipulador' && x.believers.includes(r.id));
    if (victim && rng.chance(0.35)) return { kind: 'misterio', strength: 0.9, text: 'Un mercader forastero pregunta demasiado por las defensas de {R}.', fragment: 'm_forastero' };
    return undefined;
  },
  onObserve(ctx, r) {
    return r.id === ctx.w.mystery.culpritRegion ? 'm_hierro' : undefined;
  },
  onSpy(ctx, r) {
    const w = ctx.w;
    if (r.id === w.mystery.culpritRegion) return 'm_pagos';
    if (w.rumors.some((x) => x.origin === 'manipulador' && x.heardIn === r.id)) return 'm_visto';
    return undefined;
  },
  onRumor(ctx, rumor) {
    if (rumor.origin !== 'manipulador') return undefined;
    const paired = ctx.w.rumors.some((x) => x !== rumor && x.origin === 'manipulador' && x.day === rumor.day && x.investigated);
    return paired ? 'm_cruzados' : 'm_origen';
  },
  onTalk(ctx, c) {
    return c.role === 'mercader' && c.secret !== 'manipulador' && ctx.rng.chance(0.5) ? 'm_competencia' : undefined;
  },
  fragment(w, key) {
    const m = culprit(w).name;
    const n = culpritChar(w)?.name ?? 'alguien';
    const texts: Record<string, string> = {
      m_forastero: `Un mercader forastero aparece allí donde surgen rumores de guerra.`,
      m_hierro: `En ${m}, un mercader llamado ${n} vende hierro y cuero a regiones enemistadas entre sí.`,
      m_pagos: `${n} de ${m} recibe pagos de quienes compran armas. Se alegra con cada noticia de tensión.`,
      m_visto: `En las plazas recuerdan a un mercader de ${m} que llegó justo antes del rumor.`,
      m_origen: `El rumor que investigaste era falso, y nadie sabe quién lo contó primero.`,
      m_cruzados: `Dos rumores opuestos aparecieron el mismo día: cada pueblo cree que el otro le amenaza. Alguien los sembró a la vez.`,
      m_competencia: `Un mercader rival murmura: «${n} gana más cuanto peor se llevan los demás».`,
    };
    return texts[key] ?? '…';
  },
  options(w) {
    const c = culpritChar(w);
    const pool = w.characters.filter((x) => x.alive && x.id !== c?.id && x.known);
    const decoys = pool.slice(0, 3);
    while (decoys.length < 3) {
      const extra = w.characters.find((x) => x.alive && x.id !== c?.id && !decoys.includes(x));
      if (!extra) break;
      decoys.push(extra);
    }
    const opts = [...decoys, ...(c ? [c] : [])].map((x) => ({ id: x.id, label: `${x.name} de ${w.regions[x.regionId].name}` }));
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return [...opts, { id: 'nadie', label: 'Nadie: los rumores son casuales' }];
  },
  correct(w) {
    return w.mystery.culpritCharacter ?? '';
  },
  resolve(ctx) {
    const { w } = ctx;
    const c = culpritChar(w);
    const e = record(ctx, { kind: 'descubrimiento', text: `Desenmascaras a ${c?.name}: sembraba rumores para vender armas a ambos bandos. Los pueblos engañados respiran.`, regions: [w.mystery.culpritRegion], known: true, importance: 3 });
    for (const rumor of w.rumors) {
      if (rumor.origin !== 'manipulador') continue;
      for (const b of rumor.believers) {
        const rel = w.regions[b].relations[rumor.about];
        if (rel) (rel.tension = clamp(rel.tension - 0.35)), (rel.opinion = clamp(rel.opinion + 0.25, -1, 1));
        w.regions[b].attitude.trust = clamp(w.regions[b].attitude.trust + 0.12);
      }
      rumor.believers = [];
      rumor.investigated = true;
      rumor.verdict = 'falso';
    }
    if (c) c.emotions.resentment = 0.9;
    w.player.credibility = clamp(w.player.credibility + 0.15);
    culprit(w).flags.desenmascarada = { since: w.day, causeId: e.id };
  },
};

// ---------------------------------------------------------------------------
// La fiebre del río: las minas del nacimiento envenenan el agua río abajo.
// ---------------------------------------------------------------------------
const rio: MysteryDef = {
  kind: 'rio',
  question: '¿Qué está causando la fiebre?',
  setup(ctx) {
    const { w } = ctx;
    const src = w.regions[w.river[0]];
    w.mystery.culpritRegion = src.id;
    if (src.resource !== 'hierro' && src.resource !== 'arcilla') src.resource = 'hierro';
    src.pressure = Math.max(src.pressure, 0.38);
    const e = record(ctx, { kind: 'ecologia', text: `Las minas de ${src.name} vierten sus restos al río.`, regions: [src.id], known: false, importance: 2 });
    src.flags.vertidos = { since: w.day, causeId: e.id };
  },
  tick(ctx) {
    const { w, rng } = ctx;
    const src = culprit(w);
    const polluting = src.pressure > 0.27 && !src.resourceBanned;
    for (const id of w.river.slice(1)) {
      const r = w.regions[id];
      if (r.isHome) continue;
      if (!r.flags.fiebre && polluting && rng.chance(0.05 * src.pressure * 2)) {
        const e = record(ctx, { kind: 'consecuencia', text: `Una fiebre se extiende por ${r.name}.`, regions: [id], causeId: src.flags.vertidos?.causeId, importance: 2 });
        r.flags.fiebre = { since: w.day, causeId: e.id };
      } else if (r.flags.fiebre) {
        r.population *= 0.997;
        r.stability = clamp(r.stability - 0.004);
        const heal = (polluting ? 0.01 : 0.12) + (r.techs.includes('remedios') ? 0.06 : 0);
        if (rng.chance(heal)) {
          record(ctx, { kind: 'consecuencia', text: `La fiebre remite en ${r.name}.`, regions: [id], causeId: r.flags.fiebre.causeId });
          delete r.flags.fiebre;
        }
      }
    }
  },
  signal(ctx, r) {
    const { w, rng } = ctx;
    if (r.flags.fiebre && rng.chance(0.4)) return { kind: 'misterio', strength: 1, text: 'Todos los enfermos de {R} viven cerca del río.', fragment: 'f_rio' };
    if (r.id === w.mystery.culpritRegion && r.pressure > 0.27 && rng.chance(0.3)) return { kind: 'misterio', strength: 0.8, text: 'El agua que baja de {R} tiene un brillo metálico.', fragment: 'f_metal' };
    return undefined;
  },
  onObserve(ctx, r) {
    const w = ctx.w;
    if (r.id === w.mystery.culpritRegion) return 'f_vertidos';
    if (r.flags.fiebre) return 'f_rio';
    return undefined;
  },
  onSpy(ctx, r) {
    return r.id === ctx.w.mystery.culpritRegion ? 'f_vertidos' : r.flags.fiebre ? 'f_ritmo' : undefined;
  },
  onRumor(ctx, rumor) {
    return rumor.kind === 'enfermedad' && rumor.truth ? 'f_ritmo' : undefined;
  },
  onTalk(ctx, c) {
    return c.role === 'sanadora' && ctx.w.regions[c.regionId].riverOrder > 0 ? 'f_sanadora' : undefined;
  },
  fragment(w, key) {
    const s = culprit(w).name;
    const texts: Record<string, string> = {
      f_rio: 'Los enfermos viven junto al río. Lejos del agua apenas hay fiebre.',
      f_metal: `El agua que baja de ${s} brilla como el metal.`,
      f_vertidos: `En ${s} vierten los restos de las minas al río.`,
      f_ritmo: `La fiebre empeora unos días después de que ${s} aumenta su extracción.`,
      f_sanadora: 'Una sanadora jura que hervir el agua no basta: «el mal viene de arriba».',
    };
    return texts[key] ?? '…';
  },
  options(w) {
    const river = w.river.filter((id) => !w.regions[id].isHome).map((id) => ({ id: String(id), label: `El agua que viene de ${w.regions[id].name}` }));
    const other = w.regions.filter((r) => !r.isHome && !w.river.includes(r.id)).slice(0, 2).map((r) => ({ id: String(r.id), label: `Los viajeros de ${r.name}` }));
    return [...river, ...other, { id: 'maldicion', label: 'Una maldición antigua' }];
  },
  correct(w) {
    return String(w.mystery.culpritRegion);
  },
  resolve(ctx) {
    const { w } = ctx;
    const src = culprit(w);
    const e = record(ctx, { kind: 'descubrimiento', text: `Descubres la causa de la fiebre: los vertidos de las minas de ${src.name}. Prohibir su extracción detendría el mal.`, regions: [src.id], known: true, importance: 3 });
    for (const id of w.river.slice(1)) {
      const r = w.regions[id];
      if (r.isHome || !r.relations[src.id]) continue;
      r.relations[src.id].opinion = clamp(r.relations[src.id].opinion - 0.2, -1, 1);
      r.relations[src.id].tensionCause = e.id;
      r.attitude.trust = clamp(r.attitude.trust + 0.1);
    }
  },
};

// ---------------------------------------------------------------------------
// El invierno largo: una crisis climática anunciada por señales antiguas.
// ---------------------------------------------------------------------------
const invierno: MysteryDef = {
  kind: 'invierno',
  question: '¿Qué anuncian las señales extrañas del cielo y las montañas?',
  setup(ctx) {
    const { w, rng } = ctx;
    w.mystery.triggerDay = rng.int(34, 42);
    const far = [...w.regions].filter((r) => !r.isHome).sort((a, b) => a.center.y - b.center.y)[0];
    w.mystery.culpritRegion = far.id;
    const e = record(ctx, { kind: 'evento', text: 'El mundo se enfría. Las señales del invierno largo empiezan a aparecer.', regions: [far.id], known: false, importance: 2 });
    w.counters.winterCause = Number(e.id.slice(1));
  },
  tick(ctx) {
    const { w } = ctx;
    const t = w.mystery.triggerDay;
    const cause = `e${w.counters.winterCause}`;
    if (w.day === t) {
      const e = record(ctx, { kind: 'evento', text: 'Llega el invierno largo. La nieve cubre los campos y los caminos se vuelven lentos.', regions: w.regions.map((r) => r.id), causeId: cause, known: true, importance: 3 });
      for (const r of w.regions) r.flags.invierno = { since: w.day, causeId: e.id };
    }
    if (w.day >= t && w.day < t + 12) {
      for (const r of w.regions) {
        if (r.isHome) continue;
        // Las regiones advertidas se prepararon.
        if (r.flags.advertida) r.food += 0.25;
      }
      w.player.reserves = clamp(w.player.reserves - 1.2, 0, 100);
    }
    if (w.day === t + 12) {
      for (const r of w.regions) delete r.flags.invierno;
      record(ctx, { kind: 'evento', text: 'El deshielo llega por fin. El mundo cuenta a sus muertos y a sus supervivientes.', regions: [w.player.home], causeId: cause, known: true, importance: 3 });
    }
  },
  signal(ctx, r) {
    const { w, rng } = ctx;
    const t = w.mystery.triggerDay;
    if (w.day < 6 || w.day >= t) return undefined;
    const p = 0.12 + (w.day / t) * 0.4;
    if (!rng.chance(p)) return undefined;
    const opts = [
      { text: 'Las grullas han migrado antes de tiempo sobre {R}.', fragment: 'i_grullas' },
      { text: 'En las cumbres de {R} hay escarcha fuera de estación.', fragment: 'i_escarcha' },
      { text: 'Los animales de {R} engordan como si temieran algo.', fragment: 'i_animales' },
    ];
    const o = rng.pick(opts);
    return { kind: 'clima', strength: 0.9, ...o };
  },
  onObserve(ctx, r) {
    return r.id === ctx.w.mystery.culpritRegion ? 'i_escarcha' : undefined;
  },
  onSpy(ctx, r) {
    return charactersOf(ctx.w, r.id).some((c) => c.role === 'anciana' || c.role === 'poeta') ? 'i_anales' : undefined;
  },
  onTalk(ctx, c) {
    return c.role === 'anciana' || c.role === 'poeta' ? 'i_cancion' : undefined;
  },
  fragment(w, key) {
    const texts: Record<string, string> = {
      i_grullas: 'Las aves migran semanas antes de lo normal.',
      i_escarcha: `En las cumbres de ${culprit(w).name} hay escarcha que no se derrite.`,
      i_animales: 'Los animales acumulan grasa como antes de un gran frío.',
      i_anales: 'Unos anales antiguos hablan de un invierno de cien días que vuelve cada siete generaciones.',
      i_cancion: 'Una vieja canción dice: «cuando las grullas huyan en verano, guarda el grano dos veces».',
    };
    return texts[key] ?? '…';
  },
  options(w) {
    const rs = w.regions.filter((r) => !r.isHome);
    return [
      { id: 'invierno', label: 'Se acerca un invierno largo' },
      { id: 'plaga', label: 'Una plaga destruirá las cosechas' },
      { id: 'guerra', label: `${rs[0]?.name ?? 'Alguien'} prepara una gran guerra` },
      { id: 'dioses', label: 'Los antiguos están enfadados con tu gente' },
    ];
  },
  correct() {
    return 'invierno';
  },
  resolve(ctx) {
    const { w } = ctx;
    const left = w.mystery.triggerDay - w.day;
    record(ctx, { kind: 'descubrimiento', text: left > 0 ? `Lo entiendes: se acerca un invierno largo, quizás en unos ${Math.max(1, Math.round(left / 5) * 5)} días. Puedes advertir a las regiones compartiendo información.` : 'Lo entiendes: este es el invierno largo de las canciones.', regions: [w.player.home], known: true, importance: 3 });
  },
};

// ---------------------------------------------------------------------------
// Las ruinas: un saber antiguo dormido bajo una región que parecía corriente.
// ---------------------------------------------------------------------------
const ruinas: MysteryDef = {
  kind: 'ruinas',
  question: '¿Dónde está el origen de los objetos antiguos que aparecen?',
  setup(ctx) {
    const { w, rng } = ctx;
    const d = hops(w, w.player.home);
    const cand = w.regions.filter((r) => !r.isHome && d[r.id] >= 2);
    w.mystery.culpritRegion = rng.pick(cand.length ? cand : w.regions.filter((r) => !r.isHome)).id;
  },
  tick() {},
  signal(ctx, r) {
    const { w, rng } = ctx;
    const c = culprit(w);
    if ((r.id === c.id || c.neighbors.includes(r.id)) && rng.chance(0.18))
      return { kind: 'misterio', strength: 0.8, text: r.id === c.id ? 'Unos niños de {R} juegan con piezas de metal que nadie sabe forjar.' : 'Un viajero de {R} vende un disco de bronce con símbolos desconocidos.', fragment: r.id === c.id ? 'r_piezas' : 'r_disco' };
    return undefined;
  },
  onObserve(ctx, r) {
    const c = culprit(ctx.w);
    return c.neighbors.includes(r.id) ? 'r_mapa' : r.id === c.id ? 'r_piezas' : undefined;
  },
  onSpy(ctx, r) {
    return r.id === ctx.w.mystery.culpritRegion ? 'r_camara' : undefined;
  },
  onTalk(ctx, c) {
    return c.role === 'exploradora' || c.role === 'poeta' ? 'r_leyenda' : undefined;
  },
  fragment(w, key) {
    const c = culprit(w).name;
    const texts: Record<string, string> = {
      r_piezas: `En ${c} aparecen piezas de metal de una técnica olvidada.`,
      r_disco: 'Circulan discos de bronce con símbolos que nadie sabe leer.',
      r_mapa: `Un mapa antiguo señala un valle de ${c} con un círculo rojo.`,
      r_camara: `Bajo una colina de ${c} hay una cámara sellada cubierta de inscripciones.`,
      r_leyenda: 'Una leyenda habla de un pueblo que sabía hablar con el fuego a través de las montañas.',
    };
    return texts[key] ?? '…';
  },
  options(w) {
    const c = culprit(w);
    const others = w.regions.filter((r) => !r.isHome && r.id !== c.id).slice(0, 3);
    return [...others, c].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ id: String(r.id), label: `Bajo ${r.name}` }));
  },
  correct(w) {
    return String(w.mystery.culpritRegion);
  },
  resolve(ctx) {
    const { w } = ctx;
    const c = culprit(w);
    for (const t of ['senales', 'acequias']) if (!c.techs.includes(t)) c.techs.push(t);
    for (const route of w.routes) if (route.a === c.id || route.b === c.id) route.baseTraffic = Math.min(1.2, route.baseTraffic * 1.4);
    const e = record(ctx, { kind: 'descubrimiento', text: `Se abre el archivo antiguo bajo ${c.name}: torres de señales y acequias. ${c.name}, que parecía una región sin importancia, se convierte en el centro del saber.`, regions: [c.id], known: true, importance: 3 });
    for (const r of w.regions) {
      if (r.isHome || r.id === c.id || r.attitude.trust < 0.5) continue;
      if (!r.techs.includes('acequias')) {
        r.techs.push('acequias');
        record(ctx, { kind: 'tecnologia', text: `Compartes el saber del archivo con ${r.name}: aprende acequias.`, regions: [r.id], causeId: e.id, known: true });
      }
    }
  },
};

export const MYSTERIES: Record<string, MysteryDef> = { manipulador, rio, invierno, ruinas };

export function setupMystery(ctx: Ctx, kind?: string): void {
  const k = kind ?? ctx.rng.pick(Object.keys(MYSTERIES));
  ctx.w.mystery.kind = k;
  MYSTERIES[k].setup(ctx);
}

const def = (w: WorldState) => MYSTERIES[w.mystery.kind];

export function tickMystery(ctx: Ctx): void {
  def(ctx.w)?.tick(ctx);
}

export function mysterySignal(ctx: Ctx, r: Region): MysterySignal | undefined {
  if (ctx.w.mystery.solved) return undefined;
  return def(ctx.w)?.signal(ctx, r);
}

export function mysteryQuestion(w: WorldState): string {
  return def(w)?.question ?? '';
}

export function fragmentText(w: WorldState, key: string): string {
  return def(w)?.fragment(w, key) ?? key;
}

export function mysteryOptions(w: WorldState): Option[] {
  return def(w)?.options(w) ?? [];
}

/** Registra un fragmento nuevo; la primera vez revela que existe un misterio. */
export function foundFragment(ctx: Ctx, key: string | undefined): boolean {
  const { w } = ctx;
  if (!key || w.mystery.solved || w.mystery.fragmentsFound.includes(key)) return false;
  w.mystery.fragmentsFound.push(key);
  if (!w.mystery.revealed) {
    w.mystery.revealed = true;
    record(ctx, { kind: 'descubrimiento', text: `Algo se oculta en este mundo. ${mysteryQuestion(w)}`, regions: [w.player.home], known: true, importance: 3 });
  }
  record(ctx, { kind: 'descubrimiento', text: `Fragmento de la verdad: ${fragmentText(w, key)}`, regions: [w.player.home], known: true, importance: 2 });
  return true;
}

export const mysteryHooks = {
  observe: (ctx: Ctx, r: Region) => foundFragment(ctx, def(ctx.w)?.onObserve?.(ctx, r)),
  spy: (ctx: Ctx, r: Region) => foundFragment(ctx, def(ctx.w)?.onSpy?.(ctx, r)),
  rumor: (ctx: Ctx, rumor: Rumor) => foundFragment(ctx, def(ctx.w)?.onRumor?.(ctx, rumor)),
  talk: (ctx: Ctx, c: Character) => foundFragment(ctx, def(ctx.w)?.onTalk?.(ctx, c)),
};

export const FRAGMENTS_NEEDED = 3;

/** El jugador formula su conclusión. */
export function conclude(ctx: Ctx, optionId: string): 'correcta' | 'incorrecta' | 'insuficiente' | 'espera' {
  const { w } = ctx;
  const m = w.mystery;
  if (m.solved) return 'correcta';
  if (m.fragmentsFound.length < FRAGMENTS_NEEDED) return 'insuficiente';
  if (w.day < m.nextGuessDay) return 'espera';
  if (optionId === def(w).correct(w)) {
    m.solved = true;
    def(w).resolve(ctx);
    return 'correcta';
  }
  m.failedGuesses++;
  m.nextGuessDay = w.day + 5;
  w.player.credibility = clamp(w.player.credibility - 0.08);
  record(ctx, { kind: 'descubrimiento', text: 'Tu conclusión no encaja con lo que ocurre. Alguien se ríe de tus acusaciones.', regions: [w.player.home], known: true });
  return 'incorrecta';
}
