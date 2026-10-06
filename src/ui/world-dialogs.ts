import { weatherIn } from '../world/geography';
import { poiDialog, settlementDialog, worldChoices } from './world6';
import { ACTIONS, answerPetition, freeAgents, hasAuthority } from '../core/api';
import { ROLES } from '../core/content/roles';
import type { WorldState } from '../core/types';
import { audio } from '../audio/audio';
import { appearanceOf } from '../render/appearance';
import { drawPortrait } from '../visual/figure/portrait';
import { IH, IW, paintInterior, type InteriorKind, type InteriorPerson } from '../visual/env/interiors';
import { darkness } from '../world/clock';
import { marketOf } from '../world/economy';
import type { Action, Expr } from '../visual/figure/types';
import { moodOf } from '../render/mood';
import type { Target } from '../render/scene';
import { ROLE_TITLE } from '../world/folk';
import { hourOf } from '../world/clock';
import { describeEncounter, encounterOptions, resolveEncounter } from '../world/encounters';
import { doorOf, getLayout, nearestWalkable } from '../world/layout';
import { answerOffer, chooseFragment, gain, hasTalent, levelOf, STANDING, story, tryFragment, type FragmentEvent } from '../world/identity';
import { ensureLife, heirs, succeed } from '../world/life';
import { afterTalk, askAboutMe, buyFood, buyMeal, charity, convince, deceive, eavesdrop, encounterLearning, jobFor, noticeLie, priceOf, readLeader, rentBed, sellRelic, study, tendSick, work, type Outcome } from '../world/livelihood';
import { arcAct, arcChoices } from '../world/arcs';
import { convoyDialog, marketDialog } from './market';
import { playerEco } from '../world/business';
import { describeMarket } from '../world/marketview';
import { opinionOf, seedRumor, type Approach } from '../world/gossip';
import { answerApproach, noticeConversation } from '../world/social';
import { Rng } from '../core/rng';
import { acequiaOptions, acequiaResolve, acequiaView, noteMeeting, prologueChoose, prologueOf, prologueScene, type PScene, type PTarget } from '../world/prologue';
import { emblem } from '../render/sprites';
import { SYMBOLS } from '../world/identity';
import { checkRumorInPerson, examinePlace, listenTavern, templeElders } from '../world/presence';
import { roadPath } from '../world/roadnet';
import { giveTo, observeFolk, talkToFolk } from '../world/talk';
import type { App } from './app';
import { h, vibrate } from './dom';
import { openAction } from './screens/composer';
import { marketSuspicion, politicalChoices, townAffairs, warDialog } from './politics';
import { homeChoices, lifeChoices, recordsChoice } from './generations';

/**
 * Las decisiones salen del menú y entran en el mundo: se toman hablando con
 * la gente, en el almacén, en el salón del consejo, en las posadas y en los
 * puestos fronterizos. Todas pasan por el motor (performAction), así que la
 * memoria, los patrones, las hipótesis y las consecuencias siguen intactos.
 */
interface Choice {
  label: string;
  run: () => void;
  hint?: string;
  primary?: boolean;
  /** Opción de salida (se pinta discreta y sustituye a la ✕). */
  exit?: boolean;
}

/** Caja de diálogo al estilo de los juegos de rol. */
export function dialogue(app: App, title: string, subtitle: string, lines: string[], choices: Choice[], portrait?: HTMLCanvasElement): () => void {
  let close = () => {};
  // Dentro de un edificio, la cabecera es una viñeta pintada del interior.
  const room = !portrait && interiorCtx ? interiorCanvas(app, interiorCtx.kind, interiorCtx.regionId) : null;
  const isExit = (c: Choice) => c.exit ?? /^(Salir|Pensarlo|Seguir sin|Marcharse|Irte|Despedirte|Despedirse|Nada|Dejarlo|Volver|Cerrar|Ahora no|No,? gracias|Otro día|Mejor no)/.test(c.label);
  const hasExit = choices.some(isExit);
  close = app.modal(() => [
    room,
    h('div', { class: `dlg-head ${portrait ? 'with-portrait' : ''}` }, portrait ?? null, h('div', null, h('h2', null, title), subtitle ? h('div', { class: 'tiny' }, subtitle) : null)),
    ...lines.map((l) => h('p', { class: l.startsWith('«') || l.startsWith('—') ? 'quote' : '' }, l)),
    h('div', { class: 'dlg-choices' }, ...choices.map((c) => h('button', { class: isExit(c) ? 'btn exit' : `btn ${c.primary ? 'teal' : ''}`, onclick: () => (close(), c.run()) }, c.label, c.hint ? h('small', null, c.hint) : null))),
  ], { cls: `dialog ${hasExit ? 'has-exit' : ''} ${room ? 'with-room' : ''}` });
  return close;
}

// ---------------------------------------------------------------------------
// Interiores: viñeta pintada y animada de la sala, con quien está dentro.
// ---------------------------------------------------------------------------
let interiorCtx: { kind: InteriorKind; regionId: number } | null = null;
const ROOM_KINDS = new Set(['posada', 'forja', 'salon', 'templo', 'almacen', 'hogar']);

function interiorCanvas(app: App, kind: InteriorKind, regionId: number): HTMLCanvasElement {
  const w = app.w!;
  const life = ensureLife(w);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { class: 'room', width: String(Math.round(IW * dpr)), height: String(Math.round(IH * dpr)) }) as HTMLCanvasElement;
  const folk = life.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 14);
  const pick = (roles: string[], n: number) => folk.filter((f) => roles.includes(f.role)).slice(0, n);
  const cast: [string[], number, Action, Expr][] = {
    posada: [[['posadero'], 1, 'talk', 'feliz'], [['campesino', 'pescador', 'pastor', 'lenador', 'minero'], 2, 'eat', 'neutral'], [['comerciante'], 1, 'listen', 'desconfianza']],
    forja: [[['artesano', 'carpintero'], 1, 'hammer', 'cansado']],
    salon: [[['lider'], 1, 'talk', 'confiado'], [['guardia'], 1, 'idle', 'neutral'], [['anciano', 'comerciante'], 1, 'listen', 'preocupado']],
    templo: [[['anciano', 'sanadora'], 2, 'listen', 'neutral']],
    almacen: [[['comerciante'], 1, 'carry', 'neutral']],
    hogar: [],
  }[kind] as [string[], number, Action, Expr][];
  const people: InteriorPerson[] = [];
  for (const [roles, n, action, expr] of cast) for (const f of pick(roles, n)) people.push({ ap: appearanceOf(w, f), action, expr: expr === 'neutral' ? moodOf(w, f) : expr, x: 0, flip: people.length % 2 === 1 });
  people.forEach((p, i) => (p.x = people.length === 1 ? 0.62 : 0.3 + (i / Math.max(1, people.length - 1)) * 0.6));
  const weather = app.scene?.debugWeather ?? weatherIn(w, regionId);
  const opts = { night: darkness(life.clock) > 0.3, weather, wealth: Math.max(0, Math.min(1, marketOf(w, regionId).prosperity)), people, t: 0 };
  const t0 = performance.now();
  const paint = () => {
    opts.t = (performance.now() - t0) / 1000;
    paintInterior(c, kind, opts);
  };
  paint();
  // ~24 fotogramas por segundo mientras el diálogo está abierto: el fuego crepita y la gente respira.
  let last = 0;
  const loop = (now: number) => {
    if (!c.isConnected && now - t0 > 500) return;
    if (now - last > 40) (last = now), paint();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return c;
}

