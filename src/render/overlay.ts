import type { WorldState } from '../core/types';
import { overheard } from '../world/gossip';
import { ensureLife } from '../world/life';
import { prologueItems } from '../world/prologue';
import type { Layout } from '../world/layout';
import { TILE, type Folk } from '../world/types';
import type { Appearance } from './appearance';
import { figureTop } from '../visual/figure/figure';
import type { Ent, Target } from './scene';

/**
 * Lo que se dibuja encima del mundo para orientarse: marcas de destino y foco,
 * nombres y bocadillos de quien habla, y flechas en el borde hacia lo que está
 * fuera de la vista. No decide nada: lee el estado de la escena.
 */
const hashOf = (str: string) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export interface OverlayHost {
  w: WorldState;
  l: Layout;
  vw: number;
  vh: number;
  reduceMotion: boolean;
  focus: Target | null;
  focusGrad: CanvasGradient | null;
  pending: Target | null;
  tapMark: { x: number; y: number; t: number } | null;
  waypoint: { x: number; y: number; label: string } | null;
  path: { x: number; y: number }[];
  converseId: string | null;
  ents: Map<string, Ent>;
  folkById: Map<string, Folk>;
  apCache: Map<string, { key: string; ap: Appearance }>;
  toScreen(x: number, y: number): { x: number; y: number };
  targetPos(t: Target): { x: number; y: number } | undefined;
}

