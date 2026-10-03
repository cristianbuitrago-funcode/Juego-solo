import { TECH_BY_ID } from './content/techs';
import { record, revealRegionHistory } from './chronicle';
import { registerEffect, schedule } from './effects';
import { observe } from './intel';
import { killCharacter, regionRemembers, speak } from './systems/characters';
import { endWar } from './systems/conflict';
import { mysteryHooks } from './systems/mystery';
import { notePattern } from './systems/patterns';
import { createRumor, verdictOf } from './systems/rumors';
import type { EntryId, Method, Priority, Region, RumorKind, WorldState } from './types';
import { clamp } from './util';
import { charactersOf, commitCtx, hops, influence, leaderOf, makeCtx, nextId, routeBetween, routesOf, type Ctx } from './world';

/**
 * Catálogo de decisiones del jugador. Cada acción es un "experimento":
 * tiene efectos inmediatos modestos y programa consecuencias futuras.
 * Para añadir una acción nueva basta con añadir una entrada a ACTIONS.
 */
export type Params = Record<string, number | string>;

export interface ActionDef {
  id: string;
  label: string;
  icon: string;
  group: 'informacion' | 'diplomacia' | 'economia' | 'politica' | 'fuerza' | 'otros';
  target: 'region' | 'par' | 'ruta' | 'rumor' | 'global';
  method?: Method;
  hint: string;
  /** Devuelve un motivo si no se puede hacer ahora (o null si se puede). */
  check: (w: WorldState, p: Params) => string | null;
  run: (ctx: Ctx, p: Params) => string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
export function freeAgents(w: WorldState): number {
  const stationed = Object.values(w.intel).filter((i) => i.observerStationed).length;
  return w.player.agents - w.missions.length - stationed;
}

const R = (w: WorldState, p: Params, key = 'region'): Region => w.regions[Number(p[key])];

function needAgent(w: WorldState): string | null {
  return freeAgents(w) > 0 ? null : 'No te quedan emisarios disponibles.';
}

function notHome(w: WorldState, p: Params): string | null {
  return R(w, p).isHome ? 'Esa es tu propia tierra.' : null;
}

function notAbandoned(w: WorldState, p: Params): string | null {
  return R(w, p).abandoned ? 'Has abandonado esta región. Retómala primero.' : null;
}

const all = (...checks: (string | null)[]) => checks.find((c) => c) ?? null;

function act(ctx: Ctx, text: string, regions: number[], causeId?: EntryId): EntryId {
  const e = record(ctx, { kind: 'accion', text, regions, causeId, known: true, byPlayer: true, importance: 2 });
  for (const id of regions) if (!ctx.w.regions[id].isHome) ctx.w.regions[id].lastAttention = ctx.w.day;
  return e.id;
}

function startMission(ctx: Ctx, kind: 'observar' | 'investigar' | 'sabotaje' | 'espiar' | 'diplomacia', regionId: number, days: number, extra: Params = {}, causeId?: EntryId): void {
  const { w } = ctx;
  const id = nextId(w, 'm');
  w.missions.push({ id, kind, regionId, rumorId: extra.rumor as string | undefined, start: w.day, returnDay: w.day + days, causeId });
  schedule(ctx, `mision_${kind}`, days, { mission: id, region: regionId, ...extra }, causeId);
}

function endMission(ctx: Ctx, id: string | number | boolean): void {
  ctx.w.missions = ctx.w.missions.filter((m) => m.id !== id);
}

function travelDays(w: WorldState, regionId: number): number {
  const d = hops(w, w.player.home)[regionId];
  return d <= 1 ? 2 : d === 2 ? 2 : 3;
}

/** Programa la posible revelación de un engaño. */
function scheduleExposure(ctx: Ctx, kind: string, base: number, data: Params, causeId: EntryId): void {
  const p = clamp(base - (ctx.w.player.laws.secreto ? 0.25 : 0));
  if (ctx.rng.chance(p)) schedule(ctx, 'expuesto', ctx.rng.int(3, 11), { ...data, kind }, causeId);
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------
export const ACTIONS: Record<string, ActionDef> = {
  observar: {
    id: 'observar', label: 'Enviar observador', icon: '👁', group: 'informacion', target: 'region',
    hint: 'Un emisario viaja y vuelve con un informe fiable de lo que ocurre (y de lo que ocurrió).',
    check: (w, p) => all(needAgent(w), notHome(w, p)),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      const id = act(ctx, `Enviaste un observador a ${r.name}.`, []);
      startMission(ctx, 'observar', r.id, travelDays(ctx.w, r.id), {}, id);
      return `Tu observador parte hacia ${r.name}. Volverá en ${travelDays(ctx.w, r.id)} días.`;
    },
  },
  destacar: {
    id: 'destacar', label: 'Destacar observador', icon: '📌', group: 'informacion', target: 'region',
    hint: 'Un emisario se queda a vivir allí: recibirás informes frecuentes mientras permanezca.',
    check: (w, p) => all(needAgent(w), notHome(w, p), w.intel[Number(p.region)].observerStationed ? 'Ya tienes a alguien allí.' : null),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      ctx.w.intel[r.id].observerStationed = true;
      act(ctx, `Destacaste un observador permanente en ${r.name}.`, []);
      return `Alguien de tu gente vivirá en ${r.name}. Te contará lo que vea.`;
    },
  },
  retirar: {
    id: 'retirar', label: 'Retirar observador', icon: '↩', group: 'informacion', target: 'region',
    hint: 'Recuperas al emisario destacado.',
    check: (w, p) => (w.intel[Number(p.region)].observerStationed ? null : 'No tienes a nadie allí.'),
    run: (ctx, p) => {
      ctx.w.intel[Number(p.region)].observerStationed = false;
      return 'Tu observador vuelve a casa.';
    },
  },
  espiar: {
    id: 'espiar', label: 'Escuchar conversaciones', icon: '👂', group: 'informacion', target: 'region', method: 'engano',
    hint: 'Infiltras a alguien para conocer a su gente, sus recuerdos y sus intenciones. Pueden descubrirlo.',
    check: (w, p) => all(needAgent(w), notHome(w, p)),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      const id = act(ctx, `Infiltraste a alguien en ${r.name} para escuchar conversaciones.`, []);
      startMission(ctx, 'espiar', r.id, travelDays(ctx.w, r.id) + 1, {}, id);
      return `Tu espía se mezcla con la gente de ${r.name}. Paciencia.`;
    },
  },
  investigar: {
    id: 'investigar', label: 'Investigar rumor', icon: '🔎', group: 'informacion', target: 'rumor',
    hint: 'Comprobar si un rumor es cierto, falso o un malentendido.',
    check: (w, p) => {
      const ru = w.rumors.find((x) => x.id === p.rumor);
      return all(needAgent(w), !ru ? 'Rumor desconocido.' : ru.investigated ? 'Ya lo investigaste.' : null);
    },
    run: (ctx, p) => {
      const ru = ctx.w.rumors.find((x) => x.id === p.rumor)!;
      const id = act(ctx, `Investigas el rumor: «${ru.text}»`, []);
      startMission(ctx, 'investigar', ru.about, travelDays(ctx.w, ru.about), { rumor: ru.id }, id);
      return 'Un emisario sigue el rastro del rumor.';
    },
  },
  ayuda: {
    id: 'ayuda', label: 'Enviar provisiones', icon: '🌾', group: 'economia', target: 'region', method: 'ayuda',
    hint: 'Alivia el hambre ahora. Repetirlo crea dependencia y envidias.',
    check: (w, p) => all(notHome(w, p), notAbandoned(w, p), w.player.reserves < 12 ? 'No tienes provisiones suficientes.' : null),
    run: (ctx, p) => {
      const { w } = ctx;
      const r = R(w, p);
      w.player.reserves -= 12;
      const id = act(ctx, `Enviaste provisiones a ${r.name}.`, [r.id]);
      const k = influence(r);
      r.food += 6;
      r.attitude.trust = clamp(r.attitude.trust + 0.07 * k);
      r.attitude.gratitude = clamp(r.attitude.gratitude + 0.1 * k);
      r.dependency = clamp(r.dependency + 0.12);
      r.selfReliance = clamp(r.selfReliance - 0.04);
      const repeated = (r.patternsSeen.ayuda ?? 0) >= 3;
      regionRemembers(ctx, r.id, repeated ? 'ayudaRepetida' : 'ayuda', repeated ? 0.2 : 0.55, id);
      // Envidia de quienes desconfían de esta región.
      for (const nb of r.neighbors) {
        const o = w.regions[nb];
        if (!o.isHome && o.relations[r.id]?.opinion < -0.1) o.attitude.trust = clamp(o.attitude.trust - 0.03);
      }
      notePattern(ctx, 'ayuda', r.id, id);
      return `Los carros salen hacia ${r.name}.`;
    },
  },
  regalo: {
    id: 'regalo', label: 'Enviar un regalo', icon: '🎁', group: 'diplomacia', target: 'region', method: 'dialogo',
    hint: 'Un gesto pequeño de buena voluntad.',
    check: (w, p) => all(notHome(w, p), notAbandoned(w, p), w.player.reserves < 6 ? 'No tienes provisiones suficientes.' : null),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      ctx.w.player.reserves -= 6;
      const id = act(ctx, `Enviaste un regalo a ${r.name}.`, [r.id]);
      r.attitude.trust = clamp(r.attitude.trust + 0.04 * influence(r));
      r.attitude.resentment = clamp(r.attitude.resentment - 0.05);
      regionRemembers(ctx, r.id, 'ayuda', 0.25, id);
      return 'Tu regalo va de camino.';
    },
  },
  explotar: {
    id: 'explotar', label: 'Requisar recursos', icon: '⛏', group: 'economia', target: 'region', method: 'comercio',
    hint: 'Obtienes provisiones ya, a costa de su tierra y de su paciencia.',
    check: (w, p) => all(notHome(w, p), notAbandoned(w, p), routeBetween(w, w.player.home, Number(p.region)) ? null : 'Necesitas un camino directo con esa región.'),
    run: (ctx, p) => {
      const { w } = ctx;
      const r = R(w, p);
      const id = act(ctx, `Requisaste recursos de ${r.name}.`, [r.id]);
      w.player.reserves = clamp(w.player.reserves + 22, 0, 100);
      r.food = Math.max(0, r.food - 3);
      r.attitude.resentment = clamp(r.attitude.resentment + 0.15);
      r.flags.explotada = { since: w.day, causeId: id };
      schedule(ctx, 'finExplotacion', 10, { region: r.id }, id);
      regionRemembers(ctx, r.id, 'quitar', -0.55, id);
      return `Tus almacenes se llenan. En ${r.name} te miran de otra manera.`;
    },
  },
  comercio: {
    id: 'comercio', label: 'Acuerdo comercial', icon: '🤝', group: 'economia', target: 'region', method: 'comercio',
    hint: 'Más comercio en el camino que os une. Más presión sobre su tierra.',
    check: (w, p) => {
      const route = routeBetween(w, w.player.home, Number(p.region));
      return all(needAgent(w), notHome(w, p), notAbandoned(w, p), !route ? 'Necesitas un camino directo con esa región.' : route.status !== 'abierta' ? 'El camino no está abierto.' : null);
    },
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      const route = routeBetween(ctx.w, ctx.w.player.home, r.id)!;
      const id = act(ctx, `Firmaste un acuerdo comercial con ${r.name}.`, [r.id]);
      route.baseTraffic = clamp(route.baseTraffic + 0.18, 0, 1.2);
      r.attitude.trust = clamp(r.attitude.trust + 0.05 * influence(r));
      startMission(ctx, 'diplomacia', r.id, 1, {}, id);
      notePattern(ctx, 'comercio', r.id, id);
      return 'Los mercaderes celebran el acuerdo.';
    },
  },
  mediar: {
    id: 'mediar', label: 'Mediar entre regiones', icon: '⚖', group: 'diplomacia', target: 'par', method: 'dialogo',
    hint: 'Sientas a dos pueblos a la misma mesa. Depende de la confianza, los agravios y tu reputación.',
    check: (w, p) => all(needAgent(w), notHome(w, p), p.other === undefined ? 'Elige la otra región.' : null, w.regions[Number(p.region)].relations[Number(p.other)] ? null : 'No son vecinas.'),
    run: (ctx, p) => {
      const a = R(ctx.w, p);
      const b = R(ctx.w, p, 'other');
      const id = act(ctx, `Iniciaste una mediación entre ${a.name} y ${b.name}.`, [a.id, b.id], a.relations[b.id].tensionCause);
      startMission(ctx, 'diplomacia', a.id, 2, {}, id);
      schedule(ctx, 'mediacion', 2, { a: a.id, b: b.id }, id);
      notePattern(ctx, 'dialogo', a.id, id);
      return 'Tus emisarios convocan a ambas partes. Sabrás el resultado en unos días.';
    },
  },
  alianza: {
    id: 'alianza', label: 'Proponer alianza', icon: '🔗', group: 'diplomacia', target: 'par', method: 'dialogo',
    hint: 'Une a dos vecinos que se aprecian. Fracasa si se desconfían.',
    check: (w, p) => {
      const rel = w.regions[Number(p.region)].relations[Number(p.other)];
      return all(needAgent(w), notHome(w, p), p.other === undefined ? 'Elige la otra región.' : null, !rel ? 'No son vecinas.' : rel.allied ? 'Ya son aliadas.' : rel.war ? 'Están en guerra.' : null);
    },
    run: (ctx, p) => {
      const a = R(ctx.w, p);
      const b = R(ctx.w, p, 'other');
      const id = act(ctx, `Propusiste una alianza entre ${a.name} y ${b.name}.`, [a.id, b.id]);
      startMission(ctx, 'diplomacia', a.id, 2, {}, id);
      schedule(ctx, 'alianza', 2, { a: a.id, b: b.id }, id);
      return 'Tus emisarios llevan la propuesta.';
    },
  },
  romperAlianza: {
    id: 'romperAlianza', label: 'Romper una alianza', icon: '✂', group: 'politica', target: 'par', method: 'engano',
    hint: 'Siembras desconfianza entre dos aliados. Si se descubre, no te lo perdonarán.',
    check: (w, p) => {
      const rel = w.regions[Number(p.region)].relations[Number(p.other)];
      return all(needAgent(w), notHome(w, p), !rel?.allied ? 'No son aliadas.' : null);
    },
    run: (ctx, p) => {
      const { w } = ctx;
      const a = R(w, p);
      const b = R(w, p, 'other');
      const id = act(ctx, `Sembraste desconfianza entre ${a.name} y ${b.name}.`, [a.id, b.id]);
      startMission(ctx, 'diplomacia', a.id, 2, {}, id);
      a.relations[b.id].allied = b.relations[a.id].allied = false;
      for (const [x, y] of [[a, b], [b, a]]) {
        x.relations[y.id].opinion = clamp(x.relations[y.id].opinion - 0.45, -1, 1);
        x.relations[y.id].tension = clamp(x.relations[y.id].tension + 0.2);
        x.relations[y.id].tensionCause = id;
      }
      record(ctx, { kind: 'diplomacia', text: `La alianza entre ${a.name} y ${b.name} se rompe entre acusaciones.`, regions: [a.id, b.id], causeId: id, importance: 2 });
      scheduleExposure(ctx, 'alianzaRota', 0.55, { a: a.id, b: b.id }, id);
      return 'Las palabras correctas en los oídos correctos.';
    },
  },
  presion: {
    id: 'presion', label: 'Presión política', icon: '✋', group: 'politica', target: 'region', method: 'comercio',
    hint: 'Les exiges que bajen las armas. Funciona si dependen de ti o te temen; si no, se ofenden.',
    check: (w, p) => all(notHome(w, p), notAbandoned(w, p)),
    run: (ctx, p) => {
      const { w } = ctx;
      const r = R(w, p);
      const id = act(ctx, `Presionaste a ${r.name} para que baje las armas.`, [r.id]);
      const route = routeBetween(w, w.player.home, r.id);
      const leverage = (r.dependency + (route?.status === 'abierta' ? route.traffic * 0.5 : 0) + r.attitude.fear * 0.6 + w.player.credibility * 0.3 + r.attitude.trust * 0.3) * influence(r);
      if (leverage > 0.55) {
        r.militancy = clamp(r.militancy - 0.25);
        for (const rel of Object.values(r.relations)) rel.tension = clamp(rel.tension - 0.15);
        r.attitude.resentment = clamp(r.attitude.resentment + 0.06);
        record(ctx, { kind: 'diplomacia', text: `${r.name} cede a tu presión y modera sus preparativos.`, regions: [r.id], causeId: id, known: true });
        notePattern(ctx, 'comercio', r.id, id);
        return `${r.name} cede, aunque a regañadientes.`;
      }
      r.attitude.resentment = clamp(r.attitude.resentment + 0.18);
      r.militancy = clamp(r.militancy + 0.05);
      regionRemembers(ctx, r.id, 'prohibicion', -0.3, id);
      record(ctx, { kind: 'diplomacia', text: `${r.name} rechaza tu presión con desprecio.`, regions: [r.id], causeId: id, known: true });
      return `${r.name} no depende de ti lo suficiente. Tu exigencia les ofende.`;
    },
  },
  sabotaje: {
    id: 'sabotaje', label: 'Sabotaje', icon: '🔥', group: 'fuerza', target: 'region', method: 'engano',
    hint: 'Retrasa sus preparativos o inventos. Si te descubren, el rencor será enorme.',
    check: (w, p) => all(needAgent(w), notHome(w, p)),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      const id = act(ctx, `Enviaste a alguien a sabotear ${r.name}.`, []);
      startMission(ctx, 'sabotaje', r.id, 2, {}, id);
      return 'Nadie debe saber esto.';
    },
  },
  intervenir: {
    id: 'intervenir', label: 'Intervenir con la guardia', icon: '🛡', group: 'fuerza', target: 'region', method: 'fuerza',
    hint: 'Último recurso: detiene una guerra por la fuerza. Habrá muertos y el mundo lo recordará.',
    check: (w, p) => all(notHome(w, p), R(w, p).flags.guerra ? null : 'No está en guerra.', w.player.guardReady > w.day ? 'Tu guardia aún se recupera.' : null),
    run: (ctx, p) => {
      const { w, rng } = ctx;
      const r = R(w, p);
      const enemy = w.regions[Number(r.flags.guerra?.data?.with)];
      const id = act(ctx, `Tu guardia intervino contra ${r.name} para detener la guerra con ${enemy.name}.`, [r.id, enemy.id], r.flags.guerra?.causeId);
      endWar(ctx, r, enemy, enemy, 'tu intervención');
      r.population *= 0.97;
      r.militancy = clamp(r.militancy - 0.4);
      regionRemembers(ctx, r.id, 'fuerza', -0.7, id);
      regionRemembers(ctx, enemy.id, 'ayuda', 0.5, id);
      if (rng.chance(0.6)) killCharacter(ctx, r.id, id, 'cuando llegó tu guardia');
      for (const o of w.regions) if (!o.isHome && o.id !== enemy.id) o.attitude.fear = clamp(o.attitude.fear + 0.08);
      w.player.cohesion = clamp(w.player.cohesion - 0.05);
      w.player.guardReady = w.day + 10;
      notePattern(ctx, 'fuerza', r.id, id);
      return 'La guerra se detiene. El silencio que deja pesa.';
    },
  },
  compartir: {
    id: 'compartir', label: 'Compartir información', icon: '📜', group: 'informacion', target: 'rumor', method: 'informacion',
    hint: 'Cuentas a una región lo que sabes (o lo que dices saber) sobre un rumor.',
    check: (w, p) => all(needAgent(w), p.region === undefined ? 'Elige a quién contárselo.' : null, notHome(w, p), p.claim === undefined ? 'Elige qué afirmar.' : null),
    run: (ctx, p) => {
      const { w, rng } = ctx;
      const ru = w.rumors.find((x) => x.id === p.rumor)!;
      const r = R(w, p);
      const claimTrue = p.claim === 'cierto';
      const honest = claimTrue === ru.truth;
      const id = act(ctx, `Contaste a ${r.name} que el rumor «${ru.text}» es ${claimTrue ? 'cierto' : 'falso'}.`, [r.id], ru.causeId);
      startMission(ctx, 'diplomacia', r.id, 1, {}, id);
      const believed = rng.chance(clamp(0.25 + w.player.credibility * 0.5 + r.attitude.trust * 0.35));
      const rel = r.relations[ru.about];
      if (believed) {
        if (claimTrue) {
          if (!ru.believers.includes(r.id)) ru.believers.push(r.id);
          if (rel) (rel.tension = clamp(rel.tension + 0.12)), (rel.tensionCause = id);
        } else {
          ru.believers = ru.believers.filter((b) => b !== r.id);
          if (rel) (rel.tension = clamp(rel.tension - 0.25)), (rel.opinion = clamp(rel.opinion + 0.15, -1, 1));
        }
        r.attitude.trust = clamp(r.attitude.trust + 0.04);
        record(ctx, { kind: 'informacion', text: `${r.name} cree tu versión sobre ${w.regions[ru.about].name}.`, regions: [r.id, ru.about], causeId: id, known: true });
      } else {
        record(ctx, { kind: 'informacion', text: `${r.name} escucha tu versión, pero no la cree.`, regions: [r.id], causeId: id, known: true });
      }
      if (honest) {
        schedule(ctx, 'verdadConfirmada', rng.int(3, 8), { region: r.id, about: ru.about }, id);
        notePattern(ctx, 'informacion', r.id, id);
      } else scheduleExposure(ctx, 'mentira', 0.6, { region: r.id, about: ru.about }, id);
      return believed ? 'Te creen.' : 'No parecen convencidos.';
    },
  },
  difundir: {
    id: 'difundir', label: 'Crear un rumor', icon: '🗣', group: 'politica', target: 'par', method: 'engano',
    hint: 'Haces correr una historia sobre una región entre la gente de otra. Puede volverse contra ti.',
    check: (w, p) => all(needAgent(w), notHome(w, p), p.other === undefined ? 'Elige sobre quién.' : null, p.kind === undefined ? 'Elige el tipo de rumor.' : null),
    run: (ctx, p) => {
      const { w } = ctx;
      const audience = R(w, p);
      const about = R(w, p, 'other');
      const kind = String(p.kind) as RumorKind;
      const truth = kind === 'ataque' ? about.militancy > 0.55 : kind === 'hambre' ? about.food < 3 : kind === 'riqueza' ? about.food > 15 : kind === 'enfermedad' ? !!about.flags.fiebre : false;
      const id = act(ctx, `Hiciste correr un rumor en ${audience.name} sobre ${about.name}.`, []);
      startMission(ctx, 'diplomacia', audience.id, 1, {}, id);
      createRumor(ctx, { kind, about: about.id, target: kind === 'ataque' || kind === 'traicion' ? audience.id : undefined, heardIn: audience.id, truth, origin: 'jugador', believers: [audience.id], causeId: id, forceKnown: true });
      scheduleExposure(ctx, 'rumorPropio', 0.45, { region: audience.id, about: about.id }, id);
      return 'La historia empieza a circular.';
    },
  },
  advertir: {
    id: 'advertir', label: 'Advertir del invierno', icon: '❄', group: 'informacion', target: 'region', method: 'informacion',
    hint: 'Compartes lo que sabes del invierno largo para que se preparen.',
    check: (w, p) => all(needAgent(w), notHome(w, p), w.mystery.kind === 'invierno' && w.mystery.solved ? null : 'No sabes de qué advertir.', R(w, p).flags.advertida ? 'Ya están avisados.' : null),
    run: (ctx, p) => {
      const { w } = ctx;
      const r = R(w, p);
      const id = act(ctx, `Advertiste a ${r.name} del invierno largo.`, [r.id]);
      startMission(ctx, 'diplomacia', r.id, 1, {}, id);
      if (r.attitude.trust > 0.28 || w.player.credibility > 0.6) {
        r.flags.advertida = { since: w.day, causeId: id };
        r.food += 2;
        regionRemembers(ctx, r.id, 'verdad', 0.4, id, { X: 'el invierno' });
        notePattern(ctx, 'informacion', r.id, id);
        return `${r.name} empieza a guardar grano.`;
      }
      return `${r.name} no te cree. Ya veremos.`;
    },
  },
  cerrarRuta: {
    id: 'cerrarRuta', label: 'Cerrar ruta', icon: '⛔', group: 'politica', target: 'ruta',
    hint: 'Cortas un camino. Protege, aísla y desvía el comercio hacia otros lugares.',
    check: (w, p) => {
      const route = w.routes[Number(p.route)];
      return !route ? 'Ruta desconocida.' : route.status !== 'abierta' ? 'La ruta no está abierta.' : null;
    },
    run: (ctx, p) => closeRoute(ctx, Number(p.route)),
  },
  abrirRuta: {
    id: 'abrirRuta', label: 'Reabrir ruta', icon: '✅', group: 'politica', target: 'ruta',
    hint: 'Vuelves a abrir un camino que cerraste.',
    check: (w, p) => {
      const route = w.routes[Number(p.route)];
      return !route ? 'Ruta desconocida.' : route.status === 'bloqueada' ? 'Está bloqueada por la guerra.' : route.status === 'abierta' ? 'Ya está abierta.' : null;
    },
    run: (ctx, p) => {
      const { w } = ctx;
      const route = w.routes[Number(p.route)];
      route.status = 'abierta';
      const a = w.regions[route.a];
      const b = w.regions[route.b];
      const id = act(ctx, `Reabriste el camino entre ${a.name} y ${b.name}.`, [a.id, b.id], route.closedCause);
      for (const x of [a, b]) if (!x.isHome) regionRemembers(ctx, x.id, 'rutaAbierta', 0.3, id);
      route.closedCause = undefined;
      return 'El camino vuelve a llenarse de pasos.';
    },
  },
  prohibir: {
    id: 'prohibir', label: 'Prohibir su recurso', icon: '🚫', group: 'politica', target: 'region',
    hint: 'Dejas de comprar y pides que no se explote. La tierra descansa; su economía sufre.',
    check: (w, p) => all(notHome(w, p), notAbandoned(w, p), R(w, p).resourceBanned ? 'Ya está prohibido.' : null),
    run: (ctx, p) => {
      const { w } = ctx;
      const r = R(w, p);
      const accepts = r.attitude.trust >= 0.3 || r.neighbors.includes(w.player.home) || r.dependency > 0.3;
      const id = act(ctx, `Prohibiste comerciar con el recurso de ${r.name}.`, [r.id]);
      if (!accepts) {
        r.attitude.resentment = clamp(r.attitude.resentment + 0.1);
        return `${r.name} ignora tu prohibición: no tienes autoridad allí.`;
      }
      r.resourceBanned = true;
      r.flags.prohibicion = { since: w.day, causeId: id };
      regionRemembers(ctx, r.id, 'prohibicion', -0.4, id);
      return `${r.name} deja de extraer. Ya veremos qué pasa con su tierra... y con su gente.`;
    },
  },
  permitir: {
    id: 'permitir', label: 'Levantar prohibición', icon: '♻', group: 'politica', target: 'region',
    hint: 'Vuelve a permitir el comercio de su recurso.',
    check: (w, p) => (R(w, p).resourceBanned ? null : 'No hay prohibición.'),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      r.resourceBanned = false;
      act(ctx, `Levantaste la prohibición sobre el recurso de ${r.name}.`, [r.id], r.flags.prohibicion?.causeId);
      delete r.flags.prohibicion;
      return 'Las minas y los campos vuelven a trabajar.';
    },
  },
  favorecer: {
    id: 'favorecer', label: 'Favorecer región', icon: '⭐', group: 'politica', target: 'region',
    hint: 'Trato preferente continuo: más confianza allí, envidia en otras partes. Cuesta provisiones cada día.',
    check: (w, p) => all(notHome(w, p), notAbandoned(w, p)),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      r.favored = !r.favored;
      const id = act(ctx, r.favored ? `Empezaste a favorecer a ${r.name}.` : `Dejaste de favorecer a ${r.name}.`, [r.id]);
      if (r.favored) regionRemembers(ctx, r.id, 'favor', 0.3, id);
      return r.favored ? `${r.name} será tu favorita.` : 'Retiras tus favores.';
    },
  },
  abandonar: {
    id: 'abandonar', label: 'Abandonar región', icon: '🏳', group: 'politica', target: 'region', method: 'abandono',
    hint: 'Dejas de intervenir del todo. Quizás aprendan a valerse por sí mismos. Quizás no te perdonen.',
    check: (w, p) => all(notHome(w, p), notAbandoned(w, p)),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      r.abandoned = true;
      r.favored = false;
      const id = act(ctx, `Abandonaste a ${r.name} a su suerte.`, [r.id]);
      r.attitude.trust = clamp(r.attitude.trust - 0.1);
      regionRemembers(ctx, r.id, 'abandono', -0.5, id);
      notePattern(ctx, 'abandono', r.id, id);
      return `${r.name} queda fuera de tus planes.`;
    },
  },
  retomar: {
    id: 'retomar', label: 'Retomar contacto', icon: '🔁', group: 'politica', target: 'region',
    hint: 'Vuelves a ocuparte de una región abandonada.',
    check: (w, p) => (R(w, p).abandoned ? null : 'No la has abandonado.'),
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      r.abandoned = false;
      act(ctx, `Retomaste el contacto con ${r.name}.`, [r.id]);
      return 'Algunos se alegran. Otros recuerdan.';
    },
  },
  compartirTecnologia: {
    id: 'compartirTecnologia', label: 'Difundir un invento', icon: '💡', group: 'informacion', target: 'region', method: 'informacion',
    hint: 'Enseñas a los vecinos lo que esta región inventó. El mundo avanza; el inventor se enfada.',
    check: (w, p) => all(needAgent(w), notHome(w, p), R(w, p).techs.length ? null : 'No han inventado nada.'),
    run: (ctx, p) => {
      const { w } = ctx;
      const r = R(w, p);
      const tech = (p.tech as string) && TECH_BY_ID[p.tech as string] ? (p.tech as string) : r.techs[r.techs.length - 1];
      const id = act(ctx, `Difundiste ${TECH_BY_ID[tech].name} de ${r.name} entre sus vecinos.`, [r.id], r.flags[`invento_${tech}`]?.causeId);
      startMission(ctx, 'diplomacia', r.id, 1, {}, id);
      for (const nb of r.neighbors) {
        const o = w.regions[nb];
        if (o.isHome || o.techs.includes(tech)) continue;
        o.techs.push(tech);
        o.attitude.gratitude = clamp(o.attitude.gratitude + 0.1);
        record(ctx, { kind: 'tecnologia', text: `${o.name} aprende ${TECH_BY_ID[tech].name} gracias a ti.`, regions: [o.id], causeId: id, known: true });
      }
      regionRemembers(ctx, r.id, 'robo', -0.4, id, { X: 'tú' });
      notePattern(ctx, 'informacion', r.id, id);
      return 'El saber ya no tiene dueño.';
    },
  },
  negar: {
    id: 'negar', label: 'Negar', icon: '✖', group: 'otros', target: 'region',
    hint: 'Respondes que no.',
    check: () => null,
    run: (ctx, p) => {
      const r = R(ctx.w, p);
      const id = act(ctx, `Negaste la petición de ${r.name}.`, [r.id]);
      regionRemembers(ctx, r.id, 'negada', -0.4, id);
      if (!ctx.w.player.laws.hospitalidad && r.flags.emigrando) regionRemembers(ctx, r.id, 'rechazo', -0.4, id);
      return 'Tu respuesta llegará pronto a sus oídos.';
    },
  },
  ignorar: {
    id: 'ignorar', label: 'No intervenir', icon: '…', group: 'otros', target: 'global',
    hint: 'Dejas que el mundo siga su curso.',
    check: () => null,
    run: () => 'Observas en silencio.',
  },
  ley: {
    id: 'ley', label: 'Cambiar una ley', icon: '📖', group: 'politica', target: 'global',
    hint: 'Cambia las leyes de tu gente.',
    check: (w, p) => (['hospitalidad', 'secreto', 'racionamiento'].includes(String(p.law)) ? null : 'Ley desconocida.'),
    run: (ctx, p) => {
      const law = String(p.law) as keyof WorldState['player']['laws'];
      const value = Number(p.value) === 1;
      ctx.w.player.laws[law] = value;
      const names = { hospitalidad: 'hospitalidad', secreto: 'secreto', racionamiento: 'racionamiento' };
      act(ctx, `${value ? 'Promulgaste' : 'Derogaste'} la ley de ${names[law]}.`, [ctx.w.player.home]);
      return 'Tu gente toma nota.';
    },
  },
  prioridad: {
    id: 'prioridad', label: 'Cambiar prioridad', icon: '🧭', group: 'politica', target: 'global',
    hint: 'Reorienta los esfuerzos de tu civilización.',
    check: (w, p) => (String(p.priority) === w.player.priority ? 'Ya es tu prioridad.' : null),
    run: (ctx, p) => {
      const { w } = ctx;
      const prio = String(p.priority) as Priority;
      const last = w.counters.lastPriorityChange ?? -99;
      if (w.day - last < 6) w.player.cohesion = clamp(w.player.cohesion - 0.05);
      w.counters.lastPriorityChange = w.day;
      w.player.priority = prio;
      const labels: Record<Priority, string> = { comercio: 'el comercio', seguridad: 'la seguridad', conocimiento: 'el conocimiento', ecologia: 'el cuidado de la tierra' };
      act(ctx, `Tu gente ahora prioriza ${labels[prio]}.`, [w.player.home]);
      if (prio === 'seguridad') for (const r of w.regions) if (!r.isHome && r.neighbors.includes(w.player.home)) r.attitude.fear = clamp(r.attitude.fear + 0.06);
      return w.day - last < 6 ? 'Tu gente se queja de tantos cambios.' : 'Las prioridades cambian.';
    },
  },
};

