import { record } from '../core/chronicle';
import { observe } from '../core/intel';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx } from '../core/world';
import { remember } from './folk';
import { addScore, chanceOf, deed, eat, gain, hasTalent, levelOf, rest, story, tryFragment, type FragmentEvent, type GainNote, type KnowId, type SkillId } from './identity';
import { ensureLife } from './life';
import { getLayout } from './layout';
import { foodPrice, foodStock, marketOf, trade } from './economy';
import type { Folk } from './types';
import { T } from './types';

/**
 * Ganarse la vida. Al principio el protagonista no tiene nada: ni comida, ni
 * monedas, ni cama. Trabaja con los vecinos, aprende de ellos, come en la
 * posada, duerme donde puede. Cada cosa que hace le enseña algo y deja huella
 * en quien le ve hacerlo.
 */
export interface Outcome {
  lines: string[];
  notes: GainNote[];
  minutes: number;
  fragment?: FragmentEvent | null;
}

const none = (lines: string[]): Outcome => ({ lines, notes: [], minutes: 0 });

function rnd(w: WorldState, salt: number): number {
  const life = ensureLife(w);
  let x = (Math.floor(life.clock) * 2654435761 + salt * 40503 + w.seed) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Trabajar con los vecinos
// ---------------------------------------------------------------------------
export interface Job {
  label: string;
  skill: SkillId;
  know?: KnowId;
  minutes: number;
  pay: { coins: number; comida: number; hierbas: number };
  task: string; // lo que haces, en palabras
  needs?: number; // reconocimiento mínimo en el pueblo
}

export function jobFor(w: WorldState, f: Folk): Job | null {
  const r = w.regions[f.regionId];
  const poor = r.flags.hambre || (r.isHome ? w.player.reserves < 20 : r.food < 4);
  switch (f.role) {
    case 'campesino':
      return { label: '🌾 Ayudar en el campo', skill: 'agricultura', know: 'agricultura', minutes: 180, pay: { coins: 1, comida: poor ? 0 : 1, hierbas: 0 }, task: 'Cavas surcos, arrancas malas hierbas y cargas cestos hasta que te arden las manos.' };
    case 'pastor':
      return { label: '🐑 Ayudar con el rebaño', skill: 'supervivencia', know: 'agricultura', minutes: 180, pay: { coins: 1, comida: poor ? 0 : 1, hierbas: 0 }, task: 'Recorres las lomas buscando ovejas perdidas y aprendes a leer el cielo.' };
    case 'pescador':
      return { label: '🎣 Ayudar con las redes', skill: 'supervivencia', minutes: 180, pay: { coins: 1, comida: poor ? 1 : 2, hierbas: 0 }, task: 'Remiendas redes, tiras de ellas con el agua por la cintura y vuelves oliendo a río.' };
    case 'artesano':
      return { label: '🔨 Trabajar en el taller', skill: 'artesania', know: 'tecnologia', minutes: 180, pay: { coins: 2, comida: 0, hierbas: 0 }, task: 'Sujetas, cortas, reparas. Una herramienta rota vuelve a servir entre tus manos.' };
    case 'comerciante':
      return { label: '⚖ Ayudar en el puesto', skill: 'comercio', know: 'economia', minutes: 180, pay: { coins: poor ? 1 : 3, comida: 0, hierbas: 0 }, task: 'Pregonas, pesas, regateas. Aprendes lo que vale cada cosa y lo que la gente cree que vale.' };
    case 'guardia':
      return { label: '⚔ Entrenar con la guardia', skill: 'combate', minutes: 120, pay: { coins: 0, comida: 1, hierbas: 0 }, task: 'Golpes de palo, caídas, más golpes. Al final del día te duele todo, pero aguantas un poco más.' };
    case 'sanadora':
      return { label: '🌿 Ayudar a la sanadora', skill: 'medicina', know: 'medicina', minutes: 180, pay: { coins: 1, comida: 0, hierbas: 1 }, task: 'Machacas raíces, hierves paños y sujetas a quien grita. Aprendes qué cura y qué no.' };
    case 'anciano':
      return { label: '📜 Escuchar sus historias', skill: 'investigacion', know: 'historia', minutes: 90, pay: { coins: 0, comida: 0, hierbas: 0 }, task: 'Te cuenta cómo era el valle antes, quién peleó con quién y por qué. Tú escuchas.' };
    case 'exploradora':
      return { label: '🧭 Acompañarla a explorar', skill: 'supervivencia', know: 'geografia', minutes: 240, pay: { coins: 1, comida: 0, hierbas: 1 }, task: 'Recorréis senderos que no salen en ningún mapa. Te enseña a orientarte por el musgo y las estrellas.' };
    case 'posadero':
      return { label: '🍺 Ayudar en la posada', skill: 'persuasion', know: 'culturas', minutes: 150, pay: { coins: 1, comida: 1, hierbas: 0 }, task: 'Sirves jarras, friegas cuencos y escuchas. En una posada se entera uno de todo.' };
    case 'minero':
      return { label: '⛏ Bajar a la mina', skill: 'supervivencia', know: 'geografia', minutes: 240, pay: { coins: 2, comida: 0, hierbas: 0 }, task: 'Polvo, oscuridad y el eco de los picos. Sales con los pulmones llenos de piedra y unas monedas.' };
    case 'carpintero':
      return { label: '🪚 Ayudar en la carpintería', skill: 'artesania', know: 'tecnologia', minutes: 180, pay: { coins: 2, comida: 0, hierbas: 0 }, task: 'Serrar, cepillar, encajar. La madera tiene su genio y hay que escucharla.' };
    case 'lider':
      return { label: '🏛 Ofrecer tu ayuda al consejo', skill: 'liderazgo', know: 'politica', minutes: 180, pay: { coins: 2, comida: 0, hierbas: 0 }, task: 'Organizas turnos, escribes cartas, escuchas quejas. Ves por dentro cómo se decide en un pueblo.', needs: 2 };
    default:
      return null;
  }
}

export function work(w: WorldState, folkId: string): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const f = life.folk.find((x) => x.id === folkId);
  if (!f) return none(['Ya no está aquí.']);
  const job = jobFor(w, f);
  if (!job) return none([`${f.name} no necesita ayuda ahora.`]);
  const r = w.regions[f.regionId];
  if ((job.needs ?? 0) > (id.standing[r.id] ?? 0)) return none([`«Aún no te conocemos lo bastante para meterte en los asuntos del pueblo.»`]);
  if (id.worked[f.id] === w.day) return none([`${f.name}: «Por hoy ya has hecho bastante. Vuelve mañana.»`]);
  if (id.needs.fatigue > 0.85) return none(['Estás demasiado cansado para trabajar. Necesitas dormir.']);
  id.worked[f.id] = w.day;
  const ok = rnd(w, f.id.length) < chanceOf(id, job.skill, 0.6);
  const lines = [job.task];
  const notes: GainNote[] = [...gain(w, job.skill, ok ? 1.5 : 1)];
  if (job.know) notes.push(...gain(w, `k:${job.know}`, 0.7));
  const bonus = ok ? Math.floor(levelOf(id, job.skill) / 2) : 0;
  const pay = { coins: job.pay.coins + (job.pay.coins ? bonus : 0), comida: job.pay.comida, hierbas: job.pay.hierbas };
  if (!ok) {
    pay.coins = Math.max(0, pay.coins - 1);
    lines.push(`${f.name} suspira: «Torpe, pero con ganas. Ya aprenderás.»`);
  } else lines.push(`${f.name} asiente: «No lo haces nada mal.»`);
  id.needs.coins += pay.coins;
  life.player.inventory.comida += pay.comida;
  life.player.inventory.hierbas += pay.hierbas;
  const got = [pay.coins ? `${pay.coins} moneda${pay.coins > 1 ? 's' : ''}` : '', pay.comida ? `${pay.comida} de comida` : '', pay.hierbas ? 'unas hierbas' : ''].filter(Boolean);
  if (got.length) lines.push(`Te llevas ${got.join(', ')}.`);
  remember(f, { day: w.day, kind: 'trabajo', weight: ok ? 0.25 : 0.12 }, life.player.generation);
  f.lastMet = w.day;
  f.trust = clamp(f.trust + 0.04);
  addScore(w, r.id, ok ? 1.6 : 1);
  deed(id, 'trabajar');
  deed(id, `oficio:${job.skill}`);
  id.needs.fatigue = Math.min(1, id.needs.fatigue + job.minutes / 1000);
  if ((id.deeds.trabajar ?? 0) === 1) story(w, `Encontró su primer trabajo en ${r.name}, con ${f.name}.`, 'logro');
  return { lines, notes, minutes: job.minutes };
}

