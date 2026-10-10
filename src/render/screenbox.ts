/**
 * Lo que ocupa cada cosa EN PANTALLA (en casillas, con «y» hacia abajo), no en el suelo: una
 * persona mide unas 2 casillas de alto y un farol o un puesto suben desde su pie. Sirve para
 * comprobar sin dibujar que nada tapa la cara de nadie.
 */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** El pie (para saber quién va delante: se dibuja después quien tiene el pie más abajo). */
  foot: number;
}

export const FIGURE_H = 1.9;
export const FIGURE_HALF = 0.32;

export function figureBox(x: number, y: number): Box {
  return { x0: x - FIGURE_HALF, x1: x + FIGURE_HALF, y0: y - FIGURE_H, y1: y, foot: y };
}

export function objectBox(x: number, y: number, half: number, tall: number): Box {
  return { x0: x - half, x1: x + half, y0: y - tall, y1: y, foot: y };
}

/** ¿Tapa `front` la cabeza (el tercio de arriba) de `back`? Solo si se dibuja después (pie más abajo). */
export function coversHead(front: Box, back: Box): boolean {
  if (front.foot <= back.foot) return false;
  const headY1 = back.y0 + (back.y1 - back.y0) * 0.33;
  return front.x0 < back.x1 && front.x1 > back.x0 && front.y0 < headY1 && front.y1 > back.y0;
}
