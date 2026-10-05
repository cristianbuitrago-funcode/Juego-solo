import { record } from '../core/chronicle';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx } from '../core/world';
import { hourOf } from './clock';
import { remember, ROLE_TITLE } from './folk';
import { addScore, chanceOf, deed, gain, story, type GainNote } from './identity';
import { doorOf, getLayout, nearestWalkable } from './layout';
import { passable } from './path';
import type { Folk, Life } from './types';

/**
 * El prólogo: los primeros días. No es una misión lineal; son unas pocas
 * situaciones colocadas en un mundo que sigue funcionando solo. Enseñan sin
 * tutoriales: una mochila que no recuerdas, alguien que te encuentra en el
 * camino, un pueblo que vive a su ritmo, una herramienta que tus manos saben
 * arreglar, una caja perdida, dos vecinos que se pelean por el agua… y, al
 * final, una carta con el símbolo de tu colgante. Nada tiene una respuesta
 * correcta: el mundo solo reacciona.
 */
export interface Pt {
  x: number;
  y: number;
}

export interface Prologue {
  v: 1;
  wake: Pt;
  bag: Pt & { opened: boolean };
  hut: Pt;
  road: Pt; // donde está la primera persona que encuentras
  first: string;
  inn: string;
  merchant: string;
  kid: string;
  artisan: string;
  a: string; // vecinos de la acequia
  b: string;
  met: boolean;
  firstTone?: 'amable' | 'brusco';
  arrived: boolean;
  objective: string | null;
  innHint: boolean;
  workHint: boolean;
  repair: 0 | 1 | 2 | 3;
  crate: 'none' | 'lost' | 'searching' | 'found' | 'returned' | 'kept' | 'sold' | 'covered' | 'ignored';
  crateSpot: Pt;
  crateTruth: 'nino' | 'caida';
  crateClues: string[];
  crateDay: number;
  water: 'none' | 'active' | 'a' | 'b' | 'mediated' | 'failed' | 'lied' | 'ignored';
  waterSpot: Pt;
  waterLearned: string[];
  encId?: string;
  effects: { day: number; id: string }[];
  log: { day: number; kind: 'persona' | 'lugar' | 'habilidad' | 'decision'; text: string }[];
  recapDay: number;
  clue: 'none' | 'ready' | 'given';
  nightHint: boolean;
  seen: string[];
  crateMoved?: boolean;
}

export function prologueOf(w: WorldState): Prologue | undefined {
  return w.life?.prologue;
}

// ---------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------
export function setupPrologue(w: WorldState, life: Life): void {
  const l = getLayout(w);
  const v = l.villages[w.player.home];
  const me = life.player;
  const home = life.folk.filter((f) => f.alive && f.regionId === w.player.home && !f.charId);
  const used = new Set<string>();
  const take = (pred: (f: Folk) => boolean): Folk => {
    const f = home.find((x) => !used.has(x.id) && x.age >= 16 && pred(x)) ?? home.find((x) => !used.has(x.id) && x.age >= 16)!;
    used.add(f.id);
    return f;
  };
  const kid = home.find((f) => f.role === 'nino') ?? take(() => true);
  used.add(kid.id);
  const inn = home.some((f) => f.role === 'posadero' && f.age >= 16) ? take((f) => f.role === 'posadero') : take((f) => f.role === 'anciano');
  const merchant = take((f) => f.role === 'comerciante');
  const first = take((f) => f.role === 'campesino' || f.role === 'pastor');
  const artisan = take((f) => f.role === 'artesano');
  const a = take((f) => f.role === 'campesino' || f.role === 'pastor');
  const b = take((f) => f.role === 'campesino' || f.role === 'pastor');
  // Lugares: la mochila junto a ti, una cabaña vacía, la persona en el camino.
  const toward = { x: v.cx + 0.5 - me.x, y: v.cy + 0.5 - me.y };
  const d = Math.hypot(toward.x, toward.y) || 1;
  const ux = toward.x / d;
  const uy = toward.y / d;
  const at = (k: number, side: number): Pt => nearestWalkable(l, me.x + ux * k - uy * side, me.y + uy * k + ux * side);
  const bag = at(1.6, 1.4);
  // La cabaña: un hueco libre a un lado del camino, sin tapar el paso.
  const free = (cx: number, cy: number) => {
    for (let j = -3; j <= 1; j++) for (let i = -3; i <= 2; i++) if (!passable(w, l, cx + i, cy + j)) return false;
    return Math.hypot(cx - me.x, cy - me.y) > 3.5;
  };
  let hut = { x: Math.round(me.x - uy * 6), y: Math.round(me.y + ux * 6) };
  search: for (let r = 5; r < 14; r++)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const c = { x: Math.round(me.x + Math.cos(a) * r), y: Math.round(me.y + Math.sin(a) * r) };
      if (free(c.x, c.y)) {
        hut = c;
        break search;
      }
    }
  const road = at(Math.min(d * 0.4, 10), 0.5);
  // La caja: caída junto al carro del almacén; la acequia: junto al primer campo.
  const crateSpot = crateSpotOf(w);
  const field = v.fields[0];
  const waterSpot = field ? nearestWalkable(l, field.x + field.w / 2, field.y + field.h + 1) : nearestWalkable(l, v.cx + 12, v.cy + 6);
  life.prologue = {
    v: 1,
    wake: { x: me.x, y: me.y },
    bag: { ...bag, opened: false },
    hut,
    road,
    first: first.id,
    inn: inn.id,
    merchant: merchant.id,
    kid: kid.id,
    artisan: artisan.id,
    a: a.id,
    b: b.id,
    met: false,
    arrived: false,
    objective: 'Descubre dónde estás',
    innHint: false,
    workHint: false,
    repair: 0,
    crate: 'none',
    crateSpot,
    crateTruth: (w.seed & 1) === 0 ? 'nino' : 'caida',
    crateClues: [],
    crateDay: -1,
    water: 'none',
    waterSpot,
    waterLearned: [],
    effects: [],
    log: [],
    recapDay: 0,
    clue: 'none',
    nightHint: false,
    seen: [],
    crateMoved: true,
  };
  // Las manos saben arreglar cosas: es la primera grieta en el olvido.
  const id = life.identity!;
  id.latent.artesania = Math.max(id.latent.artesania ?? 0, 1);
}

