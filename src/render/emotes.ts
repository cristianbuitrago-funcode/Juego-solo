import { ensureLife } from '../world/life';
import { TILE } from '../world/types';
import type { WorldState } from '../core/types';
import type { Appearance } from './appearance';
import { figureTop } from '../visual/figure/figure';
import type { Ent } from './scene';

/**
 * Gestos sobre la cabeza: lo que alguien siente en un momento concreto, dibujado
 * en un bocadillo pequeño que salta, se queda un instante y se va. Es la forma
 * de ver, sin texto, que algo ha cambiado entre tú y esa persona. La fuerza
 * (0..1) manda en el tamaño y en lo que dura: un detalle apenas se nota; una
 * traición se ve desde el otro lado de la plaza.
 */
export type EmoteKind = 'corazon' | 'agrado' | 'enfado' | 'miedo' | 'sorpresa' | 'duda' | 'puntos' | 'desagrado' | 'golpe' | 'nota';

export interface Emote {
  /** Identificador del vecino, o '@player'. */
  who: string;
  kind: EmoteKind;
  strength: number;
  start: number;
  dur: number;
}

export interface EmoteHost {
  w: WorldState;
  ents: Map<string, Ent>;
  apCache: Map<string, { key: string; ap: Appearance }>;
  emotes: Emote[];
  reduceMotion: boolean;
  toScreen(x: number, y: number): { x: number; y: number };
}

export function addEmote(s: EmoteHost, who: string, kind: EmoteKind, strength = 0.5): void {
  const now = performance.now();
  // Uno por persona: el nuevo sustituye al que hubiera.
  s.emotes = s.emotes.filter((e) => e.who !== who);
  s.emotes.push({ who, kind, strength: Math.max(0.15, Math.min(1, strength)), start: now, dur: 1500 + strength * 1600 });
  if (s.emotes.length > 12) s.emotes.shift();
}

const easeOutBack = (x: number) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);

export function drawEmotes(s: EmoteHost, g: CanvasRenderingContext2D): void {
  if (!s.emotes.length) return;
  const now = performance.now();
  s.emotes = s.emotes.filter((e) => now - e.start < e.dur);
  const me = ensureLife(s.w).player;
  for (const e of s.emotes) {
    const ent = e.who === '@player' ? undefined : s.ents.get(e.who);
    if (e.who !== '@player' && (!ent || ent.inside)) continue;
    const wx = ent ? ent.x : me.x;
    const wy = ent ? ent.y : me.y;
    const ap = s.apCache.get(e.who)?.ap;
    const top = ap ? figureTop(ap) + 12 : 44;
    const p = s.toScreen(wx * TILE, wy * TILE - top);
    const age = (now - e.start) / e.dur;
    const inK = s.reduceMotion ? 1 : easeOutBack(Math.min(1, (now - e.start) / 260));
    const out = age > 0.8 ? (age - 0.8) / 0.2 : 0;
    const size = 15 + e.strength * 13;
    const bob = s.reduceMotion ? 0 : Math.sin((now - e.start) / 190) * 1.6 * (1 - out);
    g.save();
    g.translate(p.x, Math.max(70, p.y) + bob - out * 12);
    g.scale(inK, inK);
    g.globalAlpha = 1 - out;
    bubble(g, size);
    icon(g, e.kind, size * 0.56, (now - e.start) / 1000, e.strength);
    g.restore();
  }
}

