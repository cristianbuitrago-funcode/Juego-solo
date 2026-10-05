import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/gen/worldgen';
import { exportGame, importGame } from '../src/core/save';
import { advanceDay } from '../src/core/simulation';
import { startWar } from '../src/core/systems/conflict';
import type { WorldState } from '../src/core/types';
import { commitCtx, makeCtx } from '../src/core/world';
import { wireWorld } from '../src/world';
import { ensureLife } from '../src/world/life';
import { addScore, updateStanding } from '../src/world/identity';
import { playerEco } from '../src/world/business';
import { FOODS, marketOf } from '../src/world/economy';
import { folkById } from '../src/world/society';
import { completeTask, joinOrg, offerTask, orgsOf, repOf } from '../src/world/orgs';
import { canPropose, changeGov, declareCandidacy, ensurePolitics, govOf, leanOf, lobby, playerPropose, playerSeat, politicsDay, propose, setLaw, tally, topScale, votersOf } from '../src/world/politics';
import { influenceLevel, powerOf } from '../src/world/influence';
import { negotiate, relOf, stanceOf, treatiesOf } from '../src/world/diplomacy';
import { pry, useSecret } from '../src/world/intrigue';
import { activeWars, enlist, mediationAgreed, warDay } from '../src/world/war';
import { makeForecast } from '../src/world/forecast';
import { inheritance } from '../src/world/legacy';
import { polOf, SCALES } from '../src/world/polstate';
import { Rng } from '../src/core/rng';

wireWorld();

function world(seed: number): WorldState {
  const w = createWorld(seed, { eraLength: 0 });
  ensureLife(w);
  advanceDay(w);
  ensurePolitics(w);
  return w;
}

/** El jugador se da a conocer: trabaja, ayuda, habla (lo que harían días de juego). */
function befriend(w: WorldState, regionId: number, n: number, trust = 0.72): void {
  const folk = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.age >= 16).slice(0, n);
  for (const f of folk) {
    f.lastMet = w.day;
    f.trust = trust;
    f.gratitude = 0.3;
  }
  addScore(w, regionId, 12);
  updateStanding(w);
}

