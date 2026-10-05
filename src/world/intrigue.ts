import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { FOODS, foodDays, foodIndex, marketOf } from './economy';
import { seedRumor } from './gossip';
import { chanceOf, gain, levelOf, story, type GainNote } from './identity';
import { folkById, logEvent, memorize, trait } from './society';
import type { Folk } from './types';
import { adjustRep, orgById, orgsOf } from './orgs';
import { govOf, recordDecision } from './politics';
import { nid, polOf, type Secret, type SecretKind } from './polstate';

/**
 * La información es poder. Lo que pasa de verdad (una crisis que alguien
 * esconde, un comerciante que acapara grano, quien gobierna perdiendo
 * apoyos, un paso secreto por el monte, una conspiración, un ejército sin
 * comida) deja rastro en la gente que lo sabe. El jugador lo averigua
 * preguntando, comparando versiones (algunas mienten), revisando cuentas o
 * mirando los precios… y decide qué hacer con ello: avisar, publicar,
 * negociar, chantajear, manipular o ayudar.
 */
const has = (w: WorldState, kind: SecretKind, regionId: number, about?: string) => polOf(w).secrets.some((s) => s.kind === kind && s.regionId === regionId && (!about || s.about === about) && s.expires > w.day && !s.public);

function add(w: WorldState, s: Omit<Secret, 'id' | 'day' | 'testimonies' | 'known' | 'suspected' | 'used' | 'public'>): Secret {
  const sec: Secret = { ...s, id: nid(w, 's'), day: w.day, testimonies: [], known: false, suspected: false, used: [], public: false };
  polOf(w).secrets.push(sec);
  return sec;
}

const adults = (w: WorldState, regionId: number) => w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 16 && f.p);