export function drawMarkers(s: OverlayHost, g: CanvasRenderingContext2D, t: number): void {
  const life = ensureLife(s.w);
  // La caja perdida destella de vez en cuando: miel al sol.
  for (const it of prologueItems(s.w)) {
    if (it.id !== 'caja' || (!s.reduceMotion && Math.floor(t / 180) % 9 > 2)) continue;
    const X = Math.round(it.x * TILE + 5);
    const Y = Math.round(it.y * TILE - 16);
    g.fillStyle = '#fff6c8';
    g.fillRect(X, Y - 2, 1, 5);
    g.fillRect(X - 2, Y, 5, 1);
    g.fillStyle = '#ffd36a';
    g.fillRect(X, Y, 1, 1);
  }
  for (const e of life.encounters) {
    if (e.resolved) continue;
    const bob = s.reduceMotion ? 0 : Math.sin(t / 250) * 2;
    g.fillStyle = '#f3e8cf';
    g.strokeStyle = '#2b1e15';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(e.x * TILE, Math.round(e.y * TILE - 44 + bob), 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#b5562d';
    g.font = '700 8px Alegreya, Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('!', e.x * TILE, Math.round(e.y * TILE - 43.5 + bob));
  }
  // Foco: un resplandor cálido en el suelo bajo quien o lo que se puede usar (no bajo el propio jugador).
  const f = s.focus ? s.targetPos(s.focus) : undefined;
  const meP = ensureLife(s.w).player;
  if (f && Math.hypot(f.x - meP.x, f.y - meP.y) > 0.7) {
    const fx = f.x * TILE;
    const fy = f.y * TILE;
    const pulse = 0.75 + Math.sin(performance.now() / 420) * 0.25;
    g.save();
    g.translate(fx, fy);
    g.scale(1, 0.38);
    // Gradiente fijo (creado una vez); el pulso va en la opacidad.
    if (!s.focusGrad) {
      s.focusGrad = g.createRadialGradient(0, 0, 2, 0, 0, 12);
      s.focusGrad.addColorStop(0, 'rgba(255,226,150,0.42)');
      s.focusGrad.addColorStop(0.65, 'rgba(255,210,120,0.18)');
      s.focusGrad.addColorStop(1, 'rgba(255,210,120,0)');
    }
    g.globalAlpha = pulse;
    g.fillStyle = s.focusGrad;
    g.beginPath();
    g.arc(0, 0, 12, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // Destino tocado: un anillo que se abre y se apaga.
  if (s.tapMark) {
    // Se queda hasta llegar: un aro dorado que late, con contorno oscuro para verse sobre cualquier suelo.
    if (!s.path.length && !s.pending) s.tapMark = null;
    else {
      const age = ((performance.now() - s.tapMark.t) / 900) % 1;
      const r = 6 + age * 9;
      const x = s.tapMark.x * TILE;
      const y = s.tapMark.y * TILE;
      g.lineWidth = 2.2;
      g.strokeStyle = `rgba(30,20,10,${(0.45 * (1 - age)).toFixed(3)})`;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 1.2;
      g.strokeStyle = `rgba(240,205,130,${(0.95 * (1 - age)).toFixed(3)})`;
      g.stroke();
      g.fillStyle = 'rgba(240,205,130,0.85)';
      g.beginPath();
      g.ellipse(x, y, 2, 0.9, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

export function drawLabels(s: OverlayHost, g: CanvasRenderingContext2D): void {
  const w = s.w;
  const life = ensureLife(w);
  const me = life.player;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  // Nombre de las personas cercanas que ya conoces.
  for (const [id, e] of s.ents) {
    if (e.inside || Math.hypot(e.x - me.x, e.y - me.y) > 5) continue;
    const f = s.folkById.get(id);
    if (!f || f.lastMet < 0 || id === s.converseId) continue;
    const ap0 = s.apCache.get(id)?.ap;
    const p = s.toScreen(e.x * TILE, e.y * TILE - (ap0 ? figureTop(ap0) + 4 : 35));
    // Bajo la franja del HUD no se lee: el nombre se queda justo debajo de ella.
    p.y = Math.max(p.y, 78);
    g.font = '600 12px Alegreya, Georgia, serif';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(30,25,20,0.7)';
    g.strokeText(f.name, p.x, p.y);
    g.fillStyle = '#f6ecd2';
    g.fillText(f.name, p.x, p.y);
  }
  // Lo que se oye al pasar: frases sueltas de quienes charlan cerca (y gritos de quienes discuten).
  let bubbles = 0;
  const slot = Math.floor(performance.now() / 5200);
  for (const [id, e] of s.ents) {
    if (bubbles >= 2 || e.inside || !e.partner || id > e.partner || Math.hypot(e.x - me.x, e.y - me.y) > 6.5) continue;
    const a = s.folkById.get(id);
    const b = s.folkById.get(e.partner);
    const o = s.ents.get(e.partner);
    if (!a || !b || !o) continue;
    const angry = /discute|pelea/.test(e.act);
    const text = angry ? (slot % 2 ? '«¡Eso es mentira!»' : '«¡No vuelvas a hablarme así!»') : overheard(w, slot % 2 ? a : b, slot % 2 ? b : a, slot + hashOf(id));
    if (!text || (slot + hashOf(id)) % 3 === 2) continue;
    bubbles++;
    const p = s.toScreen(((e.x + o.x) / 2) * TILE, Math.min(e.y, o.y) * TILE - 46);
    g.font = 'italic 12px Alegreya, Georgia, serif';
    const wpx = Math.min(240, g.measureText(text).width + 14);
    g.fillStyle = angry ? 'rgba(120,30,25,0.82)' : 'rgba(30,25,20,0.72)';
    g.beginPath();
    g.roundRect(p.x - wpx / 2, p.y - 20, wpx, 20, 8);
    g.fill();
    g.fillStyle = '#f6ecd2';
    g.fillText(text.length > 38 ? `${text.slice(0, 36)}…»` : text, p.x, p.y - 4);
  }
  // Nombre del pueblo al acercarse a la plaza.
  for (const v of s.l.villages) {
    const d = Math.hypot(v.cx - me.x, v.cy - me.y);
    if (d > 16) continue;
    const p = s.toScreen((v.cx + 0.5) * TILE, (v.cy - v.plazaR - 1) * TILE);
    g.globalAlpha = Math.min(1, (16 - d) / 6);
    g.font = '700 17px Alegreya, Georgia, serif';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(30,25,20,0.65)';
    g.strokeText(w.regions[v.regionId].name, p.x, p.y);
    g.fillStyle = '#f3e3b5';
    g.fillText(w.regions[v.regionId].name, p.x, p.y);
    g.globalAlpha = 1;
  }
}

/** Flechas en el borde de la pantalla hacia encuentros cercanos fuera de la vista. */
export function drawEdgeArrows(s: OverlayHost, g: CanvasRenderingContext2D, t: number): void {
  const life = ensureLife(s.w);
  if (s.waypoint) {
    const wp = s.waypoint;
    const p = s.toScreen(wp.x * TILE, wp.y * TILE);
    const cx = s.vw / 2;
    const cy = s.vh / 2;
    const onScreen = p.x > 20 && p.y > 60 && p.x < s.vw - 20 && p.y < s.vh - 20;
    const a = Math.atan2(p.y - cy, p.x - cx);
    const x = onScreen ? p.x : cx + Math.cos(a) * (s.vw / 2 - 40);
    const y = onScreen ? p.y - 30 : cy + Math.sin(a) * (s.vh / 2 - 90);
    g.save();
    g.translate(x, y);
    if (!onScreen) g.rotate(a);
    g.fillStyle = '#e9b44c';
    g.strokeStyle = '#2b1e15';
    g.lineWidth = 2;
    g.beginPath();
    if (onScreen) (g.moveTo(0, 10), g.lineTo(-8, -4), g.lineTo(8, -4));
    else (g.moveTo(16, 0), g.lineTo(-8, -10), g.lineTo(-3, 0), g.lineTo(-8, 10));
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    const dist = Math.hypot(wp.x - life.player.x, wp.y - life.player.y);
    g.font = '600 12px "Alegreya Sans", system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#f6ecd2';
    g.strokeStyle = 'rgba(30,25,20,0.7)';
    g.lineWidth = 3;
    const label = `${wp.label} · ${Math.round(dist * 2)} pasos`;
    const ly = onScreen ? y - 14 : y + (Math.sin(a) > 0 ? -18 : 26);
    g.strokeText(label, x, ly);
    g.fillText(label, x, ly);
  }
  for (const e of life.encounters) {
    if (e.resolved) continue;
    const p = s.toScreen(e.x * TILE, e.y * TILE);
    if (p.x > 0 && p.y > 0 && p.x < s.vw && p.y < s.vh) continue;
    const cx = s.vw / 2;
    const cy = s.vh / 2;
    const a = Math.atan2(p.y - cy, p.x - cx);
    const r = Math.min(s.vw, s.vh) / 2 - 34;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * (s.vh / s.vw);
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.globalAlpha = 0.6 + Math.sin(t / 300) * 0.3;
    g.fillStyle = '#f3e8cf';
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(-8, -8);
    g.lineTo(-4, 0);
    g.lineTo(-8, 8);
    g.closePath();
    g.fill();
    g.restore();
    g.globalAlpha = 1;
  }
}

/**
 * Noche: una capa de oscuridad azulada con huecos donde hay luz (ventanas,
 * faroles, hogueras, tu farol) y, encima, un halo cálido aditivo.
 */
