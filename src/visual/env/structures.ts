import { alpha, blob, css, cyl, ell, hgrad, lit, mix, rng, shd, tex, vgrad, type Tex } from '../paint';

/**
 * Estructuras del paisaje pintadas con el mismo lenguaje que casas y
 * árboles: montañas con planos de luz y nieve, el puesto fronterizo con su
 * garita y su barrera, la barricada, los lugares (cuevas, minas, ruinas,
 * círculos de piedra, campamentos, casas abandonadas…), el carro de las
 * caravanas y el mojón. Mismas medidas y anclajes que los dibujos antiguos,
 * para no mover nada del mundo. Todas las coordenadas, relativas a los pies.
 */

// ---------------------------------------------------------------------------
// Montañas
// ---------------------------------------------------------------------------
const PEAK_W = [96, 80, 110, 72, 88, 104];
const PEAK_H = [78, 64, 92, 56, 70, 84];

export function peakTex(v: number, snowy = true): Tex {
  const vv = v % 6;
  const W = PEAK_W[vv];
  const H = PEAK_H[vv];
  return tex(`peak3:${vv}:${snowy ? 1 : 0}`, W + 8, H + 8, W / 2 + 4, H + 4, (g) => {
    const R = rng(977 * (vv + 1));
    const half = W / 2;
    // Cumbre principal y, a veces, una secundaria detrás.
    const tops: [number, number][] = [[(R() - 0.5) * W * 0.22, -H]];
    if (R() < 0.7) tops.unshift([(R() < 0.5 ? -1 : 1) * W * (0.22 + R() * 0.1), -H * (0.62 + R() * 0.12)]);
    for (const [tx, ty] of tops) {
      const back = ty > -H + 1;
      const rock = back ? '#8a8690' : '#7e7a76';
      // Silueta quebrada: laderas con salientes.
      const left: number[] = [];
      const right: number[] = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = ty + (0 - ty) * t;
        left.push(tx - (tx + half) * t + (R() - 0.5) * 5 * Math.sin(t * Math.PI), y);
        right.push(tx + (half - tx) * t + (R() - 0.5) * 5 * Math.sin(t * Math.PI), y);
      }
      // Cara en luz (izquierda, el sol de la mañana) y cara en sombra.
      g.fillStyle = vgrad(g, ty, 0, [[0, lit(rock, 0.18)], [1, shd(rock, 0.1)]]);
      g.beginPath();
      g.moveTo(tx, ty);
      for (let i = 0; i < left.length; i += 2) g.lineTo(left[i], left[i + 1]);
      g.lineTo(tx + (R() - 0.5) * 6, 0);
      g.closePath();
      g.fill();
      g.fillStyle = vgrad(g, ty, 0, [[0, shd(rock, 0.25)], [1, shd(rock, 0.45)]]);
      g.beginPath();
      g.moveTo(tx, ty);
      for (let i = 0; i < right.length; i += 2) g.lineTo(right[i], right[i + 1]);
      g.lineTo(tx + (R() - 0.5) * 6, 0);
      g.closePath();
      g.fill();
      // Aristas y grietas que bajan.
      g.strokeStyle = alpha(shd(rock, 0.55), 0.6);
      g.lineWidth = 0.8;
      for (let k = 0; k < 6; k++) {
        const sx = tx + (R() - 0.5) * 10;
        g.beginPath();
        g.moveTo(sx, ty + 4 + R() * 8);
        g.quadraticCurveTo(sx + (R() - 0.5) * 20, ty * 0.5, sx + (R() - 0.5) * half, -2);
        g.stroke();
      }
      // Nieve: un casquete irregular con lenguas que bajan por las grietas.
      if (snowy) {
        const sl = -ty * 0.38;
        const pts: number[] = [tx, ty - 0.5];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const x = tx + (t * 2 - 1) * (half * 0.42);
          const tongue = k % 2 ? sl * (0.7 + R() * 0.6) : sl * (0.35 + R() * 0.25);
          pts.push(x, ty + tongue * (1 - Math.abs(t * 2 - 1) * 0.35));
        }
        g.fillStyle = vgrad(g, ty, ty + sl, [[0, '#ffffff'], [1, '#dfe8f2']]);
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.closePath();
        g.fill();
        // La nieve del lado en sombra es azulada.
        g.fillStyle = 'rgba(120,140,190,0.35)';
        g.beginPath();
        g.moveTo(tx, ty);
        for (let i = pts.length / 2 + 1; i < pts.length; i += 2) g.lineTo(pts[i - 1], pts[i]);
        g.closePath();
        g.fill();
      }
    }
    // Pedregal al pie y algo de verde que trepa.
    for (let i = 0; i < 16; i++) ell(g, (R() - 0.5) * W * 0.9, -R() * 6, 1.5 + R() * 3, 1 + R() * 1.6, R() < 0.5 ? '#8a847a' : '#6a665e');
    for (let i = 0; i < 8; i++) ell(g, (R() - 0.5) * W, -R() * 4, 3 + R() * 4, 1.4, alpha('#5a7a3e', 0.7));
  });
}

