import { record, revealRegionHistory } from '../core/chronicle';
import { observe } from '../core/intel';
import { foundFragment } from '../core/systems/mystery';
import { makeKnown } from '../core/systems/rumors';
import { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx, type Ctx } from '../core/world';
import { hourOf } from './clock';
import { remember, ROLE_TITLE } from './folk';
import { getLayout } from './layout';
import { ensureLife } from './life';
import { passable } from './path';
import type { Encounter, Folk } from './types';

/**
 * Encuentros que se descubren caminando. No llegan como notificaciones: se
 * oyen, se ven de lejos, y el jugador decide si acercarse. Nacen del estado
 * real del mundo (hambre, tensión, guerra, fiebre, rumores, misterio) y lo
 * que hagas con ellos puede escalar hasta convertirse en algo mucho mayor.
 */
export interface EncounterView {
  title: string;
  scene: string;
  actors: { name: string; role: string; folkId?: string }[];
}

export interface Option {
  id: string;
  label: string;
}

const SOUNDS: Record<string, string> = {
  disputa: 'Escuchas gritos',
  refugiados: 'Ves un grupo de gente con fardos',
  soldados: 'Oyes pasos de gente armada',
  viajero: 'Un viajero canturrea en el camino',
  herido: 'Alguien pide ayuda',
  cazadores: 'Se oyen voces de cazadores',
  enfermo: 'Alguien tose sin parar',
  misterioso: 'Ves a alguien que habla en voz baja',
  fogata: 'Huele a humo de una hoguera',
};

function dirWord(dx: number, dy: number): string {
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const dirs = ['al este', 'al noreste', 'al norte', 'al noroeste', 'al oeste', 'al suroeste', 'al sur', 'al sureste'];
  return dirs[Math.round(((a + 360) % 360) / 45) % 8];
}

/** Intenta crear un encuentro cerca del jugador. Devuelve el aviso a mostrar. */
export function maybeSpawn(w: WorldState, facing: { x: number; y: number }): string | null {
  const life = ensureLife(w);
  if (life.clock < life.nextEncounter) return null;
  const l = getLayout(w);
  const p = life.player;
  const regionId = l.terrain.region[Math.floor(p.y) * 500 + Math.floor(p.x)];
  if (regionId < 0) return null;
  const v = l.villages[regionId];
  if (Math.hypot(p.x - v.cx, p.y - v.cy) < v.plazaR + 8) return null; // en el pueblo no
  const ctx = makeCtx(w);
  // RNG propio: los encuentros no alteran la secuencia del motor.
  ctx.rng = new Rng((w.seed ^ Math.floor(life.clock * 7919)) >>> 0);
  life.nextEncounter = life.clock + ctx.rng.int(70, 160);
  if (life.encounters.filter((e) => !e.resolved).length >= 2) return null;
  const kinds = candidateKinds(ctx, regionId);
  if (!kinds.length) return null;
  const kind = ctx.rng.weighted(kinds, (k) => k[1])![0];
  // Lugar: por delante del jugador, fuera de la vista inmediata.
  let spot: { x: number; y: number } | null = null;
  for (let tries = 0; tries < 30 && !spot; tries++) {
    const ang = Math.atan2(facing.y, facing.x) + ctx.rng.range(-0.9, 0.9);
    const d = ctx.rng.range(16, 26);
    const x = p.x + Math.cos(ang) * d;
    const y = p.y + Math.sin(ang) * d;
    if (passable(w, l, x, y) && passable(w, l, x + 1, y) && l.terrain.region[Math.floor(y) * 500 + Math.floor(x)] === regionId) spot = { x, y };
  }
  if (!spot) return null;
  const enc = build(ctx, kind, regionId, spot);
  if (!enc) return null;
  life.encounters.push(enc);
  return `${SOUNDS[kind]} ${dirWord(spot.x - p.x, spot.y - p.y)}.`;
}

