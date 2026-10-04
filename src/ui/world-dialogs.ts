import { ACTIONS, answerPetition, freeAgents } from '../core/api';
import { ROLES } from '../core/content/roles';
import type { WorldState } from '../core/types';
import { audio } from '../audio/audio';
import { appearanceOf } from '../render/appearance';
import { drawPortrait } from '../render/human';
import { moodOf } from '../render/mood';
import type { Target } from '../render/scene';
import { ROLE_TITLE } from '../world/folk';
import { describeEncounter, encounterOptions, resolveEncounter } from '../world/encounters';
import { doorOf, getLayout, nearestWalkable } from '../world/layout';
import { ensureLife, heirs, succeed } from '../world/life';
import { checkRumorInPerson, examinePlace, listenTavern, templeElders } from '../world/presence';
import { roadPath } from '../world/roadnet';
import { giveTo, observeFolk, talkToFolk } from '../world/talk';
import type { App } from './app';
import { h, vibrate } from './dom';
import { openAction } from './screens/composer';

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
}

/** Caja de diálogo al estilo de los juegos de rol. */
export function dialogue(app: App, title: string, subtitle: string, lines: string[], choices: Choice[], portrait?: HTMLCanvasElement): () => void {
  let close = () => {};
  close = app.modal(() => [
    h('div', { class: `dlg-head ${portrait ? 'with-portrait' : ''}` }, portrait ?? null, h('div', null, h('h2', null, title), subtitle ? h('div', { class: 'tiny' }, subtitle) : null)),
    ...lines.map((l) => h('p', { class: l.startsWith('«') || l.startsWith('—') ? 'quote' : '' }, l)),
    h('div', { class: 'dlg-choices' }, ...choices.map((c) => h('button', { class: `btn ${c.primary ? 'teal' : ''}`, onclick: () => (close(), c.run()) }, c.label, c.hint ? h('small', null, c.hint) : null))),
  ], { cls: 'dialog' });
  return close;
}

const folkOf = (w: WorldState, id: string) => ensureLife(w).folk.find((f) => f.id === id);