// ---------------------------------------------------------------------------
// Preguntar por uno mismo
// ---------------------------------------------------------------------------
export function askAboutMe(w: WorldState, folkId: string): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const f = life.folk.find((x) => x.id === folkId);
  if (!f) return none(['…']);
  const past = id.past;
  const frag = tryFragment(w, { kind: 'hablar', folkId });
  if (frag) return { lines: [], notes: [], minutes: 10, fragment: frag };
  if (!past) return none([`${f.name}: «Todo el mundo sabe quién eres.»`]);
  const O = w.regions[past.origin];
  const lines: string[] = [];
  const known = (id.standing[f.regionId] ?? 0) >= 1;
  if (f.regionId === past.origin) lines.push(`${f.name} te mira con atención. «Tu cara… Me suena de algo. Pregunta a otros, quizá alguien te recuerde.»`);
  else if (id.fragments.some((x) => x.id === 'colgante') && rnd(w, 7) < 0.5) lines.push(`Le enseñas el colgante. ${f.name} frunce el ceño: «Ese símbolo… Lo he visto en los carros que vienen de ${O.name}. Pero no sé más.»`);
  else if (known) lines.push(`${f.name}: «¿Que quién eres? Eres ${id.nickname === 'Sin nombre' ? 'el que apareció un día en el camino' : id.nickname}, el que ${(id.deeds.trabajar ?? 0) > 2 ? 'nos echa una mano' : 'anda preguntando'}. Para mí, con eso basta.»`);
  else lines.push(pick(w, [`${f.name}: «Ni idea. Llegaste por el camino, como todos los forasteros.»`, `${f.name}: «¿No sabes quién eres? Pues sí que estamos buenos.»`, `${f.name}: «Hablas raro. No eres de aquí, eso seguro.»`]));
  if (id.nickname === 'Sin nombre' && (life.folk.filter((x) => x.lastMet >= 0).length >= 3 || known)) {
    id.nickname = f.age < 14 ? 'el del camino' : 'Forastero';
    lines.push(`Desde hoy, en ${w.regions[f.regionId].name} te llaman «${id.nickname}».`);
    story(w, `En ${w.regions[f.regionId].name} empezaron a llamarle «${id.nickname}».`, 'relacion');
    if (!id.named) life.player.name = id.nickname;
  }
  f.lastMet = w.day;
  return { lines, notes: gain(w, 'investigacion', 0.3), minutes: 10 };
}

