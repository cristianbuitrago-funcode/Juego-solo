import { alpha, blob, ell, lit, rng, shd, tex, vgrad, type Tex } from '../paint';

/**
 * Animales pintados de perfil (mirando a la derecha, el pie en y = 0). Cada especie tiene su propia
 * silueta y sus rasgos de lectura, para que se distingan de un vistazo a la altura de la cámara:
 * la vaca, ancha y de lomo recto, con cuernos, ubre y cola con borla; el caballo, de cuello largo
 * arqueado, crin y cola larga; el ciervo, fino y zancudo, con cornamenta y grupa blanca; la oveja,
 * una nube de lana con cara y patas negras; el perro, con hocico, oreja caída, cola alzada y collar;
 * el gato, pequeño, de orejas en punta y cola larga en alto; el lobo, gris, con lomo oscuro, orejas
 * tiesas, hocico largo y cola tupida caída; el oso, enorme, con joroba, orejas redondas y sin cola.
 * Antes todos eran un óvalo con otro óvalo por cabeza y solo cambiaban de tamaño y color.
 */
export type AnimalKind = 'vaca' | 'oveja' | 'gallina' | 'ciervo' | 'caballo' | 'perro' | 'pato' | 'gato' | 'lobo' | 'oso';

interface Coat {
  body: string;
  spot?: string;
  leg: string;
  head: string;
  /** Vientre, hocico y cara interna (más claros). */
  belly?: string;
}
const COATS: Record<AnimalKind, Coat[]> = {
  vaca: [{ body: '#f2ece2', spot: '#2a2420', leg: '#e8e0d4', head: '#f2ece2' }, { body: '#8a5a36', leg: '#7a4a2c', head: '#8a5a36', belly: '#a8784e' }, { body: '#c8a070', spot: '#f2ece2', leg: '#b08858', head: '#c8a070' }],
  oveja: [{ body: '#efe8da', leg: '#3a3030', head: '#3a3030' }, { body: '#e4dccb', leg: '#2a2424', head: '#f2ece2' }, { body: '#d8ccb8', leg: '#3a3030', head: '#3a3030' }],
  gallina: [{ body: '#f2ece2', leg: '#e0a030', head: '#f2ece2' }, { body: '#a85a2a', leg: '#e0a030', head: '#a85a2a', spot: '#3a2a20' }, { body: '#3a3030', leg: '#e0a030', head: '#3a3030', spot: '#2a4a3a' }],
  ciervo: [{ body: '#9a6438', leg: '#7a4a28', head: '#9a6438', belly: '#e8dcc4' }],
  caballo: [{ body: '#6b4a30', leg: '#3a2a20', head: '#6b4a30', spot: '#2a1e18' }, { body: '#3a2a20', leg: '#2a1e18', head: '#3a2a20', spot: '#1a1410' }, { body: '#c9b08a', leg: '#8a6a4a', head: '#c9b08a', spot: '#f0e6d0' }],
  perro: [{ body: '#a8743c', leg: '#8a5a2c', head: '#a8743c', belly: '#e0c8a0' }, { body: '#3a3030', spot: '#e8e0d0', leg: '#3a3030', head: '#3a3030', belly: '#e8e0d0' }, { body: '#d8c8a8', leg: '#b8a888', head: '#d8c8a8' }],
  pato: [{ body: '#efe8da', leg: '#e0a030', head: '#3a7a4a' }, { body: '#8a6a4a', leg: '#e0a030', head: '#5a4a3a' }],
  gato: [{ body: '#d08a3a', spot: '#9a5a22', leg: '#d08a3a', head: '#d08a3a', belly: '#f2e2c8' }, { body: '#4a4448', spot: '#2a2628', leg: '#4a4448', head: '#4a4448', belly: '#e8e4e0' }, { body: '#2a2426', leg: '#2a2426', head: '#2a2426' }],
  lobo: [{ body: '#8a8a86', spot: '#4a4844', leg: '#a8a49c', head: '#8a8a86', belly: '#e0dad0' }, { body: '#9a8a74', spot: '#5a4a3a', leg: '#b0a08a', head: '#9a8a74', belly: '#e6dccb' }],
  oso: [{ body: '#6a4630', leg: '#4a301e', head: '#6a4630', belly: '#9a7050' }, { body: '#3a2c24', leg: '#2a1e18', head: '#3a2c24', belly: '#6a5040' }],
};

