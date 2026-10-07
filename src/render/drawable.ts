/** Algo que se dibuja ordenado por profundidad (y del pie). */
export interface Drawable {
  y: number;
  draw: () => void;
  /** Rectángulo que tapa (casas, edificios, puestos): si cubre al jugador, se le dibuja en transparencia. */
  box?: { x0: number; y0: number; x1: number; y1: number };
  /** Opacidad real en un punto del mundo (si se sabe): el rectángulo solo es la primera criba. */
  solidAt?: (x: number, y: number) => number;
}
