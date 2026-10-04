import { MEMORY_LINES } from '../../core/content/dialogue';
import { ACTIONS, talkTo } from '../../core/api';
import type { Params } from '../../core/actions';
import { ago, fill } from '../../core/util';
import { charactersOf, routesOf } from '../../core/world';
import { audio } from '../../audio/audio';
import type { App } from '../app';
import { clear, h } from '../dom';
import { regionStatus, STATUS_LABEL } from '../map/colors';
import { avatar, characterTitle, emotionRead, empty, entryRow, FACT_LABEL, FACT_ORDER } from './common';
import { openAction } from './composer';

/**
 * Panel de región (hoja inferior deslizable). Solo muestra lo que el jugador
 * sabe, con la fecha y la fiabilidad de cada dato.
 */
type Tab = 'saber' | 'gente' | 'decidir' | 'historia';
let currentTab: Tab = 'saber';

const LEVEL_TEXT = ['Tierra sin explorar', 'Solo la conoces de oídas', 'Observada', 'Conocida a fondo'];

export function openRegionSheet(app: App, id: number, keepTab: boolean): HTMLElement {
  const w = app.w!;
  const r = w.regions[id];
  const intel = w.intel[id];
  if (!keepTab) currentTab = intel.level === 0 ? 'decidir' : 'saber';
  const body = h('div', { class: 'body' });
  const tabs = h('div', { class: 'tabs' });
  const status = STATUS_LABEL[regionStatus(w, id)];

  const draw = () => {
    clear(tabs).append(
      ...(['saber', 'gente', 'decidir', 'historia'] as Tab[]).map((t) =>
        h('button', { class: currentTab === t ? 'on' : '', onclick: () => ((currentTab = t), audio.sfx('tap'), draw()) }, { saber: 'Saber', gente: 'Gente', decidir: 'Decidir', historia: 'Historia' }[t]),
      ),
    );
    clear(body).append(tabs, ...{ saber: tabKnow, gente: tabPeople, decidir: tabDecide, historia: tabHistory }[currentTab](app, id));
  };
  draw();

  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'grab' }),
    h('div', { class: 'head' },
      h('div', { class: 'title' },
        h('h2', { style: 'margin:0' }, intel.level === 0 ? 'Tierra sin explorar' : r.name),
        h('div', { class: 'tiny' }, r.isHome ? 'Tu hogar' : `${status} · ${LEVEL_TEXT[intel.level]}${intel.level >= 2 ? ` (${ago(w.day - intel.lastObserved)})` : ''}`),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => app.closeRegion() }, '✕'),
    ),
    body,
  );
  enableSwipeDown(sheet, () => app.closeRegion());
  return sheet;
}