describe('Fase 4: política, influencia y consecuencias', () => {
  it('el jugador no empieza con poder: ni asiento, ni grupo, ni nadie que le escuche', () => {
    const w = world(901);
    const h = w.player.home;
    expect(influenceLevel(w)).toBe(0);
    expect(Object.values(powerOf(w)).every((v) => v < 0.15)).toBe(true);
    expect(playerSeat(w, h)).toBe(false);
    expect(canPropose(w, h).ok).toBe(false);
    // Pero el mundo ya tiene su política: gobiernos distintos, grupos con miembros, leyes.
    const systems = new Set(w.regions.map((r) => govOf(w, r.id).system));
    expect(systems.size).toBeGreaterThan(1);
    const orgs = orgsOf(w, h);
    expect(orgs.length).toBeGreaterThanOrEqual(4);
    expect(orgs.every((o) => o.members.length > 0 && o.leader)).toBe(true);
  });

  it('la prueba del punto 40: reputación → influencia → grupo → decisión → ley → consecuencia → diplomacia → conflicto → poder', { timeout: 30000 }, () => {
    const w = world(902);
    const h = w.player.home;
    const id = w.life!.identity!;
    const pe = playerEco(w);
    // 1) Construir reputación.
    befriend(w, h, 8);
    expect(id.standing[h]).toBeGreaterThanOrEqual(2);
    // 2) Obtener influencia (sin cargo alguno).
    expect(influenceLevel(w)).toBeGreaterThanOrEqual(1);
    // 3) Entrar en una organización: ayudar, cumplir encargos, ser invitado.
    const farmers = orgsOf(w, h).find((o) => o.kind === 'agricultores' || o.kind === 'comunidad')!;
    for (let i = 0; i < 3 && farmers.player.rank < 2; i++) {
      const t = offerTask(w, farmers)!;
      if (t.kind === 'entregar') pe.cargo[t.good!] = (pe.cargo[t.good!] ?? 0) + t.n!;
      if (t.kind === 'aportar') id.needs.coins += t.n!;
      if (t.kind === 'convencer') {
        farmers.player.task = undefined;
        continue;
      }
      expect(completeTask(w, farmers).ok).toBe(true);
      const inv = polOf(w).offers.find((o) => o.kind === 'miembro' && o.orgId === farmers.id);
      if (inv) joinOrg(w, farmers);
    }
    if (farmers.player.rank < 2) joinOrg(w, farmers);
    expect(farmers.player.rank).toBe(2);
    expect(repOf(w, farmers)).toBeGreaterThan(0.2);
    expect(influenceLevel(w)).toBeGreaterThanOrEqual(2);
    // 4) Participar en una decisión: el grupo lleva su causa al consejo y el jugador convence a quienes votan.
    expect(canPropose(w, h).ok).toBe(true);
    const law = 'agricultura';
    const value = govOf(w, h).laws.agricultura === 'granero' ? 'libre' : 'granero';
    expect(playerPropose(w, h, law, value).ok).toBe(true);
    const p = polOf(w).proposals.find((x) => x.regionId === h && x.status === 'abierta' && x.law === law)!;
    for (const v of votersOf(w, p)) if (v.id !== 'jugador' && leanOf(w, v.id, p) <= 0) {
      lobby(w, v.id, p.id, 'favor');
      if (leanOf(w, v.id, p) <= 0) lobby(w, v.id, p.id, 'argumento');
      if (leanOf(w, v.id, p) <= 0) (polOf(w).favors[v.id] = 1), lobby(w, v.id, p.id, 'cobro');
    }
    expect(tally(w, p).yes).toBeGreaterThan(tally(w, p).no);
    for (let i = 0; i < 5 && p.status === 'abierta'; i++) advanceDay(w);
    // 5) Afectar una política.
    expect(p.status).toBe('aprobada');
    expect(govOf(w, h).laws[law]).toBe(value);
    expect(polOf(w).decisions.some((d) => d.scale === 'pueblo')).toBe(true);
    expect(polOf(w).legacy.some((l) => l.kind === 'ley')).toBe(true);
    // 6) Provocar o solucionar una consecuencia: el granero guarda y saca grano según la ley.
    if (value === 'granero') {
      const m = marketOf(w, h);
      for (const g of FOODS) m.stock[g] = g === 'trigo' ? 400 : 20;
      m.treasury = 60;
      politicsDay(w);
      expect(polOf(w).granary[h] ?? 0).toBeGreaterThan(0);
    }
    // 7) Participar en diplomacia: el pueblo le encarga negociar y firma un tratado.
    polOf(w).roles.push({ kind: 'diplomatico', regionId: h, since: w.day });
    const other = Number(Object.keys(w.regions[h].relations)[0]);
    relOf(w, other, h).opinion = 0.4;
    id.needs.coins = 80;
    let deal = negotiate(w, h, other, 'comercio', { coins: 20 });
    if (deal.status === 'contraoferta') deal = negotiate(w, h, other, 'comercio', { coins: 20 + (deal.ask?.coins ?? 0) });
    expect(deal.status).toBe('acepta');
    expect(treatiesOf(w, h).some((t) => t.kind === 'comercio' && t.by === 'jugador')).toBe(true);
    // 8) Influir en un conflicto: dos vecinos van a la guerra; el jugador media y la paz llega.
    const a = w.regions.find((r) => !r.isHome && r.neighbors.some((n) => !w.regions[n].isHome))!;
    const b = w.regions[a.neighbors.find((n) => !w.regions[n].isHome)!];
    const ctx = makeCtx(w);
    startWar(ctx, a, b);
    commitCtx(ctx);
    warDay(w, new Rng(1));
    const war = activeWars(w).find((x) => (x.a === a.id && x.b === b.id) || (x.a === b.id && x.b === a.id))!;
    expect(war).toBeTruthy();
    expect(stanceOf(w, a.id, b.id)).toBe('guerra');
    mediationAgreed(w, war, war.a);
    mediationAgreed(w, war, war.b);
    expect(war.status).toBe('terminada');
    expect(relOf(w, a.id, b.id).war).toBe(false);
    expect(treatiesOf(w).some((t) => t.kind === 'paz' && t.by === 'jugador')).toBe(true);
    // 9) Eventualmente, el poder: le eligen para gobernar.
    changeGov(w, h, 'alcalde', govOf(w, h).ruler, 'por una reforma');
    befriend(w, h, 30, 0.85);
    expect(declareCandidacy(w, h).ok).toBe(true);
    govOf(w, h).nextElection = w.day + 1;
    advanceDay(w);
    advanceDay(w);
    expect(govOf(w, h).ruler).toBe('jugador');
    expect(id.rank[h]).toBe(6);
    expect(influenceLevel(w)).toBe(5);
    // Las decisiones han ido de la persona al pueblo, a la región y a varios pueblos.
    expect(SCALES.indexOf(topScale(w))).toBeGreaterThanOrEqual(SCALES.indexOf('territorio'));
  });

  it('se puede ser poderoso sin gobernar: un mercador rico tiene influencia sin cargo', () => {
    const w = world(903);
    const h = w.player.home;
    befriend(w, h, 5);
    w.life!.identity!.needs.coins = 260;
    playerEco(w).vehicle = 'carreta';
    playerEco(w).businesses.push({ id: 'b1', kind: 'puesto', regionId: h, opened: w.day, cash: 10, stock: {}, workers: [], wage: 1, log: [] });
    const p = powerOf(w);
    expect(p.economico).toBeGreaterThan(0.8);
    expect(p.politico).toBe(0);
    expect(influenceLevel(w)).toBeGreaterThanOrEqual(2);
  });

  it('los sistemas de gobierno deciden de verdad de otra manera', () => {
    const w = world(904);
    const r = w.regions.find((x) => !x.isHome)!;
    const prop = propose(w, r.id, 'impuestos', govOf(w, r.id).laws.impuestos === 'alto' ? 'bajo' : 'alto', 'gobierno', 5)!;
    expect(prop).toBeTruthy();
    // Con señorío decide quien gobierna; en asamblea, todo el pueblo.
    changeGov(w, r.id, 'monarquia', govOf(w, r.id).ruler, '');
    const ruler = govOf(w, r.id).ruler!;
    prop.sway[ruler] = 5;
    const asMonarchy = tally(w, prop);
    expect(asMonarchy.yes).toBeGreaterThan(asMonarchy.no);
    changeGov(w, r.id, 'republica', ruler, '');
    const assembly = votersOf(w, prop);
    expect(assembly.length).toBeGreaterThan(5);
    for (const v of assembly) if (v.id !== ruler) prop.sway[v.id] = -2;
    const asRepublic = tally(w, prop);
    expect(asRepublic.no).toBeGreaterThan(asRepublic.yes);
    // La guardia en el poder no acepta bajar la seguridad.
    changeGov(w, r.id, 'militar', undefined, '');
    expect(govOf(w, r.id).laws.seguridad).toBe('alta');
    expect(propose(w, r.id, 'seguridad', 'baja', 'gobierno')).toBeNull();
  });

  it('las leyes tienen consecuencias en cadena: impuestos altos llenan las arcas y vacían los bolsillos de los comerciantes', { timeout: 30000 }, () => {
    const run = (tax: 'medio' | 'alto') => {
      const w = world(906);
      const h = w.player.home;
      setLaw(w, h, 'impuestos', tax);
      let treasury = 0;
      let wage = 0;
      for (let i = 0; i < 20; i++) {
        advanceDay(w);
        const m = marketOf(w, h);
        treasury += m.treasury;
        if (i >= 8) wage += m.wages.comerciante ?? 0;
      }
      return { w, h, treasury: treasury / 20, wage: wage / 12 };
    };
    const normal = run('medio');
    const high = run('alto');
    expect(high.treasury).toBeGreaterThan(normal.treasury);
    expect(high.wage).toBeLessThan(normal.wage);
    // Y alguien lo nota más tarde: la consecuencia se apunta cuando llega (si algo cambió).
    expect(polOf(high.w).delayed.length + polOf(high.w).log.filter((e) => e.kind === 'consecuencia').length).toBeGreaterThan(0);
  });

  it('el descontento lleva a protestas y, solo tras una cadena de causas, a la conspiración (que el jugador puede cortar)', { timeout: 30000 }, () => {
    const w = world(906);
    const r = w.regions.find((x) => !x.isHome && orgsOf(w, x.id).length >= 4)!;
    const g = govOf(w, r.id);
    const pol = polOf(w);
    const stages = new Set<number>();
    for (let i = 0; i < 40; i++) {
      g.legitimacy = 0.25;
      for (const o of orgsOf(w, r.id)) if (o.kind !== 'guardia' && o.kind !== 'clandestino') (o.discontent = 0.85), (o.hot = 5);
      politicsDay(w);
      stages.add(pol.rebellions[r.id]?.stage ?? 0);
      if ((pol.rebellions[r.id]?.stage ?? 0) >= 3) break;
      w.day++;
    }
    expect(stages.has(1)).toBe(true);
    expect(stages.has(2)).toBe(true);
    expect(pol.rebellions[r.id].stage).toBe(3);
    expect(pol.log.some((e) => e.regionId === r.id && ['protesta', 'huelga', 'boicot', 'motin', 'desobediencia'].includes(e.kind))).toBe(true);
    // La conspiración deja rastro en quien la conoce: preguntando, el jugador la descubre…
    const s = pol.secrets.find((x) => x.kind === 'conspiracion' && x.regionId === r.id)!;
    expect(s).toBeTruthy();
    s.suspected = true;
    w.life!.identity!.skills.investigacion.level = 4;
    for (const hid of s.holders) {
      const f = folkById(w, hid);
      if (!f) continue;
      f.trust = 0.95;
      f.honesty = 1;
      pry(w, f);
      if (s.known) break;
    }
    expect(s.known).toBe(true);
    // …y si avisa a quien gobierna, la conspiración se corta (con su precio).
    useSecret(w, s.id, 'advertir');
    expect(pol.rebellions[r.id].stage).toBe(0);
    expect(g.repression).toBeGreaterThan(0.2);
  });

  it('la información es poder: destapar a quien acapara baja los precios', () => {
    const w = world(907);
    const h = w.player.home;
    const m = marketOf(w, h);
    const merchant = w.life!.folk.find((f) => f.alive && f.regionId === h && f.role === 'comerciante')!;
    polOf(w).hoards[merchant.id] = { regionId: h, n: 30 };
    polOf(w).secrets.push({ id: 'sx', kind: 'acaparamiento', regionId: h, about: merchant.id, day: w.day, text: `${merchant.name} esconde comida.`, hint: 'Dicen que…', holders: [], testimonies: [], known: true, suspected: true, used: [], public: false, expires: w.day + 20 });
    const before = FOODS.reduce((s, g) => s + m.stock[g], 0);
    useSecret(w, 'sx', 'publicar');
    expect(FOODS.reduce((s, g) => s + m.stock[g], 0)).toBeGreaterThan(before + 20);
    expect(polOf(w).hoards[merchant.id]).toBeUndefined();
  });

  it('la guerra consume recursos de verdad: el ejército come del mercado y el jugador puede luchar', () => {
    const w = world(908);
    const a = w.regions.find((r) => !r.isHome && r.neighbors.some((n) => !w.regions[n].isHome))!;
    const b = w.regions[a.neighbors.find((n) => !w.regions[n].isHome)!];
    const ctx = makeCtx(w);
    startWar(ctx, a, b);
    commitCtx(ctx);
    warDay(w, new Rng(2));
    const war = activeWars(w)[0];
    const m = marketOf(w, war.a);
    const food = FOODS.reduce((s, g) => s + m.stock[g], 0);
    warDay(w, new Rng(3));
    expect(FOODS.reduce((s, g) => s + m.stock[g], 0)).toBeLessThan(food);
    const res = enlist(w, war, war.b);
    expect(res.lines.length).toBeGreaterThan(1);
    expect(war.battles.some((x) => x.player)).toBe(true);
    expect(war.playerSide).toBe(war.b);
  });

  it('las hipótesis se comprueban con el mundo real', () => {
    const w = world(909);
    const h = w.player.home;
    const f = makeForecast(w, { variable: 'precio', regionId: h, good: 'trigo', prediction: 'sube', due: w.day + 2 });
    marketOf(w, h).stock.trigo = 0;
    advanceDay(w);
    advanceDay(w);
    advanceDay(w);
    expect(f.result).toBeDefined();
    expect(['acierto', 'fallo', 'parcial', 'inesperado']).toContain(f.result);
  });

  it('la política se guarda, y queda preparado lo que heredaría quien venga después', () => {
    const w = world(910);
    advanceDay(w);
    const back = importGame(exportGame(w))!;
    expect(back.life!.politics!.orgs.length).toBe(w.life!.politics!.orgs.length);
    expect(Object.keys(back.life!.politics!.govs).length).toBe(w.regions.length);
    const inh = inheritance(back);
    expect(inh.property).toBeDefined();
    expect(Array.isArray(inh.history)).toBe(true);
  });
});
