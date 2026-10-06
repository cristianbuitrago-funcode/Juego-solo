import { alpha, blob, ell, lit, mix, put, rng, shd, silhouette, smoothPath, tex, type Tex } from '../paint';
import { VQ } from '../quality';
import { contactShadow, type SunState } from '../light';

/**
 * Vegetación pintada. Cada árbol se construye con masas de hojas (no con
 * un círculo repetido): racimos con luz arriba a la izquierda, huecos
 * oscuros por donde asoman las ramas, hojas sueltas en el borde para que la
 * silueta sea orgánica. Especie, edad, forma, inclinación y color cambian
 * con la semilla de cada árbol; la estación cambia la copa (brotes, verde
 * pleno, ocres y rojos, ramas desnudas o nevadas); el viento la mece.
 */
export type TreeKind = 'roble' | 'pino' | 'abedul' | 'sauce' | 'frutal' | 'muerto';
export type Season = 'primavera' | 'verano' | 'otoño' | 'invierno';

type Pal = [string, string, string]; // sombra, medio, luz

const LEAVES: Record<Season, Pal[]> = {
  primavera: [['#3f6a2e', '#6a9c44', '#a6d070'], ['#3a6432', '#5f9a48', '#9cc878'], ['#45702c', '#78a848', '#b8d880']],
  verano: [['#264a22', '#3f7232', '#76a850'], ['#2a4c28', '#466e34', '#7aa458'], ['#234624', '#3a6a30', '#6c9c48']],
  otoño: [['#7a3a18', '#c06a26', '#eab050'], ['#6a2a1a', '#b0402a', '#e88a50'], ['#6a5018', '#b88a2a', '#ecd060'], ['#5a4a22', '#8a7a32', '#c8b058']],
  invierno: [['#2a3e34', '#3f5848', '#6a8070'], ['#2a3e34', '#3f5848', '#6a8070']],
};
const PINE: Record<Season, Pal> = {
  primavera: ['#1e3c2a', '#2f5a3a', '#5a8a5a'],
  verano: ['#1a3826', '#2a5236', '#4f7e52'],
  otoño: ['#1e3a28', '#2f5236', '#5a7e50'],
  invierno: ['#1c3428', '#2a4a38', '#4a6a58'],
};

const BARK = ['#4e3524', '#5a3e28', '#463020', '#5e4430'];

/** Tamaño y forma de un ejemplar a partir de su variante. */
function specimen(v: number) {
  const R = rng(v * 7919 + 17);
  // Ejemplares de tamaños muy distintos: arbolitos jóvenes y árboles viejos enormes.
  const u = R();
  return { R, size: 0.85 + u * u * 0.75 + R() * 0.15, lean: (R() - 0.5) * 0.12, pal: Math.floor(R() * 4), shape: Math.floor(R() * 5) };
}

