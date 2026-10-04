/**
 * Gráficos procedurales: árboles, casas de cada cultura, edificios, puestos,
 * tiendas de campaña, animales y personas se dibujan una vez en lienzos
 * pequeños y se reutilizan (rápido en Android). No hay archivos de imagen.
 * Coordenadas en "píxeles de mundo" (16 por tesela); se dibujan a 2× para
 * que se vean nítidos al acercar la cámara.
 */
export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number; // ancho en píxeles de mundo
  h: number;
  ax: number; // ancla (pies) dentro del sprite, en píxeles de mundo
  ay: number;
}

const RES = 2;
const cache = new Map<string, Sprite>();

function make(key: string, w: number, h: number, ax: number, ay: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * RES);
  c.height = Math.ceil(h * RES);
  const g = c.getContext('2d')!;
  g.scale(RES, RES);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  const s = { canvas: c, w, h, ax, ay };
  cache.set(key, s);
  return s;
}

export function drawSprite(g: CanvasRenderingContext2D, s: Sprite, x: number, y: number, alpha = 1): void {
  if (alpha !== 1) g.globalAlpha = alpha;
  g.drawImage(s.canvas, x - s.ax, y - s.ay, s.w, s.h);
  if (alpha !== 1) g.globalAlpha = 1;
}

const ellipse = (g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) => {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
};

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const gg = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `rgb(${r},${gg},${b})`;
}

// ---------------------------------------------------------------------------
// Vegetación
// ---------------------------------------------------------------------------
export type TreeKind = 'roble' | 'pino' | 'abedul' | 'muerto' | 'arbusto' | 'junco' | 'palmera';
export type SeasonLook = 'primavera' | 'verano' | 'otoño' | 'invierno';

const LEAF: Record<SeasonLook, [string, string, string]> = {
  primavera: ['#5f9a4a', '#4b8040', '#8fc06a'],
  verano: ['#4f8a3c', '#3c6f31', '#77ad55'],
  otoño: ['#c27a2c', '#9c5a24', '#e0a24a'],
  invierno: ['#6f8a6a', '#55705a', '#e8eef2'],
};