function pick<T>(w: WorldState, a: T[]): T {
  return a[Math.floor(rnd(w, a.length * 13) * a.length)];
}

// ---------------------------------------------------------------------------
// Convencer y engañar
// ---------------------------------------------------------------------------
export function convince(w: WorldState, folkId: string): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const f = life.folk.find((x) => x.id === folkId);
  if (!f) return none(['…']);
  const silver = hasTalent(id, 'lengua');
  const ok = silver || rnd(w, 3) < chanceOf(id, 'persuasion', f.resentment > 0.5 ? 2 : 1);
  const notes = gain(w, 'persuasion', ok ? 1.2 : 0.7);
  if (ok) {
    f.resentment = clamp(f.resentment - (silver ? 0.35 : 0.18));
    f.trust = clamp(f.trust + 0.08);
    remember(f, { day: w.day, kind: 'conversacion', weight: 0.2 }, life.player.generation);
    addScore(w, f.regionId, 0.8);
    return { lines: [`Hablas despacio, sin prisa. ${f.name} baja la guardia: «Quizá te juzgué mal.»`], notes, minutes: 20 };
  }
  remember(f, { day: w.day, kind: 'conversacion', weight: -0.05 }, life.player.generation);
  return { lines: [`${f.name} cruza los brazos: «Palabras. Ya veremos qué haces.»`], notes, minutes: 20 };
}

