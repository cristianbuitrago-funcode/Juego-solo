import type { WorldState } from '../core/types';
import { hourOf } from '../world/clock';
import { ensureLife } from '../world/life';

/** Bandadas de pájaros que cruzan la vista de día y con buen tiempo, con su sombra en el suelo. */
export interface Bird {
  x: number;
  y: number;
  vx: number;
  ph: number;
}

export interface BirdsHost {
  w: WorldState;
  birds: Bird[];
  cam: { x: number; y: number; z: number };
  vw: number;
  vh: number;
  reduceMotion: boolean;
  readonly low: boolean;
  weatherHere(): string;
}

export function moveBirds(s: BirdsHost, dt: number): void {
  const h = hourOf(ensureLife(s.w).clock);
  const weather = s.weatherHere();
  const want = s.reduceMotion || s.low || h < 6.5 || h > 20 || weather === 'lluvia' || weather === 'tormenta' || weather === 'nieve' ? 0 : 7;
  const vw = s.vw / s.cam.z;
  const vh = s.vh / s.cam.z;
  s.birds = s.birds.filter((b) => Math.abs(b.x - s.cam.x) < vw && Math.abs(b.y - s.cam.y) < vh);
  // Una bandada de vez en cuando, no una nube constante sobre la gente.
  if (s.birds.length < want && Math.random() < dt * 0.12) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y0 = s.cam.y - vh * 0.4 + Math.random() * vh * 0.5;
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) s.birds.push({ x: s.cam.x - dir * (vw * 0.55 + i * 14), y: y0 + (i % 2) * 9 + i * 4, vx: dir * (55 + Math.random() * 10), ph: Math.random() * 6 });
  }
  for (const b of s.birds) {
    b.x += b.vx * dt;
    b.y += Math.sin(b.ph + b.x / 60) * 0.2;
    b.ph += dt * 11;
  }
}

export function drawBirds(s: BirdsHost, g: CanvasRenderingContext2D): void {
  if (!s.birds.length) return;
  // Vuelan alto: su sombra cae lejos, en el suelo, y eso dice que están en el aire.
  g.fillStyle = 'rgba(20,16,24,0.16)';
  for (const b of s.birds) {
    g.beginPath();
    g.ellipse(b.x + 10, b.y + 26, 2.2, 0.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Algo atenuadas por la distancia (están en lo alto), para no leerse como flechas.
  g.strokeStyle = 'rgba(52,46,50,0.6)';
  g.fillStyle = 'rgba(52,46,50,0.62)';
  g.lineWidth = 0.7;
  for (const b of s.birds) {
    // Silueta de ave, no una «m»: cuerpo fusiforme con cola y alas rellenas que baten.
    const k = Math.sin(b.ph);
    const tip = -k * 2.2;
    g.beginPath();
    g.ellipse(b.x, b.y + 0.2, 1.5, 0.6, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(b.x - 1.3, b.y + 0.2);
    g.lineTo(b.x - 2.6, b.y - 0.2);
    g.lineTo(b.x - 2.6, b.y + 0.8);
    g.closePath();
    g.fill();
    // Vistas desde arriba, las alas se abren a ambos lados del cuerpo y se acortan al batir.
    const span = 1.2 + Math.abs(Math.cos(b.ph)) * 2.4;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(b.x - 0.5, b.y + 0.2);
      g.quadraticCurveTo(b.x - 0.2, b.y + 0.2 + sgn * span * 0.7, b.x + 0.9 + tip * 0.1, b.y + 0.2 + sgn * span);
      g.quadraticCurveTo(b.x + 0.9, b.y + 0.2 + sgn * span * 0.4, b.x + 0.7, b.y + 0.2);
      g.closePath();
      g.fill();
    }
  }
}