export function tree(kind: TreeKind, season: SeasonLook, v: number): Sprite {
  const key = `t:${kind}:${season}:${v % 3}`;
  const [c1, c2, c3] = LEAF[season];
  switch (kind) {
    case 'pino':
      return make(key, 22, 36, 11, 33, (g) => {
        ellipse(g, 11, 33, 8, 3, 'rgba(0,0,0,0.22)');
        g.fillStyle = '#5b3d25';
        g.fillRect(10, 26, 3, 8);
        const green = season === 'invierno' ? '#3e6152' : season === 'otoño' ? '#41604a' : '#2f5f3e';
        for (let i = 0; i < 3; i++) {
          const y = 6 + i * 7;
          g.fillStyle = shade(green, 1 - i * 0.06 + (v % 3) * 0.04);
          g.beginPath();
          g.moveTo(11, y - 6);
          g.lineTo(19 - i * -1, y + 10);
          g.lineTo(3 + i * -1, y + 10);
          g.closePath();
          g.fill();
          if (season === 'invierno') {
            g.fillStyle = '#f2f6f8';
            g.beginPath();
            g.moveTo(11, y - 6);
            g.lineTo(14, y);
            g.lineTo(8, y);
            g.closePath();
            g.fill();
          }
        }
      });
    case 'abedul':
      return make(key, 20, 32, 10, 30, (g) => {
        ellipse(g, 10, 30, 7, 2.5, 'rgba(0,0,0,0.22)');
        g.fillStyle = '#ece6da';
        g.fillRect(9, 14, 2.5, 16);
        g.fillStyle = '#3a3330';
        for (let y = 16; y < 30; y += 4) g.fillRect(9, y, 2, 1);
        if (season !== 'invierno') {
          ellipse(g, 10, 11, 7, 9, c2);
          ellipse(g, 9, 9, 5.5, 6.5, c1);
          ellipse(g, 12, 7, 2.5, 2.5, c3);
        } else {
          g.strokeStyle = '#6b5d52';
          g.lineWidth = 1;
          for (const [x, y] of [[5, 6], [15, 7], [10, 2]]) (g.beginPath(), g.moveTo(10, 15), g.lineTo(x, y), g.stroke());
        }
      });
    case 'muerto':
      return make(key, 22, 30, 11, 28, (g) => {
        ellipse(g, 11, 28, 7, 2.5, 'rgba(0,0,0,0.2)');
        g.strokeStyle = '#5e5248';
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(11, 28);
        g.lineTo(11, 10);
        g.moveTo(11, 16);
        g.lineTo(5, 8);
        g.moveTo(11, 13);
        g.lineTo(17, 5);
        g.moveTo(11, 20);
        g.lineTo(16, 15);
        g.stroke();
      });
    case 'arbusto':
      return make(key, 16, 12, 8, 10, (g) => {
        ellipse(g, 8, 10, 7, 2.5, 'rgba(0,0,0,0.2)');
        ellipse(g, 8, 7, 7, 4.5, c2);
        ellipse(g, 6, 5.5, 4, 3, c1);
        if (season === 'primavera' && v % 2) for (const [x, y] of [[4, 5], [10, 4], [8, 8]]) ellipse(g, x, y, 1, 1, '#f3d9e4');
      });
    case 'junco':
      return make(key, 12, 14, 6, 13, (g) => {
        g.strokeStyle = season === 'invierno' ? '#9a9478' : '#6f8a45';
        g.lineWidth = 1.2;
        for (let i = 0; i < 5; i++) (g.beginPath(), g.moveTo(3 + i * 1.5, 13), g.lineTo(1 + i * 2.4, 2 + (i % 2) * 2), g.stroke());
        g.fillStyle = '#6b4a2a';
        g.fillRect(5, 2, 1.5, 3);
      });
    case 'palmera':
    case 'roble':
    default:
      return make(key, 28, 34, 14, 31, (g) => {
        ellipse(g, 14, 31, 10, 3.5, 'rgba(0,0,0,0.24)');
        g.fillStyle = '#5b3d25';
        g.fillRect(12, 20, 4, 12);
        if (season === 'invierno') {
          g.strokeStyle = '#5b4a3c';
          g.lineWidth = 1.6;
          for (const [x, y] of [[5, 9], [23, 10], [14, 3], [9, 4]]) (g.beginPath(), g.moveTo(14, 21), g.lineTo(x, y), g.stroke());
          ellipse(g, 14, 9, 9, 6, 'rgba(240,244,248,0.55)');
          return;
        }
        ellipse(g, 14, 14, 12, 10, c2);
        ellipse(g, 10, 12, 7, 6, c1);
        ellipse(g, 18, 11, 6, 5.5, c1);
        ellipse(g, 13, 7, 5, 4, c3);
        if (season === 'otoño' && v % 2) ellipse(g, 20, 16, 3, 2.5, '#d9a14d');
      });
  }
}

export function rock(v: number, snow = false): Sprite {
  return make(`r:${v % 3}:${snow}`, 16, 12, 8, 10, (g) => {
    ellipse(g, 8, 10, 7, 2.5, 'rgba(0,0,0,0.2)');
    g.fillStyle = ['#8d8a83', '#7c786f', '#9a958a'][v % 3];
    g.beginPath();
    g.moveTo(2, 10);
    g.lineTo(4, 4);
    g.lineTo(9, 2);
    g.lineTo(14, 5);
    g.lineTo(15, 10);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(4, 4);
    g.lineTo(9, 2);
    g.lineTo(8, 6);
    g.closePath();
    g.fill();
    if (snow) ellipse(g, 9, 4, 4, 1.6, '#f4f7f9');
  });
}

export function peak(v: number): Sprite {
  return make(`pk:${v % 3}`, 48, 44, 24, 40, (g) => {
    ellipse(g, 24, 40, 20, 4, 'rgba(0,0,0,0.25)');
    const h = 30 + (v % 3) * 4;
    g.fillStyle = '#6f6a63';
    g.beginPath();
    g.moveTo(3, 40);
    g.lineTo(24, 40 - h);
    g.lineTo(45, 40);
    g.closePath();
    g.fill();
    g.fillStyle = '#58534d';
    g.beginPath();
    g.moveTo(24, 40 - h);
    g.lineTo(45, 40);
    g.lineTo(28, 40);
    g.closePath();
    g.fill();
    g.fillStyle = '#eef2f4';
    g.beginPath();
    g.moveTo(24, 40 - h);
    g.lineTo(31, 40 - h + 11);
    g.lineTo(27, 40 - h + 9);
    g.lineTo(23, 40 - h + 13);
    g.lineTo(19, 40 - h + 9);
    g.closePath();
    g.fill();
  });
}