export function deceive(w: WorldState, folkId: string): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const f = life.folk.find((x) => x.id === folkId);
  if (!f) return none(['…']);
  const ok = rnd(w, 5) < chanceOf(id, 'sigilo', f.honesty > 0.8 ? 2 : 1);
  const notes = gain(w, 'sigilo', ok ? 1.3 : 0.8);
  deed(id, 'enganar');
  if (ok) {
    id.needs.coins += 1;
    return { lines: ['Le cuentas que eres un mensajero que perdió su bolsa en el camino. Te cree y te da una moneda.', 'Te sale demasiado bien. Eso, por sí solo, ya dice algo de quién eras.'], notes, minutes: 15 };
  }
  remember(f, { day: w.day, kind: 'mentira', weight: -0.45 }, life.player.generation);
  addScore(w, f.regionId, -3);
  story(w, `Le pillaron mintiendo en ${w.regions[f.regionId].name}.`, 'error');
  return { lines: [`${f.name} entorna los ojos: «Eso no te lo crees ni tú.» Se lo contará a otros.`], notes, minutes: 15 };
}

// ---------------------------------------------------------------------------
// Comer, dormir, comprar
// ---------------------------------------------------------------------------
export function priceOf(w: WorldState, regionId: number, base: number): number {
  const id = ensureLife(w).identity!;
  const r = w.regions[regionId];
  // El precio sale del mercado del pueblo: sube con la escasez y baja con la abundancia.
  const market = w.life?.society ? foodPrice(w, regionId) - 1 : (r.flags.hambre ? 2 : (r.isHome ? w.player.reserves < 20 : r.food < 5) ? 1 : 0);
  const skill = hasTalent(id, 'mercader') ? 1 : 0;
  return Math.max(1, base + market - skill);
}

export function buyMeal(w: WorldState, regionId: number): Outcome {
  const id = ensureLife(w).identity!;
  const price = priceOf(w, regionId, 1);
  if (id.needs.coins < price) return none([`Un plato de guiso cuesta ${price} moneda${price > 1 ? 's' : ''}. No tienes.`]);
  id.needs.coins -= price;
  eat(id, 0.65);
  return { lines: ['Guiso caliente, pan duro y un vaso de algo que quema. Te sientes persona otra vez.'], notes: gain(w, 'k:culturas', 0.3), minutes: 40 };
}

export function buyFood(w: WorldState, regionId: number): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const price = priceOf(w, regionId, 1);
  if (life.society && foodStock(marketOf(w, regionId)) < 1) return none(['No queda nada en los puestos. Hoy no se vende comida.']);
  if (id.needs.coins < price) return none([`Una hogaza y algo de queso: ${price} moneda${price > 1 ? 's' : ''}. No te llega.`]);
  id.needs.coins -= price;
  if (life.society) trade(w, regionId, 'comida', 1);
  life.player.inventory.comida++;
  deed(id, 'comerciar');
  return { lines: ['Guardas la comida en la mochila.'], notes: gain(w, 'comercio', 0.4), minutes: 10 };
}

export function sellRelic(w: WorldState, regionId: number): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  if (life.player.inventory.reliquias <= 0) return none(['No tienes nada de valor que vender.']);
  life.player.inventory.reliquias--;
  const price = 3 + levelOf(id, 'comercio') + (hasTalent(id, 'mercader') ? 2 : 0);
  id.needs.coins += price;
  deed(id, 'comerciar');
  void regionId;
  return { lines: [`Regateas un buen rato. Te dan ${price} monedas.`], notes: gain(w, 'comercio', 1), minutes: 20 };
}

