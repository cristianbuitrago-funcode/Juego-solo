import { record, revealRegionHistory } from '../core/chronicle';
import { hearsay } from '../core/intel';
import { mysteryHooks } from '../core/systems/mystery';
import { makeKnown } from '../core/systems/rumors';
import { speak } from '../core/systems/characters';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx, routesOf, type Ctx } from '../core/world';
import { openness, remember, ROLE_TITLE } from './folk';
import { ensureLife } from './life';
import { routineOf } from './routines';
import type { Folk } from './types';
import { hourOf, weatherOf } from './clock';
import { foodPrice, stallLook } from './economy';
import { chatter, learnFact, rumorsKnownBy } from './gossip';
import { EMOTION_WORD, emotionOf, societyOf, trait } from './society';

/**
 * Conversaciones con los vecinos. Lo que cuentan depende de lo que viven,
 * de lo que recuerdan de ti (o de tus antepasados) y de cuánto se fían.
 * Pueden callar, exagerar o mentir: la información sigue siendo incompleta.
 */
export interface TalkResult {
  lines: string[];
  learned: string[]; // lo que aprendiste (para el diario)
  lied?: boolean; // te ha mentido (solo lo notas con ojo para ello)
}

const ROLE_GREET: Partial<Record<string, string[]>> = {
  campesino: ['La tierra no espera. ¿Qué quieres?', 'Buen día. Que no se te pise el sembrado.'],
  pescador: ['El agua está rara estos días.', '¿Vienes a por pescado? Llegas tarde.'],
  pastor: ['Cuidado, que se asustan las ovejas.', 'Las bestias saben cuándo viene mal tiempo.'],
  comerciante: ['¡Mira, mira! Aunque hoy hay poco que mirar.', 'Todo se compra y todo se vende. Hasta las noticias.'],
  guardia: ['Alto. ¿De dónde vienes?', 'Sigue tu camino, forastero.'],
  nino: ['¿Eres de muy lejos?', '¡Mi madre dice que no hable con desconocidos!'],
  anciano: ['He visto pasar muchos inviernos. Siéntate.', 'Los jóvenes ya no escuchan. ¿Tú sí?'],
  artesano: ['El fuego no se apaga solo. Habla rápido.', 'Mis manos están ocupadas, mis oídos no.'],
  sanadora: ['Si vienes herido, siéntate. Si no, ayúdame.'],
  exploradora: ['He visto cosas por esos caminos que no creerías.'],
  posadero: ['¿Una jarra? ¿Una cama? ¿O solo vienes a por chismes?', 'Pasa, pasa. Aquí se entera uno de todo.'],
  minero: ['Cuidado con dónde pisas, que esto no es la plaza.', 'Ahí abajo no se oye nada. Aquí arriba, demasiado.'],
  carpintero: ['Si buscas una mesa, ponte a la cola.', 'La madera no miente. La gente sí.'],
};

function pick<T>(ctx: Ctx, a: T[]): T {
  return ctx.rng.pick(a);
}

function ancestorWord(w: WorldState, gen: number): string {
  const life = ensureLife(w);
  const a = life.player.lineage[gen - 1];
  if (!a) return 'alguien de tu familia';
  const rel = a.relation;
  return rel === 'aprendiz' ? `${a.name}, tu maestro` : `${a.name}, ${rel === 'hija' || rel === 'sobrina' ? 'tu madre' : 'tu padre'}`;
}

