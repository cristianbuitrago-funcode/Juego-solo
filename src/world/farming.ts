import { hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { seasonOf, weatherOf } from './clock';
import { getLayout } from './layout';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, T, TW } from './types';

/**
 * Agricultura y clima. Cada pueblo tiene sus campos: tierra (fertilidad),
 * humedad (la lluvia de cada día, los ríos), semillas guardadas, lo sembrado
 * en primavera y cómo crece en verano. En otoño se cosecha lo que dio la
 * temporada y se guarda una parte como semilla para el año siguiente. En
 * invierno la tierra descansa.
 *
 * Una sequía seca la tierra; una tormenta tumba las espigas; si una familia
 * con hambre se come la semilla, el año que viene se siembra menos. Así una
 * mala temporada puede convertirse en una crisis que dura años.
 */
export interface Farm {
  soil: number; // 0..1 fertilidad
  moisture: number; // 0..1
  seeds: number; // semilla guardada por los campesinos (unidades)
  sown: number; // lo sembrado esta temporada
  plots: number; // tierra cultivable (no desaparece aunque se vaya la gente)
  land?: number;
  growth: number; // 0..1 cómo va la cosecha
  harvest: number; // lo cosechado este año (trigo + verdura)
  lastHarvest: number; // cosecha completa del año anterior
  history: { year: number; harvest: number; sown: number; growth: number }[];
  damage: string[]; // causas de los daños de este año (sequía, tormenta, falta de semilla…)
}

export interface Climate {
  drought?: { since: number; until: number; regions: number[] };
}

export function climateOf(w: WorldState): Climate {
  const s = w.life!.society!;
  return ((s as { climate?: Climate }).climate ??= {});
}

const yearDay = (day: number) => (day - 1) % DAYS_PER_YEAR; // 0..19
export const isSowing = (day: number) => seasonOf(day) === 'primavera';
export const isHarvest = (day: number) => seasonOf(day) === 'otoño';

export function farmOf(w: WorldState, regionId: number): Farm {
  const s = w.life!.society! as { farms?: Record<number, Farm> };
  const farms = (s.farms ??= {});
  if (!farms[regionId]) {
    const r = w.regions[regionId];
    const farmers = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.role === 'campesino').length;
    const plots = Math.max(4, farmers * 5);
    farms[regionId] = {
      soil: clamp(0.55 + r.ecology * 0.35 + (r.resource === 'grano' ? 0.12 : 0) + waterOf(w, regionId) * 0.08),
      moisture: 0.55,
      seeds: plots * 1.3,
      sown: isSowing(w.day) ? 0 : plots * 0.95,
      plots,
      growth: 0.75,
      harvest: 0,
      lastHarvest: plots * 7.5,
      history: [],
      damage: [],
    };
  }
  return farms[regionId];
}

/** Agua cerca del pueblo (río o costa): riega los campos y permite pescar. */
export function waterOf(w: WorldState, regionId: number): number {
  const r = w.regions[regionId];
  return r.coastal ? 0.8 : r.riverOrder >= 0 ? 1 : nearTiles(w, regionId, (t) => t === T.River || t === T.Sea) > 3 ? 0.6 : 0.15;
}

const tileCache = new Map<string, number>();
/** Cuántas casillas de un tipo hay cerca del pueblo (bosque para la leña, montaña para la piedra…). */
export function nearTiles(w: WorldState, regionId: number, pred: (t: number) => boolean, radius = 22): number {
  const key = `${w.seed}:${regionId}:${pred.toString().length}:${pred.toString().slice(-40)}:${radius}`;
  const hit = tileCache.get(key);
  if (hit !== undefined) return hit;
  const l = getLayout(w);
  const v = l.villages[regionId];
  let n = 0;
  for (let y = v.cy - radius; y <= v.cy + radius; y += 2)
    for (let x = v.cx - radius; x <= v.cx + radius; x += 2) {
      const k = y * TW + x;
      if (k >= 0 && k < l.terrain.tiles.length && pred(l.terrain.tiles[k])) n++;
    }
  tileCache.set(key, n);
  return n;
}

/** La lluvia de hoy en una región (el tiempo es común, pero cada valle tiene sus nubes). */
export function rainOf(w: WorldState, regionId: number, day = w.day): number {
  const weather = weatherOf(w, day);
  let rain = weather === 'lluvia' ? 1 : weather === 'tormenta' ? 1.3 : weather === 'nublado' ? 0.25 : weather === 'nieve' ? 0.35 : weather === 'niebla' ? 0.12 : 0;
  // Variación local.
  const local = (hashString(`${w.seed}:${regionId}:${day}`) % 1000) / 1000;
  if (local < 0.15) rain += 0.5;
  else if (local > 0.85) rain *= 0.4;
  const d = climateOf(w).drought;
  if (d && d.regions.includes(regionId) && day >= d.since && day <= d.until) rain *= 0.1;
  return rain;
}