function closeRoute(ctx: Ctx, routeId: number): string {
  const { w } = ctx;
  const route = w.routes[routeId];
  const a = w.regions[route.a];
  const b = w.regions[route.b];
  route.status = 'cerrada';
  const id = act(ctx, `Cerraste el camino entre ${a.name} y ${b.name}.`, [a.id, b.id]);
  route.closedCause = id;
  // El comercio busca otro camino: las rutas alternativas ganan tráfico.
  const lost = route.traffic;
  const alternatives = [...routesOf(w, a.id), ...routesOf(w, b.id)].filter((r) => r.id !== route.id && r.status === 'abierta');
  if (alternatives.length && lost > 0.1) {
    for (const alt of alternatives) alt.baseTraffic = clamp(alt.baseTraffic + (lost * 0.5) / alternatives.length, 0, 1.2);
    const best = alternatives.sort((x, y) => y.baseTraffic - x.baseTraffic)[0];
    const via = w.regions[best.a === a.id || best.a === b.id ? best.b : best.a];
    record(ctx, { kind: 'consecuencia', text: `Los comerciantes que iban de ${a.name} a ${b.name} cambian de ruta: ahora pasan por ${via.name}.`, regions: [a.id, b.id, via.id], causeId: id, importance: 2 });
  }
  for (const x of [a, b]) if (!x.isHome) regionRemembers(ctx, x.id, 'rutaCerrada', -0.3, id);
  return 'El camino queda cerrado.';
}