/** Copa de hojas en racimos (centro cx,cy; radios rx,ry). */
function canopy(g: CanvasRenderingContext2D, R: () => number, cx: number, cy: number, rx: number, ry: number, pal: Pal, density = 1, airy = false): void {
  // Masa de fondo en sombra.
  const pts: number[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.82 + R() * 0.3;
    pts.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
  }
  blob(g, pts, shd(pal[0], 0.25), 0.6);
  // Racimos de atrás hacia delante: los de abajo y a la derecha, más oscuros.
  const clusters = Math.round((airy ? 10 : 16) * density + rx * 0.25);
  const order: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < clusters; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * 0.78;
    order.push({ x: cx + Math.cos(a) * rx * d, y: cy + Math.sin(a) * ry * d, r: (airy ? 0.22 : 0.3) * Math.min(rx, ry) * (0.7 + R() * 0.6) });
  }
  order.sort((a, b) => b.x + b.y - (a.x + a.y));
  for (const c of order) {
    const light = Math.max(0, Math.min(1, 0.45 - ((c.x - cx) / rx) * 0.4 - ((c.y - cy) / ry) * 0.55));
    // Valores claros solo arriba a la izquierda; el resto, entre la sombra y el tono medio.
    const base = light > 0.62 ? mix(pal[1], pal[2], (light - 0.62) * 1.6) : mix(pal[0], pal[1], light / 0.62);
    const cp: number[] = [];
    const m = 9;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      const k = 0.75 + R() * 0.4;
      cp.push(c.x + Math.cos(a) * c.r * k, c.y + Math.sin(a) * c.r * k * 0.86);
    }
    const gr = g.createRadialGradient(c.x - c.r * 0.4, c.y - c.r * 0.45, c.r * 0.1, c.x, c.y, c.r * 1.1);
    gr.addColorStop(0, lit(base, 0.1 * light + 0.03));
    gr.addColorStop(0.55, `rgb(${base.map(Math.round).join(',')})`);
    gr.addColorStop(1, shd(base, 0.35));
    blob(g, cp, gr, 0.55);
  }
  // Hojas sueltas en el borde (silueta orgánica) y brillos.
  for (let i = 0; i < Math.round(rx * 1.1 * density); i++) {
    const a = R() * Math.PI * 2;
    const x = cx + Math.cos(a) * rx * (0.8 + R() * 0.16);
    const y = cy + Math.sin(a) * ry * (0.8 + R() * 0.16);
    const lightSide = Math.sin(a) < -0.2 && Math.cos(a) < 0.4;
    ell(g, x, y, 1.3 + R() * 0.9, 0.8 + R() * 0.5, lightSide ? pal[1] : shd(pal[0], 0.1), R() * 3);
  }
  // Huecos oscuros en el interior y brillos del sol arriba a la izquierda.
  for (let i = 0; i < Math.round(rx * 0.25); i++) ell(g, cx + (R() - 0.3) * rx * 0.9, cy + R() * ry * 0.6, rx * 0.12, ry * 0.08, alpha(shd(pal[0], 0.5), 0.55), R() * 3);
  for (let i = 0; i < Math.round(rx * 0.7); i++) {
    const a = Math.PI * (1.08 + R() * 0.6);
    const d = 0.35 + R() * 0.5;
    ell(g, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 0.9, 0.55, alpha(lit(pal[2], 0.15), 0.65), R() * 3);
  }
}

function trunk(g: CanvasRenderingContext2D, R: () => number, x: number, y0: number, y1: number, w0: number, w1: number, bark: string): void {
  const gr = g.createLinearGradient(x - w0, 0, x + w0, 0);
  gr.addColorStop(0, shd(bark, 0.15));
  gr.addColorStop(0.3, lit(bark, 0.18));
  gr.addColorStop(0.65, bark);
  gr.addColorStop(1, shd(bark, 0.45));
  g.fillStyle = gr;
  g.beginPath();
  // Raíces que se abren en el suelo.
  g.moveTo(x - w0 * 1.6, y0);
  g.quadraticCurveTo(x - w0 * 0.9, y0 - w0 * 0.4, x - w0 * 0.75, y0 - w0 * 1.5);
  g.lineTo(x - w1, y1);
  g.lineTo(x + w1, y1);
  g.lineTo(x + w0 * 0.75, y0 - w0 * 1.5);
  g.quadraticCurveTo(x + w0 * 0.9, y0 - w0 * 0.4, x + w0 * 1.7, y0);
  g.closePath();
  g.fill();
  // Corteza.
  g.strokeStyle = alpha(shd(bark, 0.55), 0.55);
  g.lineWidth = 0.35;
  for (let i = 0; i < 6; i++) {
    const xx = x + (R() - 0.5) * w0 * 1.3;
    g.beginPath();
    g.moveTo(xx, y0 - R() * 3);
    g.quadraticCurveTo(xx + (R() - 0.5) * 1.5, (y0 + y1) / 2, xx + (R() - 0.5) * 1.2, y1 + R() * 4);
    g.stroke();
  }
}

