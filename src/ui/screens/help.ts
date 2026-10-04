import type { App } from '../app';
import { clear, h } from '../dom';

/** Cómo jugar, en páginas cortas. */
const PAGES: [string, string, string[]][] = [
  ['🌅', 'No sabes quién eres', [
    'Despiertas en un mundo que no recuerdas. Nadie te debe nada. Nadie sabe quién eres. Tendrás que descubrirlo.',
    'El mundo funciona solo: los pueblos comercian, inventan, migran y se enfrentan aunque no mires. No gira a tu alrededor.',
  ]],
  ['🕹', 'Moverte', [
    'Arrastra el pulgar en la mitad izquierda de la pantalla para caminar (más lejos, para correr). También puedes tocar un punto y tu personaje irá hasta allí.',
    'Al acercarte a alguien o a algo aparecen las acciones. El botón ✋ es tu cuerpo: comer, buscar comida, descansar, mirar lo que llevas.',
  ]],
  ['🍞', 'Primero, vivir', [
    'Tienes hambre y te cansas. Trabaja con los vecinos para ganar monedas y comida; come en la posada; duerme donde puedas.',
    'Haciendo cosas descubres lo que sabes hacer. Algunas cosas las sabías antes de olvidarlo todo: despertarán de golpe.',
  ]],
  ['🔱', 'Tu pasado', [
    'Un objeto, una canción, un camino, una cara: los recuerdos vuelven por fragmentos. Lo que fuiste explica algunas cosas, pero no decide quién serás.',
  ]],
  ['🏛', 'Ganarse un lugar', [
    'Quien no es nadie no decide nada. Ayuda, trabaja, gánate la confianza de un pueblo. Con el tiempo te pedirán opinión, quizá te ofrezcan un cargo… y puedes aceptarlo o no.',
    'Con voz en el consejo podrás enviar emisarios, votar leyes y tratar con otros pueblos. Puedes detenerte en cualquier punto: también vale una vida tranquila.',
  ]],
  ['🌳', 'Lo que dejas', [
    'Tu crónica cuenta tu historia. Si formas una familia, alguien seguirá cuando mueras: con su propio carácter, y libre de honrar o rechazar tu legado.',
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