export function boundaryStone(): Sprite {
  return make('mojon', 8, 12, 4, 11, (g) => {
    ellipse(g, 4, 11, 3.5, 1.2, 'rgba(0,0,0,0.2)');
    g.fillStyle = '#b9b2a2';
    g.fillRect(1.5, 3, 5, 8);
    g.fillStyle = '#8c8575';
    g.fillRect(1.5, 3, 5, 1.5);
  });
}

// ---------------------------------------------------------------------------
// Arquitectura: cada cultura construye a su manera
// ---------------------------------------------------------------------------
export interface Style {
  wall: string;
  roof: string;
  trim: string;
  shape: 'dos-aguas' | 'plano' | 'redondo' | 'alto';
}

export function styleFor(cultureId: string, hue: number): Style {
  const styles: Record<string, Style> = {
    eco: { wall: '#e6d3ae', roof: '#9c5b34', trim: '#6b4428', shape: 'dos-aguas' },
    velmari: { wall: '#e9e4d6', roof: '#3f6f8f', trim: '#2c4b61', shape: 'alto' },
    orunde: { wall: '#c98f62', roof: '#7d3b26', trim: '#5a2a1a', shape: 'plano' },
    saelith: { wall: '#d9cfa8', roof: '#6d8a4a', trim: '#4b5f33', shape: 'redondo' },
    kharu: { wall: '#9a948c', roof: '#5a4b4b', trim: '#3a3030', shape: 'plano' },
    imbra: { wall: '#efdcb0', roof: '#b8862f', trim: '#7a5a20', shape: 'dos-aguas' },
    tovesh: { wall: '#ddd2e6', roof: '#6b4a8a', trim: '#4a3262', shape: 'alto' },
    marrow: { wall: '#cdbb92', roof: '#7a6a3a', trim: '#4f4526', shape: 'redondo' },
    quessa: { wall: '#ead6d6', roof: '#9a3f62', trim: '#6a2a44', shape: 'dos-aguas' },
    dunai: { wall: '#d5e0d8', roof: '#3f7a6a', trim: '#2a5248', shape: 'plano' },
    yrth: { wall: '#b4bcc8', roof: '#3b4a6a', trim: '#26304a', shape: 'alto' },
  };
  return styles[cultureId] ?? { wall: '#ddd0b0', roof: `hsl(${hue} 35% 38%)`, trim: '#4a3a2a', shape: 'dos-aguas' };
}

export type HouseState = 'normal' | 'quemada' | 'abandonada' | 'obra';