function candidateKinds(ctx: Ctx, regionId: number): [string, number][] {
  const { w } = ctx;
  const r = w.regions[regionId];
  const nbs = r.neighbors.filter((n) => !w.regions[n].isHome);
  const out: [string, number][] = [];
  if (!r.isHome && nbs.length) out.push(['disputa', 1 + (r.flags.hambre ? 1 : 0) + Math.max(...nbs.map((n) => r.relations[n]?.tension ?? 0)) * 2]);
  if (w.regions.some((x) => x.flags.emigrando && (x.id === regionId || x.neighbors.includes(regionId)))) out.push(['refugiados', 2]);
  if (r.militancy > 0.5 || r.flags.guerra) out.push(['soldados', 2 + (r.flags.guerra ? 2 : 0)]);
  if (w.rumors.some((x) => !x.known && w.day <= x.expires)) out.push(['viajero', 1.5]);
  if (r.militancy > 0.4 || w.regions.some((x) => x.flags.guerra)) out.push(['herido', 0.8]);
  if (r.ecology < 0.5) out.push(['cazadores', 1.2]);
  if (r.flags.fiebre) out.push(['enfermo', 2]);
  if (w.mystery.kind === 'manipulador' && !w.mystery.solved && w.rumors.some((x) => x.origin === 'manipulador' && x.believers.includes(regionId))) out.push(['misterioso', 2.5]);
  if (hourOf(ensureLife(w).clock) > 18) out.push(['fogata', 1.5]);
  return out;
}

function pickFolk(ctx: Ctx, regionId: number, filter: (f: Folk) => boolean = () => true): Folk | undefined {
  const life = ensureLife(ctx.w);
  const pool = life.folk.filter((f) => f.alive && f.regionId === regionId && !f.charId && f.age >= 16 && filter(f));
  return pool.length ? ctx.rng.pick(pool) : undefined;
}

function build(ctx: Ctx, kind: string, regionId: number, spot: { x: number; y: number }): Encounter | null {
  const { w, rng } = ctx;
  const life = ensureLife(w);
  const r = w.regions[regionId];
  const base: Encounter = { id: `n${++life.seq}`, kind, regionId, x: spot.x, y: spot.y, day: w.day, truth: '', resolved: false, learned: [], announced: true };
  switch (kind) {
    case 'disputa': {
      const nbs = r.neighbors.filter((n) => !w.regions[n].isHome);
      const other = rng.pick(nbs);
      const a = pickFolk(ctx, regionId, (f) => f.role === 'comerciante' || f.role === 'campesino') ?? pickFolk(ctx, regionId);
      const b = pickFolk(ctx, other);
      if (!a || !b) return null;
      const tension = r.relations[other]?.tension ?? 0;
      const truth = rng.weighted(['robo', 'falso', 'ambos'], (t) => (t === 'robo' ? 1 + (r.flags.hambre ? 1 : 0) : t === 'falso' ? 1 : 0.6 + tension))!;
      return { ...base, folkA: a.id, folkB: b.id, otherRegion: other, truth };
    }
    case 'refugiados': {
      const origin = w.regions.find((x) => x.flags.emigrando && (x.id === regionId || x.neighbors.includes(regionId)))!;
      const a = pickFolk(ctx, origin.id) ?? pickFolk(ctx, regionId);
      return a ? { ...base, folkA: a.id, otherRegion: origin.id, truth: origin.flags.guerra ? 'guerra' : 'hambre' } : null;
    }
    case 'soldados': {
      const a = pickFolk(ctx, regionId, (f) => f.role === 'guardia') ?? pickFolk(ctx, regionId);
      const enemy = Object.entries(r.relations).filter(([id]) => !w.regions[Number(id)].isHome).sort((x, y) => y[1].tension - x[1].tension)[0];
      return a ? { ...base, folkA: a.id, otherRegion: enemy ? Number(enemy[0]) : undefined, truth: r.flags.guerra ? 'guerra' : 'tension' } : null;
    }
    case 'viajero': {
      const rumor = rng.pick(w.rumors.filter((x) => !x.known && w.day <= x.expires));
      const a = pickFolk(ctx, rumor.heardIn) ?? pickFolk(ctx, regionId);
      return a ? { ...base, folkA: a.id, rumorId: rumor.id, otherRegion: rumor.heardIn, truth: rumor.origin } : null;
    }
    case 'herido': {
      const warRegion = w.regions.find((x) => x.flags.guerra && x.neighbors.includes(regionId));
      const a = pickFolk(ctx, regionId, (f) => f.role !== 'nino');
      const enemy = Object.entries(r.relations).filter(([id]) => !w.regions[Number(id)].isHome).sort((x, y) => y[1].tension - x[1].tension)[0];
      return a ? { ...base, folkA: a.id, otherRegion: warRegion?.id ?? (enemy ? Number(enemy[0]) : undefined), truth: 'herido' } : null;
    }
    case 'cazadores':
    case 'enfermo':
    case 'fogata': {
      const a = pickFolk(ctx, regionId);
      const far = rng.pick(w.regions.filter((x) => !x.isHome && x.id !== regionId));
      return a ? { ...base, folkA: a.id, otherRegion: far.id, truth: kind } : null;
    }
    case 'misterioso': {
      const c = w.characters.find((x) => x.id === w.mystery.culpritCharacter);
      const a = c ? life.folk.find((f) => f.charId === c.id) : undefined;
      return a ? { ...base, folkA: a.id, otherRegion: w.mystery.culpritRegion, truth: 'manipulador' } : null;
    }
  }
  return null;
}

