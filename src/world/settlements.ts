import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { personName } from '../core/content/names';
import { getLayout } from './layout';
import { walkable } from './terrain';
import { T, TW } from './types';
import { foodDays, marketOf } from './economy';
import { geoOf } from './geography';
import { cultureOf } from './culture';
import { logEvent, playerRegion } from './society';
import { recordHist } from './history';
import { story } from './identity';
import { atlasOf, aid, TIER_NAME, TIER_ORDER, type Poi, type Settlement, type SettlementTier } from './atlas';

/**
 * Asentamientos que nacen, crecen, decaen y se arruinan. No los construye el
 * jugador: la gente que se va de un pueblo lleno o hambriento busca tierra y
 * funda un campamento; si la tierra es buena y el camino pasa cerca, el
 * campamento se hace aldea, pueblo, ciudad… o se vacía y queda en ruinas.
 * Cada uno tiene un sitio en el mapa físico, y se puede visitar.
 */
export const tierFor = (people: number): SettlementTier => (people < 40 ? 'campamento' : people < 150 ? 'aldea' : people < 400 ? 'pueblo' : people < 1200 ? 'ciudad' : 'metropolis');

/** Un buen sitio para levantar casas: caminable, lejos del pueblo y de otros asentamientos. */
export function freeSpot(w: WorldState, regionId: number, rng: Rng, near?: { x: number; y: number }): { x: number; y: number } | null {
  const l = getLayout(w);
  const t = l.terrain;
  const v = l.villages[regionId];
  const a = atlasOf(w);
  for (let i = 0; i < 400; i++) {
    const x = near ? Math.round(near.x + rng.range(-6, 6)) : Math.round(v.cx + rng.range(-70, 70));
    const y = near ? Math.round(near.y + rng.range(-6, 6)) : Math.round(v.cy + rng.range(-70, 70));
    const k = y * TW + x;
    if (k < 0 || k >= t.tiles.length || t.region[k] !== regionId) continue;
    const tile = t.tiles[k];
    if (!walkable(tile) || tile === T.Marsh || l.blocked[k]) continue;
    if (!near && Math.hypot(x - v.cx, y - v.cy) < 42) continue;
    if (a.settlements.some((s) => Math.hypot(s.x - x, s.y - y) < 18) || l.places.some((p) => Math.hypot(p.x - x, p.y - y) < 8)) continue;
    // Que haya sitio para unas casas.
    let ok = true;
    for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) {
      const kk = (y + dy) * TW + x + dx;
      if (!walkable(t.tiles[kk]) || l.blocked[kk] || t.region[kk] !== regionId) ok = false;
    }
    if (ok) return { x, y };
  }
  return null;
}

export function foundSettlement(w: WorldState, regionId: number, people: number, founders: string, why: string, rng: Rng, byPlayer = false, at?: { x: number; y: number }): Settlement | null {
  const a = atlasOf(w);
  const spot = at ? freeSpot(w, regionId, rng, at) ?? at : freeSpot(w, regionId, rng);
  if (!spot) return null;
  const c = cultureOf(w, regionId);
  const base = personName(rng, c.syllables, new Set([...w.regions.map((r) => r.name), ...a.settlements.map((s) => s.name)]));
  const name = rng.chance(0.4) ? `Nueva ${w.regions[regionId].name}` : rng.chance(0.5) ? `${base}al` : base;
  const s: Settlement = { id: aid(w, 'st'), name: a.settlements.some((x) => x.name === name) ? base : name, regionId, x: spot.x, y: spot.y, founded: w.day, founders, people, tier: tierFor(people), state: 'vivo', why, byPlayer, history: [{ day: w.day, text: `Lo fundaron ${founders}: ${why}.` }] };
  a.settlements.push(s);
  const text = `${founders.charAt(0).toUpperCase()}${founders.slice(1)} fundan ${s.name}, un ${TIER_NAME[s.tier]} en ${w.regions[regionId].name}.`;
  logEvent(w, regionId, 'pueblo', text, []);
  recordHist(w, { kind: 'fundacion', regionId, text, actor: byPlayer ? w.life!.player.name : undefined, gen: byPlayer ? w.life!.player.generation : undefined, importance: 2, fame: byPlayer ? 0.55 : 0.35, witnessed: byPlayer || playerRegion(w) === regionId });
  return s;
}