export function intrigueDay(w: WorldState, rng: Rng): string[] {
  const pol = polOf(w);
  for (const r of w.regions) {
    const g = govOf(w, r.id);
    const m = marketOf(w, r.id);
    const ruler = g.ruler && g.ruler !== 'jugador' ? folkById(w, g.ruler) : undefined;
    const council = g.council.filter((x) => x !== 'jugador');
    // Una crisis escondida: el granero se vacía y quien gobierna no lo dice.
    if (foodDays(w, r.id) < 2.5 && ruler && (trait(ruler, 'orgulloso') > 55 || g.system === 'monarquia' || g.system === 'militar') && !has(w, 'crisis', r.id))
      add(w, { kind: 'crisis', regionId: r.id, about: ruler.id, text: `${ruler.name} sabe que en ${r.name} no queda grano para muchos días, y lo calla para que no cunda el pánico.`, hint: `En ${r.name} el intendente cuenta los sacos dos veces y no dice nada.`, holders: [ruler.id, ...council.slice(0, 2), ...adults(w, r.id).filter((f) => f.role === 'comerciante').map((f) => f.id)], expires: w.day + 20 });
    // Acaparamiento: un comerciante guarda comida para venderla más cara.
    if (foodIndex(m) > 1.5 && rng.chance(0.08)) {
      const greedy = adults(w, r.id).filter((f) => f.role === 'comerciante' && f.p!.coins > 25 && trait(f, 'egoista') + trait(f, 'ambicioso') > 105 && !pol.hoards[f.id])[0];
      if (greedy) {
        const n = Math.min(FOODS.reduce((s, g2) => s + m.stock[g2], 0) * 0.2, 25);
        for (const g2 of FOODS) m.stock[g2] *= 1 - n / Math.max(1, FOODS.reduce((s, g3) => s + m.stock[g3], 0));
        pol.hoards[greedy.id] = { regionId: r.id, n };
        add(w, { kind: 'acaparamiento', regionId: r.id, about: greedy.id, text: `${greedy.name} esconde comida en su almacén para venderla cuando esté aún más cara.`, hint: `Dicen que en el almacén de ${greedy.name} entra más de lo que sale.`, holders: [greedy.id, ...adults(w, r.id).filter((f) => w.life!.society!.ties[f.id < greedy.id ? `${f.id}|${greedy.id}` : `${greedy.id}|${f.id}`]?.kin).map((f) => f.id)], expires: w.day + 30 });
      }
    }
    // Quien gobierna pierde apoyos.
    if (ruler && g.legitimacy < 0.4 && !has(w, 'apoyos', r.id, ruler.id))
      add(w, { kind: 'apoyos', regionId: r.id, about: ruler.id, text: `El consejo ya no respalda a ${ruler.name}: si cae, pocos lo defenderán.`, hint: `En ${r.name} los del consejo cuchichean cuando pasa ${ruler.name}.`, holders: council, expires: w.day + 25 });
    // Corrupción: quien gobierna mete la mano en las arcas.
    if (ruler && trait(ruler, 'egoista') > 62 && ruler.honesty < 0.5 && m.treasury > 8) {
      const take = m.treasury * 0.04;
      m.treasury -= take;
      if (ruler.p) ruler.p.coins += take;
      if (!has(w, 'corrupcion', r.id, ruler.id)) add(w, { kind: 'corrupcion', regionId: r.id, about: ruler.id, text: `${ruler.name} se queda con parte de lo que entra en las arcas de ${r.name}.`, hint: `Las arcas de ${r.name} nunca terminan de llenarse, y ${ruler.name} estrena ropa.`, holders: council.slice(0, 2), expires: w.day + 60 });
    }
  }
  // Pasos secretos: una vez por partida, un par de caminos que no salen en los mapas.
  if (!pol.secrets.some((s) => s.kind === 'ruta')) {
    const regs = w.regions.filter((r) => r.neighbors.length >= 2);
    for (let i = 0; i < 2 && regs.length > 2; i++) {
      const a = regs[(hashString(`ruta${w.seed}${i}`) >>> 0) % regs.length];
      const b = w.regions.find((x) => x.id !== a.id && !a.neighbors.includes(x.id) && x.neighbors.some((n) => a.neighbors.includes(n)));
      if (!b) continue;
      const scout = adults(w, a.id).find((f) => f.role === 'exploradora' || f.role === 'pastor') ?? adults(w, a.id)[0];
      add(w, { kind: 'ruta', regionId: a.id, other: b.id, about: scout?.id, text: `Hay un paso por el monte entre ${a.name} y ${b.name} que no sale en ningún mapa: más corto, y sin bandidos.`, hint: `Los pastores de ${a.name} hablan de un atajo que solo conocen ellos.`, holders: adults(w, a.id).filter((f) => f.role === 'pastor' || f.role === 'exploradora' || f.role === 'lenador').map((f) => f.id), expires: w.day + 9999 });
    }
  }
  // Lo que ya no es secreto o ya no importa.
  for (const s of pol.secrets) {
    if (s.kind === 'acaparamiento' && s.about && pol.hoards[s.about] && foodIndex(marketOf(w, s.regionId)) < 1.1) releaseHoard(w, s.about, false);
  }
  pol.secrets = pol.secrets.filter((s) => s.expires > w.day || s.known);
  if (pol.secrets.length > 60) pol.secrets.splice(0, pol.secrets.length - 60);
  return [];
}

/** El acaparador saca lo escondido (al bajar los precios, o porque le han descubierto). */
function releaseHoard(w: WorldState, folkId: string, exposed: boolean): void {
  const pol = polOf(w);
  const h = pol.hoards[folkId];
  if (!h) return;
  const m = marketOf(w, h.regionId);
  m.stock.trigo += h.n * 0.6;
  m.stock.verdura += h.n * 0.4;
  delete pol.hoards[folkId];
  if (exposed) {
    const f = folkById(w, folkId);
    logEvent(w, h.regionId, 'politica', `${f?.name} tiene que sacar al mercado la comida que escondía.`, [folkId]);
  }
}