// ---------------------------------------------------------------------------
// Ejecutar una acción desde la interfaz.
// ---------------------------------------------------------------------------
export function performAction(w: WorldState, actionId: string, params: Params): ActionResult {
  const def = ACTIONS[actionId];
  if (!def) return { ok: false, message: 'Acción desconocida.' };
  if (w.ended) return { ok: false, message: 'La era ha terminado.' };
  const reason = def.check(w, params);
  if (reason) return { ok: false, message: reason };
  const ctx = makeCtx(w);
  const message = def.run(ctx, params);
  w.player.actionsToday++;
  commitCtx(ctx);
  return { ok: true, message };
}

/** Resolver una petición con una de sus opciones. */
export function answerPetition(w: WorldState, petitionId: string, choiceIndex: number): ActionResult {
  const p = w.petitions.find((x) => x.id === petitionId);
  if (!p) return { ok: false, message: 'La petición ya no existe.' };
  const choice = p.choices[choiceIndex];
  const res = performAction(w, choice.action, choice.params);
  if (res.ok) w.petitions = w.petitions.filter((x) => x.id !== petitionId);
  return res;
}

// ---------------------------------------------------------------------------
// Resolución de misiones y consecuencias retardadas.
// ---------------------------------------------------------------------------
registerEffect('mision_observar', (ctx, s) => {
  const { w, rng } = ctx;
  endMission(ctx, s.data.mission);
  const r = w.regions[Number(s.data.region)];
  observe(ctx, r, w.player.priority === 'conocimiento' ? 0.9 : 0.75);
  const revealed = revealRegionHistory(w, r.id, w.day - 20);
  for (const c of charactersOf(w, r.id).slice(0, 2)) c.known = true;
  mysteryHooks.observe(ctx, r);
  let text = `Tu observador volvió de ${r.name} con un informe.`;
  if (revealed.length) text += ` Descubrió ${revealed.length === 1 ? 'algo que había pasado' : `${revealed.length} cosas que habían pasado`} sin que lo supieras.`;
  if (r.attitude.trust < 0.25 && rng.chance(0.3)) {
    regionRemembers(ctx, r.id, 'espia', -0.3, s.causeId);
    text += ' Allí lo trataron como a un espía.';
  }
  record(ctx, { kind: 'informacion', text, regions: [r.id], causeId: s.causeId, known: true });
});

