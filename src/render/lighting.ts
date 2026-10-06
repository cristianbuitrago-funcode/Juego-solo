import { VQ } from '../visual/quality';

/**
 * Luz de la escena, aparte de lo que se dibuja: la noche (oscuridad de luna con
 * huecos donde hay luz, halos cálidos, reflejos en el suelo mojado, núcleos que
 * brillan) y la gradación de cada franja del día. Solo recibe lo que necesita
 * (luces en coordenadas de mundo, cámara, tamaño de pantalla): no sabe nada del
 * mundo ni de la simulación.
 */
export interface Light {
  x: number;
  y: number;
  r: number;
  k: number;
  flat?: number;
}

export class Lighting {
  /** Oscuridad a media resolución con huecos de luz. */
  private dark = document.createElement('canvas');
  private skyGrad: CanvasGradient | null = null;
  private skyH = 0;
  private visPool: { x: number; y: number; r: number; k: number; flat: number }[] = [];

  resize(w: number, h: number): void {
    this.dark.width = Math.max(1, Math.ceil(w / 2));
    this.dark.height = Math.max(1, Math.ceil(h / 2));
  }

  night(g: CanvasRenderingContext2D, weather: string, d: number, lights: readonly Light[], cam: { x: number; y: number; z: number }, vw: number, vh: number): void {
    const gloom = weather === 'tormenta' ? 0.45 : weather === 'lluvia' || weather === 'niebla' ? 0.3 : 0;
    // Cuánto se notan las luces: de noche del todo; con lluvia o niebla, algo.
    const glow = Math.max(d, gloom * 0.6);
    if (glow <= 0.01) return;
    // Luces visibles en coordenadas de pantalla: objetos reutilizados de un fotograma a otro.
    const cap = VQ().lights;
    const pool = this.visPool;
    let n = 0;
    const z = cam.z;
    const hx = vw / 2 - cam.x * z;
    const hy = vh / 2 - cam.y * z;
    for (const l of lights) {
      const x = l.x * z + hx;
      const y = l.y * z + hy;
      const r = l.r * z;
      if (x < -r || y < -r || x > vw + r || y > vh + r) continue;
      const o = pool[n] ?? (pool[n] = { x: 0, y: 0, r: 0, k: 0, flat: 1 });
      o.x = x;
      o.y = y;
      o.r = r;
      o.k = l.k;
      o.flat = l.flat ?? 1;
      if (++n >= cap) break;
    }
    pool.length = Math.max(n, 0);
    const vis = pool;
    // Todo en UNA capa a media resolución que se compone con un solo dibujo a pantalla
    // completa: la oscuridad de luna (azul frío) con huecos de caída suave donde hay luz,
    // los halos cálidos y los núcleos de lo que emite luz. (Antes eran tres pasadas a
    // pantalla completa: la noche costaba la mitad del fotograma.)
    const dc = this.dark.getContext('2d')!;
    const W = this.dark.width;
    const H = this.dark.height;
    const sx = W / vw;
    dc.globalCompositeOperation = 'source-over';
    dc.clearRect(0, 0, W, H);
    dc.imageSmoothingQuality = 'low';
    if (d > 0.01) {
      const a = 0.84 * d;
      // Degradado del cielo nocturno, a opacidad plena y cacheado; la intensidad va en globalAlpha.
      if (!this.skyGrad || this.skyH !== H) {
        this.skyGrad = dc.createLinearGradient(0, 0, 0, H);
        this.skyGrad.addColorStop(0, 'rgba(18,28,64,0.9)');
        this.skyGrad.addColorStop(1, 'rgba(8,12,34,1)');
        this.skyH = H;
      }
      dc.globalAlpha = a;
      dc.fillStyle = this.skyGrad;
      dc.fillRect(0, 0, W, H);
      // La viñeta va en la misma capa (de noche la gradación no la pinta aparte).
      if (VQ().grade) {
        dc.globalAlpha = 0.85;
        dc.drawImage(lightSprite('vignette'), 0, 0, W, H);
      }
      dc.globalCompositeOperation = 'destination-out';
      const hole = lightSprite('hole');
      for (const l of vis) {
        // Ni la luz más fuerte borra del todo la noche: el charco se lee como charco
        // (y la hierba bajo un farol no se ve como de día, verde neón).
        dc.globalAlpha = l.flat < 1 ? Math.min(0.62, l.k * 0.65) : Math.min(0.88, l.k * 0.85);
        dc.drawImage(hole, (l.x - l.r) * sx, (l.y - l.r * l.flat) * sx, l.r * 2 * sx, l.r * 2 * l.flat * sx);
      }
    }
    // El fuego tiñe de ámbar lo que toca: solo las luces que iluminan alrededor (faroles,
    // hogueras, puertas); las ventanas ya brillan por sí mismas.
    dc.globalCompositeOperation = 'lighter';
    const warm = lightSprite('warm');
    for (const l of vis) {
      if (l.r < 26 * cam.z) continue;
      dc.globalAlpha = Math.min(1, (l.flat < 1 ? 0.48 : 0.34) * glow * l.k);
      dc.drawImage(warm, (l.x - l.r * 0.8) * sx, (l.y - l.r * 0.8 * l.flat) * sx, l.r * 1.6 * sx, l.r * 1.6 * l.flat * sx);
    }
    // Lo que emite luz (cristal de las farolas, ventanas, llamas) brilla por encima de la oscuridad.
    const core = lightSprite('core');
    for (const l of vis) {
      if (l.flat !== 1 || l.r > 60 * cam.z) continue;
      const rr = Math.min(l.r * 0.42, 16 * cam.z);
      dc.globalAlpha = Math.min(1, 0.9 * glow * l.k);
      dc.drawImage(core, (l.x - rr) * sx, (l.y - rr) * sx, rr * 2 * sx, rr * 2 * sx);
    }
    dc.globalAlpha = 1;
    dc.globalCompositeOperation = 'source-over';
    g.imageSmoothingQuality = 'low';
    g.drawImage(this.dark, 0, 0, vw, vh);
    // Suelo mojado: cada charco de luz se refleja alargado hacia abajo, como en el adoquín empapado.
    if (weather === 'lluvia' || weather === 'tormenta') {
      g.globalCompositeOperation = 'lighter';
      const refl = lightSprite('reflect');
      for (const l of vis) {
        if (l.flat === 1) continue;
        const ww = l.r * 0.26;
        g.globalAlpha = Math.min(1, 0.45 * glow * l.k);
        if (g.globalAlpha < 0.02) continue;
        g.drawImage(refl, l.x - ww, l.y - l.r * 0.15, ww * 2, l.r * 0.8);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}

/**
 * Luz del día por franjas: madrugada fría y violácea, mañana suave,
 * mediodía limpio, tarde dorada, atardecer anaranjado con la luz baja
 * desde el oeste. Con nubes o lluvia, todo se vuelve gris, frío y menos
 * saturado. Los tintes de cada franja se combinan en un solo color de
 * multiplicar y otro de aclarar: dos pasadas de pantalla, no nueve.
 */
export function drawGrade(g: CanvasRenderingContext2D, h: number, weather: string, W: number, H: number, night: boolean): void {
  const bump = (c: number, wdt: number) => Math.max(0, 1 - Math.abs(h - c) / wdt);
  const rain = weather === 'lluvia' || weather === 'tormenta';
  const grey = weather === 'nublado' || rain || weather === 'niebla' || weather === 'nieve' ? 1 : 0;
  const clear = 1 - grey * 0.75;
  const dawn = bump(6.2, 1.6);
  const morning = bump(9, 2);
  const noon = bump(12.8, 1.8);
  const afternoon = bump(16.7, 3); // desde las 13:45 y plena a las 16:45
  const dusk = bump(18.9, 1.9);
  const mul = [1, 1, 1];
  const scr = [0, 0, 0];
  const M = (r: number, gg: number, b: number, a: number) => {
    if (a <= 0) return;
    mul[0] *= 1 - a * (1 - r / 255);
    mul[1] *= 1 - a * (1 - gg / 255);
    mul[2] *= 1 - a * (1 - b / 255);
  };
  const Sc = (r: number, gg: number, b: number, a: number) => {
    if (a <= 0) return;
    scr[0] = 1 - (1 - scr[0]) * (1 - (a * r) / 255);
    scr[1] = 1 - (1 - scr[1]) * (1 - (a * gg) / 255);
    scr[2] = 1 - (1 - scr[2]) * (1 - (a * b) / 255);
  };
  M(150, 150, 215, dawn * 0.4);
  Sc(255, 200, 205, dawn * 0.1 * clear);
  Sc(255, 244, 226, morning * 0.06 * clear);
  M(236, 242, 255, morning * 0.12 * clear); // sombras de la mañana algo frías
  Sc(255, 252, 240, noon * 0.06 * clear);
  M(255, 206, 142, afternoon * 0.46 * clear); // tarde dorada
  Sc(255, 190, 110, afternoon * 0.1 * clear);
  M(255, 140, 80, dusk * 0.5 * clear);
  M(170, 110, 160, dusk * 0.12);
  // Lluvia y tormenta: menos luz y más fría.
  // (gris azulado: apaga a la vez la luz y el color, sin una pasada aparte de saturación)
  M(118, 130, 150, rain ? (weather === 'tormenta' ? 0.66 : 0.55) : grey * 0.28);
  if (weather === 'nieve') Sc(200, 215, 235, 0.04);
  // Mezclas estándar (source-over): multiplicar o aclarar a pantalla completa obliga a
  // la GPU a copiar el fondo en cada pasada, y en muchos móviles es carísimo.
  overMultiply(g, mul[0], mul[1], mul[2], W, H);
  overScreen(g, scr[0], scr[1], scr[2], W, H);
  g.globalCompositeOperation = 'source-over';
  if (!VQ().grade) return;
  // Resplandor del sol bajo (por la mañana desde el este; al atardecer, desde el oeste).
  const low = Math.max(dawn * 0.6 + morning * 0.25, dusk + afternoon * 0.35) * clear;
  if (low > 0.02) {
    const fromWest = h > 12;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, low) * 0.7;
    g.drawImage(lightSprite(fromWest ? 'sunW' : 'sunE'), 0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  // Viñeta suave (textura cacheada): centra la mirada en el protagonista. De noche
  // la pinta la capa de oscuridad (un relleno a pantalla completa menos).
  if (night) return;
  g.globalAlpha = 0.8 + grey * 0.25;
  g.drawImage(lightSprite('vignette'), 0, 0, W, H);
  g.globalAlpha = 1;
}

/** Texturas de luz pintadas una vez (sin crear degradados en cada fotograma). */
const lightCache = new Map<string, HTMLCanvasElement>();
export function lightSprite(kind: 'hole' | 'warm' | 'core' | 'reflect' | 'moon' | 'sunW' | 'sunE' | 'vignette'): HTMLCanvasElement {
  const hit = lightCache.get(kind);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const S = kind === 'vignette' || kind === 'sunW' || kind === 'sunE' || kind === 'moon' ? 128 : 96;
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const h = S / 2;
  const radial = (stops: [number, string][], cx = h, cy = h, r0 = 0, r1 = h) => {
    const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };
  switch (kind) {
    case 'hole': // caída suave tipo 1/(1+d²)
      radial([[0, 'rgba(0,0,0,1)'], [0.2, 'rgba(0,0,0,0.92)'], [0.42, 'rgba(0,0,0,0.62)'], [0.65, 'rgba(0,0,0,0.3)'], [0.85, 'rgba(0,0,0,0.1)'], [1, 'rgba(0,0,0,0)']]);
      break;
    case 'reflect': {
      // Reflejo vertical en el suelo mojado: un huso continuo y suave, más fuerte arriba
      // (sin rayas: a pantalla completa en modo «lighter» se leían como un fallo gráfico).
      radial([[0, 'rgba(255,196,120,0.7)'], [0.45, 'rgba(255,176,96,0.32)'], [1, 'rgba(255,160,80,0)']]);
      const fade = g.createLinearGradient(0, 0, 0, S);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(0.5, 'rgba(0,0,0,0.85)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = fade;
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
      break;
    }
    case 'core': // núcleo de una luz: casi blanco cálido en el centro
      radial([[0, 'rgba(255,240,200,0.95)'], [0.25, 'rgba(255,200,120,0.6)'], [0.6, 'rgba(255,150,60,0.18)'], [1, 'rgba(255,120,40,0)']]);
      break;
    case 'warm':
      radial([[0, 'rgba(255,190,110,0.9)'], [0.3, 'rgba(255,150,70,0.5)'], [0.7, 'rgba(220,100,40,0.14)'], [1, 'rgba(200,80,30,0)']]);
      break;
    case 'moon': {
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, 'rgba(90,120,190,0.55)');
      gr.addColorStop(1, 'rgba(90,120,190,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
      break;
    }
    case 'sunW':
    case 'sunE': {
      const west = kind === 'sunW';
      radial([[0, west ? 'rgba(255,170,90,0.3)' : 'rgba(255,200,150,0.3)'], [1, 'rgba(255,170,90,0)']], west ? S * 1.05 : -S * 0.05, S * 0.15, 0, S * 0.9);
      break;
    }
    case 'vignette':
      radial([[0, 'rgba(12,8,18,0)'], [0.45, 'rgba(12,8,18,0)'], [1, 'rgba(12,8,18,0.36)']], h, h * 0.96, 0, h * 1.42);
      break;
  }
  lightCache.set(kind, c);
  return c;
}

/**
 * Aproxima «multiplicar por (r,g,b)» con una mezcla normal: un velo de color
 * con la opacidad que oscurece igual un tono medio. Mucho más barato.
 */
export function overMultiply(g: CanvasRenderingContext2D, r: number, gg: number, b: number, W: number, H: number): void {
  const mx = Math.max(r, gg, b);
  if (mx > 0.995 && Math.min(r, gg, b) > 0.995) return;
  const a = Math.min(0.95, 1 - (r + gg + b) / 3 + (mx - Math.min(r, gg, b)) * 0.35);
  if (a <= 0.004) return;
  // Color del velo para que un gris medio (0,5) quede en 0,5·c.
  const k = (c: number) => Math.round(Math.max(0, Math.min(1, (0.5 * c - 0.5 * (1 - a)) / a)) * 255);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = `rgba(${k(r)},${k(gg)},${k(b)},${a.toFixed(3)})`;
  g.fillRect(0, 0, W, H);
}

/** «Aclarar» con un velo claro y transparente (exacto si los tres canales son iguales). */
export function overScreen(g: CanvasRenderingContext2D, r: number, gg: number, b: number, W: number, H: number): void {
  const a = Math.max(r, gg, b);
  if (a <= 0.004) return;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = `rgba(${Math.round((r / a) * 255)},${Math.round((gg / a) * 255)},${Math.round((b / a) * 255)},${a.toFixed(3)})`;
  g.fillRect(0, 0, W, H);
}

/** Zancada (teselas por paso) de un cuerpo andando o corriendo: así el ciclo de piernas sigue al avance. */