/** Deslizar hacia abajo desde la cabecera cierra la hoja. */
function enableSwipeDown(sheet: HTMLElement, onClose: () => void): void {
  let y0 = -1;
  let dy = 0;
  const handles = [sheet.querySelector('.grab'), sheet.querySelector('.head')].filter(Boolean) as HTMLElement[];
  for (const el of handles) {
    el.addEventListener('pointerdown', (e) => {
      // No capturar el puntero si se toca un botón (p. ej. cerrar).
      if ((e.target as HTMLElement).closest('button')) return;
      y0 = e.clientY;
      dy = 0;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 < 0) return;
      dy = Math.max(0, e.clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    el.addEventListener('pointerup', () => {
      if (y0 < 0) return;
      y0 = -1;
      if (dy > 90) onClose();
      else sheet.style.transform = '';
    });
  }
}

function tabKnow(app: App, id: number): Node[] {
  const w = app.w!;
  const r = w.regions[id];
  const intel = w.intel[id];
  const out: Node[] = [];
  if (r.isHome) {
    out.push(h('p', { class: 'lead' }, 'Tu pequeña civilización. Desde aquí envías emisarios, provisiones y palabras. No eres dueño del mundo: solo una voz más en él.'),
      h('button', { class: 'btn block', onclick: () => app.setView('decisiones') }, '⚖ Leyes, prioridades y peticiones'));
  }
  if (intel.level === 0) {
    out.push(empty('No sabes nada de este lugar. Ni siquiera su nombre. Envía un observador desde «Decidir».'));
    return out;
  }
  const facts = FACT_ORDER.filter((k) => intel.facts[k] && !(r.isHome && k === 'confianza'));
  if (!facts.length) out.push(empty('Apenas sabes nada. Las pistas y los observadores te dirán más.'));
  for (const k of facts) {
    const f = intel.facts[k]!;
    const age = w.day - f.day;
    out.push(h('div', { class: `fact ${age > 8 ? 'stale' : ''}` },
      h('div', { class: 'k' }, FACT_LABEL[k]),
      h('div', { class: 'v' }, f.value, h('small', null, `${f.reliable ? '✓ informe' : '~ de oídas'} · ${ago(age)}`)),
    ));
  }
  const rumors = w.rumors.filter((x) => x.known && (x.about === id || x.target === id));
  if (rumors.length) {
    out.push(h('h3', null, 'Rumores'));
    for (const ru of rumors.slice(-5).reverse())
      out.push(h('div', { class: 'card' },
        h('div', { class: 'tiny' }, `Oído en ${w.regions[ru.heardIn].name} · ${ago(w.day - ru.day)}`),
        h('p', { class: 'quote' }, `«${ru.text}»`),
        ru.verdict ? h('span', { class: `tag ${ru.verdict === 'cierto' ? 'bad' : ru.verdict === 'falso' ? 'good' : 'warn'}` }, ru.verdict) : h('span', { class: 'tag' }, 'sin comprobar'),
      ));
  }
  const clues = w.clues.filter((c) => c.regionId === id).slice(-5).reverse();
  if (clues.length) {
    out.push(h('h3', null, 'Pistas recientes'));
    for (const c of clues) out.push(h('div', { class: 'entry' }, h('div', { class: 'ico' }, '·'), h('div', { class: 'txt' }, c.text, h('div', { class: 'tiny' }, `Día ${c.day}`))));
  }
  return out;
}

function tabPeople(app: App, id: number): Node[] {
  const w = app.w!;
  const r = w.regions[id];
  if (r.isHome) return [empty('Tu gente te sigue. Su ánimo depende de las provisiones, de las guerras cercanas y de tus leyes.')];
  const known = charactersOf(w, id, false).filter((c) => c.known);
  const out: Node[] = [];
  if (!known.length) out.push(empty('Aún no conoces a nadie aquí. Observa, espía o espera a que te busquen.'));
  for (const c of known) {
    const canRead = w.intel[id].level >= 2 || c.lastSpoke >= 0;
    const memories = w.intel[id].level >= 3 ? c.memories.slice(-4).reverse() : [];
    out.push(h('div', { class: 'card' },
      h('div', { class: 'person' }, avatar(w, c),
        h('div', { style: 'flex:1' },
          h('b', null, characterTitle(w, c)),
          !c.alive ? h('div', { class: 'tag bad' }, 'fallecido') : canRead ? h('div', { class: 'muted' }, `Parece que ${emotionRead(c)}.`) : h('div', { class: 'muted' }, 'No sabes qué piensa.'),
          ...memories.map((m) => h('div', { class: 'tiny quote' }, `Recuerda: ${fill(MEMORY_LINES[m.kind]?.[0] ?? '…', { d: w.day - m.day, X: m.vars?.X ?? (typeof m.about === 'number' ? w.regions[m.about].name : 'ti'), rel: c.relative, R: r.name, res: r.resource })}`)),
        )),
      c.alive ? h('div', { class: 'actions' }, h('button', { class: 'btn small', disabled: c.lastSpoke === w.day, onclick: () => talk(app, c.id) }, c.lastSpoke === w.day ? 'Ya hablasteis hoy' : '💬 Hablar')) : null,
    ));
  }
  return out;
}

function talk(app: App, characterId: string): void {
  const w = app.w!;
  const c = w.characters.find((x) => x.id === characterId)!;
  const lines = talkTo(w, characterId);
  app.modal(() => [
    h('div', { class: 'person' }, avatar(w, c), h('div', null, h('h2', null, c.name), h('div', { class: 'tiny' }, characterTitle(w, c)))),
    ...lines.map((l) => h('p', { class: 'quote' }, l.startsWith('(') ? h('span', { class: 'muted' }, l) : `«${l}»`)),
    h('p', { class: 'tiny' }, 'Lo que te cuentan puede no ser cierto.'),
  ], { onClose: () => app.refresh() });
}

/** Acciones disponibles para la región, agrupadas. */
function tabDecide(app: App, id: number): Node[] {
  const w = app.w!;
  const r = w.regions[id];
  if (r.isHome) {
    return [h('p', { class: 'lead' }, 'Las decisiones sobre tu gente están en la pantalla de Decisiones.'), h('button', { class: 'btn block primary', onclick: () => app.setView('decisiones') }, 'Ir a Decisiones'), ...routeControls(app, id)];
  }
  const intel = w.intel[id];
  const ids: string[] = [];
  ids.push('observar', intel.observerStationed ? 'retirar' : 'destacar', 'espiar');
  if (r.abandoned) ids.push('retomar');
  else {
    ids.push('ayuda', 'regalo', 'comercio', 'explotar', 'mediar', 'alianza', 'romperAlianza', 'presion', 'difundir', 'sabotaje');
    ids.push(r.resourceBanned ? 'permitir' : 'prohibir');
    ids.push('favorecer', 'abandonar');
    if (r.techs.length && intel.facts.tecnologias?.value !== 'nada fuera de lo común') ids.push('compartirTecnologia');
    if (w.mystery.kind === 'invierno' && w.mystery.solved) ids.push('advertir');
    if (intel.facts.tension?.value === 'en guerra' || (r.flags.guerra && intel.level > 0)) ids.push('intervenir');
  }
  const groups: Record<string, string> = { informacion: 'Información', diplomacia: 'Diplomacia', economia: 'Economía', politica: 'Política', fuerza: 'Último recurso' };
  const out: Node[] = [];
  for (const [g, title] of Object.entries(groups)) {
    const list = ids.filter((a) => ACTIONS[a].group === g);
    if (!list.length) continue;
    out.push(h('h3', null, title));
    out.push(h('div', { class: 'action-grid' }, ...list.map((a) => actionButton(app, a, { region: id }))));
  }
  out.push(...routeControls(app, id));
  return out;
}

function actionButton(app: App, actionId: string, params: Params): HTMLElement {
  const w = app.w!;
  const def = ACTIONS[actionId];
  let label = def.label;
  if (actionId === 'favorecer' && w.regions[Number(params.region)].favored) label = 'Dejar de favorecer';
  // Las acciones de pareja comprueban la otra región en el compositor.
  const reason = def.target === 'par' ? null : def.check(w, params);
  return h('button', {
    class: 'action', 'aria-disabled': reason ? 'true' : 'false',
    onclick: () => (reason ? app.toast(reason, true) : openAction(app, actionId, params)),
  }, h('span', { class: 'i' }, def.icon), h('span', null, label));
}

function routeControls(app: App, id: number): Node[] {
  const w = app.w!;
  const routes = routesOf(w, id).filter((rt) => w.intel[rt.a].level > 0 || w.intel[rt.b].level > 0);
  if (!routes.length) return [];
  return [
    h('h3', null, 'Caminos'),
    ...routes.map((rt) => {
      const other = w.regions[rt.a === id ? rt.b : rt.a];
      const name = w.intel[other.id].level ? other.name : 'una tierra sin explorar';
      const tag = rt.status === 'abierta' ? h('span', { class: 'tag good' }, 'abierto') : rt.status === 'cerrada' ? h('span', { class: 'tag warn' }, 'cerrado') : h('span', { class: 'tag bad' }, 'bloqueado por la guerra');
      const btn = rt.status === 'abierta' ? h('button', { class: 'btn small', onclick: () => openAction(app, 'cerrarRuta', { route: rt.id, region: id }) }, '⛔ Cerrar') : rt.status === 'cerrada' ? h('button', { class: 'btn small', onclick: () => openAction(app, 'abrirRuta', { route: rt.id, region: id }) }, '✅ Reabrir') : null;
      return h('div', { class: 'card row', style: 'display:flex;align-items:center;gap:10px' }, h('div', { style: 'flex:1' }, `Hacia ${name} `, tag), btn);
    }),
  ];
}

function tabHistory(app: App, id: number): Node[] {
  const w = app.w!;
  const r = w.regions[id];
  const entries = w.entries.filter((e) => e.known && e.regions.includes(id)).slice(-30).reverse();
  const out: Node[] = [];
  if (!r.isHome && w.intel[id].level > 0) {
    const techs = w.intel[id].facts.tecnologias;
    if (techs && techs.value !== 'nada fuera de lo común') out.push(h('p', { class: 'muted' }, `⚙ Técnicas conocidas: ${techs.value}`));
    const mine = w.entries.filter((e) => e.byPlayer && e.regions.includes(id)).length;
    out.push(h('p', { class: 'muted' }, mine ? `Has intervenido aquí ${mine} ${mine === 1 ? 'vez' : 'veces'}. Ellos lo recuerdan.` : 'Nunca has intervenido aquí.'));
  }
  if (!entries.length) out.push(empty('No conoces nada de su historia.'));
  out.push(...entries.map((e) => entryRow(w, e)));
  return out;
}