function branches(g: CanvasRenderingContext2D, R: () => number, x: number, y: number, len: number, ang: number, w: number, depth: number, col: string, snow: boolean): void {
  if (depth <= 0 || len < 2) return;
  const x2 = x + Math.sin(ang) * len;
  const y2 = y - Math.cos(ang) * len;
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo((x + x2) / 2 + (R() - 0.5) * len * 0.2, (y + y2) / 2, x2, y2);
  g.stroke();
  if (snow && w > 0.6) {
    g.strokeStyle = 'rgba(244,248,252,0.9)';
    g.lineWidth = w * 0.5;
    g.beginPath();
    g.moveTo(x, y - w * 0.4);
    g.lineTo(x2, y2 - w * 0.4);
    g.stroke();
  }
  const n = depth > 2 ? 2 + Math.floor(R() * 2) : 2;
  for (let i = 0; i < n; i++) branches(g, R, x2, y2, len * (0.62 + R() * 0.15), ang + (R() - 0.5) * 1.1 + (i - (n - 1) / 2) * 0.5, w * 0.62, depth - 1, col, snow);
}

function paintTree(g: CanvasRenderingContext2D, kind: TreeKind, season: Season, v: number, snowy: boolean): void {
  const { R, pal: pi, shape } = specimen(v);
  const winter = season === 'invierno';
  const bark = BARK[pi % BARK.length];
  const pals = LEAVES[season];
  const pal = pals[(pi + shape) % pals.length];
  switch (kind) {
    case 'roble': {
      const H = 74;
      const cw = 30 + shape * 2.5;
      if (winter) {
        trunk(g, R, 0, 0, -30, 3.8, 2.6, bark);
        branches(g, R, 0, -28, 18, -0.15, 2.6, 4, shd(bark, 0.05), snowy);
        return;
      }
      trunk(g, R, 0, 0, -30, 3.8, 2.6, bark);
      g.strokeStyle = bark;
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(0, -26);
      g.quadraticCurveTo(-6, -34, -12, -40);
      g.moveTo(0, -28);
      g.quadraticCurveTo(7, -36, 13, -42);
      g.stroke();
      canopy(g, R, (R() - 0.5) * 4, -H + 26, cw * 0.95, 23 + shape * 1.5, pal, 1.1);
      if (season === 'otoño') for (let i = 0; i < 6; i++) ell(g, (R() - 0.5) * 30, -R() * 2, 1.3, 0.6, pal[1], R() * 3);
      break;
    }
    case 'pino': {
      const H = 80 + shape * 3;
      trunk(g, R, 0, 0, -18, 2.4, 1.8, '#4a3020');
      const p = PINE[season];
      const tiers = 6;
      for (let i = 0; i < tiers; i++) {
        const k = i / (tiers - 1);
        const y = -H + 4 + k * (H - 22);
        const half = 4 + k * 15 + (R() - 0.5) * 2;
        const hgt = 13 + k * 4;
        // Cada piso: masa dentada con la cara izquierda en luz.
        const pts: number[] = [0, y - hgt * 0.55];
        const teeth = 6;
        for (let j = 0; j <= teeth; j++) {
          const t = j / teeth;
          pts.push(half * t * (1 + (j % 2) * 0.12), y - hgt * 0.55 + hgt * t * 0.95 + (j % 2) * 1.6);
        }
        for (let j = teeth; j >= 0; j--) {
          const t = j / teeth;
          pts.push(-half * t * (1 + (j % 2) * 0.12), y - hgt * 0.55 + hgt * t * 0.95 + (j % 2) * 1.6);
        }
        const gr = g.createLinearGradient(-half, 0, half, 0);
        gr.addColorStop(0, p[2]);
        gr.addColorStop(0.45, p[1]);
        gr.addColorStop(1, p[0]);
        g.fillStyle = gr;
        g.beginPath();
        smoothPath(g, pts, true, 0.2);
        g.fill();
        if (snowy) blob(g, [0, y - hgt * 0.55, half * 0.6, y - hgt * 0.1, -half * 0.6, y - hgt * 0.1], 'rgba(240,246,252,0.92)', 0.4);
      }
      break;
    }
    case 'abedul': {
      const H = 64 + shape * 2;
      // Tronco blanco con marcas oscuras.
      const gr = g.createLinearGradient(-2, 0, 2, 0);
      gr.addColorStop(0, '#cfc8bc');
      gr.addColorStop(0.35, '#f4f0e8');
      gr.addColorStop(1, '#a8a294');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-2.2, 0);
      g.lineTo(-1.5, -H + 20);
      g.lineTo(1.5, -H + 20);
      g.lineTo(2.2, 0);
      g.fill();
      for (let y = -4; y > -H + 22; y -= 3 + R() * 3) {
        g.fillStyle = 'rgba(40,36,32,0.75)';
        g.fillRect(-1.8 + R() * 0.8, y, 1.2 + R() * 1.6, 0.6);
      }
      if (winter) {
        branches(g, R, 0, -H + 22, 14, 0.1, 1.2, 4, '#6a6058', snowy);
        return;
      }
      canopy(g, R, 0, -H + 18, 16, 20, pal, 0.85, true);
      break;
    }
    case 'sauce': {
      trunk(g, R, 0, 0, -26, 4, 3, bark);
      if (winter) {
        branches(g, R, 0, -24, 14, 0, 2.2, 4, shd(bark, 0.05), snowy);
        return;
      }
      canopy(g, R, 0, -40, 30, 18, pal, 0.9);
      // Ramas colgantes.
      for (let i = 0; i < 26; i++) {
        const x = -28 + (i / 25) * 56 + (R() - 0.5) * 3;
        const y0 = -44 + Math.abs(x) * 0.25 + R() * 4;
        const len = 18 + R() * 16 - Math.abs(x) * 0.2;
        g.strokeStyle = i % 3 ? pal[1] : pal[2];
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x, y0);
        g.quadraticCurveTo(x + (R() - 0.5) * 3, y0 + len * 0.6, x + (R() - 0.5) * 4, y0 + len);
        g.stroke();
      }
      break;
    }
    case 'frutal': {
      trunk(g, R, 0, 0, -20, 2.8, 2, bark);
      if (winter) {
        branches(g, R, 0, -18, 12, 0, 1.8, 4, shd(bark, 0.05), snowy);
        return;
      }
      const sp: Pal = season === 'primavera' ? ['#c88aa0', '#ecbfd0', '#fbe8f0'] : pal;
      canopy(g, R, 0, -36, 21, 17, sp, 1);
      if (season !== 'primavera') {
        const fruit = season === 'verano' ? '#c8302a' : '#e8a030';
        for (let i = 0; i < 12; i++) {
          const a = R() * Math.PI * 2;
          const d = Math.sqrt(R()) * 0.75;
          const x = Math.cos(a) * 21 * d;
          const y = -36 + Math.sin(a) * 17 * d;
          ell(g, x, y, 1.5, 1.5, fruit);
          ell(g, x - 0.5, y - 0.5, 0.5, 0.5, 'rgba(255,255,255,0.7)');
        }
      }
      break;
    }
    case 'muerto':
      trunk(g, R, 0, 0, -32, 3.4, 2.2, '#5e5248');
      branches(g, R, 0, -30, 16, -0.1, 2.2, 4, '#5e5248', false);
      break;
  }
}