export function house(st: Style, state: HouseState, v: number, wTiles = 2): Sprite {
  const W = wTiles * 16;
  return make(`h:${st.wall}:${st.roof}:${st.shape}:${state}:${v % 2}:${wTiles}`, W + 4, 46, W / 2 + 2, 44, (g) => {
    const x0 = 2;
    ellipse(g, W / 2 + 2, 43, W / 2 + 1, 3.5, 'rgba(0,0,0,0.25)');
    const wall = state === 'quemada' ? '#5a4f48' : state === 'abandonada' ? shade(st.wall, 0.75) : st.wall;
    const roof = state === 'quemada' ? '#2a2420' : state === 'abandonada' ? shade(st.roof, 0.7) : st.roof;
    // Muro.
    g.fillStyle = wall;
    g.fillRect(x0 + 2, 22, W - 4, 21);
    g.fillStyle = shade(wall.startsWith('#') ? wall : '#999999', 0.82);
    g.fillRect(x0 + 2, 39, W - 4, 4);
    if (st.shape !== 'redondo' && state !== 'quemada') {
      g.strokeStyle = st.trim;
      g.lineWidth = 1;
      g.strokeRect(x0 + 2.5, 22.5, W - 5, 20);
    }
    // Puerta y ventanas.
    g.fillStyle = state === 'quemada' ? '#1a1512' : st.trim;
    g.fillRect(x0 + W / 2 - 3.5, 32, 7, 11);
    if (state !== 'quemada') {
      g.fillStyle = state === 'abandonada' ? '#2a2a2a' : '#3a3f4a';
      g.fillRect(x0 + 5, 28, 5, 5);
      g.fillRect(x0 + W - 10, 28, 5, 5);
    }
    // Tejado.
    g.fillStyle = roof;
    g.beginPath();
    if (st.shape === 'plano') {
      g.rect(x0, 15, W, 8);
      g.fill();
      g.fillStyle = shade(st.roof, 0.8);
      g.fillRect(x0, 21, W, 2);
    } else if (st.shape === 'redondo') {
      g.ellipse(x0 + W / 2, 23, W / 2 + 1, 13, 0, Math.PI, 0);
      g.fill();
      g.strokeStyle = shade(st.roof, 0.75);
      g.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) (g.beginPath(), g.ellipse(x0 + W / 2, 23, (W / 2) * (i / 4), 13 * (i / 4) + 2, 0, Math.PI, 0), g.stroke());
    } else {
      const peakY = st.shape === 'alto' ? 2 : 8;
      g.moveTo(x0 - 1, 24);
      g.lineTo(x0 + W / 2, peakY);
      g.lineTo(x0 + W + 1, 24);
      g.closePath();
      g.fill();
      g.strokeStyle = shade(st.roof, 0.7);
      g.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) {
        const y = peakY + ((24 - peakY) * i) / 4;
        const half = ((W / 2 + 1) * i) / 4;
        g.beginPath();
        g.moveTo(x0 + W / 2 - half, y);
        g.lineTo(x0 + W / 2 + half, y);
        g.stroke();
      }
    }
    if (state === 'quemada') {
      g.fillStyle = 'rgba(20,16,12,0.6)';
      g.fillRect(x0 + W / 2 - 6, 8, 12, 10);
    }
    if (state === 'abandonada') {
      g.fillStyle = '#4a3a2a';
      g.fillRect(x0 + W / 2 + 2, 12 + (v % 2) * 3, 6, 5); // tejado roto
    }
    if (state === 'obra') {
      g.strokeStyle = '#8a6a44';
      g.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) (g.beginPath(), g.moveTo(x0 + 4 + i * 8, 43), g.lineTo(x0 + 4 + i * 8, 14), g.stroke());
    }
    // Chimenea.
    if (state === 'normal' && st.shape !== 'redondo') {
      g.fillStyle = shade(st.trim, 1.2);
      g.fillRect(x0 + W - 9, st.shape === 'plano' ? 9 : 10, 4, 8);
    }
  });
}

