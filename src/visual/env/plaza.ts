import { alpha, ell, lit, rng, shd, tex, vgrad, type Tex } from '../paint';
import type { Season } from './flora';

/**
 * Lo que hace única cada plaza (solo aspecto; la simulación no lo ve):
 * pavimento con dibujo, árboles en alcorque, jardineras, mesas de terraza con
 * sombrilla, estandartes con el color de la tierra y guirnaldas entre faroles.
 */
export type DecorKind = 'arbol' | 'jardinera' | 'mesa' | 'estandarte';
export interface Decor {
  kind: DecorKind;
  x: number; // teselas
  y: number;
  v: number;
}
export interface PlazaLook {
  paving: 'anillo' | 'rosa' | 'damero' | null;
  decor: Decor[];
  garlands: [number, number][]; // pares de índices de farol
}

interface Spot {
  x: number;
  y: number;
  r: number;
}

/** Elige y coloca la decoración de una plaza. Determinista: misma semilla, misma plaza. */
export function plazaLook(seed: number, regionId: number, cx: number, cy: number, plazaR: number, big: boolean, taken: Spot[], ground: (x: number, y: number) => boolean = () => true): PlazaLook {
  const R = rng(((seed >>> 0) * 977 + regionId * 131 + 5) >>> 0);
  // (El damero se probó y se leía como la rejilla de «transparente» de un editor: fuera.)
  // (La rosa de ocho puntas también se quitó: sus puntas asomaban cortadas junto a las farolas
  // y se leían como un destello o un fallo.)
  // Tampoco los aros: a la altura de la cámara solo asomaba un arco pálido junto a las farolas.
  // Se conserva la tirada para que la colocación de los adornos no cambie.
  void R();
  const paving: PlazaLook['paving'] = null;
  const pool: (DecorKind | 'guirnalda')[] = ['arbol', 'jardinera', 'mesa', 'estandarte', 'guirnalda'];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const pick = pool.slice(0, big ? 3 : 2);
  const decor: Decor[] = [];
  const garlands: [number, number][] = [];
  const ox = cx + 0.5;
  const oy = cy + 0.5;
  const free = (x: number, y: number, r: number) => taken.every((s) => Math.hypot(s.x - x, s.y - y) > s.r + r);
  const place = (kind: DecorKind, n: number, r: number, rad0: number, rad1: number, back = false) => {
    const a0 = R() * Math.PI * 2;
    for (let k = 0, got = 0; k < 36 && got < n; k++) {
      const a = a0 + k * (Math.PI / 6) + (k > 11 ? 0.26 : 0);
      const d = plazaR * (rad0 + (rad1 - rad0) * ((k * 0.37) % 1));
      const x = ox + Math.cos(a) * d;
      const y = oy + Math.sin(a) * d;
      if (!free(x, y, r) || (back && y > oy - 1) || !ground(x, y) || !ground(x, y - 0.6)) continue;
      decor.push({ kind, x, y, v: Math.floor(R() * 1000) });
      taken.push({ x, y, r });
      got++;
    }
  };
  for (const p of pick) {
    // Radios en plazas: el anillo de puestos y bancos ocupa casi todo el interior, así que
    // jardineras y estandartes rematan el borde (entre farolas) y el árbol queda fuera, al fondo.
    if (p === 'arbol') place('arbol', big ? 2 : 1, 1.2, 1.2, 1.45, true);
    else if (p === 'jardinera') (place('jardinera', 2, 0.5, 0.58, 0.84), place('jardinera', big ? 3 : 2, 0.6, 1.08, 1.22));
    else if (p === 'mesa') place('mesa', 2, 0.8, 0.42, 0.62);
    else if (p === 'estandarte') place('estandarte', big ? 4 : 3, 0.4, 1.02, 1.15);
    else {
      const s = Math.floor(R() * 6);
      garlands.push([s, (s + 1) % 6], [(s + 3) % 6, (s + 4) % 6]);
    }
  }
  // Un par a ambos lados del hito, delante: lo primero que se ve al llegar a la plaza.
  const flankKind: DecorKind = (seed + regionId) % 3 === 0 ? 'estandarte' : 'jardinera';
  for (const [dx, dy] of [[3.2, 1.9], [3.4, 1.2], [3.0, 2.6], [3.6, 0.6]]) {
    const L = { x: ox - dx, y: oy + dy };
    const Rr = { x: ox + dx, y: oy + dy };
    const rr = flankKind === 'estandarte' ? 0.4 : 0.5;
    if (!free(L.x, L.y, rr) || !free(Rr.x, Rr.y, rr) || !ground(L.x, L.y) || !ground(Rr.x, Rr.y)) continue;
    for (const q of [L, Rr]) {
      decor.push({ kind: flankKind, x: q.x, y: q.y, v: (seed + regionId * 7) % 1000 });
      taken.push({ x: q.x, y: q.y, r: rr });
    }
    break;
  }
  return { paving, decor, garlands };
}

