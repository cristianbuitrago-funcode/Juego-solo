import { audio } from '../audio/audio';
import { appearanceOf } from '../render/appearance';
import { drawPortrait } from '../visual/figure/portrait';
import type { BondChange, TownChange } from '../world/bonds';
import type { App } from './app';
import { h, vibrate } from './dom';

/**
 * Efectos de escena de la interfaz: velos de transición (puertas, sueño, paso
 * de las horas), el destello de un golpe y los avisos de lo que cambia entre
 * el protagonista y los demás. Nada de esto decide nada: solo hace visible lo
 * que el mundo ya ha resuelto.
 */
export interface VeilOpts {
  /** iris: un círculo que se cierra; fade: fundido a negro; soft: a penumbra (pasan las horas). */
  kind: 'iris' | 'fade' | 'soft';
  /** Centro del iris, en píxeles de la escena. */
  at?: { x: number; y: number };
  ico?: string;
  title?: string;
  sub?: string;
  stars?: boolean;
  /** Cuánto se queda cerrado (ms). */
  hold?: number;
}

const CLOSE_MS = { iris: 440, fade: 520, soft: 420 };

/**
 * Cierra un velo sobre la escena, hace `mid` a cubierto y vuelve a abrirlo.
 * Mientras dura, los cuadros que se cierran no dan la visita por terminada.
 */
export function veil(app: App, o: VeilOpts, mid: () => void, after?: () => void): void {
  const stage = app.stage;
  if (!stage || app.settings.reduceMotion) {
    mid();
    after?.();
    return;
  }
  const el = h('div', { class: `veil ${o.kind === 'iris' ? 'iris' : `fade ${o.kind === 'soft' ? 'soft' : ''}`}` },
    o.stars ? h('div', { class: 'stars' }) : null,
    o.title || o.ico ? h('div', { class: 'veil-text' }, o.ico ? h('span', { class: 'veil-ico' }, o.ico) : null, o.title ? h('b', null, o.title) : null, o.sub ? h('small', null, o.sub) : null) : null,
  );
  if (o.at) el.setAttribute('style', `--ix:${((o.at.x / stage.clientWidth) * 100).toFixed(1)}%;--iy:${((o.at.y / stage.clientHeight) * 100).toFixed(1)}%`);
  el.style.pointerEvents = 'auto';
  stage.append(el);
  app.holdDialogs(1);
  const ms = CLOSE_MS[o.kind];
  // Dos fotogramas: el navegador tiene que ver el velo abierto antes de cerrarlo.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('shut')));
  window.setTimeout(() => {
    mid();
    window.setTimeout(() => {
      el.classList.remove('shut');
      el.style.pointerEvents = 'none';
      window.setTimeout(() => {
        el.remove();
        app.holdDialogs(-1);
        after?.();
      }, ms);
    }, o.hold ?? 500);
  }, ms + 40);
}

/** «Dos horas después»: cómo se dice el tiempo que se va en una tarea. */
export function timeText(minutes: number): string {
  if (minutes < 50) return 'Un rato después';
  const hrs = Math.round(minutes / 60);
  if (hrs <= 1) return 'Una hora después';
  const word = ['', '', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez', 'Once', 'Doce'][hrs] ?? String(hrs);
  return `${word} horas después`;
}

/** La pantalla acusa el golpe (o el susto de haberlo esquivado). */
export function hurtFlash(app: App, dodge = false): void {
  if (!app.stage) return;
  const el = h('div', { class: `hurt-flash ${dodge ? 'dodge' : ''}` });
  app.stage.append(el);
  window.setTimeout(() => el.remove(), 750);
  if (!dodge) vibrate(60);
}

function face(app: App, c: BondChange): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 132;
  const expr = c.good ? (c.sign === 'corazon' ? 'alivio' : 'feliz') : c.sign === 'miedo' ? 'miedo' : c.tier === 3 ? 'hostil' : 'enfadado';
  drawPortrait(cv, appearanceOf(app.w!, c.folk), expr, 1);
  return cv;
}

function card(app: App, cls: string, nodes: (Node | null)[], life: number): void {
  if (!app.stage) return;
  app.stage.querySelectorAll('.bond').forEach((b) => b.remove());
  const el = h('div', { class: `bond ${cls}` }, ...nodes);
  app.stage.append(el);
  window.setTimeout(() => el.remove(), life);
}

/**
 * Enseña lo que ha cambiado entre tú y los demás, tan fuerte como haya sido:
 * un gesto sobre la cabeza para lo pequeño; una línea con su cara para lo que
 * recordará; un cartel con sonido para lo que no va a olvidar.
 */
export function showBonds(app: App, folk: BondChange[], town: TownChange | null): void {
  const scene = app.scene;
  if (!scene || (!folk.length && !town)) return;
  // Gestos: en quienes están a la vista (los que más han cambiado primero).
  let shown = 0;
  for (const c of folk) {
    if (shown >= 5) break;
    if (scene.distanceTo(c.folk.id) > 14) continue;
    scene.emote(c.folk.id, c.sign, c.tier === 3 ? 1 : c.tier === 2 ? 0.6 : 0.25);
    shown++;
  }
  const top = folk[0];
  if (town && (!top || town.tier >= top.tier || town.count >= 6)) {
    audio.sfx(town.good ? 'lazo' : 'lazoMal', town.tier / 3);
    card(app, `${town.good ? 'good' : 'bad'} ${town.tier === 3 ? 'big' : ''}`, [h('span', { class: 'bond-ico' }, town.good ? '👥' : '🌒'), h('div', null, h('b', null, app.w!.regions[town.regionId].name), h('small', null, town.text))], town.tier === 3 ? 5400 : 4200);
    if (town.tier === 3) vibrate(30);
    return;
  }
  if (!top) return;
  // Un detalle no hace ruido; lo demás suena más cuanto más pesa.
  if (top.tier === 1) return void (shown && audio.sfx(top.good ? 'lazo' : 'lazoMal', 0.12));
  audio.sfx(top.good ? 'lazo' : 'lazoMal', top.tier === 3 ? 1 : 0.45);
  if (top.tier === 3) vibrate(30);
  card(app, `${top.good ? 'good' : 'bad'} ${top.tier === 3 ? 'big' : ''}`, [face(app, top), h('div', null, h('b', null, top.folk.name), h('small', null, top.text))], top.tier === 3 ? 5400 : 4200);
}