registerEffect('mision_espiar', (ctx, s) => {
  const { w, rng } = ctx;
  endMission(ctx, s.data.mission);
  const r = w.regions[Number(s.data.region)];
  observe(ctx, r, 0.95);
  w.intel[r.id].level = 3;
  for (const c of charactersOf(w, r.id)) c.known = true;
  revealRegionHistory(w, r.id, w.day - 30, 10);
  mysteryHooks.spy(ctx, r);
  const risk = clamp(0.25 + (r.attitude.trust < 0.3 ? 0.15 : 0) - (w.player.laws.secreto ? 0.12 : 0));
  if (rng.chance(risk)) {
    const e = record(ctx, { kind: 'informacion', text: `Tu espía fue descubierto en ${r.name}.`, regions: [r.id], causeId: s.causeId, known: true, importance: 2 });
    regionRemembers(ctx, r.id, 'espia', -0.5, e.id);
    r.attitude.trust = clamp(r.attitude.trust - 0.12);
    notePattern(ctx, 'engano', r.id, e.id);
  } else {
    record(ctx, { kind: 'informacion', text: `Tu espía volvió de ${r.name}: ahora conoces a su gente, sus recuerdos y lo que traman.`, regions: [r.id], causeId: s.causeId, known: true });
  }
});

registerEffect('mision_investigar', (ctx, s) => {
  const { w } = ctx;
  endMission(ctx, s.data.mission);
  const ru = w.rumors.find((x) => x.id === s.data.rumor);
  if (!ru) return;
  const note = verdictOf(ctx, ru);
  if (ru.kind === 'ataque') observe(ctx, w.regions[ru.about], 0.7, ['tension', 'investigacion']);
  record(ctx, { kind: 'informacion', text: `Investigación: «${ru.text}» — ${ru.verdict?.toUpperCase()}. ${note}`, regions: [ru.about], causeId: ru.causeId, known: true, importance: 2 });
  mysteryHooks.rumor(ctx, ru);
});