const BOX: Record<TreeKind, [number, number]> = { roble: [84, 96], pino: [56, 104], abedul: [50, 92], sauce: [80, 84], frutal: [56, 72], muerto: [64, 88] };

export function treeTex(kind: TreeKind, season: Season, v: number, snowy: boolean): Tex {
  const [w, h] = BOX[kind];
  const bucket = v % 6;
  return tex(`tree2:${kind}:${season}:${bucket}:${snowy ? 1 : 0}`, w, h, w / 2, h - 4, (g) => paintTree(g, kind, season, bucket * 41 + 3, snowy));
}

/** Árbol en (x, y) de mundo con su tamaño, inclinación y vaivén con el viento. */
export function drawTree(g: CanvasRenderingContext2D, kind: TreeKind, season: Season, v: number, x: number, y: number, t: number, wind: number, snowy: boolean, focus?: { x: number; y: number }): void {
  const t0 = treeTex(kind, season, v, snowy);
  const sp = specimen(v);
  const s = sp.size * (kind === 'muerto' ? 0.9 : 1);
  const sway = VQ().sway ? Math.sin(t * (1.1 + (v % 7) * 0.07) + v) * 0.018 * (0.6 + wind) : 0;
  g.save();
  // Oclusión: solo si el protagonista está detrás del tronco y su cuerpo cae
  // dentro de la copa (no del tronco), la copa se vuelve translúcida.
  if (focus && focus.y < y - 2) {
    const canopyBottom = y - t0.ay * s * 0.32;
    const canopyTop = y - t0.ay * s;
    if (focus.y - 22 < canopyBottom && focus.y > canopyTop && Math.abs(focus.x - x) < (t0.w / 2) * s * 0.72) g.globalAlpha = 0.5;
  }
  g.translate(x, y);
  g.transform(1, 0, sp.lean + sway, 1, 0, 0);
  g.scale(v & 1 ? -s : s, s);
  g.drawImage(t0.canvas, -t0.ax, -t0.ay, t0.w, t0.h);
  g.restore();
}

