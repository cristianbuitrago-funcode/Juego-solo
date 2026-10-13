import { iconSvg } from '../icons';

/**
 * Iconos del mapa pintados con la misma tinta que el resto de la interfaz (los SVG
 * propios), sobre un medallón de pergamino. Antes eran emojis del sistema: cada móvil
 * los dibujaba a su manera y desentonaban con el papel.
 */
const cache = new Map<string, HTMLImageElement | null>();
let ready: (() => void) | null = null;

/** Lo que hay que hacer cuando termina de cargar un icono (repintar el mapa). */
export function onInkIconReady(f: (() => void) | null): void {
  ready = f;
}

function imageOf(emoji: string): HTMLImageElement | null {
  if (cache.has(emoji)) return cache.get(emoji)!;
  const svg = iconSvg(emoji);
  if (!svg) {
    cache.set(emoji, null);
    return null;
  }
  const img = new Image();
  img.onload = () => ready?.();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(emoji, img);
  return img;
}

/** Un icono en su medallón, centrado en (x, y). */
export function drawInkIcon(g: CanvasRenderingContext2D, emoji: string, x: number, y: number, size = 18, medallion = true): void {
  const img = imageOf(emoji);
  if (medallion) {
    g.fillStyle = 'rgba(244,233,206,0.94)';
    g.strokeStyle = 'rgba(43,30,21,0.75)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(x, y, size * 0.68, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  if (img && img.complete && img.naturalWidth > 0) g.drawImage(img, x - size / 2, y - size / 2, size, size);
}

/** Varios iconos en fila, centrados en (x, y). */
export function drawInkRow(g: CanvasRenderingContext2D, emojis: string[], x: number, y: number, size = 18): void {
  const step = size * 1.5;
  const x0 = x - ((emojis.length - 1) * step) / 2;
  emojis.forEach((e, i) => drawInkIcon(g, e, x0 + i * step, y, size));
}
