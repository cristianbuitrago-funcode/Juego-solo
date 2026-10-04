import { describe, expect, it } from 'vitest';
import { ACTIONS, performAction, type Params } from '../src/core/actions';
import { compareRumors, contradictions, formConclusion, proposeHypothesis } from '../src/core/api';
import { childrenOf } from '../src/core/chronicle';
import { createWorld } from '../src/core/gen/worldgen';
import { loadLegacy } from '../src/core/legacy';
import { Rng } from '../src/core/rng';
import { importGame, exportGame, loadGame, saveGame } from '../src/core/save';
import { advanceDay } from '../src/core/simulation';
import { MYSTERIES, setupMystery } from '../src/core/systems/mystery';
import type { WorldState } from '../src/core/types';
import { makeCtx, commitCtx, routeBetween } from '../src/core/world';

// btoa/atob existen en Node 18+.
const clone = (w: WorldState) => JSON.parse(JSON.stringify(w)) as WorldState;

function randomPlay(w: WorldState, seed: number, days: number): void {
  const rng = new Rng(seed);
  for (let d = 0; d < days && !w.ended; d++) {
    for (let i = 0; i < 2; i++) {
      const r = rng.pick(w.regions.filter((x) => !x.isHome));
      const id = rng.pick(Object.keys(ACTIONS));
      const def = ACTIONS[id];
      const p: Params = { region: r.id };
      if (def.target === 'par') {
        const nb = r.neighbors.filter((n) => !w.regions[n].isHome);
        if (!nb.length) continue;
        p.other = rng.pick(nb);
        p.kind = 'ataque';
      }
      if (def.target === 'ruta') p.route = rng.int(0, w.routes.length - 1);
      if (def.target === 'rumor') {
        const known = w.rumors.filter((x) => x.known);
        if (!known.length) continue;
        p.rumor = rng.pick(known).id;
        p.claim = rng.chance(0.5) ? 'cierto' : 'falso';
      }
      if (id === 'ley') (p.law = 'hospitalidad'), (p.value = 1);
      if (id === 'prioridad') p.priority = rng.pick(['comercio', 'seguridad', 'conocimiento', 'ecologia']);
      performAction(w, id, p);
    }
    for (const pet of [...w.petitions]) if (rng.chance(0.5)) performAction(w, pet.choices[0].action, pet.choices[0].params);
    advanceDay(w);
  }
}