/** Sombra del árbol proyectada en el suelo según el sol (en la pasada de sombras). */
export function drawTreeShadow(g: CanvasRenderingContext2D, kind: TreeKind, season: Season, v: number, x: number, y: number, sun: SunState, snowy: boolean): void {
  const t0 = treeTex(kind, season, v, snowy);
  const s = specimen(v).size;
  // Sombra de contacto.
  const r = (kind === 'pino' ? 10 : 14) * s;
  contactShadow(g, x, y, r, r * 0.45, 0.38);
  if (sun.a <= 0.02 || VQ().shadows === 'blob') return;
  const sil = silhouette(t0);
  g.save();
  g.globalAlpha = sun.a * (season === 'invierno' && kind !== 'pino' ? 0.35 : 0.7);
  // La vertical del árbol se proyecta en la dirección de la sombra.
  g.transform(s, 0, -sun.dx * sun.len * s, -sun.dy * sun.len * s, x, y);
  g.drawImage(sil, -t0.ax, -t0.ay, t0.w, t0.h);
  g.restore();
}

// ---------------------------------------------------------------------------
// Matorral, hierba alta, flores, juncos y rocas
// ---------------------------------------------------------------------------
export type SmallKind = 'arbusto' | 'hierba' | 'flores' | 'junco' | 'roca';