registerEffect('mision_sabotaje', (ctx, s) => {
  const { w, rng } = ctx;
  endMission(ctx, s.data.mission);
  const r = w.regions[Number(s.data.region)];
  r.militancy = clamp(r.militancy - 0.35);
  if (r.research) r.research.progress = Math.max(0, r.research.progress - 0.6);
  const e = record(ctx, { kind: 'evento', text: `Un incendio destruye talleres y almacenes de armas en ${r.name}.`, regions: [r.id], causeId: s.causeId, importance: 2 });
  record(ctx, { kind: 'accion', text: `El sabotaje en ${r.name} se completó.`, regions: [r.id], causeId: e.id, known: true, byPlayer: true });
  // Si no sospechan de ti, quizás culpen a un vecino.
  const discovered = rng.chance(clamp(0.4 - (w.player.laws.secreto ? 0.2 : 0)));
  if (discovered) schedule(ctx, 'expuesto', rng.int(2, 7), { kind: 'sabotaje', region: r.id }, e.id);
  else if (rng.chance(0.45)) {
    const nb = r.neighbors.filter((n) => !w.regions[n].isHome);
    if (nb.length) {
      const blamed = w.regions[rng.pick(nb)];
      r.relations[blamed.id].tension = clamp(r.relations[blamed.id].tension + 0.25);
      r.relations[blamed.id].opinion = clamp(r.relations[blamed.id].opinion - 0.25, -1, 1);
      const e2 = record(ctx, { kind: 'conflicto', text: `${r.name} culpa a ${blamed.name} del incendio.`, regions: [r.id, blamed.id], causeId: e.id, importance: 2 });
      r.relations[blamed.id].tensionCause = e2.id;
    }
  }
  // El patrón de engaño solo lo aprende el mundo si el sabotaje se descubre.
});

