import { audio } from '../audio/audio';
import { appearanceOf, playerAppearance, type Appearance } from '../render/appearance';
import { bodyOf } from '../visual/figure/body';
import { drawFigure } from '../visual/figure/figure';
import type { Action, Expr, Pose } from '../visual/figure/types';
import { darkness } from '../world/clock';
import { ensureLife } from '../world/life';
import type { Folk } from '../world/types';
import type { App } from './app';
import { h, vibrate } from './dom';

/**
 * Viñeta de pelea: los dos contendientes de perfil, frente a frente, cruzando
 * golpes. No decide nada: el mundo ya ha resuelto cómo acaba (si sales herido,
 * si ganas) y la viñeta lo representa golpe a golpe — quien ataca entra con el
 * peso, quien recibe se va atrás, para o esquiva; saltan chispas, tiembla el
 * cuadro y suena cada impacto. Al terminar se lee lo que ha pasado.
 */
export interface FightSetup {
  /** Tu rival: un vecino concreto (entrenar) o un soldado del pueblo enemigo (batalla). */
  foe: Folk | { regionId: number };
  /** 'palos' para un entrenamiento; 'acero' para una batalla. */
  kind: 'palos' | 'acero';
  /** Sales herido. */
  hurt: boolean;
  /** Te impones. */
  win: boolean;
}

type Beat = { who: 0 | 1; result: 'golpe' | 'parada' | 'esquiva'; final?: boolean };

const W = 360;
const H = 170;
const BEAT = 0.78; // segundos por intercambio

/** Los golpes de la pelea, según cómo acaba. */
export function choreography(hurt: boolean, win: boolean): Beat[] {
  const beats: Beat[] = [
    { who: 0, result: 'parada' },
    { who: 1, result: hurt ? 'parada' : 'esquiva' },
    { who: 0, result: 'golpe' },
    { who: 1, result: hurt ? 'golpe' : 'parada' },
  ];
  if (hurt && win) beats.push({ who: 0, result: 'parada' });
  beats.push({ who: win ? 0 : 1, result: 'golpe', final: true });
  return beats;
}

function soldier(app: App, regionId: number): Appearance {
  const f: Folk = { id: `rival:${regionId}:${app.w!.day}`, name: 'rival', regionId, role: 'guardia', age: 30, born: 0, house: 0, alive: true, trust: 0.5, fear: 0, gratitude: 0, resentment: 0, honesty: 0.5, memories: [], lastMet: -1 };
  return appearanceOf(app.w!, f);
}

const armed = (ap: Appearance, item: string): Appearance => ({ ...ap, outfit: { ...ap.outfit, item } as Appearance['outfit'] });