// ---------------------------------------------------------------------------
// Puesto fronterizo y barricada
// ---------------------------------------------------------------------------
export function postTex(color: string, closed: boolean): Tex {
  return tex(`post3:${color}:${closed ? 1 : 0}`, 96, 92, 34, 86, (g) => {
    const R = rng(color.length * 31);
    // Empalizada de troncos afilados detrás.
    for (let x = -30; x < 60; x += 5) {
      const h = 22 + R() * 6;
      g.fillStyle = cyl(g, x, x + 4.5, '#7a5634');
      g.beginPath();
      g.moveTo(x, -6);
      g.lineTo(x, -h);
      g.lineTo(x + 2.25, -h - 3.5);
      g.lineTo(x + 4.5, -h);
      g.lineTo(x + 4.5, -6);
      g.fill();
    }
    // Garita de troncos con tejado de tablas y ventanuco con contraventana.
    const gx = -26;
    g.fillStyle = vgrad(g, -46, -6, [[0, '#8a6440'], [1, '#6a4a2e']]);
    g.fillRect(gx, -46, 28, 40);
    g.strokeStyle = 'rgba(40,26,14,0.55)';
    g.lineWidth = 0.7;
    for (let y = -42; y < -6; y += 4) {
      g.beginPath();
      g.moveTo(gx, y);
      g.lineTo(gx + 28, y);
      g.stroke();
    }
    g.fillStyle = shd('#6a4a2e', 0.25);
    g.fillRect(gx + 28, -48, 6, 42);
    g.fillStyle = vgrad(g, -58, -44, [[0, lit('#6a4428', 0.15)], [1, shd('#6a4428', 0.2)]]);
    g.beginPath();
    g.moveTo(gx - 4, -44);
    g.lineTo(gx + 14, -58);
    g.lineTo(gx + 38, -50);
    g.lineTo(gx + 32, -44);
    g.closePath();
    g.fill();
    // Tablas del tejado, solapadas, con la luz en el canto.
    g.save();
    g.beginPath();
    g.moveTo(gx - 4, -44);
    g.lineTo(gx + 14, -58);
    g.lineTo(gx + 38, -50);
    g.lineTo(gx + 32, -44);
    g.closePath();
    g.clip();
    for (let i = 0; i < 9; i++) {
      const x = gx - 4 + i * 5;
      g.strokeStyle = 'rgba(30,18,10,0.5)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x, -43);
      g.lineTo(x + 15, -60);
      g.stroke();
      g.strokeStyle = 'rgba(220,180,130,0.25)';
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(x + 1, -43);
      g.lineTo(x + 16, -60);
      g.stroke();
    }
    g.restore();
    // Ventanuco: luz cálida dentro, contraventana abierta.
    g.fillStyle = '#e8b866';
    g.fillRect(gx + 9, -36, 10, 8);
    g.fillStyle = 'rgba(90,50,20,0.6)';
    g.fillRect(gx + 9, -32.5, 10, 1);
    g.fillStyle = '#5a3a22';
    g.fillRect(gx + 2, -36.5, 6.5, 9);
    // Mástil con la bandera del dueño, que ondea.
    g.fillStyle = cyl(g, 18, 20.5, '#6a4a2e');
    g.fillRect(18, -84, 2.5, 78);
    ell(g, 19.2, -85, 1.8, 1.4, '#c9a65a');
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(20.5, -82);
    g.quadraticCurveTo(32, -86, 44, -79);
    g.quadraticCurveTo(36, -74, 46, -68);
    g.quadraticCurveTo(32, -72, 20.5, -68);
    g.closePath();
    g.fill();
    g.fillStyle = alpha(shd(color, 0.4), 0.6);
    g.beginPath();
    g.moveTo(30, -80);
    g.quadraticCurveTo(34, -75, 31, -70.5);
    g.lineTo(28, -71);
    g.closePath();
    g.fill();
    // Barrera: bajada si el paso está cerrado, levantada si está abierto.
    const bx = 24;
    g.fillStyle = cyl(g, bx, bx + 4, '#5a3a22');
    g.fillRect(bx, -14, 4, 14);
    g.save();
    g.translate(bx + 2, -12);
    g.rotate(closed ? 0 : -1.2);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f0e6d2' : '#b0402a';
      g.fillRect(i * 6, -1.5, 6, 3);
    }
    g.restore();
    // Sacos terreros y una caja.
    for (let i = 0; i < 4; i++) ell(g, -26 + i * 7, -3, 4, 2.6, i % 2 ? '#a8885a' : '#b8986a');
    g.fillStyle = '#7a5634';
    g.fillRect(4, -9, 9, 8);
    g.strokeStyle = 'rgba(40,26,14,0.6)';
    g.strokeRect(4, -9, 9, 8);
  });
}