/** Donde cayó la caja: junto al carro del almacén (lo que el comerciante dice), a la vista desde la plaza. */
export function crateSpotOf(w: WorldState): Pt {
  const l = getLayout(w);
  const v = l.villages[w.player.home];
  const st = v.keys.find((k) => k.kind === 'almacen') ?? v.keys[0];
  if (!st) return nearestWalkable(l, v.cx + 2, v.cy + 2);
  const cart = v.props.filter((pr) => pr.kind === 'carro').sort((a, b) => Math.hypot(a.x - st.x, a.y - st.y) - Math.hypot(b.x - st.x, b.y - st.y))[0];
  if (cart && Math.hypot(cart.x - st.x, cart.y - st.y) < 9) return nearestWalkable(l, cart.x + 1.4, cart.y + 0.6);
  return nearestWalkable(l, st.x + st.w + 1.5, st.y + st.h + 1.5);
}

/** «Al norte de la plaza», «al este»…: para que las indicaciones sirvan de algo. */
export function sideOf(w: WorldState, pt: Pt): string {
  const v = getLayout(w).villages[w.player.home];
  const dx = pt.x - v.cx;
  const dy = pt.y - v.cy;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'al este de la plaza' : 'al oeste de la plaza') : dy > 0 ? 'al sur de la plaza' : 'al norte de la plaza';
}

const folk = (w: WorldState, id: string) => w.life!.folk.find((f) => f.id === id);

export function logDay(w: WorldState, kind: Prologue['log'][number]['kind'], text: string): void {
  const p = prologueOf(w);
  if (p) p.log.push({ day: w.day, kind, text });
}

// ---------------------------------------------------------------------------
// Rutinas: los personajes del prólogo siguen su vida, salvo en sus momentos
// ---------------------------------------------------------------------------
export interface Override {
  x: number;
  y: number;
  inside: boolean;
  activity: string;
}

