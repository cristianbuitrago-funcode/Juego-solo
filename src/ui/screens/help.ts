import type { App } from '../app';
import { clear, h } from '../dom';

/** Cómo jugar, en páginas cortas. */
const PAGES: [string, string, string[]][] = [
  ['🌍', 'No ves el mundo: vives en él', [
    'Eres una persona de carne y hueso en un mundo que funciona solo. Los pueblos comercian, inventan, migran, se alían y se enfrentan aunque no mires.',
    'Todo lo que haces queda en la memoria del mundo. La gente te recuerda —y recordará a tus hijos—.',
  ]],
  ['🕹', 'Moverte', [
    'Arrastra el pulgar en la mitad izquierda de la pantalla para caminar (más lejos, para correr). También puedes tocar un punto y tu personaje irá hasta allí.',
    'Pellizca para acercar o alejar la cámara. El botón 🏃 activa correr.',
    'Al acercarte a alguien o a algo aparecen las acciones: Hablar, Observar, Seguir, Entrar, Examinar…',
  ]],
  ['🔎', 'Nadie te lo cuenta todo', [
    'No hay cifras. Mira los mercados, los campos, los guardias, los rebaños. Escucha en las posadas. Habla con la gente: pueden callar, exagerar o mentir.',
    'Algunos avisos llegan como susurros a lo largo del día. Algunos sonidos —gritos, pasos, una hoguera— te invitan a desviarte del camino.',
  ]],
  ['⚖', 'Decidir en el mundo', [
    'En el almacén de tu pueblo preparas caravanas de provisiones; viajan de verdad por los caminos y tardan días en llegar.',
    'En el salón del consejo envías emisarios, cambias leyes y escuchas a los mensajeros. En tu casa duermes y velas por tu familia.',
    'Con los líderes de otros pueblos tratas en persona: comercio, mediaciones, alianzas, presiones, verdades y mentiras. En los puestos fronterizos se abren o se cierran los caminos.',
  ]],
  ['🧪', 'Experimenta y comprueba', [
    'Acompaña cualquier decisión con una hipótesis: «creo que la reserva de alimento de esta región aumentará en 3 días».',
    'Sigue explorando. Cuando venza el plazo, vuelve y míralo con tus propios ojos. A veces lo bueno trae consecuencias inesperadas.',
  ]],
  ['🌳', 'Generaciones', [
    'Tu personaje envejece. Cuando muera, alguien de tu familia tomará el relevo con tu casa, tu conocimiento, tu reputación y tus enemigos.',
    'La crónica cuenta la historia del mundo año a año. El diario (☰) guarda el mapa, la crónica, las hipótesis, la investigación, el consejo y tu linaje.',
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
