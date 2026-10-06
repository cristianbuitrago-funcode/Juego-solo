import { createWorld } from '../core/gen/worldgen';
import { ensureLife } from '../world/life';
import type { Folk, FolkRole } from '../world/types';
import { appearanceOf, playerAppearance } from './appearance';
import { drawFigure, drawFigureShadow } from '../visual/figure/figure';
import type { Action, Expr, Facing, Pose } from '../visual/figure/types';
import { setTier } from '../visual/quality';
import { bodyOf } from '../visual/figure/body';

/**
 * Galería de dirección de arte (abre la app con #galeria). Personas de
 * varias regiones, oficios y edades, en sus tres vistas, con todas las
 * expresiones y acciones, para revisar proporciones, rostros y vestuario
 * sin tener que buscarlos por el mundo. La usan las revisiones visuales.
 */
export function showGallery(root: HTMLElement): void {
  setTier((new URLSearchParams(location.search).get('q') as 'high') ?? 'high');
  const w = createWorld(4242, { eraLength: 0 });
  const life = ensureLife(w);
  root.innerHTML = '';
  root.style.overflow = 'auto';
  root.style.background = '#1d1a17';
  const c = document.createElement('canvas');
  const W = 1600;
  const H = 2600;
  c.width = W;
  c.height = H;
  c.style.width = `${W / 2}px`;
  root.append(c);
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#a9b98a');
  bg.addColorStop(1, '#7f9466');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const pose = (p: Partial<Pose>): Pose => ({ facing: 'front', flip: false, phase: 0, action: 'idle', t: 0.6, expr: 'neutral', lod: 0, ...p });
  const label = (text: string, x: number, y: number) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.font = '600 22px Georgia';
    g.fillStyle = '#1d1a17';
    g.fillText(text, x, y);
  };
  const fig = (ap: ReturnType<typeof appearanceOf>, p: Pose, x: number, y: number, k: number) => {
    g.setTransform(k, 0, 0, k, x, y);
    drawFigureShadow(g, ap, 0, 0, { dx: 0.8, dy: 0.35, len: 0.7, a: 0.5 });
    drawFigure(g, ap, p, 0, 0, { res: k * Math.min(3, window.devicePixelRatio || 1) });
  };
  const folk = (id: string, role: FolkRole, age: number, regionId: number, gender?: 'f' | 'm'): Folk => ({ id, name: id, regionId, role, age, born: 0, house: 0, alive: true, trust: 0.5, fear: 0, gratitude: 0, resentment: 0, honesty: 0.5, memories: [], lastMet: -1, gender });
  // Fila 1: oficios de varias regiones, de frente.
  const roles: FolkRole[] = ['campesino', 'comerciante', 'guardia', 'artesano', 'pescador', 'sanadora', 'lider', 'pastor', 'minero', 'posadero', 'exploradora', 'anciano'];
  label('Oficios y regiones', 20, 40);
  roles.forEach((role, i) => fig(appearanceOf(w, folk(`g${i}`, role, role === 'anciano' ? 72 : 24 + (i * 7) % 30, i % w.regions.length)), pose({ t: i }), 70 + i * 128, 290, 6.2));
  // Fila 2: el protagonista en tres vistas y caminando.
  const me = playerAppearance(life.player);
  label('Protagonista: vistas y marcha', 20, 350);
  (['front', 'side', 'back'] as Facing[]).forEach((f, i) => fig(me, pose({ facing: f }), 90 + i * 150, 600, 7));
  for (let i = 0; i < 6; i++) fig(me, pose({ facing: 'side', action: 'walk', phase: (i / 6) * Math.PI * 2 }), 560 + i * 120, 600, 7);
  // Fila 3: expresiones (primer plano).
  const exprs: Expr[] = ['neutral', 'feliz', 'triste', 'miedo', 'enfadado', 'sorpresa', 'preocupado', 'cansado', 'confiado', 'desconfianza', 'alivio', 'hostil'];
  label('Expresiones', 20, 660);
  const face = appearanceOf(w, folk('cara', 'comerciante', 34, 2, 'f'));
  const FB = bodyOf(face);
  const k = 24;
  exprs.forEach((e, i) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.save();
    g.beginPath();
    g.rect(14 + i * 131, 676, 125, 160);
    g.clip();
    // Primer plano: el centro de la cabeza queda a media altura del recuadro.
    fig(face, pose({ expr: e, t: 0.6 }), 76 + i * 131, 752 + (FB.H - FB.head * 0.5) * k, k);
    g.restore();
    label(e, 20 + i * 131, 858);
  });
  // Fila 4: edades.
  label('Edades: niño, adolescente, joven, adulto, mayor, anciano', 20, 900);
  const ages = [7, 15, 22, 40, 58, 78];
  ages.forEach((a, i) => {
    fig(appearanceOf(w, folk(`edad${i % 2}`, a < 14 ? 'nino' : a > 70 ? 'anciano' : 'campesino', a, 1, i % 2 ? 'f' : 'm')), pose({}), 90 + i * 150, 1170, 6.5);
    fig(appearanceOf(w, folk(`edadb${i}`, a < 14 ? 'nino' : a > 70 ? 'anciano' : 'artesano', a, 3, i % 2 ? 'm' : 'f')), pose({ facing: 'side' }), 980 + i * 100, 1170, 5.2);
  });
  // Fila 5: acciones.
  const acts: Action[] = ['run', 'work', 'hammer', 'sit', 'talk', 'wave', 'cross', 'carry', 'eat', 'cry', 'celebrate', 'fight', 'argue', 'sleep', 'point', 'fish'];
  label('Acciones', 20, 1240);
  const worker = appearanceOf(w, folk('acc', 'campesino', 30, 0, 'm'));
  acts.forEach((a, i) => {
    const x = 70 + (i % 8) * 190;
    const y = 1500 + Math.floor(i / 8) * 330;
    fig(worker, pose({ action: a, facing: i % 3 === 0 ? 'front' : 'side', t: 0.35 + i * 0.4, phase: 1.2 }), x, y, 6);
    label(a, x - 40, y + 40);
  });
  // Fila 6: multitud (identidad: nadie es un clon).
  label('Veinte vecinos al azar', 20, 2200);
  for (let i = 0; i < 20; i++) {
    const r = (['campesino', 'comerciante', 'artesano', 'pescador', 'pastor', 'posadero', 'nino', 'anciano'] as FolkRole[])[i % 8];
    fig(appearanceOf(w, folk(`multi${i}`, r, r === 'nino' ? 8 : r === 'anciano' ? 70 : 18 + i * 2, i % w.regions.length)), pose({ facing: i % 4 === 1 ? 'side' : 'front', t: i }), 50 + i * 78, 2500, 4.6);
  }
}