export function prologueRoutine(w: WorldState, f: Folk, clock: number): Override | null {
  const p = prologueOf(w);
  if (!p) return null;
  const h = hourOf(clock);
  const l = getLayout(w);
  const v = l.villages[w.player.home];
  if (f.id === p.first && !p.met && w.day === 1 && h < 14) return { ...p.road, inside: false, activity: 'recoge leña junto al camino' };
  if (f.id === p.inn && h >= 7 && h < 23.5) {
    const posada = v.keys.find((k) => k.kind === 'posada');
    if (posada) {
      const dd = doorOf(posada);
      return { x: dd.x + 0.6, y: dd.y + 0.8, inside: false, activity: 'atiende la posada' };
    }
  }
  if (f.id === p.merchant && (p.crate === 'lost' || p.crate === 'searching') && h >= 8 && h < 21) {
    const st = v.stalls[0] ?? { x: v.cx + 2, y: v.cy };
    return { x: st.x + 0.4, y: st.y + 1.2, inside: false, activity: 'busca su caja perdida, cuenta sus cosas' };
  }
  if ((f.id === p.a || f.id === p.b) && p.water === 'active' && h >= 7.5 && h < 19) {
    return { x: p.waterSpot.x + (f.id === p.a ? -0.7 : 0.7), y: p.waterSpot.y, inside: false, activity: 'discute a gritos junto a la acequia' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Objetos del prólogo en el mundo
// ---------------------------------------------------------------------------
export interface PItem {
  id: 'mochila' | 'caja' | 'cabana' | 'brasas';
  x: number;
  y: number;
  label?: string; // si tiene etiqueta, se puede interactuar
}

export function prologueItems(w: WorldState): PItem[] {
  const p = prologueOf(w);
  if (!p) return [];
  const out: PItem[] = [{ id: 'cabana', x: p.hut.x, y: p.hut.y }, { id: 'brasas', x: p.wake.x - 1.2, y: p.wake.y + 0.6, label: w.day === 1 ? 'Restos de una hoguera' : undefined }];
  if (!p.bag.opened) out.push({ id: 'mochila', x: p.bag.x, y: p.bag.y, label: 'Una mochila' });
  if (p.crate === 'lost' || p.crate === 'searching') out.push({ id: 'caja', x: p.crateSpot.x, y: p.crateSpot.y, label: 'Una caja tirada' });
  return out;
}

/** Celdas que tapa la cabaña (para que no se pueda atravesar). */
export function prologueBlocks(w: WorldState): Pt[] {
  const p = prologueOf(w);
  if (!p) return [];
  const out: Pt[] = [];
  for (let j = -2; j <= 0; j++) for (let i = -2; i <= 1; i++) out.push({ x: p.hut.x + i, y: p.hut.y + j });
  return out;
}

// ---------------------------------------------------------------------------
// Pequeño motor de escenas: lo que se dice y lo que puedes responder
// ---------------------------------------------------------------------------
export interface PChoice {
  id: string;
  label: string;
  hint?: string;
}

export interface PScene {
  id: string;
  title: string;
  sub?: string;
  lines: string[];
  choices: PChoice[];
  folk?: string;
  flash?: boolean; // recuerdo: pantalla borrosa
  letter?: boolean; // muestra el emblema
  minutes?: number;
  notes?: GainNote[];
}

export type PTarget = { kind: 'folk'; id: string } | { kind: 'item'; id: string } | { kind: 'posada' };

const end = (id: string, title: string, lines: string[], extra: Partial<PScene> = {}): PScene => ({ id, title, lines, choices: [{ id: 'ok', label: 'Seguir' }], ...extra });

/** ¿Tiene el prólogo algo especial para esto? Si no, el juego sigue con lo normal. */
export function prologueScene(w: WorldState, t: PTarget): PScene | null {
  const p = prologueOf(w);
  if (!p) return null;
  const life = w.life!;
  const id = life.identity!;
  if (t.kind === 'item') {
    if (t.id === 'mochila' && !p.bag.opened)
      return {
        id: 'bag',
        title: 'Una mochila',
        lines: ['Una mochila de cuero gastado, medio escondida entre la hierba. No recuerdas haberla visto antes.', 'Pero las correas tienen la forma de unos hombros. Quizá los tuyos.'],
        choices: [{ id: 'abrir', label: 'Abrirla' }, { id: 'dejar', label: 'Dejarla donde está' }],
      };
    if (t.id === 'brasas') {
      const first = !p.seen.includes('brasas');
      if (first) p.seen.push('brasas');
      return end('brasas', 'Restos de una hoguera', ['Ceniza todavía tibia. Alguien durmió aquí anoche.', 'Junto a las piedras, la hierba está aplastada con la forma de un cuerpo. Del tuyo.'], { notes: first ? gain(w, 'investigacion', 0.4) : [] });
    }
    if (t.id === 'caja' && (p.crate === 'lost' || p.crate === 'searching')) {
      const m = folk(w, p.merchant);
      return {
        id: 'crate',
        title: 'Una caja tirada',
        lines: ['Una caja de madera con una marca pintada: la misma que el puesto de ' + (m?.name ?? 'un comerciante') + '. Dentro, tarros de miel y un saquito de especias.', ...(p.crateClues.length ? [] : ['Hay algo raro alrededor.'])],
        choices: [
          { id: 'devolver', label: `Llevársela a ${m?.name ?? 'su dueño'}` },
          { id: 'examinar', label: 'Examinar alrededor' },
          { id: 'quedar', label: 'Quedártela', hint: 'Nadie te ha visto… o eso crees.' },
          { id: 'vender', label: 'Venderla en la posada', hint: 'Algo de dinero rápido.' },
          { id: 'dejar', label: 'Dejarla ahí' },
        ],
      };
    }
    return null;
  }
  if (t.kind === 'posada') {
    const inn = folk(w, p.inn);
    if (p.clue === 'ready')
      return {
        id: 'letter',
        title: inn ? `${inn.name}, en la posada` : 'En la posada',
        lines: [`«Espera», te dice ${inn?.name ?? 'quien lleva la posada'}, y saca algo de debajo del mostrador. «Un viajero se dejó esto hace semanas. Lleva el mismo dibujo que ese colgante tuyo. Pensé que…»`, 'Es un sobre de papel grueso, sin nombre. Sellado con cera.'],
        choices: [{ id: 'abrir', label: 'Abrirlo' }, { id: 'guardar', label: 'Guardarlo sin abrir' }],
        folk: p.inn,
      };
    return null;
  }
  // Personas.
  const f = folk(w, t.id);
  if (!f) return null;
  if (f.id === p.first && !p.met)
    return {
      id: 'first:1',
      title: f.name,
      lines: [`${f.name} deja caer el haz de leña al verte. «¿Te encuentras bien? Tienes una cara…»`],
      choices: [
        { id: 'no', label: '«No lo sé… no recuerdo cómo llegué aquí.»' },
        { id: 'bien', label: '«Estoy bien. ¿Dónde estoy?»' },
        { id: 'brusco', label: '«Eso no es asunto tuyo.»' },
      ],
      folk: f.id,
    };
  if (f.id === p.artisan && p.repair < 3 && p.arrived)
    return {
      id: p.repair === 0 ? 'repair:0' : 'repair:1',
      title: `${f.name}, ${ROLE_TITLE[f.role]}`,
      lines: p.repair === 0 ? [`${f.name} lucha con una azada: el mango está partido y la hoja se ha soltado. «¿Buscas trabajo? Pues coge esto y sujeta. O mejor, arréglalo tú si sabes.»`] : [`${f.name} te mira con la azada todavía rota en las manos. «¿Otra vez?»`],
      choices: [
        { id: 'probar', label: 'Intentar arreglarla' },
        ...(p.repair >= 1 ? [{ id: 'mirar', label: `Observar cómo lo hace ${f.name}` }] : []),
        { id: 'luego', label: 'Ahora no' },
      ],
      folk: f.id,
    };
  if (f.id === p.merchant && (p.crate === 'lost' || p.crate === 'searching'))
    return {
      id: 'merchant:lost',
      title: `${f.name}, ${ROLE_TITLE[f.role]}`,
      lines: [`«¡Mi caja! La traía esta mañana del carro y ha desaparecido. Miel de la buena y especias que valen más que tú y que yo juntos.»`, p.crate === 'searching' ? '«¿Has encontrado algo?»' : '«No sé si se cayó o si alguien la cogió.»'],
      choices: [
        ...(p.crate === 'lost' ? [{ id: 'buscar', label: '«Te ayudo a buscarla.»' }] : []),
        { id: 'donde', label: '«¿Dónde la viste por última vez?»' },
        { id: 'nada', label: 'Encogerte de hombros y seguir' },
      ],
      folk: f.id,
    };
  if (f.id === p.kid && p.crateClues.includes('huellas') && (p.crate === 'lost' || p.crate === 'searching' || p.crate === 'found'))
    return {
      id: 'kid:ask',
      title: f.name,
      lines: [`${f.name} tiene los dedos pegajosos. Cuando le miras, esconde las manos detrás de la espalda.`],
      choices: [{ id: 'preguntar', label: '«¿Sabes algo de una caja con miel?»' }, { id: 'dejar', label: 'Dejarlo estar' }],
      folk: f.id,
    };
  if (f.id === p.inn && !p.innHint && p.arrived)
    return {
      id: 'inn:1',
      title: `${f.name}, en la posada`,
      lines: [`«Forastero, ¿eh? Se te nota en las botas.» ${f.name} te mide con la mirada. «Si buscas dónde pasar la noche, aquí hay camas. Dos monedas. Y si no tienes, ${folk(w, p.artisan)?.name ?? 'el artesano'} siempre anda buscando manos.»`, id.needs.hunger > 0.5 ? '«Y come algo, que pareces un fantasma.»' : '«Mañana por la mañana habrá mercado en la plaza. Se llena de gente.»'],
      choices: [{ id: 'gracias', label: '«Gracias.»' }],
      folk: f.id,
    };
  return null;
}

/** Elegir una opción. Devuelve la siguiente escena o null si termina. */
export function prologueChoose(w: WorldState, sceneId: string, choice: string): PScene | null {
  const p = prologueOf(w)!;
  const life = w.life!;
  const id = life.identity!;
  const gen = life.player.generation;
  const inv = life.player.inventory;
  const home = w.regions[w.player.home];
  const ctx = makeCtx(w);
  const done = (s: PScene | null) => (commitCtx(ctx), s);
  switch (`${sceneId}:${choice}`) {
    // --- La mochila -------------------------------------------------------
    case 'bag:abrir':
      p.bag.opened = true;
      inv.comida += 2;
      id.needs.coins += 3;
      id.items.push('llave', 'cuaderno');
      story(w, 'Encontró una mochila que no recordaba: algo de comida, unas monedas, una llave y un cuaderno con páginas arrancadas.', 'memoria');
      logDay(w, 'lugar', 'Encontraste una mochila que no recordabas.');
      return done(end('bag:open', 'Dentro de la mochila', ['Pan duro y queso envueltos en un paño. Tres monedas de cobre.', 'Una llave pequeña de hierro, con una muesca en forma de media luna. No sabes qué abre.', 'Un cuaderno con la mitad de las páginas arrancadas. En las que quedan, la letra se inclina igual que la tuya cuando intentas escribir en la tierra con un palo.', 'No explica nada. Solo hace más preguntas.']));
    case 'bag:dejar':
      return done(null);
    // --- La primera persona -----------------------------------------------
    case 'first:1:no':
    case 'first:1:bien':
    case 'first:1:brusco': {
      p.met = true;
      const f = folk(w, p.first)!;
      f.lastMet = w.day;
      if (choice === 'brusco') {
        p.firstTone = 'brusco';
        remember(f, { day: w.day, kind: 'ofensa', weight: -0.3 }, gen);
        return done({ id: 'first:2', title: f.name, lines: [`${f.name} levanta las manos. «Vale, vale. Solo preguntaba.» Recoge su leña. «El pueblo está siguiendo el camino. ${home.name}. Haz lo que quieras.»`], choices: [{ id: 'ok', label: 'Seguir' }], folk: f.id });
      }
      p.firstTone = 'amable';
      remember(f, { day: w.day, kind: 'conversacion', weight: 0.15 }, gen);
      const lines = choice === 'no'
        ? [`«¿No recuerdas?» ${f.name} frunce el ceño. «¿Ni tu nombre?»`, 'Niegas con la cabeza. Duele un poco.']
        : [`«Estás en tierras de ${home.name}.» ${f.name} te mira las botas embarradas. «Vienes de lejos, eso seguro.»`];
      return done({
        id: 'first:2',
        title: f.name,
        lines: [...lines, `«Si quieres llegar al pueblo antes de que anochezca, sigue el camino. ${home.name} no es gran cosa, pero hay posada y gente decente.»`],
        choices: [
          { id: 'lugar', label: '«¿Qué lugar es este?»' },
          { id: 'comer', label: '«¿Dónde puedo comer algo?»' },
          { id: 'visto', label: '«¿Has visto a alguien más por aquí?»' },
          { id: 'ok', label: '«Gracias.»' },
        ],
        folk: f.id,
      });
    }
    case 'first:2:lugar':
      return done({ id: 'first:2', title: folk(w, p.first)!.name, lines: [`«${home.name}. Campos, un río y un consejo que discute por todo. Más allá están las otras tierras, pero yo nunca he ido más lejos del mercado.»`], choices: [{ id: 'comer', label: '«¿Dónde puedo comer algo?»' }, { id: 'visto', label: '«¿Has visto a alguien más por aquí?»' }, { id: 'ok', label: '«Gracias.»' }], folk: p.first, notes: gain(w, 'k:geografia', 0.5) });
    case 'first:2:comer':
      p.innHint = false;
      return done({ id: 'first:2', title: folk(w, p.first)!.name, lines: [`«En la posada, junto a la plaza. Habla con ${folk(w, p.inn)!.name}. Y si no tienes con qué pagar…» Se rasca la cabeza. «Siempre hay alguien que necesita un par de manos.»`], choices: [{ id: 'lugar', label: '«¿Qué lugar es este?»' }, { id: 'visto', label: '«¿Has visto a alguien más por aquí?»' }, { id: 'ok', label: '«Gracias.»' }], folk: p.first });
    case 'first:2:visto':
      return done({ id: 'first:2', title: folk(w, p.first)!.name, lines: ['«Anoche vi una hoguera ahí abajo. Pensé que eran pastores.» Te mira de arriba abajo. «Quizá eras tú.»'], choices: [{ id: 'lugar', label: '«¿Qué lugar es este?»' }, { id: 'comer', label: '«¿Dónde puedo comer algo?»' }, { id: 'ok', label: '«Gracias.»' }], folk: p.first, notes: gain(w, 'investigacion', 0.4) });
    case 'first:2:ok':
      if (p.objective === 'Descubre dónde estás') p.objective = `Sigue el camino hasta ${home.name}`;
      return done(null);
    // --- La posada ---------------------------------------------------------
    case 'inn:1:gracias':
      p.innHint = true;
      folk(w, p.inn)!.lastMet = w.day;
      return done(null);
    // --- La herramienta ----------------------------------------------------
    case 'repair:0:probar':
    case 'repair:1:probar': {
      const f = folk(w, p.artisan)!;
      f.lastMet = w.day;
      if (p.repair < 2) {
        p.repair = 1;
        return done({ id: 'repair:1', title: f.name, lines: ['Coges la azada y el mango nuevo. No estás seguro de cómo encajarlos.', 'Lo intentas a la fuerza. La cuña se escurre y cae al suelo.', `${f.name} se ríe. «No es así. Mira.»`], choices: [{ id: 'mirar', label: `Observar cómo lo hace ${f.name}` }, { id: 'probar', label: 'Intentarlo otra vez a tu manera' }, { id: 'luego', label: 'Dejarlo' }], folk: f.id, minutes: 20, notes: gain(w, 'artesania', 0.4) });
      }
      return done(repairSuccess(w));
    }
    case 'repair:0:mirar':
    case 'repair:1:mirar': {
      const f = folk(w, p.artisan)!;
      p.repair = 2;
      return done({ id: 'repair:2', title: f.name, lines: [`${f.name} calienta la cuña, la moja, la encaja de lado y la golpea dos veces. Gira el mango un cuarto. Golpea otra vez.`, 'Lo miras. Y por un momento, sabes cuál va a ser el siguiente golpe antes de que llegue.'], choices: [{ id: 'probar', label: 'Intentarlo otra vez' }], folk: f.id, minutes: 15 });
    }
    case 'repair:2:probar':
      return done(repairSuccess(w));
    case 'repair:flash:ok':
      return done(end('repair:after', 'Un recuerdo', ['La imagen se deshace. Tienes la azada arreglada en las manos y el corazón acelerado.', 'No sabes quién era esa persona.']));
    // --- La caja -----------------------------------------------------------
    case 'merchant:lost:buscar':
      p.crate = 'searching';
      p.objective = `Busca la caja de ${folk(w, p.merchant)!.name}, junto al almacén`;
      remember(folk(w, p.merchant)!, { day: w.day, kind: 'ayuda', weight: 0.1 }, gen);
      folk(w, p.merchant)!.lastMet = w.day;
      return done(end('merchant:ok', folk(w, p.merchant)!.name, [`«¿De verdad? Que los dioses te lo paguen, porque yo no puedo. Estaba en el carro, junto al almacén, ${sideOf(w, p.crateSpot)}. Quizá se cayó por ahí.»`]));
    case 'merchant:lost:donde':
      if (!p.objective) p.objective = `La caja de ${folk(w, p.merchant)!.name}: junto al almacén`;
      folk(w, p.merchant)!.lastMet = w.day;
      return done(end('merchant:ok', folk(w, p.merchant)!.name, [`«En el carro, junto al almacén, ${sideOf(w, p.crateSpot)}. Fui a por agua y cuando volví ya no estaba.»`]));
    case 'merchant:lost:nada':
      folk(w, p.merchant)!.lastMet = w.day;
      return done(null);
    case 'crate:examinar': {
      p.crateClues.push('huellas');
      const kid = folk(w, p.kid)!;
      const notes = gain(w, 'investigacion', 1.2);
      const lines = p.crateTruth === 'nino'
        ? [`Hay huellas pequeñas, de pies descalzos, y un rastro de gotas de miel que va hacia las casas. Alguien ha metido el dedo en un tarro.`, `Te acuerdas de alguien pequeño que corría por la plaza: ${kid.name}.`]
        : ['Las ruedas del carro dejaron un surco en el barro: la caja cayó en el bache. Nadie se la llevó… pero hay huellas pequeñas alrededor, y alguien ha metido el dedo en un tarro de miel.', `Te acuerdas de alguien pequeño que corría por la plaza: ${kid.name}.`];
      return done({ id: 'crate', title: 'Una caja tirada', lines, choices: [{ id: 'devolver', label: `Llevársela a ${folk(w, p.merchant)!.name}` }, { id: 'quedar', label: 'Quedártela' }, { id: 'vender', label: 'Venderla en la posada' }, { id: 'dejar', label: 'Dejarla ahí' }], notes });
    }
    case 'crate:devolver': {
      const m = folk(w, p.merchant)!;
      p.crate = 'returned';
      remember(m, { day: w.day, kind: 'ayuda', weight: 0.6 }, gen);
      m.trust = clamp(m.trust + 0.15);
      m.lastMet = w.day;
      addScore(w, w.player.home, 4);
      deed(id, 'ayudar');
      id.needs.coins += 1;
      story(w, `Devolvió a ${m.name} una caja que había perdido.`, 'decision');
      logDay(w, 'decision', `Devolviste la caja de ${m.name}.`);
      p.effects.push({ day: w.day + 1, id: 'crate:returned' });
      return done(end('crate:end', m.name, [`${m.name} abre la caja, cuenta los tarros y suspira. «Están todos. Bueno, casi.» Te pone una moneda en la mano. «No es mucho. Pero no lo olvidaré.»`]));
    }
    case 'crate:quedar':
      p.crate = 'kept';
      inv.comida += 2;
      deed(id, 'enganar');
      story(w, 'Se quedó una caja de miel que no era suya.', 'decision');
      logDay(w, 'decision', 'Te quedaste una caja que no era tuya.');
      p.effects.push({ day: w.day + 1, id: 'crate:kept' });
      return done(end('crate:end', 'La caja', ['Escondes la miel y las especias en la mochila. Pesa más de lo que debería.'], { notes: gain(w, 'sigilo', 0.8) }));
    case 'crate:vender': {
      p.crate = 'sold';
      id.needs.coins += 3;
      deed(id, 'enganar');
      deed(id, 'comerciar');
      const inn = folk(w, p.inn)!;
      inn.lastMet = w.day;
      story(w, `Vendió en la posada una caja que no era suya.`, 'decision');
      logDay(w, 'decision', 'Vendiste una caja que no era tuya.');
      p.effects.push({ day: w.day + 1, id: 'crate:sold' });
      return done(end('crate:end', inn.name, [`${inn.name} levanta una ceja al ver la marca, pero paga: tres monedas. «No te pregunto de dónde sale.»`], { notes: gain(w, 'comercio', 0.8) }));
    }
    case 'crate:dejar':
      return done(null);
    case 'kid:ask:preguntar': {
      const kid = folk(w, p.kid)!;
      kid.lastMet = w.day;
      return done({
        id: 'kid:2',
        title: kid.name,
        lines: p.crateTruth === 'nino' ? [`A ${kid.name} se le encienden las mejillas. «La… la escondí. Solo quería probar la miel. Si se entera, me mata.»`] : [`A ${kid.name} se le encienden las mejillas. «Estaba tirada en el barro, ¡lo juro! Solo probé un poco. No se lo digas.»`],
        choices: [
          { id: 'contar', label: `Contárselo a ${folk(w, p.merchant)!.name}` },
          { id: 'cubrir', label: '«Devuélvela y no diré nada.»' },
          { id: 'dejar', label: 'No meterte' },
        ],
        folk: kid.id,
      });
    }
    case 'kid:2:contar': {
      const kid = folk(w, p.kid)!;
      const m = folk(w, p.merchant)!;
      p.crate = 'returned';
      remember(kid, { day: w.day, kind: 'ofensa', weight: -0.45 }, gen);
      remember(m, { day: w.day, kind: 'ayuda', weight: 0.55 }, gen);
      addScore(w, w.player.home, 3);
      story(w, `Delató a ${kid.name} ante ${m.name} por la caja de miel.`, 'decision');
      logDay(w, 'decision', `Contaste a ${m.name} lo que hizo ${kid.name}.`);
      p.effects.push({ day: w.day + 1, id: 'crate:told' });
      return done(end('crate:end', m.name, [`${m.name} recupera su caja y tira de la oreja de ${kid.name} hasta su casa. Te da las gracias sin sonreír.`, `${kid.name} te mira por encima del hombro. No es una mirada amable.`]));
    }
    case 'kid:2:cubrir': {
      const kid = folk(w, p.kid)!;
      const m = folk(w, p.merchant)!;
      p.crate = 'covered';
      remember(kid, { day: w.day, kind: 'ayuda', weight: 0.6 }, gen);
      remember(m, { day: w.day, kind: 'ayuda', weight: 0.35 }, gen);
      addScore(w, w.player.home, 2);
      story(w, `Ayudó a ${kid.name} a devolver una caja sin delatarle.`, 'decision');
      logDay(w, 'decision', `Cubriste a ${kid.name}.`);
      p.effects.push({ day: w.day + 2, id: 'crate:covered' });
      return done(end('crate:end', kid.name, [`${kid.name} arrastra la caja hasta el puesto y dice que la encontró en el barro. ${m.name} le da una moneda de premio.`, `Al pasar a tu lado, ${kid.name} te guiña un ojo.`], { notes: gain(w, 'diplomacia', 0.6) }));
    }
    case 'kid:2:dejar':
    case 'kid:ask:dejar':
      return done(null);
    // --- La carta ----------------------------------------------------------
    case 'letter:abrir':
    case 'letter:guardar': {
      p.clue = 'given';
      id.items.push('carta');
      const past = id.past!;
      const O = w.regions[past.origin];
      if (choice === 'guardar') {
        story(w, 'Recibió una carta sellada con el símbolo de su colgante y no se atrevió a abrirla.', 'memoria');
        return done(end('letter:end', 'La carta', ['La guardas junto al colgante. Pesa como una piedra.', '¿Por qué ese símbolo? ¿Por qué ahora?']));
      }
      story(w, `Leyó una carta con el símbolo de su colgante. Hablaba de ${O.name}.`, 'memoria');
      logDay(w, 'decision', 'Abriste la carta del viajero.');
      return done({
        id: 'letter:open',
        title: 'La carta',
        letter: true,
        lines: [`El sello de cera tiene ${past.symbol}.`, '«…si alguna vez lees esto, no vuelvas a ' + O.name + '. Saben lo que pasó. Saben que fuiste tú. Quema esta carta y empieza de nuevo donde nadie te conozca.»', 'No hay firma. Solo una inicial emborronada.', 'Lees el nombre del lugar dos, tres veces. Lo conoces. No sabes por qué.', '¿Por qué conozco esto?'],
        choices: [{ id: 'ok', label: 'Guardar la carta' }],
      });
    }
    case 'letter:open:ok':
      return done(null);
  }
  return done(null);
}

function repairSuccess(w: WorldState): PScene {
  const p = prologueOf(w)!;
  const life = w.life!;
  const id = life.identity!;
  const f = folk(w, p.artisan)!;
  p.repair = 3;
  const notes = gain(w, 'artesania', 1.5);
  for (const n of notes) if (n.big) n.text = 'Algo sobre esto te resulta extrañamente familiar. Conocimiento adquirido: Reparación básica.';
  id.needs.coins += 2;
  remember(f, { day: w.day, kind: 'trabajo', weight: 0.35 }, life.player.generation);
  addScore(w, w.player.home, 2.5);
  deed(id, 'trabajar');
  logDay(w, 'habilidad', 'Aprendiste a reparar herramientas. O lo recordaste.');
  id.fragments.push({ id: 'herramienta', day: w.day });
  story(w, 'Arregló una herramienta sin saber cómo sabía hacerlo, y le vino a la cabeza la voz de alguien.', 'memoria');
  return {
    id: 'repair:flash',
    title: '…',
    flash: true,
    minutes: 30,
    notes,
    lines: ['Calientas la cuña. La encajas de lado. Dos golpes.', 'Y de pronto: unas manos más grandes que las tuyas sobre las tuyas. Un taller oscuro que huele a resina.', '«…no aprietes tanto. Así, despacio, que la madera también…»', 'La voz se corta.'],
    choices: [{ id: 'ok', label: '…' }],
  };
}

// ---------------------------------------------------------------------------
// El paso del tiempo: llegada al pueblo, la caja, la acequia, la noche
// ---------------------------------------------------------------------------
export interface PTick {
  banner?: [string, string];
  whispers: string[];
}

export function prologueTick(w: WorldState, x: number, y: number, clock: number): PTick {
  const p = prologueOf(w);
  const out: PTick = { whispers: [] };
  if (!p) return out;
  const life = w.life!;
  const l = getLayout(w);
  const v = l.villages[w.player.home];
  const home = w.regions[w.player.home];
  const h = hourOf(clock);
  // Partidas del primer prólogo: la caja estaba donde nadie la encontraba.
  if (!p.crateMoved) {
    p.crateMoved = true;
    p.crateSpot = crateSpotOf(w);
  }
  if ((p.crate === 'lost' || p.crate === 'searching') && !p.seen.includes('caja-vista') && Math.hypot(p.crateSpot.x - x, p.crateSpot.y - y) < 9) {
    p.seen.push('caja-vista');
    out.whispers.push('Algo brilla en el barro, junto al carro: tarros de miel.');
  }
  if (p.objective && /caja de/.test(p.objective) && p.crate !== 'lost' && p.crate !== 'searching') p.objective = null;
  if (!p.arrived && Math.hypot(v.cx - x, v.cy - y) < v.plazaR + 7) {
    p.arrived = true;
    p.objective = null;
    out.banner = ['Has llegado a', home.name];
    life.visited[home.id] = w.day;
    story(w, `Llegó a ${home.name}, un pueblo que no recordaba.`, 'lugar');
    logDay(w, 'lugar', `Descubriste ${home.name}.`);
    out.whispers.push('Huele a pan y a humo. Alguien grita precios en la plaza.');
  }
  // La caja perdida: empieza cuando el pueblo ya despertó y tú estás en él.
  if (p.arrived && p.crate === 'none' && w.day <= 2 && h >= 9 && h < 18) {
    p.crate = 'lost';
    p.crateDay = w.day;
    out.whispers.push(`En la plaza, ${folk(w, p.merchant)?.name ?? 'un comerciante'} grita: «¿Alguien ha visto mi caja?»`);
  }
  if ((p.crate === 'lost' || p.crate === 'searching') && (w.day > p.crateDay + 1 || (w.day === p.crateDay + 1 && h >= 21))) {
    p.crate = 'ignored';
    p.effects.push({ day: w.day + 1, id: 'crate:ignored' });
  }
  // La acequia: el segundo día, dos vecinos se pelean por el agua.
  if (w.day >= 2 && p.water === 'none' && h >= 8 && h < 17 && p.arrived) {
    p.water = 'active';
    const ctx = makeCtx(w);
    const enc = { id: `pa${++life.seq}`, kind: 'p_acequia', regionId: w.player.home, x: p.waterSpot.x, y: p.waterSpot.y, day: w.day, folkA: p.a, folkB: p.b, truth: 'ambos', resolved: false, learned: [], announced: true };
    life.encounters.push(enc);
    p.encId = enc.id;
    commitCtx(ctx);
    out.whispers.push('Hacia los campos se oyen voces. Dos vecinos discuten a gritos.');
  }
  if (p.water === 'active' && (h >= 19 || (p.encId && !life.encounters.some((e) => e.id === p.encId && !e.resolved)))) {
    if (p.water === 'active') {
      p.water = 'ignored';
      p.effects.push({ day: w.day + 1, id: 'water:ignored' });
      const e = life.encounters.find((x) => x.id === p.encId);
      if (e) e.resolved = true;
    }
  }
  // La noche enseña sola que hay que buscar dónde dormir.
  if (!p.nightHint && h >= 20 && !life.identity!.housed) {
    p.nightHint = true;
    out.whispers.push('Se encienden los faroles y la gente vuelve a casa. Tú no tienes a dónde ir.');
  }
  // La pista mayor llega cuando ya has vivido un poco aquí.
  if (p.clue === 'none' && w.day >= 2 && p.repair === 3 && p.crate !== 'none' && p.crate !== 'lost' && p.crate !== 'searching' && p.water !== 'none' && p.water !== 'active') {
    p.clue = 'ready';
    out.whispers.push(`${folk(w, p.inn)?.name ?? 'Quien lleva la posada'} te ha buscado. Dice que tiene algo para ti.`);
  }
  return out;
}

/** Cada amanecer: lo que hiciste ayer tiene consecuencias hoy. */
export function prologueDawn(w: WorldState): string[] {
  const p = prologueOf(w);
  if (!p) return [];
  const life = w.life!;
  const gen = life.player.generation;
  const out: string[] = [];
  const due = p.effects.filter((e) => e.day <= w.day);
  p.effects = p.effects.filter((e) => e.day > w.day);
  const m = folk(w, p.merchant);
  const kid = folk(w, p.kid);
  const A = folk(w, p.a);
  const B = folk(w, p.b);
  const ctx = makeCtx(w);
  for (const e of due) {
    switch (e.id) {
      case 'crate:returned':
        out.push(`${m?.name} le cuenta a medio mercado que un forastero le devolvió la caja.`);
        addScore(w, w.player.home, 2);
        break;
      case 'crate:kept':
        if (m && (w.seed + w.day) % 2 === 0) {
          remember(m, { day: w.day, kind: 'robo', weight: -0.55 }, gen);
          addScore(w, w.player.home, -3);
          out.push(`Alguien vio al forastero con tarros de miel. ${m.name} ya no te mira igual.`);
        } else out.push(`${m?.name} sigue preguntando por su caja. Nadie sabe nada.`);
        break;
      case 'crate:sold':
        if (m) remember(m, { day: w.day, kind: 'robo', weight: -0.7 }, gen);
        addScore(w, w.player.home, -4);
        out.push(`${m?.name} ha visto sus tarros de miel en la posada. Sabe quién los vendió.`);
        record(ctx, { kind: 'accion', text: `En ${w.regions[w.player.home].name} se comenta que el forastero vendió lo que no era suyo.`, regions: [w.player.home], known: true, byPlayer: true });
        break;
      case 'crate:ignored':
        out.push(p.crateTruth === 'nino' ? `La caja de ${m?.name} apareció rota detrás de una casa. Culpan a los críos.` : `La caja de ${m?.name} apareció en el barro, con la miel echada a perder.`);
        break;
      case 'crate:told':
        out.push(`A ${kid?.name} le han castigado sin salir. Te evita.`);
        break;
      case 'crate:covered':
        if (kid) remember(kid, { day: w.day, kind: 'ayuda', weight: 0.2 }, gen);
        out.push(`${kid?.name} te ha dejado una flor en la puerta de la posada.`);
        break;
      case 'water:a':
        if (B) (B.resentment = clamp(B.resentment + 0.2), remember(B, { day: w.day, kind: 'injusticia', weight: -0.3 }, gen));
        out.push(`El campo de ${B?.name} amanece seco. ${B?.name} no te saluda.`);
        if (w.day < 6) p.effects.push({ day: w.day + 2, id: 'water:a2' });
        break;
      case 'water:a2':
        out.push(`${B?.name} ha empezado a trabajar en el campo de otro. El suyo se llena de malas hierbas.`);
        break;
      case 'water:b':
        if (A) (A.resentment = clamp(A.resentment + 0.2), remember(A, { day: w.day, kind: 'injusticia', weight: -0.3 }, gen));
        out.push(`Las cabras de ${B?.name} vuelven a entrar en el sembrado de ${A?.name}. Nadie arregló la valla.`);
        break;
      case 'water:mediated':
        out.push(`${A?.name} y ${B?.name} han arreglado juntos la valla y la acequia. Se les ve hablar sin gritar.`);
        addScore(w, w.player.home, 2);
        break;
      case 'water:failed':
        out.push(`${A?.name} y ${B?.name} siguen sin hablarse. Cada uno cuenta su versión, y en las dos sales tú.`);
        break;
      case 'water:lied':
        out.push(`${A?.name} y ${B?.name} buscan al forastero que, según tú, rompió la acequia. No lo encontrarán.`);
        p.effects.push({ day: w.day + 2, id: 'water:lie-out' });
        break;
      case 'water:lie-out':
        if ((w.seed + w.day) % 3 !== 0) {
          for (const f of [A, B]) if (f) remember(f, { day: w.day, kind: 'mentira', weight: -0.5 }, gen);
          addScore(w, w.player.home, -4);
          out.push(`${A?.name} y ${B?.name} han descubierto que no hubo ningún forastero. Ahora están de acuerdo en algo: en que mentiste.`);
        }
        break;
      case 'water:ignored':
        out.push(`${A?.name} y ${B?.name} llegaron a las manos anoche junto a la acequia. ${B?.name} tiene un ojo morado. Nadie intervino.`);
        if (A && B) (A.resentment = clamp(A.resentment + 0.1), B.resentment = clamp(B.resentment + 0.1));
        record(ctx, { kind: 'conflicto', text: `${A?.name} y ${B?.name}, vecinos de ${w.regions[w.player.home].name}, acabaron a golpes por el agua de una acequia.`, regions: [w.player.home], known: true });
        break;
    }
  }
  commitCtx(ctx);
  return out;
}

// ---------------------------------------------------------------------------
// La acequia (encuentro)
// ---------------------------------------------------------------------------
export function acequiaView(w: WorldState): { title: string; scene: string } {
  const p = prologueOf(w)!;
  const A = folk(w, p.a)!;
  const B = folk(w, p.b)!;
  return { title: 'La acequia', scene: `${A.name} y ${B.name} gritan junto a la acequia. El agua que debería ir al campo de ${B.name} se desvía hacia el de ${A.name} por una zanja recién cavada.` };
}

export function acequiaOptions(w: WorldState): { id: string; label: string }[] {
  const p = prologueOf(w)!;
  const A = folk(w, p.a)!;
  const B = folk(w, p.b)!;
  const o: { id: string; label: string }[] = [];
  if (!p.waterLearned.includes('zanja')) o.push({ id: 'zanja', label: '🔎 Mirar la zanja' });
  if (!p.waterLearned.includes('vecinos')) o.push({ id: 'vecinos', label: '👂 Preguntar a quien mira' });
  o.push({ id: 'a', label: `Dar la razón a ${A.name}` }, { id: 'b', label: `Dar la razón a ${B.name}` }, { id: 'mediar', label: '🤝 Intentar que hablen' }, { id: 'mentir', label: '🌒 Decir que viste a un forastero romperlo todo' });
  o.push({ id: 'irse', label: 'No meterte' });
  return o;
}

export function acequiaResolve(w: WorldState, opt: string): { lines: string[]; done: boolean; notes: GainNote[] } {
  const p = prologueOf(w)!;
  const life = w.life!;
  const id = life.identity!;
  const gen = life.player.generation;
  const A = folk(w, p.a)!;
  const B = folk(w, p.b)!;
  const enc = life.encounters.find((e) => e.id === p.encId);
  const finish = (state: Prologue['water'], text: string) => {
    p.water = state;
    if (enc) enc.resolved = true;
    p.effects.push({ day: w.day + 1, id: `water:${state}` });
    story(w, text, 'decision');
    logDay(w, 'decision', text);
  };
  A.lastMet = w.day;
  B.lastMet = w.day;
  switch (opt) {
    case 'zanja':
      p.waterLearned.push('zanja');
      return { lines: [`La zanja es de esta mañana: la tierra aún está húmeda y hay huellas de las botas de ${A.name}.`], done: false, notes: gain(w, 'investigacion', 1) };
    case 'vecinos':
      p.waterLearned.push('vecinos');
      return { lines: [`Una mujer que mira te susurra: «La semana pasada las cabras de ${B.name} rompieron la valla de ${A.name} y se comieron sus brotes. Nadie pagó nada. Esto es la venganza.»`], done: false, notes: gain(w, 'investigacion', 0.8) };
    case 'a':
      remember(A, { day: w.day, kind: 'justicia', weight: 0.4 }, gen);
      remember(B, { day: w.day, kind: 'injusticia', weight: -0.45 }, gen);
      finish('a', `Dio la razón a ${A.name} en la disputa por la acequia.`);
      return { lines: [`${A.name} asiente, satisfecho. ${B.name} escupe al suelo: «Ya veo de qué lado estás.»`], done: true, notes: gain(w, 'diplomacia', 0.5) };
    case 'b':
      remember(B, { day: w.day, kind: 'justicia', weight: 0.4 }, gen);
      remember(A, { day: w.day, kind: 'injusticia', weight: -0.45 }, gen);
      finish('b', `Dio la razón a ${B.name} en la disputa por la acequia.`);
      return { lines: [`${A.name} tapa la zanja de mala gana. «¿Y mi sembrado qué? ¿Y las cabras?» Nadie le contesta.`], done: true, notes: gain(w, 'diplomacia', 0.5) };
    case 'mediar': {
      const full = p.waterLearned.length >= 2;
      const ok = full || Math.random() < chanceOf(id, 'diplomacia', 1.5);
      const notes = [...gain(w, 'diplomacia', ok ? 1.5 : 1), ...gain(w, 'persuasion', 0.6)];
      if (ok) {
        for (const f of [A, B]) remember(f, { day: w.day, kind: 'justicia', weight: 0.35 }, gen);
        addScore(w, w.player.home, 3);
        finish('mediated', `Medió entre ${A.name} y ${B.name} por el agua y la valla.`);
        return { lines: [full ? `Les dices lo que sabes: la valla rota, los brotes comidos, la zanja de esta mañana. Se callan. Los dos tienen parte de razón y lo saben.` : 'Hablas despacio. Pides que cada uno cuente su parte sin interrumpir. Poco a poco, bajan la voz.', `Acuerdan que ${B.name} arreglará la valla y ${A.name} tapará la zanja.`], done: true, notes };
      }
      for (const f of [A, B]) remember(f, { day: w.day, kind: 'conversacion', weight: -0.15 }, gen);
      finish('failed', `Intentó mediar entre ${A.name} y ${B.name} sin conseguirlo.`);
      return { lines: ['Lo intentas, pero no sabes lo bastante de lo que pasó. Los dos acaban gritándote a ti.'], done: true, notes };
    }
    case 'mentir': {
      const notes = gain(w, 'sigilo', 1.2);
      deed(id, 'enganar');
      finish('lied', `Mintió a ${A.name} y ${B.name} para que dejaran de pelear.`);
      return { lines: ['«Esta mañana vi a un forastero con una pala junto a la acequia.» Los dos se miran. La rabia cambia de dirección.', 'Se marchan cada uno a su campo, refunfuñando contra un culpable que no existe.'], done: true, notes };
    }
    case 'irse':
      if (enc) enc.resolved = true;
      p.water = 'ignored';
      p.effects.push({ day: w.day + 1, id: 'water:ignored' });
      return { lines: ['Sigues tu camino. A tu espalda, los gritos suben de tono.'], done: true, notes: [] };
  }
  return { lines: [], done: true, notes: [] };
}

// ---------------------------------------------------------------------------
// El resumen del día (al dormir)
// ---------------------------------------------------------------------------
export function recap(w: WorldState, day: number): string[] {
  const p = prologueOf(w);
  if (!p) return [];
  const today = p.log.filter((e) => e.day === day);
  const lines: string[] = [];
  const count = new Set(today.filter((e) => e.kind === 'persona').map((e) => e.text)).size;
  if (count) lines.push(count === 1 ? 'Conociste a una persona.' : `Conociste a ${count} personas.`);
  const places = today.filter((e) => e.kind === 'lugar').map((e) => e.text);
  lines.push(...places.slice(0, 2));
  const skills = (w.life!.identity?.story ?? []).filter((e) => e.day === day && (e.kind === 'habilidad' || e.kind === 'conocimiento')).length + today.filter((e) => e.kind === 'habilidad').length;
  if (skills) lines.push(skills === 1 ? 'Aprendiste algo.' : 'Aprendiste varias cosas.');
  const decisions = today.filter((e) => e.kind === 'decision');
  if (decisions.length) lines.push(decisions.length === 1 ? 'Tomaste una decisión.' : `Tomaste ${decisions.length} decisiones.`);
  if (!lines.length) lines.push('Un día más.');
  return lines;
}

/** El primer encuentro con cualquier vecino también cuenta en el resumen. */
export function noteMeeting(w: WorldState, f: Folk): void {
  if (f.lastMet < 0) logDay(w, 'persona', `Conociste a ${f.name}.`);
}

/** Para no interrumpir el prólogo con encuentros al azar en los dos primeros días. */
export function prologueQuiet(w: WorldState): boolean {
  const p = prologueOf(w);
  return !!p && w.day <= 2;
}

