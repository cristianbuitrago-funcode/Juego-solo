import { createWorld } from '../core/gen/worldgen';
import { ensureLife } from '../world/life';
import { appearanceOf, playerAppearance, regionalStyle } from './appearance';
import { drawHuman, drawPortrait, type Action, type Expr, type Facing } from './human';

/**
 * Galería de dirección de arte (abre la app con #galeria). Muestra personas de
 * varias regiones y oficios, vistas, acciones y expresiones, para revisar
 * proporciones, rostros y vestuario sin tener que buscarlos por el mundo.
 */
export function showGallery(root: HTMLElement): void {
  const w = createWorld(4242, { eraLength: 0 });
  const life = ensureLife(w);
  root.innerHTML = '';
  root.style.overflow = 'auto';
  root.style.background = '#e9dcbc';
  const c = document.createElement('canvas');
  const W = 1200;
  const H = 1700;
  c.width = W;
  c.height = H;
  c.style.width = `${W / 2}px`;
  root.append(c);
  const g = c.getContext('2d')!;
  g.fillStyle = '#9fb26e';
  g.fillRect(0, 0, W, H);
  g.font = '20px Georgia';
  g.fillStyle = '#2b1e15';
  // Fila 1-3: un vecino de cada rol/región, de frente, a escala 3.
  const roles = ['lider', 'comerciante', 'guardia', 'campesino', 'pastor', 'pescador', 'artesano', 'anciano', 'nino', 'sanadora', 'exploradora'];
  let x = 60;
  let y = 200;
  const seen = new Set<string>();
  for (const f of life.folk) {
    const key = `${f.role}:${regionalStyle(w, f.regionId)}`;
    if (seen.has(key) || !roles.includes(f.role)) continue;
    seen.add(key);
    const ap = appearanceOf(w, f);
    drawHuman(g, ap, { facing: 'front', flip: false, phase: 0, action: 'idle', t: 1, expr: 'neutral', lod: 0 }, x, y, 3);
    g.fillText(f.role, x - 40, y + 26);
    g.font = '13px Georgia';
    g.fillText(regionalStyle(w, f.regionId), x - 40, y + 42);
    g.font = '20px Georgia';
    x += 100;
    if (x > W - 60) {
      x = 60;
      y += 230;
    }
    if (y > 700) break;
  }
  // Acciones y vistas del jugador.
  const pa = playerAppearance(life.player);
  const acts: [Facing, Action, number][] = [['front', 'walk', 0.8], ['side', 'walk', 0.8], ['side', 'run', 1.4], ['back', 'walk', 0.5], ['front', 'talk', 0], ['front', 'wave', 0], ['side', 'work', 0], ['front', 'cross', 0], ['side', 'sit', 0], ['front', 'sit', 0]];
  x = 60;
  y = 980;
  for (const [facing, action, ph] of acts) {
    drawHuman(g, pa, { facing, flip: false, phase: ph, action, t: 2.2, expr: 'neutral', lod: 0 }, x, y, 2.6);
    g.font = '13px Georgia';
    g.fillText(`${facing} ${action}`, x - 40, y + 22);
    x += 110;
  }
  // Retratos con expresiones.
  const exprs: Expr[] = ['neutral', 'feliz', 'preocupado', 'enfadado', 'miedo', 'triste', 'sorpresa', 'desconfianza', 'alivio', 'hostil'];
  const leader = life.folk.find((f) => f.role === 'lider')!;
  const lap = appearanceOf(w, leader);
  exprs.forEach((e, i) => {
    const pc = document.createElement('canvas');
    pc.width = 200;
    pc.height = 220;
    drawPortrait(pc, i % 2 ? lap : appearanceOf(w, life.folk[i * 7 % life.folk.length]), e, 1);
    g.drawImage(pc, 40 + (i % 5) * 225, 1060 + Math.floor(i / 5) * 300);
    g.font = '16px Georgia';
    g.fillText(e, 40 + (i % 5) * 225, 1300 + Math.floor(i / 5) * 300);
  });
}
