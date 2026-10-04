import { Painter } from './pixel';

/**
 * Efectos en pixel art: lluvia, salpicaduras, nieve, viento, hogueras,
 * llamas de farol y humo. Se dibujan en el lienzo del mundo (1 píxel de
 * arte por píxel de mundo), así que comparten rejilla con todo lo demás.
 */

// ---------------------------------------------------------------------------
// Fuego
// ---------------------------------------------------------------------------
const fires = new Map<string, HTMLCanvasElement>();

/** Hoguera con piedras, leños y llama animada (4 fotogramas). */
export function drawFire(g: CanvasRenderingContext2D, x: number, y: number, t: number, big: boolean, still = false): void {
  const frame = still ? 0 : Math.floor(t / 110) % 4;
  const key = `${big ? 1 : 0}:${frame}`;
  let c = fires.get(key);
  if (!c) {
    const P = new Painter(30, 34, 15, 30);
    // Anillo de piedras.
    P.shadow(0, 0, 11, 3, 0.3);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const sx = Math.round(Math.cos(a) * 8.5);
      const sy = Math.round(Math.sin(a) * 3);
      P.rect(sx - 1, sy - 1, 3, 2, k % 2 ? '#7d776e' : '#948d82');
      P.px(sx - 1, sy - 1, '#aaa398');
    }
    // Leños cruzados.
    P.line(-6, 0, 5, -3, '#5a3a22');
    P.line(-6, -1, 5, -4, '#7a5232');
    P.line(-5, -3, 6, 0, '#6a4428');
    P.line(-5, -4, 6, -1, '#8a6038');
    P.px(-6, 0, '#c9a070');
    P.px(6, 0, '#c9a070');
    // Llama: capas roja, naranja, amarilla y núcleo, con lenguas que cambian.
    const H = big ? 15 : 10;
    const layer = (w: number, h: number, col: string, phase: number) => {
      for (let yy = 0; yy < h; yy++) {
        const k = yy / h;
        const half = Math.max(0, Math.round(w * (1 - k) * (0.85 + 0.25 * Math.sin(phase + yy * 0.9 + frame * 1.7))));
        const sway = Math.round(Math.sin(frame * 1.3 + yy * 0.45 + phase) * k * 1.6);
        for (let xx = -half; xx <= half; xx++) P.px(xx + sway, -3 - yy, col);
      }
    };
    layer(big ? 6 : 4, H, '#c9382a', 0);
    layer(big ? 5 : 3, H - 3, '#ef7a2a', 1.3);
    layer(big ? 3 : 2, H - 6, '#ffc94a', 2.1);
    layer(1, Math.max(2, H - 10), '#fff1b0', 0.4);
    // Lenguas sueltas y chispas.
    const tip = (frame * 3) % 5 - 2;
    P.px(tip, -3 - H - 1, '#ef7a2a');
    P.px(-tip, -3 - H + 1, '#c9382a');
    P.px(((frame * 5) % 7) - 3, -3 - H - 4 - (frame % 2), '#ffd970');
    P.px(((frame * 3) % 9) - 4, -3 - H - 7, '#ffb050');
    P.outline();
    c = P.toCanvas(false);
    fires.set(key, c);
  }
  g.drawImage(c, Math.round(x) - 15, Math.round(y) - 30);
}

const flames = new Map<number, HTMLCanvasElement>();

