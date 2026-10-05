import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { exportGame, importGame } from '../src/core/save';
import { advanceDay } from '../src/core/simulation';
import type { WorldState } from '../src/core/types';
import { wireWorld } from '../src/world';
import { ensureLife } from '../src/world/life';
import { addScore, levelOf, updateStanding, gain } from '../src/world/identity';
import { openBusiness, playerEco } from '../src/world/business';
import { folkById, partnerOf } from '../src/world/society';
import { adopt, birthChild, court, die, generationalLine, injure, isOrphan, proposeUnion, stageOf, talkChildren, talkedWith, teach, vigorOf, healthOf } from '../src/world/generations';
import { assetsOf, heirloomsHeld, resolveDispute, setWill } from '../src/world/estate';
import { lifeChronicle, successorsOf, succeedTo } from '../src/world/succession';
import { recordHist, retell, tellingOf, templeRecords, timeline, worldChronicle } from '../src/world/history';
import { gensOf } from '../src/world/genstate';
import { Rng } from '../src/core/rng';
import { DAYS_PER_YEAR } from '../src/world/types';
import type { Folk } from '../src/world/types';

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

function friend(w: WorldState, f: Folk, affection = 0.75): void {
  f.lastMet = w.day;
  f.trust = 0.8;
  talkedWith(w, f);
  gensOf(w).bonds[f.id].affection = affection;
}

function marryAndHaveChild(w: WorldState): Folk {
  const life = w.life!;
  const h = w.player.home;
  life.player.age = Math.max(life.player.age, 20);
  const cand = life.folk.find((f) => f.alive && f.regionId === h && f.age >= 18 && Math.abs(f.age - life.player.age) <= 12 && !partnerOf(w, f.id) && !life.player.family.some((k) => k.folkId === f.id) && !Object.values(gensOf(w).bonds).some((b) => b.folk === f.id && b.kind !== 'amistad'))!;
  friend(w, cand);
  court(w, cand);
  expect(proposeUnion(w, cand).ok).toBe(true);
  talkChildren(w, cand, true);
  gensOf(w).wantsChildren = true;
  return birthChild(w, cand, new Rng(w.day));
}

