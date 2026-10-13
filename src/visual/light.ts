import { VQ } from './quality';
/**
 * La luz del día. El sol sale por el este (izquierda), pasa alto al
 * mediodía y se pone por el oeste: las sombras son largas y frías por la
 * mañana, cortas al mediodía y largas y doradas al atardecer. Con nubes o
 * lluvia, la luz se vuelve difusa y las sombras casi desaparecen.
 */
export interface SunState {
  dx: number; // dirección de las sombras (unitaria, en el plano del suelo)
  dy: number;
  len: number; // longitud de la sombra relativa a la altura del objeto
  a: number; // opacidad de las sombras proyectadas
  warm: number; // 0..1 cuánto tiñe de oro la luz (amanecer, atardecer)
}

/** Longitud máxima de una sombra (relativa a la altura): más larga taparía media pantalla. */
export const SHADOW_MAX = 1.5;

export type DayPhase = 'madrugada' | 'mañana' | 'mediodia' | 'tarde' | 'atardecer' | 'noche';

export function dayPhase(h: number): DayPhase {
  if (h >= 4.5 && h < 7.5) return 'madrugada';
  if (h >= 7.5 && h < 11) return 'mañana';
  if (h >= 11 && h < 14.5) return 'mediodia';
  if (h >= 14.5 && h < 17.5) return 'tarde';
  if (h >= 17.5 && h < 20.5) return 'atardecer';
  return 'noche';
}

export function sunAt(h: number, weather: string): SunState {
  // Arco del sol de 6:00 a 20:00.
  const k = (h - 6) / 14;
  const up = k > 0 && k < 1;
  const elev = up ? Math.sin(k * Math.PI) : 0; // 0 horizonte … 1 cénit
  const az = up ? (k - 0.5) * 2 : 0; // -1 este … 1 oeste
  const diffuse = weather === 'nublado' || weather === 'niebla' ? 0.35 : weather === 'lluvia' || weather === 'nieve' ? 0.2 : weather === 'tormenta' ? 0.1 : 1;
  // La sombra va hacia el lado contrario del sol, y un poco hacia abajo (el sol está «detrás» de la cámara).
  const dx = -az;
  const dy = 0.42;
  const n = Math.hypot(dx, dy) || 1;
  return {
    dx: dx / n,
    dy: dy / n,
    // Un único límite para todo lo que proyecta sombra (personas, árboles, casas, objetos).
    len: up ? Math.min(SHADOW_MAX, 0.35 + (1 - elev) * 1.9) : 0,
    a: up ? Math.min(1, elev * 3) * 0.62 * diffuse : 0,
    warm: up ? Math.max(0, 1 - elev * 2.2) : 0,
  };
}

/**
 * Sombra proyectada de cualquier textura (árbol, edificio, carro): su
 * silueta se tumba en el suelo en la dirección contraria al sol. `k` es la
 * escala del objeto; `amount` la fuerza (los edificios son más opacos).
 */
export function castShadow(g: CanvasRenderingContext2D, sil: HTMLCanvasElement, w: number, h: number, ax: number, ay: number, x: number, y: number, sun: SunState, amount = 0.7, k = 1, flip = false): void {
  if (sun.a <= 0.02 || VQ().shadows === 'blob') return;
  const len = sun.len;
  g.save();
  g.globalAlpha = sun.a * amount;
  g.transform(flip ? -k : k, 0, -sun.dx * len * k, -sun.dy * len * k, x, y);
  g.drawImage(sil, -ax, -ay, w, h);
  g.restore();
}

/** Mancha de sombra de contacto (textura cacheada; sin degradados por fotograma). */
let blobTex: HTMLCanvasElement | null = null;
export function contactShadow(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a: number): void {
  if (!blobTex) {
    blobTex = document.createElement('canvas');
    blobTex.width = blobTex.height = 64;
    const bg = blobTex.getContext('2d')!;
    const gr = bg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(30,24,52,1)');
    gr.addColorStop(0.5, 'rgba(30,24,52,0.6)');
    gr.addColorStop(1, 'rgba(30,24,52,0)');
    bg.fillStyle = gr;
    bg.fillRect(0, 0, 64, 64);
  }
  const ga = g.globalAlpha;
  g.globalAlpha = ga * a;
  g.drawImage(blobTex, x - rx, y - ry, rx * 2, ry * 2);
  g.globalAlpha = ga;
}
