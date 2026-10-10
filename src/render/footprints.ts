/**
 * Huellas del mobiliario de los pueblos, en teselas: una sola tabla para el choque del
 * jugador y de los animales (elipse `rx`×`ry`, desplazada `dy` hacia arriba desde el pie
 * del sprite), para reservar sitio al decorar la plaza (`keep`) y para no dejar al jugador
 * oculto detrás al llegar (`tall`: cuánto sube el objeto; `wide`: media anchura de lo que tapa; `front`: franja
 * delante en la que el jugador taparía a quien está detrás).
 */
export interface Footprint {
  rx: number;
  ry: number;
  dy: number;
  keep?: number;
  tall?: number;
  wide?: number;
  /** Detrás hay alguien (el vendedor del puesto): quien se para justo delante lo tapa. */
  front?: number;
}

export const FOOT: Readonly<Record<string, Footprint>> = {
  fuente: { rx: 1.85, ry: 1.25, dy: 0.2 },
  pozo: { rx: 1.3, ry: 0.7, dy: 0.2 },
  estatua: { rx: 1.2, ry: 0.65, dy: 0.15, tall: 2, wide: 0.7 },
  banco: { rx: 1.25, ry: 0.95, dy: 0.2, keep: 1.15 },
  cartel: { rx: 0.55, ry: 0.38, dy: 0.1, tall: 1.8, wide: 1.35 }, // las tablas sobresalen ~1 casilla a cada lado
  farol: { rx: 0.45, ry: 0.32, dy: 0.08, tall: 2.4, wide: 0.7 },
  barril: { rx: 0.5, ry: 0.28, dy: 0.15 },
  cajas: { rx: 0.85, ry: 0.36, dy: 0.2 },
  carro: { rx: 1.7, ry: 0.5, dy: 0.3 },
  abrevadero: { rx: 1.15, ry: 0.32, dy: 0.2 },
  heno: { rx: 0.95, ry: 0.42, dy: 0.25 },
  lenya: { rx: 0.9, ry: 0.3, dy: 0.15 },
  // Puestos del mercado y adornos de la plaza.
  // (alto: quien queda justo detrás se mete visualmente entre postes y toldo)
  puesto: { rx: 1.25, ry: 0.55, dy: 0.45, keep: 1.05, front: 1.7, tall: 2.4, wide: 1.35 }, // (el toldo sube ~3,2 casillas; tapa la cabeza de quien esté hasta ~2 detrás)
  arbol: { rx: 0.75, ry: 0.4, dy: 0.1, tall: 3.2, wide: 1.5 },
  jardinera: { rx: 0.85, ry: 0.3, dy: 0.1 },
  mesa: { rx: 1.15, ry: 0.4, dy: 0.1 },
  estandarte: { rx: 0.25, ry: 0.15, dy: 0.1, tall: 2.4, wide: 0.6 },
};

/** Radio que se reserva alrededor de un objeto al repartir los adornos de la plaza. */
export const keepOf = (kind: string): number => FOOT[kind]?.keep ?? 0.7;