registerEffect('mision_diplomacia', (ctx, s) => endMission(ctx, s.data.mission));

registerEffect('mediacion', (ctx, s) => {
  const { w, rng } = ctx;
  const a = w.regions[Number(s.data.a)];
  const b = w.regions[Number(s.data.b)];
  const ra = a.relations[b.id];
  const rb = b.relations[a.id];
  const trust = (a.attitude.trust + b.attitude.trust) / 2;
  const manipulated = w.rumors.some((x) => x.origin === 'manipulador' && (x.believers.includes(a.id) || x.believers.includes(b.id)));
  const p = clamp(0.3 + trust * 0.3 + Math.min(0.2, (w.player.patterns.dialogo ?? 0) * 0.04) + w.player.credibility * 0.15 - (ra.grievance + rb.grievance) * 0.15 - (ra.war ? 0.12 : 0) - (manipulated ? 0.15 : 0), 0.05, 0.9);
  if (rng.chance(p * Math.min(influence(a), influence(b)) + (1 - Math.min(influence(a), influence(b))) * p * 0.5)) {
    for (const [x, y] of [[a, b], [b, a]]) {
      x.relations[y.id].tension = clamp(x.relations[y.id].tension - 0.4);
      x.relations[y.id].opinion = clamp(x.relations[y.id].opinion + 0.2, -1, 1);
      x.attitude.trust = clamp(x.attitude.trust + 0.07);
      x.militancy = clamp(x.militancy - 0.15);
    }
    const e = record(ctx, { kind: 'diplomacia', text: `La mediación entre ${a.name} y ${b.name} funciona: ambos bajan la voz.`, regions: [a.id, b.id], causeId: s.causeId, known: true, importance: 2 });
    if (ra.war) endWar(ctx, a, b, null, 'tu mediación');
    regionRemembers(ctx, a.id, 'mediacion', 0.45, e.id, { X: b.name }, b.id);
    regionRemembers(ctx, b.id, 'mediacion', 0.45, e.id, { X: a.name }, a.id);
  } else {
    const e = record(ctx, { kind: 'diplomacia', text: `La mediación entre ${a.name} y ${b.name} fracasa${manipulated ? ': cada parte jura tener pruebas de la traición de la otra' : ''}.`, regions: [a.id, b.id], causeId: s.causeId, known: true, importance: 2 });
    regionRemembers(ctx, a.id, 'mediacionFallida', -0.15, e.id, { X: b.name }, b.id);
    regionRemembers(ctx, b.id, 'mediacionFallida', -0.15, e.id, { X: a.name }, a.id);
  }
});