// ---------------------------------------------------------------------------
// Investigar: preguntar, comparar versiones, revisar cuentas, mirar precios
// ---------------------------------------------------------------------------
/** Lo que alguien sabe y podría contar (o torcer). */
export function secretsHeldBy(w: WorldState, f: Folk): Secret[] {
  return polOf(w).secrets.filter((s) => !s.known && !s.public && s.holders.includes(f.id) && s.expires > w.day);
}

/** Lo que el jugador ha oído de lejos (pistas sin confirmar). */
export function suspicions(w: WorldState): Secret[] {
  return polOf(w).secrets.filter((s) => s.suspected && !s.known);
}

/** Preguntar a alguien que sabe algo. Puede decir la verdad, callar o mentir. */
export function pry(w: WorldState, f: Folk): { lines: string[]; notes: GainNote[] } {
  const id = w.life!.identity!;
  const list = secretsHeldBy(w, f);
  const rng = new Rng(hashString(`pry:${f.id}:${w.day}:${Math.floor(w.life!.clock / 60)}`));
  const notes = gain(w, 'investigacion', 0.6);
  w.life!.clock += 40;
  if (!list.length) return { lines: ['«No sé de qué me hablas.» Y parece sincero.'], notes };
  const s = list[0];
  s.suspected = true;
  const odds = chanceOf(id, 'investigacion', 1) + (f.trust - 0.5) * 0.5 - (s.about === f.id ? 0.4 : 0);
  if (!rng.chance(clamp(odds, 0.1, 0.9))) {
    f.trust = Math.max(0, f.trust - 0.04);
    return { lines: [rng.pick(['Cambia de tema en cuanto sacas el asunto.', '«Yo de eso no hablo.»', 'Te mira con desconfianza y se va.'])], notes };
  }
  // ¿Dice la verdad? Los poco honrados (y los implicados) tuercen la historia.
  const truthful = rng.chance(f.honesty * (s.about === f.id ? 0.3 : 1));
  const text = truthful ? s.text : twist(w, s, f, rng);
  s.testimonies.push({ by: f.id, day: w.day, text, truthful });
  memorize(w, f, { kind: 'pregunta', about: 'jugador', text: 'Me preguntó por cosas que no debería saber.', w: -0.05, src: 'propio' });
  const lines = [`«${text}»`];
  lines.push(...checkConfirm(w, s));
  return { lines, notes };
}

function twist(w: WorldState, s: Secret, f: Folk, rng: Rng): string {
  const other = adults(w, s.regionId).filter((x) => x.id !== s.about && x.id !== f.id);
  const scapegoat = other.length ? rng.pick(other).name : 'alguien de fuera';
  switch (s.kind) {
    case 'acaparamiento': return `Si falta comida es por culpa de ${scapegoat}, que lo compra todo.`;
    case 'crisis': return 'El granero está bien. Hay de sobra. No hagas caso de lo que dicen.';
    case 'corrupcion': return `Las arcas están vacías porque ${scapegoat} no paga lo que debe.`;
    case 'conspiracion': return 'Por la noche solo se juntan a beber. No hay nada más.';
    case 'apoyos': return 'Todo el consejo está con quien gobierna. No hay ninguna división.';
    case 'ruta': return 'No hay ningún atajo. El que lo intente se mata en el monte.';
    case 'ejercito': return 'Su ejército está bien abastecido. Aguantarán lo que haga falta.';
  }
}

/**
 * Comparar testimonios: con dos versiones que coinciden y la verdad entre
 * ellas, el jugador lo confirma. Si se contradicen, decide su olfato.
 */
function checkConfirm(w: WorldState, s: Secret): string[] {
  const id = w.life!.identity!;
  const t = s.testimonies;
  const agree = t.filter((x) => x.truthful).length;
  if (agree >= 2 || (agree >= 1 && t.some((x) => x.by === 'documentos' || x.by === 'mercado'))) return confirm(w, s);
  if (t.length >= 2 && new Set(t.map((x) => x.text)).size > 1) {
    // Versiones que no cuadran: quien sabe investigar nota cuál es la buena.
    if (levelOf(id, 'investigacion') >= 2 && agree >= 1) {
      return ['(Las versiones no cuadran. Pero una encaja con todo lo demás que has visto.)', ...confirm(w, s)];
    }
    return ['(Dos versiones distintas. Alguien miente. Necesitas otra fuente: alguien más, unas cuentas, los precios…)'];
  }
  return ['(Es solo una versión. Habría que contrastarla.)'];
}