/** Dibujo del pavimento, en el suelo y bajo todo lo demás. Radio en teselas. */
export function pavingTex(kind: 'anillo' | 'rosa' | 'damero', plazaR: number, T: number, key: string, isPlaza: (tx: number, ty: number) => boolean): Tex {
  const Rp = Math.round(plazaR * T * 0.78);
  const S = Rp * 2 + 4;
  // Achatado como la base de la fuente y los demás círculos del suelo (vista oblicua).
  const SQ = 0.74;
  return tex(`pav:${kind}:${Rp}:${key}`, S, S, S / 2, S / 2, (g) => {
    g.save();
    g.translate(S / 2, S / 2);
    g.scale(1, SQ);
    const light = 'rgba(226,214,188,0.5)';
    const dark = 'rgba(64,52,44,0.38)';
    if (kind === 'anillo') {
      // Dos aros de losas claras, con juntas radiales.
      for (const [r0, r1] of [[Rp * 0.94, Rp * 0.82], [Rp * 0.5, Rp * 0.42]]) {
        g.fillStyle = light;
        g.beginPath();
        g.arc(0, 0, r0, 0, Math.PI * 2);
        g.arc(0, 0, r1, 0, Math.PI * 2, true);
        g.fill();
        g.strokeStyle = dark;
        g.lineWidth = 0.6;
        const n = Math.round(r0 / 3.2);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          g.beginPath();
          g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
          g.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
          g.stroke();
        }
      }
    } else if (kind === 'rosa') {
      // Rosa de ocho puntas de piedra oscura y clara, como las de los mapas.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const long = i % 2 === 0 ? Rp * 0.92 : Rp * 0.6;
        const w = 0.32;
        for (const side of [-1, 1]) {
          g.fillStyle = side < 0 ? light : dark;
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(Math.cos(a) * long, Math.sin(a) * long);
          g.lineTo(Math.cos(a + side * w) * long * 0.32, Math.sin(a + side * w) * long * 0.32);
          g.closePath();
          g.fill();
        }
      }
      g.strokeStyle = dark;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(0, 0, Rp * 0.95, 0, Math.PI * 2);
      g.stroke();
    } else {
      // Damero de losas grandes en diagonal, que se desvanece hacia el borde.
      const s = 7;
      g.save();
      g.beginPath();
      g.arc(0, 0, Rp, 0, Math.PI * 2);
      g.clip();
      g.rotate(Math.PI / 4);
      for (let y = -Rp * 1.5; y < Rp * 1.5; y += s)
        for (let x = -Rp * 1.5; x < Rp * 1.5; x += s) {
          if ((Math.round(x / s) + Math.round(y / s)) % 2) continue;
          const d = Math.hypot(x, y) / Rp;
          g.fillStyle = `rgba(236,226,204,${(0.26 * Math.max(0, 1 - d * d)).toFixed(3)})`;
          g.fillRect(x, y, s, s);
        }
      g.restore();
    }
    g.restore();
    // Solo sobre el empedrado: fuera de la plaza (hierba, tierra) no hay dibujo.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    const n = Math.ceil(S / 2 / T) + 1;
    for (let ty = -n; ty <= n; ty++)
      for (let tx = -n; tx <= n; tx++) if (!isPlaza(tx, ty)) g.fillRect(S / 2 + tx * T - T / 2 - 0.5, S / 2 + ty * T - T / 2 - 0.5, T + 1, T + 1);
    g.globalCompositeOperation = 'source-over';
  });
}

