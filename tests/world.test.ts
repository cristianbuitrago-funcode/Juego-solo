import { describe, expect, it } from 'vitest';
import { performAction } from '../src/core/actions';
import { createWorld } from '../src/core/gen/worldgen';
import { exportGame, importGame } from '../src/core/save';
import { advanceDay } from '../src/core/simulation';
import type { WorldState } from '../src/core/types';
import { wireWorld } from '../src/world';
import { dayOf, hourOf, seasonOf, weatherOf, yearOf } from '../src/world/clock';
import { describeEncounter, encounterOptions, resolveEncounter } from '../src/world/encounters';
import { getLayout } from '../src/world/layout';
import { createLife, ensureLife, heirs, succeed } from '../src/world/life';
import { answerOffer, chooseFragment, gain, questions, standingOf, tryFragment } from '../src/world/identity';
import { jobFor, work } from '../src/world/livelihood';
import { findPath, passable } from '../src/world/path';
import { examinePlace, listenTavern } from '../src/world/presence';
import { roadPath } from '../src/world/roadnet';
import { acequiaOptions, acequiaResolve, logDay, prologueBlocks, prologueChoose, prologueDawn, prologueItems, prologueOf, prologueScene, prologueTick, recap } from '../src/world/prologue';
import { routineOf } from '../src/world/routines';
import { arcAct, arcChoices } from '../src/world/arcs';
import { marketOf } from '../src/world/economy';
import { seedRumor, spreadRumors } from '../src/world/gossip';
import { mournDeaths } from '../src/world/social';
import { fadeMemories, kinOf, memorize } from '../src/world/society';
import { Rng } from '../src/core/rng';
import { giveTo, talkToFolk } from '../src/world/talk';
import { idx } from '../src/world/terrain';
import { T } from '../src/world/types';

wireWorld();

function world(seed: number): WorldState {
  const w = createWorld(seed, { eraLength: 0 });
  ensureLife(w);
  return w;
}

describe('terreno y pueblos', () => {
  it('es determinista y coherente con las regiones del motor', () => {
    const a = getLayout(createWorld(77));
    const b = getLayout(createWorld(77));
    expect(a.roads.length).toBe(b.roads.length);
    expect(a.villages.map((v) => [v.cx, v.cy])).toEqual(b.villages.map((v) => [v.cx, v.cy]));
  });

  it('cada región tiene su pueblo con plaza, salón, almacén y posada', () => {
    const w = createWorld(78);
    const l = getLayout(w);
    for (const v of l.villages) {
      expect(l.terrain.region[idx(v.cx, v.cy)]).toBe(v.regionId);
      expect(l.terrain.tiles[idx(v.cx, v.cy)]).toBe(T.Plaza);
      for (const k of ['salon', 'almacen', 'posada']) expect(v.keys.some((b) => b.kind === k)).toBe(true);
      expect(v.houses.length).toBeGreaterThan(10);
    }
  });

  it('los caminos unen los pueblos y cruzan el río por puentes', () => {
    const w = createWorld(79);
    const l = getLayout(w);
    expect(l.roads.length).toBe(w.routes.length);
    expect(l.posts.length).toBeGreaterThan(0);
    const path = roadPath(w, l.roads[0].a, l.roads[0].b);
    expect(path.length).toBeGreaterThan(5);
    for (const p of path.filter((_, i) => i % 5 === 0)) expect(l.terrain.tiles[idx(p.x, p.y)]).not.toBe(T.River);
  });

  it('el jugador empieza en tierra firme y puede llegar caminando a la plaza', () => {
    const w = world(80);
    const l = getLayout(w);
    const p = w.life!.player;
    expect(passable(w, l, p.x, p.y)).toBe(true);
    const v = l.villages[w.player.home];
    expect(findPath(w, p.x, p.y, v.cx + 0.5, v.cy + 0.5).length).toBeGreaterThan(0);
  });
});

