import { hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { seasonOf, weatherOf, type Weather } from './clock';
import { getTerrain } from './terrain';
import { T, TH, TW } from './types';

/**
 * Geografía y clima de cada región, sacados del terreno real (que sale de la
 * semilla). No se guarda: se recalcula. Una región montañosa tiene mineral,
 * poca tierra de cultivo y caminos duros; una llanura con río, buenas
 * cosechas y mucha gente; una costa, pesca, niebla y puertos. El clima
 * depende de la latitud (el norte es más frío), la altura y el mar.
 */
export type Climate = 'frio' | 'templado' | 'calido' | 'arido';
export type Biome = 'montana' | 'bosque' | 'llanura' | 'pantano' | 'costa' | 'valle';

export interface Geo {
  regionId: number;
  biome: Biome; // lo que domina
  mix: { bosque: number; montana: number; llanura: number; pantano: number; agua: number }; // fracciones
  altitude: number; // 0..1
  latitude: number; // 0 norte … 1 sur
  coast: boolean;
  river: boolean;
  climate: Climate;
  temp: number; // 0..1
  arable: number; // 0..1: tierra buena para el campo
  capacity: number; // cuánta gente puede sostener (factor)
  rough: number; // 0..1: lo difícil que es moverse por ella
  farm: number; // factor de las cosechas por el clima y la tierra
  rain: number; // factor de lluvia
  volcano: boolean;
  fauna: string[];
  flora: string[];
  look: string; // cómo se ve, en una frase
}

export const CLIMATE_NAME: Record<Climate, string> = { frio: 'frío', templado: 'templado', calido: 'cálido', arido: 'seco' };
export const BIOME_NAME: Record<Biome, string> = { montana: 'montañas', bosque: 'bosques', llanura: 'llanuras', pantano: 'marismas', costa: 'costa', valle: 'valle de río' };

const cache = new Map<string, Geo[]>();
const COAST_SHARE = 0.03;

export function geoOf(w: WorldState, regionId: number): Geo {
  return geography(w)[regionId];
}

export function geography(w: WorldState): Geo[] {
  const key = `${w.seed}:${w.regions.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = getTerrain(w);
  const n = w.regions.length;
  const count = Array.from({ length: n }, () => ({ total: 0, forest: 0, mountain: 0, plain: 0, marsh: 0, water: 0, elev: 0, y: 0, shore: 0 }));
  let minY = TH;
  let maxY = 0;
  for (let y = 0; y < TH; y += 2)
    for (let x = 0; x < TW; x += 2) {
      const k = y * TW + x;
      const r = t.region[k];
      if (r < 0) continue;
      const c = count[r];
      const tile = t.tiles[k];
      c.total++;
      c.elev += t.elev[k];
      c.y += y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // Orilla: tierra que da al mar abierto.
      const e = t.tiles[k + 4];
      if (e === T.Sea || e === T.Deep || t.tiles[k + 4 * TW] === T.Sea || t.tiles[k + 4 * TW] === T.Deep) c.shore++;
      if (tile === T.Forest) c.forest++;
      else if (tile === T.Mountain || tile === T.Rock) c.mountain++;
      else if (tile === T.Marsh || tile === T.Salt || tile === T.Clay) c.marsh++;
      else if (tile === T.River || tile === T.Sea || tile === T.Sand) c.water++;
      else c.plain++;
    }
  // Un volcán (dormido) en alguna partida: la montaña más alta, si la semilla quiere.
  const volcanoIdx = (hashString(`volcan:${w.seed}`) % 100) < 35 ? count.map((c, i) => ({ i, e: c.total ? c.elev / c.total : 0 })).sort((a, b) => b.e - a.e)[0]?.i : -1;
  const out: Geo[] = w.regions.map((r, i) => {
    const c = count[i];
    const tot = Math.max(1, c.total);
    const mix = { bosque: c.forest / tot, montana: c.mountain / tot, llanura: c.plain / tot, pantano: c.marsh / tot, agua: c.water / tot };
    const altitude = clamp((c.elev / tot / 255 - 0.3) / 0.45);
    const latitude = clamp((c.y / tot - minY) / Math.max(1, maxY - minY));
    const river = r.riverOrder >= 0;
    // Costa de verdad: no basta con rozar el mar en una esquina.
    const coast = r.coastal && c.shore / tot > COAST_SHARE;
    // Temperatura: el norte es frío, la altura enfría, el mar suaviza.
    const temp = clamp(0.25 + latitude * 0.6 - altitude * 0.4 + (coast ? 0.05 : 0));
    const dry = !coast && !river && mix.pantano < 0.05 && mix.agua < 0.05;
    const climate: Climate = temp < 0.3 ? 'frio' : temp > 0.62 && dry ? 'arido' : temp > 0.55 ? 'calido' : 'templado';
    const biome: Biome = mix.montana > 0.35 ? 'montana' : mix.bosque > 0.35 ? 'bosque' : mix.pantano > 0.18 ? 'pantano' : coast && mix.agua > 0.06 ? 'costa' : river ? 'valle' : 'llanura';
    const arable = clamp(mix.llanura * 1.1 + (river ? 0.15 : 0) - mix.montana * 0.3);
    const farm = clamp((climate === 'frio' ? 0.78 : climate === 'arido' ? (river ? 0.85 : 0.7) : climate === 'calido' ? 1.06 : 1) * (0.8 + arable * 0.35), 0.5, 1.3);
    const rain = climate === 'arido' ? 0.55 : climate === 'frio' ? 0.9 : coast ? 1.1 : 1;
    const capacity = clamp(0.6 + arable * 0.6 + (river ? 0.15 : 0) + (coast ? 0.1 : 0) - mix.montana * 0.25, 0.4, 1.4);
    const rough = clamp(mix.montana * 1.2 + mix.bosque * 0.5 + mix.pantano * 0.8);
    const fauna = [
      ...(mix.bosque > 0.2 ? ['ciervos', 'jabalíes', 'lobos'] : []),
      ...(mix.montana > 0.2 ? ['cabras monteses', 'águilas'] : []),
      ...(coast ? ['gaviotas', 'focas'] : []),
      ...(mix.pantano > 0.08 ? ['garzas', 'ranas'] : []),
      ...(mix.llanura > 0.4 ? ['liebres', 'perdices'] : []),
      ...(climate === 'frio' ? ['zorros blancos'] : climate === 'arido' ? ['lagartos', 'buitres'] : []),
    ];
    const flora = [
      ...(climate === 'frio' ? ['pinos', 'abedules', 'brezo'] : climate === 'arido' ? ['olivos', 'cardos', 'tomillo'] : climate === 'calido' ? ['higueras', 'vides', 'adelfas'] : ['robles', 'hayas', 'castaños']),
      ...(mix.pantano > 0.08 ? ['juncos'] : []),
    ];
    const look = `${BIOME_NAME[biome].charAt(0).toUpperCase()}${BIOME_NAME[biome].slice(1)} de clima ${CLIMATE_NAME[climate]}${river ? ', atravesada por el río' : ''}${coast ? ', junto al mar' : ''}.`;
    return { regionId: i, biome, mix, altitude, latitude, coast, river, climate, temp, arable, capacity, rough, farm, rain, volcano: i === volcanoIdx && mix.montana > 0.2, fauna: fauna.slice(0, 5), flora: flora.slice(0, 4), look };
  });
  cache.set(key, out);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return out;
}

/**
 * El tiempo en una región: el mismo cielo para todos, matizado por el
 * clima. Donde es seco llueve poco; donde es frío, nieva antes; en la costa
 * hay más niebla y temporales.
 */
export function weatherIn(w: WorldState, regionId: number, day = w.day): Weather {
  const base = weatherOf(w, day);
  if (!w.regions[regionId]) return base;
  const g = geoOf(w, regionId);
  const h = (hashString(`${w.seed}:${regionId}:${day}:tiempo`) % 1000) / 1000;
  const s = seasonOf(day);
  if (g.climate === 'arido') {
    if ((base === 'lluvia' || base === 'nublado') && h < 0.6) return h < 0.3 ? 'viento' : 'despejado';
    if (base === 'nieve') return 'despejado';
  }
  if (g.climate === 'frio') {
    if (base === 'lluvia' && (s === 'invierno' || s === 'otoño') && h < 0.5) return 'nieve';
    if (base === 'despejado' && s === 'invierno' && h < 0.3) return 'nieve';
  }
  if (g.climate === 'calido' && base === 'nieve') return h < 0.5 ? 'lluvia' : 'nublado';
  if (g.coast && base === 'despejado' && h < 0.12) return 'niebla';
  if (g.coast && base === 'lluvia' && s === 'otoño' && h < 0.25) return 'tormenta';
  return base;
}

/** Lo difícil que es ir de una región a otra (montañas, bosques, marismas). */
export function roughness(w: WorldState, a: number, b: number): number {
  return (geoOf(w, a).rough + geoOf(w, b).rough) / 2;
}

/** Cómo es una región, en palabras. */
export function describeGeo(w: WorldState, regionId: number): string[] {
  const g = geoOf(w, regionId);
  const out = [g.look];
  out.push(g.arable > 0.5 ? 'Tierra buena para el campo.' : g.arable > 0.25 ? 'Hay algo de tierra de cultivo.' : 'Poca tierra que cultivar.');
  if (g.mix.montana > 0.2) out.push('Las montañas guardan mineral; los caminos son duros.');
  if (g.fauna.length) out.push(`Se ven ${g.fauna.slice(0, 3).join(', ')}.`);
  if (g.flora.length) out.push(`Crecen ${g.flora.slice(0, 3).join(', ')}.`);
  if (g.volcano) out.push('Dicen que la montaña más alta humea algunos inviernos.');
  return out;
}
