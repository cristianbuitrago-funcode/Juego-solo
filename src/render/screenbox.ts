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

/**
 * Zona segura del HUD: cuánto debe bajar la escena (píxeles de pantalla) para que ninguna cara
 * quede bajo la franja del HUD (`band` de alto). `ys` son las caras en pantalla tal como se ven
 * ahora, con la escena ya bajada `shift`: se mide contra la posición sin bajar, no contra la de
 * ahora (si no, la cámara se paraba a medio camino y dejaba media cara tapada).
 */
export const HUD_SHIFT_MAX = 70;
export const HUD_RAMP = 24;
export function hudShiftFor(ys: readonly number[], band: number, shift: number): number {
  if (band <= 0) return 0;
  const line = band + 6;
  let want = 0;
  for (const y of ys) {
    const y0 = y - shift;
    // Solo cuentan las caras que se verían sin bajar la escena. Quien queda por encima del borde
    // de la pantalla está cortado por el marco, como siempre; contarlo era perseguir la cola: al
    // bajar entraban caras nuevas por arriba y el desplazamiento se iba siempre al tope.
    if (y0 < 0 || y0 >= line) continue;
    // En rampa: quien asoma justo por el borde pide poco y su peso crece mientras entra. Sin rampa,
    // al pasar de y0 = -1 a 0 la cámara saltaba de 0 a todo el tope de golpe.
    want = Math.max(want, (line - y0) * Math.min(1, y0 / HUD_RAMP));
  }
  return Math.min(HUD_SHIFT_MAX, want);
}