const folkOf = (w: WorldState, id: string) => ensureLife(w).folk.find((f) => f.id === id);

/** Un recuerdo que vuelve. Si plantea una decisión, el jugador elige qué hacer con él. */
export function showFragment(app: App, ev: FragmentEvent): void {
  audio.sfx('descubrimiento');
  const close = app.modal(() => [
    h('div', { class: 'dlg-head' }, h('h2', null, ev.title), h('div', { class: 'tiny' }, 'Un recuerdo')),
    ...ev.lines.map((l) => h('p', null, l)),
    h('div', { class: 'dlg-choices' },
      ...(ev.choices?.length
        ? ev.choices.map((c) => h('button', { class: 'btn', onclick: () => { close(); const res = chooseFragment(app.w!, ev.id, c.id); if (res.length) dialogue(app, ev.title, '', res, [{ label: 'Seguir', run: () => app.refresh(), primary: true }]); app.refresh(); } }, c.label))
        : [h('button', { class: 'btn teal', onclick: () => (close(), app.refresh()) }, 'Guardar el recuerdo')]),
    ),
  ], { cls: 'dialog fragment-modal' });
}

/** Muestra el resultado de algo que hiciste: lo que pasa, el tiempo que lleva y lo que aprendes. */
function outcome(app: App, title: string, o: Outcome, then?: () => void): void {
  if (o.minutes) app.passTime(o.minutes);
  app.notes(o.notes);
  if (o.fragment) return showFragment(app, o.fragment);
  if (o.lines.length) dialogue(app, title, '', o.lines, [{ label: 'Seguir', run: () => (then ? then() : app.refresh()), primary: true }]);
  else app.refresh();
}

/**
 * Escenas del prólogo: una conversación o un momento que se encadena según
 * lo que respondas. Los recuerdos aparecen borrosos; la carta enseña el emblema.
 */
export function runPrologue(app: App, s: PScene | null): void {
  const w = app.w!;
  if (s?.minutes) app.passTime(s.minutes);
  if (s?.notes?.length) app.notes(s.notes);
  if (!s) return app.refresh();
  if (s.flash) audio.sfx('descubrimiento');
  else audio.sfx('tap');
  const portrait = s.folk ? portraitOf(w, s.folk) : undefined;
  const past = ensureLife(w).identity?.past;
  const art = s.letter && past ? emblem(Math.max(0, SYMBOLS.indexOf(past.symbol)), 5) : null;
  if (art) art.className = 'emblem';
  let close = () => {};
  const pick = (id: string) => {
    close();
    if (s.id === 'hut' && id === 'dormir') return app.sleep('raso');
    runPrologue(app, prologueChoose(w, s.id, id));
  };
  close = app.modal(() => [
    h('div', { class: `dlg-head ${portrait ? 'with-portrait' : ''}` }, portrait ?? null, h('div', null, h('h2', null, s.title), s.sub ? h('div', { class: 'tiny' }, s.sub) : null)),
    art,
    ...s.lines.map((l, i) => h('p', { class: `${l.startsWith('«') || l.startsWith('—') ? 'quote' : ''} ${s.flash ? 'flash-line' : ''}`, style: s.flash ? `animation-delay:${i * 0.9}s` : '' }, l)),
    h('div', { class: 'dlg-choices' }, ...s.choices.map((c, i) => h('button', { class: `btn ${i === 0 ? 'teal' : ''}`, onclick: () => pick(c.id) }, c.label, c.hint ? h('small', null, c.hint) : null))),
  ], { cls: `dialog ${s.flash ? 'fragment-modal flash-modal' : ''} ${s.letter ? 'letter-modal' : ''}` });
}

/** Si el prólogo tiene algo que decir aquí, lo dice; si no, sigue lo normal. */
function prologueAt(app: App, t: PTarget): boolean {
  const s = prologueScene(app.w!, t);
  if (!s) return false;
  runPrologue(app, s);
  return true;
}

/** Visitar un edificio puede despertar un recuerdo. */
function visit(app: App, building: string, regionId: number): boolean {
  const ev = tryFragment(app.w!, { kind: 'edificio', building, regionId });
  if (ev) {
    showFragment(app, ev);
    return true;
  }
  return false;
}

/** Cargo que te ofrecen en un pueblo: llega, no se pide. */
function offerChoice(app: App, regionId: number): Choice[] {
  const id = ensureLife(app.w!).identity!;
  const o = id.offers.find((x) => x.regionId === regionId);
  if (!o) return [];
  const title = STANDING[o.level].name.toLowerCase();
  return [
    { label: `✋ Aceptar: ser ${title}`, primary: true, hint: STANDING[o.level].hint, run: () => (app.toast(answerOffer(app.w!, regionId, true)), app.refresh()) },
    { label: `🙅 Rechazarlo`, hint: 'Puedes vivir sin cargos. Quizá vuelvan a ofrecértelo.', run: () => (app.toast(answerOffer(app.w!, regionId, false)), app.refresh()) },
  ];
}

/** Retrato del vecino con la expresión que le provoca lo que ha vivido. Parpadea mientras el diálogo está abierto. */
function portraitOf(w: WorldState, folkId: string): HTMLCanvasElement | undefined {
  const f = folkOf(w, folkId);
  if (!f) return undefined;
  const c = document.createElement('canvas');
  c.className = 'portrait';
  // A la densidad real de la pantalla (88 px CSS): a 3× un lienzo fijo se veía borroso.
  c.width = c.height = Math.round(88 * Math.min(3, Math.max(2, window.devicePixelRatio || 1)));
  const ap = appearanceOf(w, f);
  const expr = moodOf(w, f);
  const t0 = performance.now();
  let last = 0;
  const tick = (now: number) => {
    if (now - last > 80) {
      last = now;
      drawPortrait(c, ap, expr, (now - t0) / 1000);
    }
    if (c.isConnected || now - t0 < 500) requestAnimationFrame(tick);
  };
  drawPortrait(c, ap, expr, 0);
  requestAnimationFrame(tick);
  return c;
}