/** Una sequía: la provoca el propio clima (a veces) y afecta a una comarca entera. */
export function startDrought(w: WorldState, regionId: number, days: number, from = w.day): void {
  const c = climateOf(w);
  const r = w.regions[regionId];
  const regions = [regionId, ...r.neighbors.filter((n) => hashString(`${w.seed}:${n}:seca`) % 2 === 0)];
  c.drought = { since: from, until: from + days, regions };
}

export interface FarmNews {
  kind: 'cosecha-buena' | 'cosecha-mala' | 'sin-semilla' | 'tormenta' | 'sequia' | 'siembra';
  text: string;
}

/**
 * Un día en los campos. `farmers` = campesinos que trabajan hoy (con su
 * esfuerzo); `tools` = factor de herramientas (0.6..1). Devuelve lo cosechado
 * hoy (trigo, verdura, fruta, semilla guardada) y las noticias.
 */
export function farmDay(w: WorldState, regionId: number, effort: number, farmersCount: number, tools: number, helpers = 0): { trigo: number; verdura: number; fruta: number; news: FarmNews[] } {
  const f = farmOf(w, regionId);
  const r = w.regions[regionId];
  const news: FarmNews[] = [];
  const season = seasonOf(w.day);
  const yd = yearDay(w.day);
  const rain = rainOf(w, regionId);
  const water = waterOf(w, regionId);
  // Humedad: lluvia, riego desde el río y evaporación (en verano, mucha).
  const d = climateOf(w).drought;
  const inDrought = !!d && d.regions.includes(regionId) && w.day >= d.since && w.day <= d.until;
  // En sequía también baja el río: apenas se puede regar.
  const evap = (season === 'verano' ? 0.16 : season === 'invierno' ? 0.04 : 0.09) + (inDrought ? 0.06 : 0);
  f.moisture = clamp(f.moisture * (1 - evap) + rain * 0.2 + water * (inDrought ? 0.006 : 0.025));
  f.land ??= f.plots;
  // La tierra sigue ahí: se cultiva más si hay más brazos, pero nunca menos que la de siempre.
  f.plots = Math.max(f.land, Math.round(farmersCount * 5));
  let trigo = 0;
  let verdura = 0;
  let fruta = 0;
  if (season === 'primavera') {
    if (yd === 0) {
      f.sown = 0;
      f.growth = 0.4;
      f.harvest = 0;
      f.damage = [];
    }
    // Siembra: cada campesino siembra lo que puede… si tiene semilla.
    // En la siembra ayuda toda la familia (y quien no tiene otro trabajo).
    const can = Math.min(f.plots - f.sown, (farmersCount * 1.4 * effort + helpers * 0.6) * tools, f.seeds);
    if (can > 0) {
      f.seeds -= can;
      f.sown += can;
    }
    if (yd === DAYS_PER_SEASON - 1 && f.sown < f.plots * 0.6) {
      f.damage.push(f.seeds < 1 ? 'semilla' : 'manos');
      news.push({ kind: 'sin-semilla', text: f.seeds < 1 ? `En ${r.name} no hay semilla para sembrar todos los campos: media tierra se queda sin plantar.` : `En ${r.name} faltan brazos para sembrar todos los campos.` });
    }
    f.growth = clamp(f.growth + (f.moisture > 0.3 ? 0.04 : -0.03));
  } else if (season === 'verano') {
    // Crece según la humedad: ni seca ni encharcada.
    const m = f.moisture;
    const k = m < 0.2 ? -0.13 : m < 0.35 ? -0.03 : m < 0.85 ? 0.06 : 0.02;
    f.growth = clamp(f.growth + k * (0.6 + f.soil * 0.5) * (0.7 + 0.3 * Math.min(1, farmersCount / Math.max(1, f.plots / 5))));
    if (inDrought && !f.damage.includes('sequia')) {
      f.damage.push('sequia');
      news.push({ kind: 'sequia', text: `No llueve en ${r.name}. La tierra se agrieta y las espigas se secan antes de granar.` });
    }
    if (weatherOf(w, w.day) === 'tormenta' && rain > 1.2) {
      f.growth = clamp(f.growth - 0.12);
      if (!f.damage.includes('tormenta')) {
        f.damage.push('tormenta');
        news.push({ kind: 'tormenta', text: `Una tormenta de granizo ha tumbado parte de los sembrados de ${r.name}.` });
      }
    }
    fruta = farmersCount * 0.35 * effort * clamp(f.moisture + 0.3);
    verdura = farmersCount * 0.25 * effort * clamp(f.moisture + 0.2);
  } else if (season === 'otoño') {
    // Cosecha: un quinto cada día del otoño.
    // Sin campesinos, la cosecha la recogen los demás (peor).
    const hands = clamp((farmersCount + helpers * 0.4) / Math.max(1, f.sown / 6));
    // La cosecha depende mucho de cómo creció: una espiga a medias da muy poco grano.
    const total = f.sown * (0.8 + f.growth * f.growth * 20) * f.soil * tools * (0.85 + effort * 0.15) * (0.4 + hands * 0.6);
    const today = total / DAYS_PER_SEASON;
    trigo = today * 0.72;
    verdura = today * 0.28;
    fruta = farmersCount * 0.4 * effort;
    // Se guarda la cuarta parte del trigo como semilla.
    const keep = trigo * 0.26;
    f.seeds += keep;
    trigo -= keep;
    f.harvest += today;
    if (yd === DAYS_PER_SEASON * 3 - 1) {
      const year = Math.floor((w.day - 1) / DAYS_PER_YEAR) + 1;
      f.history.push({ year, harvest: Math.round(f.harvest), sown: Math.round(f.sown), growth: Math.round(f.growth * 100) / 100 });
      if (f.history.length > 12) f.history.shift();
      const ref = Math.max(1, f.plots * 11);
      if (f.harvest > ref * 1.15) news.push({ kind: 'cosecha-buena', text: `La cosecha de ${r.name} ha sido excepcional: los graneros rebosan.` });
      else if (f.harvest < ref * 0.6) {
        const why = f.damage.includes('sequia') ? 'la sequía' : f.damage.includes('semilla') ? 'la falta de semilla' : f.damage.includes('tormenta') ? 'las tormentas' : f.damage.includes('manos') ? 'la falta de brazos' : 'un mal año';
        news.push({ kind: 'cosecha-mala', text: `Mala cosecha en ${r.name} por ${why}.` });
      }
      f.lastHarvest = f.harvest;
    }
  } else {
    // Invierno: la tierra descansa y recupera algo de fuerza.
    f.soil = clamp(f.soil + 0.004, 0, 0.98);
    verdura = farmersCount * 0.12 * effort;
  }
  return { trigo, verdura, fruta, news };
}

