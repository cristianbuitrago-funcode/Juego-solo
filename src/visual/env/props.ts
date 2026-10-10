import { alpha, ell, lit, rng, shd, tex, vgrad, type Tex } from '../paint';

/**
 * Mobiliario, mercado y animales pintados con el mismo lenguaje que los
 * edificios: madera con veta y cantos iluminados, hierro forjado, piedra,
 * agua con reflejos, telas a rayas. Las medidas y anclas son las mismas que
 * las del diseño anterior, así que la colocación en los pueblos no cambia.
 */
const WOOD = '#8a6440';
const WOOD_D = '#5a3c24';
const IRON = '#2c2a2e';

function plank(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c = WOOD): void {
  g.fillStyle = vgrad(g, y, y + h, [[0, lit(c, 0.2)], [0.35, c], [1, shd(c, 0.35)]]);
  g.fillRect(x, y, w, h);
  g.strokeStyle = alpha(shd(c, 0.5), 0.45);
  g.lineWidth = 0.25;
  for (let k = 1; k < 3; k++) {
    g.beginPath();
    g.moveTo(x, y + (h * k) / 3);
    g.quadraticCurveTo(x + w / 2, y + (h * k) / 3 + 0.3, x + w, y + (h * k) / 3);
    g.stroke();
  }
}

function post(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c = WOOD_D): void {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, lit(c, 0.18));
  gr.addColorStop(0.4, c);
  gr.addColorStop(1, shd(c, 0.4));
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}

export type PropKind = 'banco' | 'farol' | 'barril' | 'cajas' | 'fuente' | 'pozo' | 'estatua' | 'valla' | 'vallaV' | 'heno' | 'lenya' | 'carro' | 'cartel' | 'abrevadero';

const DIMS: Record<PropKind, [number, number, number, number]> = {
  banco: [34, 20, 17, 18],
  farol: [16, 46, 8, 44],
  barril: [18, 22, 9, 20],
  cajas: [30, 28, 15, 26],
  fuente: [60, 56, 30, 48],
  estatua: [40, 70, 20, 64],
  pozo: [44, 56, 22, 50],
  valla: [18, 16, 9, 15],
  vallaV: [6, 20, 3, 19],
  heno: [34, 30, 17, 27],
  lenya: [32, 20, 16, 18],
  carro: [58, 40, 29, 37],
  cartel: [30, 48, 15, 46],
  abrevadero: [40, 20, 20, 18],
};