describe('vecinos con rutinas y memoria', () => {
  it('las rutinas cambian con la hora y con el estado de la región', () => {
    const w = world(81);
    const life = w.life!;
    const farmer = life.folk.find((f) => f.role === 'campesino' && !w.regions[f.regionId].isHome)!;
    const night = routineOf(w, farmer, 22 * 60 - 6 * 60);
    const day = routineOf(w, farmer, 9 * 60 - 6 * 60);
    expect(night.inside).toBe(true);
    expect(day.inside).toBe(false);
    expect(day.activity).toContain('campo');
    w.regions[farmer.regionId].flags.hambre = { since: w.day };
    expect(routineOf(w, farmer, 9 * 60 - 6 * 60).activity).toContain('cola');
  });

  it('un vecino recuerda que le diste comida y te reconoce al volver', () => {
    const w = world(82);
    const f = w.life!.folk.find((x) => !x.charId && x.role !== 'nino')!;
    w.life!.player.inventory.comida = 2; // el protagonista despierta sin nada: primero hay que conseguirla
    talkToFolk(w, f.id);
    giveTo(w, f.id, 'comida');
    expect(f.memories.some((m) => m.kind === 'comida')).toBe(true);
    for (let i = 0; i < 12; i++) advanceDay(w);
    if (f.alive) {
      const res = talkToFolk(w, f.id);
      expect(res.lines[0]).toMatch(/volverías|Eres tú/);
    }
  });

  it('la información que comparten depende de la confianza', () => {
    const w = world(83);
    const f = w.life!.folk.find((x) => !x.charId && !w.regions[x.regionId].isHome)!;
    f.trust = 0;
    f.resentment = 1;
    f.gratitude = 0;
    const res = talkToFolk(w, f.id);
    expect(res.learned.join(' ')).toContain('evita hablar');
  });

  it('nacen, envejecen y mueren con el paso de los años', () => {
    const w = world(84);
    const before = w.life!.folk.filter((f) => !f.charId).map((f) => f.age);
    for (let i = 0; i < 45; i++) advanceDay(w);
    const after = w.life!.folk.filter((f) => !f.charId && f.alive);
    expect(after.some((f) => f.age > (before[0] ?? 0) || f.role === 'nino')).toBe(true);
    expect(w.life!.folk.length).toBeGreaterThan(30);
  });
});

describe('consecuencias visibles', () => {
  it('la caravana física sale del almacén y llega cuando el motor entrega las provisiones', () => {
    const w = world(85);
    const target = w.regions.find((r) => !r.isHome && roadPath(w, w.player.home, r.id).length)!;
    w.player.authority = 6; // solo quien tiene voz en el consejo puede mandar caravanas
    performAction(w, 'ayuda', { region: target.id, amount: 12 });
    const c = w.life!.caravans[0];
    expect(c).toBeDefined();
    expect(c.arrive).toBeGreaterThan(c.depart);
  });

  it('la guerra quema casas y la paz trae la reconstrucción', () => {
    const w = world(86);
    const a = w.regions.find((r) => !r.isHome && r.neighbors.some((n) => !w.regions[n].isHome))!;
    const b = w.regions[a.neighbors.find((n) => !w.regions[n].isHome)!];
    a.relations[b.id].war = b.relations[a.id].war = true;
    a.flags.guerra = { since: w.day, data: { with: b.id } };
    b.flags.guerra = { since: w.day, data: { with: a.id } };
    for (let i = 0; i < 8; i++) advanceDay(w);
    const burned = w.life!.towns[a.id].burned.length + w.life!.towns[b.id].burned.length;
    expect(burned).toBeGreaterThan(0);
  });
});