export function keyBuilding(kind: string, st: Style, extra = ''): Sprite {
  const dims: Record<string, [number, number]> = { salon: [64, 64], almacen: [48, 54], posada: [48, 50], templo: [48, 62], forja: [32, 46], hogar: [32, 48] };
  const [W, H] = dims[kind] ?? [32, 46];
  return make(`k:${kind}:${st.roof}:${st.wall}:${extra}`, W + 6, H, W / 2 + 3, H - 2, (g) => {
    const x0 = 3;
    const base = H - 2;
    ellipse(g, W / 2 + 3, base, W / 2 + 2, 4, 'rgba(0,0,0,0.25)');
    const wallTop = base - (kind === 'templo' ? 26 : kind === 'salon' ? 26 : 22);
    g.fillStyle = kind === 'almacen' ? '#b08a5a' : st.wall;
    g.fillRect(x0 + 2, wallTop, W - 4, base - wallTop);
    g.strokeStyle = st.trim;
    g.lineWidth = 1.2;
    g.strokeRect(x0 + 2.5, wallTop + 0.5, W - 5, base - wallTop - 1);
    // Puerta grande.
    g.fillStyle = st.trim;
    g.beginPath();
    g.roundRect(x0 + W / 2 - 6, base - 15, 12, 15, [6, 6, 0, 0]);
    g.fill();
    // Tejado o cúpula.
    g.fillStyle = kind === 'hogar' ? '#9c5b34' : st.roof;
    if (kind === 'templo') {
      g.beginPath();
      g.ellipse(x0 + W / 2, wallTop, W / 2 - 4, 18, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = '#e8c86a';
      g.fillRect(x0 + W / 2 - 1, wallTop - 26, 2, 9);
      ellipse(g, x0 + W / 2, wallTop - 27, 2.5, 2.5, '#e8c86a');
    } else {
      g.beginPath();
      g.moveTo(x0 - 2, wallTop + 2);
      g.lineTo(x0 + W / 2, wallTop - (kind === 'salon' ? 22 : 16));
      g.lineTo(x0 + W + 2, wallTop + 2);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.stroke();
    }
    // Detalles por tipo.
    if (kind === 'salon') {
      g.fillStyle = '#d8b04a';
      g.fillRect(x0 + W / 2 - 1, wallTop - 34, 2, 14);
      g.fillStyle = extra || '#a3362b';
      g.beginPath();
      g.moveTo(x0 + W / 2 + 1, wallTop - 34);
      g.lineTo(x0 + W / 2 + 12, wallTop - 30);
      g.lineTo(x0 + W / 2 + 1, wallTop - 26);
      g.fill();
      for (const xx of [x0 + 8, x0 + W - 14]) (g.fillStyle = '#3a3f4a'), g.fillRect(xx, wallTop + 8, 6, 7);
    }
    if (kind === 'almacen') {
      const full = extra !== 'vacio';
      g.fillStyle = '#7a5a34';
      for (let i = 0; i < 4; i++) g.fillRect(x0 + 4 + i * 2, wallTop, 1, base - wallTop);
      if (full) for (const [sx, sy] of [[x0 - 1, base - 4], [x0 + 5, base - 3], [x0 + W - 7, base - 4], [x0 + W - 1, base - 3]]) ellipse(g, sx, sy, 4, 3.5, '#d9c08a');
    }
    if (kind === 'posada') {
      g.fillStyle = '#5b3d25';
      g.fillRect(x0 + W - 4, wallTop + 2, 8, 2);
      g.fillStyle = '#e0b860';
      g.fillRect(x0 + W + 1, wallTop + 4, 6, 6);
      for (const xx of [x0 + 6, x0 + W - 14]) (g.fillStyle = '#4a4030'), g.fillRect(xx, wallTop + 6, 7, 6);
    }
    if (kind === 'forja') {
      g.fillStyle = '#4a4440';
      g.fillRect(x0 + W - 10, wallTop - 18, 6, 14);
      g.fillStyle = '#2a2420';
      g.fillRect(x0 + 4, base - 6, 8, 4);
      ellipse(g, x0 + W / 2, base - 9, 3, 2, '#e8743a');
    }
    if (kind === 'hogar') {
      g.fillStyle = '#e9b44c';
      ellipse(g, x0 + W / 2, wallTop + 6, 3, 3, '#e9b44c');
    }
  });
}

export function stall(full: boolean, color: string): Sprite {
  return make(`st:${full}:${color}`, 22, 24, 11, 22, (g) => {
    ellipse(g, 11, 22, 9, 2.5, 'rgba(0,0,0,0.2)');
    g.fillStyle = '#7a5532';
    g.fillRect(2, 8, 2, 14);
    g.fillRect(18, 8, 2, 14);
    g.fillStyle = '#9a7048';
    g.fillRect(1, 15, 20, 5);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 9);
    g.lineTo(11, 2);
    g.lineTo(22, 9);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 3; i++) g.fillRect(3 + i * 6, 6, 3, 3);
    if (full) for (const [x, c] of [[5, '#d9a441'], [10, '#a8c25a'], [15, '#c0503a']] as const) ellipse(g, x, 14, 2.6, 2, c);
  });
}

export function tent(color: string): Sprite {
  return make(`tn:${color}`, 26, 22, 13, 20, (g) => {
    ellipse(g, 13, 20, 12, 3, 'rgba(0,0,0,0.25)');
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(1, 20);
    g.lineTo(13, 2);
    g.lineTo(25, 20);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.moveTo(10, 20);
    g.lineTo(13, 9);
    g.lineTo(16, 20);
    g.closePath();
    g.fill();
  });
}