const folk = (w: WorldState, id?: string) => (id ? ensureLife(w).folk.find((f) => f.id === id) : undefined);

export function describeEncounter(w: WorldState, e: Encounter): EncounterView {
  const a = folk(w, e.folkA);
  const b = folk(w, e.folkB);
  const R = w.regions[e.regionId].name;
  const O = e.otherRegion !== undefined ? w.regions[e.otherRegion].name : '';
  const actors = [a, b].filter(Boolean).map((f) => ({ name: f!.name, role: ROLE_TITLE[f!.role], folkId: f!.id }));
  switch (e.kind) {
    case 'disputa':
      return { title: 'Una disputa en el camino', scene: `${a?.name}, de ${R}, sujeta por el brazo a ${b?.name}, que viene de ${O}. Un carro volcado, sacos por el suelo. Los dos gritan a la vez.`, actors };
    case 'refugiados':
      return { title: 'Gente que huye', scene: `Una familia de ${O} camina con todo lo que tiene a cuestas. Los niños van descalzos.`, actors };
    case 'soldados':
      return { title: 'Gente armada', scene: `Un grupo de guardias de ${R} corta el paso. Miran hacia ${O || 'la frontera'} con desconfianza.`, actors };
    case 'viajero':
      return { title: 'Un viajero', scene: `${a?.name} viene de ${O} con un hatillo al hombro. Parece tener ganas de contar algo.`, actors };
    case 'herido':
      return { title: 'Un herido', scene: `${a?.name} está sentado contra un árbol, con una herida mal vendada en la pierna.`, actors };
    case 'cazadores':
      return { title: 'Cazadores sin presa', scene: 'Dos cazadores vuelven con los arcos al hombro y las manos vacías.', actors };
    case 'enfermo':
      return { title: 'Alguien enfermo', scene: `${a?.name} tiembla de fiebre junto al agua.`, actors };
    case 'misterioso':
      return { title: 'Una conversación en voz baja', scene: `${a?.name}, un mercader, habla a media voz con unos campesinos. Cuando te ve, baja todavía más la voz.`, actors };
    case 'fogata':
      return { title: 'Una hoguera', scene: `${a?.name} y unos viajeros calientan las manos junto al fuego y comparten historias.`, actors };
  }
  return { title: '…', scene: '', actors };
}