/** Largo del cuerpo, alto del cuerpo y largo de la pata (píxeles de mundo). */
const SIZE: Record<AnimalKind, [number, number, number]> = {
  vaca: [30, 14, 10],
  oveja: [18, 11, 6],
  gallina: [6.5, 5.5, 3],
  ciervo: [22, 9, 15],
  caballo: [30, 12, 17],
  perro: [15, 7, 7],
  pato: [7.5, 4.5, 0.8],
  gato: [10, 4.6, 4.6],
  // (a escala de una persona de ~30 px: el lobo, por la cintura; el oso a cuatro patas, por el pecho)
  lobo: [17, 6.5, 7.5],
  oso: [23, 11, 6.5],
};

/** Mitad del ancho en el suelo (casillas): para que no se metan en muebles ni se pisen. */
export const ANIMAL_HALF: Record<AnimalKind, number> = { vaca: 0.8, caballo: 0.8, oso: 0.8, ciervo: 0.6, lobo: 0.6, oveja: 0.55, perro: 0.5, gato: 0.3, gallina: 0.25, pato: 0.25 };

type G = CanvasRenderingContext2D;

/** Pata: muslo/antebrazo que se estrecha hasta la pezuña o la zarpa. `sw` es el balanceo (rad). */
function leg(g: G, x: number, top: number, len: number, w0: number, w1: number, color: string, sw: number, foot: 'pezuna' | 'zarpa' | 'ave' | 'none', footColor = '#2a2420'): void {
  g.save();
  g.translate(x, top);
  g.rotate(sw);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-w0 / 2, 0);
  g.lineTo(w0 / 2, 0);
  g.lineTo(w1 / 2, len);
  g.lineTo(-w1 / 2, len);
  g.closePath();
  g.fill();
  if (foot === 'pezuna') {
    g.fillStyle = footColor;
    g.fillRect(-w1 / 2 - 0.15, len - 1.3, w1 + 0.3, 1.3);
  } else if (foot === 'zarpa') {
    ell(g, w1 * 0.25, len - w1 * 0.25, w1 * 0.75, w1 * 0.4, shd(color, 0.1));
  }
  g.restore();
}