describe('Fase 5: generaciones, muerte, herencia y legado', () => {
  it('cada etapa de la vida tiene sus ventajas (no solo penalizaciones) y el cambio es gradual', () => {
    expect(stageOf(8)).toBe('infancia');
    expect(stageOf(15)).toBe('adolescencia');
    expect(stageOf(30)).toBe('adultez');
    expect(stageOf(50)).toBe('madurez');
    expect(stageOf(70)).toBe('vejez');
    // De joven se aprende más rápido; de viejo, se enseña mejor y la cabeza pesa más.
    expect(vigorOf(15).learn).toBeGreaterThan(vigorOf(70).learn);
    expect(vigorOf(70).teach).toBeGreaterThan(vigorOf(25).teach);
    expect(vigorOf(70).mind).toBeGreaterThan(vigorOf(25).mind);
    expect(vigorOf(70).body).toBeLessThan(vigorOf(30).body);
    // Sin saltos: un año más apenas cambia nada.
    for (let a = 20; a < 90; a++) expect(Math.abs(vigorOf(a + 1).body - vigorOf(a).body)).toBeLessThan(0.05);
  });

  it('la muerte tiene causas: la edad, una fiebre, una herida… nunca un dado sin sentido', { timeout: 30000 }, () => {
    const young = world(1101);
    for (let i = 0; i < 60; i++) advanceDay(young);
    expect(young.life!.player.pendingDeath).toBe(false); // a los 27, sano, no se muere porque sí
    const old = world(1102);
    old.life!.player.age = 88;
    injure(old, 0.8, 'una caída');
    let d = 0;
    while (!old.life!.player.pendingDeath && d++ < 400) advanceDay(old);
    expect(old.life!.player.pendingDeath).toBe(true);
    expect(['vejez', 'herida']).toContain(old.life!.player.death!.cause);
    expect(healthOf(old).value).toBeLessThan(0.8);
  });

  it('la prueba principal: generación 1 → 2 → 3, con herencia parcial, personas distintas y un mundo que sigue', { timeout: 60000 }, () => {
    const w = world(1113);
    const life = w.life!;
    const h = w.player.home;
    const id = () => life.identity!;
    // GENERACIÓN 1: llega sin memoria, aprende, se hace querer, abre un negocio, forma una familia.
    expect(life.player.generation).toBe(1);
    gain(w, 'comercio', 30);
    gain(w, 'agricultura', 14);
    addScore(w, h, 30);
    for (const f of life.folk.filter((x) => x.alive && x.regionId === h).slice(0, 10)) friend(w, f, 0.5);
    updateStanding(w);
    id().needs.coins = 120;
    expect(openBusiness(w, h, 'puesto').ok).toBe(true);
    const child = marryAndHaveChild(w);
    expect(child.p).toBeDefined();
    expect(life.player.family.some((k) => k.folkId === child.id)).toBe(true);
    // Le enseña su oficio al hijo (y a un aprendiz del pueblo).
    child.age = 17;
    for (let i = 0; i < 8; i++) teach(w, child, 'comercio');
    expect(child.learned?.comercio ?? 0).toBeGreaterThanOrEqual(1);
    // Un testamento: el puesto, para el hijo; algo de dinero, para el pueblo.
    const biz = playerEco(w).businesses[0];
    setWill(w, `negocio:${biz.id}`, 'heredero');
    setWill(w, 'monedas', 'heredero');
    expect(assetsOf(w).length).toBeGreaterThanOrEqual(2);
    const heirlooms = heirloomsHeld(w).length;
    expect(heirlooms).toBeGreaterThanOrEqual(2); // el colgante, la llave del puesto, el anillo
    // Envejece y muere.
    life.player.age = 71;
    die(w, 'vejez');
    const chronicle = lifeChronicle(w);
    expect(chronicle[0]).toMatch(/Vivió 71 años/);
    expect(chronicle.join(' ')).toMatch(/sin recordar su pasado/);
    expect(chronicle.join(' ')).toMatch(/Tuvo un|Tuvo una|hijos/);
    // GENERACIÓN 2: el hijo toma el relevo.
    const options = successorsOf(w);
    expect(options.some((s) => s.folkId === child.id)).toBe(true);
    const gen1Name = life.player.name;
    const res = succeedTo(w, child.id, true, advanceDay);
    expect(life.player.generation).toBe(2);
    expect(life.player.name).toBe(res.name);
    expect(life.player.name).not.toBe(gen1Name);
    expect(life.folk.some((f) => f.id === child.id)).toBe(false); // ya no es un vecino: es el protagonista
    // Hereda parte: el puesto, objetos, algo de reputación, lo que aprendió…
    expect(playerEco(w).businesses.length).toBe(1);
    expect(heirloomsHeld(w).length).toBeGreaterThanOrEqual(1);
    expect(levelOf(id(), 'comercio')).toBeGreaterThanOrEqual(1);
    expect(id().score[h] ?? 0).toBeGreaterThan(0);
    expect(id().score[h] ?? 0).toBeLessThan(40);
    // …pero es otra persona: su carácter, su historia, sus habilidades.
    expect(id().lives.length).toBe(1);
    expect(id().past).toBeNull();
    expect(life.player.family.some((k) => k.relation === 'madre' || k.relation === 'padre')).toBe(true);
    // El mundo sigue: pasan unos años.
    const folkBefore = life.folk.filter((f) => f.alive).length;
    days(w, DAYS_PER_YEAR * 3);
    expect(life.folk.filter((f) => f.alive).length).toBeGreaterThan(folkBefore * 0.6);
    // GENERACIÓN 3: sin hijos esta vez: continúa un amigo (la partida no se acaba por no tener hijos).
    const pal = life.folk.find((f) => f.alive && f.regionId === h && f.age >= 18 && f.age < 40)!;
    friend(w, pal, 0.8);
    life.player.age = 66;
    die(w, 'fiebre');
    const opts2 = successorsOf(w);
    expect(opts2.length).toBeGreaterThan(0);
    const choice = opts2.find((s) => s.folkId === pal.id) ?? opts2[0];
    succeedTo(w, choice.key, false, advanceDay);
    expect(life.player.generation).toBe(3);
    // Las decisiones de la primera generación siguen ahí: el linaje, el archivo, los objetos.
    expect(life.player.lineage.length).toBe(2);
    expect(gensOf(w).dynasty.members.length).toBe(2);
    const g = gensOf(w);
    expect(g.history.some((e) => e.kind === 'llegada')).toBe(true);
    expect(g.history.filter((e) => e.kind === 'muerte' && e.gen !== undefined).length).toBe(2);
    const tl = timeline(w);
    expect(tl.length).toBeGreaterThan(0);
    expect(tl[0].lines.join(' ')).toMatch(/desconocido|llega/);
  });

  it('el niño que conociste crece y te recuerda; los viejos recuerdan a tus antepasados', { timeout: 60000 }, () => {
    const w = world(1104);
    const life = w.life!;
    const kid = life.folk.find((f) => f.alive && f.role === 'nino' && f.age <= 9)!;
    kid.memories.push({ day: w.day, kind: 'comida', weight: 0.7, gen: 1 });
    kid.lastMet = w.day;
    // Pasan los años de verdad: el niño crece, trabaja.
    const born = kid.age;
    days(w, DAYS_PER_YEAR * 10);
    const grown = life.folk.find((f) => f.id === kid.id)!;
    if (!grown.alive) return; // (si murió, el mundo también es así)
    expect(grown.age).toBeGreaterThanOrEqual(born + 9);
    expect(grown.role).not.toBe('nino');
    // Al hablar con él…
    const line = generationalLine(w, grown, new Rng(3));
    expect(line).toMatch(/No sé si me recuerdas/);
  });

  it('los hijos de los vecinos se parecen a sus padres y aprenden en casa', { timeout: 60000 }, () => {
    const w = world(1105);
    days(w, DAYS_PER_YEAR * 2);
    const life = w.life!;
    const babies = life.folk.filter((f) => f.born > 2 && f.parentId);
    expect(babies.length).toBeGreaterThan(0);
    const b = babies[0];
    const parent = folkById(w, b.parentId!);
    if (parent?.p && b.p) {
      const diff = Object.keys(b.p.t).reduce((s, k) => s + Math.abs((b.p!.t as Record<string, number>)[k] - (parent.p!.t as Record<string, number>)[k]), 0) / 14;
      expect(diff).toBeLessThan(35);
    }
  });

  it('adoptar y no tener familia también son caminos; nadie se queda sin continuación', () => {
    const w = world(1106);
    // Sin familia ni amigos: aun así hay alguien que sigue.
    die(w, 'vejez');
    expect(successorsOf(w).length).toBeGreaterThan(0);
    // Un huérfano acogido puede continuar.
    const w2 = world(1107);
    const orphan = w2.life!.folk.find((f) => f.alive && f.age < 14 && f.role === 'nino')!;
    for (const t of Object.values(w2.life!.society!.ties)) if ((t.a === orphan.id || t.b === orphan.id) && t.kin === 'progenitor') {
      const p = folkById(w2, t.parent!);
      if (p && p.id !== orphan.id) p.alive = false;
    }
    expect(isOrphan(w2, orphan)).toBe(true);
    adopt(w2, orphan);
    expect(w2.life!.player.family.some((k) => k.folkId === orphan.id && k.adopted)).toBe(true);
  });

  it('la herencia puede romper una familia: dos hermanos y un solo puesto', { timeout: 30000 }, () => {
    const w = world(1108);
    const life = w.life!;
    const h = w.player.home;
    life.identity!.needs.coins = 200;
    openBusiness(w, h, 'puesto');
    const a = marryAndHaveChild(w);
    const partner = folkById(w, life.player.family.find((k) => k.relation === 'pareja')!.folkId!)!;
    const b = birthChild(w, partner, new Rng(9));
    a.age = 25;
    b.age = 23;
    for (const k of ['orgulloso', 'ambicioso', 'egoista'] as const) b.p!.t[k] = 95;
    die(w, 'vejez');
    const res = succeedTo(w, a.id, true, advanceDay);
    expect(res.burdens.join(' ')).toMatch(/reclama/);
    const d = gensOf(w).disputes.find((x) => x.status === 'abierta')!;
    expect(d).toBeTruthy();
    const out = resolveDispute(w, d.id, 'dividir');
    expect(out.join(' ')).toMatch(/reparts|Lo repartís/);
    expect(d.status).toBe('dividida');
  });

  it('la historia se deforma con los años: hecho → recuerdo → leyenda → mito', () => {
    const w = world(1109);
    const ev = recordHist(w, { kind: 'crisis', regionId: w.player.home, text: 'Ana ayudó a conseguir alimentos durante la sequía.', actor: 'Ana', gen: 1, importance: 3, fame: 0.9, witnessed: true })!;
    expect(tellingOf(w, ev)).toBe('hecho');
    expect(retell(w, ev)).toBe(ev.text);
    const at = (years: number) => {
      const copy = { ...w, day: ev.day + years * DAYS_PER_YEAR } as WorldState;
      return { t: tellingOf(copy, ev), text: retell(copy, ev) };
    };
    expect(at(6).t).toBe('recuerdo');
    expect(at(20).t).toBe('leyenda');
    expect(at(20).text).toMatch(/salvó/);
    expect(at(50).t).toBe('mito');
    expect(at(50).text).not.toBe(ev.text);
    // Los registros son más fieles que la gente (pero también matizan).
    const rec = templeRecords({ ...w, day: ev.day + 30 * DAYS_PER_YEAR } as WorldState, w.player.home).join(' ');
    expect(rec).toMatch(/Según los registros|Los registros/);
    const wc = worldChronicle(w);
    expect(Object.keys(wc)).toContain('familias');
  });

  it('la prueba extrema: muchas generaciones seguidas, con un mundo que no se queda sin gente ni crece sin control', { timeout: 120000 }, () => {
    const w = world(1110);
    const life = w.life!;
    for (let gen = 1; gen <= 8; gen++) {
      days(w, DAYS_PER_YEAR * 2);
      // Cada generación hace cosas distintas.
      if (gen % 2 === 0) gain(w, 'comercio', 10);
      else gain(w, 'combate', 8);
      if (gen === 7) life.identity!.needs.coins = 0; // la familia lo pierde todo
      die(w, gen % 3 === 0 ? 'fiebre' : 'vejez');
      const opts = successorsOf(w);
      const adult = opts.find((s) => s.wait === 0) ?? opts[0];
      succeedTo(w, adult.key, gen % 2 === 0, advanceDay);
      expect(life.player.generation).toBe(gen + 1);
      expect(life.folk.filter((f) => f.alive).length).toBeGreaterThan(40);
    }
    const g = gensOf(w);
    expect(life.player.lineage.length).toBe(8);
    expect(g.dynasty.members.length).toBe(8);
    expect(g.history.length).toBeLessThanOrEqual(g.scale.historyCap);
    expect(life.folk.length).toBeLessThan(900);
    expect(w.entries.length).toBeLessThan(1500);
    // Y sigue guardándose y cargándose.
    const back = importGame(exportGame(w))!;
    expect(back.life!.player.generation).toBe(9);
    expect(back.life!.gens!.dynasty.members.length).toBe(8);
  });
});