export function encounterOptions(w: WorldState, e: Encounter): Option[] {
  const inv = ensureLife(w).player.inventory;
  const o: Option[] = [];
  switch (e.kind) {
    case 'disputa':
      if (!e.learned.includes('escuchar')) o.push({ id: 'escuchar', label: '👂 Escuchar a ambos' });
      if (!e.learned.includes('investigar')) o.push({ id: 'investigar', label: '🔎 Examinar la mercancía' });
      o.push({ id: 'razonA', label: 'Dar la razón al de aquí' }, { id: 'razonB', label: 'Dar la razón al forastero' }, { id: 'ambos', label: 'Acusar a los dos' });
      if (inv.comida > 0) o.push({ id: 'comida', label: '🍞 Dar comida y calmarlos' });
      break;
    case 'refugiados':
      o.push({ id: 'hablar', label: '💬 Preguntar qué ha pasado' });
      if (inv.comida > 0) o.push({ id: 'comida', label: '🍞 Darles comida' });
      o.push({ id: 'hogar', label: '🏠 Indicarles el camino a tu hogar' });
      break;
    case 'soldados':
      o.push({ id: 'hablar', label: '💬 Hablar con ellos' });
      if (inv.comida > 0) o.push({ id: 'comida', label: '🍞 Compartir tu comida' });
      break;
    case 'viajero':
      o.push({ id: 'escuchar', label: '👂 Escuchar su historia' }, { id: 'origen', label: '❓ Preguntar quién se lo contó' });
      break;
    case 'herido':
      if (inv.hierbas > 0) o.push({ id: 'curar', label: '🌿 Curarle con hierbas' });
      if (inv.comida > 0) o.push({ id: 'comida', label: '🍞 Darle comida' });
      o.push({ id: 'hablar', label: '💬 Preguntar qué le pasó' });
      break;
    case 'cazadores':
      o.push({ id: 'hablar', label: '💬 Preguntar por la caza' });
      break;
    case 'enfermo':
      if (inv.hierbas > 0) o.push({ id: 'curar', label: '🌿 Darle hierbas medicinales' });
      o.push({ id: 'hablar', label: '💬 Preguntar desde cuándo está así' });
      break;
    case 'misterioso':
      o.push({ id: 'escuchar', label: '👂 Escuchar a escondidas' }, { id: 'seguir', label: '🚶 Seguirle de lejos' }, { id: 'confrontar', label: '✋ Encararle' });
      break;
    case 'fogata':
      o.push({ id: 'escuchar', label: '🔥 Sentarte a escuchar' });
      break;
  }
  o.push({ id: 'irse', label: 'Seguir tu camino' });
  return o;
}