/** Llama de farol o antorcha: 3×5 píxeles con un halo punteado. */
export function drawFlame(g: CanvasRenderingContext2D, x: number, y: number, t: number, still = false): void {
  const frame = still ? 0 : Math.floor(t / 140 + x) % 3;
  let c = flames.get(frame);
  if (!c) {
    const P = new Painter(15, 15, 7, 9);
    // Halo de luz en píxeles sueltos (sin degradado).
    for (let yy = -6; yy <= 5; yy++)
      for (let xx = -6; xx <= 6; xx++) {
        const d = Math.hypot(xx, yy * 1.1);
        if (d < 6 && d > 2.5 && (xx + yy + 20) % 2 === 0) P.shadow(xx, yy, 0, 0, 0);
      }
    P.rect(-1, -1, 3, 3, '#ffb84a');
    P.rect(0, -3 + (frame === 1 ? 1 : 0), 1, 3, '#ffe27a');
    P.px(0, 0, '#fff6c8');
    if (frame === 2) P.px(1, -2, '#ffd36a');
    c = P.toCanvas(false);
    // El halo: píxeles cálidos semitransparentes.
    const g2 = c.getContext('2d')!;
    const img = g2.getImageData(0, 0, 15, 15);
    for (let i = 0; i < 15 * 15; i++)
      if (P.mask[i] === 2) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = 200;
        img.data[i * 4 + 2] = 110;
        img.data[i * 4 + 3] = 70;
      }
    g2.putImageData(img, 0, 0);
    flames.set(frame, c);
  }
  g.drawImage(c, Math.round(x) - 7, Math.round(y) - 9);
}

/** Bocanada de humo en píxeles: un disco que crece y se desvanece. */
export function drawPuff(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const R = Math.max(1, Math.round(r));
  g.fillStyle = `${color}${alpha.toFixed(3)})`;
  const X = Math.round(x);
  const Y = Math.round(y);
  for (let yy = -R; yy <= R; yy++) {
    const half = Math.round(Math.sqrt(Math.max(0, R * R - yy * yy)));
    g.fillRect(X - half, Y + yy, half * 2 + 1, 1);
  }
  // Borde superior más claro (volumen).
  g.fillStyle = `rgba(255,255,255,${(alpha * 0.35).toFixed(3)})`;
  g.fillRect(X - Math.round(R * 0.5), Y - R, Math.max(1, R), 1);
}

// ---------------------------------------------------------------------------
// Clima (en coordenadas del lienzo del mundo)
// ---------------------------------------------------------------------------
export interface Drop {
  x: number;
  y: number;
  s: number; // velocidad / tamaño
  ground: number; // fila donde cae (salpica)
  splash: number; // >0: fotograma de salpicadura
}

export class WeatherFx {
  private drops: Drop[] = [];
  flash = 0;