export function post(color: string, closed: boolean): Sprite {
  return make(`po:${color}:${closed}`, 40, 40, 20, 36, (g) => {
    ellipse(g, 20, 36, 16, 3, 'rgba(0,0,0,0.2)');
    // Garita.
    g.fillStyle = '#9a7a52';
    g.fillRect(2, 18, 12, 18);
    g.fillStyle = '#6b4a2e';
    g.beginPath();
    g.moveTo(0, 19);
    g.lineTo(8, 11);
    g.lineTo(16, 19);
    g.fill();
    // Mástil y bandera.
    g.fillStyle = '#5b3d25';
    g.fillRect(31, 2, 2, 34);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(33, 3);
    g.lineTo(40, 6);
    g.lineTo(33, 10);
    g.fill();
    // Barrera.
    g.strokeStyle = closed ? '#a3362b' : '#c9b48a';
    g.lineWidth = 2.2;
    g.beginPath();
    if (closed) (g.moveTo(14, 28), g.lineTo(30, 28));
    else (g.moveTo(14, 28), g.lineTo(18, 14));
    g.stroke();
  });
}

export function barricade(): Sprite {
  return make('barricada', 34, 18, 17, 16, (g) => {
    ellipse(g, 17, 16, 15, 2.5, 'rgba(0,0,0,0.25)');
    g.strokeStyle = '#5b3d25';
    g.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) (g.beginPath(), g.moveTo(3 + i * 7, 16), g.lineTo(7 + i * 7, 3), g.stroke());
    g.strokeStyle = '#7a5532';
    g.beginPath();
    g.moveTo(1, 10);
    g.lineTo(33, 10);
    g.stroke();
  });
}