/** Bocadillo de color hueso con rabito, centrado encima del origen. */
function bubble(g: CanvasRenderingContext2D, r: number): void {
  g.translate(0, -r - 5);
  g.fillStyle = 'rgba(20,14,9,0.35)';
  g.beginPath();
  g.arc(1, 2, r + 1, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f6ecd2';
  g.strokeStyle = '#3a2a1c';
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(0, 0, r, Math.PI * 0.62, Math.PI * 0.38);
  g.lineTo(0, r + 6);
  g.closePath();
  g.fill();
  g.stroke();
}

function icon(g: CanvasRenderingContext2D, kind: EmoteKind, r: number, t: number, strength: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (kind) {
    case 'corazon': {
      const beat = 1 + Math.sin(t * 9) * 0.08 * (0.5 + strength);
      g.scale(beat, beat);
      g.fillStyle = '#c8402f';
      g.beginPath();
      g.moveTo(0, r * 0.85);
      g.bezierCurveTo(-r * 1.5, -r * 0.2, -r * 0.7, -r * 1.1, 0, -r * 0.35);
      g.bezierCurveTo(r * 0.7, -r * 1.1, r * 1.5, -r * 0.2, 0, r * 0.85);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.ellipse(-r * 0.42, -r * 0.32, r * 0.2, r * 0.13, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'agrado': {
      // Una sonrisa: dos ojos cerrados y la boca en arco.
      g.strokeStyle = '#3f7a48';
      g.lineWidth = r * 0.24;
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.arc(sx * r * 0.45, -r * 0.2, r * 0.24, Math.PI, 0);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, r * 0.05, r * 0.62, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      break;
    }
    case 'enfado': {
      // La vena hinchada de los tebeos: cuatro arcos que no llegan a tocarse.
      const k = 1 + Math.sin(t * 16) * 0.07;
      g.scale(k, k);
      g.strokeStyle = '#b3261a';
      g.lineWidth = r * 0.3;
      for (let i = 0; i < 4; i++) {
        g.save();
        g.rotate((i * Math.PI) / 2);
        g.beginPath();
        g.arc(r * 0.78, r * 0.78, r * 0.52, Math.PI, Math.PI * 1.5);
        g.stroke();
        g.restore();
      }
      break;
    }
    case 'miedo': {
      // Gotas de sudor que caen.
      g.fillStyle = '#4f8fc4';
      for (let i = 0; i < 3; i++) {
        const fall = ((t * 1.6 + i * 0.33) % 1) * r * 0.5;
        const x = (i - 1) * r * 0.62;
        const y = -r * 0.25 + fall + (i === 1 ? r * 0.15 : 0);
        g.beginPath();
        g.moveTo(x, y - r * 0.5);
        g.quadraticCurveTo(x + r * 0.34, y + r * 0.1, x, y + r * 0.3);
        g.quadraticCurveTo(x - r * 0.34, y + r * 0.1, x, y - r * 0.5);
        g.fill();
      }
      break;
    }
    case 'sorpresa':
    case 'duda': {
      g.fillStyle = kind === 'sorpresa' ? '#b3261a' : '#2f6f73';
      g.font = `700 ${Math.round(r * 2.3)}px Alegreya, Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind === 'sorpresa' ? '!' : '?', 0, r * 0.12);
      break;
    }
    case 'puntos': {
      g.fillStyle = '#5a4a3a';
      for (let i = 0; i < 3; i++) {
        const on = Math.floor(t * 3) % 4 > i ? 1 : 0.3;
        g.globalAlpha *= on;
        g.beginPath();
        g.arc((i - 1) * r * 0.62, 0, r * 0.2, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha /= on;
      }
      break;
    }
    case 'desagrado': {
      // Un garabato: el humo negro de quien refunfuña.
      g.strokeStyle = '#4a3a30';
      g.lineWidth = r * 0.22;
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 4.2 + t * 2;
        const rr = r * (0.18 + (i / 40) * 0.72);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.8;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      break;
    }
    case 'golpe': {
      g.fillStyle = '#e0a020';
      g.strokeStyle = '#8a2a12';
      g.lineWidth = r * 0.14;
      g.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const rr = i % 2 ? r * 0.48 : r * 1.02;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    case 'nota': {
      g.fillStyle = '#3a2a1c';
      g.strokeStyle = '#3a2a1c';
      g.lineWidth = r * 0.2;
      g.rotate(Math.sin(t * 5) * 0.15);
      g.beginPath();
      g.ellipse(-r * 0.3, r * 0.5, r * 0.36, r * 0.26, -0.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(r * 0.03, r * 0.45);
      g.lineTo(r * 0.03, -r * 0.75);
      g.quadraticCurveTo(r * 0.6, -r * 0.6, r * 0.6, -r * 0.05);
      g.stroke();
      break;
    }
  }
}