describe('exploración y encuentros', () => {
  it('examinar lugares descubiertos da objetos y puede revelar la verdad oculta', () => {
    const w = world(87);
    const l = getLayout(w);
    const p = l.places[0];
    w.life!.places[p.id] = { discovered: true };
    const lines = examinePlace(w, p.id);
    expect(lines.length).toBeGreaterThan(0);
    expect(w.life!.places[p.id].examined).toBe(true);
  });

  it('escuchar en la posada solo se puede una vez al día', () => {
    const w = world(88);
    const r = w.regions.find((x) => !x.isHome)!;
    listenTavern(w, r.id);
    expect(listenTavern(w, r.id)[0]).toContain('Vuelve mañana');
  });

  it('una disputa ignorada puede convertirse en una ofensa entre pueblos', () => {
    let escalated = 0;
    for (let s = 0; s < 6; s++) {
      const w = world(90 + s);
      const r = w.regions.find((x) => !x.isHome && x.neighbors.some((n) => !w.regions[n].isHome))!;
      const o = r.neighbors.find((n) => !w.regions[n].isHome)!;
      r.relations[o].tension = 0.5;
      const a = w.life!.folk.find((f) => f.regionId === r.id && !f.charId)!;
      const b = w.life!.folk.find((f) => f.regionId === o && !f.charId)!;
      w.life!.encounters.push({ id: 'n1', kind: 'disputa', regionId: r.id, x: 10, y: 10, day: w.day, folkA: a.id, folkB: b.id, otherRegion: o, truth: 'robo', resolved: false, learned: [], announced: true });
      const e = w.life!.encounters[0];
      expect(describeEncounter(w, e).scene).toContain(a.name);
      expect(encounterOptions(w, e).some((x) => x.id === 'investigar')).toBe(true);
      resolveEncounter(w, 'n1', 'irse');
      if (w.entries.some((x) => x.text.includes('ofensa entre pueblos'))) escalated++;
    }
    expect(escalated).toBeGreaterThan(0);
  });
});

describe('tiempo y generaciones', () => {
  it('el calendario tiene horas, estaciones, años y tiempo atmosférico', () => {
    expect(hourOf(0)).toBe(6);
    expect(dayOf(1440)).toBe(2);
    expect(seasonOf(1)).toBe('primavera');
    expect(seasonOf(16)).toBe('invierno');
    expect(yearOf(21)).toBe(2);
    expect(['despejado', 'nublado', 'lluvia', 'niebla', 'nieve']).toContain(weatherOf(createWorld(1), 3));
  });

  it('cuando el personaje muere, un heredero toma el relevo y la partida continúa', () => {
    const w = world(95);
    const life = w.life!;
    life.player.family.push({ name: 'Ilae', relation: 'hija', age: 20 });
    expect(heirs(life).length).toBeGreaterThan(0);
    const oldName = life.player.name;
    const heir = heirs(life)[0].name;
    succeed(w, heir);
    expect(w.life!.player.name).toBe(heir);
    expect(w.life!.player.generation).toBe(2);
    expect(w.life!.player.lineage[0].name).toBe(oldName);
    expect(w.entries.some((e) => e.text.includes(`Muere ${oldName}`))).toBe(true);
    advanceDay(w);
    expect(w.ended).toBe(false);
  });

  it('el mundo es infinito si no se fija una era', () => {
    const w = world(96);
    for (let i = 0; i < 80; i++) advanceDay(w);
    expect(w.ended).toBe(false);
  });
});

describe('guardado del mundo vivo', () => {
  it('la capa de vida viaja con la partida y las partidas antiguas se migran', () => {
    const w = world(97);
    const back = importGame(exportGame(w))!;
    expect(back.life?.folk.length).toBe(w.life!.folk.length);
    const old = createWorld(98);
    (old as { version: number }).version = 1;
    const migrated = importGame(exportGame(old))!;
    expect(migrated.version).toBe(2);
    expect(ensureLife(migrated).folk.length).toBeGreaterThan(0);
    expect(createLife(migrated).player.name).toBeTruthy();
  });
});