export function placeSprite(kind: string): Sprite {
  return make(`pl:${kind}`, 44, 40, 22, 36, (g) => {
    ellipse(g, 22, 36, 18, 3.5, 'rgba(0,0,0,0.22)');
    switch (kind) {
      case 'cueva':
      case 'mina':
        g.fillStyle = '#7c776e';
        g.beginPath();
        g.moveTo(2, 36);
        g.lineTo(12, 8);
        g.lineTo(32, 6);
        g.lineTo(42, 36);
        g.fill();
        g.fillStyle = '#1e1a16';
        g.beginPath();
        g.ellipse(22, 36, 9, 13, 0, Math.PI, 0);
        g.fill();
        if (kind === 'mina') {
          g.fillStyle = '#7a5532';
          g.fillRect(12, 22, 3, 14);
          g.fillRect(29, 22, 3, 14);
          g.fillRect(12, 21, 20, 3);
        }
        break;
      case 'ruinas':
      case 'templo':
        g.fillStyle = '#b8b0a0';
        for (const [x, h] of [[6, 22], [16, 30], [28, 14], [36, 26]]) g.fillRect(x, 36 - h, 5, h);
        g.fillStyle = '#9a9284';
        g.fillRect(4, 33, 38, 3);
        if (kind === 'templo') (g.fillStyle = '#a89e8a'), g.fillRect(14, 6, 18, 4);
        break;
      case 'circulo':
        g.fillStyle = '#a49c8c';
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          g.fillRect(20 + Math.cos(a) * 16, 24 + Math.sin(a) * 8, 4, 10);
        }
        break;
      case 'campamento':
        g.fillStyle = '#8a7a5a';
        g.beginPath();
        g.moveTo(4, 34);
        g.lineTo(14, 14);
        g.lineTo(24, 34);
        g.fill();
        ellipse(g, 32, 33, 5, 2, '#3a2a1a');
        break;
      case 'abandonada':
        g.fillStyle = '#8a7a64';
        g.fillRect(8, 18, 26, 18);
        g.fillStyle = '#5a4a3a';
        g.beginPath();
        g.moveTo(6, 19);
        g.lineTo(21, 6);
        g.lineTo(36, 19);
        g.fill();
        g.fillStyle = '#2a2420';
        g.fillRect(18, 10, 8, 6);
        break;
      case 'puesto':
        g.fillStyle = '#9a7048';
        g.fillRect(6, 22, 30, 12);
        g.fillStyle = '#b5562d';
        g.fillRect(4, 14, 34, 7);
        break;
      case 'bosque':
        g.fillStyle = '#e8d9a0';
        for (const [x, y] of [[10, 30], [22, 26], [34, 30]]) ellipse(g, x, y, 3, 3, '#f3e6b0');
        g.fillStyle = '#6b8a4a';
        g.fillRect(20, 14, 4, 18);
        break;
      case 'secreto':
        g.fillStyle = '#6a7a8a';
        g.fillRect(17, 12, 10, 24);
        g.fillStyle = 'rgba(180,220,255,0.6)';
        g.fillRect(19, 16, 6, 3);
        break;
      case 'camino':
        g.fillStyle = '#b0a690';
        for (let i = 0; i < 6; i++) g.fillRect(4 + i * 6, 28 + (i % 2) * 3, 5, 4);
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Animales
// ---------------------------------------------------------------------------
export function animal(kind: 'vaca' | 'oveja' | 'gallina' | 'ciervo', frame: number, flip: boolean): Sprite {
  return make(`a:${kind}:${frame}:${flip}`, 22, 18, 11, 16, (g) => {
    if (flip) (g.translate(22, 0), g.scale(-1, 1));
    const leg = frame ? 1 : -1;
    if (kind === 'gallina') {
      ellipse(g, 11, 16, 4, 1.2, 'rgba(0,0,0,0.2)');
      ellipse(g, 11, 12, 4, 3, '#f3efe6');
      ellipse(g, 14, 9, 2, 2, '#f3efe6');
      g.fillStyle = '#d9473a';
      g.fillRect(14, 6.5, 2, 1.5);
      return;
    }
    const body = kind === 'vaca' ? '#f1ece2' : kind === 'oveja' ? '#efe8d8' : '#9a6a3c';
    ellipse(g, 11, 16, 8, 2, 'rgba(0,0,0,0.22)');
    g.strokeStyle = kind === 'oveja' ? '#3a3330' : '#5a4636';
    g.lineWidth = 1.6;
    for (const x of [6, 9, 13, 16]) (g.beginPath(), g.moveTo(x, 11), g.lineTo(x + (x % 2 ? leg : -leg) * 0.6, 15.5), g.stroke());
    if (kind === 'oveja') {
      for (const [x, y] of [[7, 9], [11, 8], [14, 9.5], [9, 11], [13, 11]]) ellipse(g, x, y, 3.2, 2.8, body);
      ellipse(g, 18, 8.5, 2.2, 2, '#3a3330');
    } else {
      ellipse(g, 11, 9.5, 7, 3.6, body);
      if (kind === 'vaca') for (const [x, y] of [[8, 9], [13, 10]]) ellipse(g, x, y, 2, 1.6, '#3a3330');
      ellipse(g, 18.5, 7.5, 2.6, 2.2, body);
      if (kind === 'ciervo') {
        g.strokeStyle = '#6b4a2a';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(18, 5.5);
        g.lineTo(16, 1);
        g.moveTo(19, 5.5);
        g.lineTo(21, 1);
        g.stroke();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
export interface Look {
  body: string;
  skin: string;
  hair: string;
  hat?: 'casco' | 'sombrero' | 'capucha' | 'corona' | 'pañuelo';
  carry?: 'lanza' | 'saco' | 'cayado' | 'cesta' | 'farol';
  small?: boolean;
  cape?: string;
}

export function person(look: Look, frame: number, flip: boolean): Sprite {
  const key = `p:${look.body}:${look.skin}:${look.hair}:${look.hat}:${look.carry}:${look.small}:${look.cape}:${frame}:${flip}`;
  const s = look.small ? 0.72 : 1;
  return make(key, 18, 30, 9, 28, (g) => {
    if (flip) (g.translate(18, 0), g.scale(-1, 1));
    ellipse(g, 9, 28, 5 * s, 1.8, 'rgba(0,0,0,0.25)');
    g.translate(9, 28);
    g.scale(s, s);
    g.translate(-9, -28);
    const step = frame === 1 ? 1.6 : frame === 2 ? -1.6 : 0;
    // Piernas.
    g.strokeStyle = '#3a2f28';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(7.5, 21);
    g.lineTo(7.5 + step, 27.5);
    g.moveTo(10.5, 21);
    g.lineTo(10.5 - step, 27.5);
    g.stroke();
    if (look.cape) {
      g.fillStyle = look.cape;
      g.beginPath();
      g.moveTo(5, 12);
      g.lineTo(13, 12);
      g.lineTo(14.5, 24);
      g.lineTo(3.5, 24);
      g.fill();
    }
    // Cuerpo.
    g.fillStyle = look.body;
    g.beginPath();
    g.roundRect(5, 11, 8, 11.5, 3);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(5, 18.5, 8, 1.4);
    // Cabeza.
    ellipse(g, 9, 7.5, 3.6, 3.8, look.skin);
    g.fillStyle = look.hair;
    g.beginPath();
    g.ellipse(9, 5.6, 3.7, 2.4, 0, Math.PI, 0);
    g.fill();
    switch (look.hat) {
      case 'casco':
        g.fillStyle = '#8a8f96';
        g.beginPath();
        g.ellipse(9, 5.2, 4.2, 3, 0, Math.PI, 0);
        g.fill();
        g.fillRect(4.6, 5, 8.8, 1.2);
        break;
      case 'sombrero':
        g.fillStyle = '#c9a65a';
        g.fillRect(3.5, 4.5, 11, 1.4);
        g.fillRect(6, 2, 6, 3);
        break;
      case 'capucha':
        g.fillStyle = look.body;
        g.beginPath();
        g.ellipse(9, 6.4, 4.4, 4.6, 0, Math.PI * 1.05, -0.05);
        g.fill();
        break;
      case 'corona':
        g.fillStyle = '#e2b84a';
        g.fillRect(5.5, 2.4, 7, 2);
        for (const x of [6, 9, 12]) g.fillRect(x - 0.6, 1, 1.2, 1.6);
        break;
      case 'pañuelo':
        g.fillStyle = '#b5562d';
        g.beginPath();
        g.ellipse(9, 5, 3.9, 2.2, 0, Math.PI, 0);
        g.fill();
        break;
    }
    // Brazos y objeto.
    g.strokeStyle = look.skin;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(5, 13);
    g.lineTo(4 - step * 0.4, 19);
    g.moveTo(13, 13);
    g.lineTo(14 + step * 0.4, 19);
    g.stroke();
    switch (look.carry) {
      case 'lanza':
        g.strokeStyle = '#6b4a2a';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(14.5, 24);
        g.lineTo(14.5, 0);
        g.stroke();
        g.fillStyle = '#b8bec6';
        g.beginPath();
        g.moveTo(14.5, -2);
        g.lineTo(16, 2);
        g.lineTo(13, 2);
        g.fill();
        break;
      case 'saco':
        ellipse(g, 4, 15, 3.4, 4, '#c9b07a');
        break;
      case 'cayado':
        g.strokeStyle = '#7a5532';
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(14.5, 26);
        g.lineTo(14.5, 6);
        g.arc(13, 6, 1.5, 0, Math.PI, true);
        g.stroke();
        break;
      case 'cesta':
        g.fillStyle = '#a07a3e';
        g.fillRect(12.5, 17, 5, 4);
        break;
      case 'farol':
        g.fillStyle = '#f2c35a';
        g.fillRect(13.5, 17, 3, 4);
        break;
    }
  });
}

export function cart(oxFrame: number, flip: boolean, cargo: string): Sprite {
  return make(`c:${oxFrame}:${flip}:${cargo}`, 40, 26, 20, 23, (g) => {
    if (flip) (g.translate(40, 0), g.scale(-1, 1));
    ellipse(g, 20, 23, 18, 2.6, 'rgba(0,0,0,0.25)');
    // Buey.
    const leg = oxFrame ? 1 : -1;
    g.strokeStyle = '#4a3626';
    g.lineWidth = 1.8;
    for (const x of [30, 33, 36]) (g.beginPath(), g.moveTo(x, 15), g.lineTo(x + leg * 0.6, 21), g.stroke());
    ellipse(g, 33, 13, 6, 3.5, '#8a6a4a');
    ellipse(g, 38.5, 11, 2.5, 2.2, '#8a6a4a');
    // Carro.
    g.fillStyle = '#7a5532';
    g.fillRect(4, 10, 22, 8);
    g.fillStyle = cargo;
    ellipse(g, 9, 9, 4.5, 3.5, cargo);
    ellipse(g, 16, 8, 4.5, 4, cargo);
    ellipse(g, 22, 9, 4, 3.5, cargo);
    g.fillStyle = '#3a2a1a';
    ellipse(g, 9, 19, 3.6, 3.6, '#3a2a1a');
    ellipse(g, 21, 19, 3.6, 3.6, '#3a2a1a');
    ellipse(g, 9, 19, 1.4, 1.4, '#9a7a52');
    ellipse(g, 21, 19, 1.4, 1.4, '#9a7a52');
  });
}