function confirm(w: WorldState, s: Secret): string[] {
  s.known = true;
  story(w, `Descubrió un secreto en ${w.regions[s.regionId].name}: ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}`, 'conocimiento');
  recordDecision(w, 'persona', s.regionId, 'Descubrió un secreto.');
  for (const o of orgsOf(w)) if (o.player.task?.kind === 'investigar' && o.player.task.secret === s.id) o.player.task.until = w.day + 3;
  if (s.kind === 'conspiracion') {
    const clan = orgById(w, s.about);
    if (clan) clan.known = true;
  }
  return [`(Ahora lo sabes: ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)})`];
}

/** Revisar las cuentas del salón (hace falta que te dejen o colarse). */
export function readDocuments(w: WorldState, regionId: number): { lines: string[]; notes: GainNote[] } {
  const id = w.life!.identity!;
  const allowed = (id.standing[regionId] ?? 0) >= 3;
  const rng = new Rng(hashString(`doc:${regionId}:${w.day}`));
  const notes = gain(w, allowed ? 'investigacion' : 'sigilo', 0.6);
  w.life!.clock += 60;
  if (!allowed && !rng.chance(chanceOf(id, 'sigilo', 1.5))) {
    id.score[regionId] = (id.score[regionId] ?? 0) - 4;
    return { lines: ['Te pillan revolviendo los papeles. «¿Qué haces aquí?» Te echan a empujones.'], notes };
  }
  const m = marketOf(w, regionId);
  const lines = [m.treasury < 5 ? 'Las cuentas dicen que las arcas están casi vacías.' : m.treasury > 40 ? 'Las cuentas dicen que las arcas están llenas.' : 'Las cuentas cuadran a duras penas.'];
  for (const s of polOf(w).secrets.filter((x) => x.regionId === regionId && !x.known && (x.kind === 'corrupcion' || x.kind === 'crisis' || x.kind === 'apoyos'))) {
    s.suspected = true;
    s.testimonies.push({ by: 'documentos', day: w.day, text: s.kind === 'corrupcion' ? 'Faltan monedas: entra más de lo que se apunta.' : s.kind === 'crisis' ? 'El inventario del granero no coincide con lo que se anuncia.' : 'Las actas muestran votos cada vez más divididos.', truthful: true });
    lines.push(s.kind === 'corrupcion' ? 'Hay apuntes que no cuadran: falta dinero que nadie explica.' : s.kind === 'crisis' ? 'Lo que hay en el granero es mucho menos de lo que se dice en la plaza.' : 'En las actas, cada vez menos votos apoyan a quien gobierna.');
    lines.push(...checkConfirm(w, s));
  }
  return { lines, notes };
}

/** Mirar los precios con ojo de mercader: ¿falta comida o alguien la esconde? */
export function readMarket(w: WorldState, regionId: number): { lines: string[]; notes: GainNote[] } {
  const id = w.life!.identity!;
  const notes = gain(w, 'k:economia', 0.4);
  const lines: string[] = [];
  const m = marketOf(w, regionId);
  const harvested = (m.made.trigo ?? 0) > 0 || foodDays(w, regionId) > 1;
  for (const s of polOf(w).secrets.filter((x) => x.regionId === regionId && x.kind === 'acaparamiento' && !x.known)) {
    if (levelOf(id, 'k:economia') + levelOf(id, 'comercio') < 1) {
      lines.push('Los precios están muy altos, pero no sabrías decir por qué.');
      continue;
    }
    s.suspected = true;
    s.testimonies.push({ by: 'mercado', day: w.day, text: 'La comida está carísima sin que haya faltado cosecha: alguien la retiene.', truthful: true });
    lines.push(harvested ? 'La comida está carísima y, sin embargo, la cosecha no fue mala. No cuadra: alguien la está reteniendo.' : 'Los precios suben más de lo que explica la escasez.');
    lines.push(...checkConfirm(w, s));
  }
  if (!lines.length) lines.push(foodIndex(m) > 1.4 ? 'Los precios están altos, pero cuadran con lo que hay.' : 'Los precios son los normales para lo que hay.');
  return { lines, notes };
}