/** Alcorque de piedra con tierra (el árbol se dibuja encima). */
export function treeBedTex(snowy: boolean): Tex {
  return tex(`alcorque:${snowy}`, 34, 16, 17, 9, (g) => {
    ell(g, 17, 9, 15, 6.5, vgrad(g, 2, 16, [[0, '#b8ae9a'], [1, '#7c7466']]));
    ell(g, 17, 8.4, 12, 4.6, snowy ? '#e8eef4' : '#4a3626');
    if (!snowy) for (let i = 0; i < 6; i++) ell(g, 9 + i * 3.2, 8 + (i % 2), 1.2, 0.6, '#5d4630');
  });
}

/** Jardinera de piedra con flores de la estación. */
export function planterTex(season: Season, v: number): Tex {
  return tex(`jardinera:${season}:${v % 3}`, 28, 22, 14, 20, (g) => {
    const R = rng(v * 17 + 3);
    g.fillStyle = vgrad(g, 10, 20, [[0, '#c4b9a2'], [1, '#867c6a']]);
    g.fillRect(2, 10, 24, 10);
    g.fillStyle = '#d6ccb6';
    g.fillRect(1, 9, 26, 2.2);
    g.fillStyle = shd('#867c6a', 0.3);
    g.fillRect(2, 19, 24, 1);
    if (season === 'invierno') {
      ell(g, 14, 9.5, 12, 2.2, '#eef2f6');
      g.strokeStyle = '#5a4a3a';
      g.lineWidth = 0.6;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.moveTo(5 + i * 4.5, 9);
        g.lineTo(4 + i * 4.5 + R() * 2, 3 + R() * 2);
        g.stroke();
      }
      return;
    }
    const greens = ['#4f7a3a', '#5f8a42', '#3f6a32'];
    for (let i = 0; i < 9; i++) ell(g, 4 + i * 2.5 + R(), 7 + R() * 2, 2.6, 2, greens[i % 3]);
    const pal = season === 'otoño' ? ['#d08a2a', '#b85a2a', '#e0b040'] : [['#e85a6a', '#f2c84a', '#f4f0e8'], ['#9a6ad0', '#f2b8cf', '#fbf6ee'], ['#f08a4a', '#f6e27a', '#e85a6a']][v % 3];
    for (let i = 0; i < 11; i++) {
      const x = 4 + R() * 20;
      const y = 4 + R() * 4;
      ell(g, x, y, 1.3, 1.1, pal[i % 3]);
      ell(g, x - 0.3, y - 0.3, 0.45, 0.4, lit(pal[i % 3], 0.5));
    }
  });
}

/** Mesa de terraza con dos taburetes y sombrilla a rayas. */
export function tableTex(hue: number, v: number): Tex {
  return tex(`mesa:${hue}:${v % 2}`, 40, 46, 20, 42, (g) => {
    const cloth = `hsl(${hue} 45% 52%)`;
    // Taburetes.
    for (const sx of [5, 35]) {
      g.fillStyle = '#5a3c24';
      g.fillRect(sx - 0.8, 36, 1.6, 6);
      ell(g, sx, 36, 3.2, 1.3, '#8a6440');
    }
    // Mesa.
    g.fillStyle = '#5a3c24';
    g.fillRect(19, 31, 2, 11);
    ell(g, 20, 31, 10, 3.2, vgrad(g, 28, 34, [[0, '#a07a50'], [1, '#6e4e30']]));
    ell(g, 20, 30.6, 9, 2.4, '#a8845a');
    // Jarra y vasos.
    g.fillStyle = '#c8b8a0';
    g.fillRect(15, 27, 2, 3);
    g.fillRect(23, 27.5, 1.8, 2.6);
    ell(g, 20, 28.5, 1.6, 2.2, '#8a5a3a');
    // Sombrilla.
    g.fillStyle = '#4a3424';
    g.fillRect(19.5, 6, 1, 25);
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI + (i / segs) * Math.PI;
      const a1 = Math.PI + ((i + 1) / segs) * Math.PI;
      g.fillStyle = i % 2 ? cloth : '#f2e8d4';
      g.beginPath();
      g.moveTo(20, 4);
      g.lineTo(20 + Math.cos(a0) * 18, 12 + Math.sin(a0) * -1.5);
      g.lineTo(20 + Math.cos(a1) * 18, 12 + Math.sin(a1) * -1.5);
      g.closePath();
      g.fill();
    }
    g.fillStyle = alpha(shd(cloth, 0.4), 0.5);
    g.fillRect(2, 11.5, 36, 1.2);
    for (let i = 0; i < 9; i++) ell(g, 3 + i * 4.3, 13, 2.1, 1.2, i % 2 ? cloth : '#f2e8d4');
  });
}