/** El lienzo animado de la pelea. Llama a `onEnd` cuando cae el último golpe. */
export function fightCanvas(app: App, setup: FightSetup, onEnd: () => void): HTMLCanvasElement {
  const w = app.w!;
  const life = ensureLife(w);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { class: 'fight', width: String(Math.round(W * dpr)), height: String(Math.round(H * dpr)) }) as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  const weapon = setup.kind === 'acero' ? 'espada' : 'baston';
  const aps = [armed(playerAppearance(life.player), weapon), armed('id' in setup.foe ? appearanceOf(w, setup.foe) : soldier(app, setup.foe.regionId), weapon)];
  const beats = choreography(setup.hurt, setup.win);
  const night = darkness(life.clock) > 0.4;
  const reduce = app.settings.reduceMotion;
  const total = 0.5 + beats.length * BEAT + 0.9;
  const sparks: { x: number; y: number; vx: number; vy: number; t: number; color: string }[] = [];
  const dust: { x: number; y: number; t: number }[] = [];
  let fired = -1;
  let shake = 0;
  let ended = false;
  const t0 = performance.now();
  const ground = H - 26;
  const home = [W * 0.36, W * 0.64];

  const backdrop = (t: number) => {
    const sky = g.createLinearGradient(0, 0, 0, ground);
    if (night) (sky.addColorStop(0, '#0f1626'), sky.addColorStop(1, '#2a2f44'));
    else if (setup.kind === 'acero') (sky.addColorStop(0, '#5b4a45'), sky.addColorStop(1, '#c79a6a'));
    else (sky.addColorStop(0, '#8fb3c9'), sky.addColorStop(1, '#e6d9b8'));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, ground);
    // Lejos: lomas y, en la batalla, lanzas y estandartes de los dos bandos; en el patio, la empalizada.
    g.fillStyle = night ? '#1a2030' : setup.kind === 'acero' ? '#6e5547' : '#9fb08a';
    g.beginPath();
    g.moveTo(0, ground);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, ground - 34 - Math.sin(x * 0.021) * 12 - Math.sin(x * 0.05 + 2) * 5);
    g.lineTo(W, ground);
    g.fill();
    if (setup.kind === 'acero') {
      g.strokeStyle = night ? '#0c0f18' : '#3a2c26';
      g.lineWidth = 1.2;
      for (let i = 0; i < 26; i++) {
        const side = i < 13 ? 0 : 1;
        const x = side ? W - 8 - (i - 13) * 9 : 8 + i * 9;
        const sway = Math.sin(t * 1.3 + i) * 1.5;
        g.beginPath();
        g.moveTo(x, ground - 20);
        g.lineTo(x + sway, ground - 52 - (i % 3) * 5);
        g.stroke();
        if (i % 6 === 2) {
          g.fillStyle = side ? '#7a2b22' : '#2f5a6b';
          g.fillRect(x + sway, ground - 62, side ? -11 : 11, 7 + Math.sin(t * 3 + i));
        }
      }
      g.fillStyle = night ? '#0c0f18' : '#3a2c26';
      for (let i = 0; i < 26; i++) g.fillRect((i < 13 ? 4 + i * 9 : W - 12 - (i - 13) * 9), ground - 30, 7, 12);
    } else {
      g.fillStyle = night ? '#141821' : '#7a5a3c';
      for (let x = 6; x < W; x += 15) {
        g.beginPath();
        g.moveTo(x, ground);
        g.lineTo(x, ground - 30 - ((x * 7) % 5));
        g.lineTo(x + 5, ground - 37 - ((x * 7) % 5));
        g.lineTo(x + 10, ground - 30 - ((x * 7) % 5));
        g.lineTo(x + 10, ground);
        g.fill();
      }
    }
    const gr = g.createLinearGradient(0, ground - 4, 0, H);
    gr.addColorStop(0, night ? '#2b2a26' : setup.kind === 'acero' ? '#6b5a3e' : '#a08a5c');
    gr.addColorStop(1, night ? '#15130f' : '#4c3d28');
    g.fillStyle = gr;
    g.fillRect(0, ground - 4, W, H - ground + 4);
  };

  const paint = (now: number) => {
    const t = reduce ? total : (now - t0) / 1000;
    const bt = (t - 0.5) / BEAT;
    const bi = Math.min(beats.length - 1, Math.max(0, Math.floor(bt)));
    const beat = bt >= 0 && bt < beats.length ? beats[bi] : null;
    const p = beat ? bt - bi : 0; // 0..1 dentro del intercambio
    const over = bt >= beats.length;
    const last = beats[beats.length - 1];
    // El instante del impacto: sonido, chispas y sacudida, una vez por golpe.
    if (beat && p > 0.42 && fired < bi) {
      fired = bi;
      const hitX = (home[0] + home[1]) / 2 + (beat.who ? -14 : 14);
      const hitY = ground - 58;
      if (beat.result === 'golpe') {
        audio.sfx('golpe', beat.final ? 1 : 0.7);
        shake = beat.final ? 9 : 6;
        if (beat.who === 1) vibrate(beat.final ? 60 : 30);
        for (let i = 0; i < 16; i++) sparks.push({ x: hitX, y: hitY, vx: (Math.random() - 0.5) * 5 + (beat.who ? -1.5 : 1.5), vy: -Math.random() * 3.5, t, color: setup.kind === 'acero' ? '#c8301e' : '#f1d9a0' });
      } else if (beat.result === 'parada') {
        audio.sfx('choque', setup.kind === 'acero' ? 1 : 0.5);
        if (setup.kind === 'palos') audio.sfx('paso', 1.4);
        shake = 3;
        for (let i = 0; i < 10; i++) sparks.push({ x: (home[0] + home[1]) / 2, y: hitY - 8, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 4, t, color: setup.kind === 'acero' ? '#ffe9a8' : '#e8d2a2' });
      } else {
        audio.sfx('esquiva');
        for (let i = 0; i < 4; i++) dust.push({ x: home[1 - beat.who] + (beat.who ? -8 : 8) * i * 0.4, y: ground, t });
      }
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    shake = shake > 0.3 ? shake * 0.84 : 0;
    g.translate(sx, sy);
    backdrop(t);
    // Los dos contendientes.
    for (const who of [0, 1] as const) {
      const ap = aps[who];
      const B = bodyOf(ap);
      const k = 96 / B.H;
      const dir = who ? -1 : 1;
      let x = home[who];
      let action: Action = 'fight';
      let expr: Expr = 'enfadado';
      let phase = 0.62 + Math.sin(t * 3 + who * 2) * 0.03; // en guardia
      let alpha = 1;
      // Entran al cuadro desde los lados.
      if (t < 0.5) x -= dir * (1 - t / 0.5) ** 2 * 90;
      if (beat) {
        const lunge = p < 0.42 ? (p / 0.42) ** 2 : 1 - (p - 0.42) / 0.58;
        if (beat.who === who) {
          x += dir * lunge * 30;
          phase = p < 0.42 ? 0.72 + (p / 0.42) * 0.48 : 0.2 + (p - 0.42) * 0.7; // carga el brazo y descarga en el impacto
        } else if (p > 0.38) {
          const r = Math.min(1, (p - 0.38) / 0.2);
          const back = Math.sin(Math.min(1, (p - 0.38) / 0.62) * Math.PI);
          if (beat.result === 'golpe') (action = 'hurt'), (expr = 'miedo'), (x -= dir * (beat.final ? r * 30 : back * 16));
          else if (beat.result === 'esquiva') (action = 'dodge'), (expr = 'sorpresa'), (x -= dir * back * 26);
          else (x -= dir * back * 7), (phase = 0.3);
        }
      }
      if (over) {
        const q = Math.min(1, (bt - beats.length) / 0.9);
        if (last.who === who) (action = q > 0.25 ? 'celebrate' : 'fight'), (expr = 'feliz');
        else (action = 'hurt'), (expr = 'triste'), (x -= dir * (30 + q * 34)), (alpha = 1 - q * 0.55);
      }
      const seedFrac = (ap.seed * 0.1) % 1;
      const pose: Pose = { facing: 'side', flip: who === 1, phase: 0, action, t: action === 'fight' ? (phase - seedFrac + 2) / 2.2 : t, expr, lod: 0 };
      // Sombra a los pies.
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(x, ground + 1, 20, 4.5, 0, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.globalAlpha = alpha;
      g.translate(x, ground);
      g.scale(k, k);
      drawFigure(g, ap, pose, 0, 0, { res: k * dpr });
      g.restore();
    }
    // Polvo de las esquivas y chispas de los golpes.
    for (const d of dust) {
      const a = (t - d.t) / 0.6;
      if (a > 1) continue;
      g.fillStyle = `rgba(210,190,150,${(0.5 * (1 - a)).toFixed(2)})`;
      g.beginPath();
      g.arc(d.x, d.y - a * 10, 5 + a * 9, 0, Math.PI * 2);
      g.fill();
    }
    g.lineCap = 'round';
    for (const s of sparks) {
      const a = (t - s.t) / 0.45;
      if (a > 1) continue;
      const px = s.x + s.vx * a * 22;
      const py = s.y + s.vy * a * 22 + a * a * 30;
      g.strokeStyle = s.color;
      g.globalAlpha = 1 - a;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px - s.vx * 2.4, py - s.vy * 2.4);
      g.stroke();
    }
    g.globalAlpha = 1;
    // Destello blanco en el instante del golpe final.
    if (beat?.final && p > 0.42 && p < 0.6) {
      g.fillStyle = `rgba(255,245,220,${(0.5 * (1 - (p - 0.42) / 0.18)).toFixed(2)})`;
      g.fillRect(-10, -10, W + 20, H + 20);
    }
    // Viñeta.
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(10,6,4,0.5)');
    g.fillStyle = v;
    g.fillRect(-10, -10, W + 20, H + 20);
    if (t >= total - 0.5 && !ended) {
      ended = true;
      onEnd();
    }
    if (c.isConnected || now - t0 < 600) requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
  return c;
}

/** Abre un cuadro con la pelea; al acabar, cuenta lo que ha pasado. */
export function fightDialog(app: App, title: string, setup: FightSetup, lines: string[], then: () => void): void {
  const body = h('div', { class: 'fight-body waiting' }, ...lines.map((l) => h('p', { class: l.startsWith('«') ? 'quote' : '' }, l)));
  let close = () => {};
  const done = h('div', { class: 'dlg-choices' }, h('button', { class: 'btn teal', onclick: () => (audio.sfx('elegir'), close(), then()) }, 'Seguir'));
  body.append(done);
  const canvas = fightCanvas(app, setup, () => body.classList.remove('waiting'));
  close = app.modal(() => [canvas, h('div', { class: 'dlg-head' }, h('h2', null, title)), body], { cls: 'dialog with-fight has-exit' });
}