/** El protagonista funda un asentamiento (hace falta dinero y gente que le siga). */
export function playerFound(w: WorldState, followers: number): { ok: boolean; text: string; s?: Settlement } {
  const id = w.life!.identity!;
  const regionId = playerRegion(w);
  if (id.needs.coins < 30) return { ok: false, text: 'Fundar un lugar cuesta: herramientas, madera, semilla. Hacen falta unas treinta monedas.' };
  if (followers < 4) return { ok: false, text: 'Nadie funda nada solo. Necesitas al menos cuatro personas que te sigan.' };
  const rng = new Rng(hashString(`fundar:${w.day}:${regionId}`));
  const me = w.life!.player;
  const s = foundSettlement(w, regionId, 8 + followers * 3, `${me.name === 'Sin nombre' ? 'el forastero' : me.name} y quienes le siguen`, 'buscaban un sitio propio', rng, true, { x: Math.round(me.x) + 4, y: Math.round(me.y) + 4 });
  if (!s) return { ok: false, text: 'Aquí no hay sitio para levantar nada.' };
  id.needs.coins -= 30;
  story(w, `Fundó ${s.name}.`, 'logro');
  w.life!.politics?.legacy.push({ day: w.day, gen: me.generation, by: me.name, kind: 'organizacion', regionId, text: `Fundó ${s.name}.` });
  return { ok: true, text: `Clavas la primera estaca. ${s.name} existe desde hoy.`, s };
}