describe('despertar sin memoria y ganarse un lugar', () => {
  it('empieza sin nombre, sin nada y sin autoridad', () => {
    const w = world(301);
    const life = w.life!;
    const id = life.identity!;
    expect(id.mode).toBe('forastero');
    expect(id.named).toBe(false);
    expect(life.player.family.length).toBe(0);
    expect(life.player.inventory.comida).toBe(0);
    expect(w.player.authority).toBe(0);
    expect(id.items).toContain('colgante');
    expect(id.story[0].kind).toBe('despertar');
    // Despierta fuera del pueblo, no en la plaza.
    const v = getLayout(w).villages[w.player.home];
    expect(Math.hypot(v.cx - life.player.x, v.cy - life.player.y)).toBeGreaterThan(15);
  });

  it('sin cargo no puede tomar decisiones políticas', () => {
    const w = world(302);
    const target = w.regions.find((r) => !r.isHome)!;
    const res = performAction(w, 'alianza', { region: target.id, other: target.neighbors[0] });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/haría falta/);
    expect(w.petitions.length).toBe(0);
  });

  it('las habilidades se descubren al usarlas y el pasado despierta de golpe', () => {
    const w = world(303);
    const id = w.life!.identity!;
    const skill = Object.keys(id.latent).find((k) => !k.startsWith('k:')) as keyof typeof id.skills;
    const latent = id.latent[skill];
    expect(id.skills[skill].level).toBe(0);
    const notes = gain(w, skill, 1);
    expect(id.skills[skill].level).toBe(latent);
    expect(id.skills[skill].past).toBe(true);
    expect(notes[0].big).toBe(true);
    // Sin pasado: se aprende poco a poco.
    const plain = (Object.keys(id.skills) as (keyof typeof id.skills)[]).find((k) => !(k in id.latent) && id.skills[k].level === 0)!;
    gain(w, plain, 1);
    expect(id.skills[plain].level).toBe(1);
    for (let i = 0; i < 20; i++) gain(w, plain, 1);
    expect(id.skills[plain].level).toBeGreaterThanOrEqual(3);
  });

  it('trabajar da monedas, enseña y gana reputación hasta abrir puertas', () => {
    const w = world(304);
    const life = w.life!;
    const id = life.identity!;
    const workers = life.folk.filter((f) => f.alive && f.regionId === w.player.home && jobFor(w, f) && f.role !== 'lider');
    expect(workers.length).toBeGreaterThan(2);
    for (let d = 0; d < 6; d++) {
      for (const f of workers.slice(0, 3)) {
        id.needs.fatigue = 0;
        const out = work(w, f.id);
        expect(out.minutes).toBeGreaterThan(0);
      }
      advanceDay(w);
    }
    expect(id.needs.coins).toBeGreaterThan(0);
    expect(id.deeds.trabajar).toBeGreaterThanOrEqual(18);
    expect(standingOf(w, w.player.home)).toBeGreaterThanOrEqual(2);
    expect(w.player.authority).toBe(standingOf(w, w.player.home));
  });

  it('los cargos se ofrecen y se pueden rechazar; aceptarlos da voz en el consejo', () => {
    const w = world(305);
    const id = w.life!.identity!;
    id.score[w.player.home] = 60;
    id.deeds[`crisis:${w.player.home}`] = 1;
    for (let i = 0; i < 30 && !id.offers.length; i++) advanceDay(w);
    const offer = id.offers.find((o) => o.regionId === w.player.home)!;
    expect(offer.level).toBe(4);
    answerOffer(w, w.player.home, false);
    expect(w.player.authority).toBe(3);
    expect(id.story.some((e) => e.text.includes('Rechazó'))).toBe(true);
    id.offers.push({ regionId: w.player.home, level: 4, day: w.day });
    answerOffer(w, w.player.home, true);
    expect(w.player.authority).toBe(4);
    expect(performAction(w, 'observar', { region: w.regions.find((r) => !r.isHome)!.id }).ok).toBe(true);
  });

  it('los recuerdos llegan por fragmentos y el jugador decide qué hacer con ellos', () => {
    const w = world(306);
    const life = w.life!;
    const id = life.identity!;
    const past = id.past!;
    expect(tryFragment(w, { kind: 'colgante' })!.lines.join(' ')).toContain(past.symbol);
    expect(tryFragment(w, { kind: 'region', regionId: past.origin })!.id).toBe('lugar');
    const meet = tryFragment(w, { kind: 'hablar', folkId: past.link! })!;
    expect(meet.id).toBe('persona');
    chooseFragment(w, 'persona', 'rechazar');
    expect(id.named).toBe(true);
    expect(life.player.name).not.toBe(past.trueName);
    id.fragments.push({ id: 'x', day: w.day }, { id: 'y', day: w.day });
    const truth = tryFragment(w, { kind: 'hablar', folkId: past.link! })!;
    expect(truth.id).toBe('verdad');
    expect(truth.choices!.length).toBeGreaterThan(1);
    expect(questions(w).length).toBeGreaterThan(0);
  });

  it('el heredero no es una copia y puede rechazar el legado', () => {
    const w = world(307);
    const life = w.life!;
    const id = life.identity!;
    gain(w, 'comercio', 30);
    id.score[w.player.home] = 50;
    life.player.family.push({ name: 'Ilae', relation: 'hija', age: 20 });
    succeed(w, 'Ilae', false);
    const next = life.identity!;
    expect(next.lives.length).toBe(1);
    expect(next.skills.comercio.level).toBeLessThan(id.skills.comercio.level);
    expect(next.score[w.player.home]).toBeLessThan(20);
    expect(next.temper).toBeTruthy();
    expect(next.past).toBeNull();
  });

  it('las partidas antiguas siguen gobernando', () => {
    const w = world(308);
    delete w.life!.identity;
    delete w.player.authority;
    const life = ensureLife(w);
    expect(life.identity!.mode).toBe('gobernante');
    expect(w.player.authority).toBeUndefined();
    expect(performAction(w, 'observar', { region: w.regions.find((r) => !r.isHome)!.id }).ok).toBe(true);
  });
});

