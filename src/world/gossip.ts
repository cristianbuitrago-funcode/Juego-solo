import type { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { ROLE_TITLE } from './folk';
import { folkById, memorize, other, shortName, societyOf, standingOf, tieOf, tiesOf, trait } from './society';
import type { Folk } from './types';

/**
 * Rumores e información imperfecta. Cada vecino sabe lo que vio, lo que le
 * contaron y lo que cree. Un hecho se cuenta de boca en boca entre quienes
 * se tratan; al pasar de una persona a otra puede crecer, torcerse o
 * suavizarse según quién lo cuente. Dos vecinos pueden contar versiones
 * distintas de lo mismo, y ninguna tiene por qué ser la verdad.
 */
export interface SRumor {
  id: string;
  regionId: number;
  day: number;
  kind: string;
  subject: string; // 'jugador' o id del vecino del que se habla
  target?: string;
  versions: string[]; // 0 = lo que pasó; cada una más exagerada o torcida
  knownBy: Record<string, number>; // quién lo sabe y qué versión cree
  tone: number; // -1..1: cómo deja al sujeto
  heat: number; // ganas de contarlo; se apaga con los días
  arc?: string;
  heard?: number; // versión que ha oído el jugador
}

/** Lo que alguien viene a decirte por iniciativa propia. */
export interface Approach {
  id: string;
  folk: string;
  day: number;
  until: number;
  kind: 'vio' | 'rumor' | 'favor' | 'version' | 'gracias' | 'pariente' | 'aviso' | 'oferta';
  lines: string[];
  choices: { id: string; label: string }[];
  data?: Record<string, string | number>;
}

const N = (w: WorldState, id: string | undefined) => (id ? shortName(w, id) : 'alguien');

/** Las versiones de un hecho, de la verdad a la exageración. */
export function versionsFor(w: WorldState, kind: string, subject: string, target?: string, extra: Record<string, string> = {}): { versions: string[]; tone: number } {
  const X = subject === 'jugador' ? 'el forastero' : N(w, subject);
  const Y = N(w, target);
  const R = extra.region ?? 'otra tierra';
  switch (kind) {
    case 'p_ayuda':
      return { tone: 0.6, versions: [`${cap(X)} ayudó a ${Y}.`, `Dicen que el forastero sacó de un apuro a la familia de ${Y}.`, `Dicen que el forastero salvó a la familia de ${Y}.`, 'Dicen que el forastero ha salvado a medio pueblo.'] };
    case 'p_comida':
      return { tone: 0.6, versions: [`El forastero le dio comida a ${Y}.`, `Dicen que el forastero alimentó a la familia de ${Y} cuando no tenían nada.`, `Dicen que el forastero salvó a la familia de ${Y}.`, 'Dicen que el forastero ha salvado a todo el pueblo del hambre.'] };
    case 'p_trabajo':
      return { tone: 0.35, versions: [`El forastero trabajó con ${Y}.`, 'Dicen que el forastero trabaja como dos.', 'Dicen que el forastero hace el trabajo de tres y casi no cobra.'] };
    case 'p_media':
      return { tone: 0.55, versions: [`El forastero ayudó a que ${Y} y ${N(w, extra.with)} hicieran las paces.`, 'Dicen que el forastero tiene mano para los pleitos.', 'Dicen que el forastero arregla cualquier disputa con dos palabras.'] };
    case 'p_robo':
      return { tone: -0.7, versions: [`El forastero se quedó con algo de ${Y}.`, `Dicen que el forastero le robó a ${Y}.`, 'Dicen que el forastero roba a todo el que se descuida.'] };
    case 'p_mentira':
      return { tone: -0.5, versions: [`El forastero le mintió a ${Y}.`, 'Dicen que no hay que creer nada de lo que dice el forastero.', 'Dicen que el forastero es un embaucador que huye de algo.'] };
    case 'p_ofensa':
      return { tone: -0.45, versions: [`El forastero fue grosero con ${Y}.`, `Dicen que el forastero amenazó a ${Y}.`, 'Dicen que el forastero es peligroso.'] };
    case 'p_lado':
      return { tone: 0.1, versions: [`El forastero se puso del lado de ${Y}.`, `Dicen que el forastero va con ${Y} a todas partes.`, `Dicen que ${Y} le paga al forastero para que le defienda.`] };
    case 'discusion':
      return { tone: -0.2, versions: [`${X} y ${Y} discutieron.`, `${X} y ${Y} se gritaron delante de todos.`, `Dicen que ${X} y ${Y} casi llegan a las manos.`, `Dicen que ${X} amenazó con matar a ${Y}.`] };
    case 'pelea':
      return { tone: -0.4, versions: [`${X} y ${Y} se pegaron.`, `Dicen que ${X} le partió la cara a ${Y}.`, `Dicen que ${Y} acabó muy mal parado y que ${X} no se arrepiente.`] };
    case 'robo':
      return { tone: -0.5, versions: [`A ${Y} le robaron.`, `Dicen que fue ${X} quien robó a ${Y}.`, `Dicen que ${X} roba desde hace meses y nadie hace nada.`] };
    case 'pareja':
      return { tone: 0.2, versions: [`${X} y ${Y} se ven a menudo.`, `${X} y ${Y} se ven a escondidas.`, `Dicen que ${X} y ${Y} van a casarse.`] };
    case 'boda':
      return { tone: 0.5, versions: [`${X} y ${Y} se casan.`, `Dicen que la boda de ${X} y ${Y} será la más sonada en años.`, `Dicen que a la boda de ${X} y ${Y} viene gente de toda la comarca.`] };
    case 'separacion':
      return { tone: -0.2, versions: [`${X} y ${Y} ya no están juntos.`, `Dicen que ${X} echó de casa a ${Y}.`, `Dicen que hay alguien más entre ${X} y ${Y}.`] };
    case 'enfermedad':
      return { tone: -0.1, versions: [`${X} lleva días con fiebre.`, `Dicen que lo de ${X} se pega.`, `Dicen que ${X} no pasará de esta semana.`] };
    case 'accidente':
      return { tone: -0.1, versions: [`${X} se hizo daño trabajando.`, `Dicen que ${X} casi se mata.`, `Dicen que ${X} no volverá a trabajar.`] };
    case 'viaje':
      return { tone: 0, versions: [`${X} se ha ido unos días a ${R}.`, `Dicen que ${X} se fue a ${R} por un asunto de dinero.`, `Dicen que ${X} se fue a ${R} huyendo de sus deudas.`] };
    case 'desaparicion':
      return { tone: -0.2, versions: [`Nadie ha visto a ${X} desde hace días.`, `Dicen que a ${X} se lo llevaron los del camino.`, `Dicen que ${X} está muerto en el bosque.`] };
    case 'precio':
      return { tone: -0.3, versions: ['La comida está más cara.', `Dicen que ${X} esconde grano para subir los precios.`, 'Dicen que los comerciantes quieren matarnos de hambre.'] };
    case 'oficio':
      return { tone: 0, versions: [`${X} ha cambiado de oficio: ahora es ${extra.role ?? 'otra cosa'}.`, `Dicen que a ${X} no le quedó otra que buscarse otro trabajo.`, `Dicen que ${X} lo ha perdido todo.`] };
    case 'nacimiento':
      return { tone: 0.4, versions: [`Ha nacido ${N(w, extra.baby)}, de ${X}.`, `Dicen que ${N(w, extra.baby)} es el bebé más llorón del pueblo.`] };
    case 'muerte':
      return { tone: 0, versions: [`Ha muerto ${X}.`, `Dicen que ${X} sabía que iba a morir.`, `Dicen que la muerte de ${X} no fue natural.`] };
    case 'reconciliacion':
      return { tone: 0.3, versions: [`${X} y ${Y} han hecho las paces.`, `Dicen que ${X} y ${Y} se abrazaron en la plaza.`] };
    default:
      return { tone: 0, versions: [extra.text ?? `Pasó algo con ${X}.`] };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Nace un rumor: lo saben quienes lo vieron. */
export function seedRumor(w: WorldState, o: { regionId: number; kind: string; subject: string; target?: string; witnesses: string[]; extra?: Record<string, string>; heat?: number; arc?: string; versions?: string[]; tone?: number }): SRumor {
  const s = societyOf(w);
  const base = o.versions ? { versions: o.versions, tone: o.tone ?? 0 } : versionsFor(w, o.kind, o.subject, o.target, o.extra);
  // Si ya circula algo igual, se aviva en vez de duplicarse.
  const same = s.rumors.find((r) => r.kind === o.kind && r.subject === o.subject && r.target === o.target && w.day - r.day < 15);
  if (same) {
    same.heat = Math.min(1.2, same.heat + 0.4);
    for (const id of o.witnesses) same.knownBy[id] ??= 0;
    return same;
  }
  const r: SRumor = { id: `r${++s.seq}`, regionId: o.regionId, day: w.day, kind: o.kind, subject: o.subject, target: o.target, versions: base.versions, tone: base.tone, knownBy: {}, heat: o.heat ?? 0.9, arc: o.arc };
  for (const id of o.witnesses) r.knownBy[id] = 0;
  s.rumors.push(r);
  if (s.rumors.length > 90) s.rumors.splice(0, s.rumors.length - 90);
  return r;
}

/**
 * Un día de habladurías: cada quien cuenta lo que sabe a la gente con la
 * que se trata. Los charlatanes cuentan más; los poco honrados lo adornan;
 * los amigos del afectado lo suavizan.
 */
export function spreadRumors(w: WorldState, rng: Rng, regionId: number, people: Folk[]): void {
  const s = societyOf(w);
  const byId = new Map(people.map((f) => [f.id, f]));
  for (const r of s.rumors) {
    if (r.heat < 0.08) continue;
    const tellers = Object.entries(r.knownBy).filter(([id]) => byId.has(id));
    if (!tellers.length && r.regionId !== regionId) continue;
    for (const [id, v] of tellers) {
      const f = byId.get(id)!;
      const talk = 0.25 + trait(f, 'sociable') / 220 - trait(f, 'reservado') / 500;
      const n = 1 + Math.floor(trait(f, 'sociable') / 45);
      const ties = tiesOf(w, id).filter((t) => t.fam >= 15 && byId.has(other(t, id)));
      for (let k = 0; k < n && ties.length; k++) {
        if (!rng.chance(talk * r.heat)) continue;
        const t = rng.weighted(ties, (x) => x.fam + Math.max(0, x.aff))!;
        const to = other(t, id);
        if (to === r.subject || r.knownBy[to] !== undefined) continue;
        let nv = v;
        const fond = r.subject !== 'jugador' ? (tieOf(w, id, r.subject)?.aff ?? 0) : 0;
        if (rng.chance((1 - f.honesty) * 0.7 + 0.12) && nv < r.versions.length - 1) nv++;
        else if (fond > 40 && r.tone < 0 && nv > 0 && rng.chance(0.5)) nv--;
        r.knownBy[to] = nv;
        const listener = byId.get(to)!;
        hear(w, listener, r, nv);
      }
    }
    // Los rumores también viajan: comerciantes y viajeros los llevan a otros pueblos.
    r.heat *= 0.9;
  }
}

/** Oír un rumor cambia lo que uno piensa del protagonista (o de un vecino). */
function hear(w: WorldState, f: Folk, r: SRumor, v: number): void {
  const strength = r.tone * (1 + v * 0.35);
  if (r.subject === 'jugador') {
    f.trust = clamp(f.trust + strength * 0.04);
    if (strength < 0) f.resentment = clamp(f.resentment - strength * 0.03);
    memorize(w, f, { kind: 'rumor', about: 'jugador', text: r.versions[v], w: strength * 0.4, src: 'oido' });
  } else if (Math.abs(strength) > 0.3) {
    memorize(w, f, { kind: 'rumor', about: r.subject, with: r.target, text: r.versions[v], w: strength * 0.3, src: 'oido' });
  }
}

/** Lo que un vecino concreto sabe y está dispuesto a contar (su versión). */
export function rumorsKnownBy(w: WorldState, f: Folk, aboutPlayer?: boolean): { r: SRumor; v: number }[] {
  const s = societyOf(w);
  return s.rumors
    .filter((r) => r.knownBy[f.id] !== undefined && (aboutPlayer === undefined || (r.subject === 'jugador') === aboutPlayer) && w.day - r.day < 60)
    .map((r) => ({ r, v: r.knownBy[f.id] }))
    .sort((a, b) => b.r.heat - a.r.heat || b.r.day - a.r.day);
}

/** Cuántos en el pueblo saben algo del protagonista y qué se dice más. */
export function reputationTalk(w: WorldState, regionId: number): { text: string; people: number; tone: number } | null {
  const s = societyOf(w);
  const life = w.life!;
  let best: { text: string; people: number; tone: number } | null = null;
  for (const r of s.rumors) {
    if (r.subject !== 'jugador') continue;
    const here = Object.entries(r.knownBy).filter(([id]) => life.folk.find((f) => f.id === id)?.regionId === regionId);
    if (!here.length) continue;
    const counts = new Map<number, number>();
    for (const [, v] of here) counts.set(v, (counts.get(v) ?? 0) + 1);
    const [v] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best || here.length > best.people) best = { text: r.versions[v], people: here.length, tone: r.tone };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Conversación: lo que dice cada uno depende de quién es y de lo que pasa
// ---------------------------------------------------------------------------
/** Frases propias de un vecino para la conversación con el jugador. */
export function chatter(w: WorldState, f: Folk, rng: Rng, hour: number, weather: string, extra: { price?: number; scarce?: boolean; festival?: string; mourningFor?: string }): string[] {
  const p = f.p;
  if (!p) return [];
  const out: string[] = [];
  const shy = trait(f, 'timido') > 68;
  const wary = trait(f, 'desconfiado') > 70 && f.trust < 0.45;
  // Su estado de ánimo manda.
  if (extra.mourningFor) out.push(rng.pick([`Enterramos a ${extra.mourningFor} hace nada. Perdona si no tengo ganas de hablar.`, `Desde que se fue ${extra.mourningFor}, la casa está demasiado callada.`]));
  else if (p.sick !== undefined && p.sick >= w.day) out.push('*tose* Llevo días con fiebre. No te acerques mucho.');
  else if (p.emo.enojo > 0.6) out.push(rng.pick(['Hoy no es buen día. Habla rápido.', 'Si vienes a molestar, no es el momento.']));
  else if (p.emo.tristeza > 0.6) out.push(rng.pick(['No sé, últimamente todo me pesa.', 'Perdona, tengo la cabeza en otra parte.']));
  else if (p.emo.miedo > 0.6) out.push(rng.pick(['¿Has visto algo raro por los caminos? Estoy intranquilo.', 'Cierra bien tu puerta esta noche. Por si acaso.']));
  else if (p.emo.felicidad > 0.65 && !shy) out.push(rng.pick(['¡Qué buen día! ¿No te parece?', 'Hoy todo sale bien, ya verás.']));
  // Oficio y economía.
  if (f.role === 'comerciante' && extra.price !== undefined) {
    if (extra.scarce) out.push(rng.pick([`El pan está por las nubes: ${extra.price} monedas. Y aún así se me acaba.`, `No queda casi nada en el puesto. Lo poco que llega, vuela.`]));
    else if (extra.price <= 1) out.push('Hay comida de sobra. Si quieres algo, es buen momento.');
  } else if (extra.scarce && f.role !== 'nino') out.push(rng.pick(['Todo está carísimo. No sé cómo vamos a llegar al invierno.', 'El comerciante sube los precios cada día. Algunos ya no pueden comprar.']));
  // Hora y clima.
  if (hour >= 21 || hour < 6) out.push(rng.pick(['¿Qué haces despierto a estas horas?', 'Es tarde. La gente decente está en casa.']));
  else if (weather === 'tormenta') out.push('Con esta tormenta no se puede hacer nada. Ni trabajar ni dormir.');
  else if (weather === 'lluvia' && (f.role === 'campesino' || f.role === 'pastor')) out.push('Al menos la lluvia es buena para el campo.');
  if (extra.festival) out.push(extra.festival);
  // Objetivos: lo que quiere en la vida.
  const goal = p.goals[0];
  if (goal && !shy && rng.chance(0.55)) {
    const txt: Partial<Record<string, string>> = {
      ahorrar: 'Estoy ahorrando. Algún día tendré lo mío.',
      puesto: 'Quiero abrir mi propio puesto en el mercado. Ya casi tengo el dinero.',
      casarse: goal.target ? `¿Conoces a ${N(w, goal.target)}? No… nada, era por preguntar.` : 'A veces pienso que ya va siendo hora de formar una familia.',
      mudarse: 'Si esto sigue así, me iré. Dicen que en otras tierras se vive mejor.',
      venganza: goal.target ? `${N(w, goal.target)} me las pagará. Tarde o temprano.` : 'Hay cuentas pendientes en este pueblo.',
      reconciliarse: goal.target ? `Echo de menos hablar con ${N(w, goal.target)}. Pero no voy a ser yo quien dé el primer paso… o sí.` : '',
      aprender: 'Me gustaría aprender un oficio nuevo. Este ya no me llena.',
      cuidar: goal.target ? `Cuido de ${N(w, goal.target)}, que está mal. No tengo tiempo para mucho más.` : '',
    };
    const t = txt[goal.kind];
    if (t) out.push(t);
  }
  // Su gente: familia, amistades, enemistades (contado por su boca, no con números).
  const ties = tiesOf(w, f.id).filter((t) => t.kin || Math.abs(t.aff) >= 40);
  if (ties.length && rng.chance(shy ? 0.25 : 0.55)) {
    const t = rng.pick(ties);
    const o = folkById(w, other(t, f.id));
    if (o?.alive) {
      const st = standingOf(t);
      if (t.kin === 'pareja') out.push(t.aff > 40 ? `${o.name} y yo llevamos juntos ${Math.max(1, Math.round((w.day - t.since) / 20))} años. No me imagino sin ${o.gender === 'f' ? 'ella' : 'él'}.` : `Con ${o.name}, en casa, las cosas no van bien. Pero eso no es asunto tuyo.`);
      else if (t.kin === 'progenitor' && t.parent === f.id) out.push(o.age < 14 ? `Mi ${o.gender === 'f' ? 'hija' : 'hijo'} ${o.name} no para quieto. Como yo a su edad.` : `Mi ${o.gender === 'f' ? 'hija' : 'hijo'} ${o.name} ya hace su vida. Ser ${ROLE_TITLE[o.role]} no es fácil.`);
      else if (t.kin === 'progenitor') out.push(`Mi ${o.gender === 'f' ? 'madre' : 'padre'}, ${o.name}, ${t.aff > 30 ? 'me lo enseñó todo' : 'y yo no siempre nos entendemos'}.`);
      else if (t.kin === 'hermanos') out.push(t.aff > 20 ? `${o.name} es ${o.gender === 'f' ? 'mi hermana' : 'mi hermano'}. Si le haces algo, me lo haces a mí.` : `${o.name} es ${o.gender === 'f' ? 'mi hermana' : 'mi hermano'}, aunque no lo parezca. Hace tiempo que no nos hablamos.`);
      else if (st === 'enemigo') out.push(`No me hables de ${o.name}. Ni de lejos.`);
      else if (st === 'rival') out.push(`${o.name}… Prefiero no decir lo que pienso.`);
      else if (st === 'amigo cercano' || st === 'aliado') out.push(`${o.name} es como de la familia. Si necesitas algo, pregúntale de mi parte.`);
      else if (st === 'amigo') out.push(`Esta tarde he quedado con ${o.name} en la plaza.`);
      learnFact(w, o.id, `${f.name}: ${relationPhrase(w, f, t)}`);
    }
  }
  // Algo que le gusta o le molesta.
  if (rng.chance(0.18) && !wary) out.push(rng.chance(0.5) ? `Si algún día quieres alegrarme el día, ya sabes: ${p.likes}.` : `Lo que no soporto es ${p.dislikes}.`);
  if (wary && rng.chance(0.6)) out.push('¿Y tú por qué preguntas tanto?');
  return shy ? out.slice(0, 2) : out.slice(0, 3);
}

/** Cómo describe un vecino su relación con otro. */
export function relationPhrase(w: WorldState, f: Folk, t: ReturnType<typeof tieOf>): string {
  if (!t) return 'apenas se conocen';
  const o = folkById(w, other(t, f.id));
  if (t.kin === 'pareja') return `es su pareja${o ? '' : ''}`;
  if (t.kin === 'hermanos') return o?.gender === 'f' ? 'es su hermana' : 'es su hermano';
  if (t.kin === 'progenitor') return t.parent === f.id ? (o?.gender === 'f' ? 'es su hija' : 'es su hijo') : o?.gender === 'f' ? 'es su madre' : 'es su padre';
  if (t.kin === 'expareja') return 'fueron pareja';
  const st = standingOf(t);
  return st === 'enemigo' ? 'no se soportan' : st === 'rival' ? 'se llevan mal' : st === 'amigo cercano' || st === 'aliado' ? 'son uña y carne' : st === 'amigo' ? 'son amigos' : st === 'frecuente' ? 'se tratan a menudo' : 'se conocen de vista';
}

/** El jugador se entera de algo de alguien (aparece en «Gente que conoces»). */
export function learnFact(w: WorldState, about: string, fact: string): void {
  const s = societyOf(w);
  const list = (s.facts[about] ??= []);
  if (!list.includes(fact)) list.push(fact);
  if (list.length > 6) list.shift();
}

/** Lo que se oye al pasar junto a dos vecinos que charlan. */
export function overheard(w: WorldState, a: Folk, b: Folk, seed: number): string | null {
  const s = societyOf(w);
  const shared = s.rumors.filter((r) => r.knownBy[a.id] !== undefined && r.heat > 0.15 && r.subject !== a.id && r.subject !== b.id);
  const t = tieOf(w, a.id, b.id);
  const opts: string[] = [];
  for (const r of shared.slice(0, 3)) opts.push(`«…${lower(r.versions[r.knownBy[a.id]])}»`);
  if (t?.kin === 'pareja') opts.push('«…¿has cerrado el corral?»', '«…esta noche cenamos pronto»');
  if (t && t.aff <= -25) opts.push('«…y no vuelvas a hablarme así»', '«…eso no es lo que pasó»');
  if (t && t.aff >= 40) opts.push('«…ja, ja, ¿te acuerdas de aquella vez?»', '«…mañana te ayudo con eso»');
  const m = s.market[a.regionId];
  if (m && m.price.comida > 1.8) opts.push('«…a este paso no comemos este invierno»', '«…otra vez ha subido el pan»');
  if (!opts.length) opts.push('«…y entonces le dije que no»', '«…el tiempo está cambiando»', '«…mañana hay mercado»');
  return opts[Math.abs(seed) % opts.length];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, '');

/** Lo que opina un vecino de otro, con su carácter (sin números). */
export function opinionOf(w: WorldState, f: Folk, o: Folk): string {
  const t = tieOf(w, f.id, o.id);
  const he = o.gender === 'f' ? 'ella' : 'él';
  if (!t || (t.fam < 10 && !t.kin)) return trait(f, 'desconfiado') > 65 ? `«¿${o.name}? No me meto en la vida de nadie. Y tú tampoco deberías.»` : `«¿${o.name}? Apenas le conozco.»`;
  learnFact(w, o.id, `${f.name}: ${relationPhrase(w, f, t)}`);
  if (t.kin === 'pareja') return t.aff > 30 ? `«${o.name} es lo mejor que me ha pasado.»` : `«${o.name} y yo… estamos pasando una mala época.»`;
  if (t.kin === 'expareja') return `«Fuimos pareja. Ya no. No quiero hablar de ${he}.»`;
  if (t.kin === 'hermanos') return t.aff > 20 ? `«Es ${o.gender === 'f' ? 'mi hermana' : 'mi hermano'}. Por ${he} lo que haga falta.»` : `«Es ${o.gender === 'f' ? 'mi hermana' : 'mi hermano'}, pero hace tiempo que no nos entendemos.»`;
  if (t.kin === 'progenitor') return t.parent === f.id ? `«Es ${o.gender === 'f' ? 'mi hija' : 'mi hijo'}. ${t.aff > 30 ? 'Estoy orgulloso de lo que hace.' : 'Ojalá me hiciera más caso.'}»` : `«Es ${o.gender === 'f' ? 'mi madre' : 'mi padre'}. ${t.aff > 30 ? 'Me lo enseñó todo.' : 'Tenemos nuestras diferencias.'}»`;
  const st = standingOf(t);
  switch (st) {
    case 'enemigo':
      return `«${o.name} es una víbora. No le des la espalda.»`;
    case 'rival':
      return trait(f, 'orgulloso') > 60 ? `«${o.name} se cree mejor que nadie. Ya se le bajarán los humos.»` : `«${o.name} y yo no nos llevamos bien. Cosas que pasan.»`;
    case 'aliado':
      return `«Con ${o.name} hago tratos desde hace años. Es de fiar.»`;
    case 'amigo cercano':
      return `«${o.name} es como de mi familia. Si te metes con ${he}, te metes conmigo.»`;
    case 'amigo':
      return `«${o.name} es buena gente. Solemos charlar por las tardes.»`;
    case 'frecuente':
      return `«Le veo todos los días. Ni fu ni fa.»`;
    default:
      return `«${o.name}… de vista, nada más.»`;
  }
}
