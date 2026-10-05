import { carryKnowledge } from './knowledge';
import type { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { ROLE_TITLE } from './folk';
import { learnFact, seedRumor } from './gossip';
import { getLayout } from './layout';
import { bond, ensureTie, folkById, kinOf, logEvent, memorize, partnerOf, societyOf, tieOf, tiesOf, other, trait } from './society';
import type { Folk, FolkRole } from './types';

/**
 * Conflictos largos entre vecinos. Empiezan por algo pequeño (una deuda, unos
 * clientes, una linde) y crecen o se apagan solos durante semanas: una
 * discusión en público, cada uno contando su versión, un cambio de oficio, el
 * pueblo tomando partido, las familias implicadas y, al final, la paz, la
 * distancia o la enemistad. Nadie tiene toda la razón. El jugador puede
 * escuchar, investigar, mediar, tomar partido, mentir o aprovecharse… o no
 * hacer nada: la historia sigue igual.
 */
export interface Arc {
  id: string;
  kind: 'deuda' | 'clientes' | 'linde';
  regionId: number;
  a: string;
  b: string;
  start: number;
  stage: number; // 0 tensión · 1 discusión · 2 versiones · 3 consecuencia · 4 el pueblo habla · 5 familias · 6 desenlace
  next: number; // día de la siguiente etapa
  heat: number; // 0..1: cuánto arde el conflicto
  truth: string;
  va: string; // lo que cuenta A
  vb: string; // lo que cuenta B
  log: { day: number; text: string }[];
  player: { heardA?: boolean; heardB?: boolean; truth?: boolean; sided?: string; mediated?: number; lied?: boolean; exploited?: boolean; helped?: string };
  outcome?: 'paz' | 'distancia' | 'enemistad' | 'marcha';
  changedJob?: string;
}

const STAGE_GAP = [4, 5, 16, 18, 18, 28]; // días aproximados entre etapas (≈100 días en total)

export function arcsOf(w: WorldState, regionId?: number): Arc[] {
  return societyOf(w).arcs.filter((x) => regionId === undefined || x.regionId === regionId);
}

export function activeArcOf(w: WorldState, folkId: string): Arc | undefined {
  return societyOf(w).arcs.find((x) => !x.outcome && (x.a === folkId || x.b === folkId));
}

/** Empieza un conflicto entre dos vecinos. */
export function startArc(w: WorldState, rng: Rng, a: Folk, b: Folk, kind?: Arc['kind']): Arc {
  const s = societyOf(w);
  const k: Arc['kind'] = kind ?? (a.role === 'comerciante' && b.role === 'comerciante' ? 'clientes' : a.role === 'comerciante' || b.role === 'comerciante' ? 'deuda' : 'linde');
  const A = a.name;
  const B = b.name;
  const amount = rng.int(6, 14);
  let truth = '';
  let va = '';
  let vb = '';
  const t = rng.int(0, 2);
  if (k === 'deuda') {
    va = `«${B} se llevó un carro de grano y nunca me lo pagó. ${amount} monedas. Y encima va diciendo que soy yo quien miente.»`;
    vb = `«Le pagué a ${A} hasta la última moneda. Lo que pasa es que apunta las cuentas como le da la gana.»`;
    truth = t === 0 ? `${B} pagó la mitad; ${A} apuntó mal la otra mitad en su libro.` : t === 1 ? `${B} no pagó nunca: se gastó el dinero en otra cosa y le da vergüenza admitirlo.` : `${A} cobró dos veces el mismo carro, sin darse cuenta.`;
  } else if (k === 'clientes') {
    va = `«${B} vende más barato porque trampea la balanza. Me está robando los clientes.»`;
    vb = `«${A} no soporta que la gente prefiera comprarme a mí. Por eso va contando mentiras.»`;
    truth = t === 0 ? `La balanza de ${B} pesa de menos, pero ${B} no lo sabe: la compró así.` : t === 1 ? `${A} se inventó lo de la balanza porque vende menos desde la última cosecha.` : `Los dos han subido precios a escondidas; la gente empezó a comprar fuera.`;
  } else {
    va = `«${B} ha movido el mojón de la linde dos palmos hacia mi campo. Lo vi con mis propios ojos.»`;
    vb = `«Ese mojón siempre estuvo ahí. ${A} quiere quedarse con mi tierra desde hace años.»`;
    truth = t === 0 ? `Las lluvias movieron el mojón; ninguno de los dos lo tocó.` : t === 1 ? `${B} movió el mojón hace años, cuando el padre de ${A} estaba enfermo.` : `El mojón está bien; ${A} se equivoca de linde desde siempre.`;
  }
  const arc: Arc = { id: `a${++s.seq}`, kind: k, regionId: a.regionId, a: a.id, b: b.id, start: w.day, stage: 0, next: w.day + STAGE_GAP[0] + rng.int(0, 2), heat: 0.5 + rng.range(0, 0.12), truth, va, vb, log: [], player: {} };
  s.arcs.push(arc);
  bond(w, a.id, b.id, -22, 3);
  for (const f of [a, b]) if (f.p) f.p.tier = 1;
  return arc;
}

/** Un día del conflicto: se enfría o se calienta según el carácter de cada uno y la gente que les rodea. */
export function arcDay(w: WorldState, rng: Rng, arc: Arc): void {
  if (arc.outcome) return;
  const A = folkById(w, arc.a);
  const B = folkById(w, arc.b);
  if (!A?.alive || !B?.alive) {
    arc.outcome = 'distancia';
    arc.log.push({ day: w.day, text: 'El pleito se quedó sin resolver: uno de los dos ya no está.' });
    return;
  }
  const pride = (trait(A, 'orgulloso') + trait(B, 'orgulloso')) / 200;
  const kind = (trait(A, 'amable') + trait(B, 'amable')) / 200;
  arc.heat = clamp(arc.heat + (pride - 0.5) * 0.012 - (kind - 0.5) * 0.012 + (A.p!.emo.estres + B.p!.emo.estres) * 0.003 - 0.002);
  // Los amigos de los dos intentan poner paz, a veces.
  if (arc.stage >= 2 && rng.chance(0.03)) {
    const peace = w.life!.folk.find((f) => f.alive && f.regionId === arc.regionId && f.id !== arc.a && f.id !== arc.b && (tieOf(w, f.id, arc.a)?.aff ?? 0) >= 35 && (tieOf(w, f.id, arc.b)?.aff ?? 0) >= 35);
    if (peace) {
      arc.heat = clamp(arc.heat - (0.1 + trait(peace, 'amable') / 900));
      note(w, arc, `${peace.name} intentó que ${A.name} y ${B.name} hablaran.`, 'mediacion', [peace.id, A.id, B.id]);
    }
  }
  // Si se apaga solo antes de tiempo, acaba en paz.
  if (arc.stage >= 2 && arc.heat < 0.12) return finish(w, rng, arc, A, B);
  if (w.day < arc.next) return;
  arc.stage++;
  arc.next = w.day + (STAGE_GAP[arc.stage] ?? 20) + rng.int(-2, 3);
  const l = getLayout(w);
  const v = l.villages[arc.regionId];
  const people = w.life!.folk.filter((f) => f.alive && f.regionId === arc.regionId);
  switch (arc.stage) {
    case 1: {
      // La discusión en público: hoy, en la plaza o en el mercado, a media mañana.
      const st = v.stalls[0] ?? { x: v.cx + 1, y: v.cy + 1 };
      const at = { x: st.x + 0.5, y: st.y + 2.2 };
      const hour = 9.5 + rng.int(0, 4);
      for (const [f, dx] of [[A, -0.6], [B, 0.6]] as const) f.p!.plans.push({ day: w.day, from: hour, to: hour + 1.4, x: at.x + dx, y: at.y, activity: `discute a gritos con ${f === A ? B.name : A.name}`, with: f === A ? B.id : A.id, event: arc.id });
      bond(w, A.id, B.id, -15, 2);
      const witnesses = people.filter((f) => rng.chance(0.35)).map((f) => f.id);
      note(w, arc, `${A.name} y ${B.name} discutieron a gritos en el mercado.`, 'discusion', [A.id, B.id]);
      seedRumor(w, { regionId: arc.regionId, kind: 'discusion', subject: A.id, target: B.id, witnesses: [A.id, B.id, ...witnesses], arc: arc.id });
      for (const f of [A, B]) f.p!.emo.enojo = clamp(f.p!.emo.enojo + 0.35);
      break;
    }
    case 2: {
      // Cada uno cuenta su versión a los suyos.
      const friendsA = tiesOf(w, A.id).filter((t) => t.aff > 15).map((t) => other(t, A.id));
      const friendsB = tiesOf(w, B.id).filter((t) => t.aff > 15).map((t) => other(t, B.id));
      seedRumor(w, { regionId: arc.regionId, kind: 'version', subject: B.id, target: A.id, witnesses: [A.id, ...friendsA.slice(0, 3)], versions: [unquote(arc.va), `Dicen que ${B.name} le debe dinero a medio pueblo.`, `Dicen que ${B.name} es un tramposo de toda la vida.`], tone: -0.4, arc: arc.id });
      seedRumor(w, { regionId: arc.regionId, kind: 'version', subject: A.id, target: B.id, witnesses: [B.id, ...friendsB.slice(0, 3)], versions: [unquote(arc.vb), `Dicen que ${A.name} miente en las cuentas.`, `Dicen que ${A.name} ha arruinado a más de uno.`], tone: -0.4, arc: arc.id });
      note(w, arc, `${A.name} y ${B.name} ya no se hablan. Cada uno cuenta su versión.`, 'versiones', [A.id, B.id]);
      break;
    }
    case 3: {
      // Consecuencia: el más débil pierde clientes, crédito o tierra y cambia de oficio.
      const weak = (B.p!.coins + trait(B, 'orgulloso') / 10 < A.p!.coins + trait(A, 'orgulloso') / 10 ? B : A);
      const helped = arc.player.helped === weak.id;
      if (!helped && arc.heat > 0.3) {
        const from = weak.role;
        const to: FolkRole = from === 'comerciante' ? 'campesino' : from === 'campesino' ? (rng.chance(0.5) ? 'pastor' : 'minero') : 'campesino';
        changeJob(w, weak, to, `por el pleito con ${weak === A ? B.name : A.name}`);
        arc.changedJob = weak.id;
        note(w, arc, `${weak.name} ha dejado de ser ${ROLE_TITLE[from]}: ahora trabaja de ${ROLE_TITLE[to]}. Dicen que por el pleito con ${weak === A ? B.name : A.name}.`, 'oficio', [weak.id]);
        seedRumor(w, { regionId: arc.regionId, kind: 'oficio', subject: weak.id, witnesses: [weak.id, ...people.slice(0, 3).map((f) => f.id)], extra: { role: ROLE_TITLE[to] } });
        weak.p!.emo.tristeza = clamp(weak.p!.emo.tristeza + 0.3);
      } else note(w, arc, `${weak.name} lo está pasando mal por el pleito, pero aguanta${helped ? ' (con tu ayuda)' : ''}.`, 'aguanta', [weak.id]);
      break;
    }
    case 4: {
      // El pueblo toma partido según a quién quiere más.
      let forA = 0;
      let forB = 0;
      for (const f of people) {
        if (f.id === A.id || f.id === B.id) continue;
        const ta = tieOf(w, f.id, A.id)?.aff ?? 0;
        const tb = tieOf(w, f.id, B.id)?.aff ?? 0;
        if (Math.abs(ta - tb) < 10) continue;
        if (ta > tb) (forA++, bond(w, f.id, B.id, -8, 0));
        else (forB++, bond(w, f.id, A.id, -8, 0));
      }
      seedRumor(w, { regionId: arc.regionId, kind: 'pleito', subject: A.id, target: B.id, witnesses: people.filter(() => rng.chance(0.3)).map((f) => f.id), versions: [`Lo de ${A.name} y ${B.name} sigue sin arreglarse.`, `Medio pueblo está con ${A.name} y medio con ${B.name}.`, `Dicen que el pleito de ${A.name} y ${B.name} acabará en sangre.`], tone: -0.3, arc: arc.id, heat: 1.1 });
      note(w, arc, `Todo el pueblo habla del pleito entre ${A.name} y ${B.name}: ${forA > forB ? `la mayoría está con ${A.name}` : forB > forA ? `la mayoría está con ${B.name}` : 'la gente está dividida'}.`, 'pueblo', [A.id, B.id]);
      arc.heat = clamp(arc.heat + 0.05);
      break;
    }
    case 5: {
      // Las familias: los hijos, las parejas y los hermanos se ven arrastrados.
      const kinA = kinOf(w, A.id).map((k) => k.id);
      const kinB = kinOf(w, B.id).map((k) => k.id);
      for (const x of kinA) for (const y of kinB) bond(w, x, y, -20 * arc.heat, 0);
      for (const x of kinA) bond(w, x, B.id, -15 * arc.heat, 0);
      for (const y of kinB) bond(w, y, A.id, -15 * arc.heat, 0);
      const ka = kinA.map((id) => folkById(w, id)).find((f) => f?.alive);
      const kb = kinB.map((id) => folkById(w, id)).find((f) => f?.alive);
      if (ka && kb && arc.heat > 0.45) {
        note(w, arc, `${ka.name} (familia de ${A.name}) y ${kb.name} (familia de ${B.name}) se han peleado por el pleito.`, 'familias', [ka.id, kb.id]);
        seedRumor(w, { regionId: arc.regionId, kind: 'pelea', subject: ka.id, target: kb.id, witnesses: [ka.id, kb.id] });
      } else note(w, arc, `Las familias de ${A.name} y ${B.name} ya no se sientan juntas en la plaza.`, 'familias', [A.id, B.id]);
      break;
    }
    default:
      finish(w, rng, arc, A, B);
  }
}

function finish(w: WorldState, rng: Rng, arc: Arc, A: Folk, B: Folk): void {
  const t = ensureTie(w, A.id, B.id);
  if (arc.heat < 0.3) {
    arc.outcome = 'paz';
    t.aff = Math.max(t.aff + 55, 10);
    note(w, arc, `${A.name} y ${B.name} han hecho las paces.${arc.player.mediated ? ' Dicen que el forastero tuvo algo que ver.' : ''}`, 'reconciliacion', [A.id, B.id]);
    seedRumor(w, { regionId: arc.regionId, kind: 'reconciliacion', subject: A.id, target: B.id, witnesses: [A.id, B.id] });
    for (const f of [A, B]) (f.p!.emo.enojo = 0.05), (f.p!.emo.felicidad = clamp(f.p!.emo.felicidad + 0.3));
  } else if (arc.heat < 0.65) {
    arc.outcome = 'distancia';
    t.aff = Math.min(t.aff, -30);
    note(w, arc, `${A.name} y ${B.name} no han vuelto a hablarse. Ya no discuten: se ignoran.`, 'distancia', [A.id, B.id]);
  } else {
    t.aff = -90;
    const weak = B.p!.needs.dinero + B.p!.needs.relaciones < A.p!.needs.dinero + A.p!.needs.relaciones ? B : A;
    const dest = w.regions.filter((r) => r.id !== arc.regionId && !r.flags.guerra && !r.flags.hambre).sort((x, y) => y.food - x.food)[0];
    if (dest && weak.p!.needs.relaciones < 0.5 && rng.chance(0.7)) {
      arc.outcome = 'marcha';
      note(w, arc, `${weak.name} se ha ido de ${w.regions[arc.regionId].name} con su familia, rumbo a ${dest.name}. No quiso despedirse de nadie.`, 'marcha', [weak.id]);
      migrate(w, weak, dest.id);
    } else {
      arc.outcome = 'enemistad';
      note(w, arc, `${A.name} y ${B.name} son enemigos para siempre. Sus familias también.`, 'enemistad', [A.id, B.id]);
    }
  }
}

function note(w: WorldState, arc: Arc, text: string, kind: string, who: string[]): void {
  arc.log.push({ day: w.day, text });
  logEvent(w, arc.regionId, kind, text, who, arc.id);
}

const unquote = (s: string) => s.replace(/^«|»$/g, '');

/** Cambiar de oficio: el historial queda en la persona y la rutina cambia sola. */
export function changeJob(w: WorldState, f: Folk, to: FolkRole, why: string): void {
  if (f.role === to) return;
  f.p?.jobs.push({ role: to, from: w.day });
  if (f.p && f.p.jobs.length > 6) f.p.jobs.shift();
  f.role = to;
  if (f.p) f.p.events.push({ day: w.day, text: `Empezó a trabajar de ${ROLE_TITLE[to]} ${why}.` });
}

/** Un vecino (con su pareja e hijos pequeños) se va a vivir a otra región. */
export function migrate(w: WorldState, f: Folk, to: number, adjustPop = true): Folk[] {
  const life = w.life!;
  const from = f.regionId;
  const gone = [f];
  const partner = partnerOf(w, f.id);
  if (partner) {
    const pf = folkById(w, partner);
    if (pf?.alive && pf.regionId === from) gone.push(pf);
  }
  for (const k of kinOf(w, f.id)) {
    const kf = folkById(w, k.id);
    if (kf?.alive && kf.regionId === from && kf.age < 16 && (k.rel === 'hijo' || k.rel === 'hija')) gone.push(kf);
  }
  for (const g of gone) {
    carryKnowledge(w, g, from, to); // lo que sabe viaja con él (Fase 6)
    g.origin = from;
    g.regionId = to;
    g.house = (g.house + 1) % 3;
    if (g.p) g.p.events.push({ day: w.day, text: `Se fue a vivir a ${w.regions[to].name}.` });
    if (g.p) (g.p as { moved?: number }).moved = w.day;
  }
  // La región pierde gente de verdad (la simulación del motor lo nota).
  const R = w.regions[from];
  const D = w.regions[to];
  const n = adjustPop ? gone.length * 9 : 0;
  R.population = Math.max(40, R.population - n);
  D.population += n;
  void life;
  return gone;
}

// ---------------------------------------------------------------------------
// El jugador en el conflicto
// ---------------------------------------------------------------------------
export interface ArcChoice {
  id: string;
  label: string;
  hint?: string;
}

/** Qué puede hacer el jugador al hablar con alguien implicado (o con un tercero que sabe algo). */
export function arcChoices(w: WorldState, f: Folk): ArcChoice[] {
  const life = w.life!;
  const arc = activeArcOf(w, f.id);
  const out: ArcChoice[] = [];
  if (arc && arc.stage >= 1) {
    const side = f.id === arc.a ? 'A' : 'B';
    const otherName = folkById(w, side === 'A' ? arc.b : arc.a)?.name ?? 'el otro';
    const heard = side === 'A' ? arc.player.heardA : arc.player.heardB;
    if (!heard) out.push({ id: 'escuchar', label: `👂 «¿Qué pasó con ${otherName}?»` });
    else {
      if (arc.player.heardA && arc.player.heardB) out.push({ id: 'mediar', label: `🤝 Intentar que hable con ${otherName}`, hint: arc.player.truth ? 'Sabes lo que pasó de verdad.' : 'Conoces las dos versiones.' });
      if (arc.player.sided !== f.id) out.push({ id: 'lado', label: `⚖ Darle la razón`, hint: `${otherName} se enterará.` });
      out.push({ id: 'enredar', label: `🌒 Decirle que ${otherName} habla mal de su familia`, hint: 'Es mentira. Echa leña al fuego.' });
      if (arc.changedJob === (side === 'A' ? arc.b : arc.a) || f.role === 'comerciante') out.push({ id: 'aprovechar', label: '🪙 Ofrecerte para lo que deja el otro', hint: 'Sacar provecho del pleito.' });
      if (arc.stage >= 2 && !arc.player.helped && (f.p?.coins ?? 0) < 8) out.push({ id: 'ayudar', label: '🫱 Ayudarle a salir adelante', hint: 'Unas monedas o unas horas de trabajo.' });
    }
  } else {
    // Un tercero: puede contar lo que sabe o lo que cree.
    const s = societyOf(w);
    const known = s.arcs.find((x) => !x.outcome && x.stage >= 1 && x.regionId === f.regionId && x.a !== f.id && x.b !== f.id && s.rumors.some((r) => r.arc === x.id && r.knownBy[f.id] !== undefined));
    if (known) out.push({ id: `tercero:${known.id}`, label: `👂 «¿Qué pasa entre ${folkById(w, known.a)?.name} y ${folkById(w, known.b)?.name}?»` });
    const inv = known && !known.player.truth && known.player.heardA && known.player.heardB && life.identity ? [{ id: `investigar:${known.id}`, label: '🔎 Preguntar con detalle: fechas, cuentas, quién vio qué' }] : [];
    out.push(...inv);
  }
  return out;
}

/** Ejecuta lo que el jugador decide en el conflicto. Devuelve lo que pasa (sin juicio). */
export function arcAct(w: WorldState, f: Folk, choice: string, rng: Rng, skill: (k: 'diplomacia' | 'investigacion' | 'persuasion') => number): { lines: string[]; rumor?: { kind: string; target: string; extra?: Record<string, string> } } {
  const s = societyOf(w);
  if (choice.startsWith('tercero:') || choice.startsWith('investigar:')) {
    const arc = s.arcs.find((x) => x.id === choice.split(':')[1]);
    if (!arc) return { lines: ['…'] };
    const A = folkById(w, arc.a)!;
    const B = folkById(w, arc.b)!;
    if (choice.startsWith('investigar:')) {
      const ok = rng.chance(0.35 + skill('investigacion') * 0.13);
      if (ok) {
        arc.player.truth = true;
        learnFact(w, arc.a, `Lo que pasó de verdad con ${B.name}: ${arc.truth}`);
        return { lines: [`${f.name} se rasca la cabeza, hace memoria y te cuenta detalles que no encajan con ninguna de las dos versiones.`, `Atas cabos: ${arc.truth}`] };
      }
      return { lines: [`${f.name} se contradice, mezcla fechas y acaba diciendo que «allá ellos». No sacas nada en claro.`] };
    }
    const r = s.rumors.filter((x) => x.arc === arc.id && x.knownBy[f.id] !== undefined).sort((a, b) => b.day - a.day)[0];
    const told = r ? r.versions[r.knownBy[f.id]] : `Algo pasa entre ${A.name} y ${B.name}, pero no sé qué.`;
    learnFact(w, arc.a, `${f.name} cuenta: ${told}`);
    const lean = (tieOf(w, f.id, A.id)?.aff ?? 0) - (tieOf(w, f.id, B.id)?.aff ?? 0);
    return { lines: [`«${told.replace(/^Dicen que /, 'Dicen que ')}»`, lean > 15 ? `«Yo, la verdad, estoy con ${A.name}.»` : lean < -15 ? `«Yo, la verdad, estoy con ${B.name}.»` : '«Yo no me meto. Allá ellos.»'] };
  }
  const arc = activeArcOf(w, f.id);
  if (!arc) return { lines: ['…'] };
  const side = f.id === arc.a ? 'A' : 'B';
  const o = folkById(w, side === 'A' ? arc.b : arc.a)!;
  switch (choice) {
    case 'escuchar': {
      if (side === 'A') arc.player.heardA = true;
      else arc.player.heardB = true;
      const v = side === 'A' ? arc.va : arc.vb;
      learnFact(w, f.id, `Su versión del pleito con ${o.name}: ${unquote(v)}`);
      memorize(w, f, { kind: 'escucho', about: 'jugador', text: 'Me escuchó cuando nadie lo hacía.', w: 0.25, src: 'propio' });
      f.trust = clamp(f.trust + 0.04);
      return { lines: [v, arc.stage >= 3 ? `«Desde entonces todo ha ido a peor. ${arc.changedJob ? `${folkById(w, arc.changedJob)?.name} ha tenido que cambiar de oficio.` : ''}»` : '«Y ahora, si me disculpas, no quiero hablar más de eso.»'] };
    }
    case 'mediar': {
      const chance = 0.3 + skill('diplomacia') * 0.12 + (arc.player.truth ? 0.25 : 0) - arc.heat * 0.25 + (trait(f, 'amable') + trait(o, 'amable') - 100) / 400;
      arc.player.mediated = w.day;
      if (rng.chance(chance)) {
        arc.heat = clamp(arc.heat - 0.4);
        bond(w, f.id, o.id, 25, 3);
        for (const x of [f, o]) memorize(w, x, { kind: 'mediacion', about: 'jugador', with: x === f ? o.id : f.id, text: 'Nos ayudó a hablar.', w: 0.45, src: 'propio' }), (x.trust = clamp(x.trust + 0.08));
        return { lines: [arc.player.truth ? `Les cuentas lo que pasó de verdad: ${arc.truth} Se miran. Ninguno tenía toda la razón.` : `Te sientas con los dos. Dejas que cada uno cuente su parte sin interrumpir.`, `${f.name} y ${o.name} no se abrazan, pero se dan la mano.`], rumor: { kind: 'p_media', target: f.id, extra: { with: o.id } } };
      }
      arc.heat = clamp(arc.heat + 0.05);
      for (const x of [f, o]) x.trust = clamp(x.trust - 0.04);
      return { lines: ['Lo intentas, pero en cuanto se ven, vuelven los gritos. Te dicen que no te metas donde no te llaman.'] };
    }
    case 'lado':
      arc.player.sided = f.id;
      arc.heat = clamp(arc.heat + 0.1);
      memorize(w, f, { kind: 'apoyo', about: 'jugador', text: 'Me dio la razón.', w: 0.4, src: 'propio' });
      memorize(w, o, { kind: 'traicion', about: 'jugador', with: f.id, text: `Se puso del lado de ${f.name}.`, w: -0.45, src: 'oido' });
      f.trust = clamp(f.trust + 0.08);
      o.resentment = clamp(o.resentment + 0.15);
      return { lines: [`${f.name} asiente con fuerza. «Por fin alguien con dos dedos de frente.»`, `Seguro que ${o.name} se entera antes de que anochezca.`], rumor: { kind: 'p_lado', target: f.id } };
    case 'enredar':
      arc.player.lied = true;
      arc.heat = clamp(arc.heat + 0.25);
      bond(w, f.id, o.id, -20, 0);
      f.p!.emo.enojo = clamp(f.p!.emo.enojo + 0.3);
      // Si algún día se descubre, la mentira será tuya.
      if (rng.chance(0.4 - skill('persuasion') * 0.05)) memorize(w, o, { kind: 'mentira', about: 'jugador', text: 'Fue contando mentiras sobre mí.', w: -0.6, src: 'oido' });
      return { lines: [`A ${f.name} se le enciende la cara. «¿Eso ha dicho? ¿De mi familia?»`, 'Se va a buscar a alguien. No parece que vaya a hablar con calma.'] };
    case 'aprovechar': {
      const id = w.life!.identity;
      if (id) id.needs.coins += 2;
      arc.player.exploited = true;
      memorize(w, o, { kind: 'abuso', about: 'jugador', text: 'Se aprovechó de mi desgracia.', w: -0.35, src: 'oido' });
      f.trust = clamp(f.trust + 0.03);
      return { lines: [`${f.name} te mira de arriba abajo y acepta. «Lo que ${o.name} ya no hace, alguien tendrá que hacerlo.»`, 'Ganas un par de monedas. No sabes muy bien a costa de qué.'] };
    }
    case 'ayudar': {
      const id = w.life!.identity;
      const gave = id ? Math.min(3, id.needs.coins) : 0;
      if (id) id.needs.coins -= gave;
      if (f.p) f.p.coins += gave + 2;
      arc.player.helped = f.id;
      memorize(w, f, { kind: 'ayuda', about: 'jugador', text: 'Me ayudó cuando más lo necesitaba.', w: 0.6, src: 'propio' });
      f.trust = clamp(f.trust + 0.1);
      f.gratitude = clamp(f.gratitude + 0.2);
      return { lines: [gave ? `Le das ${gave} monedas y le ayudas a ordenar sus cosas.` : 'No tienes dinero, pero le echas una mano toda la tarde.', `«No sé cómo pagarte esto», dice ${f.name}.`], rumor: { kind: 'p_ayuda', target: f.id } };
    }
  }
  return { lines: ['…'] };
}

/** Para la escena y los avisos: quién está implicado en conflictos (y cuánto arde). */
export function heatBetween(w: WorldState, a: string, b: string): number {
  const arc = societyOf(w).arcs.find((x) => !x.outcome && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  return arc?.heat ?? 0;
}

export { ensureTie };