  /** Dibuja la lluvia, la nieve o el viento sobre el lienzo (bw×bh), avanzando dt segundos. */
  draw(g: CanvasRenderingContext2D, weather: string, bw: number, bh: number, t: number, dt: number, calm: boolean): void {
    const storm = weather === 'tormenta';
    const rain = weather === 'lluvia' || storm;
    const snow = weather === 'nieve';
    const wind = weather === 'viento';
    if (!rain && !snow && !wind) {
      this.drops.length = 0;
      return;
    }
    const area = (bw * bh) / 30000;
    const n = Math.round((calm ? 0.35 : 1) * area * (storm ? 150 : rain ? 95 : snow ? 120 : 45));
    if (this.drops.length > n) this.drops.length = n;
    while (this.drops.length < n) this.drops.push(this.spawn(bw, bh, true));
    const k = Math.min(3, dt * 60);
    if (rain) {
      const slant = storm ? 0.45 : 0.18;
      const len = storm ? 7 : 5;
      for (const d of this.drops) {
        if (d.splash > 0) {
          // Salpicadura de tres fotogramas: punto, corona, gotitas.
          const f = Math.floor(d.splash);
          g.fillStyle = 'rgba(205,222,240,0.85)';
          const X = Math.round(d.x);
          const Y = Math.round(d.ground);
          if (f === 1) g.fillRect(X, Y, 1, 1);
          else if (f === 2) (g.fillRect(X - 1, Y, 1, 1), g.fillRect(X + 1, Y, 1, 1), g.fillRect(X, Y - 1, 1, 1));
          else (g.fillRect(X - 2, Y, 1, 1), g.fillRect(X + 2, Y, 1, 1), g.fillRect(X - 1, Y - 2, 1, 1), g.fillRect(X + 1, Y - 2, 1, 1));
          d.splash += 0.25 * k;
          if (d.splash >= 4) Object.assign(d, this.spawn(bw, bh, false));
          continue;
        }
        d.y += (storm ? 5.5 : 4) * d.s * k;
        d.x -= slant * (storm ? 5.5 : 4) * d.s * k;
        const X = Math.round(d.x);
        const Y = Math.round(d.y);
        // Gota: trazo de píxeles en diagonal, más claro en la punta.
        for (let i = 0; i < len; i++) {
          g.fillStyle = i === len - 1 ? 'rgba(232,242,255,0.95)' : i === len - 2 ? 'rgba(200,220,245,0.8)' : 'rgba(170,195,225,0.6)';
          g.fillRect(X + Math.round(i * slant), Y - len + i, 1, 1);
        }
        if (d.y >= d.ground) d.splash = 1;
        if (d.x < -10) d.x += bw + 20;
      }
      if (storm && !calm) {
        if (this.flash <= 0 && Math.random() < 0.004) this.flash = 1;
        if (this.flash > 0) this.flash -= 0.06;
      }
      return;
    }
    if (snow) {
      for (const d of this.drops) {
        d.y += 0.45 * d.s * k;
        d.x += Math.sin(t / 900 + d.s * 7 + d.ground) * 0.25 * k;
        const X = Math.round(d.x);
        const Y = Math.round(d.y);
        if (d.s > 1.25) {
          // Copo cercano: cruz de 3×3 con centro brillante.
          g.fillStyle = 'rgba(214,224,240,0.9)';
          g.fillRect(X - 1, Y, 3, 1);
          g.fillRect(X, Y - 1, 1, 3);
          g.fillStyle = '#ffffff';
          g.fillRect(X, Y, 1, 1);
        } else {
          g.fillStyle = d.s > 0.9 ? '#f4f8ff' : 'rgba(230,238,250,0.75)';
          g.fillRect(X, Y, d.s > 0.9 ? 2 : 1, d.s > 0.9 ? 2 : 1);
        }
        if (d.y > bh + 4) Object.assign(d, this.spawn(bw, bh, false));
      }
      return;
    }
    // Viento: hojas que vuelan y ráfagas de aire en trazos discontinuos.
    const gust = 0.6 + Math.sin(t / 1400) * 0.4;
    g.fillStyle = 'rgba(245,245,235,0.4)';
    for (let i = 0; i < Math.max(3, Math.round(area * 4)); i++) {
      const y = Math.round((i * 53 + t * 0.006) % bh);
      const x = Math.round(((t * 0.18 * gust + i * 131) % (bw + 120)) - 60);
      g.fillRect(x, y, 10 + (i % 3) * 4, 1);
      g.fillRect(x + 16 + (i % 3) * 4, y - 1, 6, 1);
    }
    const LEAVES = ['#c9862f', '#9a6424', '#7aa04a', '#d8a83a', '#b8462a'];
    for (const [i, d] of this.drops.entries()) {
      d.x += (1.6 + d.s) * gust * k;
      d.y += (Math.sin(t / 260 + i) * 0.45 + 0.12) * k;
      const X = Math.round(d.x);
      const Y = Math.round(d.y);
      const flip = Math.floor(t / 160 + i) % 2;
      g.fillStyle = LEAVES[i % LEAVES.length];
      if (flip) g.fillRect(X, Y, 2, 1);
      else (g.fillRect(X, Y, 1, 2), g.fillRect(X + 1, Y + 1, 1, 1));
      if (d.x > bw + 6) Object.assign(d, this.spawn(bw, bh, false)), (d.x = -4);
      if (d.y > bh + 4) d.y = -2;
    }
  }

  private spawn(bw: number, bh: number, anywhere: boolean): Drop {
    const s = 0.6 + Math.random() * 0.9;
    return { x: Math.random() * (bw + 40), y: anywhere ? Math.random() * bh : -8 - Math.random() * 30, s, ground: 6 + Math.random() * (bh - 6), splash: 0 };
  }
}