/** Lo que dice un vecino. Tiene efectos: conoces rumores, historia oculta y datos de oídas. */
export function talkToFolk(w: WorldState, folkId: string): TalkResult {
  const life = ensureLife(w);
  const f = life.folk.find((x) => x.id === folkId);
  if (!f || !f.alive) return { lines: ['…'], learned: [] };
  const ctx = makeCtx(w);
  const r = w.regions[f.regionId];
  const gen = life.player.generation;
  const lines: string[] = [];
  const learned: string[] = [];
  let lied = false;
  const open = openness(f, w);
  const daysAway = f.lastMet >= 0 ? w.day - f.lastMet : -1;

  // 1) Saludo: reconocimiento y recuerdos.
  const mine = f.memories.filter((m) => m.gen === gen);
  const past = f.memories.filter((m) => m.gen < gen);
  const best = [...mine].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))[0];
  if (best && best.weight > 0.3 && daysAway >= 8) lines.push(pick(ctx, ['Pensé que no volverías.', `¡Eres tú! Hace ${w.day - best.day} días ${best.kind === 'refugio' ? 'nos abriste tus puertas' : best.kind === 'salvado' ? 'me salvaste la vida' : 'nos ayudaste'}.`]));
  else if (best && best.weight < -0.3) lines.push(pick(ctx, ['Tú otra vez.', 'No olvido lo que hiciste.', `Hace ${w.day - best.day} días… Ya sabes de qué hablo.`]));
  else if (past.length) {
    const m = past[past.length - 1];
    lines.push(m.weight >= 0 ? `Conocí a ${ancestorWord(w, m.gen)}. Nos ayudó cuando nadie lo hacía. Espero que te parezcas.` : `Conocí a ${ancestorWord(w, m.gen)}. No le guardo cariño, y tú llevas su sangre.`);
  } else if (f.charId) {
    const c = w.characters.find((x) => x.id === f.charId);
    if (c) {
      const said = speak(ctx, c);
      lines.push(...said.slice(0, 3));
      if (mysteryHooks.talk(ctx, c)) learned.push('Algo de lo que te cuenta encaja con la verdad oculta del mundo.');
    }
  } else lines.push(pick(ctx, ROLE_GREET[f.role] ?? ['¿Sí?']));

  // 1b) Su propia vida: ánimo, familia, amistades, lo que quiere, la hora, el clima, los precios.
  if (f.p) {
    const fest = societyOf(w).festivals.find((x) => x.regionId === r.id && x.day === w.day);
    const lost = f.p.mourning !== undefined && f.p.mourning >= w.day ? f.p.mem.find((m) => m.kind === 'muerte') : undefined;
    const look = stallLook(w, r.id);
    const festLine = fest && fest.kind !== 'funeral' ? (fest.kind === 'boda' ? `¿Vendrás esta tarde a la boda de ${fest.who.map((id) => life.folk.find((x) => x.id === id)?.name).join(' y ')}? Habrá música.` : 'Esta noche es la fiesta de la cosecha. ¡Ni se te ocurra perdértela!') : undefined;
    lines.push(...chatter(w, f, ctx.rng, hourOf(life.clock), weatherOf(w, w.day), { price: foodPrice(w, r.id), scarce: look === 'escaso' || look === 'vacio', festival: festLine, mourningFor: lost?.text.replace(/^Murió /, '').replace(/\.$/, '') }));
  }

  // 2) La vida en su región, filtrada por la confianza y la honestidad.
  if (open < 0.25) {
    lines.push(pick(ctx, ['Prefiero no hablar de eso.', 'Aquí la gente no habla con extraños.', '…', 'Mejor pregunta a otro.']));
    learned.push(`En ${r.name} la gente evita hablar contigo.`);
  } else {
    const liar = ctx.rng.next() > f.honesty && f.resentment > 0.4;
    lied = liar;
    lines.push(situation(ctx, f, liar));
    hearsay(ctx, r, 'alimento', liar ? 0.75 : 0.2);
    hearsay(ctx, r, 'tension', liar ? 0.7 : 0.25);
    hearsay(ctx, r, 'animo', liar ? 0.7 : 0.25);
  }

  // 3) Lo que se cuenta en el pueblo (su versión, que no tiene por qué ser la verdad).
  if (open > 0.3 && f.p) {
    const town = rumorsKnownBy(w, f).filter((x) => x.r.subject !== f.id && x.r.target !== f.id && x.r.subject !== 'jugador')[0];
    if (town && ctx.rng.chance(0.75)) {
      const said = town.r.versions[town.v];
      lines.push(said.startsWith('Dicen') ? `${said}` : `¿Te has enterado? ${said}`);
      town.r.heard = town.v;
      learned.push(`Se cuenta: «${said}»`);
      if (town.r.subject !== 'jugador') learnFact(w, town.r.subject, `${f.name} cuenta: ${said}`);
    }
    const me = rumorsKnownBy(w, f, true)[0];
    if (me && ctx.rng.chance(0.6)) {
      const said = me.r.versions[me.v].replace(/^Dicen que el forastero/, 'dicen que tú').replace(/^El forastero/, 'tú');
      lines.push(me.r.tone >= 0 ? `Por cierto, ${said.charAt(0).toLowerCase()}${said.slice(1).replace(/\.$/, '')}. ¿Es verdad?` : `He oído que ${said.charAt(0).toLowerCase()}${said.slice(1)}`);
    }
  }
  // 3b) Rumores del mundo: se los cuentan a quien les inspira confianza.
  if (open > 0.4) {
    const rumor = w.rumors.find((x) => !x.known && (x.heardIn === r.id || x.believers.includes(r.id)) && w.day <= x.expires);
    if (rumor) {
      makeKnown(ctx, rumor);
      lines.push(`Se dice que… ${rumor.text.charAt(0).toLowerCase()}${rumor.text.slice(1)}`);
      learned.push(`Rumor: «${rumor.text}»`);
    }
  }
  // 4) Historia: lo que pasó aquí y no sabías.
  if (open > 0.55 && ctx.rng.chance(0.6)) {
    const revealed = revealRegionHistory(w, r.id, w.day - 30, 1);
    if (revealed.length) {
      lines.push(`¿No te has enterado? ${revealed[0].text}`);
      learned.push(revealed[0].text);
    }
  }
  if (f.lastMet < 0) remember(f, { day: w.day, kind: 'conversacion', weight: 0.05 }, gen);
  f.lastMet = w.day;
  life.visited[r.id] = w.day;
  if (!r.isHome) r.lastAttention = Math.max(r.lastAttention, w.day - (f.role === 'lider' ? 0 : 5));
  commitCtx(ctx);
  if (lines.length > 6) lines.splice(6);
  return { lines, learned, lied };
}