/** Estandarte en un mástil con el color y la marca de la tierra. */
export function bannerTex(hue: number, v: number): Tex {
  return tex(`estandarte:${hue}:${v % 3}`, 22, 60, 4, 58, (g) => {
    const cloth = `hsl(${hue} 55% 42%)`;
    g.fillStyle = vgrad(g, 0, 58, [[0, '#6a5a48'], [1, '#3e3226']]);
    g.fillRect(3, 2, 2, 56);
    ell(g, 4, 2, 1.8, 1.8, '#c9a052');
    // Paño colgante con cola de golondrina.
    g.fillStyle = vgrad(g, 5, 34, [[0, lit(cloth, 0.15)], [1, shd(cloth, 0.3)]]);
    g.beginPath();
    g.moveTo(5, 5);
    g.lineTo(20, 6);
    g.lineTo(20, 32);
    g.lineTo(12.5, 27);
    g.lineTo(5, 32);
    g.closePath();
    g.fill();
    g.strokeStyle = '#c9a052';
    g.lineWidth = 0.7;
    g.stroke();
    // Marca: sol, árbol o luna según la variante.
    const m = v % 3;
    g.fillStyle = '#e9cf8a';
    if (m === 0) {
      ell(g, 12.5, 16, 3.2, 3.2, '#e9cf8a');
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillRect(12.5 + Math.cos(a) * 4.6 - 0.5, 16 + Math.sin(a) * 4.6 - 0.5, 1, 1);
      }
    } else if (m === 1) {
      g.fillRect(12, 16, 1.2, 6);
      ell(g, 12.6, 14.5, 4, 3.6, '#e9cf8a');
    } else {
      ell(g, 12.5, 16, 4, 4, '#e9cf8a');
      ell(g, 14.2, 15, 3.4, 3.4, cloth);
    }
  });
}

/** Guirnalda de banderines entre dos faroles (se mece un poco con el viento). */
export function drawGarland(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, hue: number, t: number, wind: number): void {
  const n = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 9));
  const sag = 14 + Math.sin(t / 900) * 1.5 * wind;
  const at = (u: number) => ({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * sag });
  g.strokeStyle = 'rgba(60,46,34,0.9)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (let i = 0; i <= 16; i++) {
    const p = at(i / 16);
    if (i) g.lineTo(p.x, p.y);
    else g.moveTo(p.x, p.y);
  }
  g.stroke();
  const cols = [`hsl(${hue} 60% 52%)`, '#f2e6c8', `hsl(${(hue + 40) % 360} 55% 50%)`, '#e9b44c'];
  for (let i = 1; i < n; i++) {
    const u = i / n;
    const p = at(u);
    const sway = Math.sin(t / 420 + i * 1.7) * 1.2 * wind;
    g.fillStyle = cols[i % cols.length];
    g.beginPath();
    g.moveTo(p.x - 2.4, p.y);
    g.lineTo(p.x + 2.4, p.y);
    g.lineTo(p.x + sway, p.y + 5.5);
    g.closePath();
    g.fill();
  }
}
