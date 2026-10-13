
/**
 * Fuego, llamas de farol y humo, pintados con degradados (el clima vive en
 * `visual/weather.ts`).
 */

// ---------------------------------------------------------------------------
// Fuego (pintado, con llamas que se mueven sin fotogramas)
// ---------------------------------------------------------------------------
let stones: HTMLCanvasElement | null = null;

/** Hoguera: anillo de piedras, leños y lenguas de fuego que se mecen; chispas que suben. */
export function drawFire(g: CanvasRenderingContext2D, x: number, y: number, t: number, big: boolean, still = false): void {
  if (!stones) {
    stones = document.createElement('canvas');
    stones.width = 96;
    stones.height = 48;
    const s = stones.getContext('2d')!;
    s.scale(3, 3);
    s.translate(16, 10);
    const sh = s.createRadialGradient(0, 0, 0, 0, 0, 13);
    sh.addColorStop(0, 'rgba(20,14,10,0.45)');
    sh.addColorStop(1, 'rgba(20,14,10,0)');
    s.fillStyle = sh;
    s.beginPath();
    s.ellipse(0, 0, 13, 5, 0, 0, Math.PI * 2);
    s.fill();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const sx = Math.cos(a) * 8.5;
      const sy = Math.sin(a) * 3.2;
      const gr = s.createLinearGradient(sx - 2, sy - 2, sx + 2, sy + 2);
      gr.addColorStop(0, '#b4ada0');
      gr.addColorStop(1, '#5e5850');
      s.fillStyle = gr;
      s.beginPath();
      s.ellipse(sx, sy, 2.2, 1.5, a, 0, Math.PI * 2);
      s.fill();
    }
    for (const [x1, y1, x2, y2, c] of [[-6, 0.5, 5, -2.5, '#6a4428'], [-5, -2.5, 6, 0.5, '#8a6038']] as const) {
      s.strokeStyle = c;
      s.lineWidth = 2;
      s.lineCap = 'round';
      s.beginPath();
      s.moveTo(x1, y1);
      s.lineTo(x2, y2);
      s.stroke();
    }
  }
  g.drawImage(stones, x - 16, y - 10, 32, 16);
  const H = big ? 17 : 11;
  const tt = still ? 0 : t / 1000;
  // Brillo en el suelo.
  g.drawImage(soft('rgba(255,170,70,0.35)', 'rgba(255,120,40,0)'), x - H * 1.6, y - 1 - H * 0.7, H * 3.2, H * 1.4);
  // Lenguas: de fuera (rojo) a dentro (casi blanco).
  const tongue = (w: number, h: number, c0: string, c1: string, ph: number) => {
    const sway = Math.sin(tt * 7 + ph) * w * 0.35;
    const hh = h * (0.85 + Math.sin(tt * 9 + ph * 2) * 0.12);
    // (color sólido: cinco degradados nuevos por hoguera y fotograma eran demasiados)
    void c1;
    g.fillStyle = c0;
    g.beginPath();
    g.moveTo(x - w, y - 2);
    g.bezierCurveTo(x - w * 1.1, y - 3 - hh * 0.5, x + sway - w * 0.2, y - 3 - hh * 0.75, x + sway, y - 3 - hh);
    g.bezierCurveTo(x + sway + w * 0.25, y - 3 - hh * 0.7, x + w * 1.1, y - 3 - hh * 0.45, x + w, y - 2);
    g.closePath();
    g.fill();
  };
  const W = big ? 6 : 4.2;
  tongue(W, H, 'rgba(200,50,30,0.95)', 'rgba(220,70,30,0)', 0);
  tongue(W * 0.6, H * 0.85, 'rgba(250,120,40,0.95)', 'rgba(250,140,40,0)', 1.7);
  tongue(W * 0.85, H * 0.7, 'rgba(240,110,40,0.9)', 'rgba(240,120,40,0)', 3.1);
  tongue(W * 0.45, H * 0.55, 'rgba(255,214,110,0.95)', 'rgba(255,220,120,0)', 4.4);
  tongue(W * 0.22, H * 0.35, 'rgba(255,248,210,1)', 'rgba(255,248,210,0)', 5.2);
  // Chispas.
  if (!still)
    for (let i = 0; i < (big ? 5 : 3); i++) {
      const k = (tt * 0.8 + i * 0.37) % 1;
      g.fillStyle = `rgba(255,210,120,${(1 - k).toFixed(3)})`;
      g.fillRect(x + Math.sin(tt * 3 + i * 2) * 4 * k + (i - 2) * 1.5, y - 4 - H - k * 14, 0.7, 0.7);
    }
}

/** Llama de farol o antorcha con su halo cálido. */
export function drawFlame(g: CanvasRenderingContext2D, x: number, y: number, t: number, still = false): void {
  const fl = still ? 1 : 0.9 + Math.sin(t / 130 + x) * 0.06 + Math.sin(t / 47 + x * 3) * 0.04;
  const r = 9 * fl;
  g.drawImage(soft('rgba(255,220,140,0.55)', 'rgba(255,170,80,0)'), x - r, y - r, r * 2, r * 2);
  g.drawImage(soft('#fffbe8', 'rgba(240,140,50,0)', '#ffd56a'), x - 1.6 * fl, y - 0.5 - 2.6 * fl, 3.2 * fl, 5.2 * fl);
}

/** Bocanada de humo suave. `color` es un prefijo «rgba(r,g,b,». */
export function drawPuff(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const ga = g.globalAlpha;
  g.globalAlpha = ga * Math.min(1, alpha);
  g.drawImage(soft(`${color}0.9)`, `${color}0)`, `${color}0.5)`), x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
  g.globalAlpha = ga;
}

/** Mancha radial suave pintada una vez por combinación de colores (sin degradados por fotograma). */
const softCache = new Map<string, HTMLCanvasElement>();
function soft(c0: string, c1: string, mid?: string): HTMLCanvasElement {
  const key = `${c0}|${mid ?? ''}|${c1}`;
  let c = softCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, c0);
  if (mid) gr.addColorStop(0.5, mid);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  softCache.set(key, c);
  return c;
}
