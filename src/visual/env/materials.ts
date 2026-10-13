import { alpha, ell, lit, rng, shd } from '../paint';

/**
 * Texturas de material del suelo, repetibles sin costuras (64×64 píxeles de
 * mundo), pintadas a la resolución del suelo. No son el color del suelo
 * (eso lo da la capa base, continua): son el detalle que se le pone encima
 * — briznas de hierba, guijarros, adoquines, granos de arena, grietas en la
 * roca, surcos, tablones — para que de cerca nada parezca una mancha plana.
 */
export const MT = 64;

export type Material = 'hierba' | 'pradera' | 'bosque' | 'tierra' | 'camino' | 'adoquin' | 'arena' | 'roca' | 'barro' | 'surcos' | 'tablas' | 'nieve' | 'sal' | 'arcilla';

const cache = new Map<string, HTMLCanvasElement>();


export function materialTexture(m: Material, res: number, season = 'verano'): HTMLCanvasElement {
  const key = `${m}:${res}:${season}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(MT * res);
  const g = c.getContext('2d')!;
  g.scale(res, res);
  g.lineCap = 'round';
  // Los números al azar que se piden dentro de `wrap` se graban en la primera
  // copia y se repiten en las desplazadas: la pieza que cruza el borde es la misma.
  const R0 = rng(m.length * 977 + res * 13 + season.length);
  let tape: number[] | null = null;
  let rec = false;
  let pos = 0;
  const R = () => {
    if (tape && !rec) return tape[pos++] ?? R0();
    const v = R0();
    if (rec) tape!.push(v);
    return v;
  };
  /** Dibuja `fn` también desplazado ±MT para que lo que cruza el borde reaparezca por el otro lado. */
  const wrap = (_g: CanvasRenderingContext2D, x: number, y: number, r: number, fn: (x: number, y: number) => void) => {
    tape = [];
    rec = true;
    fn(x, y);
    rec = false;
    for (const dx of [0, -MT, MT])
      for (const dy of [0, -MT, MT])
        if ((dx || dy) && (dx === 0 || Math.abs(x + dx - MT / 2) < MT / 2 + r) && (dy === 0 || Math.abs(y + dy - MT / 2) < MT / 2 + r)) {
          pos = 0;
          fn(x + dx, y + dy);
        }
    tape = null;
  };
  const autumn = season === 'otoño';
  const winter = season === 'invierno';
  switch (m) {
    case 'hierba':
    case 'pradera':
    case 'bosque': {
      // Briznas en matas: oscuras abajo, claras en la punta; alguna flor o trébol.
      const n = m === 'pradera' ? 420 : m === 'bosque' ? 260 : 360;
      for (let i = 0; i < n; i++) {
        const x = R() * MT;
        const y = R() * MT;
        const h = 1.2 + R() * (m === 'pradera' ? 2.6 : 1.8);
        const lean = (R() - 0.5) * 1.4;
        const dark = R() < 0.5;
        wrap(g, x, y, 3, (X, Y) => {
          g.strokeStyle = dark ? 'rgba(18,40,14,0.32)' : autumn ? 'rgba(214,176,90,0.32)' : winter ? 'rgba(200,210,190,0.25)' : 'rgba(196,232,120,0.34)';
          g.lineWidth = 0.32;
          g.beginPath();
          g.moveTo(X, Y);
          g.quadraticCurveTo(X + lean * 0.3, Y - h * 0.6, X + lean, Y - h);
          g.stroke();
        });
      }
      if (m === 'bosque') {
        // Hojarasca y musgo.
        for (let i = 0; i < 70; i++) {
          const x = R() * MT;
          const y = R() * MT;
          const col = autumn ? ['rgba(190,110,40,0.55)', 'rgba(160,80,30,0.5)', 'rgba(210,160,60,0.5)'][i % 3] : ['rgba(90,70,40,0.45)', 'rgba(60,90,40,0.4)', 'rgba(120,100,60,0.4)'][i % 3];
          wrap(g, x, y, 2, (X, Y) => ell(g, X, Y, 0.9, 0.5, col, R() * 3));
        }
      }
      if (!winter) for (let i = 0; i < (m === 'pradera' ? 26 : 10); i++) {
        const x = R() * MT;
        const y = R() * MT;
        const col = season === 'primavera' || season === 'verano' ? ['#f6e27a', '#f2f0e8', '#e8a8c8', '#b8a8f0', '#f0b860'][i % 5] : '#d8b060';
        wrap(g, x, y, 2, (X, Y) => {
          ell(g, X, Y, 0.55, 0.45, col);
          ell(g, X - 0.12, Y - 0.12, 0.2, 0.18, 'rgba(255,255,255,0.7)');
        });
      }
      break;
    }
    case 'tierra':
    case 'camino':
    case 'arcilla': {
      // Guijarros con luz y sombra, grietas finas y, en los caminos, roderas.
      for (let i = 0; i < (m === 'camino' ? 140 : 90); i++) {
        const x = R() * MT;
        const y = R() * MT;
        const r = 0.25 + R() * (R() < 0.08 ? 1.3 : 0.55);
        wrap(g, x, y, 2, (X, Y) => {
          ell(g, X + r * 0.25, Y + r * 0.3, r * 1.05, r * 0.8, 'rgba(40,26,16,0.35)');
          ell(g, X, Y, r, r * 0.75, m === 'arcilla' ? 'rgba(200,130,90,0.6)' : 'rgba(170,150,120,0.6)');
          ell(g, X - r * 0.3, Y - r * 0.3, r * 0.45, r * 0.3, 'rgba(255,240,210,0.45)');
        });
      }
      g.strokeStyle = 'rgba(50,34,20,0.18)';
      g.lineWidth = 0.25;
      for (let i = 0; i < 18; i++) {
        const x = R() * MT;
        const y = R() * MT;
        wrap(g, x, y, 6, (X, Y) => {
          g.beginPath();
          g.moveTo(X, Y);
          g.lineTo(X + (R() - 0.5) * 6, Y + (R() - 0.5) * 3);
          g.lineTo(X + (R() - 0.5) * 9, Y + (R() - 0.5) * 5);
          g.stroke();
        });
      }
      if (m === 'camino') {
        g.fillStyle = 'rgba(60,40,24,0.12)';
        for (let i = 0; i < 26; i++) ell(g, R() * MT, R() * MT, 2 + R() * 3, 0.8 + R(), 'rgba(80,56,32,0.10)');
      }
      break;
    }
    case 'adoquin': {
      // Adoquines pequeños y gastados, en hileras que no casan del todo; juntas
      // de tierra con algo de musgo. Contraste contenido: es suelo, no protagonista.
      g.fillStyle = '#6a6056';
      g.fillRect(0, 0, MT, MT);
      const rows = 16;
      const h = MT / rows;
      for (let j = 0; j < rows; j++) {
        // Anchos que suman exactamente MT: la hilera casa consigo misma al repetirse.
        const ws: number[] = [];
        let sum = 0;
        while (sum < MT - 0.01) {
          const ww = Math.min(MT - sum, 4.2 + R() * 2.4);
          ws.push(ww);
          sum += ww;
        }
        if (ws.length > 1 && ws[ws.length - 1] < 2.4) ws[ws.length - 2] += ws.pop()!;
        let x = R() * MT;
        for (const ww of ws) {
          const sx = x;
          const tone = 132 + Math.floor(R() * 26);
          const warm = R() < 0.35 ? 10 : 0;
          const base = `rgb(${tone + 8 + warm},${tone + 3 + warm * 0.5},${tone - 6})`;
          const dy = (R() - 0.5) * 0.35;
          const moss = R() < 0.18;
          wrap(g, sx + ww / 2, j * h + h / 2, ww, (X) => {
            const x0 = X - ww / 2;
            const y0 = j * h + dy;
            const gr = g.createLinearGradient(x0, y0, x0 + ww * 0.6, y0 + h);
            gr.addColorStop(0, lit(base, 0.1));
            gr.addColorStop(0.55, base);
            gr.addColorStop(1, shd(base, 0.16));
            g.fillStyle = gr;
            g.beginPath();
            g.roundRect(x0 + 0.3, y0 + 0.3, ww - 0.6, h - 0.55, Math.min(ww, h) * 0.42);
            g.fill();
            if (moss) ell(g, x0 + ww - 0.4, y0 + h * 0.75, 0.9, 0.35, 'rgba(96,120,62,0.45)');
          });
          x = (x + ww) % MT;
        }
      }
      break;
    }
    case 'arena':
    case 'sal': {
      g.strokeStyle = m === 'sal' ? 'rgba(255,255,255,0.35)' : 'rgba(150,120,70,0.22)';
      g.lineWidth = 0.35;
      for (let k = 0; k < 9; k++) {
        const y0 = (k / 9) * MT + R() * 2;
        wrap(g, MT / 2, y0, 4, (_X, Y) => {
          g.beginPath();
          g.moveTo(0, Y);
          for (let x = 0; x <= MT; x += 4) g.lineTo(x, Y + Math.sin(x * 0.2 + k) * 0.8);
          g.stroke();
        });
      }
      for (let i = 0; i < 260; i++) {
        const x = R() * MT;
        const y = R() * MT;
        ell(g, x, y, 0.18, 0.18, R() < 0.5 ? 'rgba(120,96,60,0.4)' : 'rgba(255,248,230,0.55)');
      }
      break;
    }
    case 'roca': {
      // Facetas y grietas: la piedra tiene planos con luz.
      for (let i = 0; i < 22; i++) {
        const x = R() * MT;
        const y = R() * MT;
        const r = 2 + R() * 4;
        wrap(g, x, y, r + 1, (X, Y) => {
          g.fillStyle = 'rgba(255,250,240,0.12)';
          g.beginPath();
          g.moveTo(X - r, Y);
          g.lineTo(X - r * 0.2, Y - r * 0.7);
          g.lineTo(X + r * 0.6, Y - r * 0.3);
          g.lineTo(X, Y + r * 0.2);
          g.fill();
          g.fillStyle = 'rgba(30,26,40,0.16)';
          g.beginPath();
          g.moveTo(X, Y + r * 0.2);
          g.lineTo(X + r * 0.6, Y - r * 0.3);
          g.lineTo(X + r, Y + r * 0.4);
          g.lineTo(X + r * 0.1, Y + r * 0.7);
          g.fill();
        });
      }
      g.strokeStyle = 'rgba(30,26,34,0.35)';
      g.lineWidth = 0.3;
      for (let i = 0; i < 14; i++) {
        const x = R() * MT;
        const y = R() * MT;
        wrap(g, x, y, 8, (X, Y) => {
          g.beginPath();
          g.moveTo(X, Y);
          g.lineTo(X + (R() - 0.5) * 8, Y + R() * 4);
          g.lineTo(X + (R() - 0.5) * 12, Y + R() * 7);
          g.stroke();
        });
      }
      break;
    }
    case 'barro': {
      for (let i = 0; i < 16; i++) {
        const x = R() * MT;
        const y = R() * MT;
        const r = 1.5 + R() * 4;
        wrap(g, x, y, r + 1, (X, Y) => {
          ell(g, X, Y, r, r * 0.55, 'rgba(60,80,80,0.35)');
          ell(g, X - r * 0.3, Y - r * 0.15, r * 0.5, r * 0.12, 'rgba(220,235,240,0.35)');
        });
      }
      for (let i = 0; i < 120; i++) {
        const x = R() * MT;
        const y = R() * MT;
        wrap(g, x, y, 3, (X, Y) => {
          g.strokeStyle = 'rgba(40,70,30,0.4)';
          g.lineWidth = 0.3;
          g.beginPath();
          g.moveTo(X, Y);
          g.lineTo(X + (R() - 0.5), Y - 2 - R() * 2);
          g.stroke();
        });
      }
      break;
    }
    case 'surcos': {
      // Surcos en hileras con lo que crece según la estación.
      for (let y = 0; y < MT; y += 4) {
        g.fillStyle = 'rgba(40,26,14,0.30)';
        g.fillRect(0, y + 2.6, MT, 1.1);
        g.fillStyle = 'rgba(255,230,190,0.16)';
        g.fillRect(0, y + 0.6, MT, 0.7);
        if (season === 'invierno') continue;
        for (let x = 0.5 + (y % 8 ? 1 : 0); x < MT; x += 2.2) {
          const ripe = season === 'verano' || autumn;
          const col = autumn ? '#c89a40' : season === 'verano' ? '#d8b850' : '#6ea848';
          const hgt = season === 'primavera' ? 1.2 : 2.6;
          g.strokeStyle = col;
          g.lineWidth = ripe ? 0.45 : 0.55;
          g.beginPath();
          g.moveTo(x, y + 2.4);
          g.lineTo(x + (R() - 0.5) * 0.6, y + 2.4 - hgt);
          g.stroke();
          if (ripe) ell(g, x + 0.1, y + 2.4 - hgt, 0.35, 0.6, lit(col, 0.2));
        }
      }
      break;
    }
    case 'tablas': {
      for (let x = 0; x < MT; x += 4) {
        const tone = 120 + Math.floor(R() * 30);
        const base = `rgb(${tone + 20},${tone - 10},${tone - 50})`;
        const gr = g.createLinearGradient(x, 0, x + 4, 0);
        gr.addColorStop(0, lit(base, 0.12));
        gr.addColorStop(0.8, base);
        gr.addColorStop(1, shd(base, 0.45));
        g.fillStyle = gr;
        g.fillRect(x, 0, 4, MT);
        g.strokeStyle = alpha(shd(base, 0.4), 0.5);
        g.lineWidth = 0.2;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.moveTo(x + 1 + k, 0);
          g.lineTo(x + 1 + k + (R() - 0.5), MT);
          g.stroke();
        }
        ell(g, x + 2, R() * MT, 0.35, 0.35, '#3a2a1a');
      }
      break;
    }
    case 'nieve': {
      for (let i = 0; i < 60; i++) {
        const x = R() * MT;
        const y = R() * MT;
        wrap(g, x, y, 4, (X, Y) => ell(g, X, Y, 2 + R() * 3, 0.5 + R() * 0.6, 'rgba(170,190,225,0.18)'));
      }
      for (let i = 0; i < 90; i++) ell(g, R() * MT, R() * MT, 0.18, 0.18, 'rgba(255,255,255,0.9)');
      break;
    }
  }
  cache.set(key, c);
  return c;
}

export function clearMaterials(): void {
  cache.clear();
}