// ---------------------------------------------------------------------------
// Usar lo que se sabe
// ---------------------------------------------------------------------------
export type SecretUse = 'advertir' | 'publicar' | 'chantajear' | 'manipular' | 'ayudar';

export function secretUses(w: WorldState, s: Secret): { use: SecretUse; label: string; hint: string }[] {
  const out: { use: SecretUse; label: string; hint: string }[] = [];
  const about = s.about ? folkById(w, s.about) : undefined;
  if (s.kind === 'conspiracion') out.push({ use: 'advertir', label: '🗝 Avisar a quien gobierna', hint: 'La conspiración se cortará de raíz. Los conjurados no te lo perdonarán.' });
  if (s.kind === 'crisis') out.push({ use: 'advertir', label: '📢 Avisar a la gente', hint: 'Se prepararán… y quizá acaparen. Quien gobierna quedará mal.' });
  if (s.kind === 'ruta') out.push({ use: 'ayudar', label: '🧭 Contárselo a los comerciantes', hint: 'Sus caravanas irán más seguras; los pastores perderán su ventaja.' });
  if (s.kind === 'ejercito') out.push({ use: 'ayudar', label: '🛡 Contárselo a la guardia', hint: 'Sabrán cuándo atacar o resistir.' });
  out.push({ use: 'publicar', label: '📣 Hacerlo público', hint: 'Que lo sepa todo el mundo. Las consecuencias, para quien le toque.' });
  if (about && s.kind !== 'ruta') out.push({ use: 'chantajear', label: `🌒 Presionar a ${about.name}`, hint: 'Sacarás algo. Pero te odiará, y puede contarlo.' });
  out.push({ use: 'manipular', label: '🌀 Contar una versión que te convenga', hint: 'Echar la culpa a otros grupos. Si se descubre, caerá sobre ti.' });
  return out;
}

