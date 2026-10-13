import type { WorldState } from '../../core/types';
import { getTerrain } from '../../world/terrain';
import { T, TH, TW, WORLD_SCALE } from '../../world/types';

/**
 * Relieve del mapa a tinta y aguada, como en un mapa dibujado a mano: montañas con
 * su ladera en sombra, bosquecillos de copas redondas, juncos en las marismas y olas
 * junto a la costa. Sale del terreno real (lo que se pisa en la escena) y solo se
 * dibuja en lo que ya conoces. Se pinta una vez en una capa aparte.
 */
const K = 0.75; // resolución de la capa respecto a las unidades del mapa

function hash(a: number, b: number, s: number): number {
  let h = (a * 374761393 + b * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function paintRelief(w: WorldState, known: (regionId: number) => boolean, into?: HTMLCanvasElement): HTMLCanvasElement {
  const ter = getTerrain(w);
  const tiles = ter.natural ?? ter.tiles;
  const W = Math.round(TW * WORLD_SCALE * K);
  const H = Math.round(TH * WORLD_SCALE * K);
  const c = into ?? document.createElement('canvas');
  if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= TW || ty >= TH ? -1 : tiles[ty * TW + tx]);
  const reg = (tx: number, ty: number) => ter.region[ty * TW + tx];
  const px = (t: number) => t * WORLD_SCALE * K;
  const ink = 'rgba(58,42,30,0.85)';

  // Olas a lo largo de la costa (mar junto a tierra conocida).
  g.strokeStyle = 'rgba(232,240,240,0.55)';
  g.lineWidth = 1.1;
  for (let ty = 2; ty < TH - 2; ty += 7)
    for (let tx = 2; tx < TW - 2; tx += 7) {
      const jx = tx + Math.floor(hash(tx, ty, 3) * 5);
      const jy = ty + Math.floor(hash(tx, ty, 4) * 5);
      if (at(jx, jy) !== T.Sea) continue;
      let land = -1;
      for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
        const t = at(jx + dx, jy + dy);
        if (t !== T.Sea && t >= 0) land = reg(jx + dx, jy + dy);
      }
      if (land < 0 || !known(land)) continue;
      const x = px(jx);
      const y = px(jy);
      g.beginPath();
      g.moveTo(x - 6, y);
      g.quadraticCurveTo(x - 3, y - 3, x, y);
      g.quadraticCurveTo(x + 3, y + 3, x + 6, y);
      g.stroke();
    }

  // Bosques: grupos de copas; montañas: picos con la ladera en sombra (de atrás hacia delante).
  const marks: { y: number; draw: () => void }[] = [];
  for (let ty = 0; ty < TH; ty += 6)
    for (let tx = 0; tx < TW; tx += 6) {
      const jx = tx + Math.floor(hash(tx, ty, 1) * 6);
      const jy = ty + Math.floor(hash(tx, ty, 2) * 6);
      const t = at(jx, jy);
      if (t < 0) continue;
      const r = reg(jx, jy);
      if (r < 0 || !known(r)) continue;
      const x = px(jx);
      const y = px(jy);
      const v = hash(jx, jy, 9);
      if ((t === T.Mountain || (t === T.Rock && v < 0.4)) && (tx / 6 + ty / 6) % 2 === 0) {
        const hgt = (t === T.Mountain ? 20 : 12) + v * 10;
        const wd = hgt * (0.9 + v * 0.4);
        marks.push({
          y,
          draw: () => {
            // Ladera iluminada (oeste) y en sombra (este), contorno de tinta y nieve en las altas.
            g.fillStyle = 'rgba(236,224,196,0.95)';
            g.beginPath();
            g.moveTo(x - wd / 2, y);
            g.lineTo(x, y - hgt);
            g.lineTo(x + wd * 0.08, y);
            g.closePath();
            g.fill();
            g.fillStyle = 'rgba(120,96,70,0.75)';
            g.beginPath();
            g.moveTo(x + wd * 0.08, y);
            g.lineTo(x, y - hgt);
            g.lineTo(x + wd / 2, y);
            g.closePath();
            g.fill();
            if (t === T.Mountain && v > 0.35) {
              g.fillStyle = 'rgba(250,250,246,0.95)';
              g.beginPath();
              g.moveTo(x - hgt * 0.16, y - hgt * 0.72);
              g.lineTo(x, y - hgt);
              g.lineTo(x + hgt * 0.16, y - hgt * 0.72);
              g.lineTo(x + hgt * 0.04, y - hgt * 0.78);
              g.closePath();
              g.fill();
            }
            g.strokeStyle = ink;
            g.lineWidth = 1.3;
            g.beginPath();
            g.moveTo(x - wd / 2, y);
            g.lineTo(x, y - hgt);
            g.lineTo(x + wd / 2, y);
            g.stroke();
            // Rayado de la sombra.
            g.lineWidth = 0.7;
            for (let i = 1; i < 4; i++) {
              g.beginPath();
              g.moveTo(x + (wd / 2) * (i / 4), y - hgt * (1 - i / 4) * 0.9);
              g.lineTo(x + (wd / 2) * (i / 4) - 2, y);
              g.stroke();
            }
          },
        });
      } else if (t === T.Forest && v < 0.8) {
        marks.push({
          y,
          draw: () => {
            for (let i = 0; i < 3; i++) {
              const cx = x + (i - 1) * 5.5 + (hash(jx, i, 5) - 0.5) * 2;
              const cy = y - (i === 1 ? 3 : 0);
              g.strokeStyle = ink;
              g.lineWidth = 1;
              g.beginPath();
              g.moveTo(cx, cy);
              g.lineTo(cx, cy + 4);
              g.stroke();
              g.fillStyle = i === 1 ? 'rgba(86,112,62,0.95)' : 'rgba(104,130,74,0.95)';
              g.beginPath();
              g.arc(cx, cy - 2.5, 3.6, 0, Math.PI * 2);
              g.fill();
              g.stroke();
            }
          },
        });
      } else if (t === T.Marsh && v < 0.22 && (tx / 6 + ty / 6) % 2 === 1) {
        marks.push({
          y,
          draw: () => {
            g.strokeStyle = 'rgba(58,70,48,0.8)';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(x - 6, y);
            g.lineTo(x + 6, y);
            for (let i = -1; i <= 1; i++) {
              g.moveTo(x + i * 3, y);
              g.lineTo(x + i * 3 + i, y - 6 - Math.abs(i));
            }
            g.stroke();
          },
        });
      }
    }
  marks.sort((a, b) => a.y - b.y);
  for (const m of marks) m.draw();
  return c;
}

export const RELIEF_K = K;