export function rentBed(w: WorldState, regionId: number): Outcome {
  const id = ensureLife(w).identity!;
  const price = priceOf(w, regionId, 2);
  if (id.needs.coins < price) return none([`Una cama cuesta ${price} monedas. Puedes dormir en el establo… o al raso.`]);
  id.needs.coins -= price;
  return { lines: ['Una cama de paja limpia y una manta que huele a humo.'], notes: [], minutes: 0 };
}

/** Pedir algo de comer en el almacén cuando no tienes nada. */
export function charity(w: WorldState, regionId: number): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const r = w.regions[regionId];
  const key = `caridad:${regionId}`;
  if (id.deeds[key] === w.day) return none(['«Ya te dimos algo esta mañana. Busca trabajo, que aquí sobra.»']);
  if (r.flags.hambre) return none(['«No hay ni para los nuestros. Lo siento.»']);
  id.deeds[key] = w.day;
  life.player.inventory.comida++;
  return { lines: ['El intendente te mira de arriba abajo y te da un mendrugo. «Si quieres más, gánatelo.»'], notes: [], minutes: 10 };
}

/** Buscar comida en el campo o en el bosque. */
export function forage(w: WorldState, x: number, y: number): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const l = getLayout(w);
  const t = l.terrain.tiles[Math.floor(y) * 500 + Math.floor(x)];
  if (t !== T.Forest && t !== T.Meadow && t !== T.Grass && t !== T.Marsh) return none(['Aquí no hay nada que se pueda comer.']);
  const ok = hasTalent(id, 'superviviente') || rnd(w, 11) < chanceOf(id, 'supervivencia', 1.4);
  const notes = gain(w, 'supervivencia', ok ? 1 : 0.6);
  if (t === T.Forest || t === T.Marsh) notes.push(...gain(w, 'k:medicina', 0.3));
  if (!ok) return { lines: ['Buscas un buen rato entre la maleza. Nada. O nada que te atrevas a comer.'], notes, minutes: 60 };
  life.player.inventory.comida++;
  if (t === T.Forest && rnd(w, 12) < 0.4) life.player.inventory.hierbas++;
  return { lines: [t === T.Forest ? 'Setas, bayas y unas raíces dulces. Y unas hierbas que quizá sirvan para curar.' : 'Moras, unos huevos de perdiz y algo de achicoria.'], notes, minutes: 60 };
}

// ---------------------------------------------------------------------------
// Aprender
// ---------------------------------------------------------------------------
export function study(w: WorldState, regionId: number, where: 'templo' | 'posada' | 'salon' | 'mercado'): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const r = w.regions[regionId];
  const key = `estudio:${where}:${regionId}`;
  if (id.deeds[key] === w.day) return none(['Por hoy ya has aprendido lo que se podía aprender aquí.']);
  id.deeds[key] = w.day;
  deed(id, 'estudiar');
  const foreign = !r.isHome;
  const notes: GainNote[] = [];
  const lines: string[] = [];
  switch (where) {
    case 'templo':
      lines.push('Te sientas con los ancianos y lees lo que hay escrito en los muros y en los libros viejos.');
      notes.push(...gain(w, 'k:historia', 1.2), ...gain(w, 'k:culturas', 0.6), ...gain(w, 'k:idiomas', foreign ? 0.8 : 0.3));
      break;
    case 'posada':
      lines.push('Escuchas a viajeros y arrieros: precios, caminos, quién manda dónde.');
      notes.push(...gain(w, 'k:politica', 0.7), ...gain(w, 'k:economia', 0.6), ...gain(w, 'k:geografia', 0.5));
      break;
    case 'salon':
      lines.push('Te dejan sentarte al fondo mientras el consejo discute. Aprendes cómo se toman las decisiones.');
      notes.push(...gain(w, 'k:politica', 1.4), ...gain(w, 'diplomacia', 0.5));
      break;
    case 'mercado':
      lines.push('Pasas la mañana mirando cómo se compra y se vende.');
      notes.push(...gain(w, 'k:economia', 1), ...gain(w, 'comercio', 0.4));
      break;
  }
  id.needs.fatigue = Math.min(1, id.needs.fatigue + 0.12);
  return { lines, notes, minutes: 120 };
}