export function propTex(kind: PropKind, v = 0): Tex {
  const [w, h, ax, ay] = DIMS[kind];
  const vv = kind === 'cajas' || kind === 'heno' || kind === 'carro' || kind === 'fuente' || kind === 'farol' ? v % 2 : 0;
  return tex(`prop2:${kind}:${vv}`, w, h, ax, ay, (g) => {
    g.translate(-ax, -ay);
    const R = rng(kind.length * 31 + vv);
    switch (kind) {
      case 'banco':
        post(g, 4, 11, 3, 7);
        post(g, 27, 11, 3, 7);
        plank(g, 2, 8, 30, 3.6);
        plank(g, 2, 2.5, 30, 3.2);
        post(g, 4, 5, 2.4, 4);
        post(g, 27.6, 5, 2.4, 4);
        break;
      case 'farol': {
        post(g, 6.6, 12, 2.8, 32, IRON);
        g.fillStyle = IRON;
        g.fillRect(4.5, 42, 7, 2.4);
        g.fillRect(3.6, 10, 8.8, 2);
        // Farolillo con cristal: v = 1 encendido (ámbar); de día, cristal apagado que refleja el cielo.
        g.fillStyle = vv === 1 ? vgrad(g, 2, 10, [[0, '#fff2c0'], [1, '#e0a048']]) : vgrad(g, 2, 10, [[0, '#c8d4dc'], [0.5, '#7a8890'], [1, '#4a545a']]);
        g.fillRect(4.3, 2.5, 7.4, 7.5);
        g.strokeStyle = IRON;
        g.lineWidth = 0.7;
        g.strokeRect(4.3, 2.5, 7.4, 7.5);
        g.beginPath();
        g.moveTo(8, 2.5);
        g.lineTo(8, 10);
        g.stroke();
        g.fillStyle = IRON;
        g.beginPath();
        g.moveTo(3, 2.6);
        g.lineTo(13, 2.6);
        g.lineTo(8, -1.5);
        g.fill();
        break;
      }
      case 'barril': {
        const gr = g.createLinearGradient(2, 0, 16, 0);
        gr.addColorStop(0, shd(WOOD, 0.2));
        gr.addColorStop(0.35, lit(WOOD, 0.2));
        gr.addColorStop(1, shd(WOOD, 0.45));
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(3, 4);
        g.quadraticCurveTo(1.2, 11.5, 3, 19);
        g.lineTo(15, 19);
        g.quadraticCurveTo(16.8, 11.5, 15, 4);
        g.closePath();
        g.fill();
        for (const y of [6.5, 15.5]) {
          g.fillStyle = vgrad(g, y, y + 1.6, [[0, '#7a7a80'], [1, '#3a3a40']]);
          g.fillRect(1.8, y, 14.4, 1.6);
        }
        ell(g, 9, 4, 6, 1.8, vgrad(g, 2, 6, [[0, '#b08858'], [1, '#7a5a38']]));
        break;
      }
      case 'cajas':
        for (const [x, y, s] of vv ? [[2, 12, 14], [15, 14, 12], [6, 0, 12]] : [[3, 10, 16], [17, 16, 10]]) {
          plank(g, x, y, s, s, '#a07a4e');
          g.strokeStyle = WOOD_D;
          g.lineWidth = 0.9;
          g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
          g.beginPath();
          g.moveTo(x + 1, y + 1);
          g.lineTo(x + s - 1, y + s - 1);
          g.stroke();
        }
        break;
      case 'fuente': {
        // Pila de piedra, agua con reflejos, columna y surtidores.
        ell(g, 30, 41, 27, 11, vgrad(g, 30, 52, [[0, '#b4ac9c'], [1, '#7a7466']]));
        ell(g, 30, 39, 24, 9, '#8a8274');
        // v = 1: helada (el agua es hielo blanco azulado y no hay surtidores).
        const frozen = vv === 1;
        const wg = g.createRadialGradient(24, 36, 2, 30, 39, 22);
        wg.addColorStop(0, frozen ? '#eef4fa' : '#8ec4d8');
        wg.addColorStop(0.6, frozen ? '#bcd0e2' : '#3f7c96');
        wg.addColorStop(1, frozen ? '#8aa4bc' : '#2a5a70');
        ell(g, 30, 38.5, 22, 8, wg);
        if (frozen) {
          g.strokeStyle = 'rgba(255,255,255,0.7)';
          g.lineWidth = 0.4;
          for (let i = 0; i < 5; i++) {
            const x = 16 + R() * 26;
            g.beginPath();
            g.moveTo(x, 34 + R() * 3);
            g.lineTo(x + (R() - 0.5) * 8, 38 + R() * 4);
            g.stroke();
          }
        }
        const cg = g.createLinearGradient(26, 0, 34, 0);
        cg.addColorStop(0, '#a8a090');
        cg.addColorStop(0.35, '#ddd6c6');
        cg.addColorStop(1, '#8a8274');
        g.fillStyle = cg;
        g.fillRect(26, 13, 8, 24);
        ell(g, 30, 13, 9, 3.4, vgrad(g, 10, 16, [[0, '#d4ccbc'], [1, '#9a9284']]));
        ell(g, 30, 11.5, 5, 1.8, frozen ? '#c8d8e8' : '#5f9ab4');
        // Los surtidores y las ondas se animan en la escena (drawFountainWater).
        break;
      }
      case 'estatua': {
        // Monumento: pedestal de piedra escalonado y una figura de bronce con verdín.
        const cx = 20;
        g.fillStyle = vgrad(g, 52, 64, [[0, '#b4ac9c'], [1, '#7a7466']]);
        g.fillRect(cx - 17, 56, 34, 8);
        g.fillStyle = vgrad(g, 34, 56, [[0, '#cfc7b6'], [1, '#948c7c']]);
        g.fillRect(cx - 11, 34, 22, 22);
        g.fillStyle = 'rgba(40,30,20,0.35)';
        g.fillRect(cx - 7, 42, 14, 2);
        g.fillRect(cx - 5, 46, 10, 1.5);
        g.fillStyle = '#a8a090';
        g.fillRect(cx - 13, 32, 26, 3);
        const bronze = vgrad(g, 4, 32, [[0, '#7aa08a'], [0.5, '#4f6e5e'], [1, '#3a5246']]);
        g.fillStyle = bronze;
        g.beginPath();
        // Figura de pie, con capa y el brazo alzado.
        g.moveTo(cx - 6, 32);
        g.quadraticCurveTo(cx - 7, 20, cx - 4, 14);
        g.lineTo(cx + 4, 14);
        g.quadraticCurveTo(cx + 7, 20, cx + 6, 32);
        g.closePath();
        g.fill();
        ell(g, cx, 10.5, 3, 3.4, bronze);
        g.strokeStyle = '#4f6e5e';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx + 3.5, 16);
        g.lineTo(cx + 9, 6);
        g.stroke();
        g.fillStyle = 'rgba(200,230,210,0.35)';
        g.fillRect(cx - 4, 15, 1.4, 15);
        break;
      }
      case 'pozo': {
        ell(g, 22, 44, 16, 7, vgrad(g, 37, 51, [[0, '#a8a090'], [1, '#6e685c']]));
        ell(g, 22, 42.5, 12, 5, '#121a1e');
        ell(g, 20, 41.5, 5, 1.2, 'rgba(120,170,200,0.4)');
        post(g, 6, 16, 3, 27);
        post(g, 35, 16, 3, 27);
        g.fillStyle = vgrad(g, 4, 18, [[0, '#a85a34'], [1, '#6a341c']]);
        g.beginPath();
        g.moveTo(1, 18);
        g.lineTo(22, 4);
        g.lineTo(43, 18);
        g.closePath();
        g.fill();
        g.strokeStyle = '#c9b48a';
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(22, 17);
        g.lineTo(22, 34);
        g.stroke();
        plank(g, 18.5, 32, 7, 5, '#7a5532');
        break;
      }
      case 'valla':
        post(g, 1, 2, 2.5, 13, '#7a5a38');
        post(g, 14.5, 2, 2.5, 13, '#7a5a38');
        plank(g, 0, 4.6, 18, 2.2, '#9a7a52');
        plank(g, 0, 9.6, 18, 2.2, '#9a7a52');
        break;
      case 'vallaV':
        post(g, 1.5, 0, 3, 19, '#7a5a38');
        break;
      case 'heno': {
        g.fillStyle = vgrad(g, 2, 26, [[0, '#f2d880'], [1, '#b8963a']]);
        g.beginPath();
        g.moveTo(2, 26);
        g.quadraticCurveTo(4, 2, 17, 2);
        g.quadraticCurveTo(30, 2, 32, 26);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(150,110,40,0.55)';
        g.lineWidth = 0.4;
        for (let k = 0; k < 40; k++) {
          const x = 4 + R() * 26;
          g.beginPath();
          g.moveTo(x, 25);
          g.quadraticCurveTo(x + (R() - 0.5) * 4, 14, 17 + (x - 17) * 0.4, 4);
          g.stroke();
        }
        break;
      }
      case 'lenya':
        for (let i = 0; i < 9; i++) {
          const x = 5 + (i % 4) * 7 + (Math.floor(i / 4) % 2) * 3.5;
          const y = 15 - Math.floor(i / 4) * 5.5;
          ell(g, x, y, 3.4, 3, vgrad(g, y - 3, y + 3, [[0, '#a07850'], [1, '#5a3c24']]));
          ell(g, x, y, 1.9, 1.7, '#d8b88a');
          ell(g, x, y, 0.7, 0.6, '#a07850');
        }
        break;
      case 'carro': {
        plank(g, 6, 14, 40, 14);
        g.strokeStyle = WOOD_D;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(46, 22);
        g.lineTo(58, 26);
        g.stroke();
        for (const wx of [14, 38]) {
          ell(g, wx, 30, 7, 7, '#3a2618');
          ell(g, wx, 30, 5.6, 5.6, vgrad(g, 24, 36, [[0, '#8a6440'], [1, '#4a3020']]));
          for (let a = 0; a < 8; a++) {
            g.strokeStyle = '#3a2618';
            g.lineWidth = 0.8;
            g.beginPath();
            g.moveTo(wx, 30);
            g.lineTo(wx + Math.cos((a / 8) * 6.28) * 5.5, 30 + Math.sin((a / 8) * 6.28) * 5.5);
            g.stroke();
          }
          ell(g, wx, 30, 1.6, 1.6, '#9a7a52');
        }
        if (vv) for (let i = 0; i < 3; i++) ell(g, 14 + i * 10, 12, 5, 4, vgrad(g, 8, 16, [[0, '#ead6a4'], [1, '#a88a5a']]));
        break;
      }
      case 'cartel':
        post(g, 13, 6, 4, 40);
        g.fillStyle = vgrad(g, 8, 16, [[0, '#c09868'], [1, '#86643c']]);
        g.beginPath();
        g.moveTo(1, 8);
        g.lineTo(24, 8);
        g.lineTo(29, 12);
        g.lineTo(24, 16);
        g.lineTo(1, 16);
        g.fill();
        g.fillStyle = vgrad(g, 20, 28, [[0, '#b08858'], [1, '#7a5a34']]);
        g.beginPath();
        g.moveTo(6, 20);
        g.lineTo(29, 20);
        g.lineTo(29, 28);
        g.lineTo(6, 28);
        g.lineTo(1, 24);
        g.fill();
        g.strokeStyle = 'rgba(40,24,12,0.5)';
        g.lineWidth = 0.5;
        for (const [x0, y0] of [[4, 12], [9, 24]]) {
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x0 + 14, y0);
          g.stroke();
        }
        break;
      case 'abrevadero':
        plank(g, 2, 6, 36, 10, '#7a5532');
        g.fillStyle = vgrad(g, 7, 11, [[0, '#7ab0c8'], [1, '#2a5a70']]);
        g.fillRect(4, 7, 32, 4);
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Mercado y campamentos
// ---------------------------------------------------------------------------
/**
 * Puesto del mercado. `part` lo parte en dos capas para que quien atiende quede entre ellas:
 * 'back' (postes y toldo, detrás de la persona) y 'front' (mostrador y género, delante).
 */
/** Cuánto sube el puesto dibujado (la tela de arriba del toldo), en píxeles de mundo desde su pie. */
export const STALL_TOP_PX = 35 + (25 + 3) * 0.8;

export function stallTex(full: boolean, color: string, v = 0, goods?: string[], part: 'all' | 'back' | 'front' = 'all'): Tex {
  // El toldo va por encima de la cabeza de quien atiende (postes largos) y se dibuja en la capa de
  // delante: así es un techo sobre la persona y no una cortina detrás de ella.
  return tex(`stall4:${part}:${full}:${color}:${v % 3}:${goods?.join(',') ?? ''}`, 38, 60, 19, 57, (g) => {
    g.translate(-19, -35);
    g.scale(0.8, 0.8);
    const A = -25; // cuánto sube el toldo (en unidades de antes de escalar)
    const back = part !== 'front';
    const front = part !== 'back';
    if (back) post(g, 4, 14 + A, 3, 29 - A);
    if (back) post(g, 39, 14 + A, 3, 29 - A);
    if (front) {
      // Tela de arriba del toldo (lo que se ve desde lo alto), tensa entre los postes.
      g.fillStyle = vgrad(g, -3 + A, 4 + A, [[0, lit(color, 0.22)], [1, color]]);
      g.beginPath();
      g.moveTo(1.2, 4 + A);
      g.lineTo(44.8, 4 + A);
      g.lineTo(40, -3 + A);
      g.lineTo(6, -3 + A);
      g.closePath();
      g.fill();
      g.strokeStyle = shd(color, 0.35);
      g.lineWidth = 0.5;
      g.stroke();
    }
    if (front) plank(g, 2, 28, 42, 12, '#9a7048');
    // Toldo a rayas con caída y volumen.
    for (let i = 0; front && i < 6; i++) {
      const c = i % 2 ? color : '#efe6d4';
      g.fillStyle = vgrad(g, 4 + A, 16 + A, [[0, lit(c, 0.15)], [1, shd(c, 0.2)]]);
      g.beginPath();
      g.moveTo(i * 7.7, 16 + A);
      g.lineTo(i * 7.7 + 7.7, 16 + A);
      g.lineTo(i * 7.7 + 6.5, 4 + A);
      g.lineTo(i * 7.7 + 1.2, 4 + A);
      g.fill();
      ell(g, i * 7.7 + 3.85, 16 + A, 3.85, 2.2, shd(c, 0.12));
    }
    if (!front) return;
    if (full) {
      const shown = goods?.length ? goods : [['#d9a441', '#c06a2a', '#e0c070'], ['#a8c25a', '#6a9a3a', '#d9473a'], ['#c0503a', '#8a4a8a', '#e8d8a0']][v % 3];
      const n = goods ? Math.min(7, goods.length * 2 + 1) : 7;
      for (let i = 0; i < n; i++) {
        const c = shown[i % shown.length];
        ell(g, 6 + i * 5.6, 26.5, 3, 2.6, vgrad(g, 24, 29, [[0, lit(c, 0.25)], [1, shd(c, 0.2)]]));
        ell(g, 5.2 + i * 5.6, 25.6, 0.9, 0.6, 'rgba(255,255,255,0.5)');
      }
      plank(g, 0, 21, 8, 7, '#a07a3e'); // una caja apoyada en el extremo del mostrador (no flotando delante de quien atiende)
    } else {
      // Cerrado: el género tapado con una lona atada sobre el mostrador.
      plank(g, 8, 22, 10, 6, '#6a4a2a');
      g.fillStyle = vgrad(g, 20, 30, [[0, '#9a8f7c'], [1, '#6e6556']]);
      g.beginPath();
      g.moveTo(3, 29);
      g.quadraticCurveTo(22, 19, 43, 29);
      g.lineTo(43, 33);
      g.lineTo(3, 33);
      g.fill();
      g.strokeStyle = 'rgba(60,45,30,0.7)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(14, 23.5);
      g.lineTo(14, 33);
      g.moveTo(32, 23.5);
      g.lineTo(32, 33);
      g.stroke();
    }
  });
}

export function tentTex(color: string): Tex {
  // Tienda de lona en volumen: faldón delantero con luz, lateral en sombra,
  // lona que se comba entre palos, costuras, vientos con estacas y la
  // entrada recogida con su interior oscuro.
  return tex(`tent3:${color}`, 48, 34, 22, 31, (g) => {
    const R = rng(color.length * 13);
    // Vientos (cuerdas) y estacas.
    g.strokeStyle = 'rgba(70,56,40,0.75)';
    g.lineWidth = 0.4;
    g.beginPath();
    g.moveTo(0, -27);
    g.lineTo(-21, 1);
    g.moveTo(0, -27);
    g.lineTo(23, -2);
    g.stroke();
    post(g, -21.5, -1, 1, 2.5, '#5a3c24');
    post(g, 22.5, -4, 1, 2.5, '#5a3c24');
    // Lateral (fondo, en sombra).
    g.fillStyle = vgrad(g, -27, 0, [[0, shd(color, 0.3)], [1, shd(color, 0.48)]]);
    g.beginPath();
    g.moveTo(0, -27);
    g.lineTo(9, -30);
    g.quadraticCurveTo(17, -14, 25, -3);
    g.lineTo(17, 0);
    g.quadraticCurveTo(9, -12, 0, -27);
    g.fill();
    // Faldón delantero: la lona se comba un poco entre el palo y el suelo.
    g.fillStyle = vgrad(g, -27, 0, [[0, lit(color, 0.22)], [0.6, color], [1, shd(color, 0.2)]]);
    g.beginPath();
    g.moveTo(0, -27);
    g.quadraticCurveTo(-7, -12, -18, 0);
    g.quadraticCurveTo(0, 1.5, 17, 0);
    g.quadraticCurveTo(8, -12, 0, -27);
    g.fill();
    // Pliegues y costuras.
    g.strokeStyle = alpha(shd(color, 0.4), 0.55);
    g.lineWidth = 0.45;
    for (const x of [-11, -5, 6, 11]) {
      g.beginPath();
      g.moveTo(x * 0.15, -25);
      g.quadraticCurveTo(x * 0.55 + (R() - 0.5), -12, x, -0.5);
      g.stroke();
    }
    g.strokeStyle = alpha(lit(color, 0.3), 0.5);
    g.beginPath();
    g.moveTo(-1, -26);
    g.quadraticCurveTo(-6, -13, -15, -1);
    g.stroke();
    // Entrada recogida: interior oscuro y la tela doblada a los lados.
    g.fillStyle = '#1a120e';
    g.beginPath();
    g.moveTo(0, -17);
    g.quadraticCurveTo(-3.5, -8, -5.5, 0.5);
    g.lineTo(5.5, 0.5);
    g.quadraticCurveTo(3.5, -8, 0, -17);
    g.fill();
    g.fillStyle = shd(color, 0.15);
    g.beginPath();
    g.moveTo(0, -17);
    g.quadraticCurveTo(-5, -7, -8.5, 0.6);
    g.lineTo(-5.5, 0.5);
    g.quadraticCurveTo(-3.5, -8, 0, -17);
    g.fill();
    // Palo y remate.
    post(g, -0.6, -31, 1.2, 5, '#5a3c24');
    ell(g, 0, -31, 1, 0.8, '#c9a65a');
  });
}

// ---------------------------------------------------------------------------
// Animales
// ---------------------------------------------------------------------------
export type AnimalKind = 'vaca' | 'oveja' | 'gallina' | 'ciervo' | 'caballo' | 'perro' | 'pato';

interface Coat {
  body: string;
  spot?: string;
  leg: string;
  head: string;
}
const COATS: Record<AnimalKind, Coat[]> = {
  vaca: [{ body: '#f2ece2', spot: '#2a2420', leg: '#e8e0d4', head: '#f2ece2' }, { body: '#8a5a36', leg: '#7a4a2c', head: '#8a5a36' }, { body: '#c8a070', spot: '#f2ece2', leg: '#b08858', head: '#c8a070' }],
  oveja: [{ body: '#efe8da', leg: '#3a3030', head: '#3a3030' }, { body: '#e4dccb', leg: '#2a2424', head: '#f2ece2' }, { body: '#d8ccb8', leg: '#3a3030', head: '#3a3030' }],
  gallina: [{ body: '#f2ece2', leg: '#e0a030', head: '#f2ece2' }, { body: '#a85a2a', leg: '#e0a030', head: '#a85a2a' }, { body: '#3a3030', leg: '#e0a030', head: '#3a3030' }],
  ciervo: [{ body: '#9a6438', leg: '#7a4a28', head: '#9a6438' }],
  caballo: [{ body: '#6b4a30', leg: '#3a2a20', head: '#6b4a30' }, { body: '#3a2a20', leg: '#2a1e18', head: '#3a2a20' }, { body: '#c9b08a', leg: '#8a6a4a', head: '#c9b08a' }],
  perro: [{ body: '#a8743c', leg: '#8a5a2c', head: '#a8743c' }, { body: '#3a3030', spot: '#e8e0d0', leg: '#3a3030', head: '#3a3030' }, { body: '#d8c8a8', leg: '#b8a888', head: '#d8c8a8' }],
  pato: [{ body: '#efe8da', leg: '#e0a030', head: '#3a7a4a' }, { body: '#8a6a4a', leg: '#e0a030', head: '#5a4a3a' }],
};

const SIZE: Record<AnimalKind, [number, number, number]> = {
  // largo del cuerpo, alto del cuerpo, alto de la pata
  vaca: [30, 13, 11],
  oveja: [17, 11, 6],
  gallina: [6.5, 5.5, 3],
  ciervo: [24, 10, 14],
  caballo: [32, 13, 17],
  perro: [14, 6.5, 6],
  pato: [7.5, 4.5, 0.8],
};

/** Un animal de perfil mirando a la derecha; `frame` 0..3 mueve las patas. */
export function animalTex(kind: AnimalKind, frame: number, v = 0): Tex {
  const coat = COATS[kind][v % COATS[kind].length];
  const [L, Hb, leg] = SIZE[kind];
  const W = L * 1.9 + 10;
  const H = Hb + leg + L * 0.9 + 6;
  return tex(`animal2:${kind}:${frame % 4}:${v % COATS[kind].length}`, W, H, W / 2, H - 2, (g) => {
    const ph = (frame % 4) * (Math.PI / 2);
    const R = rng(v + kind.length);
    const by = -leg - Hb * 0.5; // centro del cuerpo
    const bodyFill = vgrad(g, by - Hb * 0.6, by + Hb * 0.6, [[0, lit(coat.body, 0.18)], [0.6, coat.body], [1, shd(coat.body, 0.3)]]);
    // Patas (las lejanas, más oscuras).
    const legAt = (x: number, i: number, far: boolean) => {
      const sw = Math.sin(ph + (i % 2 ? Math.PI : 0)) * (kind === 'pato' ? 0.3 : 0.3);
      g.save();
      g.translate(x, by + Hb * 0.3);
      g.rotate(sw);
      const lw = kind === 'gallina' || kind === 'pato' ? 0.6 : L * 0.075;
      g.fillStyle = far ? shd(coat.leg, 0.25) : coat.leg;
      g.beginPath();
      g.roundRect(-lw / 2, 0, lw, leg + Hb * 0.2, lw / 2);
      g.fill();
      if (kind === 'vaca' || kind === 'caballo' || kind === 'ciervo') {
        g.fillStyle = '#2a2420';
        g.fillRect(-lw / 2 - 0.1, leg + Hb * 0.2 - 1.4, lw + 0.2, 1.4);
      }
      g.restore();
    };
    if (kind !== 'pato') {
      legAt(L * 0.32, 1, true);
      legAt(-L * 0.3, 0, true);
    }
    // Cola.
    g.strokeStyle = shd(coat.body, 0.2);
    g.lineWidth = kind === 'caballo' ? 2.4 : 1;
    g.beginPath();
    g.moveTo(-L * 0.48, by - Hb * 0.2);
    g.quadraticCurveTo(-L * 0.62, by + Hb * 0.2, -L * 0.58, by + Hb * (kind === 'caballo' ? 0.9 : 0.6));
    g.stroke();
    // Cuerpo.
    if (kind === 'oveja') {
      for (let i = 0; i < 14; i++) ell(g, (R() - 0.5) * L * 0.95, by + (R() - 0.5) * Hb * 0.9, Hb * 0.32, Hb * 0.28, i % 2 ? lit(coat.body, 0.1) : coat.body);
    } else ell(g, 0, by, L * 0.52, Hb * 0.55, bodyFill);
    // Manchas redondeadas e irregulares (tres puntas superpuestas formaban una estrella).
    if (coat.spot) for (let i = 0; i < 3; i++) ell(g, (R() - 0.5) * L * 0.55, by + (R() - 0.5) * Hb * 0.35, L * (0.1 + R() * 0.08), Hb * (0.22 + R() * 0.12), coat.spot, (R() - 0.5) * 1.2);
    // Cuello y cabeza.
    const hx = L * 0.5;
    const hy = by - Hb * (kind === 'caballo' || kind === 'ciervo' ? 0.95 : kind === 'perro' ? 0.5 : kind === 'gallina' || kind === 'pato' ? 0.6 : 0.2);
    if (kind === 'caballo' || kind === 'ciervo') {
      g.fillStyle = bodyFill;
      g.beginPath();
      g.moveTo(L * 0.28, by - Hb * 0.4);
      g.lineTo(hx + 2, hy - 2);
      g.lineTo(hx + 4, hy + 3);
      g.lineTo(L * 0.4, by + Hb * 0.1);
      g.fill();
      if (kind === 'caballo') {
        g.strokeStyle = shd(coat.body, 0.45);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(L * 0.25, by - Hb * 0.5);
        g.lineTo(hx + 1, hy - 3);
        g.stroke();
      }
    }
    const hl = kind === 'caballo' ? 9 : kind === 'vaca' ? 7.5 : kind === 'ciervo' ? 6.5 : kind === 'perro' ? 5 : kind === 'oveja' ? 4.5 : 3;
    ell(g, hx + hl * 0.4, hy, hl * 0.6, hl * 0.42, vgrad(g, hy - hl * 0.4, hy + hl * 0.4, [[0, lit(coat.head, 0.15)], [1, shd(coat.head, 0.25)]]), kind === 'caballo' || kind === 'vaca' ? 0.35 : 0);
    ell(g, hx + hl * 0.55, hy - hl * 0.12, hl * 0.09, hl * 0.09, '#141010');
    if (kind === 'gallina') {
      ell(g, hx + hl * 0.4, hy - hl * 0.45, hl * 0.25, hl * 0.2, '#d8302a');
      g.fillStyle = '#e8a030';
      g.beginPath();
      g.moveTo(hx + hl * 0.9, hy - 0.2);
      g.lineTo(hx + hl * 1.35, hy + 0.3);
      g.lineTo(hx + hl * 0.9, hy + 0.7);
      g.fill();
    }
    if (kind === 'pato') ell(g, hx + hl * 1.05, hy + 0.3, hl * 0.35, hl * 0.18, '#e8a030');
    if (kind === 'vaca') for (const sx of [-1, 1]) ell(g, hx + hl * 0.2, hy - hl * 0.45 + sx * 0.3, 1.2, 0.5, '#e8e0cc');
    if (kind === 'ciervo') {
      g.strokeStyle = '#d8c8a0';
      g.lineWidth = 0.7;
      for (const sx of [0, 1.4]) {
        g.beginPath();
        g.moveTo(hx + sx, hy - hl * 0.3);
        g.lineTo(hx + sx - 1, hy - hl * 1.4);
        g.lineTo(hx + sx - 2.5, hy - hl * 1.8);
        g.moveTo(hx + sx - 0.6, hy - hl * 1.0);
        g.lineTo(hx + sx + 1.2, hy - hl * 1.4);
        g.stroke();
      }
    }
    if (kind === 'perro') ell(g, hx + hl * 0.05, hy - hl * 0.35, hl * 0.18, hl * 0.32, shd(coat.head, 0.25), -0.4);
    // Patas cercanas.
    if (kind !== 'pato') {
      legAt(L * 0.38, 0, false);
      legAt(-L * 0.24, 1, false);
    }
  }, 2.5);
}

/**
 * Agua viva de la fuente (cada fotograma): dos chorros que caen en arco con
 * gotas que se desprenden, y ondas que se abren donde caen. (x, y) son los
 * pies de la fuente en el mundo.
 */
export function drawFountainWater(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const ox = x - 30;
  const oy = y - 48;
  const s = t / 1000;
  g.lineCap = 'round';
  for (const sx of [-1, 1]) {
    const wob = Math.sin(s * 3.1 + sx) * 0.6;
    g.strokeStyle = 'rgba(200,232,248,0.75)';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(ox + 30 + sx * 3, oy + 11);
    g.quadraticCurveTo(ox + 30 + sx * (13 + wob), oy + 12, ox + 30 + sx * (15 + wob * 0.5), oy + 34);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 0.4;
    g.stroke();
    // Gotas que bajan por el chorro.
    for (let k = 0; k < 3; k++) {
      const u = (s * 1.4 + k / 3 + (sx > 0 ? 0.17 : 0)) % 1;
      const px = ox + 30 + sx * (3 + (12 + wob) * Math.sqrt(u) * (1 - 0.15 * u));
      const py = oy + 11 + 23 * u * u + 1.5 * Math.sin(u * Math.PI);
      g.fillStyle = 'rgba(235,248,255,0.85)';
      g.fillRect(px - 0.4, py - 0.4, 0.8, 0.8);
    }
    // Ondas donde cae el agua.
    for (let k = 0; k < 2; k++) {
      const u = (s * 0.9 + k * 0.5 + (sx > 0 ? 0.25 : 0)) % 1;
      g.strokeStyle = `rgba(220,240,252,${(0.6 * (1 - u)).toFixed(3)})`;
      g.lineWidth = 0.45;
      g.beginPath();
      g.ellipse(ox + 30 + sx * 15, oy + 35, 1 + u * 6, (1 + u * 6) * 0.35, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // Brillos que se mueven sobre la pila.
  for (let i = 0; i < 4; i++) {
    const u = (s * 0.25 + i * 0.27) % 1;
    g.fillStyle = `rgba(255,255,255,${(0.35 * Math.sin(u * Math.PI)).toFixed(3)})`;
    g.fillRect(ox + 14 + ((i * 37) % 30), oy + 35.5 + (i % 3) * 1.6, 3 + u * 2, 0.5);
  }
}

/** Yunque sobre su tocón: delante de quien martillea, para que el golpe caiga en algo. */
export function anvilTex(): Tex {
  return tex('yunque', 22, 20, 11, 18, (g) => {
    g.translate(-11, -18); // se pinta en coordenadas de esquina, como el resto del mobiliario
    // Tocón.
    g.fillStyle = vgrad(g, 8, 18, [[0, '#7a5a3a'], [1, '#4a3424']]);
    g.fillRect(6, 9, 10, 9);
    ell(g, 11, 9, 5, 1.6, '#9a7a52');
    // Yunque: cuerpo, cintura y pico.
    g.fillStyle = vgrad(g, 1, 9, [[0, '#8a9098'], [1, '#3a3e44']]);
    g.beginPath();
    g.moveTo(3, 2);
    g.lineTo(17, 2);
    g.quadraticCurveTo(21, 2.5, 21, 4);
    g.lineTo(16, 4.5);
    g.lineTo(14, 7);
    g.lineTo(15.5, 9);
    g.lineTo(6.5, 9);
    g.lineTo(8, 7);
    g.lineTo(6, 4.5);
    g.lineTo(3, 4.5);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(220,226,232,0.7)';
    g.fillRect(4, 2, 12, 0.8);
  });
}