/** Resuelve una opción. Devuelve lo que ocurre y si el encuentro termina. */
export function resolveEncounter(w: WorldState, encId: string, opt: string): { lines: string[]; done: boolean } {
  const life = ensureLife(w);
  const e = life.encounters.find((x) => x.id === encId);
  if (!e) return { lines: ['Ya no hay nadie.'], done: true };
  const ctx = makeCtx(w);
  const gen = life.player.generation;
  const a = folk(w, e.folkA);
  const b = folk(w, e.folkB);
  const r = w.regions[e.regionId];
  const O = e.otherRegion !== undefined ? w.regions[e.otherRegion] : undefined;
  const lines: string[] = [];
  let done = false;
  const finish = (text: string, kind: 'accion' | 'consecuencia' | 'conflicto' = 'accion', causeId?: string) => {
    done = true;
    e.resolved = true;
    return record(ctx, { kind, text, regions: [r.id, ...(O ? [O.id] : [])], known: true, byPlayer: kind === 'accion', causeId });
  };

  switch (`${e.kind}:${opt}`) {
    case 'disputa:escuchar':
      e.learned.push('escuchar');
      lines.push(`${a?.name}: «¡Este de ${O?.name} me ha robado la mercancía mientras dormía!»`, `${b?.name}: «¡Mentira! La compré honradamente en el mercado de ${O?.name}.»`);
      if (e.truth === 'ambos') lines.push('Los dos evitan mirarse a los ojos.');
      break;
    case 'disputa:investigar':
      e.learned.push('investigar');
      lines.push(
        e.truth === 'robo' ? `Los sacos llevan la marca de la familia de ${a?.name}. Y hay barro de ${O?.name} en las ruedas.` : e.truth === 'falso' ? `El carro de ${a?.name} está intacto. Alguien comenta que perdió su mercancía jugando a los dados en la posada.` : 'Los sacos llevan la marca de un tercer pueblo. Ninguno de los dos dice la verdad.',
      );
      break;
    case 'disputa:razonA':
    case 'disputa:razonB':
    case 'disputa:ambos': {
      const right = opt === 'razonA' ? e.truth === 'robo' : opt === 'razonB' ? e.truth === 'falso' : e.truth === 'ambos';
      const wronged = opt === 'razonA' ? b : a;
      if (right) {
        lines.push('Tu juicio es justo. Los dos acaban aceptándolo, aunque a regañadientes.');
        if (a) remember(a, { day: w.day, kind: 'justicia', weight: 0.35 }, gen);
        if (b) remember(b, { day: w.day, kind: 'justicia', weight: 0.25 }, gen);
        if (O && r.relations[O.id]) r.relations[O.id].tension = clamp(r.relations[O.id].tension - 0.05);
        finish(`Mediaste en una disputa entre ${a?.name} de ${r.name} y ${b?.name} de ${O?.name}, con justicia.`);
      } else {
        lines.push(`${wronged?.name} te mira con rabia: «Así es la justicia de los forasteros.»`);
        if (wronged) remember(wronged, { day: w.day, kind: 'injusticia', weight: -0.5 }, gen);
        const ent = finish(`Juzgaste mal una disputa entre ${a?.name} de ${r.name} y ${b?.name} de ${O?.name}.`);
        if (O && r.relations[O.id]) {
          const e2 = record(ctx, { kind: 'conflicto', text: `La gente de ${opt === 'razonA' ? O.name : r.name} cuenta que un forastero los humilló en una disputa. Crece el recelo entre ${r.name} y ${O.name}.`, regions: [r.id, O.id], causeId: ent.id });
          for (const [x, y] of [[r, O], [O, r]]) if (x.relations[y.id]) (x.relations[y.id].tension = clamp(x.relations[y.id].tension + 0.08)), (x.relations[y.id].tensionCause = e2.id);
        }
      }
      break;
    }
    case 'disputa:comida':
      life.player.inventory.comida--;
      if (a) remember(a, { day: w.day, kind: 'comida', weight: 0.4 }, gen);
      if (b) remember(b, { day: w.day, kind: 'comida', weight: 0.3 }, gen);
      lines.push('Compartir el pan calma los ánimos. Se separan sin llegar a las manos, pero nada se ha aclarado.');
      finish(`Calmaste una disputa entre ${r.name} y ${O?.name} compartiendo tu comida.`);
      break;
    case 'disputa:irse': {
      lines.push('Sigues tu camino. A tu espalda, los gritos continúan.');
      done = true;
      e.resolved = true;
      // Ignorar puede escalar: la ofensa se vuelve asunto de pueblos.
      const rel = O ? r.relations[O.id] : undefined;
      if (O && rel && (rel.tension > 0.25 || e.truth !== 'falso') && ctx.rng.chance(0.6)) {
        const e2 = record(ctx, { kind: 'conflicto', text: `Una disputa entre ${a?.name} de ${r.name} y ${b?.name} de ${O.name} acabó a golpes. Ahora es una ofensa entre pueblos.`, regions: [r.id, O.id] });
        for (const [x, y] of [[r, O], [O, r]]) if (x.relations[y.id]) (x.relations[y.id].tension = clamp(x.relations[y.id].tension + 0.12)), (x.relations[y.id].opinion = clamp(x.relations[y.id].opinion - 0.08, -1, 1)), (x.relations[y.id].tensionCause = e2.id);
      }
      break;
    }
    case 'refugiados:hablar': {
      lines.push(e.truth === 'guerra' ? `«La guerra llegó a ${O?.name}. Quemaron nuestra casa.»` : `«En ${O?.name} ya no queda comida. Nos vamos antes de que sea tarde.»`);
      const rev = O ? revealRegionHistory(w, O.id, w.day - 20, 2) : [];
      for (const x of rev) lines.push(`Te cuentan: ${x.text}`);
      e.learned.push('hablar');
      break;
    }
    case 'refugiados:comida':
      life.player.inventory.comida--;
      if (a) remember(a, { day: w.day, kind: 'refugio', weight: 0.6 }, gen);
      lines.push('Te bendicen en su lengua. Uno de los niños no suelta tu mano hasta que se van.');
      finish(`Diste comida a una familia que huía de ${O?.name}.`);
      break;
    case 'refugiados:hogar':
      if (w.player.laws.hospitalidad && a) {
        a.origin = a.regionId;
        a.regionId = w.player.home;
        remember(a, { day: w.day, kind: 'refugio', weight: 0.7 }, gen);
        lines.push('Siguen tus indicaciones. Encontrarán sitio entre tu gente.');
        finish(`Acogiste en tu hogar a ${a.name} y su familia, que huían de ${O?.name}.`);
      } else {
        lines.push('«¿Nos dejarán entrar? Dicen que tus leyes cierran las puertas.» Tu ley de hospitalidad no está en vigor.');
      }
      break;
    case 'soldados:hablar':
      if (O) observe(ctx, O, 0.6, ['tension']);
      observe(ctx, r, 0.8, ['tension', 'animo']);
      lines.push(e.truth === 'guerra' ? `«Estamos en guerra con ${O?.name}. Si eres listo, no te acercarás a la frontera.»` : `«Dicen que ${O?.name} se arma. Nosotros solo nos preparamos.»`);
      e.learned.push('hablar');
      break;
    case 'soldados:comida':
      life.player.inventory.comida--;
      if (a) remember(a, { day: w.day, kind: 'comida', weight: 0.3 }, gen);
      lines.push(`Se relajan. Uno te confía: «${r.militancy > 0.6 ? 'El líder quiere atacar antes de que ataquen ellos.' : 'Nadie quiere esta guerra, de verdad.'}»`);
      observe(ctx, r, 0.9, ['tension']);
      finish(`Compartiste tu comida con los guardias de ${r.name}.`);
      break;
    case 'viajero:escuchar': {
      const ru = w.rumors.find((x) => x.id === e.rumorId);
      if (ru) {
        makeKnown(ctx, ru);
        lines.push(`«${ru.text}»`, 'Lo cuenta como si fuera verdad. Quién sabe.');
      }
      e.learned.push('escuchar');
      break;
    }
    case 'viajero:origen': {
      const ru = w.rumors.find((x) => x.id === e.rumorId);
      if (ru?.origin === 'manipulador') {
        lines.push(`«Me lo contó un mercader de ${w.regions[w.mystery.culpritRegion].name}, muy bien vestido. Invitaba a beber a todo el mundo.»`);
        foundFragment(ctx, 'm_visto');
      } else if (ru?.origin === 'jugador') lines.push('«Lo oí en la plaza. Dicen que lo empezó gente de fuera.» Se te encoge el estómago.');
      else lines.push(ru ? `«Lo oí en ${w.regions[ru.heardIn].name}, en la posada. Todo el mundo hablaba de ello.»` : '«Ya ni me acuerdo.»');
      finish(`Hablaste con un viajero en ${r.name}.`);
      break;
    }
    case 'herido:curar':
      life.player.inventory.hierbas--;
      if (a) remember(a, { day: w.day, kind: 'salvado', weight: 0.8 }, gen);
      lines.push(`«Me salvas la pierna… y quizá la vida. Nos atacaron cerca de ${O?.name ?? 'la frontera'}.»`);
      if (O) observe(ctx, O, 0.8, ['tension']);
      finish(`Curaste a ${a?.name}, herido cerca de ${O?.name ?? r.name}.`);
      break;
    case 'herido:comida':
      life.player.inventory.comida--;
      if (a) remember(a, { day: w.day, kind: 'comida', weight: 0.4 }, gen);
      lines.push('Come con ansia. Te da las gracias con un gesto.');
      finish(`Ayudaste a un herido en ${r.name}.`);
      break;
    case 'herido:hablar':
      lines.push(`«Exploradores como yo vuelven heridos cada vez más a menudo. ${O ? `Algo pasa en ${O.name}.` : ''}»`);
      e.learned.push('hablar');
      break;
    case 'cazadores:hablar': {
      observe(ctx, r, 0.8, ['ecologia']);
      const cause = [...w.entries].reverse().find((x) => !x.known && x.regions.includes(r.id) && (x.kind === 'ecologia' || x.byPlayer));
      if (cause) cause.known = true;
      lines.push('«Antes había ciervos hasta en el camino. Desde que se explota tanto la tierra, ni rastro.»', cause ? `Uno añade: «${cause.text}»` : '');
      finish(`Hablaste con unos cazadores en ${r.name}.`);
      break;
    }
    case 'enfermo:curar':
      life.player.inventory.hierbas--;
      if (a) remember(a, { day: w.day, kind: 'salvado', weight: 0.8 }, gen);
      lines.push('La fiebre baja un poco. «Bebíamos del río… todos los enfermos bebíamos del río.»');
      foundFragment(ctx, 'f_rio');
      finish(`Atendiste a ${a?.name}, enfermo de fiebre en ${r.name}.`);
      break;
    case 'enfermo:hablar':
      lines.push('«Desde que el agua baja turbia. Primero los de la orilla, luego los demás.»');
      if (w.mystery.kind === 'rio') foundFragment(ctx, 'f_rio');
      e.learned.push('hablar');
      break;
    case 'misterioso:escuchar':
      lines.push(`«…y dicen que los de al lado se arman. Yo de vosotros compraría lanzas. Tengo buen precio.»`);
      foundFragment(ctx, 'm_forastero');
      e.learned.push('escuchar');
      break;
    case 'misterioso:seguir':
      lines.push(`Le sigues de lejos. Toma el camino hacia ${O?.name} y entra en un almacén lleno de armas.`);
      foundFragment(ctx, 'm_hierro');
      finish(`Seguiste a un mercader sospechoso hasta ${O?.name}.`);
      break;
    case 'misterioso:confrontar':
      lines.push('«¿Me acusas de algo, forastero? Ten cuidado con lo que dices.» Se marcha sin prisa.');
      if (a) remember(a, { day: w.day, kind: 'ofensa', weight: -0.4 }, gen);
      finish(`Encaraste a un mercader sospechoso en ${r.name}.`);
      break;
    case 'fogata:escuchar': {
      const rev = O ? revealRegionHistory(w, O.id, w.day - 40, 2) : [];
      lines.push(rev.length ? `Cuentan historias de ${O?.name}:` : 'Cantan viejas canciones sobre tiempos mejores.');
      for (const x of rev) lines.push(`«${x.text}»`);
      finish(`Pasaste la noche junto a una hoguera en ${r.name}.`);
      break;
    }
    default:
      lines.push('Sigues tu camino.');
      done = true;
      e.resolved = true;
  }
  commitCtx(ctx);
  return { lines: lines.filter(Boolean), done };
}