describe('el prólogo: los primeros días', () => {
  const at = (day: number, hour: number) => (day - 1) * 1440 + (hour - 6) * 60;

  it('prepara el despertar: mochila, cabaña y personas distintas', () => {
    const w = world(401);
    const p = prologueOf(w)!;
    const me = w.life!.player;
    expect(p.objective).toBe('Descubre dónde estás');
    expect(Math.hypot(p.bag.x - me.x, p.bag.y - me.y)).toBeLessThan(4);
    const ids = [p.first, p.inn, p.merchant, p.kid, p.artisan, p.a, p.b];
    expect(new Set(ids).size).toBe(ids.length);
    expect(w.life!.identity!.latent.artesania).toBeGreaterThanOrEqual(1);
    for (const c of prologueBlocks(w)) expect(Math.hypot(c.x - me.x, c.y - me.y)).toBeGreaterThan(2);
    // Se llega andando: hay camino desde donde despiertas hasta el pueblo, y pasa por la primera persona.
    const v = getLayout(w).villages[w.player.home];
    expect(findPath(w, me.x, me.y, v.cx + 0.5, v.cy + 0.5).length).toBeGreaterThan(0);
    expect(Math.hypot(v.cx - p.road.x, v.cy - p.road.y)).toBeGreaterThan(v.plazaR + 7);
  });

  it('la mochila que no recuerdas y la primera persona del camino', () => {
    const w = world(402);
    const p = prologueOf(w)!;
    const life = w.life!;
    const bag = prologueScene(w, { kind: 'item', id: 'mochila' })!;
    expect(bag.lines.join(' ')).toMatch(/No recuerdas haberla visto antes/);
    prologueChoose(w, 'bag', 'abrir');
    expect(life.identity!.items).toEqual(expect.arrayContaining(['llave', 'cuaderno']));
    expect(life.identity!.needs.coins).toBe(3);
    expect(life.player.inventory.comida).toBe(2);
    expect(prologueItems(w).some((i) => i.id === 'mochila')).toBe(false);
    const f = life.folk.find((x) => x.id === p.first)!;
    expect(routineOf(w, f, at(1, 8)).x).toBeCloseTo(p.road.x);
    const s = prologueScene(w, { kind: 'folk', id: f.id })!;
    expect(s.lines[0]).toMatch(/¿Te encuentras bien\?/);
    const next = prologueChoose(w, s.id, 'no')!;
    expect(next.lines[0]).toMatch(/¿No recuerdas\?/);
    prologueChoose(w, next.id, 'ok');
    expect(p.met).toBe(true);
    expect(p.objective).toMatch(/Sigue el camino/);
  });

  it('llegar al pueblo a pie lo descubre; las manos recuerdan cómo reparar', () => {
    const w = world(403);
    const p = prologueOf(w)!;
    const v = getLayout(w).villages[w.player.home];
    expect(prologueTick(w, v.cx, v.cy + 2, at(1, 8)).banner?.[1]).toBe(w.regions[w.player.home].name);
    expect(p.arrived).toBe(true);
    const s0 = prologueScene(w, { kind: 'folk', id: p.artisan })!;
    const s1 = prologueChoose(w, s0.id, 'probar')!;
    expect(s1.lines[0]).toMatch(/No estás seguro/);
    const s2 = prologueChoose(w, s1.id, 'mirar')!;
    const flash = prologueChoose(w, s2.id, 'probar')!;
    expect(flash.flash).toBe(true);
    expect(flash.notes!.some((n) => /extrañamente familiar.*Reparación básica/.test(n.text))).toBe(true);
    expect(w.life!.identity!.skills.artesania.level).toBeGreaterThanOrEqual(1);
    const after = prologueChoose(w, flash.id, 'ok')!;
    expect(after.lines.join(' ')).toMatch(/No sabes quién era esa persona/);
  });

  it('la caja perdida: venderla tiene consecuencias al día siguiente', () => {
    const w = world(404);
    const p = prologueOf(w)!;
    const v = getLayout(w).villages[w.player.home];
    prologueTick(w, v.cx, v.cy, at(1, 8));
    prologueTick(w, v.cx, v.cy, at(1, 10));
    expect(p.crate).toBe('lost');
    expect(prologueItems(w).some((i) => i.id === 'caja')).toBe(true);
    // Está donde dice el comerciante: junto al almacén, cerca de la plaza.
    const store = getLayout(w).villages[w.player.home].keys.find((k) => k.kind === 'almacen')!;
    expect(Math.hypot(p.crateSpot.x - (store.x + store.w / 2), p.crateSpot.y - (store.y + store.h / 2))).toBeLessThan(10);
    expect(prologueChoose(w, 'merchant:lost', 'donde')!.lines[0]).toMatch(/de la plaza/);
    expect(p.objective).toMatch(/caja/);
    prologueChoose(w, 'crate', 'vender');
    expect(p.crate).toBe('sold');
    w.day = 2;
    const news = prologueDawn(w);
    expect(news.join(' ')).toMatch(/Sabe quién los vendió/);
    const m = w.life!.folk.find((f) => f.id === p.merchant)!;
    expect(m.memories.some((x) => x.kind === 'robo')).toBe(true);
  });

  it('la acequia: investigar ayuda a mediar, y el acuerdo se nota después', () => {
    const w = world(405);
    const p = prologueOf(w)!;
    const life = w.life!;
    const v = getLayout(w).villages[w.player.home];
    prologueTick(w, v.cx, v.cy, at(1, 8));
    w.day = 2;
    prologueTick(w, v.cx, v.cy, at(2, 9));
    expect(p.water).toBe('active');
    const enc = life.encounters.find((e) => e.id === p.encId)!;
    expect(enc.kind).toBe('p_acequia');
    const A = life.folk.find((f) => f.id === p.a)!;
    expect(routineOf(w, A, at(2, 10)).activity).toMatch(/acequia/);
    expect(acequiaOptions(w).map((o) => o.id)).toEqual(expect.arrayContaining(['a', 'b', 'mediar', 'mentir', 'irse', 'zanja', 'vecinos']));
    acequiaResolve(w, 'zanja');
    acequiaResolve(w, 'vecinos');
    expect(acequiaResolve(w, 'mediar').done).toBe(true);
    expect(p.water).toBe('mediated');
    expect(enc.resolved).toBe(true);
    w.day = 3;
    expect(prologueDawn(w).join(' ')).toMatch(/arreglado juntos/);
  });

  it('al final llega una pista: una carta con el símbolo del colgante', () => {
    const w = world(406);
    const p = prologueOf(w)!;
    Object.assign(p, { arrived: true, repair: 3, crate: 'returned', water: 'a' });
    w.day = 2;
    const t = prologueTick(w, 0, 0, at(2, 12));
    expect(p.clue).toBe('ready');
    expect(t.whispers.join(' ')).toMatch(/algo para ti/);
    const s = prologueScene(w, { kind: 'posada' })!;
    const letter = prologueChoose(w, s.id, 'abrir')!;
    expect(letter.letter).toBe(true);
    expect(letter.lines.join(' ')).toContain(w.regions[w.life!.identity!.past!.origin].name);
    expect(letter.lines.at(-1)).toBe('¿Por qué conozco esto?');
    expect(w.life!.identity!.items).toContain('carta');
  });

  it('el resumen del día y el guardado conservan el prólogo', () => {
    const w = world(407);
    prologueChoose(w, 'bag', 'abrir');
    logDay(w, 'decision', 'Algo.');
    const lines = recap(w, 1);
    expect(lines.join(' ')).toMatch(/decisión/);
    const back = importGame(exportGame(w))!;
    expect(back.life!.prologue!.bag.opened).toBe(true);
  });
});

