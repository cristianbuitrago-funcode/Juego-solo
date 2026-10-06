/**
 * Huellas del mobiliario de los pueblos, en teselas: una sola tabla para el choque del
 * jugador y de los animales (elipse `rx`×`ry`, desplazada `dy` hacia arriba desde el pie
 * del sprite), para reservar sitio al decorar la plaza (`keep`) y para no dejar al jugador
 * oculto detrás al llegar (`tall`: cuánto sube el objeto; `wide`: media anchura de lo que tapa).
 */
export interface Footprint {
  rx: number;
  ry: number;
  dy: number;
  keep?: number;
  tall?: number;
  wide?: number;
}

export const FOOT: Readonly<Record<string, Footprint>> = {
  fuente: { rx: 1.85, ry: 1.25, dy: 0.2 },
  pozo: { rx: 1.3, ry: 0.7, dy: 0.2 },
  estatua: { rx: 1.2, ry: 0.65, dy: 0.15, tall: 2, wide: 0.7 },
  banco: { rx: 1.25, ry: 0.95, dy: 0.2, keep: 1.15 },
  cartel: { rx: 0.55, ry: 0.38, dy: 0.1, tall: 1.6, wide: 0.7 },
  farol: { rx: 0.45, ry: 0.32, dy: 0.08, tall: 2.4, wide: 0.7 },
  barril: { rx: 0.5, ry: 0.28, dy: 0.15 },
  cajas: { rx: 0.85, ry: 0.36, dy: 0.2 },
  carro: { rx: 1.7, ry: 0.5, dy: 0.3 },
  abrevadero: { rx: 1.15, ry: 0.32, dy: 0.2 },
  heno: { rx: 0.95, ry: 0.42, dy: 0.25 },
  lenya: { rx: 0.9, ry: 0.3, dy: 0.15 },
  // Puestos del mercado y adornos de la plaza.
  puesto: { rx: 1.25, ry: 0.55, dy: 0.45, keep: 1.05 },
  arbol: { rx: 0.75, ry: 0.4, dy: 0.1, tall: 3.2, wide: 1.5 },
  jardinera: { rx: 0.85, ry: 0.3, dy: 0.1 },
  mesa: { rx: 1.15, ry: 0.4, dy: 0.1 },
  estandarte: { rx: 0.25, ry: 0.15, dy: 0.1, tall: 2.4, wide: 0.6 },
};

/** Radio que se reserva alrededor de un objeto al repartir los adornos de la plaza. */
export const keepOf = (kind: string): number => FOOT[kind]?.keep ?? 0.7;