function situation(ctx: Ctx, f: Folk, liar: boolean): string {
  const { w, rng } = ctx;
  const r = w.regions[f.regionId];
  if (liar) {
    if (r.flags.hambre) return 'Aquí no nos falta de nada. No necesitamos limosnas.';
    return rng.pick(['Dicen que el almacén está vacío, pero no te fíes.', 'Los de al lado se preparan para atacarnos, lo sé.', 'Nos va de maravilla, mejor que a nadie.']);
  }
  const worst = Object.entries(r.relations).filter(([id]) => !w.regions[Number(id)].isHome).sort((a, b) => b[1].tension - a[1].tension)[0];
  const enemy = worst ? w.regions[Number(worst[0])] : undefined;
  const closed = routesOf(w, r.id).find((x) => x.status !== 'abierta');
  const closedTo = closed ? w.regions[closed.a === r.id ? closed.b : closed.a] : undefined;
  const opts: string[] = [];
  if (r.flags.guerra) opts.push(`La guerra con ${w.regions[Number(r.flags.guerra.data?.with)]?.name ?? 'los vecinos'} nos está desangrando. Mi primo se fue a luchar.`, 'Han quemado casas al otro lado del pueblo. Nadie duerme.');
  if (r.flags.hambre) opts.push('Ya no queda grano en el almacén. Hacemos cola desde el alba.', 'Los niños preguntan por la comida y no sé qué decirles.');
  if (closed && closedTo) opts.push(`Las caravanas dejaron de llegar. Dicen que el camino hacia ${closedTo.name} está ${closed.status === 'cerrada' ? 'cerrado' : 'bloqueado'}.`);
  if (r.flags.sinComercio) opts.push('Los comerciantes se han ido. El mercado está muerto.');
  if (enemy && worst![1].tension > 0.45) opts.push(`Los guardias están nerviosos. Dicen que ${enemy.name} se arma.`, `No me fío de los de ${enemy.name}. Algo traman.`);
  if (r.flags.fiebre) opts.push('Mi vecino arde de fiebre. Bebía del río, como todos.');
  if (r.flags.degradada) opts.push('Antes había ciervos en el bosque. Ahora ni conejos.', 'La tierra está cansada. Cada año da menos.');
  if (r.research) opts.push('En los talleres trabajan en algo nuevo. Nadie dice qué.');
  if (r.autonomous) opts.push('Ahora decidimos nosotros, en nuestro propio consejo. No necesitamos a nadie.');
  if (r.flags.invierno) opts.push('Este frío no es normal. Las abuelas hablan de un invierno antiguo.');
  if (r.dependency > 0.4) opts.push('¿Traerás más carros? Ya casi nadie siembra.');
  if (r.flags.reconstruyendo) opts.push('Estamos levantando de nuevo las casas. Poco a poco.');
  if (!opts.length) opts.push(r.food > 14 ? 'La cosecha viene bien este año.' : 'Vamos tirando. Ni bien ni mal.', `En ${r.name} la vida sigue, como siempre.`);
  return rng.pick(opts);
}