/** Escuchar desde la puerta lo que se decide en el consejo. */
export function eavesdrop(w: WorldState, regionId: number): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const ctx = makeCtx(w);
  const r = w.regions[regionId];
  const ok = hasTalent(id, 'sombra') || rnd(w, 9) < chanceOf(id, 'sigilo', 1.5);
  const notes = gain(w, 'sigilo', ok ? 1.2 : 0.6);
  notes.push(...gain(w, 'k:politica', ok ? 0.8 : 0.2));
  if (!ok) {
    addScore(w, regionId, -1);
    commitCtx(ctx);
    return { lines: ['Un guardia te ve pegado a la puerta. «¡Fuera de aquí!» Algunos lo comentarán.'], notes, minutes: 20 };
  }
  observe(ctx, r, 0.6, ['tension', 'relaciones', 'animo']);
  const pet = w.petitions[0];
  const lines = ['Pegas la oreja a la puerta.'];
  if (pet) lines.push(`Discuten algo: «${pet.title}». Nadie se pone de acuerdo.`);
  else lines.push(r.isHome && w.player.reserves < 25 ? 'Hablan de lo poco que queda en el almacén.' : 'Hablan de impuestos, de turnos de guardia y de un vecino que no paga.');
  commitCtx(ctx);
  return { lines, notes, minutes: 30 };
}

// ---------------------------------------------------------------------------
// Curar a un pueblo (talento)
// ---------------------------------------------------------------------------
export function tendSick(w: WorldState, regionId: number): Outcome {
  const life = ensureLife(w);
  const id = life.identity!;
  const r = w.regions[regionId];
  if (!r.flags.fiebre) return none(['No hay fiebre en el pueblo. Atiendes algún rasguño y poco más.']);
  if (!hasTalent(id, 'sanador')) return none(['Ves la fiebre, pero no sabes lo bastante para frenarla.']);
  const ctx = makeCtx(w);
  const cause = r.flags.fiebre.causeId;
  delete r.flags.fiebre;
  const e = record(ctx, { kind: 'consecuencia', text: `Un forastero atendió a los enfermos de ${r.name} durante días y la fiebre remitió.`, regions: [regionId], causeId: cause, known: true, importance: 3, byPlayer: true });
  void e;
  commitCtx(ctx);
  for (const f of life.folk) if (f.alive && f.regionId === regionId) remember(f, { day: w.day, kind: 'salvado', weight: 0.5 }, life.player.generation);
  addScore(w, regionId, 12);
  deed(id, `crisis:${regionId}`);
  deed(id, 'curar');
  story(w, `Frenó una fiebre en ${r.name}.`, 'logro');
  return { lines: ['Días de agua hervida, paños fríos y noches sin dormir. Poco a poco, la fiebre cede.'], notes: gain(w, 'medicina', 2), minutes: 600 };
}

// ---------------------------------------------------------------------------
// Encuentros: lo que haces enseña y se recuerda
// ---------------------------------------------------------------------------
export function encounterLearning(w: WorldState, kind: string, opt: string, regionId: number, resolved: boolean): GainNote[] {
  const id = ensureLife(w).identity;
  if (!id) return [];
  const notes: GainNote[] = [];
  const g = (k: SkillId | `k:${KnowId}`, a: number) => notes.push(...gain(w, k, a));
  if (opt === 'escuchar' || opt === 'investigar' || opt === 'origen') g('investigacion', 0.9);
  if (opt.startsWith('razon') || opt === 'ambos') (g('diplomacia', 1), g('liderazgo', 0.4));
  if (opt === 'hablar') (g('persuasion', 0.6), g('k:idiomas', 0.3));
  if (opt === 'curar') (g('medicina', 1.2), deed(id, 'curar'));
  if (opt === 'seguir') g('sigilo', 1);
  if (opt === 'confrontar') g('combate', 1);
  if (opt === 'organizar') (g('liderazgo', 1.4), deed(id, `crisis:${regionId}`));
  if (opt === 'comida' || opt === 'hogar' || opt === 'curar' || opt === 'organizar') {
    deed(id, 'ayudar');
    addScore(w, regionId, opt === 'organizar' ? 8 : 3);
    const r = w.regions[regionId];
    if (r.flags.hambre || r.flags.guerra || r.flags.fiebre || kind === 'refugiados' || kind === 'herido') deed(id, `crisis:${regionId}`);
    if ((id.deeds.ayudar ?? 0) === 1) story(w, `Ayudó por primera vez a alguien que lo necesitaba, en ${r.name}.`, 'logro');
  }
  if (kind === 'disputa' && opt === 'irse') addScore(w, regionId, -0.5);
  void resolved;
  return notes;
}