export function animalTex(kind: AnimalKind, frame: number, v = 0): Tex {
  const coats = COATS[kind];
  const coat = coats[v % coats.length];
  const [L, Hb, lg] = SIZE[kind];
  const W = Math.ceil(L * 1.9 + 14);
  const H = Math.ceil(Hb + lg + L * 0.95 + 8);
  return tex(`animal3:${kind}:${frame % 4}:${v % coats.length}`, W, H, W / 2, H - 2, (g) => {
    const ph = (frame % 4) * (Math.PI / 2);
    const R = rng(v * 31 + kind.length * 7);
    const sw = (i: number, k = 0.32) => Math.sin(ph + (i % 2 ? Math.PI : 0)) * k;
    const by = -lg - Hb * 0.5; // centro del cuerpo
    const fill = (c: string, y0 = by - Hb * 0.6, y1 = by + Hb * 0.6) => vgrad(g, y0, y1, [[0, lit(c, 0.18)], [0.6, c], [1, shd(c, 0.3)]]);
    const far = shd(coat.leg, 0.28);
    const eye = (x: number, y: number, r: number, iris = '#141010') => {
      ell(g, x, y, r, r, iris);
      ell(g, x + r * 0.3, y - r * 0.3, r * 0.35, r * 0.35, 'rgba(255,255,255,0.7)');
    };
    switch (kind) {
      case 'vaca': {
        const top = by - Hb * 0.15;
        leg(g, L * 0.3, top, lg + Hb * 0.4, 3.2, 2.4, far, sw(1, 0.22), 'pezuna');
        leg(g, -L * 0.3, top, lg + Hb * 0.4, 3.6, 2.4, far, sw(0, 0.22), 'pezuna');
        // Cola fina que cuelga hasta el corvejón, con borla oscura.
        g.strokeStyle = shd(coat.body, 0.2);
        g.lineWidth = 0.9;
        g.beginPath();
        g.moveTo(-L * 0.47, by - Hb * 0.42);
        g.quadraticCurveTo(-L * 0.56, by, -L * 0.54, by + Hb * 0.75);
        g.stroke();
        ell(g, -L * 0.54, by + Hb * 0.85, 0.9, 1.6, '#2a2420');
        // Cuerpo ancho de lomo recto, cadera marcada y barriga algo caída.
        blob(g, [-L * 0.5, by - Hb * 0.45, -L * 0.36, by - Hb * 0.58, L * 0.2, by - Hb * 0.5, L * 0.46, by - Hb * 0.38, L * 0.5, by + Hb * 0.2, L * 0.3, by + Hb * 0.5, -L * 0.05, by + Hb * 0.6, -L * 0.42, by + Hb * 0.45, -L * 0.52, by + Hb * 0.05], fill(coat.body), 0.45);
        if (coat.spot) for (let i = 0; i < 3; i++) ell(g, (R() - 0.5) * L * 0.6, by + (R() - 0.6) * Hb * 0.5, L * (0.1 + R() * 0.07), Hb * (0.2 + R() * 0.12), coat.spot, (R() - 0.5) * 1.2);
        // Ubre.
        ell(g, -L * 0.2, by + Hb * 0.62, 2.6, 1.6, '#e8b0a8');
        for (const dx of [-1, 0.6]) ell(g, -L * 0.2 + dx, by + Hb * 0.62 + 1.6, 0.4, 0.8, '#d89890');
        // Cabeza grande en cuña, más baja que el lomo, con morro ancho y claro.
        const hx = L * 0.5;
        const hy = by - Hb * 0.15;
        blob(g, [hx - 1, hy - 4, hx + 5, hy - 3.5, hx + 8.5, hy + 1.5, hx + 8, hy + 4.2, hx + 4, hy + 4.4, hx - 1.5, hy + 2], fill(coat.head, hy - 4, hy + 4), 0.4);
        ell(g, hx + 7.4, hy + 3, 2.1, 1.6, '#e0b0a0');
        ell(g, hx + 8.3, hy + 2.6, 0.35, 0.3, '#5a3a30');
        // Cuernos claros que se curvan hacia delante y orejas a los lados.
        g.strokeStyle = '#e8e0c8';
        g.lineCap = 'round';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(hx + 1.5, hy - 3.6);
        g.quadraticCurveTo(hx + 1, hy - 7, hx + 3.6, hy - 7.6);
        g.stroke();
        ell(g, hx - 1.6, hy - 2.2, 2, 0.9, shd(coat.head, 0.15), 0.4);
        eye(hx + 3.8, hy - 1, 0.6);
        leg(g, L * 0.38, top, lg + Hb * 0.4, 3.2, 2.4, coat.leg, sw(0, 0.22), 'pezuna');
        leg(g, -L * 0.24, top, lg + Hb * 0.4, 3.6, 2.4, coat.leg, sw(1, 0.22), 'pezuna');
        break;
      }
      case 'caballo': {
        const top = by - Hb * 0.1;
        leg(g, L * 0.3, top, lg + Hb * 0.35, 3, 1.8, far, sw(1), 'pezuna');
        leg(g, -L * 0.3, top, lg + Hb * 0.35, 3.6, 1.8, far, sw(0), 'pezuna');
        // Cola larga y suelta.
        blob(g, [-L * 0.46, by - Hb * 0.45, -L * 0.6, by - Hb * 0.1, -L * 0.66, by + Hb * 0.8, -L * 0.58, by + Hb * 1.15, -L * 0.53, by + Hb * 0.5, -L * 0.48, by - Hb * 0.1], coat.spot ?? shd(coat.body, 0.4), 0.5);
        // Cuerpo con pecho hondo y grupa redonda.
        blob(g, [-L * 0.5, by - Hb * 0.2, -L * 0.4, by - Hb * 0.55, L * 0.05, by - Hb * 0.48, L * 0.35, by - Hb * 0.55, L * 0.5, by - Hb * 0.1, L * 0.42, by + Hb * 0.48, -L * 0.1, by + Hb * 0.5, -L * 0.45, by + Hb * 0.4], fill(coat.body), 0.45);
        // Cuello largo y arqueado; cabeza alargada que baja hacia el morro.
        const nx = L * 0.5;
        const ny = by - Hb * 1.25;
        blob(g, [L * 0.26, by - Hb * 0.5, nx - 2, ny - 2, nx + 2, ny - 3, nx + 4, ny + 1, L * 0.5, by + Hb * 0.05], fill(coat.body, ny, by), 0.5);
        blob(g, [nx - 1, ny - 3.2, nx + 3, ny - 3.4, nx + 9.5, ny + 3, nx + 9.6, ny + 5, nx + 7, ny + 5.4, nx + 1, ny + 2], fill(coat.head, ny - 3, ny + 5), 0.4);
        ell(g, nx + 8.6, ny + 4.4, 0.45, 0.35, '#1a1210');
        // Orejas en punta y crin oscura por el cuello, con mechón en la frente.
        g.fillStyle = shd(coat.head, 0.2);
        g.beginPath();
        g.moveTo(nx, ny - 2.8);
        g.lineTo(nx + 0.4, ny - 6);
        g.lineTo(nx + 1.8, ny - 3);
        g.fill();
        g.strokeStyle = coat.spot ?? shd(coat.body, 0.45);
        g.lineCap = 'round';
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(L * 0.24, by - Hb * 0.55);
        g.quadraticCurveTo(nx - 3.5, ny + 1, nx - 0.6, ny - 2.4);
        g.stroke();
        eye(nx + 3.4, ny - 0.6, 0.6);
        leg(g, L * 0.38, top, lg + Hb * 0.35, 3, 1.8, coat.leg, sw(0), 'pezuna');
        leg(g, -L * 0.24, top, lg + Hb * 0.35, 3.6, 1.8, coat.leg, sw(1), 'pezuna');
        break;
      }
      case 'ciervo': {
        const top = by;
        leg(g, L * 0.3, top, lg + Hb * 0.3, 2, 1.1, far, sw(1), 'pezuna');
        leg(g, -L * 0.3, top, lg + Hb * 0.3, 2.6, 1.1, far, sw(0), 'pezuna');
        // Cuerpo fino, grupa blanca y rabo corto y blanco en alto.
        blob(g, [-L * 0.5, by - Hb * 0.25, -L * 0.36, by - Hb * 0.55, L * 0.3, by - Hb * 0.52, L * 0.5, by - Hb * 0.1, L * 0.4, by + Hb * 0.45, -L * 0.36, by + Hb * 0.4], fill(coat.body), 0.5);
        ell(g, -L * 0.44, by - Hb * 0.05, L * 0.1, Hb * 0.38, coat.belly ?? '#f0e8d8');
        ell(g, -L * 0.52, by - Hb * 0.5, 1.1, 1.8, '#f6f0e4', -0.5);
        ell(g, 0, by + Hb * 0.36, L * 0.32, Hb * 0.14, alpha(coat.belly ?? '#f0e8d8', 0.8));
        // Cuello alzado y cabeza pequeña con orejas grandes.
        const nx = L * 0.48;
        const ny = by - Hb * 1.45;
        blob(g, [L * 0.3, by - Hb * 0.45, nx - 1.5, ny + 1, nx + 2, ny, L * 0.5, by + Hb * 0.05], fill(coat.body, ny, by), 0.5);
        blob(g, [nx - 1.5, ny - 1.8, nx + 3, ny - 2, nx + 6.4, ny + 1.6, nx + 5.6, ny + 2.8, nx + 1, ny + 2], fill(coat.head, ny - 2, ny + 3), 0.4);
        ell(g, nx + 6, ny + 1.8, 0.5, 0.45, '#141010');
        ell(g, nx - 1.2, ny - 2.4, 2.2, 0.9, shd(coat.head, 0.1), -0.6);
        eye(nx + 2.4, ny - 0.4, 0.55);
        // Cornamenta ramificada.
        g.strokeStyle = '#d8c8a0';
        g.lineCap = 'round';
        g.lineWidth = 0.75;
        for (const sx of [0, 1.3]) {
          g.beginPath();
          g.moveTo(nx + 0.6 + sx, ny - 2);
          g.lineTo(nx - 0.6 + sx, ny - 8);
          g.lineTo(nx - 2.8 + sx, ny - 11);
          g.moveTo(nx - 0.2 + sx, ny - 5);
          g.lineTo(nx + 2 + sx, ny - 7.5);
          g.moveTo(nx - 1.4 + sx, ny - 9);
          g.lineTo(nx + 0.4 + sx, ny - 11.5);
          g.stroke();
        }
        leg(g, L * 0.38, top, lg + Hb * 0.3, 2, 1.1, coat.leg, sw(0), 'pezuna');
        leg(g, -L * 0.24, top, lg + Hb * 0.3, 2.6, 1.1, coat.leg, sw(1), 'pezuna');
        break;
      }
      case 'oveja': {
        const top = by + Hb * 0.2;
        leg(g, L * 0.26, top, lg + Hb * 0.25, 1.6, 1.3, far, sw(1, 0.25), 'pezuna', '#1a1414');
        leg(g, -L * 0.28, top, lg + Hb * 0.25, 1.6, 1.3, far, sw(0, 0.25), 'pezuna', '#1a1414');
        // Una nube de lana de borde rizado.
        const wool = coat.body;
        ell(g, 0, by, L * 0.5, Hb * 0.5, fill(wool));
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          ell(g, Math.cos(a) * L * 0.46, by + Math.sin(a) * Hb * 0.44, Hb * 0.22, Hb * 0.2, i % 3 ? lit(wool, 0.08) : shd(wool, 0.06));
        }
        for (let i = 0; i < 8; i++) ell(g, (R() - 0.5) * L * 0.7, by + (R() - 0.6) * Hb * 0.6, Hb * 0.16, Hb * 0.14, lit(wool, 0.14));
        // Cara alargada y oscura (o clara), orejas de lado y un mechón de lana en la frente.
        const hx = L * 0.48;
        const hy = by - Hb * 0.3;
        blob(g, [hx - 1, hy - 2.4, hx + 2.4, hy - 2.6, hx + 5, hy + 1.2, hx + 4.2, hy + 2.6, hx + 0.6, hy + 2], fill(coat.head, hy - 3, hy + 3), 0.45);
        ell(g, hx - 0.6, hy - 1.4, 2.2, 0.8, shd(coat.head, 0.15), 0.35);
        ell(g, hx + 0.4, hy - 2.6, 2, 1.4, lit(wool, 0.1));
        eye(hx + 2, hy - 0.6, 0.45, coat.head === '#3a3030' || coat.head === '#2a2424' ? '#d8c890' : '#141010');
        leg(g, L * 0.34, top, lg + Hb * 0.25, 1.6, 1.3, coat.leg, sw(0, 0.25), 'pezuna', '#1a1414');
        leg(g, -L * 0.2, top, lg + Hb * 0.25, 1.6, 1.3, coat.leg, sw(1, 0.25), 'pezuna', '#1a1414');
        break;
      }
      case 'perro': {
        const top = by - Hb * 0.1;
        leg(g, L * 0.3, top, lg + Hb * 0.45, 2, 1.6, far, sw(1, 0.4), 'zarpa');
        leg(g, -L * 0.3, top, lg + Hb * 0.45, 2.4, 1.6, far, sw(0, 0.4), 'zarpa');
        // Cola alzada y curvada que menea.
        const wag = Math.sin(ph * 2) * 0.25;
        g.strokeStyle = shd(coat.body, 0.05);
        g.lineCap = 'round';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(-L * 0.46, by - Hb * 0.25);
        g.quadraticCurveTo(-L * 0.62, by - Hb * (1 + wag), -L * 0.5 + wag * 3, by - Hb * 1.45);
        g.stroke();
        // Cuerpo con pecho hondo y cintura recogida.
        blob(g, [-L * 0.48, by - Hb * 0.35, -L * 0.2, by - Hb * 0.5, L * 0.3, by - Hb * 0.55, L * 0.5, by - Hb * 0.1, L * 0.42, by + Hb * 0.55, L * 0.05, by + Hb * 0.4, -L * 0.3, by + Hb * 0.35, -L * 0.5, by + Hb * 0.1], fill(coat.body), 0.5);
        if (coat.belly) ell(g, L * 0.32, by + Hb * 0.2, L * 0.14, Hb * 0.35, coat.belly);
        // Cabeza alta con hocico y oreja caída; collar rojo.
        const hx = L * 0.46;
        const hy = by - Hb * 0.95;
        blob(g, [hx - 2.2, hy - 2.2, hx + 1.6, hy - 2.6, hx + 3.6, hy - 0.6, hx + 6.6, hy + 0.2, hx + 6.6, hy + 1.8, hx + 2.4, hy + 2.6, hx - 1.6, hy + 2.2], fill(coat.head, hy - 3, hy + 3), 0.45);
        if (coat.belly) ell(g, hx + 5, hy + 1.6, 1.8, 0.9, coat.belly);
        ell(g, hx + 6.6, hy + 0.5, 0.75, 0.65, '#141010');
        blob(g, [hx - 1.4, hy - 2.4, hx + 0.6, hy - 2.6, hx + 0.2, hy + 1.8, hx - 1.4, hy + 1.2], shd(coat.head, 0.3), 0.5);
        eye(hx + 2.6, hy - 0.8, 0.55);
        g.strokeStyle = '#b8302a';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(hx - 2.2, hy + 2.6);
        g.lineTo(hx + 0.8, hy + 3.4);
        g.stroke();
        leg(g, L * 0.38, top, lg + Hb * 0.45, 2, 1.6, coat.leg, sw(0, 0.4), 'zarpa');
        leg(g, -L * 0.24, top, lg + Hb * 0.45, 2.4, 1.6, coat.leg, sw(1, 0.4), 'zarpa');
        break;
      }
      case 'gato': {
        const top = by;
        leg(g, L * 0.3, top, lg + Hb * 0.4, 1.2, 1, far, sw(1, 0.35), 'zarpa');
        leg(g, -L * 0.3, top, lg + Hb * 0.4, 1.5, 1, far, sw(0, 0.35), 'zarpa');
        // Cola larga en alto con la punta doblada: la seña del gato.
        const sway = Math.sin(ph) * 0.8;
        g.strokeStyle = coat.body;
        g.lineCap = 'round';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(-L * 0.45, by - Hb * 0.2);
        g.bezierCurveTo(-L * 0.75, by - Hb * 1.2, -L * 0.45 + sway, by - Hb * 2.4, -L * 0.62 + sway, by - Hb * 2.6);
        g.stroke();
        // Cuerpo esbelto, lomo un poco arqueado.
        blob(g, [-L * 0.5, by - Hb * 0.2, -L * 0.2, by - Hb * 0.62, L * 0.3, by - Hb * 0.5, L * 0.5, by - Hb * 0.05, L * 0.35, by + Hb * 0.5, -L * 0.4, by + Hb * 0.45], fill(coat.body), 0.5);
        if (coat.spot) {
          g.strokeStyle = coat.spot;
          g.lineWidth = 0.6;
          for (let i = 0; i < 4; i++) {
            const x = -L * 0.32 + i * L * 0.2;
            g.beginPath();
            g.moveTo(x, by - Hb * 0.55);
            g.lineTo(x - 0.6, by + Hb * 0.1);
            g.stroke();
          }
        }
        if (coat.belly) ell(g, L * 0.3, by + Hb * 0.15, L * 0.12, Hb * 0.3, coat.belly);
        // Cabeza redonda y pequeña con dos orejas triangulares tiesas; ojos claros.
        const hx = L * 0.52;
        const hy = by - Hb * 0.8;
        ell(g, hx + 1.2, hy, 2.4, 2.1, fill(coat.head, hy - 2, hy + 2));
        g.fillStyle = coat.head;
        for (const ox of [-0.6, 1.7]) {
          g.beginPath();
          g.moveTo(hx + ox - 0.4, hy - 1.4);
          g.lineTo(hx + ox + 0.4, hy - 3.9);
          g.lineTo(hx + ox + 1.5, hy - 1.2);
          g.fill();
        }
        ell(g, hx + 2.7, hy + 0.5, 1, 0.75, coat.belly ?? lit(coat.head, 0.15));
        ell(g, hx + 3.5, hy + 0.2, 0.3, 0.25, '#d88a8a');
        ell(g, hx + 2, hy - 0.5, 0.5, 0.45, '#c8d050');
        ell(g, hx + 2.05, hy - 0.5, 0.15, 0.4, '#141010');
        g.strokeStyle = 'rgba(240,235,225,0.6)';
        g.lineWidth = 0.18;
        g.beginPath();
        g.moveTo(hx + 3, hy + 0.6);
        g.lineTo(hx + 5, hy + 0.2);
        g.moveTo(hx + 3, hy + 0.8);
        g.lineTo(hx + 5, hy + 1.1);
        g.stroke();
        leg(g, L * 0.38, top, lg + Hb * 0.4, 1.2, 1, coat.leg, sw(0, 0.35), 'zarpa');
        leg(g, -L * 0.24, top, lg + Hb * 0.4, 1.5, 1, coat.leg, sw(1, 0.35), 'zarpa');
        break;
      }
      case 'lobo': {
        const top = by - Hb * 0.1;
        leg(g, L * 0.3, top, lg + Hb * 0.45, 2.4, 1.7, far, sw(1, 0.4), 'zarpa');
        leg(g, -L * 0.3, top, lg + Hb * 0.45, 2.8, 1.7, far, sw(0, 0.4), 'zarpa');
        // Cola tupida que cae (no se alza como la del perro), con la punta oscura.
        blob(g, [-L * 0.44, by - Hb * 0.4, -L * 0.64, by - Hb * 0.05, -L * 0.7, by + Hb * 0.85, -L * 0.62, by + Hb * 1.1, -L * 0.52, by + Hb * 0.5, -L * 0.44, by], fill(coat.body), 0.5);
        ell(g, -L * 0.665, by + Hb * 0.95, 1.4, 1.6, coat.spot ?? '#3a3634');
        // Cuerpo largo, alto de cruz, con lomo oscuro y vientre claro.
        blob(g, [-L * 0.48, by - Hb * 0.35, -L * 0.2, by - Hb * 0.5, L * 0.25, by - Hb * 0.68, L * 0.5, by - Hb * 0.2, L * 0.45, by + Hb * 0.5, L * 0.05, by + Hb * 0.45, -L * 0.3, by + Hb * 0.4, -L * 0.5, by + Hb * 0.1], fill(coat.body), 0.5);
        blob(g, [-L * 0.4, by - Hb * 0.38, -L * 0.1, by - Hb * 0.52, L * 0.3, by - Hb * 0.64, L * 0.32, by - Hb * 0.3, -L * 0.1, by - Hb * 0.2, -L * 0.38, by - Hb * 0.1], alpha(coat.spot ?? '#4a4844', 0.75), 0.5);
        ell(g, L * 0.05, by + Hb * 0.35, L * 0.3, Hb * 0.16, alpha(coat.belly ?? '#e0dad0', 0.85));
        // Cabeza a la altura del lomo, hocico largo y claro, orejas tiesas y ojo ámbar.
        const hx = L * 0.47;
        const hy = by - Hb * 0.62;
        blob(g, [hx - 2.6, hy - 2.6, hx + 1.8, hy - 2.8, hx + 4, hy - 1, hx + 8.4, hy + 0.4, hx + 8.2, hy + 1.8, hx + 3, hy + 2.8, hx - 2, hy + 2.6], fill(coat.head, hy - 3, hy + 3), 0.4);
        blob(g, [hx + 3, hy + 0.2, hx + 8.2, hy + 0.9, hx + 8, hy + 1.9, hx + 3, hy + 2.6], coat.belly ?? '#e0dad0', 0.4);
        ell(g, hx + 8.3, hy + 0.6, 0.7, 0.6, '#141010');
        g.fillStyle = shd(coat.head, 0.25);
        for (const ox of [-1.8, 0.2]) {
          g.beginPath();
          g.moveTo(hx + ox - 0.6, hy - 2.2);
          g.lineTo(hx + ox + 0.4, hy - 6);
          g.lineTo(hx + ox + 1.8, hy - 2.4);
          g.fill();
        }
        ell(g, hx + 3, hy - 0.8, 0.6, 0.45, '#d8a030');
        ell(g, hx + 3.1, hy - 0.8, 0.25, 0.25, '#141010');
        leg(g, L * 0.38, top, lg + Hb * 0.45, 2.4, 1.7, coat.leg, sw(0, 0.4), 'zarpa');
        leg(g, -L * 0.24, top, lg + Hb * 0.45, 2.8, 1.7, coat.leg, sw(1, 0.4), 'zarpa');
        break;
      }
      case 'oso': {
        const top = by;
        leg(g, L * 0.28, top, lg + Hb * 0.5, 5.2, 4.6, far, sw(1, 0.15), 'zarpa');
        leg(g, -L * 0.3, top, lg + Hb * 0.5, 6, 4.6, far, sw(0, 0.15), 'zarpa');
        // Mole enorme con joroba en la cruz; sin cola a la vista.
        blob(g, [-L * 0.5, by + Hb * 0.05, -L * 0.42, by - Hb * 0.5, -L * 0.05, by - Hb * 0.55, L * 0.18, by - Hb * 0.78, L * 0.4, by - Hb * 0.45, L * 0.5, by + Hb * 0.1, L * 0.38, by + Hb * 0.55, -L * 0.1, by + Hb * 0.6, -L * 0.44, by + Hb * 0.5], fill(coat.body), 0.5);
        // Pelaje: unos trazos de mechón en el lomo.
        g.strokeStyle = alpha(lit(coat.body, 0.2), 0.5);
        g.lineWidth = 0.5;
        for (let i = 0; i < 7; i++) {
          const x = -L * 0.4 + i * L * 0.12;
          g.beginPath();
          g.moveTo(x, by - Hb * 0.4);
          g.lineTo(x - 1, by - Hb * 0.15);
          g.stroke();
        }
        // Cabeza baja, ancha, hocico corto y claro, orejas redondas.
        const hx = L * 0.46;
        const hy = by - Hb * 0.05;
        ell(g, hx + 2.4, hy, 4.6, 3.8, fill(coat.head, hy - 4, hy + 4));
        ell(g, hx + 6.2, hy + 1, 2.6, 1.9, coat.belly ?? '#9a7050');
        ell(g, hx + 8.2, hy + 0.5, 0.9, 0.75, '#141010');
        for (const ox of [-0.4, 2.6]) {
          ell(g, hx + ox, hy - 3.6, 1.5, 1.5, coat.head);
          ell(g, hx + ox, hy - 3.5, 0.75, 0.75, shd(coat.head, 0.35));
        }
        eye(hx + 4, hy - 1.2, 0.55);
        leg(g, L * 0.36, top, lg + Hb * 0.5, 5.2, 4.6, coat.leg, sw(0, 0.15), 'zarpa');
        leg(g, -L * 0.22, top, lg + Hb * 0.5, 6, 4.6, coat.leg, sw(1, 0.15), 'zarpa');
        // Garras claras.
        g.fillStyle = '#d8d0c0';
        for (const fx of [L * 0.36, -L * 0.22]) for (let k = 0; k < 3; k++) g.fillRect(fx + 1.4 + k * 0.9, -0.8, 0.35, 0.8);
        break;
      }
      case 'gallina': {
        leg(g, 0.4, by + Hb * 0.3, lg + Hb * 0.2, 0.6, 0.5, coat.leg, sw(1, 0.3), 'none');
        leg(g, -0.8, by + Hb * 0.3, lg + Hb * 0.2, 0.6, 0.5, shd(coat.leg, 0.2), sw(0, 0.3), 'none');
        // Cola de plumas en abanico hacia arriba.
        blob(g, [-L * 0.3, by - Hb * 0.1, -L * 0.62, by - Hb * 1.1, -L * 0.42, by - Hb * 1.0, -L * 0.2, by - Hb * 0.4], coat.spot ?? shd(coat.body, 0.2), 0.5);
        // Cuerpo redondo, pechuga adelantada; ala marcada.
        blob(g, [-L * 0.45, by - Hb * 0.2, -L * 0.1, by - Hb * 0.5, L * 0.35, by - Hb * 0.4, L * 0.5, by + Hb * 0.1, L * 0.2, by + Hb * 0.5, -L * 0.35, by + Hb * 0.4], fill(coat.body), 0.5);
        ell(g, -L * 0.05, by + Hb * 0.02, L * 0.25, Hb * 0.22, shd(coat.body, 0.12), -0.2);
        const hx = L * 0.4;
        const hy = by - Hb * 0.75;
        ell(g, hx, hy, 1.6, 1.5, coat.head);
        ell(g, hx - 0.1, hy - 1.5, 1.1, 0.7, '#d8302a');
        ell(g, hx + 1.1, hy + 1.3, 0.45, 0.7, '#d8302a');
        g.fillStyle = '#e8a030';
        g.beginPath();
        g.moveTo(hx + 1.3, hy - 0.3);
        g.lineTo(hx + 2.6, hy + 0.2);
        g.lineTo(hx + 1.3, hy + 0.6);
        g.fill();
        ell(g, hx + 0.5, hy - 0.3, 0.3, 0.3, '#141010');
        break;
      }
      case 'pato': {
        // Cuerpo de barca con la cola en punta hacia arriba (nada: sin patas a la vista).
        blob(g, [-L * 0.55, by - Hb * 0.55, -L * 0.3, by - Hb * 0.1, L * 0.3, by - Hb * 0.25, L * 0.5, by + Hb * 0.1, L * 0.3, by + Hb * 0.5, -L * 0.35, by + Hb * 0.45], fill(coat.body), 0.45);
        ell(g, -L * 0.05, by, L * 0.25, Hb * 0.2, shd(coat.body, 0.12), -0.15);
        const hx = L * 0.38;
        const hy = by - Hb * 0.9;
        g.fillStyle = coat.body;
        g.fillRect(hx - 0.7, hy, 1.4, Hb * 0.7);
        ell(g, hx, hy, 1.6, 1.4, coat.head);
        ell(g, hx + 2, hy + 0.4, 1.3, 0.5, '#e8a030');
        ell(g, hx + 0.5, hy - 0.3, 0.3, 0.3, '#141010');
        g.fillStyle = '#f6f0e4';
        g.fillRect(hx - 0.8, hy + 1.2, 1.6, 0.4);
        break;
      }
    }
  }, 2.5);
}