/** Observar a alguien: qué hace y cómo parece estar (sin cifras). */
export function observeFolk(w: WorldState, folkId: string): string[] {
  const life = ensureLife(w);
  const f = life.folk.find((x) => x.id === folkId);
  if (!f) return [];
  const r = w.regions[f.regionId];
  const t = routineOf(w, f, life.clock);
  const out = [`${f.name}, ${ROLE_TITLE[f.role]}${f.age < 14 ? '' : `, de unos ${f.age} años`}, ${t.activity}.`];
  const open = openness(f, w);
  if (f.fear > 0.5) out.push('Mira a menudo hacia el camino, como esperando algo malo.');
  if (f.resentment > 0.55) out.push('Cuando te ve, aparta la mirada.');
  else if (f.gratitude > 0.5) out.push('Te dedica una sonrisa al verte.');
  else if (open > 0.6) out.push('Parece dispuesto a hablar.');
  if (r.flags.hambre) out.push('Está más delgado de lo que debería.');
  if (r.flags.fiebre && f.age > 50) out.push('Tose con fuerza.');
  if (f.origin !== undefined) out.push(`Por su acento, no es de aquí: viene de ${w.regions[f.origin].name}.`);
  // Lo que se ve de su carácter y de su ánimo, sin cifras.
  if (f.p) {
    const tr = (k: Parameters<typeof trait>[1]) => trait(f, k);
    const looks: string[] = [];
    if (tr('sociable') > 70) looks.push('saluda a todo el que pasa');
    else if (tr('timido') > 70) looks.push('evita mirar a la gente a los ojos');
    if (tr('trabajador') > 75) looks.push('no para quieto ni un momento');
    else if (tr('perezoso') > 75) looks.push('se toma su tiempo para todo');
    if (tr('orgulloso') > 75) looks.push('camina con la barbilla muy alta');
    if (tr('desconfiado') > 75) looks.push('vigila a todo el mundo de reojo');
    if (tr('amable') > 78) looks.push('tiene una palabra amable para cualquiera');
    if (looks.length) out.push(`Parece de esas personas que ${looks.slice(0, 2).join(' y ')}.`);
    const e = emotionOf(f);
    if (e !== 'calma') out.push(`Se le ve ${EMOTION_WORD[e]}${e === 'tristeza' && f.p.mourning !== undefined && f.p.mourning >= w.day ? ', de luto' : ''}.`);
    if (f.p.sick !== undefined && f.p.sick >= w.day) out.push('Tiene mala cara: no se encuentra bien.');
    if (/discute|pelea/.test(t.activity)) out.push('Está a punto de llegar a las manos.');
  }
  return out;
}

/** Dar algo de tu mochila. Los gestos pequeños también se recuerdan. */
export function giveTo(w: WorldState, folkId: string, item: 'comida' | 'hierbas'): string {
  const life = ensureLife(w);
  const f = life.folk.find((x) => x.id === folkId);
  if (!f) return '';
  if (life.player.inventory[item] <= 0) return item === 'comida' ? 'No llevas comida.' : 'No llevas hierbas.';
  life.player.inventory[item]--;
  const r = w.regions[f.regionId];
  const ctx = makeCtx(w);
  const needed = item === 'comida' ? !!r.flags.hambre : !!r.flags.fiebre || f.age > 60;
  remember(f, { day: w.day, kind: item === 'comida' ? 'comida' : 'salvado', weight: needed ? 0.6 : 0.35 }, life.player.generation);
  f.lastMet = w.day;
  if (needed) r.attitude.trust = clamp(r.attitude.trust + 0.02);
  record(ctx, { kind: 'accion', text: `Diste ${item === 'comida' ? 'comida' : 'hierbas medicinales'} a ${f.name}, ${ROLE_TITLE[f.role]} de ${r.name}.`, regions: [r.id], known: true, byPlayer: true });
  commitCtx(ctx);
  return needed ? `${f.name} lo acepta con las manos temblorosas. «No lo olvidaré.»` : `${f.name} lo acepta, algo sorprendido.`;
}
