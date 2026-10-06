import type { Layout } from '../world/layout';
import { idx } from '../world/terrain';
import { T, TILE } from '../world/types';

export interface WetHost {
  l: Layout;
  reduceMotion: boolean;
}

/** Lluvia en el suelo: oscurece la tierra y pinta charcos con reflejo y ondas en caminos y plazas. */
export function drawWet(s: WetHost, g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, t: number, storm: boolean): void {
  // El suelo empapado se oscurece (antes de las sombras y las figuras).
  g.fillStyle = storm ? 'rgba(14,20,32,0.3)' : 'rgba(18,26,40,0.24)';
  g.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
  const tiles = s.l.terrain.tiles;
  for (let ty = Math.floor(y0 / TILE); ty <= Math.ceil(y1 / TILE); ty++)
    for (let tx = Math.floor(x0 / TILE); tx <= Math.ceil(x1 / TILE); tx++) {
      const tt = tiles[idx(Math.max(0, tx), Math.max(0, ty))];
      if (tt !== T.Road && tt !== T.Plaza && tt !== T.Clay) continue;
      const h2 = Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663);
      const hh = ((Math.imul(h2 ^ (h2 >>> 13), 1274126177) >>> 0) % 1000) / 1000;
      if (hh > 0.09) continue;
      const cx = tx * TILE + 3 + ((hh * 7919) % 1) * 10;
      const cy = ty * TILE + 4 + ((hh * 104729) % 1) * 8;
      const rx = 4 + ((hh * 31) % 1) * 7;
      // Charco sin contorno: forma irregular (dos óvalos), oscuro por dentro y
      // con el cielo reflejado en una franja; un brillo fino en el borde.
      g.fillStyle = 'rgba(40,52,70,0.42)';
      g.beginPath();
      g.ellipse(cx, cy, rx, rx * 0.34, 0, 0, Math.PI * 2);
      g.ellipse(cx + rx * 0.45, cy + rx * 0.1, rx * 0.6, rx * 0.26, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(176,192,214,0.32)';
      g.beginPath();
      g.ellipse(cx - rx * 0.1, cy - rx * 0.06, rx * 0.7, rx * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(230,238,250,0.35)';
      g.lineWidth = 0.4;
      g.beginPath();
      g.ellipse(cx, cy, rx * 0.95, rx * 0.32, 0, Math.PI * 1.1, Math.PI * 1.6);
      g.stroke();
      if (s.reduceMotion) continue;
      // Ondas: anillos que nacen y se abren.
      for (let k = 0; k < 2; k++) {
        const ph = ((t / 900 + hh * 7 + k * 0.5) % 1);
        g.strokeStyle = `rgba(220,232,245,${(0.5 * (1 - ph)).toFixed(3)})`;
        g.lineWidth = 0.35;
        g.beginPath();
        g.ellipse(cx + (k - 0.5) * rx * 0.5, cy, 0.5 + ph * rx * 0.4, (0.5 + ph * rx * 0.4) * 0.36, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
}