function paintSmall(g: CanvasRenderingContext2D, kind: SmallKind, season: Season, v: number, snowy: boolean): void {
  const R = rng(v * 131 + kind.length);
  const pal = LEAVES[season][v % LEAVES[season].length];
  switch (kind) {
    case 'arbusto': {
      if (season === 'invierno') {
        branches(g, R, 0, 0, 6, -0.5, 0.8, 3, '#5a4a3a', snowy);
        branches(g, R, 0, 0, 6, 0.5, 0.8, 3, '#5a4a3a', snowy);
        return;
      }
      canopy(g, R, 0, -8, 13, 8, pal, 0.9);
      if (season === 'primavera' && v % 2) for (let i = 0; i < 8; i++) ell(g, (R() - 0.5) * 20, -8 + (R() - 0.5) * 10, 1, 1, '#f6dbe6');
      if (season === 'verano' && v % 3 === 0) for (let i = 0; i < 7; i++) ell(g, (R() - 0.5) * 18, -8 + (R() - 0.5) * 9, 0.9, 0.9, '#3a2a6a');
      break;
    }
    case 'hierba': {
      const col = season === 'invierno' ? ['#9a9a80', '#c8c8b0'] : season === 'otoño' ? ['#8a7a3a', '#c8a850'] : [pal[0], pal[2]];
      for (let i = 0; i < 22; i++) {
        const x = (R() - 0.5) * 14;
        const h = 4 + R() * 7;
        g.strokeStyle = i % 2 ? col[0] : col[1];
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(x, 0);
        g.quadraticCurveTo(x + (R() - 0.5) * 3, -h * 0.6, x + (R() - 0.5) * 5, -h);
        g.stroke();
      }
      break;
    }
    case 'flores': {
      const cs = ['#f6e27a', '#f2b8cf', '#fbf6ee', '#c86ad0', '#f08a4a', '#8ab8f0'];
      for (let i = 0; i < 11; i++) {
        const x = (R() - 0.5) * 18;
        const h = 3 + R() * 4;
        g.strokeStyle = pal[0];
        g.lineWidth = 0.5;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + (R() - 0.5), -h);
        g.stroke();
        if (season !== 'invierno') {
          const c = cs[(i + v) % cs.length];
          for (let k = 0; k < 5; k++) ell(g, x + Math.cos((k / 5) * 6.28) * 0.8, -h + Math.sin((k / 5) * 6.28) * 0.8, 0.7, 0.5, c, (k / 5) * 6.28);
          ell(g, x, -h, 0.45, 0.45, '#e8b030');
        }
      }
      break;
    }
    case 'junco': {
      for (let i = 0; i < 12; i++) {
        const x = (R() - 0.5) * 12;
        const h = 9 + R() * 9;
        g.strokeStyle = season === 'invierno' ? '#9a9478' : i % 2 ? '#5f7a3a' : '#7f9a4a';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x, 0);
        g.quadraticCurveTo(x - 1, -h * 0.6, x + (R() - 0.5) * 4, -h);
        g.stroke();
        if (i % 4 === 0) ell(g, x + 0.3, -h * 0.75, 0.9, 2.4, '#6b4a2a');
      }
      break;
    }
    case 'roca': {
      const base = ['#8d8a83', '#7c786f', '#9a958a', '#87827a'][v % 4];
      const w = 10 + (v % 5) * 2.4;
      const h = 7 + (v % 3) * 2.5;
      const pts = [-w, 0, -w * 0.85, -h * 0.55, -w * 0.4, -h, w * 0.3, -h * 0.95, w * 0.9, -h * 0.45, w, 0];
      g.fillStyle = shd(base, 0.25);
      g.beginPath();
      smoothPath(g, pts, true, 0.3);
      g.fill();
      blob(g, [-w * 0.85, -h * 0.5, -w * 0.4, -h, w * 0.2, -h * 0.92, w * 0.05, -h * 0.4, -w * 0.5, -h * 0.15], lit(base, 0.1), 0.3);
      blob(g, [w * 0.05, -h * 0.4, w * 0.2, -h * 0.92, w * 0.85, -h * 0.45, w * 0.9, -h * 0.05, w * 0.2, -h * 0.05], shd(base, 0.12), 0.3);
      if (v % 2) blob(g, [-w * 0.7, -h * 0.15, -w * 0.3, -h * 0.35, 0, -h * 0.1, -w * 0.5, 0], alpha('#6a8a44', 0.85), 0.5);
      if (snowy) blob(g, [-w * 0.6, -h * 0.75, -w * 0.3, -h * 1.05, w * 0.3, -h * 1.0, w * 0.6, -h * 0.6, 0, -h * 0.7], 'rgba(244,248,252,0.95)', 0.5);
      break;
    }
  }
}

export function drawSmall(g: CanvasRenderingContext2D, kind: SmallKind, season: Season, v: number, x: number, y: number, t: number, snowy: boolean): void {
  const t0 = tex(`small:${kind}:${season}:${v % 5}:${snowy ? 1 : 0}`, 30, 26, 15, 22, (gg) => paintSmall(gg, kind, season, v % 5, snowy));
  const sway = VQ().sway && kind !== 'roca' ? Math.sin(t * 1.7 + v) * 0.05 : 0;
  g.save();
  g.translate(x, y);
  g.transform(1, 0, sway, 1, 0, 0);
  const s = 0.85 + ((v >> 3) % 5) * 0.08;
  g.scale(v & 2 ? -s : s, s);
  put(g, t0, 0, 0);
  g.restore();
}