registerEffect('alianza', (ctx, s) => {
  const { w } = ctx;
  const a = w.regions[Number(s.data.a)];
  const b = w.regions[Number(s.data.b)];
  const ok = a.relations[b.id].opinion > 0.1 && b.relations[a.id].opinion > 0.1 && (a.attitude.trust + b.attitude.trust) / 2 > 0.38;
  if (ok) {
    a.relations[b.id].allied = b.relations[a.id].allied = true;
    const e = record(ctx, { kind: 'diplomacia', text: `${a.name} y ${b.name} aceptan tu propuesta y sellan una alianza.`, regions: [a.id, b.id], causeId: s.causeId, known: true, importance: 2 });
    regionRemembers(ctx, a.id, 'alianza', 0.4, e.id, { X: b.name }, b.id);
    regionRemembers(ctx, b.id, 'alianza', 0.4, e.id, { X: a.name }, a.id);
  } else {
    record(ctx, { kind: 'diplomacia', text: `${a.name} y ${b.name} rechazan la alianza: aún no se fían lo suficiente.`, regions: [a.id, b.id], causeId: s.causeId, known: true });
  }
});

registerEffect('finExplotacion', (ctx, s) => {
  delete ctx.w.regions[Number(s.data.region)].flags.explotada;
});

registerEffect('verdadConfirmada', (ctx, s) => {
  const r = ctx.w.regions[Number(s.data.region)];
  regionRemembers(ctx, r.id, 'verdad', 0.35, s.causeId, { X: ctx.w.regions[Number(s.data.about)].name });
  ctx.w.player.credibility = clamp(ctx.w.player.credibility + 0.03);
});