export function barricadeTex(): Tex {
  return tex('barricada3', 70, 38, 35, 35, (g) => {
    const R = rng(71);
    // Caballos de frisa: estacas cruzadas y afiladas.
    for (let i = 0; i < 4; i++) {
      const x = -26 + i * 17;
      for (const d of [-1, 1]) {
        g.save();
        g.translate(x, -4);
        g.rotate(d * 0.7);
        g.fillStyle = cyl(g, -1.5, 1.5, '#7a5634');
        g.fillRect(-1.5, -22, 3, 24);
        g.fillStyle = '#c9a678';
        g.beginPath();
        g.moveTo(-1.5, -22);
        g.lineTo(0, -26);
        g.lineTo(1.5, -22);
        g.fill();
        g.restore();
      }
    }
    g.fillStyle = cyl(g, -32, 32, '#6a4a2e');
    g.fillRect(-32, -9, 64, 3.5);
    for (let i = 0; i < 5; i++) ell(g, -24 + i * 12 + (R() - 0.5) * 3, -2, 5.5, 3, i % 2 ? '#a8885a' : '#b8986a');
  });
}

// ---------------------------------------------------------------------------
// Lugares del mundo
// ---------------------------------------------------------------------------
export function placeTex(kind: string): Tex {
  return tex(`place3:${kind}`, 96, 84, 48, 78, (g) => {
    const R = rng(kind.length * 977);
    ell(g, 0, 0, 40, 6, 'rgba(20,14,10,0.2)');
    switch (kind) {
      case 'cueva':
      case 'mina': {
        // Peñasco con cara en luz y en sombra y una boca oscura con profundidad.
        blob(g, [-44, 0, -36, -36, -12, -66, 14, -64, 36, -44, 44, 0], vgrad(g, -66, 0, [[0, '#9a958c'], [1, '#6e6a62']]), 0.35);
        blob(g, [0, 0, 14, -64, 36, -44, 44, 0], alpha('#3a3632', 0.35), 0.35);
        for (let i = 0; i < 10; i++) ell(g, (R() - 0.5) * 70, -10 - R() * 50, 3 + R() * 5, 1.5 + R() * 2, alpha(R() < 0.5 ? '#b0aaa0' : '#5a5650', 0.5), R());
        g.fillStyle = vgrad(g, -30, 0, [[0, '#0e0a08'], [1, '#241c16']]);
        g.beginPath();
        g.ellipse(0, 0, 15, 26, 0, Math.PI, 0);
        g.fill();
        ell(g, 0, -2, 12, 3, 'rgba(255,180,90,0.08)');
        if (kind === 'mina') {
          g.fillStyle = cyl(g, -19, -14, '#7a5532');
          g.fillRect(-19, -28, 5, 28);
          g.fillStyle = cyl(g, 14, 19, '#7a5532');
          g.fillRect(14, -28, 5, 28);
          g.fillStyle = vgrad(g, -32, -26, [[0, '#8a6440'], [1, '#5a3a22']]);
          g.fillRect(-22, -32, 44, 5.5);
          // Vagoneta.
          g.fillStyle = '#5a4a3a';
          g.beginPath();
          g.moveTo(22, -2);
          g.lineTo(40, -2);
          g.lineTo(37, -12);
          g.lineTo(25, -12);
          g.fill();
          ell(g, 31, -12, 6, 2, '#3a3430');
          ell(g, 26, -1, 2, 2, '#2a2420');
          ell(g, 36, -1, 2, 2, '#2a2420');
        }
        break;
      }
      case 'ruinas':
      case 'templo': {
        // Columnas rotas con estrías, capiteles y bloques caídos con musgo.
        g.fillStyle = vgrad(g, -8, 0, [[0, '#a8a090'], [1, '#8a8274']]);
        g.fillRect(-42, -7, 84, 7);
        for (const [x, h] of [[-36, 44], [-18, 60], [8, 30], [26, 52]]) {
          g.fillStyle = cyl(g, x, x + 10, '#c4bca8');
          g.fillRect(x, -6 - h, 10, h);
          g.strokeStyle = 'rgba(80,70,60,0.35)';
          g.lineWidth = 0.6;
          for (const sx of [2.5, 5, 7.5]) {
            g.beginPath();
            g.moveTo(x + sx, -6 - h + 5);
            g.lineTo(x + sx, -7);
            g.stroke();
          }
          g.fillStyle = vgrad(g, -6 - h, -2 - h, [[0, '#d4ccb8'], [1, '#a8a090']]);
          g.fillRect(x - 2, -6 - h, 14, 4);
          // Rotura irregular arriba y musgo.
          ell(g, x + 3, -6 - h + 6, 3, 1.5, alpha('#6f8a45', 0.8));
        }
        if (kind === 'templo') {
          g.fillStyle = vgrad(g, -70, -60, [[0, '#d4ccb8'], [1, '#9a927e']]);
          g.beginPath();
          g.moveTo(-26, -60);
          g.lineTo(26, -60);
          g.lineTo(18, -70);
          g.lineTo(-18, -70);
          g.closePath();
          g.fill();
        }
        for (let i = 0; i < 4; i++) {
          const x = -30 + R() * 60;
          g.fillStyle = '#b4ac98';
          g.save();
          g.translate(x, -2);
          g.rotate((R() - 0.5) * 0.6);
          g.fillRect(-5, -3, 10, 5);
          g.restore();
        }
        for (let i = 0; i < 6; i++) ell(g, -40 + R() * 80, -1, 4, 1.6, alpha('#5f7a3e', 0.8));
        break;
      }
      case 'circulo': {
        // Menhires en anillo, con liquen y sombra propia.
        const stones: [number, number][] = [];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          stones.push([Math.cos(a) * 34, -26 + Math.sin(a) * 16]);
        }
        stones.sort((a, b) => a[1] - b[1]);
        for (const [x, y] of stones) {
          const h = 18 + R() * 8;
          blob(g, [x - 4, y, x - 4.5, y - h * 0.8, x - 1, y - h, x + 3.5, y - h * 0.85, x + 4.5, y], hgrad(g, x - 5, x + 5, [[0, '#b8b0a0'], [0.6, '#9a9284'], [1, '#6e685e']]), 0.4);
          ell(g, x - 1, y - h * 0.5, 1.6, 2.2, alpha('#a8b46a', 0.6));
        }
        ell(g, 0, -26, 10, 4, alpha('#3a2a1a', 0.35));
        break;
      }
      case 'campamento': {
        // Tienda, hoguera con piedras y fardos.
        const c = '#8a7a5a';
        g.fillStyle = vgrad(g, -44, 0, [[0, lit(c, 0.2)], [1, shd(c, 0.2)]]);
        g.beginPath();
        g.moveTo(-42, 0);
        g.quadraticCurveTo(-30, -24, -20, -44);
        g.quadraticCurveTo(-10, -24, 2, 0);
        g.fill();
        g.fillStyle = shd(c, 0.35);
        g.beginPath();
        g.moveTo(-20, -44);
        g.quadraticCurveTo(-10, -24, 2, 0);
        g.lineTo(-10, 0);
        g.fill();
        g.fillStyle = '#1a120e';
        g.beginPath();
        g.moveTo(-20, -26);
        g.lineTo(-26, 0);
        g.lineTo(-14, 0);
        g.fill();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          ell(g, 22 + Math.cos(a) * 9, -3 + Math.sin(a) * 3.5, 2.6, 1.8, '#8a847a');
        }
        ell(g, 22, -3, 6, 2.2, '#2a1a10');
        g.strokeStyle = '#5a3a22';
        g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(16, -2);
        g.lineTo(28, -5);
        g.moveTo(17, -5);
        g.lineTo(27, -1);
        g.stroke();
        ell(g, 36, -3, 6, 4, '#a8885a');
        break;
      }
      case 'abandonada': {
        // Casa sin tejado entero: vigas a la vista, puerta caída, hiedra.
        g.fillStyle = vgrad(g, -38, 0, [[0, '#9a8a72'], [1, '#7a6a54']]);
        g.fillRect(-30, -38, 60, 38);
        g.fillStyle = shd('#7a6a54', 0.3);
        g.fillRect(30, -42, 8, 42);
        g.fillStyle = '#5a4a3a';
        g.beginPath();
        g.moveTo(-36, -36);
        g.lineTo(-4, -62);
        g.lineTo(6, -54);
        g.lineTo(-20, -36);
        g.closePath();
        g.fill();
        g.strokeStyle = '#3a2a1e';
        g.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(-2 + i * 8, -60 + i * 4);
          g.lineTo(6 + i * 8, -38);
          g.stroke();
        }
        g.fillStyle = '#1a1612';
        g.fillRect(-8, -24, 13, 24);
        g.save();
        g.translate(5, 0);
        g.rotate(0.35);
        g.fillStyle = '#5a3e26';
        g.fillRect(0, -22, 10, 22);
        g.restore();
        g.fillStyle = '#2a2420';
        g.fillRect(-24, -30, 10, 8);
        for (let i = 0; i < 14; i++) ell(g, -30 + R() * 14, -R() * 34, 2, 1.4, alpha('#4a6a32', 0.85), R() * 3);
        break;
      }
      case 'puesto': {
        // Puesto de mercader en el camino: toldo a rayas, mostrador y género.
        g.fillStyle = cyl(g, -36, -32, '#6a4a2e');
        g.fillRect(-36, -40, 4, 40);
        g.fillStyle = cyl(g, 32, 36, '#6a4a2e');
        g.fillRect(32, -40, 4, 40);
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#b5562d' : '#f0e8d8';
          g.beginPath();
          g.moveTo(-40 + i * 10, -40);
          g.lineTo(-30 + i * 10, -40);
          g.quadraticCurveTo(-32 + i * 10, -32, -35 + i * 10, -30);
          g.quadraticCurveTo(-38 + i * 10, -32, -40 + i * 10, -40);
          g.fill();
        }
        g.fillStyle = vgrad(g, -16, 0, [[0, '#9a7048'], [1, '#6a4a2e']]);
        g.fillRect(-34, -16, 68, 16);
        for (let i = 0; i < 6; i++) ell(g, -26 + i * 10, -18, 4, 3, ['#d9a441', '#a8c25a', '#c0503a'][i % 3]);
        break;
      }
      case 'bosque': {
        // Árbol sagrado: tronco retorcido, cintas y lucecitas.
        g.fillStyle = cyl(g, -5, 5, '#6a5a3e');
        g.beginPath();
        g.moveTo(-8, 0);
        g.quadraticCurveTo(-2, -26, -5, -54);
        g.lineTo(5, -54);
        g.quadraticCurveTo(2, -26, 8, 0);
        g.fill();
        blob(g, [-30, -48, -20, -70, 6, -78, 30, -66, 32, -46, 0, -40], vgrad(g, -78, -40, [[0, '#7a9a5a'], [1, '#4a6a3a']]), 0.5);
        g.strokeStyle = '#c9a05a';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(-26, -46);
        g.quadraticCurveTo(0, -40, 26, -46);
        g.stroke();
        for (const [x, y] of [[-20, -44], [-6, -42], [8, -42], [20, -44]]) ell(g, x, y, 1.6, 1.6, 'rgba(250,236,170,0.95)');
        break;
      }
      case 'secreto': {
        // Piedra con runas que brillan levemente.
        blob(g, [-12, 0, -13, -40, -6, -56, 6, -56, 13, -40, 12, 0], hgrad(g, -13, 13, [[0, '#8a96a4'], [0.6, '#6a7a8a'], [1, '#4a5664']]), 0.4);
        g.strokeStyle = 'rgba(180,220,255,0.85)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-4, -42);
        g.lineTo(0, -34);
        g.lineTo(4, -42);
        g.moveTo(0, -30);
        g.lineTo(0, -20);
        g.moveTo(-4, -24);
        g.lineTo(4, -24);
        g.stroke();
        ell(g, 0, -32, 14, 18, 'rgba(160,210,255,0.12)');
        break;
      }
      case 'camino': {
        // Calzada antigua: losas gastadas entre la hierba.
        for (let i = 0; i < 9; i++) {
          const x = -42 + i * 9.5;
          const y = -10 + (i % 2) * 4;
          g.fillStyle = css(mix('#b8ae98', '#8a8270', R()));
          g.beginPath();
          g.roundRect(x, y, 8.5, 6, 2);
          g.fill();
          ell(g, x + 4, y + 6, 4, 1, 'rgba(40,30,20,0.25)');
        }
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Carro de caravana y mojón
// ---------------------------------------------------------------------------
export function cartTex(frame: number, flip: boolean, cargo: string): Tex {
  // 120×64 del dibujo antiguo reducido a 0,72 (≈ 86×46), anclado en el centro de las ruedas.
  return tex(`cart3:${frame % 4}:${flip ? 1 : 0}:${cargo}`, 90, 50, 44, 46, (g) => {
    if (flip) g.scale(-1, 1);
    g.translate(-43, -43);
    g.scale(0.72, 0.72);
    // Caja del carro con tablas.
    g.fillStyle = vgrad(g, 24, 42, [[0, '#9a7048'], [1, '#6a4a2e']]);
    g.fillRect(8, 24, 52, 18);
    g.strokeStyle = 'rgba(40,26,14,0.45)';
    g.lineWidth = 0.8;
    for (let k = 14; k < 60; k += 7) {
      g.beginPath();
      g.moveTo(k, 24);
      g.lineTo(k, 42);
      g.stroke();
    }
    // Carga cubierta con lona y cuerdas.
    g.fillStyle = vgrad(g, 4, 26, [[0, lit(cargo, 0.2)], [1, shd(cargo, 0.25)]]);
    g.beginPath();
    g.moveTo(9, 26);
    g.quadraticCurveTo(14, 4, 34, 4);
    g.quadraticCurveTo(54, 4, 59, 26);
    g.closePath();
    g.fill();
    g.strokeStyle = alpha(shd(cargo, 0.5), 0.8);
    g.lineWidth = 1;
    for (const x of [20, 34, 48]) {
      g.beginPath();
      g.moveTo(x, 5);
      g.lineTo(x + (x - 34) * 0.2, 26);
      g.stroke();
    }
    // Ruedas con radios que giran.
    for (const wx of [18, 50]) {
      g.strokeStyle = '#3a2614';
      g.lineWidth = 2.6;
      g.beginPath();
      g.arc(wx, 46, 9, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#6b4a2e';
      g.lineWidth = 1.1;
      for (let a = 0; a < 6; a++) {
        const ang = (a * Math.PI) / 3 + frame * 0.5;
        g.beginPath();
        g.moveTo(wx, 46);
        g.lineTo(wx + Math.cos(ang) * 8, 46 + Math.sin(ang) * 8);
        g.stroke();
      }
      ell(g, wx, 46, 2.4, 2.4, '#9a7a52');
    }
    // Lanza y mula de tiro.
    g.strokeStyle = '#6b4a2e';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(60, 34);
    g.lineTo(76, 32);
    g.stroke();
    g.save();
    g.translate(66, 0);
    const ph = (frame % 4) * (Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const x = 12 + (i % 2) * 18 + (i > 1 ? 4 : 0);
      g.strokeStyle = i > 1 ? '#4a2e1a' : '#5e3c24';
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(x, 34);
      g.lineTo(x + Math.sin(ph + (i % 2 ? Math.PI : 0)) * 3, 56);
      g.stroke();
    }
    ell(g, 22, 30, 16, 8.5, vgrad(g, 22, 38, [[0, '#7a5638'], [1, '#5a3a24']]));
    g.fillStyle = '#6b4a30';
    g.beginPath();
    g.moveTo(34, 26);
    g.quadraticCurveTo(40, 16, 46, 10);
    g.lineTo(50, 14);
    g.quadraticCurveTo(44, 22, 38, 32);
    g.fill();
    ell(g, 48, 12, 6, 3.6, '#6b4a30', 0.5);
    ell(g, 44, 6.5, 1.6, 3, '#5a3a24', -0.3);
    g.strokeStyle = '#2a1e14';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(32, 22);
    g.quadraticCurveTo(38, 14, 42, 8);
    g.stroke();
    g.restore();
  });
}

export function boundaryStoneTex(): Tex {
  return tex('mojon3', 14, 24, 7, 22, (g) => {
    ell(g, 0, 0, 6, 2, 'rgba(0,0,0,0.2)');
    g.fillStyle = hgrad(g, -5, 5, [[0, '#cfc8b8'], [0.55, '#aaa392'], [1, '#7e786a']]);
    g.beginPath();
    g.roundRect(-5, -18, 10, 18, [5, 5, 1, 1]);
    g.fill();
    g.strokeStyle = 'rgba(60,50,40,0.6)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-2.5, -12);
    g.lineTo(2.5, -12);
    g.moveTo(0, -15);
    g.lineTo(0, -8);
    g.stroke();
    ell(g, -2, -4, 2, 1.2, alpha('#6f8a45', 0.8));
  });
}
