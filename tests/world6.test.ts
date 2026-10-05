import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { exportGame, importGame } from '../src/core/save';
import { advanceDay } from '../src/core/simulation';
import type { WorldState } from '../src/core/types';
import { wireWorld } from '../src/world';
import { ensureLife } from '../src/world/life';
import { getLayout } from '../src/world/layout';
import { geography, geoOf, weatherIn } from '../src/world/geography';
import { comprehension, cultureOf, foreignSpeech, profileOf } from '../src/world/culture';
import { natureFactor, natureOf, harvestNature } from '../src/world/nature';
import { carryKnowledge, knowOf, startKnow, teachTech, techFactor } from '../src/world/knowledge';
import { foundSettlement, playerFound, ensurePois, examinePoi } from '../src/world/settlements';
import { roadFactor, roadOf } from '../src/world/roads';
import { statesOf, stateRelation } from '../src/world/states';
import { strike } from '../src/world/disasters';
import { snapshotWorld, takeSnapshot, worldDiff, worldSince } from '../src/world/epochs';
import { chooseAim, aimsDay } from '../src/world/aims';
import { simTier } from '../src/world/lod';
import { atlasOf } from '../src/world/atlas';
import { marketOf } from '../src/world/economy';
import { catchUp } from '../src/world/social';
import { tradeOf } from '../src/world/trade';
import { playerRegion } from '../src/world/society';
import { polOf } from '../src/world/polstate';
import { finishWar, startWorldWar } from '../src/world/war';
import { govOf } from '../src/world/politics';
import { gensOf } from '../src/world/genstate';
import { Rng } from '../src/core/rng';
import { DAYS_PER_YEAR } from '../src/world/types';

wireWorld();

function world(seed: number): WorldState {
  const w = createWorld(seed, { eraLength: 0 });
  ensureLife(w);
  advanceDay(w);
  return w;
}

const days = (w: WorldState, n: number) => {
  for (let i = 0; i < n; i++) advanceDay(w);
};

/** Lleva al protagonista a la plaza de otro pueblo. */
function goTo(w: WorldState, regionId: number): void {
  const v = getLayout(w).villages[regionId];
  w.life!.player.x = v.cx + 0.5;
  w.life!.player.y = v.cy + v.plazaR + 1.5;
}

const signature = (w: WorldState) => geography(w).map((g) => `${g.biome}/${g.climate}/${g.coast ? 'c' : '-'}`).join(' ');