/** Cada pocos días: la gente funda, crece, se va, abandona. */
export function settlementsDay(w: WorldState, rng: Rng): string[] {
  const a = atlasOf(w);
  const out: string[] = [];
  if (w.day % 5 !== 0) return out;
  // Fundaciones: de un pueblo lleno o con hambre sale un grupo hacia tierra libre.
  for (const r of w.regions) {
    const t = w.life!.towns[r.id];
    if (!t) continue;
    const crowd = r.population / Math.max(1, t.houses * 60);
    const hungry = foodDays(w, r.id) < 1.2;
    const recent = a.settlements.some((s) => s.founders.includes(r.name) && w.day - s.founded < 200);
    if (recent || r.population < 250) continue;
    if ((crowd > 1.12 || (hungry && r.population > 400)) && rng.chance(0.06)) {
      // ¿Adónde? Tierra buena y poco poblada: la misma región o una vecina.
      const options = [r.id, ...r.neighbors].filter((id) => a.settlements.filter((s) => s.regionId === id && s.state === 'vivo').length < 3);
      const target = options.sort((x, y) => geoOf(w, y).capacity - w.regions[y].population / 2000 - (geoOf(w, x).capacity - w.regions[x].population / 2000))[0];
      if (target === undefined) continue;
      const people = Math.round(Math.min(60, r.population * 0.06));
      const s = foundSettlement(w, target, people, `familias de ${r.name}`, hungry ? 'huían del hambre' : 'en su pueblo ya no cabían', rng);
      if (s) {
        r.population -= people;
        if (playerRegion(w) === r.id || playerRegion(w) === target) out.push(`Un grupo de ${r.name} se ha ido a fundar ${s.name}.`);
      }
    }
  }
  // Crecimiento y decadencia.
  for (const s of a.settlements) {
    if (s.state === 'ruinas') continue;
    const r = w.regions[s.regionId];
    const g = geoOf(w, s.regionId);
    if (s.state === 'abandonado') {
      if (w.day - (s.history[s.history.length - 1]?.day ?? s.founded) > 200) {
        s.state = 'ruinas';
        addPoi(w, { kind: 'ruinas', name: `Ruinas de ${s.name}`, regionId: s.regionId, x: s.x, y: s.y, text: `Aquí estuvo ${s.name}, fundado por ${s.founders}. ${s.history[s.history.length - 1]?.text ?? ''}` });
      }
      continue;
    }
    // Crece si la tierra es buena, si pasa un camino, si tiene muelle y comercio por mar; se encoge con la guerra, el hambre y los desastres.
    const road = nearRoad(w, s);
    const sea = s.port ? a.seaRoutes.filter((x) => x.a === s.regionId || x.b === s.regionId).length : 0;
    const cap = 300 * g.capacity * (1 + (road ? 0.6 : 0) + (s.port ? 0.8 : 0) + sea * 0.3);
    const trouble = (r.flags.guerra ? 0.03 : 0) + (r.flags.hambre ? 0.02 : 0) + (a.disasters.some((d) => d.regionId === s.regionId && d.recovered < 0.5) ? 0.03 : 0) + (r.population < 200 ? 0.02 : 0);
    const room = 1 - s.people / cap;
    const growth = s.people * (0.01 * g.capacity * room - trouble) * 5;
    // La mitad de los que llegan vienen del pueblo grande de la región (la gente no sale de la nada).
    const inflow = Math.max(0, growth) * 0.5;
    if (r.population - inflow > 120) r.population -= inflow;
    s.people = Math.max(0, Math.round((s.people + growth + rng.range(-1, 1.5)) * 10) / 10);
    // Con margen: no cambia de categoría por un par de familias arriba o abajo.
    const raw = tierFor(s.people);
    const tier = TIER_ORDER.indexOf(raw) > TIER_ORDER.indexOf(s.tier) ? (tierFor(s.people * 0.9) === raw ? raw : s.tier) : TIER_ORDER.indexOf(raw) < TIER_ORDER.indexOf(s.tier) ? (tierFor(s.people * 1.1) === raw ? raw : s.tier) : raw;
    if (tier !== s.tier) {
      const up = TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(s.tier);
      const text = up ? `${s.name} ya no es ${articleOf(s.tier)} ${TIER_NAME[s.tier]}: ahora es ${articleOf(tier)} ${TIER_NAME[tier]}.` : `${s.name} se vacía: de ${TIER_NAME[s.tier]} ha pasado a ${TIER_NAME[tier]}.`;
      s.tier = tier;
      s.history.push({ day: w.day, text });
      logEvent(w, s.regionId, 'pueblo', text, []);
      if (TIER_ORDER.indexOf(tier) >= 3) recordHist(w, { kind: 'pueblo', regionId: s.regionId, text, importance: 2, fame: 0.45, witnessed: playerRegion(w) === s.regionId });
    }
    // Lo que produce y consume entra en el mercado de la región (las economías están conectadas).
    const m = marketOf(w, s.regionId);
    m.stock.trigo += s.people * 0.003 * g.farm;
    m.stock.madera += s.people * 0.001 * (g.mix.bosque > 0.2 ? 1 : 0.3);
    m.treasury += s.people * 0.0008;
    // Un puerto, si está en la costa y ha crecido.
    if (!s.port && g.coast && TIER_ORDER.indexOf(s.tier) >= 2 && nearWater(w, s)) {
      s.port = true;
      s.history.push({ day: w.day, text: `${s.name} construye un muelle.` });
    }
    if (s.people < 6) {
      s.state = 'abandonado';
      const why = r.flags.guerra ? 'la guerra' : r.flags.hambre ? 'el hambre' : 'que nadie se quedó';
      const text = `${s.name} queda abandonado por ${why}.`;
      s.history.push({ day: w.day, text });
      logEvent(w, s.regionId, 'pueblo', text, []);
      recordHist(w, { kind: 'pueblo', regionId: s.regionId, text, importance: 2, fame: 0.35, witnessed: playerRegion(w) === s.regionId });
      out.push(text);
    }
  }
  return out;
}

const articleOf = (t: SettlementTier) => (t === 'aldea' || t === 'ciudad' || t === 'metropolis' ? 'una' : 'un');

function nearRoad(w: WorldState, s: Settlement): boolean {
  const l = getLayout(w);
  return l.roads.some((r) => r.path.some((p, i) => i % 6 === 0 && Math.hypot(p.x - s.x, p.y - s.y) < 14));
}