export function useSecret(w: WorldState, secretId: string, use: SecretUse): { lines: string[]; notes: GainNote[] } {
  const pol = polOf(w);
  const s = pol.secrets.find((x) => x.id === secretId && x.known);
  if (!s) return { lines: ['No sabes nada con certeza.'], notes: [] };
  const r = w.regions[s.regionId];
  const g = govOf(w, s.regionId);
  const id = w.life!.identity!;
  const about = s.about ? folkById(w, s.about) : undefined;
  const lines: string[] = [];
  let notes: GainNote[] = [];
  s.used.push(use);
  const everyone = adults(w, s.regionId).map((f) => f.id);
  switch (use) {
    case 'advertir':
      if (s.kind === 'conspiracion') {
        const reb = pol.rebellions[s.regionId];
        const clan = orgById(w, s.about);
        if (reb) {
          reb.warned = true;
          reb.stage = 0;
          reb.since = w.day;
        }
        g.repression = clamp(g.repression + 0.3);
        if (clan) {
          clan.dissolved = w.day;
          for (const m of clan.members) {
            const f = folkById(w, m);
            if (f) {
              f.resentment = Math.min(1, f.resentment + 0.4);
              memorize(w, f, { kind: 'delacion', about: 'jugador', text: 'Nos delató. Por su culpa nos persiguieron.', w: -0.8, src: 'oido' });
            }
          }
        }
        const ruler = g.ruler && g.ruler !== 'jugador' ? folkById(w, g.ruler) : undefined;
        if (ruler) {
          ruler.trust = Math.min(1, ruler.trust + 0.25);
          ruler.gratitude = Math.min(1, ruler.gratitude + 0.3);
          pol.favors[ruler.id] = (pol.favors[ruler.id] ?? 0) + 2;
        }
        id.score[s.regionId] = (id.score[s.regionId] ?? 0) + 6;
        lines.push(`Se lo cuentas a ${ruler?.name ?? 'quien gobierna'}. Esa misma noche la guardia entra en las casas de los conjurados.`, '(Quien gobierna te debe una. Los perseguidos, y sus familias, no lo olvidarán.)');
        story(w, `Delató una conspiración en ${r.name}.`, 'decision');
        recordDecision(w, 'region', s.regionId, `Delató la conspiración de ${r.name}.`);
      } else if (s.kind === 'crisis') {
        s.public = true;
        g.legitimacy = clamp(g.legitimacy - 0.15);
        // La gente se prepara: compra lo que puede (y los precios suben antes).
        const m = marketOf(w, s.regionId);
        for (const gd of FOODS) m.price[gd] = Math.round(m.price[gd] * 1.3 * 100) / 100;
        if (g.laws.agricultura !== 'granero') pol.proposals.push({ id: nid(w, 'p'), regionId: s.regionId, law: 'agricultura', value: 'granero', from: 'gobierno', day: w.day, voteDay: w.day + 2, status: 'abierta', sway: {}, pressure: {}, heard: [] });
        seedRumor(w, { regionId: s.regionId, kind: 'politica', subject: about?.id ?? everyone[0], witnesses: everyone, versions: [s.text, 'Dicen que no queda grano y que nos lo han escondido.', 'Dicen que este invierno moriremos de hambre.'], tone: -0.5, heat: 1.2 });
        lines.push('Lo cuentas en la plaza. En una hora no queda nadie que no lo sepa: unos corren al mercado, otros al salón a pedir explicaciones.');
        recordDecision(w, 'pueblo', s.regionId, `Destapó la crisis escondida de ${r.name}.`);
      }
      break;
    case 'publicar': {
      s.public = true;
      seedRumor(w, { regionId: s.regionId, kind: 'politica', subject: about?.id ?? everyone[0], witnesses: everyone.slice(0, Math.ceil(everyone.length / 2)), versions: [s.text, `Dicen que ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}`], tone: -0.6, heat: 1.2 });
      if (s.kind === 'corrupcion' || s.kind === 'apoyos') {
        g.legitimacy = clamp(g.legitimacy - (s.kind === 'corrupcion' ? 0.3 : 0.12));
        if (about) about.p && (about.p.emo.miedo = clamp(about.p.emo.miedo + 0.4));
        if (g.system === 'alcalde' || g.system === 'republica') g.nextElection = Math.min(g.nextElection ?? w.day + 5, w.day + 5);
        lines.push(`Cuando se sabe, el salón se llena de gritos. ${about?.name ?? 'Quien gobierna'} ya no puede pasear por la plaza sin que le insulten.`);
      } else if (s.kind === 'acaparamiento' && s.about) {
        releaseHoard(w, s.about, true);
        if (about) about.resentment = Math.min(1, about.resentment + 0.5);
        for (const o of orgsOf(w, s.regionId).filter((x) => x.kind === 'comunidad')) adjustRep(w, o, 0.2);
        for (const o of orgsOf(w, s.regionId).filter((x) => x.kind === 'comerciantes')) adjustRep(w, o, -0.1);
        lines.push(`${about?.name} tiene que sacar la comida que escondía. Los precios bajan; su nombre, también.`);
      } else if (s.kind === 'ruta') {
        lines.push('Ya todo el mundo conoce el paso. Los pastores te miran mal: era su secreto.');
      } else if (s.kind === 'conspiracion') {
        const reb = pol.rebellions[s.regionId];
        if (reb) reb.stage = Math.max(1, reb.stage - 1);
        g.repression = clamp(g.repression + 0.15);
        lines.push('Al saberse, unos conjurados huyen y otros se esconden. La conspiración se desinfla… por ahora.');
      } else lines.push('Ahora lo sabe todo el mundo.');
      story(w, `Hizo público un secreto en ${r.name}.`, 'decision');
      recordDecision(w, 'pueblo', s.regionId, 'Hizo público un secreto.');
      break;
    }
    case 'chantajear': {
      if (!about?.p) break;
      const take = Math.min(about.p.coins, 6 + Math.round(about.p.coins * 0.2));
      about.p.coins -= take;
      id.needs.coins += take;
      about.resentment = Math.min(1, about.resentment + 0.5);
      about.fear = Math.min(1, about.fear + 0.35);
      pol.favors[about.id] = (pol.favors[about.id] ?? 0) + 2;
      memorize(w, about, { kind: 'chantaje', about: 'jugador', text: 'Me chantajeó con lo que sabía.', w: -0.9, src: 'propio' });
      pol.delayed.push({ day: w.day + 8 + (hashString(s.id) % 12), kind: 'venganza', regionId: s.regionId, data: { folk: about.id, secret: s.id } });
      lines.push(`${about.name} palidece. Te da ${take} monedas y promete hacerte un favor cuando lo pidas.`, '(Te odia. Y tiene memoria.)');
      notes = gain(w, 'sigilo', 0.5);
      story(w, `Chantajeó a ${about.name}.`, 'decision');
      recordDecision(w, 'persona', s.regionId, `Chantajeó a ${about.name}.`);
      break;
    }
    case 'manipular': {
      const targets = orgsOf(w, s.regionId).filter((o) => !o.hidden && o.leader !== 'jugador' && o.player.rank < 2);
      const scape = targets.sort((a, b) => b.standing - a.standing)[0];
      if (!scape) break;
      scape.standing = clamp(scape.standing - 0.15);
      seedRumor(w, { regionId: s.regionId, kind: 'politica', subject: everyone[0], witnesses: everyone.slice(0, 5), versions: [`Dicen que detrás de todo está ${scape.name}.`, `Dicen que ${scape.name} lo ha planeado desde el principio.`], tone: -0.5, heat: 1 });
      // Si alguien sabe la verdad, puede descubrir el engaño.
      if (s.holders.some((h) => (folkById(w, h)?.honesty ?? 0) > 0.7)) pol.delayed.push({ day: w.day + 12, kind: 'venganza', regionId: s.regionId, data: { folk: s.holders[0], secret: s.id } });
      lines.push(`Cuentas que la culpa es de ${scape.name}. Hay quien te cree. Hay quien no.`);
      notes = gain(w, 'persuasion', 0.4);
      story(w, `Echó la culpa a ${scape.name} en ${r.name}.`, 'decision');
      break;
    }
    case 'ayudar':
      if (s.kind === 'ruta') {
        pol.secrets = pol.secrets.map((x) => (x === s ? { ...x, public: true } : x));
        for (const o of orgsOf(w, s.regionId).filter((x) => x.kind === 'comerciantes')) adjustRep(w, o, 0.25);
        for (const o of orgsOf(w, s.regionId).filter((x) => x.kind === 'agricultores')) adjustRep(w, o, -0.08);
        lines.push('Los comerciantes te escuchan con los ojos brillantes. Desde ahora, algunas caravanas tomarán el atajo.');
      } else if (s.kind === 'ejercito') {
        const war = pol.wars.find((x) => x.status === 'activa' && (x.a === s.other || x.b === s.other));
        const side = war ? (war.a === s.other ? war.b : war.a) : undefined;
        if (war && side !== undefined) war.armies[side].intel = clamp(war.armies[side].intel + 0.4);
        lines.push('La guardia lo apunta todo. «Esto vale más que cien lanzas.»');
      }
      recordDecision(w, 'pueblo', s.regionId, 'Compartió lo que sabía.');
      break;
  }
  return { lines, notes };
}

/** Las caravanas que conocen un paso secreto van más seguras (lo lee trade.riskOf). */
export function secretRoute(w: WorldState, a: number, b: number): boolean {
  return !!w.life?.politics?.secrets.some((s) => s.kind === 'ruta' && s.public && ((s.regionId === a && s.other === b) || (s.regionId === b && s.other === a)));
}

