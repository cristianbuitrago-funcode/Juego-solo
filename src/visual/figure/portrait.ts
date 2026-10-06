import type { Appearance } from '../../render/appearance';
import { bodyOf } from './body';
import { drawFigure } from './figure';
import type { Expr } from './types';

/**
 * Retrato de diálogo: la misma persona del mundo, encuadrada de pecho para
 * arriba con luz de estudio cálida, fondo con el color de su tierra y la
 * expresión de lo que siente. Respira y parpadea mientras se habla.
 */
export function drawPortrait(canvas: HTMLCanvasElement, ap: Appearance, expr: Expr, t = 0, bg = '#3a2e26', talking = false): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // Fondo: degradado radial con un halo de luz detrás de la cabeza.
  const gr = g.createRadialGradient(W * 0.42, H * 0.38, W * 0.05, W / 2, H / 2, W * 0.75);
  gr.addColorStop(0, '#d8c39a');
  gr.addColorStop(0.55, bg);
  gr.addColorStop(1, '#14100e');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  const B = bodyOf(ap);
  // Escala: la cabeza ocupa ~40 % del alto; el pecho asoma abajo.
  const k = (H * 0.4) / B.head;
  const headCenter = B.H - B.head * 0.5;
  g.setTransform(k, 0, 0, k, W / 2, H * 0.4 + headCenter * k);
  drawFigure(g, ap, { facing: 'front', flip: false, phase: 0, action: talking ? 'talk' : 'idle', t, expr, lod: 0 }, 0, 0, { res: k });
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Luz de borde y viñeta.
  const v = g.createRadialGradient(W / 2, H * 0.45, W * 0.3, W / 2, H * 0.5, W * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(10,6,4,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}