/** Una familia con hambre se come parte de la semilla (y el año que viene se siembra menos). */
export function eatSeeds(w: WorldState, regionId: number, want: number, desperate = false): number {
  const f = farmOf(w, regionId);
  // Antes de la siembra se guarda la semilla como oro: solo se toca con hambre extrema.
  const season = seasonOf(w.day);
  const guard = season === 'invierno' || season === 'primavera' ? (desperate ? f.plots * 0.3 : f.plots) : 0;
  const take = Math.max(0, Math.min((f.seeds - guard) * 0.12, want));
  f.seeds -= take;
  if (take > 0.5 && !f.damage.includes('semilla-comida')) f.damage.push('semilla-comida');
  return take;
}

/** El jugador (o quien sea) trae semilla a los campesinos. */
export function giveSeeds(w: WorldState, regionId: number, n: number): void {
  farmOf(w, regionId).seeds += n;
}

/** Cómo se ven los campos (para describirlos sin cifras). */
export function fieldLook(w: WorldState, regionId: number): string {
  const f = farmOf(w, regionId);
  const season = seasonOf(w.day);
  if (season === 'invierno') return 'Los campos descansan bajo la escarcha.';
  if (season === 'primavera') return f.sown < f.plots * 0.5 && yearDay(w.day) >= 2 ? 'Hay campos sin sembrar. La tierra espera semilla.' : 'Los campesinos siembran en hileras rectas.';
  if (season === 'verano') return f.moisture < 0.2 ? 'La tierra está agrietada; las espigas, amarillas antes de tiempo.' : f.growth > 0.8 ? 'Las espigas crecen altas y verdes.' : 'Los sembrados crecen, aunque desiguales.';
  return f.growth > 0.75 ? 'Carros cargados de grano vuelven de los campos.' : 'La cosecha es escasa: espigas cortas y ralas.';
}