// ---------------------------------------------------------------------------
// Botones de contexto (al acercarse a algo)
// ---------------------------------------------------------------------------
export function focusButtons(app: App, t: Target): HTMLElement[] {
  const w = app.w!;
  const b = (label: string, fn: () => void, primary = false) => h('button', { class: `btn small ${primary ? 'primary' : ''}`, onclick: () => (vibrate(8), fn()) }, label);
  switch (t.kind) {
    case 'folk': {
      const f = folkOf(w, t.id);
      const out = [b('💬 Hablar', () => talk(app, t.id), true), b('👁 Observar', () => observe(app, t.id)), b('🚶 Seguir', () => (app.scene?.followFolk(t.id), app.toast(`Sigues a ${f?.name}. Mueve el joystick para dejar de seguirle.`)))];
      const job = f ? jobFor(w, f) : null;
      if (job && ensureLife(w).identity?.mode === 'forastero') out.splice(1, 0, b(job.label.split(' ')[0] + ' Trabajar', () => outcome(app, job.label.slice(2), work(w, t.id))));
      if (f?.role === 'lider' && !w.regions[f.regionId].isHome && hasAuthority(w, 'mediar')) out.splice(1, 0, b('⚖ Decidir', () => leaderDecisions(app, f.regionId)));
      return out;
    }
    case 'building':
      return [b(t.building === 'hogar' ? '🏠 Entrar' : t.building === 'forja' || (t.building === 'almacen' && !w.regions[t.regionId].isHome) ? '👁 Mirar' : '🚪 Entrar', () => arrive(app, t), true)];
    case 'post':
      return [b('💬 Hablar con la guardia', () => arrive(app, t), true)];
    case 'place':
      return [b('🔎 Examinar', () => arrive(app, t), true)];
    case 'encounter':
      return [b('❗ Acercarse', () => arrive(app, t), true)];
    case 'messenger':
      return [b('📨 Escuchar al mensajero', () => arrive(app, t), true)];
    case 'signpost':
      return [b('🧭 Viajar', () => arrive(app, t), true)];
    case 'item':
      return [b(t.id === 'mochila' ? '🎒 Mirar' : t.id === 'caja' ? '📦 Mirar' : t.id === 'cabana' ? '🚪 Entrar' : '🔎 Examinar', () => arrive(app, t), true)];
    case 'convoy':
      return [b(t.label.startsWith('Una carreta') ? '🔎 Examinar' : '💬 Hablar', () => arrive(app, t), true)];
    case 'settlement':
      return [b('🏘 Visitar', () => arrive(app, t), true)];
    case 'poi':
      return [b('🔎 Examinar', () => arrive(app, t), true)];
  }
}