describe('Fase 2: el pueblo vive solo', () => {
  it('cada vecino es una persona distinta, con familia y lazos', () => {
    const w = world(501);
    const life = w.life!;
    const folk = life.folk.filter((f) => f.alive);
    expect(folk.every((f) => f.p && f.gender)).toBe(true);
    const kind = new Set(folk.map((f) => Math.round(f.p!.t.amable / 20)));
    expect(kind.size).toBeGreaterThan(2);
    const ties = Object.values(life.society!.ties);
    expect(ties.some((t) => t.kin === 'pareja')).toBe(true);
    expect(ties.some((t) => t.kin === 'progenitor')).toBe(true);
    expect(ties.some((t) => t.aff >= 30)).toBe(true);
    expect(ties.some((t) => t.aff < 0)).toBe(true);
    expect(folk.some((f) => f.p!.tier === 1) && folk.some((f) => f.p!.tier === 2)).toBe(true);
    // Desde el día 1 hay una historia en marcha con el comerciante del prólogo.
    const arc = life.society!.arcs[0];
    expect(arc).toBeTruthy();
    expect(arc.a).toBe(life.prologue!.merchant);
  });

  it('cien días sin el jugador: discuten, cuentan versiones, cambian de oficio, el pueblo habla, las familias se implican y se resuelve', () => {
    const w = world(502);
    const life = w.life!;
    const s = life.society!;
    const arc = s.arcs[0];
    const prices: number[] = [];
    const stock: number[] = [];
    const before = JSON.stringify(Object.values(s.ties).map((t) => Math.round(t.aff)));
    let versions: typeof s.rumors = [];
    for (let i = 0; i < 110; i++) {
      advanceDay(w);
      if (w.day === 22) versions = s.rumors.filter((r) => r.arc === arc.id && r.kind === 'version');
      const m = s.market[w.player.home];
      prices.push(m.price.comida);
      stock.push(Math.round(m.stock.comida));
    }
    // El conflicto ha recorrido sus etapas sin que nadie intervenga.
    expect(arc.log.find((l) => /discutieron/.test(l.text))!.day).toBeLessThanOrEqual(10);
    expect(arc.log.some((l) => /versión/.test(l.text))).toBe(true);
    expect(arc.log.some((l) => /pueblo habla/.test(l.text))).toBe(true);
    expect(arc.log.some((l) => /familia/i.test(l.text))).toBe(true);
    expect(arc.outcome).toBeTruthy();
    // Dos versiones distintas del mismo pleito circulan por el pueblo.
    expect(versions.length).toBe(2);
    expect(versions[0].versions[0]).not.toBe(versions[1].versions[0]);
    // Los rumores se deforman al pasar de boca en boca.
    expect(s.rumors.some((r) => Object.values(r.knownBy).some((v) => v > 0))).toBe(true);
    // El mundo no se ha congelado: acontecimientos variados, economía que se mueve, relaciones que cambian.
    const kinds = new Set(s.events.map((e) => e.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(6);
    expect(Math.max(...prices)).toBeGreaterThan(Math.min(...prices));
    expect(new Set(stock).size).toBeGreaterThan(5);
    expect(JSON.stringify(Object.values(s.ties).map((t) => Math.round(t.aff)))).not.toBe(before);
    expect(life.folk.some((f) => (f.p?.jobs.length ?? 0) > 1)).toBe(true);
  });

  it('el jugador puede intervenir: escuchar las dos versiones y mediar enfría el conflicto', () => {
    const w = world(503);
    const s = w.life!.society!;
    const arc = s.arcs[0];
    arc.stage = 2;
    const A = w.life!.folk.find((f) => f.id === arc.a)!;
    const B = w.life!.folk.find((f) => f.id === arc.b)!;
    const lucky = { chance: () => true, next: () => 0, range: (a: number) => a, int: (a: number) => a, pick: <T,>(x: T[]) => x[0] } as never;
    expect(arcChoices(w, A).map((c) => c.id)).toContain('escuchar');
    arcAct(w, A, 'escuchar', lucky, () => 2);
    arcAct(w, B, 'escuchar', lucky, () => 2);
    expect(arcChoices(w, A).map((c) => c.id)).toContain('mediar');
    const heat = arc.heat;
    const res = arcAct(w, A, 'mediar', lucky, () => 3);
    expect(arc.heat).toBeLessThan(heat);
    expect(res.rumor?.kind).toBe('p_media');
  });

  it('información imperfecta: cada uno cree su versión, y un recuerdo menor se olvida', () => {
    const w = world(504);
    const life = w.life!;
    const people = life.folk.filter((f) => f.alive && f.regionId === w.player.home);
    const [a, b] = people;
    const r = seedRumor(w, { regionId: w.player.home, kind: 'discusion', subject: a.id, target: b.id, witnesses: [a.id, b.id] });
    for (let i = 0; i < 15; i++) spreadRumors(w, new Rng(900 + i), w.player.home, people);
    expect(Object.keys(r.knownBy).length).toBeGreaterThan(3);
    const minor = memorize(w, people[2], { kind: 'charla', about: people[3].id, text: 'Charlamos.', w: 0.1, src: 'propio' })!;
    const grave = memorize(w, people[2], { kind: 'traicion', about: people[3].id, text: 'Me traicionó.', w: -0.9, src: 'propio' })!;
    for (let i = 0; i < 60; i++) fadeMemories(w, people[2]);
    expect(people[2].p!.mem.includes(minor)).toBe(false);
    expect(people[2].p!.mem.includes(grave)).toBe(true);
  });

  it('lo que hace el jugador se cuenta, y la familia viene a preguntarle', () => {
    const w = world(505);
    const life = w.life!;
    const f = life.folk.find((x) => x.alive && x.regionId === w.player.home && kinOf(w, x.id).some((k) => life.folk.find((o) => o.id === k.id)!.age >= 14))!;
    giveTo(w, f.id, 'comida'); // sin comida no da nada
    life.player.inventory.comida = 2;
    giveTo(w, f.id, 'comida');
    advanceDay(w);
    const s = life.society!;
    const rumor = s.rumors.find((r) => r.subject === 'jugador' && r.target === f.id);
    expect(rumor).toBeTruthy();
    expect(s.approaches.some((a) => a.kind === 'pariente' || a.kind === 'gracias')).toBe(true);
  });

  it('las conversaciones cambian con la vida de cada uno (precios, luto, ánimo)', () => {
    const w = world(506);
    const life = w.life!;
    const merchant = life.folk.find((f) => f.alive && f.role === 'comerciante' && f.regionId === w.player.home)!;
    const m = marketOf(w, w.player.home);
    m.stock.comida = 0;
    m.price.comida = 4;
    merchant.trust = 0.9;
    const lines = Array.from({ length: 6 }, () => talkToFolk(w, merchant.id).lines.join(' ')).join(' ');
    expect(lines).toMatch(/nubes|vuela|nada|carísimo|precio/);
    // Si alguien muere, su familia guarda luto y hay funeral.
    const dead = life.folk.find((f) => f.alive && f.regionId === w.player.home && kinOf(w, f.id).length)!;
    const kin = kinOf(w, dead.id)[0];
    dead.alive = false;
    mournDeaths(w, [dead]);
    const k = life.folk.find((f) => f.id === kin.id)!;
    expect(k.p!.mourning).toBeGreaterThan(w.day);
    expect(life.society!.festivals.some((x) => x.kind === 'funeral')).toBe(true);
    expect(routineOf(w, k, (w.day - 1) * 1440 + 4 * 60).activity).toMatch(/luto|despide|reza/);
  });

  it('el guardado conserva la sociedad', () => {
    const w = world(507);
    advanceDay(w);
    const back = importGame(exportGame(w))!;
    expect(Object.keys(back.life!.society!.ties).length).toBe(Object.keys(w.life!.society!.ties).length);
    expect(back.life!.folk[0].p!.t).toEqual(w.life!.folk[0].p!.t);
  });
});
