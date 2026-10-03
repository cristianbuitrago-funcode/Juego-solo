import type { App } from '../app';
import { clear, h } from '../dom';

/** Cómo jugar, en páginas cortas. */
const PAGES: [string, string, string[]][] = [
  ['🌍', 'El mundo recuerda', [
    'Guías a una pequeña civilización en un mundo que funciona por sí mismo. Las regiones comercian, inventan, migran, se alían y se enfrentan aunque no hagas nada.',
    'Cada decisión que tomas queda registrada. Los pueblos y sus personas la recuerdan, y eso cambia lo que harán mañana… o dentro de veinte días.',
  ]],
  ['🔎', 'Nunca lo sabes todo', [
    'No verás cifras de ejércitos ni de graneros. Verás pistas: «hay humo al norte», «los exploradores regresaron heridos».',
    'Los datos de cada región llevan fecha y fiabilidad: un informe de un observador (✓) o algo oído (~). La información envejece.',
    'Los rumores pueden ser ciertos, falsos o malentendidos. Investígalos, compáralos, compártelos… o inventa los tuyos.',
  ]],
  ['🧭', 'Cada día', [
    'Toca una región para ver lo que sabes, a su gente y las decisiones posibles. Mantén pulsado para un resumen rápido. Pellizca para hacer zoom.',
    'Tus emisarios son limitados: observar, espiar, mediar o investigar los ocupa varios días.',
    'Cuando estés listo, pulsa AVANZAR DÍA. El mundo procesará las consecuencias y te contará lo que llegue a tus oídos.',
  ]],
  ['🧪', 'Experimenta', [
    'Acompaña tus decisiones con una hipótesis: «creo que si ayudo a esta región, su alimento aumentará en 5 días».',
    'Al vencer el plazo sabrás si era correcta, parcial o incorrecta, y descubrirás parte de lo que ocurrió de verdad.',
    'Cierra un camino, prohíbe un recurso, favorece o abandona una región… y observa. Algunas consecuencias tardan en llegar.',
  ]],
  ['⚖', 'Conflictos sin ejércitos', [
    'Los conflictos se previenen antes de que estallen: negocia, media, comparte la verdad, presiona, cambia rutas, propón alianzas o sabotea.',
    'Tu guardia puede detener una guerra por la fuerza, pero es el último recurso: habrá muertos y el mundo aprenderá que usas lanzas.',
    'Si resuelves siempre igual, los pueblos aprenderán tu patrón y se adaptarán a él.',
  ]],
  ['★', 'Objetivos', [
    'No hay un único objetivo. Mantener la paz, tejer alianzas, cuidar la tierra, confirmar hipótesis… y otros que descubrirás jugando.',
    'Cada mundo esconde una verdad. Reúne fragmentos y formula tu conclusión.',
    'Al final de la era, el mundo te dará un nombre. Y lo recordará en las eras siguientes.',
  ]],
];

export function showHelp(app: App): void {
  let page = 0;
  const body = h('div');
  const draw = () => {
    const [ico, title, paras] = PAGES[page];
    clear(body).append(
      h('div', { style: 'font-size:44px;text-align:center' }, ico),
      h('h2', { style: 'text-align:center' }, title),
      ...paras.map((p) => h('p', { style: 'line-height:1.5' }, p)),
      h('p', { class: 'tiny', style: 'text-align:center' }, `${page + 1} / ${PAGES.length}`),
      h('div', { class: 'actions' },
        page > 0 ? h('button', { class: 'btn', onclick: () => (page--, draw()) }, 'Anterior') : null,
        page < PAGES.length - 1 ? h('button', { class: 'btn primary', onclick: () => (page++, draw()) }, 'Siguiente') : h('button', { class: 'btn primary', onclick: () => close() }, 'Empezar'),
      ),
    );
  };
  draw();
  const close = app.modal(() => [body]);
}