/** Hablar enseña: palabras, costumbres y un poco de mano izquierda. */
export function afterTalk(w: WorldState, f: Folk): GainNote[] {
  const life = ensureLife(w);
  const id = life.identity;
  if (!id || id.mode === 'gobernante') return [];
  const notes: GainNote[] = [...gain(w, 'persuasion', 0.15)];
  const r = w.regions[f.regionId];
  if (!r.isHome) notes.push(...gain(w, 'k:idiomas', 0.25), ...gain(w, 'k:culturas', 0.25));
  if (f.role === 'lider') notes.push(...gain(w, 'k:politica', 0.3));
  addScore(w, f.regionId, 0.3);
  return notes;
}

/** Caminar enseña el mundo. */
export function exploreLearning(w: WorldState, newRegion: boolean): GainNote[] {
  const id = ensureLife(w).identity;
  if (!id || id.mode === 'gobernante') return [];
  deed(id, 'explorar');
  return [...gain(w, 'k:geografia', newRegion ? 1.2 : 0.15), ...gain(w, 'supervivencia', newRegion ? 0.6 : 0.08)];
}

/** Lo que dice el vecino cuando miente, si tienes ojo para ello. */
export function noticeLie(w: WorldState): string | null {
  const id = ensureLife(w).identity;
  if (!id) return null;
  return hasTalent(id, 'investigador') ? '(Notas que miente: le tiembla la voz y no te mira.)' : levelOf(id, 'investigacion') >= 2 && rnd(w, 21) < 0.4 ? '(Algo no encaja en lo que dice.)' : null;
}

/** Con Lectura política, lo que de verdad quiere un líder. */
export function readLeader(w: WorldState, f: Folk): string | null {
  const id = ensureLife(w).identity;
  if (!id || !hasTalent(id, 'lectura') || f.role !== 'lider') return null;
  const r = w.regions[f.regionId];
  const c = f.charId ? w.characters.find((x) => x.id === f.charId) : undefined;
  if (c) return c.emotions.ambition > 0.6 ? '(Lees entre líneas: quiere más poder del que tiene, y no le importa a quién pise.)' : c.emotions.fear > 0.5 ? '(Lees entre líneas: tiene miedo. De sus vecinos, o de los suyos.)' : '(Lees entre líneas: quiere paz, aunque no se fía de nadie.)';
  return r.militancy > 0.55 ? '(Lees entre líneas: se prepara para pelear.)' : '(Lees entre líneas: lo que más le preocupa es el grano.)';
}

/** Dormir: en la posada, en tu casa o al raso. */
export function sleepOutcome(w: WorldState, where: 'posada' | 'casa' | 'raso'): Outcome {
  const id = ensureLife(w).identity!;
  rest(id, where !== 'raso');
  if (where === 'raso') {
    id.needs.fatigue = 0.3;
    return { lines: ['Duermes mal, al raso, con un ojo abierto. Pero duermes.'], notes: gain(w, 'supervivencia', 0.5), minutes: 0, fragment: tryFragment(w, { kind: 'dormir' }) };
  }
  return { lines: [], notes: [], minutes: 0, fragment: tryFragment(w, { kind: 'dormir' }) };
}
