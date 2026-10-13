/**
 * Niveles gráficos de ECOS. Cada nivel es un presupuesto: cuánta resolución
 * tiene el lienzo, a cuántos píxeles por píxel de mundo se pintan las
 * texturas, qué sombras hay, cuántas partículas, cuánta gente de relleno y
 * a qué distancia baja el detalle de las figuras. La simulación no depende
 * de esto: solo cambia cómo se ve.
 */
export type Tier = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = 'auto' | Tier | 'baja' | 'media' | 'alta';

export interface VisualQuality {
  tier: Tier;
  dpr: number; // tope de densidad de píxeles del lienzo
  spriteRes: number; // píxeles de textura por píxel de mundo (árboles, edificios, props)
  figureRes: number; // píxeles de textura por píxel de mundo (piezas de las personas)
  terrainRes: number; // píxeles de textura por píxel de mundo (suelo)
  shadows: 'blob' | 'cast'; // sombras de mancha o proyectadas por el sol
  particles: number; // tope de partículas de clima
  smoke: number; // tope de humo/polvo
  crowd: number; // figurantes en ciudades grandes
  lights: number; // luces puntuales por fotograma
  lodNear: number; // teselas: detalle completo
  lodMid: number; // teselas: detalle medio
  sway: boolean; // vegetación que se mueve con el viento
  grass: number; // densidad de matas de hierba y flores (0..1)
  water: boolean; // brillos animados del agua
  grade: boolean; // gradación de color por capas
  textureBudgetMB: number;
}

const TIERS: Record<Tier, VisualQuality> = {
  low: { tier: 'low', dpr: 1, spriteRes: 1.75, figureRes: 2.5, terrainRes: 1, shadows: 'blob', particles: 90, smoke: 40, crowd: 0, lights: 24, lodNear: 7, lodMid: 14, sway: false, grass: 0.35, water: false, grade: false, textureBudgetMB: 48 },
  medium: { tier: 'medium', dpr: 1.5, spriteRes: 2.75, figureRes: 3.5, terrainRes: 1.25, shadows: 'cast', particles: 180, smoke: 90, crowd: 8, lights: 48, lodNear: 9, lodMid: 18, sway: true, grass: 0.6, water: true, grade: true, textureBudgetMB: 80 },
  high: { tier: 'high', dpr: 2, spriteRes: 3.5, figureRes: 4.5, terrainRes: 1.75, shadows: 'cast', particles: 300, smoke: 160, crowd: 14, lights: 80, lodNear: 11, lodMid: 22, sway: true, grass: 0.85, water: true, grade: true, textureBudgetMB: 128 },
  ultra: { tier: 'ultra', dpr: 2.5, spriteRes: 4, figureRes: 5.5, terrainRes: 2, shadows: 'cast', particles: 450, smoke: 220, crowd: 18, lights: 120, lodNear: 14, lodMid: 26, sway: true, grass: 1, water: true, grade: true, textureBudgetMB: 192 },
};

let current: VisualQuality = TIERS.medium;

/** Calidad en uso (la leen los pintores al crear texturas). */
export const VQ = (): VisualQuality => current;

/** Traduce los ajustes antiguos (alta/media/baja) y resuelve «auto». */
export function resolveTier(s: QualitySetting | undefined): Tier {
  if (!s || s === 'auto') return detectTier();
  if (s === 'baja') return 'low';
  if (s === 'media') return 'medium';
  if (s === 'alta') return 'high';
  return s;
}

/** Cambia el nivel; devuelve true si cambió (hay que repintar las cachés). */
export function setTier(t: Tier): boolean {
  if (current.tier === t) return false;
  current = TIERS[t];
  return true;
}

export const tierOf = (t: Tier) => TIERS[t];
export const TIER_LABEL: Record<Tier, string> = { low: 'Baja', medium: 'Media', high: 'Alta', ultra: 'Ultra' };

let detected: Tier | null = null;

/**
 * Lo que puede el dispositivo: memoria, núcleos, píxeles de pantalla y una
 * prueba breve de dibujo. Se calcula una vez. Ante la duda, se elige el
 * nivel inferior (mejor fluido que bonito y a tirones).
 */
export function detectTier(): Tier {
  if (detected) return detected;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const px = (screen.width * screen.height * (window.devicePixelRatio || 1) ** 2) / 1e6;
  let score = 0;
  score += mem >= 8 ? 3 : mem >= 6 ? 2 : mem >= 4 ? 1 : 0;
  score += cores >= 8 ? 2 : cores >= 6 ? 1 : 0;
  score += benchmark();
  if (px > 6) score -= 1; // mucha pantalla: más píxeles que llenar en cada fotograma
  detected = score >= 6 ? 'ultra' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  return detected;
}

/** Dibuja unos cientos de imágenes con transformaciones y mide (0..2 puntos). */
function benchmark(): number {
  try {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d')!;
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const sg = s.getContext('2d')!;
    const gr = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = gr;
    sg.fillRect(0, 0, 64, 64);
    const t0 = performance.now();
    for (let i = 0; i < 1500; i++) {
      g.setTransform(1, 0, 0.2, 1, (i * 37) % 480, (i * 53) % 480);
      g.globalAlpha = 0.5;
      g.drawImage(s, 0, 0);
    }
    g.getImageData(0, 0, 1, 1); // fuerza a terminar
    const ms = performance.now() - t0;
    return ms < 12 ? 2 : ms < 30 ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Estado del nivel adaptativo entre ventanas de medida. */
export interface AdaptState {
  calm: number; // ventanas tranquilas seguidas
  sinceChange: number; // ms desde el último cambio de nivel
  gpuCapped: boolean; // bajó por la GPU: no vuelve a subir (evita ir y venir cada medio minuto)
  /** Nivel en el que ya se falló por CPU: no se vuelve a probar en esta sesión (sin vaivén). */
  failed?: number;
  bestGap: number; // mejor mediana de intervalo vista (ms)
}

/**
 * Decide el nivel tras una ventana de medida (sin DOM: se puede probar).
 * p95: tiempo de dibujo (CPU); gapMed: mediana del intervalo entre fotogramas (0 = sin dato).
 */
export function adaptTier(tier: Tier, cap: Tier, p95: number, gapMed: number, st: AdaptState): Tier {
  const order: Tier[] = ['low', 'medium', 'high', 'ultra'];
  const i = order.indexOf(tier);
  if (gapMed > 0) st.bestGap = Math.min(st.bestGap, gapMed);
  // Limitado por la GPU: el ritmo empeoró mucho respecto al mejor visto, o el móvil no pasa de
  // ~40 fps desde el arranque. Esto último solo baja hasta MEDIA (una pantalla fija a 30 Hz no
  // debe acabar en BAJA).
  const gpuBound = (gapMed > 22 && gapMed > st.bestGap * 1.4) || (gapMed > 24 && i >= 2);
  let next = i;
  if ((p95 > 16 || gpuBound) && i > 0 && st.sinceChange > 15000) {
    next = i - 1;
    if (gpuBound) st.gpuCapped = true;
    st.failed = Math.min(st.failed ?? 99, i);
  }
  st.calm = p95 < 7 && !gpuBound ? st.calm + 1 : 0;
  if (next === i && !st.gpuCapped && st.calm >= 2 && i < order.indexOf(cap) && i + 1 < (st.failed ?? 99) && st.sinceChange > 30000) next = i + 1;
  if (next !== i) st.calm = 0;
  return order[next];
}