/** Interacción principal al llegar a algo (o al tocarlo estando cerca). */
export function arrive(app: App, t: Target): void {
  const w = app.w!;
  switch (t.kind) {
    case 'folk':
      return talk(app, t.id);
    case 'building':
      return building(app, t.regionId, t.building);
    case 'post':
      return borderPost(app, t.index);
    case 'place': {
      const lines = examinePlace(w, t.id);
      audio.sfx('tap');
      dialogue(app, t.label, w.regions[getLayout(w).places.find((p) => p.id === t.id)!.regionId].name, lines, [{ label: 'Seguir explorando', run: () => app.refresh(), primary: true }]);
      return;
    }
    case 'encounter':
      return encounter(app, t.id);
    case 'messenger':
      return petition(app, t.petitionId);
    case 'signpost':
      if (visit(app, 'cruce', t.regionId)) return;
      return travel(app, t.regionId);
    case 'item':
      if (t.id === 'cabana') return hut(app);
      prologueAt(app, { kind: 'item', id: t.id });
      return;
    case 'convoy':
      return convoyDialog(app, t.id);
    case 'settlement':
      return settlementDialog(app, t.id);
    case 'poi':
      return poiDialog(app, t.id);
  }
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
function talk(app: App, folkId: string): void {
  const w = app.w!;
  const f = folkOf(w, folkId);
  if (!f) return;
  const busy = ensureLife(w).encounters.find((e) => !e.resolved && (e.folkA === folkId || e.folkB === folkId));
  if (busy) return encounter(app, busy.id);
  noteMeeting(w, f);
  if (prologueAt(app, { kind: 'folk', id: folkId })) return;
  const r = w.regions[f.regionId];
  const res = talkToFolk(w, folkId);
  const life = ensureLife(w);
  const id = life.identity!;
  const inv = life.player.inventory;
  const choices: Choice[] = [];
  const memory = tryFragment(w, { kind: 'hablar', folkId });
  if (memory) return showFragment(app, memory);
  app.notes(afterTalk(w, f));
  if (res.lied) {
    const tell = noticeLie(w);
    if (tell) res.lines.push(tell);
  }
  const read = readLeader(w, f);
  if (read) res.lines.push(read);
  if (f.role === 'lider' && !r.isHome && hasAuthority(w, 'mediar')) choices.push({ label: '⚖ Tratar asuntos de gobierno', run: () => leaderDecisions(app, f.regionId), primary: true });
  if (f.role === 'lider') choices.push(...offerChoice(app, f.regionId));
  const job = jobFor(w, f);
  if (job && id.mode === 'forastero') choices.push({ label: job.label, hint: `${Math.round(job.minutes / 60)} h · ${job.pay.coins ? 'algo de dinero' : job.pay.comida ? 'algo de comida' : 'aprendes'}`, run: () => outcome(app, job.label.slice(2), work(w, folkId)), primary: !choices.length });
  if (id.mode === 'forastero') choices.push({ label: '❓ Preguntar por ti', run: () => outcome(app, f.name, askAboutMe(w, folkId)) });
  if (f.role === 'comerciante') choices.push({ label: `🍞 Comprarle comida (${priceOf(w, f.regionId, 1)} 🪙)`, run: () => outcome(app, f.name, buyFood(w, f.regionId)) });
  if (f.role === 'comerciante' && id.mode === 'forastero') choices.push({ label: '⚖ Comerciar', hint: 'Comprar, vender, preguntar precios, encargos', run: () => marketDialog(app, f.regionId, f.id) });
  if (f.role === 'campesino' && (playerEco(w).cargo.semillas ?? 0) >= 1) choices.push({ label: '🌱 Darle semilla para sembrar', run: () => marketDialog(app, f.regionId) });
  if (f.role === 'comerciante' && inv.reliquias > 0) choices.push({ label: '💰 Venderle algo de valor', run: () => outcome(app, f.name, sellRelic(w, f.regionId)) });
  if (f.resentment > 0.3 || f.trust < 0.35) choices.push({ label: hasTalent(id, 'lengua') ? '🗣 Convencerle (lengua de plata)' : '🗣 Intentar convencerle', run: () => outcome(app, f.name, convince(w, folkId)) });
  if (id.mode === 'forastero' && f.role !== 'nino') choices.push({ label: '🌒 Contarle una mentira para sacar algo', hint: 'Si te pillan, se sabrá.', run: () => outcome(app, f.name, deceive(w, folkId)) });
  const pet = hasAuthority(w, 'negar') ? w.petitions.find((p) => p.regionId === f.regionId && (p.characterId === f.charId || f.role === 'lider')) : undefined;
  if (pet) choices.push({ label: `📨 «${pet.title}»`, run: () => petition(app, pet.id) });
  if (inv.comida > 0) choices.push({ label: '🍞 Darle comida', run: () => (app.toast(giveTo(w, folkId, 'comida')), app.refresh()) });
  if (inv.hierbas > 0 && (r.flags.fiebre || f.age > 60 || (f.p?.sick ?? -1) >= w.day)) choices.push({ label: '🌿 Darle hierbas', run: () => (app.toast(giveTo(w, folkId, 'hierbas')), app.refresh()) });
  // La política: votaciones, grupos, quien gobierna, lo que sabe, la oposición, la guerra (Fase 4).
  choices.splice(Math.min(choices.length, 1), 0, ...politicalChoices(app, f));
  // La vida: pareja, hijos, enseñar, aprendices, acoger (Fase 5).
  choices.splice(Math.min(choices.length, 2), 0, ...lifeChoices(app, f));
  // El mundo grande: técnicas que viajan con la gente, fundar un lugar (Fase 6).
  choices.splice(Math.min(choices.length, 3), 0, ...worldChoices(app, f));
  // Su vida con los demás: pleitos en los que puedes intervenir y gente por la que preguntar.
  for (const c of arcChoices(w, f)) choices.splice(Math.min(choices.length, 1), 0, { label: c.label, hint: c.hint, run: () => arcRun(app, folkId, c.id) });
  if (f.age >= 10) choices.push({ label: '👥 Preguntar por alguien', run: () => askAbout(app, folkId) });
  choices.push({ label: 'Despedirse', run: () => app.refresh() });
  // Quien te ve hablar con alguien puede venir luego a preguntarte.
  noticeConversation(w, folkId, app.scene?.folkNear(7).filter((x) => x !== folkId) ?? []);
  const title = f.charId ? `${f.name}, ${ROLES[w.characters.find((c) => c.id === f.charId)?.role ?? '']?.title ?? ROLE_TITLE[f.role]}` : `${f.name}, ${ROLE_TITLE[f.role]}`;
  app.scene?.converse(folkId);
  dialogue(app, title, `${r.name}${f.origin !== undefined ? ` · llegado de ${w.regions[f.origin].name}` : ''}`, res.lines.map((l) => (l.startsWith('(') ? l : `«${l}»`)), choices, portraitOf(w, folkId));
  if (res.learned.length) for (const l of res.learned) app.whisper(`📝 ${l}`);
}

/** Intervenir en un pleito entre vecinos (o preguntar a un tercero por él). */
function arcRun(app: App, folkId: string, choice: string): void {
  const w = app.w!;
  const f = folkOf(w, folkId)!;
  const life = ensureLife(w);
  const id = life.identity!;
  const rng = new Rng((w.seed ^ Math.floor(life.clock) * 2654435761) >>> 0);
  const res = arcAct(w, f, choice, rng, (k) => levelOf(id, k));
  if (res.rumor) seedRumor(w, { regionId: f.regionId, kind: res.rumor.kind, subject: 'jugador', target: res.rumor.target, witnesses: [f.id, ...(app.scene?.folkNear(6) ?? [])], extra: res.rumor.extra });
  const skill = choice === 'mediar' ? 'diplomacia' : choice.startsWith('investigar') ? 'investigacion' : choice === 'enredar' ? 'sigilo' : choice === 'escuchar' || choice.startsWith('tercero') ? 'investigacion' : choice === 'aprovechar' ? 'comercio' : 'persuasion';
  app.notes(gain(w, skill, choice === 'mediar' ? 1.2 : 0.5));
  if (choice === 'mediar' || choice === 'lado' || choice === 'enredar' || choice === 'ayudar' || choice === 'aprovechar') story(w, { mediar: `Intentó poner paz entre dos vecinos de ${w.regions[f.regionId].name}.`, lado: `Tomó partido por ${f.name} en un pleito.`, enredar: `Echó leña al fuego en el pleito de ${f.name}.`, ayudar: `Ayudó a ${f.name} cuando el pleito le arruinaba.`, aprovechar: `Sacó provecho del pleito de ${f.name}.` }[choice]!, 'decision');
  app.passTime(choice.startsWith('investigar') ? 45 : 15);
  dialogue(app, f.name, '', res.lines, [{ label: 'Seguir', run: () => app.refresh(), primary: true }], portraitOf(w, folkId));
}

/** «¿Qué opinas de…?»: así se descubre la red de relaciones del pueblo. */
function askAbout(app: App, folkId: string): void {
  const w = app.w!;
  const f = folkOf(w, folkId)!;
  const known = ensureLife(w).folk.filter((o) => o.alive && o.id !== folkId && o.lastMet >= 0 && o.regionId === f.regionId).sort((a, b) => b.lastMet - a.lastMet).slice(0, 8);
  if (!known.length) return void dialogue(app, f.name, '', ['Aún no conoces a nadie más por aquí.'], [{ label: 'Volver', run: () => talk(app, folkId) }]);
  dialogue(app, f.name, '¿Por quién preguntas?', [], [
    ...known.map((o) => ({ label: `${o.name}, ${ROLE_TITLE[o.role]}`, run: () => dialogue(app, f.name, `Sobre ${o.name}`, [opinionOf(w, f, o)], [{ label: 'Preguntar por otra persona', run: () => askAbout(app, folkId) }, { label: 'Seguir', run: () => app.refresh(), primary: true }], portraitOf(w, folkId)) })),
    { label: 'Nada', run: () => app.refresh() },
  ], portraitOf(w, folkId));
}

/** Alguien se te ha acercado: lo que te dice y lo que respondes. */
export function approachDialog(app: App, ap: Approach): void {
  const w = app.w!;
  const f = folkOf(w, ap.folk);
  if (!f) return;
  audio.sfx('tap');
  noteMeeting(w, f);
  dialogue(app, f.name, 'Se te acerca', ap.lines, ap.choices.map((c, i) => ({
    label: c.label,
    primary: i === 0,
    run: () => {
      const res = answerApproach(w, ap.id, c.id);
      if (res.arcListen) return arcRun(app, f.id, 'escuchar');
      if (res.work) {
        const job = jobFor(w, f);
        if (job) {
          const o = work(w, f.id);
          const id = ensureLife(w).identity;
          if (id) id.needs.coins += 1;
          o.lines.push('Te paga una moneda más de lo acordado. «Por la recomendación.»');
          return outcome(app, job.label.slice(2), o);
        }
      }
      if (res.lines.length) dialogue(app, f.name, '', res.lines, [{ label: 'Seguir', run: () => app.refresh(), primary: true }], portraitOf(w, f.id));
      else app.refresh();
    },
  })), portraitOf(w, f.id));
}

function observe(app: App, folkId: string): void {
  const w = app.w!;
  const lines = observeFolk(w, folkId);
  dialogue(app, 'Observas', '', lines, [{ label: '💬 Hablarle', run: () => talk(app, folkId), primary: true }, { label: 'Seguir a lo tuyo', run: () => {} }], portraitOf(w, folkId));
}

/** Con un líder se tratan los asuntos de gobierno: es aquí donde se decide en persona. */
function leaderDecisions(app: App, regionId: number): void {
  const w = app.w!;
  const r = w.regions[regionId];
  const intel = w.intel[regionId];
  const ids: string[] = [];
  if (r.abandoned) ids.push('retomar');
  else {
    if (getLayout(w).roads.some((x) => (x.a === regionId && x.b === w.player.home) || (x.b === regionId && x.a === w.player.home))) ids.push('comercio', 'explotar');
    ids.push('mediar', 'alianza', 'presion', 'regalo');
    if (r.neighbors.some((n) => r.relations[n]?.allied)) ids.push('romperAlianza');
    ids.push(r.resourceBanned ? 'permitir' : 'prohibir', 'favorecer');
    if (r.techs.length && intel.facts.tecnologias?.value !== 'nada fuera de lo común') ids.push('compartirTecnologia');
    if (w.mystery.kind === 'invierno' && w.mystery.solved && !r.flags.advertida) ids.push('advertir');
    if (r.flags.guerra) ids.push('intervenir');
    ids.push('abandonar');
  }
  const known = w.rumors.filter((x) => x.known && w.day <= x.expires + 5).slice(-4);
  const allowed = ids.filter((id) => hasAuthority(w, id));
  if (!allowed.length && !hasAuthority(w, 'compartir')) {
    return void dialogue(app, `El salón de ${r.name}`, '', [`Te reciben con cortesía, pero no hablas en nombre de nadie. «¿Y tú quién eres para venir a tratar estos asuntos?»`, `Para negociar por un pueblo, primero tendrías que tener voz en ${w.regions[w.player.home].name}.`], [...offerChoice(app, regionId), ...(w.life?.politics ? [{ label: '🏛 Asuntos del pueblo', run: () => townAffairs(app, regionId) }] : []), { label: 'Volver', run: () => {} }]);
  }
  ids.splice(0, ids.length, ...allowed);
  const choices: Choice[] = ids.map((id) => ({
    label: `${ACTIONS[id].icon} ${id === 'favorecer' && r.favored ? 'Dejar de favorecer' : ACTIONS[id].label}`,
    run: () => openAction(app, id, { region: regionId, inPerson: 1 }),
  }));
  for (const ru of known) choices.push({ label: `📜 Contarle: «${ru.text.slice(0, 48)}${ru.text.length > 48 ? '…' : ''}»`, run: () => openAction(app, 'compartir', { region: regionId, rumor: ru.id, inPerson: 1 }) });
  for (const p of w.petitions.filter((x) => x.regionId === regionId)) choices.unshift({ label: `📨 Responder: ${p.title}`, run: () => petition(app, p.id), primary: true });
  if (w.life?.politics) choices.unshift({ label: '🏛 Asuntos del pueblo', hint: 'Quién manda, qué se vota, qué grupos hay', run: () => townAffairs(app, regionId) });
  if (r.flags.guerra && w.life?.politics) choices.unshift({ label: '⚔ La guerra', run: () => warDialog(app, regionId), primary: true });
  choices.push({ label: 'Volver', run: () => {} });
  dialogue(app, `Asuntos con ${r.name}`, 'Estás aquí en persona: tus palabras pesan más que las de un emisario.', ['Cualquier decisión puede acompañarse de una hipótesis. Después, vuelve y comprueba qué ha pasado.'], choices);
}

function petition(app: App, petitionId: string): void {
  const w = app.w!;
  const p = w.petitions.find((x) => x.id === petitionId);
  if (!p) return app.toast('El mensajero ya se ha ido.');
  dialogue(app, p.title, `caduca ${p.expires - w.day <= 0 ? 'hoy' : `en ${p.expires - w.day} días`}`, [p.text], [
    ...p.choices.map((c, i) => ({
      label: c.label,
      hint: c.hint,
      primary: i === 0,
      run: () => {
        const choice = p.choices[i];
        if (ACTIONS[choice.action]?.target === 'par' && choice.params.other === undefined) return openAction(app, choice.action, choice.params);
        const res = answerPetition(w, p.id, i);
        app.toast(res.message, !res.ok);
        if (res.ok) audio.sfx('accion');
        app.refresh();
      },
    })),
    { label: 'Pensarlo', run: () => {} },
  ]);
}

// ---------------------------------------------------------------------------
// Edificios
// ---------------------------------------------------------------------------
function building(app: App, regionId: number, kind: string): void {
  if (visit(app, kind, regionId)) return;
  interiorCtx = ROOM_KINDS.has(kind) ? { kind: kind as InteriorKind, regionId } : null;
  try {
    buildingInside(app, regionId, kind);
  } finally {
    interiorCtx = null;
  }
}

function buildingInside(app: App, regionId: number, kind: string): void {
  const w = app.w!;
  const r = w.regions[regionId];
  const home = r.isHome;
  const life = ensureLife(w);
  const id = life.identity!;
  const stand = id.standing[regionId] ?? 0;
  switch (kind) {
    case 'hogar':
      if (home && !id.housed) {
        const can = stand >= 2;
        return void dialogue(app, 'Una casa vacía', '', ['La puerta está atrancada con una tabla. Dicen que era de una familia que se marchó hace años.', can ? 'Ahora que te conocen, quizá te dejen quedarte.' : 'Nadie le daría una casa a un desconocido.'], [
          ...(can
            ? [{
                label: '🏠 Preguntar si puedes quedarte',
                primary: true,
                run: () => {
                  id.housed = true;
                  story(w, `Le dieron una casa en ${r.name}. Por primera vez, tenía un sitio al que volver.`, 'logro');
                  dialogue(app, 'Tu casa', '', ['«Es tuya mientras la cuides», te dicen. Barres el polvo, enciendes el fuego. Ya no duermes al raso.'], [{ label: 'Seguir', run: () => app.refresh(), primary: true }]);
                },
              }]
            : []),
          { label: 'Salir', run: () => {} },
        ]);
      }
      return void dialogue(app, 'Tu casa', `${life.player.name}, ${life.player.age} años`, [life.player.family.length ? 'El fuego sigue encendido. Tu familia te espera.' : 'El fuego sigue encendido. La casa huele a tuya.'], [
        { label: '🌙 Dormir hasta el amanecer', run: () => app.sleep('casa'), primary: true },
        ...homeChoices(app),
        { label: '⏳ Descansar tres horas', run: () => (app.passTime(180), app.toast('Descansas un rato.')) },
        { label: '🪞 Quién soy', run: () => app.setView('familia') },
        { label: '💾 Guardar o cargar', run: () => app.saves() },
        { label: 'Salir', run: () => {} },
      ]);
    case 'almacen':
      if (home && hasAuthority(w, 'ayuda')) return storehouse(app);
      if (!home && hasAuthority(w, 'explotar'))
        return void dialogue(app, `Almacén de ${r.name}`, '', [r.food < 4 ? 'Las estanterías están casi vacías. Un hombre barre el suelo sin ganas.' : r.food > 15 ? 'Sacos apilados hasta el techo. Huele a grano seco.' : 'Hay provisiones, pero se cuentan con cuidado.'], [
          { label: `${ACTIONS.explotar.icon} Exigir parte de sus recursos`, run: () => openAction(app, 'explotar', { region: regionId, inPerson: 1 }) },
          { label: 'Salir', run: () => {} },
        ]);
      return void dialogue(app, `Almacén de ${r.name}`, '', [describeMarket(w, regionId)[0], home ? (w.player.reserves < 20 ? 'Quedan pocos sacos. El intendente los cuenta dos veces.' : 'Sacos de grano y ristras de ajos. El intendente te vigila de reojo.') : r.food < 4 ? 'Las estanterías están casi vacías.' : 'Sacos apilados y un intendente que no te quita ojo.', hasTalent(id, 'mercader') ? `(A ojo de mercader: ${home ? (w.player.reserves < 20 ? 'no aguantarán mucho' : 'tienen para una buena temporada') : r.food < 5 ? 'no aguantarán mucho' : 'tienen de sobra'}.)` : ''].filter(Boolean), [
        { label: '🧺 Ir al mercado', run: () => marketDialog(app, regionId), primary: true },
        ...(levelOf(id, 'k:economia') + levelOf(id, 'comercio') >= 1 ? [{ label: '📈 ¿Cuadran los precios?', hint: 'Si alguien esconde comida, se nota en los precios.', run: () => marketSuspicion(app, regionId) }] : []),
        { label: '🙏 Pedir algo de comer', run: () => outcome(app, 'El almacén', charity(w, regionId)) },
        { label: 'Salir', run: () => {} },
      ]);
    case 'salon':
      if (home && hasAuthority(w, 'observar')) return council(app);
      if (!home && hasAuthority(w, 'mediar')) return leaderDecisions(app, regionId);
      return void dialogue(app, `Salón de ${r.name}`, stand >= 3 ? 'Te dejan pasar como oyente' : 'La puerta está cerrada', [stand >= 3 ? 'Te sientas al fondo. Discuten, gritan, votan. Nadie te pregunta, pero escuchas.' : 'Dentro se oyen voces. Deciden cosas que afectan a todos, y tú no estás invitado.'], [
        ...offerChoice(app, regionId),
        { label: '🏛 Asuntos del pueblo', hint: 'Quién manda, qué se vota, qué grupos hay', run: () => townAffairs(app, regionId), primary: true },
        ...(stand >= 3 ? [{ label: '📚 Escuchar el debate', run: () => outcome(app, 'El consejo', study(w, regionId, 'salon')) }] : []),
        { label: '🌒 Escuchar desde la puerta', hint: 'Si te ven, no les gustará.', run: () => outcome(app, 'Tras la puerta', eavesdrop(w, regionId)) },
        { label: 'Salir', run: () => {} },
      ]);
    case 'posada':
      if (w.regions[regionId].isHome && prologueAt(app, { kind: 'posada' })) return;
      return tavern(app, regionId);
    case 'templo':
      return void dialogue(app, `Templo de ${r.name}`, '', templeElders(w, regionId), [
        { label: '📚 Estudiar con los ancianos', hint: 'Historia, costumbres y lenguas.', run: () => outcome(app, 'El templo', study(w, regionId, 'templo')) },
        ...recordsChoice(app, regionId),
        ...(r.flags.fiebre ? [{ label: '🌿 Atender a los enfermos', hint: hasTalent(id, 'sanador') ? 'Sabes cómo frenar esta fiebre.' : 'Necesitarías saber mucho de medicina.', run: () => outcome(app, 'Los enfermos', tendSick(w, regionId)) }] : []),
        ...(!id.housed ? [{ label: '🕯 Pedir refugio para dormir', hint: 'Gratis, en un banco frío.', run: () => app.sleep('templo') }] : []),
        { label: 'Salir', run: () => app.refresh() },
      ]);
    case 'forja':
      return void dialogue(app, `Forja de ${r.name}`, '', [r.militancy > 0.55 ? 'Martillos día y noche. Puntas de lanza amontonadas en un rincón.' : r.research ? 'El herrero prueba algo nuevo y no deja mirar.' : 'Herraduras, rejas de arado, ollas. Trabajo de paz.'], [
        ...life.folk.filter((f) => f.alive && f.regionId === regionId && f.role === 'artesano').slice(0, 1).map((f) => ({ label: '🔨 Ofrecerte para trabajar', run: () => outcome(app, 'La forja', work(w, f.id)) })),
        { label: 'Salir', run: () => {} },
      ]);
  }
}

/** El almacén de tu gente: desde aquí salen las caravanas. */
function storehouse(app: App): void {
  const w = app.w!;
  const life = ensureLife(w);
  const pick = (action: 'ayuda' | 'regalo') =>
    regionPicker(app, action === 'ayuda' ? '¿A dónde envías la caravana?' : '¿A quién envías el regalo?', (id) =>
      openAction(app, action, { region: id }, action === 'ayuda' ? { extras: [{ key: 'amount', label: 'Tamaño de la caravana', options: [[8, 'Pequeña'], [12, 'Normal'], [20, 'Grande']] }] } : {}),
    );
  dialogue(app, `Almacén de ${w.regions[w.player.home].name}`, `Provisiones: ${Math.round(w.player.reserves)}`, ['«¿Qué hacemos con lo que tenemos?», pregunta el intendente, libreta en mano.'], [
    { label: '🌾 Preparar una caravana de provisiones', run: () => pick('ayuda'), primary: true, hint: 'Viajará por los caminos y tardará días en llegar.' },
    { label: '🎁 Enviar un regalo', run: () => pick('regalo') },
    {
      label: '🎒 Coger comida para el viaje',
      run: () => {
        if (w.player.reserves < 3) return app.toast('No queda suficiente.', true);
        w.player.reserves -= 3;
        life.player.inventory.comida += 2;
        app.toast('Llevas un poco más de comida en la mochila.');
        app.refresh();
      },
    },
    { label: 'Salir', run: () => {} },
  ]);
}

/** El salón del consejo: leyes, prioridades, peticiones y emisarios. */
function council(app: App): void {
  const w = app.w!;
  dialogue(app, 'Salón del consejo', `Emisarios libres: ${freeAgents(w)} de ${w.player.agents}`, ['Aquí se reúne el consejo. Desde aquí se envían emisarios allí donde nadie puede ir en persona.'], [
    ...offerChoice(app, w.player.home),
    ...(w.life?.politics ? [{ label: '🏛 Asuntos del pueblo', hint: 'Leyes, votaciones, grupos, vecinos', run: () => townAffairs(app, w.player.home), primary: true }] : []),
    ...w.petitions.slice(0, 3).map((p) => ({ label: `📨 ${p.title}`, run: () => petition(app, p.id) })),
    { label: '🧭 Enviar emisarios', run: () => emissaries(app), primary: true },
    ...(hasAuthority(w, 'ley') ? [{ label: '⚖ Leyes, prioridades y peticiones', run: () => app.setView('decisiones') }] : []),
    { label: '🔎 Investigaciones y rumores', run: () => app.setView('investigar') },
    { label: 'Salir', run: () => {} },
  ]);
}

function emissaries(app: App): void {
  regionPicker(app, '¿A qué región envías a alguien?', (id) => {
    const w = app.w!;
    const st = w.intel[id].observerStationed;
    const opts: Choice[] = (['observar', st ? 'retirar' : 'destacar', 'espiar', 'sabotaje'] as const).filter((a) => hasAuthority(w, a)).map((a) => ({ label: `${ACTIONS[a].icon} ${ACTIONS[a].label}`, hint: ACTIONS[a].hint, run: () => openAction(app, a, { region: id }) }));
    const rumors = w.rumors.filter((x) => x.known && !x.investigated && x.about === id);
    for (const ru of rumors) opts.push({ label: `🔎 Investigar: «${ru.text.slice(0, 40)}…»`, run: () => openAction(app, 'investigar', { rumor: ru.id }) });
    opts.push({ label: 'Volver', run: () => {} });
    dialogue(app, `Emisarios a ${w.regions[id].name}`, '', ['Los emisarios tardan días en volver con noticias.'], opts);
  });
}

function regionPicker(app: App, title: string, onPick: (id: number) => void): void {
  const w = app.w!;
  const list = w.regions.filter((r) => !r.isHome && w.intel[r.id].level > 0);
  dialogue(app, title, '', list.length ? [] : ['Aún no conoces ninguna otra región.'], [
    ...list.map((r) => ({ label: r.name, run: () => onPick(r.id) })),
    { label: 'Cancelar', run: () => {} },
  ]);
}

function tavern(app: App, regionId: number): void {
  const w = app.w!;
  const r = w.regions[regionId];
  const life = ensureLife(w);
  const id = life.identity!;
  const aboutHere = w.rumors.filter((x) => x.known && !x.investigated && x.about === regionId);
  const hour = Math.floor(((life.clock % 1440) + 1440) % 1440 / 60 + 6) % 24;
  const listen = () => {
    const song = tryFragment(w, { kind: 'posada', regionId, hour });
    const lines = listenTavern(w, regionId);
    const learnt = study(w, regionId, 'posada');
    app.notes(learnt.notes);
    if (learnt.minutes) app.passTime(60);
    if (song) return showFragment(app, song);
    dialogue(app, `Posada de ${r.name}`, 'Escuchas…', lines, [{ label: 'Seguir', run: () => app.refresh() }]);
  };
  const forastero = id.mode === 'forastero';
  dialogue(app, `Posada de ${r.name}`, forastero ? `Llevas ${id.needs.coins} 🪙` : '', ['Humo, cerveza y conversaciones a media voz.'], [
    { label: '👂 Escuchar conversaciones', run: listen, primary: !forastero || id.needs.hunger < 0.5 },
    ...(forastero ? [
      { label: `🍲 Comer algo caliente (${priceOf(w, regionId, 1)} 🪙)`, primary: id.needs.hunger >= 0.5, run: () => outcome(app, 'La posada', buyMeal(w, regionId)) },
      { label: `🛏 Dormir aquí (${priceOf(w, regionId, 2)} 🪙)`, run: () => { const o = rentBed(w, regionId); if (o.lines[0].startsWith('Una cama de paja')) app.sleep('posada'); else outcome(app, 'La posada', o); } },
      ...loft(app, regionId),
    ] : []),
    ...aboutHere.map((ru) => ({ label: `🔎 Comprobar en persona: «${ru.text.slice(0, 40)}…»`, run: () => dialogue(app, 'Lo compruebas tú mismo', '', [checkRumorInPerson(w, ru.id)], [{ label: 'Seguir', run: () => app.refresh() }]) })),
    ...(hasAuthority(w, 'difundir') ? [{ label: `${ACTIONS.difundir.icon} Hacer correr un rumor`, run: () => openAction(app, 'difundir', { region: regionId, inPerson: 1 }), hint: ACTIONS.difundir.hint }] : []),
    { label: 'Salir', run: () => {} },
  ]);
}

/** Si te has ganado a alguien, la posadera te deja el pajar sin cobrar. */
function loft(app: App, regionId: number): Choice[] {
  const w = app.w!;
  const p = prologueOf(w);
  const id = ensureLife(w).identity!;
  if (!p || !w.regions[regionId].isHome || id.housed) return [];
  const inn = folkOf(w, p.inn);
  const why = p.crate === 'returned' || p.crate === 'covered' ? 'Ya me han contado lo de la caja.' : p.repair === 3 ? `${folkOf(w, p.artisan)?.name ?? 'El artesano'} dice que tienes buenas manos.` : null;
  const owed = (inn?.memories ?? []).some((m) => m.kind === 'robo' || m.kind === 'mentira');
  if (!why || owed) return [];
  return [{
    label: '🌾 Preguntar por el pajar',
    hint: 'Gratis, si te lo has ganado',
    run: () => dialogue(app, inn?.name ?? 'La posada', '', [`«${why} El pajar está detrás. No es una cama, pero está seco.»`], [{ label: 'Dormir en el pajar', primary: true, run: () => { story(w, `${inn?.name ?? 'La posadera'} le dejó dormir gratis en el pajar.`, 'relacion'); app.sleep('posada'); } }, { label: 'Ahora no', run: () => {} }], inn ? portraitOf(w, inn.id) : undefined),
  }];
}

/** La cabaña vacía junto al camino donde despertaste. */
function hut(app: App): void {
  const w = app.w!;
  const life = ensureLife(w);
  const hr = hourOf(life.clock);
  runPrologue(app, {
    id: 'hut',
    title: 'Una cabaña vacía',
    lines: ['La puerta cede con un quejido. Dentro: polvo, un camastro de paja y una mesa con una taza volcada.', 'Nadie vive aquí desde hace tiempo. Pero alguien barrió un rincón no hace mucho.'],
    choices: [...(hr >= 19 || hr < 5 || life.identity!.needs.fatigue > 0.7 ? [{ id: 'dormir', label: '🌙 Dormir aquí', hint: 'Gratis. Frío, pero a cubierto.' }] : []), { id: 'salir', label: 'Salir' }],
  });
}

// ---------------------------------------------------------------------------
// Fronteras
// ---------------------------------------------------------------------------
function borderPost(app: App, index: number): void {
  const w = app.w!;
  const p = getLayout(w).posts[index];
  const route = w.routes[p.routeId];
  const a = w.regions[p.a];
  const b = w.regions[p.b];
  const rel = a.relations[b.id];
  const lines: string[] = [];
  if (rel?.war) lines.push(`«Estamos en guerra. Nadie cruza hacia ${b.name}.»`);
  else if (route.status === 'cerrada') lines.push('«El paso está cerrado por orden de arriba. Nadie pasa con mercancías.»');
  else if ((rel?.tension ?? 0) > 0.5) lines.push(`«Hay mucho movimiento al otro lado. No me gusta nada.»`, 'Los guardias tienen la mano en la empuñadura.');
  else lines.push('«Pasa, viajero. Los caminos están tranquilos.»');
  const choices: Choice[] = [];
  if (route.status === 'abierta' && hasAuthority(w, 'cerrarRuta')) choices.push({ label: `${ACTIONS.cerrarRuta.icon} Pedir que cierren el paso`, hint: ACTIONS.cerrarRuta.hint, run: () => openAction(app, 'cerrarRuta', { route: p.routeId, region: a.isHome ? b.id : a.id }) });
  if (route.status === 'cerrada' && hasAuthority(w, 'abrirRuta')) choices.push({ label: `${ACTIONS.abrirRuta.icon} Pedir que lo reabran`, run: () => openAction(app, 'abrirRuta', { route: p.routeId, region: a.isHome ? b.id : a.id }) });
  if (rel?.war && hasAuthority(w, 'intervenir')) {
    const attacker = a.flags.guerra ? a : b;
    choices.push({ label: `${ACTIONS.intervenir.icon} Intervenir con tu guardia`, hint: ACTIONS.intervenir.hint, run: () => openAction(app, 'intervenir', { region: attacker.id }) });
    choices.push({ label: `${ACTIONS.mediar.icon} Mediar entre ambos`, run: () => openAction(app, 'mediar', { region: a.id, other: b.id, inPerson: 1 }) });
  }
  choices.push({
    label: '❓ Preguntar por el otro lado',
    run: () => {
      const t = rel?.tension ?? 0;
      dialogue(app, 'Los guardias', '', [t > 0.6 ? `«${b.name} se arma. Lo vemos cada noche: antorchas, carros, gente nueva.»` : t > 0.35 ? `«Con ${b.name} hay roces. Nada grave… todavía.»` : `«Con ${b.name} nos llevamos bien. Pasan comerciantes todos los días.»`], [{ label: 'Gracias', run: () => app.refresh() }]);
    },
  });
  choices.push({ label: 'Seguir', run: () => {} });
  dialogue(app, `Puesto fronterizo: ${a.name} · ${b.name}`, route.status === 'abierta' ? 'paso abierto' : route.status === 'cerrada' ? 'paso cerrado' : 'bloqueado por la guerra', lines, choices);
}

// ---------------------------------------------------------------------------
// Encuentros
// ---------------------------------------------------------------------------
function encounter(app: App, id: string, extra: string[] = []): void {
  const w = app.w!;
  const e = ensureLife(w).encounters.find((x) => x.id === id);
  if (!e) return;
  if (e.kind === 'p_acequia') return acequia(app, extra);
  const view = describeEncounter(w, e);
  const opts = encounterOptions(w, e);
  dialogue(app, view.title, w.regions[e.regionId].name, [view.scene, ...extra], opts.map((o, i) => ({
    label: o.label,
    primary: i === 0,
    run: () => {
      const res = resolveEncounter(w, id, o.id);
      app.notes(encounterLearning(w, e.kind, o.id, e.regionId, res.done));
      if (res.done) dialogue(app, view.title, '', res.lines, [{ label: 'Seguir tu camino', run: () => app.refresh(), primary: true }]);
      else encounter(app, id, res.lines);
    },
  })), e.folkA ? portraitOf(w, e.folkA) : undefined);
}

/** Dos vecinos se pelean por el agua. No hay una respuesta buena. */
function acequia(app: App, extra: string[]): void {
  const w = app.w!;
  const p = prologueOf(w)!;
  const view = acequiaView(w);
  dialogue(app, view.title, w.regions[w.player.home].name, [view.scene, ...extra], acequiaOptions(w).map((o, i) => ({
    label: o.label,
    primary: i === 0,
    run: () => {
      const res = acequiaResolve(w, o.id);
      app.notes(res.notes);
      if (res.done) dialogue(app, view.title, '', res.lines, [{ label: 'Seguir tu camino', run: () => app.refresh(), primary: true }]);
      else acequia(app, res.lines);
    },
  })), portraitOf(w, p.a));
}

// ---------------------------------------------------------------------------
// Viaje por los caminos
// ---------------------------------------------------------------------------
function travel(app: App, fromRegion: number): void {
  const w = app.w!;
  const life = ensureLife(w);
  const dests = w.regions.filter((r) => r.id !== fromRegion && life.visited[r.id] !== undefined && roadPath(w, fromRegion, r.id).length);
  const choices: Choice[] = dests.map((r) => {
    const path = roadPath(w, fromRegion, r.id);
    const minutes = Math.round(path.length / 1.4);
    return {
      label: `${r.name} · ${minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`}`,
      run: () => {
        const v = getLayout(w).villages[r.id];
        app.passTime(minutes);
        const spot = nearestWalkable(getLayout(w), v.cx, v.cy + v.plazaR + 1);
        app.scene?.teleport(spot.x, spot.y);
        app.toast(`Llegas a ${r.name} tras ${minutes < 90 ? `${minutes} minutos` : `${Math.round(minutes / 60)} horas`} de camino.`);
      },
    };
  });
  const walk = w.regions.filter((r) => r.id !== fromRegion && life.visited[r.id] === undefined && w.intel[r.id].level > 0 && roadPath(w, fromRegion, r.id).length).slice(0, 4);
  for (const r of walk)
    choices.push({
      label: `🚶 Caminar hacia ${r.name}`,
      hint: 'Aún no has estado allí: tendrás que ir a pie.',
      run: () => {
        const path = roadPath(w, fromRegion, r.id);
        if (app.scene && path.length) {
          app.scene.walkTo(path[Math.min(path.length - 1, 30)].x, path[Math.min(path.length - 1, 30)].y);
          app.waypoint = r.id;
          app.toast(`Sigues el camino hacia ${r.name}. Toca el mapa o mueve el joystick para cambiar de rumbo.`);
        }
      },
    });
  choices.push({ label: 'Quedarse', run: () => {} });
  dialogue(app, 'Cruce de caminos', 'El tiempo pasa mientras viajas: el mundo no te espera.', [dests.length ? 'Los postes señalan los pueblos que ya conoces.' : 'Todavía no conoces otros pueblos. Tendrás que caminar.'], choices);
}

// ---------------------------------------------------------------------------
// Generaciones
// ---------------------------------------------------------------------------
export function succession(app: App): void {
  const w = app.w!;
  const life = ensureLife(w);
  if (!life.player.pendingDeath) return;
  const old = life.player;
  const options = heirs(life);
  const list = options.length ? options : old.family.length ? old.family : [{ name: 'un aprendiz del pueblo', relation: 'aprendiz' as const, age: 18 }];
  let pendingHeir: (typeof list)[number] | null = null;
  dialogue(app, `${old.name} ha muerto`, `a los ${old.age} años`, ['Quienes le conocían lo lloran. El mundo sigue.', ...ensureLife(w).identity!.story.slice(-4).map((e) => `«${e.text}»`), 'Alguien toma el relevo.'], list.map((k, i) => ({
    label: `${k.name}, ${k.relation} (${k.age} años)`,
    primary: i === 0,
    run: () => (pendingHeir = k) && dialogue(app, k.name, `${k.relation}, ${k.age} años`, [`${k.name} no es ${old.name}. Tiene su propio carácter y sus propios sueños.`, '¿Qué hará con lo que deja?'], [
      { label: '🕯 Honrar el legado', hint: 'Hereda buena parte de la reputación… y los enemigos.', primary: true, run: () => takeOver(true) },
      { label: '🌱 Seguir su propio camino', hint: 'Empieza casi de cero. Pocos le juzgarán por lo que hizo su familia.', run: () => takeOver(false) },
    ]),
  })));
  function takeOver(honor: boolean): void {
    const k = pendingHeir!;
    {
      if (!old.family.length) old.family.push({ ...k });
      const name = succeed(w, k.name, honor);
      const l = getLayout(w);
      const home = l.villages[w.player.home];
      const hogar = home.keys.find((b) => b.kind === 'hogar');
      const d = hogar ? doorOf(hogar) : { x: home.cx, y: home.cy };
      const spot = nearestWalkable(l, d.x, d.y);
      app.scene?.teleport(spot.x, spot.y);
      app.banner('Una nueva generación', name);
      app.refresh();
    }
  }
}

