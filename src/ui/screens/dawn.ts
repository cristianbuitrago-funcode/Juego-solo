import { continueEra, eraTitle } from '../../core/api';
import { loadLegacy } from '../../core/legacy';
import type { App } from '../app';
import { h } from '../dom';

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