/** Un engaño sale a la luz. */
registerEffect('expuesto', (ctx, s) => {
  const { w } = ctx;
  const kind = String(s.data.kind);
  const r = w.regions[Number(s.data.region ?? s.data.a)];
  const texts: Record<string, string> = {
    mentira: `${r.name} descubre que le mentiste.`,
    rumorPropio: `${r.name} descubre que el rumor sobre ${w.regions[Number(s.data.about)]?.name} salió de tu gente.`,
    sabotaje: `${r.name} descubre que el incendio fue obra tuya.`,
    alianzaRota: `Se descubre que fuiste tú quien rompió la alianza entre ${w.regions[Number(s.data.a)]?.name} y ${w.regions[Number(s.data.b)]?.name}.`,
  };
  const e = record(ctx, { kind: 'consecuencia', text: texts[kind] ?? 'Un engaño tuyo sale a la luz.', regions: [r.id], causeId: s.causeId, known: true, importance: 3 });
  const memKind = kind === 'sabotaje' ? 'sabotaje' : kind === 'alianzaRota' ? 'alianzaRota' : 'mentira';
  const targets = kind === 'alianzaRota' ? [Number(s.data.a), Number(s.data.b)] : [r.id];
  for (const id of targets) {
    regionRemembers(ctx, id, memKind, kind === 'sabotaje' ? -0.8 : -0.6, e.id, { X: w.regions[Number(s.data.about ?? s.data.b)]?.name ?? 'otros' });
    w.regions[id].attitude.trust = clamp(w.regions[id].attitude.trust - 0.2);
    if (kind === 'sabotaje') w.regions[id].attitude.fear = clamp(w.regions[id].attitude.fear + 0.15);
  }
  if (kind === 'rumorPropio' && s.data.about !== undefined) regionRemembers(ctx, Number(s.data.about), 'mentira', -0.5, e.id, { X: r.name });
  w.player.credibility = clamp(w.player.credibility - 0.1);
  w.player.cohesion = clamp(w.player.cohesion - 0.02);
  notePattern(ctx, 'engano', r.id, e.id);
});

/** Hablar con un personaje conocido (no consume emisarios; una vez al día). */
export function talkTo(w: WorldState, characterId: string): string[] {
  const c = w.characters.find((x) => x.id === characterId);
  if (!c || !c.alive) return ['No hay nadie con quien hablar.'];
  if (c.lastSpoke === w.day) return ['Ya hablasteis hoy. Vuelve mañana.'];
  const ctx = makeCtx(w);
  const leader = leaderOf(w, c.regionId);
  const lines = speakWithMystery(ctx, c.id);
  if (leader?.id === c.id) w.regions[c.regionId].lastAttention = w.day;
  commitCtx(ctx);
  return lines;
}

function speakWithMystery(ctx: Ctx, id: string): string[] {
  const c = ctx.w.characters.find((x) => x.id === id)!;
  const lines = speak(ctx, c);
  if (mysteryHooks.talk(ctx, c)) lines.push('(Lo que te cuenta encaja con algo que no terminas de entender. Lo anotas.)');
  return lines;
}

