import { CULTURES } from '../../core/content/cultures';
import { loadLegacy } from '../../core/legacy';
import { deleteSave, exportGame, importGame, loadGame, saveGame, SLOTS, slotInfo, type Slot } from '../../core/save';
import { audio } from '../../audio/audio';
import type { App } from '../app';
import { add, clear, h, meter } from '../dom';
import { empty } from './common';
import { showHelp } from './help';

/** Pantalla principal. */
export function renderMenu(app: App): HTMLElement {
  const auto = slotInfo('auto');
  const legacy = loadLegacy();
  return h('div', { class: 'menu' },
    h('div', { html: '<svg class="rings" viewBox="0 0 140 140"><circle cx="70" cy="70" r="68"/><circle cx="70" cy="70" r="68"/><circle cx="70" cy="70" r="68"/></svg>' }),
    h('h1', { class: 'logo' }, 'ECOS'),
    h('p', { class: 'tag' }, 'El Mundo que Recuerda'),
    auto ? h('button', { class: 'btn primary', onclick: () => app.continueGame() }, `Continuar · día ${auto.day} en ${auto.home}`) : null,
    h('button', { class: `btn ${auto ? '' : 'primary'}`, onclick: () => newGameDialog(app) }, 'Nueva partida'),
    h('button', { class: 'btn', onclick: () => savesDialog(app, false) }, 'Cargar partida'),
    h('button', { class: 'btn', onclick: () => showHelp(app) }, 'Cómo jugar'),
    legacy.games > 0 ? h('button', { class: 'btn', onclick: () => legacyDialog(app) }, `Legado (${legacy.games} ${legacy.games === 1 ? 'era' : 'eras'})`) : null,
    h('button', { class: 'btn', onclick: () => settingsDialog(app) }, 'Configuración'),
    h('p', { class: 'foot' }, 'Un experimento estratégico para un jugador. El mundo funciona sin ti; tú solo puedes influir en él.'),
  );
}

function newGameDialog(app: App): void {
  let length = 0;
  const seed = h('input', { type: 'text', placeholder: 'Semilla (opcional): una palabra cualquiera' }) as HTMLInputElement;
  const lens = h('div', { class: 'choices' });
  const drawLens = () => clear(lens).append(...([[0, 'Sin fin · generaciones'], [60, 'Una era · 60 días'], [120, 'Dos eras · 120 días']] as [number, string][]).map(([v, l]) => h('button', { class: length === v ? 'on' : '', onclick: () => ((length = v), drawLens()) }, l)));
  drawLens();
  const close = app.modal(() => [
    h('h2', null, 'Nueva partida'),
    h('p', { class: 'lead' }, 'Cada mundo es distinto: su mapa, sus pueblos, sus recuerdos y su secreto. La misma semilla genera el mismo mundo.'),
    h('div', { class: 'field' }, h('label', null, 'Semilla'), seed),
    h('div', { class: 'field' }, h('label', null, 'Duración'), lens),
    h('button', { class: 'btn primary block', onclick: () => { close(); app.newGame(seed.value, length); } }, 'Crear mundo'),
  ]);
}

export function objectivesDialog(app: App, inline = false): Node[] {
  const w = app.w!;
  const nodes = () => [
    h('h2', null, 'Objetivos'),
    h('p', { class: 'lead' }, 'No hay una única forma de ganar. Algunos objetivos solo aparecen cuando descubres lo que ocurre en el mundo.'),
    ...w.objectives.map((o) =>
      o.hidden
        ? h('div', { class: 'card flat' }, h('b', null, '??? '), h('span', { class: 'muted' }, 'Un objetivo que aún no has descubierto.'))
        : h('div', { class: 'card' },
            h('div', { class: 'row', style: 'display:flex;justify-content:space-between;gap:8px' }, h('b', null, o.title), h('span', { class: `tag ${o.status === 'cumplido' ? 'good' : o.status === 'fallido' ? 'bad' : 'info'}` }, o.status)),
            h('p', { class: 'muted' }, o.description),
            meter(o.progress),
          )),
  ];
  if (inline) return nodes();
  app.modal(() => nodes());
  return [];
}

/** Ajustes dentro del diario: configuración, guardado, ayuda y salida. */
export function renderSettingsInline(app: App): Node[] {
  return [
    h('h2', null, 'Ajustes'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => settingsDialog(app) }, '⚙ Sonido, texto y animaciones'),
      h('button', { class: 'btn', onclick: () => savesDialog(app, true) }, '💾 Guardar / cargar'),
      h('button', { class: 'btn', onclick: () => showHelp(app) }, '❔ Cómo jugar'),
      h('button', { class: 'btn', onclick: () => { app.closeDiary(); app.passTime(60); app.toast('Esperas una hora.'); } }, '⏳ Esperar una hora'),
      h('button', { class: 'btn ghost', onclick: () => { if (app.w) saveGame(app.w, 'auto'); app.showMenu(); } }, '⏏ Salir al menú principal'),
    ),
    h('p', { class: 'tiny' }, 'La partida se guarda sola cada amanecer y al salir.'),
  ];
}