describe('Fase 6: el mundo completo de Ecos', () => {
  it('1) la semilla genera el mundo: la misma da el mismo mundo base; otra, uno distinto', () => {
    const a = createWorld(31);
    const b = createWorld(31);
    const c = createWorld(32);
    expect(signature(a)).toBe(signature(b));
    expect(signature(a)).not.toBe(signature(c));
    // Lo que no se guarda (geografía, culturas, lenguas) se reconstruye igual.
    expect(cultureOf(a, 0).id).toBe(cultureOf(b, 0).id);
    expect(profileOf(cultureOf(a, 1)).language.words).toEqual(profileOf(cultureOf(b, 1)).language.words);
    // Y el mismo mundo con las mismas decisiones evoluciona igual (determinista).
    const x = world(33);
    const y = world(33);
    days(x, 30);
    days(y, 30);
    expect(JSON.stringify(x.life!.atlas)).toBe(JSON.stringify(y.life!.atlas));
  });

  it('2) las regiones son distintas: relieve, clima, tierra y lo que dan', () => {
    const seen = new Set<string>();
    for (const seed of [11, 12, 13]) {
      const w = createWorld(seed);
      const g = geography(w);
      for (const x of g) seen.add(x.climate), seen.add(x.biome);
      // Las cosechas dependen del clima y la tierra: no rinden igual en todas partes.
      const farms = g.map((x) => x.farm);
      expect(Math.max(...farms) - Math.min(...farms)).toBeGreaterThan(0.1);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    // El tiempo es regional: el mismo día llueve en un sitio y no en otro.
    const w = createWorld(12);
    let differ = 0;
    for (let d = 1; d <= 40; d++) if (new Set(w.regions.map((r) => weatherIn(w, r.id, d))).size > 1) differ++;
    expect(differ).toBeGreaterThan(10);
  });

  it('2b) los ecosistemas se agotan si se abusa y se recuperan si se les deja', () => {
    const w = world(14);
    const r = w.regions.find((x) => geoOf(w, x.id).mix.bosque > 0.05) ?? w.regions[0];
    const before = natureFactor(w, r.id, 'lenador');
    for (let i = 0; i < 40; i++) harvestNature(w, r.id, 'lenador', 20);
    expect(natureOf(w, r.id).bosque).toBeLessThan(0.5);
    expect(natureFactor(w, r.id, 'lenador')).toBeLessThan(before);
    const low = natureOf(w, r.id).bosque;
    days(w, 40);
    expect(natureOf(w, r.id).bosque).toBeGreaterThan(low);
  });

  it('3) sociedades distintas: comida, familia, herencia, gobierno, lengua; y se nota al hablar', () => {
    const w = world(15);
    const profiles = w.regions.map((r) => profileOf(cultureOf(w, r.id)));
    const kinds = new Set(profiles.map((p) => `${p.inheritance}|${p.family}|${p.diet[0]}|${p.government[0]}`));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(new Set(profiles.map((p) => p.language.words.hola)).size).toBeGreaterThanOrEqual(3);
    // Los gobiernos no son todos iguales: salen de cada cultura.
    expect(new Set(w.regions.map((r) => govOf(w, r.id).system)).size).toBeGreaterThanOrEqual(3);
    // Un extranjero saluda en su lengua; si no se le entiende, solo se captan trozos.
    const foreign = w.life!.folk.find((f) => f.alive && !w.regions[f.regionId].isHome && cultureOf(w, f.regionId).id !== cultureOf(w, w.player.home).id)!;
    const c = cultureOf(w, foreign.regionId);
    const k0 = comprehension(w, c);
    const said = foreignSpeech(w, foreign, ['Hola.', ...Array.from({ length: 8 }, (_, i) => `El trigo está muy caro este año ${i}, la cosecha fue mala y nadie vende.`)]);
    expect(said[0]).toContain(profileOf(c).language.words.hola.slice(1));
    if (k0 <= 0.6) expect(said.join(' ')).toMatch(/Entiendes algo como/);
    // Con el tiempo entre ellos, se entiende más.
    atlasOf(w).exposure[c.id] = 40;
    expect(comprehension(w, c)).toBeGreaterThan(k0);
  });

  it('4) economías conectadas: el mar, los asentamientos, las técnicas que viajan con la gente y la ayuda tras un desastre', () => {
    const w = world(16);
    const a = atlasOf(w);
    // Dos puertos que no comparten camino: lo barato de uno llega al otro por mar.
    const coast = w.regions.filter((r) => geoOf(w, r.id).coast);
    const pair = coast.flatMap((x) => coast.filter((y) => y.id > x.id && !x.neighbors.includes(y.id)).map((y) => [x.id, y.id]))[0] ?? [coast[0].id, coast[1].id];
    const [p, q] = pair;
    a.ports[p] = w.day;
    a.ports[q] = w.day;
    a.seaRoutes.push({ a: p, b: q, since: w.day });
    const before = marketOf(w, q).stock.pescado;
    for (let i = 0; i < 12; i++) {
      marketOf(w, p).stock.pescado = 300;
      marketOf(w, p).price.pescado = 0.5;
      marketOf(w, q).price.pescado = 9;
      advanceDay(w);
    }
    expect(marketOf(w, q).stock.pescado + marketOf(w, q).eaten).toBeGreaterThan(before);
    expect(tradeOf(w).volume[`${Math.min(p, q)}-${Math.max(p, q)}`] ?? 0).toBeGreaterThan(0);
    // Una técnica viaja con quien emigra.
    const from = w.player.home;
    const to = w.regions[from].neighbors[0];
    const tech = ['acequias', 'telares', 'salazon', 'fuelles', 'remedios'].find((t) => !w.regions[to].techs.includes(t) && !knowOf(w, to, t))!;
    const carrier = w.life!.folk.find((f) => f.alive && f.regionId === from && f.age > 18)!;
    const k = knowOf(w, from, tech) ?? startKnow(w, from, tech, undefined, carrier, 'Aparece');
    k.carriers.push(carrier.id);
    carrier.regionId = to;
    carryKnowledge(w, carrier, from, to);
    expect(knowOf(w, to, tech)).toBeTruthy();
    // Un desastre: lo pagan las casas y los almacenes; los vecinos amigos ayudan.
    const victim = w.regions[to];
    for (const nb of victim.neighbors) victim.relations[nb] && ((victim.relations[nb].opinion = 0.8), (w.regions[nb].relations[to].opinion = 0.8));
    const pop = victim.population;
    strike(w, to, 'terremoto', 0.8);
    expect(victim.population).toBeLessThan(pop);
    days(w, 4);
    const d = a.disasters.find((x) => x.regionId === to)!;
    expect(d.recovered).toBeGreaterThan(0);
    // (la ayuda solo llega de quien es amigo de verdad)
    expect(d.aidFrom.every((x) => victim.neighbors.includes(x))).toBe(true);
  });

  it('5) y 6) los territorios forman estados que se relacionan; las fronteras cambian (independencia)', () => {
    const w = world(17);
    const before = statesOf(w).length;
    const lord = w.player.home;
    const vassal = w.regions[lord].neighbors[0];
    polOf(w).owner[vassal] = lord;
    const after = statesOf(w);
    expect(after.length).toBe(before - 1);
    const realm = after.find((s) => s.regions.includes(vassal))!;
    expect(realm.regions).toContain(lord);
    expect(realm.name).toMatch(new RegExp(w.regions[lord].name));
    const other = after.find((s) => !s.regions.includes(lord))!;
    expect(typeof stateRelation(w, realm, other)).toBe('string');
    // El sometido se alza: es una guerra de independencia, y si la gana, la frontera vuelve a moverse.
    const war = startWorldWar(w, vassal, lord);
    expect(war.kind).toBe('independencia');
    finishWar(w, war, vassal, 'batalla');
    expect(polOf(w).owner[vassal]).toBe(vassal);
    expect(statesOf(w).length).toBe(before);
  });

  it('7) las generaciones del mundo continúan: tras décadas sigue habiendo gente, pueblos y épocas', () => {
    const w = world(18);
    const start = w.regions.reduce((s, r) => s + r.population, 0);
    days(w, DAYS_PER_YEAR * 25);
    const end = w.regions.reduce((s, r) => s + r.population, 0);
    expect(end).toBeGreaterThan(start * 0.35);
    expect(w.regions.every((r) => r.population >= 20)).toBe(true); // ninguna tierra se queda vacía del todo
    expect(w.life!.folk.filter((f) => f.alive && f.born > DAYS_PER_YEAR * 5).length).toBeGreaterThan(5);
    const a = atlasOf(w);
    expect(a.eras.length).toBeGreaterThanOrEqual(3);
    expect(a.settlements.length).toBeGreaterThan(0);
  }, 60000);

  it('8) las decisiones persisten: lo que funda y enseña el protagonista sigue ahí años después (y tras guardar)', () => {
    const w = world(19);
    const id = w.life!.identity!;
    id.needs.coins = 80;
    const res = playerFound(w, 6);
    expect(res.ok).toBe(true);
    const learner = w.life!.folk.find((f) => f.alive && f.regionId === playerRegion(w) && f.age > 18)!;
    const tech = ['acequias', 'telares', 'salazon', 'fuelles', 'remedios', 'senales'].find((t) => !w.regions[learner.regionId].techs.includes(t) && !knowOf(w, learner.regionId, t))!;
    atlasOf(w).playerTechs.push(tech);
    teachTech(w, learner, tech);
    expect(chooseAim(w, 'fundar')).toMatch(/Te propones/);
    w.day += w.day % 2; // los propósitos se revisan en días pares
    expect(aimsDay(w).join(' ')).toMatch(/Lo has conseguido/);
    const back = importGame(exportGame(w))!;
    days(back, DAYS_PER_YEAR * 4);
    const s = atlasOf(back).settlements.find((x) => x.byPlayer)!;
    expect(s).toBeTruthy();
    expect(s.history[0].text).toMatch(/Lo fundaron/);
    expect(gensOf(back).history.some((e) => e.kind === 'fundacion' && e.actor === back.life!.player.name)).toBe(true);
    expect(back.regions[learner.regionId].techs.includes(tech) || (knowOf(back, learner.regionId, tech)?.adoption ?? 0) > 0.12).toBe(true);
    expect(atlasOf(back).aims.find((a) => a.id === 'fundar')?.done).toBeGreaterThan(0);
  });

  it('9) y 10) el mundo cambia sin el jugador; al volver años después, se nota (y te lo cuentan)', () => {
    const w = world(20);
    const home = w.player.home;
    const t0 = takeSnapshot(w);
    snapshotWorld(w);
    // El protagonista se va lejos y no hace nada durante diez años.
    const far = w.regions.filter((r) => !r.neighbors.includes(home) && r.id !== home)[0] ?? w.regions.find((r) => r.id !== home)!;
    goTo(w, far.id);
    expect(simTier(w, home, playerRegion(w))).toBe(1); // su casa sigue viva en detalle
    const unseen = w.regions.find((r) => r.id !== far.id && !r.isHome && w.life!.visited[r.id] === undefined && !far.neighbors.includes(r.id));
    if (unseen) expect(simTier(w, unseen.id, far.id)).toBe(4); // lo lejano y desconocido, por turnos
    days(w, DAYS_PER_YEAR * 10);
    const diff = worldDiff(t0, takeSnapshot(w));
    expect(diff).toBeGreaterThan(0.05);
    // Vuelve a casa.
    const left = 2;
    w.life!.society!.lastSeen[home] = left;
    goTo(w, home);
    const news = catchUp(w, home);
    expect(news.join(' ')).toMatch(/Han pasado \d+ años/);
    expect(worldSince(w, left).length).toBeGreaterThan(1);
  }, 60000);

  it('11) rendimiento para Android: un año de mundo entero en poco tiempo, 10.000 personas abstractas y guardado pequeño', () => {
    const w = world(21);
    // Población a escala: miles de personas abstractas (los vecinos con nombre siguen siendo unos cientos).
    for (const r of w.regions) r.population = Math.max(r.population, 1200);
    expect(w.regions.reduce((s, r) => s + r.population, 0)).toBeGreaterThanOrEqual(10000);
    const t = performance.now();
    days(w, DAYS_PER_YEAR);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(6000);
    // Lo lejano se simula por turnos (nivel 4), lo cercano en detalle (nivel 1).
    expect(simTier(w, w.player.home, w.player.home)).toBe(1);
    // El guardado lleva la semilla y los cambios, no el mapa.
    const save = exportGame(w);
    expect(save.length).toBeLessThan(3_000_000);
    expect(save).not.toMatch(/"tiles"/);
    expect(JSON.stringify(w.life!.atlas).length).toBeLessThan(120_000);
  }, 60000);

  it('12) historias distintas en cada partida (y en la misma isla, según lo que se decida)', () => {
    const run = (seed: number, act?: (w: WorldState) => void) => {
      const w = world(seed);
      act?.(w);
      days(w, DAYS_PER_YEAR * 12);
      return { w, story: gensOf(w).history.map((e) => e.text).join('\n'), eras: atlasOf(w).eras.map((e) => e.name).join('|') };
    };
    const a = run(22);
    const b = run(23);
    expect(a.story).not.toBe(b.story);
    // Misma semilla, otra decisión: un desastre (o una fundación) cambia lo que viene después.
    const c = run(22, (w) => strike(w, w.regions[w.player.home].neighbors[0], 'inundacion', 0.9));
    expect(c.story).not.toBe(a.story);
  }, 60000);

  it('los lugares con historia: cuevas, pecios, ruinas… y la casa del origen para los descendientes', () => {
    const w = world(24);
    ensurePois(w);
    const a = atlasOf(w);
    expect(a.pois.length).toBeGreaterThan(2);
    const home = a.pois.find((p) => p.clue === 'origen');
    if (home) expect(examinePoi(w, home).join(' ')).toMatch(/símbolo/);
    // Un asentamiento abandonado acaba en ruinas visitables.
    const s = foundSettlement(w, w.player.home, 10, 'unas familias', 'probar suerte', new Rng(5))!;
    s.people = 3;
    days(w, 5);
    expect(s.state).toBe('abandonado');
    days(w, 210);
    expect(s.state).toBe('ruinas');
    expect(a.pois.some((p) => p.kind === 'ruinas' && p.name.includes(s.name))).toBe(true);
  }, 60000);

  it('los caminos mejoran con el uso y su estado cambia el viaje', () => {
    const w = world(25);
    const route = w.routes[0];
    const road = roadOf(w, route.id);
    road.quality = 0.9;
    const good = roadFactor(w, route.a, route.b);
    road.quality = 0.1;
    const bad = roadFactor(w, route.a, route.b);
    expect(good.risk).toBeLessThan(bad.risk);
    expect(good.speed).toBeGreaterThan(bad.speed);
    // Con mucho tráfico el camino mejora; el que nadie usa se cubre de maleza.
    const idle = w.routes.find((r) => r.id !== route.id)!;
    idle.status = 'cerrada'; // nadie pasa por él
    roadOf(w, route.id).quality = 0.4;
    roadOf(w, idle.id).quality = 0.4;
    const vol = tradeOf(w).volume;
    const key = `${Math.min(route.a, route.b)}-${Math.max(route.a, route.b)}`;
    const quiet = `${Math.min(idle.a, idle.b)}-${Math.max(idle.a, idle.b)}`;
    for (let i = 0; i < 60; i++) {
      vol[key] = (vol[key] ?? 0) + 6;
      vol[quiet] = 0;
      roadOf(w, idle.id).last = 0;
      advanceDay(w);
    }
    expect(roadOf(w, route.id).quality).toBeGreaterThan(0.45);
    expect(roadOf(w, idle.id).quality).toBeLessThan(roadOf(w, route.id).quality - 0.05);
    expect(techFactor(w, w.player.home, 'trigo')).toBeGreaterThan(0);
  }, 30000);
});
