import { continueEra, eraTitle, type DayReport } from '../../core/api';
import { loadLegacy } from '../../core/legacy';
import type { App } from '../app';
import { h } from '../dom';
import { entryRow } from './common';

/** Informe del amanecer: lo que llega a tus oídos tras avanzar un día. */
const MOOD_LINES: Record<string, string> = {
  calma: 'El mundo respira tranquilo. Por ahora.',
  tension: 'Algo se tensa en el aire. Hay quien afila cuchillos.',
  crisis: 'El mundo tiembla.',
  descubrimiento: 'Hoy has entendido algo nuevo.',
};

export function showDawn(app: App, rep: DayReport): void {
  const w = app.w!;
  const entries = [...rep.entries].sort((a, b) => b.importance - a.importance).slice(0, 10);
  const results = w.hypotheses.filter((x) => x.result && x.dueDay === w.day);
  const quiet = !entries.length && !rep.clues.length && !rep.rumors.length && !rep.newPetitions;
  const close = app.modal(() => [
    h('div', { class: 'dawn' },
      h('div', { class: 'sun' }, rep.mood === 'crisis' ? '🌘' : rep.mood === 'tension' ? '🌥' : '🌅'),
      h('h2', null, `Día ${rep.day}`),
      h('div', { class: 'moodline' }, MOOD_LINES[rep.mood]),
    ),
    results.length ? h('h3', null, 'Hipótesis evaluadas') : null,
    ...results.map((hy) => h('div', { class: 'card' }, h('span', { class: `tag ${hy.result === 'correcta' ? 'good' : hy.result === 'parcial' ? 'warn' : 'bad'}` }, hy.result!.toUpperCase()), h('p', null, hy.text), h('p', { class: 'muted' }, hy.explanation ?? ''))),
    entries.length ? h('h3', null, 'Noticias') : null,
    ...entries.map((e) => entryRow(w, e)),
    rep.clues.length ? h('h3', null, 'Pistas') : null,
    ...rep.clues.map((c) => h('div', { class: 'entry', onclick: () => { close(); app.openRegion(c.regionId); } }, h('div', { class: 'ico' }, c.fragment ? '🧩' : '·'), h('div', { class: 'txt' }, c.text))),
    rep.rumors.length ? h('h3', null, 'Rumores') : null,
    ...rep.rumors.map((r) => h('div', { class: 'card' }, h('div', { class: 'tiny' }, w.regions[r.heardIn].isHome ? 'En tu hogar se comenta:' : `Región ${w.regions[r.heardIn].name}:`), h('p', { class: 'quote' }, `«${r.text}»`))),
    quiet ? h('p', { class: 'empty' }, 'Un día sin noticias. El silencio también puede significar algo.') : null,
    h('div', { class: 'actions' },
      rep.newPetitions ? h('button', { class: 'btn teal', onclick: () => { close(); app.setView('decisiones'); } }, `⚖ ${rep.newPetitions} ${rep.newPetitions === 1 ? 'petición nueva' : 'peticiones nuevas'}`) : null,
      h('button', { class: 'btn primary', onclick: () => close() }, 'Ver el mapa'),
    ),
  ]);
}

/** Final de la era (o colapso de tu civilización). */
export function showEnd(app: App): void {
  const w = app.w!;
  const title = eraTitle(w);
  const done = w.objectives.filter((o) => o.status === 'cumplido');
  const legacy = loadLegacy();
  app.modal(() => [
    h('h2', { style: 'text-align:center' }, w.outcome === 'colapso' ? 'Tu gente se ha dispersado' : 'Termina una era'),
    h('p', { class: 'lead', style: 'text-align:center' }, 'El mundo te recordará como'),
    h('div', { class: 'end-title' }, `«${title}»`),
    h('h3', null, `Objetivos cumplidos: ${done.length} de ${w.objectives.length}`),
    ...w.objectives.map((o) => h('p', null, `${o.status === 'cumplido' ? '✓' : o.status === 'fallido' ? '✗' : '·'} ${o.hidden ? 'Un objetivo que nunca descubriste' : o.title}`)),
    h('h3', null, 'Lo que el mundo recordará'),
    h('p', { class: 'muted' }, `Tus decisiones dejaron ${w.entries.filter((e) => e.byPlayer).length} huellas en la memoria del mundo. ${legacy.grudges.length ? 'Algunos rencores sobrevivirán a esta era.' : ''}`),
    h('p', { class: 'muted' }, w.mystery.solved ? 'Descubriste la verdad oculta de este mundo.' : 'La verdad oculta de este mundo quedó sin resolver.'),
    h('div', { class: 'actions' },
      w.outcome === 'era' ? h('button', { class: 'btn teal', onclick: () => { continueEra(w); app.refresh(); app.closeAll(); } }, 'Seguir 30 días más') : null,
      h('button', { class: 'btn primary', onclick: () => app.showMenu() }, 'Volver al menú'),
    ),
  ]);
}