export function savesDialog(app: App, inGame: boolean): void {
  const body = h('div');
  const draw = () => {
    clear(body).append(h('h2', null, inGame ? 'Guardar / cargar' : 'Cargar partida'));
    for (const slot of SLOTS) {
      const info = slotInfo(slot);
      const name = slot === 'auto' ? 'Autoguardado' : `Ranura ${slot.slice(-1)}`;
      body.append(h('div', { class: 'card' },
        h('b', null, name),
        h('div', { class: 'muted' }, info ? `Día ${info.day} · ${info.home} · ${new Date(info.savedAt).toLocaleString()}` : 'Vacía'),
        h('div', { class: 'actions' },
          inGame && slot !== 'auto' ? h('button', { class: 'btn small teal', onclick: () => { saveGame(app.w!, slot as Slot); audio.sfx('accion'); app.toast('Partida guardada.'); draw(); } }, 'Guardar aquí') : null,
          info ? h('button', { class: 'btn small', onclick: () => { const w = loadGame(slot); if (w) { closeAll(); app.start(w); } else app.toast('No se pudo cargar.', true); } }, 'Cargar') : null,
          info && slot !== 'auto' ? h('button', { class: 'btn small ghost', onclick: () => { deleteSave(slot); draw(); } }, 'Borrar') : null,
        ),
      ));
    }
    const area = h('textarea', { placeholder: 'Pega aquí una partida exportada…' }) as HTMLTextAreaElement;
    add(body,
      h('h3', null, 'Copiar entre dispositivos'),
      inGame ? h('button', { class: 'btn small block', onclick: () => { area.value = exportGame(app.w!); area.select(); void navigator.clipboard?.writeText(area.value).then(() => app.toast('Copiada al portapapeles.')).catch(() => undefined); } }, 'Exportar partida actual') : null,
      area,
      h('button', { class: 'btn small block', style: 'margin-top:8px', onclick: () => { const w = importGame(area.value); if (w) { closeAll(); app.start(w); } else app.toast('Texto no válido.', true); } }, 'Importar'),
    );
  };
  draw();
  const closeAll = app.modal(() => [body]);
}

export function settingsDialog(app: App): void {
  const s = app.settings;
  const range = (value: number, on: (v: number) => void) => {
    const r = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(value * 100)) }) as HTMLInputElement;
    r.addEventListener('input', () => { on(Number(r.value) / 100); app.saveSettings(); });
    return r;
  };
  const toggle = (label: string, desc: string, value: boolean, on: (v: boolean) => void) =>
    h('label', { class: 'switch' }, h('span', null, h('b', null, label), h('div', { class: 'tiny' }, desc)),
      h('input', { type: 'checkbox', checked: value, onchange: (e: Event) => { on((e.target as HTMLInputElement).checked); app.saveSettings(); } }));
  app.modal(() => [
    h('h2', null, 'Configuración'),
    h('div', { class: 'field' }, h('label', null, '🎵 Música ambiental'), range(s.music, (v) => (s.music = v))),
    h('div', { class: 'field' }, h('label', null, '🔔 Efectos de sonido'), range(s.sfx, (v) => (s.sfx = v))),
    toggle('Texto grande', 'Aumenta el tamaño de letra de los paneles.', s.textSize === 'grande', (v) => (s.textSize = v ? 'grande' : 'normal')),
    h('div', { class: 'field' }, h('label', null, '🖼 Calidad gráfica'),
      h('select', { onchange: (e: Event) => { s.quality = (e.target as HTMLSelectElement).value as typeof s.quality; app.saveSettings(); } },
        ...([['alta', 'Alta: máxima nitidez'], ['media', 'Media: equilibrada'], ['baja', 'Baja: menos gentío, más batería']] as const).map(([v, l]) => h('option', { value: v, selected: s.quality === v }, l)))),
    toggle('Reducir animaciones', 'Detiene el humo, los carros y los pulsos del mapa. Ahorra batería.', s.reduceMotion, (v) => (s.reduceMotion = v)),
    toggle('Vibración', 'Pequeña vibración al tomar decisiones.', s.haptics, (v) => (s.haptics = v)),
    toggle('Mostrar ayuda al empezar', 'Abre «Cómo jugar» en cada partida nueva.', s.tutorial, (v) => (s.tutorial = v)),
  ]);
}

function legacyDialog(app: App): void {
  const l = loadLegacy();
  const cn = (id: string) => CULTURES.find((c) => c.id === id)?.name ?? id;
  app.modal(() => [
    h('h2', null, 'Legado'),
    h('p', { class: 'lead' }, 'Los pueblos recuerdan incluso entre eras. Estas son las huellas que dejaste y que aparecerán en mundos futuros.'),
    h('h3', null, 'Cómo te recordaron'),
    l.titles.length ? h('div', null, ...l.titles.map((t, i) => h('p', null, `Era ${i + 1}: «${t}»`))) : empty('Aún nada.'),
    h('h3', null, 'Viejos rencores'),
    l.grudges.length ? h('div', null, ...l.grudges.map((g) => h('p', { class: 'muted' }, `Entre ${cn(g.a)} y ${cn(g.b)}: ${g.text}.`))) : empty('Ninguno.'),
    h('h3', null, 'Gratitud y agravios'),
    ...[...l.favors.map((f) => h('p', { class: 'muted' }, `${cn(f.culture)} cantan que ${f.text}.`)), ...l.wrongs.map((f) => h('p', { class: 'muted' }, `${cn(f.culture)} recuerdan que ${f.text}.`))],
  ]);
}
