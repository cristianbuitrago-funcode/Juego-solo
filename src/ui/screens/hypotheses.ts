import type { App } from '../app';
import { h } from '../dom';
import { empty, section } from './common';
import { openHypothesisComposer } from './composer';

/** Sistema de hipótesis: la estrategia como experimento científico. */
export function renderHypotheses(app: App): Node[] {
  const w = app.w!;
  const active = w.hypotheses.filter((x) => !x.result).sort((a, b) => a.dueDay - b.dueDay);
  const done = w.hypotheses.filter((x) => x.result).reverse();
  const correct = done.filter((x) => x.result === 'correcta').length;
  const out: (Node | null)[] = [
    h('h2', null, 'Hipótesis'),
    h('p', { class: 'lead' }, '«Creo que si hago esto, ocurrirá aquello.» Formula predicciones, deja pasar los días y comprueba. Cada hipótesis evaluada revela algo de lo que ocurrió.'),
    h('button', { class: 'btn primary block', onclick: () => openHypothesisComposer(app) }, '🧪 Nueva hipótesis'),
    done.length ? h('p', { class: 'muted', style: 'text-align:center' }, `Aciertos: ${correct} de ${done.length}`) : null,
  ];
  out.push(section('En curso', active.length ? null : empty('Ninguna hipótesis en curso.')));
  for (const hy of active)
    out.push(h('div', { class: 'card' },
      h('p', null, hy.text),
      hy.linkedAction ? h('div', { class: 'tiny' }, `Experimento: ${hy.linkedAction}`) : null,
      hy.note ? h('p', { class: 'quote tiny' }, hy.note) : null,
      h('span', { class: 'tag info' }, hy.dueDay - w.day <= 0 ? 'Se evalúa mañana' : `Se evalúa en ${hy.dueDay - w.day} días`),
    ));
  out.push(section('Resultados', done.length ? null : empty('Todavía no hay resultados.')));
  for (const hy of done)
    out.push(h('div', { class: 'card' },
      h('div', { class: 'row', style: 'display:flex;justify-content:space-between' },
        h('b', null, `HIPÓTESIS · día ${hy.created} → ${hy.dueDay}`),
        h('span', { class: `tag ${hy.result === 'correcta' ? 'good' : hy.result === 'parcial' ? 'warn' : 'bad'}` }, hy.result!.toUpperCase())),
      h('p', null, hy.text),
      hy.note ? h('p', { class: 'quote tiny' }, hy.note) : null,
      h('p', { class: 'muted' }, hy.explanation ?? ''),
    ));
  return out.filter((x): x is Node => x !== null);
}