/** Retrato del vecino con la expresión que le provoca lo que ha vivido. Parpadea mientras el diálogo está abierto. */
function portraitOf(w: WorldState, folkId: string): HTMLCanvasElement | undefined {
  const f = folkOf(w, folkId);
  if (!f) return undefined;
  const c = document.createElement('canvas');
  c.className = 'portrait';
  c.width = 176;
  c.height = 176;
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
      if (f?.role === 'lider' && !w.regions[f.regionId].isHome) out.splice(1, 0, b('⚖ Decidir', () => leaderDecisions(app, f.regionId)));
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
      return travel(app, t.regionId);
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
  const r = w.regions[f.regionId];
  const res = talkToFolk(w, folkId);
  const inv = ensureLife(w).player.inventory;
  const choices: Choice[] = [];
  if (f.role === 'lider' && !r.isHome) choices.push({ label: '⚖ Tratar asuntos de gobierno', run: () => leaderDecisions(app, f.regionId), primary: true });
  const pet = w.petitions.find((p) => p.regionId === f.regionId && (p.characterId === f.charId || f.role === 'lider'));
  if (pet) choices.push({ label: `📨 «${pet.title}»`, run: () => petition(app, pet.id) });
  if (inv.comida > 0) choices.push({ label: '🍞 Darle comida', run: () => (app.toast(giveTo(w, folkId, 'comida')), app.refresh()) });
  if (inv.hierbas > 0 && (r.flags.fiebre || f.age > 60)) choices.push({ label: '🌿 Darle hierbas', run: () => (app.toast(giveTo(w, folkId, 'hierbas')), app.refresh()) });
  choices.push({ label: 'Despedirse', run: () => app.refresh() });
  const title = f.charId ? `${f.name}, ${ROLES[w.characters.find((c) => c.id === f.charId)?.role ?? '']?.title ?? ROLE_TITLE[f.role]}` : `${f.name}, ${ROLE_TITLE[f.role]}`;
  app.scene?.converse(folkId);
  dialogue(app, title, `${r.name}${f.origin !== undefined ? ` · llegado de ${w.regions[f.origin].name}` : ''}`, res.lines.map((l) => (l.startsWith('(') ? l : `«${l}»`)), choices, portraitOf(w, folkId));
  if (res.learned.length) for (const l of res.learned) app.whisper(`📝 ${l}`);
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
  const choices: Choice[] = ids.map((id) => ({
    label: `${ACTIONS[id].icon} ${id === 'favorecer' && r.favored ? 'Dejar de favorecer' : ACTIONS[id].label}`,
    run: () => openAction(app, id, { region: regionId, inPerson: 1 }),
  }));
  for (const ru of known) choices.push({ label: `📜 Contarle: «${ru.text.slice(0, 48)}${ru.text.length > 48 ? '…' : ''}»`, run: () => openAction(app, 'compartir', { region: regionId, rumor: ru.id, inPerson: 1 }) });
  for (const p of w.petitions.filter((x) => x.regionId === regionId)) choices.unshift({ label: `📨 Responder: ${p.title}`, run: () => petition(app, p.id), primary: true });
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
  const w = app.w!;
  const r = w.regions[regionId];
  const home = r.isHome;
  const life = ensureLife(w);
  switch (kind) {
    case 'hogar':
      return void dialogue(app, 'Tu casa', `${life.player.name}, ${life.player.age} años`, ['El fuego sigue encendido. Tu familia te espera.'], [
        { label: '🌙 Dormir hasta el amanecer', run: () => app.sleep(), primary: true },
        { label: '⏳ Descansar tres horas', run: () => (app.passTime(180), app.toast('Descansas un rato.')) },
        { label: '🌳 Tu familia y tu linaje', run: () => app.setView('familia') },
        { label: '💾 Guardar o cargar', run: () => app.saves() },
        { label: 'Salir', run: () => {} },
      ]);
    case 'almacen':
      if (home) return storehouse(app);
      return void dialogue(app, `Almacén de ${r.name}`, '', [r.food < 4 ? 'Las estanterías están casi vacías. Un hombre barre el suelo sin ganas.' : r.food > 15 ? 'Sacos apilados hasta el techo. Huele a grano seco.' : 'Hay provisiones, pero se cuentan con cuidado.'], [
        { label: `${ACTIONS.explotar.icon} Exigir parte de sus recursos`, run: () => openAction(app, 'explotar', { region: regionId, inPerson: 1 }) },
        { label: 'Salir', run: () => {} },
      ]);
    case 'salon':
      if (home) return council(app);
      return leaderDecisions(app, regionId);
    case 'posada':
      return tavern(app, regionId);
    case 'templo':
      return void dialogue(app, `Templo de ${r.name}`, '', templeElders(w, regionId), [{ label: 'Salir', run: () => app.refresh() }]);
    case 'forja':
      return void dialogue(app, `Forja de ${r.name}`, '', [r.militancy > 0.55 ? 'Martillos día y noche. Puntas de lanza amontonadas en un rincón.' : r.research ? 'El herrero prueba algo nuevo y no deja mirar.' : 'Herraduras, rejas de arado, ollas. Trabajo de paz.'], [{ label: 'Salir', run: () => {} }]);
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
  dialogue(app, 'Almacén de tu gente', `Provisiones: ${Math.round(w.player.reserves)}`, ['«¿Qué hacemos con lo que tenemos?», pregunta el intendente, libreta en mano.'], [
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
  dialogue(app, 'Salón del consejo', `Emisarios libres: ${freeAgents(w)} de ${w.player.agents}`, ['Aquí se reúne tu gente. Desde aquí envías emisarios allí donde no puedes ir en persona.'], [
    ...w.petitions.slice(0, 3).map((p) => ({ label: `📨 ${p.title}`, run: () => petition(app, p.id) })),
    { label: '🧭 Enviar emisarios', run: () => emissaries(app), primary: true },
    { label: '⚖ Leyes, prioridades y peticiones', run: () => app.setView('decisiones') },
    { label: '🔎 Investigaciones y rumores', run: () => app.setView('investigar') },
    { label: 'Salir', run: () => {} },
  ]);
}

function emissaries(app: App): void {
  regionPicker(app, '¿A qué región envías a alguien?', (id) => {
    const w = app.w!;
    const st = w.intel[id].observerStationed;
    const opts: Choice[] = (['observar', st ? 'retirar' : 'destacar', 'espiar', 'sabotaje'] as const).map((a) => ({ label: `${ACTIONS[a].icon} ${ACTIONS[a].label}`, hint: ACTIONS[a].hint, run: () => openAction(app, a, { region: id }) }));
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
  const aboutHere = w.rumors.filter((x) => x.known && !x.investigated && x.about === regionId);
  dialogue(app, `Posada de ${r.name}`, '', ['Humo, cerveza y conversaciones a media voz.'], [
    { label: '👂 Escuchar conversaciones', run: () => dialogue(app, `Posada de ${r.name}`, 'Escuchas…', listenTavern(w, regionId), [{ label: 'Seguir', run: () => app.refresh() }]), primary: true },
    ...aboutHere.map((ru) => ({ label: `🔎 Comprobar en persona: «${ru.text.slice(0, 40)}…»`, run: () => dialogue(app, 'Lo compruebas tú mismo', '', [checkRumorInPerson(w, ru.id)], [{ label: 'Seguir', run: () => app.refresh() }]) })),
    { label: `${ACTIONS.difundir.icon} Hacer correr un rumor`, run: () => openAction(app, 'difundir', { region: regionId, inPerson: 1 }), hint: ACTIONS.difundir.hint },
    { label: 'Salir', run: () => {} },
  ]);
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
  if (route.status === 'abierta') choices.push({ label: `${ACTIONS.cerrarRuta.icon} Pedir que cierren el paso`, hint: ACTIONS.cerrarRuta.hint, run: () => openAction(app, 'cerrarRuta', { route: p.routeId, region: a.isHome ? b.id : a.id }) });
  if (route.status === 'cerrada') choices.push({ label: `${ACTIONS.abrirRuta.icon} Pedir que lo reabran`, run: () => openAction(app, 'abrirRuta', { route: p.routeId, region: a.isHome ? b.id : a.id }) });
  if (rel?.war) {
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
  const view = describeEncounter(w, e);
  const opts = encounterOptions(w, e);
  dialogue(app, view.title, w.regions[e.regionId].name, [view.scene, ...extra], opts.map((o, i) => ({
    label: o.label,
    primary: i === 0,
    run: () => {
      const res = resolveEncounter(w, id, o.id);
      if (res.done) dialogue(app, view.title, '', res.lines, [{ label: 'Seguir tu camino', run: () => app.refresh(), primary: true }]);
      else encounter(app, id, res.lines);
    },
  })), e.folkA ? portraitOf(w, e.folkA) : undefined);
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
  dialogue(app, `${old.name} ha muerto`, `a los ${old.age} años`, ['Tu gente lo llora. El mundo sigue.', 'Alguien debe tomar el relevo. Heredará la casa, el conocimiento, la reputación… y los enemigos.'], list.map((k, i) => ({
    label: `${k.name}, ${k.relation} (${k.age} años)`,
    primary: i === 0,
    run: () => {
      if (!old.family.length) old.family.push({ ...k });
      const name = succeed(w, k.name);
      const l = getLayout(w);
      const home = l.villages[w.player.home];
      const hogar = home.keys.find((b) => b.kind === 'hogar');
      const d = hogar ? doorOf(hogar) : { x: home.cx, y: home.cy };
      const spot = nearestWalkable(l, d.x, d.y);
      app.scene?.teleport(spot.x, spot.y);
      app.banner('Una nueva generación', name);
      app.refresh();
    },
  })));
}