describe('generación procedural', () => {
  it('es determinista para una misma semilla', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    for (let i = 0; i < 20; i++) (advanceDay(a), advanceDay(b));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('genera mundos distintos con semillas distintas', () => {
    const a = createWorld(1);
    const b = createWorld(2);
    expect(a.regions.map((r) => r.name)).not.toEqual(b.regions.map((r) => r.name));
  });

  it('crea un mapa conectado con hogar, rutas, personajes y objetivos', () => {
    for (const seed of [3, 17, 99, 1234]) {
      const w = createWorld(seed);
      expect(w.regions.length).toBeGreaterThanOrEqual(6);
      expect(w.regions.filter((r) => r.isHome)).toHaveLength(1);
      // Conectividad.
      const seen = new Set([0]);
      const stack = [0];
      while (stack.length) for (const n of w.regions[stack.pop()!].neighbors) if (!seen.has(n)) (seen.add(n), stack.push(n));
      expect(seen.size).toBe(w.regions.length);
      expect(w.routes.length).toBeGreaterThan(0);
      expect(w.characters.length).toBeGreaterThan(w.regions.length);
      expect(w.objectives.filter((o) => !o.hidden).length).toBe(3);
    }
  });
});

describe('información incompleta', () => {
  it('nunca expone cifras en lo que sabe el jugador', () => {
    const w = createWorld(7);
    randomPlay(w, 7, 25);
    for (const intel of Object.values(w.intel)) for (const f of Object.values(intel.facts)) expect(f!.value).not.toMatch(/\d/);
    for (const c of w.clues) expect(c.text).not.toMatch(/\d/);
  });

  it('empieza sabiendo poco de las regiones lejanas', () => {
    const w = createWorld(11);
    const unknown = Object.values(w.intel).filter((i) => i.level === 0).length;
    expect(unknown).toBeGreaterThan(0);
  });
});

describe('memoria y consecuencias en cadena', () => {
  it('cerrar una ruta registra la decisión y encadena consecuencias', () => {
    const w = createWorld(5);
    const home = w.player.home;
    const route = w.routes.find((r) => r.a === home || r.b === home)!;
    route.traffic = 0.6;
    const res = performAction(w, 'cerrarRuta', { route: route.id });
    expect(res.ok).toBe(true);
    const action = w.entries.find((e) => e.byPlayer && e.text.startsWith('Cerraste'))!;
    expect(action).toBeDefined();
    expect(route.closedCause).toBe(action.id);
    for (let i = 0; i < 25; i++) advanceDay(w);
    const other = w.regions[route.a === home ? route.b : route.a];
    const remembered = w.characters.filter((c) => c.regionId === other.id && c.memories.some((m) => m.kind === 'rutaCerrada'));
    expect(remembered.length).toBeGreaterThan(0);
    // Hay al menos una consecuencia enlazada a la decisión.
    expect(childrenOf(w, action.id).length).toBeGreaterThan(0);
  });

  it('los personajes recuerdan la ayuda y cambian sus emociones', () => {
    const w = createWorld(8);
    const target = w.regions.find((r) => !r.isHome)!;
    const leader = w.characters.find((c) => c.regionId === target.id)!;
    const before = leader.emotions.gratitude;
    performAction(w, 'ayuda', { region: target.id });
    // La caravana tarda en llegar: el recuerdo nace cuando llega.
    for (let i = 0; i < 3; i++) advanceDay(w);
    expect(leader.memories.some((m) => m.kind === 'ayuda')).toBe(true);
    expect(leader.emotions.gratitude).toBeGreaterThan(before);
  });

  it('el mundo aprende patrones repetidos', () => {
    const w = createWorld(9);
    w.player.reserves = 100;
    const targets = w.regions.filter((r) => !r.isHome);
    for (let i = 0; i < 5; i++) performAction(w, 'ayuda', { region: targets[i % targets.length].id });
    expect(w.entries.some((e) => e.text.startsWith('El mundo aprende que repartes ayuda'))).toBe(true);
  });

  it('las consecuencias retardadas llegan días después', () => {
    const w = createWorld(10);
    const home = w.player.home;
    const nb = w.regions[home].neighbors.find((n) => routeBetween(w, home, n))!;
    performAction(w, 'explotar', { region: nb });
    expect(w.regions[nb].flags.explotada).toBeDefined();
    expect(w.scheduled.some((s) => s.kind === 'finExplotacion')).toBe(true);
    for (let i = 0; i < 11; i++) advanceDay(w);
    expect(w.regions[nb].flags.explotada).toBeUndefined();
  });
});

describe('hipótesis', () => {
  it('se evalúan al vencer el plazo', () => {
    const w = createWorld(12);
    const r = w.regions.find((x) => !x.isHome)!;
    proposeHypothesis(w, { kind: 'metrica', regionId: r.id, metric: 'alimento', direction: 'sube', days: 3 });
    for (let i = 0; i < 3; i++) advanceDay(w);
    const h = w.hypotheses[0];
    expect(['correcta', 'parcial', 'incorrecta']).toContain(h.result);
    expect(h.explanation).toBeTruthy();
  });

  it('la caravana llega días después y puede verse como una provocación', () => {
    const w = createWorld(14);
    const r = w.regions.find((x) => !x.isHome && x.neighbors.some((n) => !w.regions[n].isHome))!;
    const before = r.food;
    performAction(w, 'ayuda', { region: r.id, amount: 20 });
    expect(r.food).toBe(before);
    for (let i = 0; i < 4; i++) advanceDay(w);
    expect(w.entries.some((e) => e.text.startsWith(`Tu caravana llegó a ${r.name}`))).toBe(true);
  });

  it('una ayuda grande hace correcta la hipótesis de que el alimento sube', () => {
    const w = createWorld(13);
    const r = w.regions.find((x) => !x.isHome)!;
    const baseline = r.food;
    performAction(w, 'ayuda', { region: r.id });
    proposeHypothesis(w, { kind: 'metrica', regionId: r.id, metric: 'alimento', direction: 'sube', days: 3, baseline });
    for (let i = 0; i < 3; i++) advanceDay(w);
    expect(w.hypotheses[0].result).not.toBe('incorrecta');
  });
});

describe('misterios y objetivos', () => {
  for (const kind of Object.keys(MYSTERIES)) {
    it(`el misterio «${kind}» funciona durante una era completa`, () => {
      const w = createWorld(20 + kind.length);
      const ctx = makeCtx(w);
      w.mystery = { kind: 'ninguno', culpritRegion: -1, fragmentsFound: [], solved: false, failedGuesses: 0, nextGuessDay: 0, triggerDay: 0, revealed: false };
      setupMystery(ctx, kind);
      commitCtx(ctx);
      randomPlay(w, 3, 60);
      expect(w.ended).toBe(true);
    });
  }

  it('una conclusión correcta resuelve el misterio', () => {
    const w = createWorld(31);
    w.mystery.fragmentsFound = ['a', 'b', 'c'];
    const correct = MYSTERIES[w.mystery.kind].correct(w);
    expect(formConclusion(w, correct)).toBe('correcta');
    expect(w.mystery.solved).toBe(true);
  });

  it('una conclusión sin indicios suficientes se rechaza', () => {
    const w = createWorld(32);
    expect(formConclusion(w, 'x')).toBe('insuficiente');
  });
});

describe('información como recurso', () => {
  it('detecta testimonios cruzados y permite compararlos', () => {
    const w = createWorld(40);
    const ctx = makeCtx(w);
    w.mystery.kind = 'manipulador';
    const a = w.regions.find((r) => !r.isHome && r.neighbors.some((n) => !w.regions[n].isHome))!;
    const b = w.regions[a.neighbors.find((n) => !w.regions[n].isHome)!];
    commitCtx(ctx);
    w.rumors.push(
      { id: 'rx', day: w.day, kind: 'ataque', about: b.id, target: a.id, heardIn: a.id, text: 't1', truth: false, origin: 'manipulador', believers: [a.id], investigated: false, known: true, expires: 99 },
      { id: 'ry', day: w.day, kind: 'ataque', about: a.id, target: b.id, heardIn: b.id, text: 't2', truth: false, origin: 'manipulador', believers: [b.id], investigated: false, known: true, expires: 99 },
    );
    expect(contradictions(w)).toHaveLength(1);
    compareRumors(w, 'rx', 'ry');
    expect(w.mystery.fragmentsFound).toContain('m_cruzados');
  });
});

describe('guardado', () => {
  it('guardar y cargar conserva la partida y su futuro', () => {
    const w = createWorld(50);
    randomPlay(w, 50, 10);
    saveGame(w, 'ranura1');
    const loaded = loadGame('ranura1')!;
    const copy = clone(w);
    for (let i = 0; i < 10; i++) (advanceDay(loaded), advanceDay(copy));
    expect(JSON.stringify(loaded)).toEqual(JSON.stringify(copy));
  });

  it('exportar e importar como texto', () => {
    const w = createWorld(51);
    const back = importGame(exportGame(w));
    expect(back?.seed).toBe(51);
  });
});

describe('legado entre partidas', () => {
  it('al terminar la era se guarda un legado', () => {
    const before = loadLegacy().games;
    const w = createWorld(60, { eraLength: 15 });
    while (!w.ended) advanceDay(w);
    expect(loadLegacy().games).toBe(before + 1);
  });
});