function nearWater(w: WorldState, s: Settlement): boolean {
  const t = getLayout(w).terrain;
  for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) {
    const tile = t.tiles[(s.y + dy) * TW + s.x + dx];
    if (tile === T.Sea || tile === T.Deep) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lugares con historia
// ---------------------------------------------------------------------------
export function addPoi(w: WorldState, p: Omit<Poi, 'id' | 'day'>): Poi {
  const a = atlasOf(w);
  const poi: Poi = { ...p, id: aid(w, 'pi'), day: w.day };
  a.pois.push(poi);
  if (a.pois.length > 80) a.pois.splice(a.pois.findIndex((x) => x.kind === 'batalla'), 1);
  return poi;
}

/** Los lugares que salen de la geografía (una vez por partida): cuevas, oasis, pecios, canteras. */
export function ensurePois(w: WorldState): void {
  const a = atlasOf(w);
  if (a.pois.some((p) => p.kind === 'cueva' || p.kind === 'oasis' || p.kind === 'pecio' || p.kind === 'cantera')) return;
  const rng = new Rng(hashString(`lugares:${w.seed}`));
  const id = w.life?.identity;
  for (const r of w.regions) {
    const g = geoOf(w, r.id);
    const add = (kind: Poi['kind'], name: string, text: string, clue?: string) => {
      const spot = freeSpot(w, r.id, rng);
      if (spot) a.pois.push({ id: aid(w, 'pi'), kind, name, regionId: r.id, x: spot.x, y: spot.y, day: 0, text, clue });
    };
    if (g.mix.montana > 0.15) add('cueva', 'Cueva honda', 'Una boca negra en la roca. Dentro hay marcas de fuego muy antiguas, y huesos de animales que ya no se ven por aquí.');
    if (g.climate === 'arido' && g.river) add('oasis', 'Fuente entre palmeras', 'Agua clara en mitad de la tierra seca. Los viajeros paran aquí desde siempre.');
    if (g.coast && rng.chance(0.6)) add('pecio', 'Restos de un barco', 'El casco de un barco que no se parece a ninguno de por aquí. La madera es oscura y extraña.');
    if (g.mix.montana > 0.25 && rng.chance(0.5)) add('cantera', 'Cantera vieja', 'Bloques cortados a escuadra que nadie se llevó.');
    // El pasado del protagonista también deja rastro (para sus descendientes).
    if (id?.past && r.id === id.past.origin) add('ruinas', 'Casa quemada', 'Una casa de piedra con las vigas quemadas. En el dintel, medio borrado, un símbolo grabado.', 'origen');
  }
}

export function poiNear(w: WorldState, x: number, y: number, r = 2.5): Poi | undefined {
  return atlasOf(w).pois.find((p) => Math.hypot(p.x - x, p.y - y) < r);
}

export function settlementNear(w: WorldState, x: number, y: number, r = 6): Settlement | undefined {
  return atlasOf(w).settlements.find((s) => Math.hypot(s.x - x, s.y - y) < r);
}

/** Examinar un lugar con historia (lo que se ve, lo que cuenta, lo que recuerda). */
export function examinePoi(w: WorldState, poi: Poi): string[] {
  poi.found ??= w.day;
  const out = [poi.text];
  const id = w.life!.identity!;
  if (poi.clue === 'origen' && id.past === null && w.life!.player.generation > 1) {
    const first = w.life!.player.lineage[0];
    out.push(`El símbolo es el mismo del colgante que llevaba ${first?.name ?? 'quien empezó tu linaje'}. Aquí vivió tu antepasado antes de perder la memoria.`);
    story(w, 'Encontró la casa donde vivió el primero de su linaje antes de olvidarlo todo.', 'memoria');
    recordHist(w, { kind: 'hazana', regionId: poi.regionId, text: `${w.life!.player.name} encuentra la casa de su antepasado en ${w.regions[poi.regionId].name}.`, actor: w.life!.player.name, gen: w.life!.player.generation, importance: 2, fame: 0.4, witnessed: true });
  } else if (poi.clue === 'origen' && id.past) {
    out.push('El símbolo… es el mismo de tu colgante. Te tiembla la mano al tocarlo.');
  }
  if (poi.kind === 'ruinas' && w.day - poi.day < 400) out.push('Aún se reconocen las calles. Hace poco aquí vivía gente.');
  return out;
}

/** Qué es un asentamiento, en palabras (lo que se ve al llegar). */
export function describeSettlement(w: WorldState, s: Settlement): string[] {
  const out = [`${s.name}: ${s.state === 'vivo' ? `${articleOf(s.tier)} ${TIER_NAME[s.tier]}` : s.state === 'abandonado' ? 'abandonado' : 'ruinas'} de ${w.regions[s.regionId].name}.`, `Lo fundaron ${s.founders}: ${s.why}.`];
  if (s.state === 'vivo') out.push(s.people > 300 ? 'Calles llenas, talleres, ruido.' : s.people > 80 ? 'Unas cuantas casas, un pozo, gente trabajando.' : 'Unas tiendas y chozas alrededor de un fuego.');
  if (s.port) out.push('Tiene un muelle: llegan barcas y se habla de tierras lejanas.');
  for (const h of s.history.slice(1).slice(-2)) out.push(h.text);
  return out;
}

