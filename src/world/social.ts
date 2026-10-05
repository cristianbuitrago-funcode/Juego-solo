import { politicsDay } from './politics';
import { worldSince } from './epochs';
import { folkTurn, simTier } from './lod';
import { weatherIn } from './geography';
import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';

import { activeArcOf, arcDay, changeJob, startArc } from './arcs';
import { hourOf, seasonOf } from './clock';
import { economyDayFull, foodIndex, GOOD, GOODS, marketOf, prosperityDay, stallLook, type EconomyNotes, type Good } from './economy';
import { impactEcho, businessDay } from './business';
import { climateOf, nearTiles, startDrought } from './farming';
import { arrivals, careerDay, demographyDay, migrationDay } from './population';
import { convoyTick, tradeDay } from './trade';
import { DAYS_PER_YEAR, T } from './types';
import { ROLE_TITLE } from './folk';
import { learnFact, rumorsKnownBy, seedRumor, spreadRumors, versionsFor, type Approach } from './gossip';
import { getLayout } from './layout';
import { bond, compatibility, dropTie, ensurePeople, fadeMemories, ensureTie, folkById, kinOf, logEvent, memorize, NEEDS, other, partnerOf, playerRegion, societyOf, tieOf, tiesOf, trait, type Goal, type Plan } from './society';
import type { Folk, FolkRole } from './types';

/**
 * La vida del pueblo sin el jugador. Cada amanecer, en cada región:
 * economía → necesidades → emociones → relaciones → recuerdos que se apagan →
 * objetivos → acontecimientos (discusiones, bodas, robos, fiebres, viajes…) →
 * rumores → conflictos largos → lo que alguien querrá contarte.
 *
 * Simulación por distancia: la región en la que estás (y tu pueblo) se vive
 * con todo detalle; las que has visitado, con detalle medio; el resto, de
 * forma abstracta (economía, necesidades y lo muy importante). Al volver a un
 * pueblo, te ponen al día de lo que pasó mientras no estabas.
 */
export function societyDay(w: WorldState): void {
  const life = w.life!;
  ensurePeople(w);
  const s = societyOf(w);
  const rng = new Rng(w.seed ^ Math.imul(w.day, 0x2c1b3c6d) ^ 0x5eed);
  const here = playerRegion(w);
  const byRegion = new Map<number, Folk[]>();
  for (const f of life.folk) if (f.alive && f.p) (byRegion.get(f.regionId) ?? byRegion.set(f.regionId, []).get(f.regionId)!).push(f);
  for (const r of w.regions) {
    const people = byRegion.get(r.id) ?? [];
    if (!people.length) continue;
    const tier = simTier(w, r.id, here);
    const detail = tier === 1 ? 2 : tier === 2 ? 1 : 0;
    const eco = economyDayFull(w, r.id, people);
    chainsFromEconomy(w, rng, r.id, people, eco, detail);
    tradeDay(w, rng, r.id, people);
    demographyDay(w, r.id);
    prosperityDay(w, r.id, people);
    if (detail > 0 || rng.chance(0.3)) careerDay(w, rng, r.id, people);
    arrivals(w, rng, r.id);
    for (const f of people) {
      if (!folkTurn(w, tier, f.id)) continue;
      updateNeeds(w, f, people);
      updateEmotion(w, f);
      fadeAll(w, f);
      if (detail > 0 || f.p!.tier === 1) updateGoals(w, rng, f, people);
      f.p!.plans = f.p!.plans.filter((p) => p.day >= w.day);
      if (f.p!.away && f.p!.away.back <= w.day) comeBack(w, f);
    }
    if (detail > 0) mingle(w, rng, people, detail);
    autonomousEvents(w, rng, r.id, people, detail);
    if (detail > 0) spreadRumors(w, rng, r.id, people);
    for (const arc of s.arcs) if (arc.regionId === r.id) arcDay(w, rng, arc);
    maybeNewArc(w, rng, r.id, people, detail);
    if (detail === 2) planDay(w, rng, r.id, people);
  }
  migrationDay(w, rng);
  convoyTick(w);
  businessDay(w);
  climateDay(w, rng);
  // La política: grupos, leyes, votaciones, protestas, diplomacia, secretos y guerra (Fase 4).
  const pnews = politicsDay(w);
  if (pnews.length && life.identity) (life.identity.inbox ??= []).push(...[...new Set(pnews)].slice(0, 5));
  playerDeedsToRumors(w);
  if (here >= 0) makeApproaches(w, rng, here);
  s.lastSeen[here] = w.day;
  snapshot(w, here);
  s.approaches = s.approaches.filter((a) => a.until >= w.day);
  s.festivals = s.festivals.filter((x) => x.day >= w.day);
  for (const r of s.rumors) if (r.heat < 0.05 && w.day - r.day > 40) r.heat = 0;
  s.rumors = s.rumors.filter((r) => r.heat > 0 || w.day - r.day < 60);
}

// ---------------------------------------------------------------------------
// Necesidades y emociones
// ---------------------------------------------------------------------------
function updateNeeds(w: WorldState, f: Folk, people: Folk[]): void {
  const p = f.p!;
  const r = w.regions[f.regionId];
  const town = w.life!.towns[f.regionId];
  const n = p.needs;
  // Dinero: los ambiciosos nunca tienen bastante.
  const want = 6 + trait(f, 'ambicioso') / 6;
  n.dinero = clamp(n.dinero * 0.7 + clamp(p.coins / want) * 0.3);
  // Descanso: quien trabaja mucho se cansa; los perezosos lo notan antes.
  const works = f.role !== 'nino' && f.role !== 'anciano' && !(p.sick && p.sick >= w.day);
  const hours = works ? (r.flags.hambre && f.role === 'campesino' ? 12 : 9) : 4;
  n.descanso = clamp(n.descanso * 0.6 + clamp(1.25 - hours / 12 - trait(f, 'perezoso') / 400) * 0.4);
  // Seguridad: guerra, tensión y el propio miedo.
  const danger = (r.flags.guerra ? 0.6 : 0) + (r.militancy > 0.6 ? 0.15 : 0) + (r.flags.fiebre ? 0.2 : 0);
  n.seguridad = clamp(n.seguridad * 0.6 + clamp(1 - danger * (0.6 + trait(f, 'cobarde') / 150)) * 0.4);
  // Trabajo: tener oficio y que haga falta.
  const same = people.filter((o) => o.role === f.role).length;
  const glut = f.role === 'comerciante' ? same / Math.max(1, people.length / 6) : 1;
  n.trabajo = f.age < 14 || f.role === 'anciano' ? 0.8 : clamp(n.trabajo * 0.7 + clamp(1.15 - glut * 0.3 - (r.flags.sinComercio && f.role === 'comerciante' ? 0.6 : 0)) * 0.3);
  // Vivienda: casas quemadas o abandonadas.
  const burned = town?.burned.includes(f.house) ? 0.2 : 1;
  n.vivienda = clamp(n.vivienda * 0.7 + burned * 0.3);
  // Relaciones: cuánta gente le quiere, según lo sociable que sea.
  const love = tiesOf(w, f.id).reduce((s2, t) => s2 + Math.max(0, t.aff) * (t.kin ? 1.5 : 1) * (t.fam / 100), 0) / 100;
  const hate = tiesOf(w, f.id).reduce((s2, t) => s2 + Math.max(0, -t.aff) * (t.fam / 100), 0) / 100;
  const wants = 0.6 + trait(f, 'sociable') / 120;
  n.relaciones = clamp(n.relaciones * 0.7 + clamp((love - hate * 0.6) / wants) * 0.3);
  // Ocio: fiestas, charlas en la plaza.
  const party = societyOf(w).festivals.some((x) => x.regionId === f.regionId && x.day >= w.day - 1 && x.kind !== 'funeral');
  n.ocio = clamp(n.ocio * 0.75 + (party ? 1 : 0.35 + trait(f, 'reservado') / 300) * 0.25);
}

function updateEmotion(w: WorldState, f: Folk): void {
  const p = f.p!;
  const e = p.emo;
  const n = p.needs;
  const avg = NEEDS.reduce((s, k) => s + n[k], 0) / NEEDS.length;
  // Lo vivido hace poco (bueno o malo) tiñe el ánimo.
  let good = 0;
  let bad = 0;
  for (const m of p.mem) {
    if (w.day - m.day > 6) continue;
    if (m.w > 0) good += m.w * m.i;
    else bad += -m.w * m.i;
  }
  const mourning = p.mourning !== undefined && p.mourning >= w.day ? 0.5 : 0;
  const sick = p.sick !== undefined && p.sick >= w.day ? 0.25 : 0;
  const k = 0.45; // inercia: el ánimo cambia poco a poco
  const mix = (cur: number, target: number) => clamp(cur * k + target * (1 - k));
  e.felicidad = mix(e.felicidad, clamp(avg * 0.9 + good * 0.4 - bad * 0.3 - mourning + trait(f, 'amable') / 500 - 0.15));
  e.tristeza = mix(e.tristeza, clamp(mourning + (1 - n.relaciones) * 0.35 + bad * 0.25 + sick - good * 0.2));
  e.miedo = mix(e.miedo, clamp((1 - n.seguridad) * (0.6 + trait(f, 'cobarde') / 120) + (1 - n.comida) * 0.2 - trait(f, 'valiente') / 400));
  e.enojo = mix(e.enojo * 0.8, clamp(bad * 0.5 * (0.6 + trait(f, 'orgulloso') / 120) + (1 - n.comida) * 0.25 + (1 - n.dinero) * 0.1 - trait(f, 'amable') / 500));
  e.estres = mix(e.estres, clamp((1 - n.dinero) * (0.3 + trait(f, 'ambicioso') / 250) + (1 - n.trabajo) * 0.3 + (1 - n.descanso) * 0.3 + (1 - n.comida) * 0.2));
}

function fadeAll(w: WorldState, f: Folk): void {
  fadeMemories(w, f);
  // Redondeo: la partida guardada ocupa mucho menos y no cambia nada a la vista.
  const p = f.p!;
  for (const k of NEEDS) p.needs[k] = Math.round(p.needs[k] * 1000) / 1000;
  for (const k of Object.keys(p.emo) as (keyof typeof p.emo)[]) p.emo[k] = Math.round(p.emo[k] * 1000) / 1000;
  p.coins = Math.round(p.coins * 100) / 100;
  for (const m of p.mem) m.i = Math.round(m.i * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Relaciones: se tratan, se caen bien o mal, se olvidan
// ---------------------------------------------------------------------------
function mingle(w: WorldState, rng: Rng, people: Folk[], detail: number): void {
  for (const f of people) {
    if (f.p!.away && f.p!.away.back > w.day) continue;
    const meets = (1 + Math.floor(trait(f, 'sociable') / 40)) * (detail === 2 ? 1 : 0.5);
    const ties = tiesOf(w, f.id).filter((t) => people.some((o) => o.id === other(t, f.id)));
    for (let k = 0; k < meets; k++) {
      const t = ties.length && rng.chance(0.8) ? rng.weighted(ties, (x) => 5 + x.fam + (x.work ? 30 : 0) + (x.kin ? 40 : 0)) : undefined;
      const o = t ? folkById(w, other(t, f.id)) : rng.pick(people);
      if (!o || o === f) continue;
      const mood = (f.p!.emo.felicidad - f.p!.emo.enojo + o.p!.emo.felicidad - o.p!.emo.enojo) / 2;
      const d = compatibility(f, o) * 2.2 + mood * 2 + rng.range(-1.5, 1.5);
      bond(w, f.id, o.id, d, 1.2);
    }
  }
  // Lo que no se cuida se enfría: quien deja de tratarse se va olvidando.
  for (const f of people)
    for (const t of [...tiesOf(w, f.id)]) {
      if (t.a !== f.id) continue; // cada lazo una vez
      if (w.day - t.last > 8 && !t.kin) {
        t.fam = Math.max(0, t.fam - 0.4);
        if (Math.abs(t.aff) < 40) t.aff *= 0.995;
      }
      if (!t.kin && t.fam < 3 && Math.abs(t.aff) < 8) dropTie(w, t);
      else (t.aff = Math.round(t.aff * 10) / 10), (t.fam = Math.round(t.fam * 10) / 10);
    }
}

// ---------------------------------------------------------------------------
// Objetivos: lo que cada uno quiere de la vida
// ---------------------------------------------------------------------------
function updateGoals(w: WorldState, rng: Rng, f: Folk, people: Folk[]): void {
  const p = f.p!;
  const has = (k: Goal['kind']) => p.goals.some((g) => g.kind === k);
  const max = p.tier === 1 ? 2 : 1;
  const add = (g: Goal) => p.goals.length < max && !has(g.kind) && p.goals.push(g);
  if (f.age < 16) return;
  // Nuevos deseos.
  if (trait(f, 'ambicioso') > 65 && f.role !== 'comerciante' && f.role !== 'lider' && rng.chance(0.03)) add({ kind: 'puesto', since: w.day });
  if (trait(f, 'ambicioso') > 55 && p.needs.dinero < 0.5 && rng.chance(0.04)) add({ kind: 'ahorrar', since: w.day });
  if (!partnerOf(w, f.id) && f.age >= 19 && f.age < 50 && rng.chance(0.05)) {
    const crush = tiesOf(w, f.id).filter((t) => !t.kin && t.aff >= 35).map((t) => folkById(w, other(t, f.id))).find((o) => o && o.alive && !partnerOf(w, o.id) && o.age >= 18 && Math.abs(o.age - f.age) < 14);
    add({ kind: 'casarse', target: crush?.id, since: w.day });
  }
  if (p.needs.comida + p.needs.seguridad + p.needs.dinero < 1.1 && rng.chance(0.08)) add({ kind: 'mudarse', since: w.day });
  if (trait(f, 'curioso') > 70 && p.needs.trabajo < 0.5 && rng.chance(0.04)) add({ kind: 'aprender', since: w.day });
  const enemy = tiesOf(w, f.id).find((t) => t.aff <= -55);
  if (enemy && trait(f, 'orgulloso') > 60 && rng.chance(0.05)) add({ kind: 'venganza', target: other(enemy, f.id), since: w.day });
  if (enemy && trait(f, 'amable') > 65 && rng.chance(0.05)) add({ kind: 'reconciliarse', target: other(enemy, f.id), since: w.day });
  const sickKin = kinOf(w, f.id).map((k) => folkById(w, k.id)).find((o) => o?.p?.sick !== undefined && o.p.sick >= w.day);
  if (sickKin) add({ kind: 'cuidar', target: sickKin.id, since: w.day });
  // Cumplir (o abandonar) lo que quería.
  for (const g of [...p.goals]) {
    const drop = () => p.goals.splice(p.goals.indexOf(g), 1);
    if (w.day - g.since > 80) drop();
    else if (g.kind === 'puesto' && p.coins >= 30) {
      p.coins -= 20;
      const from = f.role;
      changeJob(w, f, 'comerciante', 'con lo que había ahorrado');
      logEvent(w, f.regionId, 'oficio', `${f.name}, que era ${ROLE_TITLE[from]}, ha abierto su propio puesto en el mercado.`, [f.id]);
      seedRumor(w, { regionId: f.regionId, kind: 'oficio', subject: f.id, witnesses: [f.id, ...kinOf(w, f.id).map((k) => k.id)], extra: { role: 'comerciante' } });
      drop();
    } else if (g.kind === 'ahorrar' && p.needs.dinero > 0.85) drop();
    else if (g.kind === 'cuidar' && (folkById(w, g.target ?? '')?.p?.sick ?? -1) < w.day) drop();
    else if (g.kind === 'aprender' && rng.chance(0.03)) {
      const to: FolkRole = rng.pick(people.some((o) => o.role === 'sanadora') ? ['carpintero', 'artesano', 'pescador'] : ['sanadora', 'carpintero', 'artesano']);
      if (to !== f.role) {
        changeJob(w, f, to, 'porque quería aprender algo nuevo');
        logEvent(w, f.regionId, 'oficio', `${f.name} ha empezado a aprender el oficio de ${ROLE_TITLE[to]}.`, [f.id]);
      }
      drop();
    } else if (g.kind === 'reconciliarse' && g.target && rng.chance(0.08)) {
      const o = folkById(w, g.target);
      if (o?.alive && o.regionId === f.regionId && trait(o, 'orgulloso') < 75) {
        bond(w, f.id, o.id, 40, 5);
        logEvent(w, f.regionId, 'reconciliacion', `${f.name} fue a buscar a ${o.name} para hacer las paces. Se les vio hablar un buen rato.`, [f.id, o.id]);
        seedRumor(w, { regionId: f.regionId, kind: 'reconciliacion', subject: f.id, target: o.id, witnesses: [f.id, o.id] });
      }
      drop();
    }
  }
}

// ---------------------------------------------------------------------------
// Acontecimientos que pasan solos
// ---------------------------------------------------------------------------
function autonomousEvents(w: WorldState, rng: Rng, regionId: number, people: Folk[], detail: number): void {
  const s = societyOf(w);
  const r = w.regions[regionId];
  const k = detail === 2 ? 1 : detail === 1 ? 0.5 : 0.2;
  const adults = people.filter((f) => f.age >= 16 && !(f.p!.away && f.p!.away.back > w.day));
  const v = getLayout(w).villages[regionId];
  const plaza = (salt: number) => ({ x: v.cx + 0.5 + Math.cos(salt) * (v.plazaR - 1.6), y: v.cy + 0.5 + Math.sin(salt) * (v.plazaR - 1.6) });
  const witnesses = (n: number) => people.filter(() => rng.chance(n)).map((f) => f.id);
  const hour = () => 9 + rng.int(0, 8);

  // Discusión: dos que se llevan mal (o que están de mal humor) chocan.
  if (adults.length > 3 && rng.chance(0.22 * k)) {
    const a = rng.weighted(adults, (f) => 0.2 + f.p!.emo.enojo + f.p!.emo.estres * 0.5)!;
    const ties = tiesOf(w, a.id).filter((t) => t.aff < 15 && t.fam > 10 && adults.some((o) => o.id === other(t, a.id)));
    const t = ties.length ? rng.pick(ties) : undefined;
    const b = t ? folkById(w, other(t, a.id)) : undefined;
    if (b && !activeArcOf(w, a.id)) {
      const fight = (t!.aff < -40 && a.p!.emo.enojo > 0.45 && trait(a, 'cobarde') < 55) || rng.chance(0.05);
      bond(w, a.id, b.id, fight ? -22 : -9, 2);
      const h = hour();
      const at = plaza(rng.range(0, 6.28));
      for (const [f, dx] of [[a, -0.55], [b, 0.55]] as const) f.p!.plans.push({ day: w.day, from: h, to: h + 1, x: at.x + dx, y: at.y, activity: fight ? `se pelea con ${f === a ? b.name : a.name}` : `discute con ${f === a ? b.name : a.name}`, with: f === a ? b.id : a.id });
      for (const f of [a, b]) memorize(w, f, { kind: fight ? 'pelea' : 'discusion', about: f === a ? b.id : a.id, text: fight ? 'Llegamos a las manos.' : 'Discutimos.', w: fight ? -0.55 : -0.25, src: 'propio' });
      logEvent(w, regionId, fight ? 'pelea' : 'discusion', fight ? `${a.name} y ${b.name} llegaron a las manos.` : `${a.name} y ${b.name} discutieron en la plaza.`, [a.id, b.id]);
      seedRumor(w, { regionId, kind: fight ? 'pelea' : 'discusion', subject: a.id, target: b.id, witnesses: [a.id, b.id, ...witnesses(0.25)] });
      if (fight && rng.chance(0.3)) b.p!.sick = w.day + rng.int(2, 4);
    }
  }
  // Amor: dos que se quieren empiezan a verse; si dura, boda.
  if (adults.length > 3 && rng.chance(0.08 * k)) {
    const singles = adults.filter((f) => !partnerOf(w, f.id) && f.age < 55 && f.role !== 'nino');
    const a = rng.pick(singles);
    const cand = a && tiesOf(w, a.id).filter((t) => !t.kin && t.aff >= 45 && t.fam >= 30).map((t) => folkById(w, other(t, a.id))).filter((o): o is Folk => !!o && o.alive && singles.includes(o) && Math.abs(o.age - a.age) < 15);
    const b = cand?.length ? rng.pick(cand) : undefined;
    if (a && b) {
      const t = ensureTie(w, a.id, b.id);
      const courting = (t as { court?: number }).court;
      if (courting === undefined) {
        (t as { court?: number }).court = w.day;
        bond(w, a.id, b.id, 8, 6);
        logEvent(w, regionId, 'pareja', `${a.name} y ${b.name} pasean juntos al atardecer.`, [a.id, b.id]);
        seedRumor(w, { regionId, kind: 'pareja', subject: a.id, target: b.id, witnesses: witnesses(0.2) });
      } else if (w.day - courting >= 6 && t.aff >= 55) {
        t.kin = 'pareja';
        t.aff = Math.min(100, t.aff + 15);
        b.house = a.house;
        s.festivals.push({ regionId, day: w.day, kind: 'boda', who: [a.id, b.id] });
        for (const f of [a, b]) memorize(w, f, { kind: 'boda', about: f === a ? b.id : a.id, text: 'Nos casamos.', w: 0.85, src: 'propio' }), (f.p!.emo.felicidad = 0.9), (f.p!.goals = f.p!.goals.filter((g) => g.kind !== 'casarse'));
        logEvent(w, regionId, 'boda', `${a.name} y ${b.name} se han casado. Hubo fiesta en la plaza hasta tarde.`, [a.id, b.id]);
        seedRumor(w, { regionId, kind: 'boda', subject: a.id, target: b.id, witnesses: people.map((f) => f.id) });
      }
    }
  }
  // Separación: parejas que ya no se soportan.
  for (const f of adults) {
    const pid = partnerOf(w, f.id);
    if (!pid || pid < f.id) continue;
    const t = tieOf(w, f.id, pid)!;
    if (t.aff < -20 && rng.chance(0.12 * k)) {
      const o = folkById(w, pid)!;
      t.kin = 'expareja';
      o.house = (o.house + 1) % Math.max(1, w.life!.towns[regionId]?.houses ?? 3);
      for (const x of [f, o]) memorize(w, x, { kind: 'separacion', about: x === f ? o.id : f.id, text: 'Lo dejamos.', w: -0.6, src: 'propio' });
      logEvent(w, regionId, 'separacion', `${f.name} y ${o.name} se han separado. ${o.name} se ha ido a otra casa.`, [f.id, o.id]);
      seedRumor(w, { regionId, kind: 'separacion', subject: f.id, target: o.id, witnesses: witnesses(0.2) });
    }
  }
  // Robo: alguien con hambre (y pocos escrúpulos) roba a quien tiene más.
  if (adults.length > 4 && rng.chance(0.06 * k + (marketOf(w, regionId).hungry > 2 ? 0.05 : 0))) {
    const thief = adults.find((f) => f.p!.needs.comida + f.p!.needs.dinero < 0.9 && f.honesty < 0.75 && trait(f, 'egoista') > 50 && rng.chance(0.5));
    const victim = thief && [...adults].filter((f) => f !== thief).sort((a, b) => b.p!.coins - a.p!.coins)[0];
    if (thief && victim) {
      const n = Math.min(victim.p!.coins, rng.int(2, 6));
      victim.p!.coins -= n;
      thief.p!.coins += n;
      // El robado no sabe quién fue: sospecha de alguien que no le cae bien (que puede ser inocente).
      const caught = rng.chance(0.35);
      const suspect = caught ? thief : rng.pick(tiesOf(w, victim.id).filter((t) => t.aff < 0).map((t) => folkById(w, other(t, victim.id))).filter((o): o is Folk => !!o && o.alive) as Folk[]) ?? thief;
      memorize(w, victim, { kind: 'robo', about: suspect.id, text: `Creo que fue ${suspect.name} quien me robó.`, w: -0.6, src: caught ? 'visto' : 'propio' });
      bond(w, victim.id, suspect.id, -25, 0);
      logEvent(w, regionId, 'robo', `A ${victim.name} le han robado ${n} monedas. ${caught ? `Pillaron a ${thief.name}.` : `Sospecha de ${suspect.name}.`}`, [victim.id, suspect.id]);
      seedRumor(w, { regionId, kind: 'robo', subject: suspect.id, target: victim.id, witnesses: [victim.id, ...kinOf(w, victim.id).map((x) => x.id)] });
    }
  }
  // Fiebres y accidentes.
  const sickRisk = 0.04 + (r.flags.fiebre ? 0.15 : 0) + (seasonOf(w.day) === 'invierno' ? 0.04 : 0) + (marketOf(w, regionId).hungry > 2 ? 0.04 : 0);
  if (rng.chance(sickRisk * k)) {
    const f = rng.weighted(people, (x) => (x.age > 55 || x.age < 8 ? 2 : 1) * (1.5 - x.p!.needs.comida));
    if (f && !(f.p!.sick && f.p!.sick >= w.day)) {
      f.p!.sick = w.day + rng.int(2, 6);
      logEvent(w, regionId, 'enfermedad', `${f.name} guarda cama con fiebre.`, [f.id]);
      seedRumor(w, { regionId, kind: 'enfermedad', subject: f.id, witnesses: kinOf(w, f.id).map((x) => x.id) });
    }
  }
  if (rng.chance(0.04 * k)) {
    const f = rng.pick(adults.filter((x) => ['campesino', 'artesano', 'minero', 'carpintero', 'pescador'].includes(x.role)));
    if (f) {
      f.p!.sick = w.day + rng.int(2, 5);
      memorize(w, f, { kind: 'accidente', text: 'Me hice daño trabajando.', w: -0.4, src: 'propio' });
      logEvent(w, regionId, 'accidente', `${f.name} se hizo daño trabajando y no podrá trabajar unos días.`, [f.id]);
      seedRumor(w, { regionId, kind: 'accidente', subject: f.id, witnesses: witnesses(0.2) });
    }
  }
  // Viajes: comerciantes y curiosos se van unos días (y traen noticias).
  if (rng.chance(0.07 * k)) {
    const f = rng.pick(adults.filter((x) => (x.role === 'comerciante' || x.role === 'exploradora' || trait(x, 'curioso') > 72) && !x.p!.away));
    const dest = rng.pick(w.regions.filter((x) => x.id !== regionId && !x.flags.guerra));
    if (f && dest) {
      const lost = rng.chance(0.08);
      f.p!.away = { to: dest.id, back: w.day + rng.int(3, 7) + (lost ? 4 : 0), why: lost ? 'desaparicion' : 'viaje' };
      logEvent(w, regionId, lost ? 'desaparicion' : 'viaje', lost ? `Nadie sabe dónde está ${f.name} desde hace días.` : `${f.name} ha salido de viaje hacia ${dest.name}.`, [f.id]);
      seedRumor(w, { regionId, kind: lost ? 'desaparicion' : 'viaje', subject: f.id, witnesses: [...kinOf(w, f.id).map((x) => x.id), ...witnesses(0.15)], extra: { region: dest.name } });
    }
  }
  // Descubrimientos: alguien curioso encuentra algo (a veces, un lugar que el jugador aún no conoce).
  if (rng.chance(0.03 * k)) {
    const f = rng.pick(people.filter((x) => trait(x, 'curioso') > 60));
    if (f) {
      const place = getLayout(w).places.find((p) => p.regionId === regionId && !w.life!.places[p.id]?.discovered);
      const text = place ? `${f.name} dice que ha visto ${place.name.toLowerCase()} más allá de los campos.` : `${f.name} encontró unas monedas antiguas junto al río.`;
      logEvent(w, regionId, 'descubrimiento', text, [f.id]);
      seedRumor(w, { regionId, kind: 'descubrimiento', subject: f.id, witnesses: [f.id, ...witnesses(0.2)], versions: [text, `Dicen que ${f.name} ha encontrado un tesoro.`, `Dicen que ${f.name} anda metido en cosas de brujería.`], tone: 0 });
    }
  }
  // Conflicto familiar: en casa también se discute.
  if (rng.chance(0.05 * k)) {
    const f = rng.pick(adults);
    const kin = f && kinOf(w, f.id).map((x) => folkById(w, x.id)).filter((o): o is Folk => !!o && o.alive && o.regionId === regionId);
    const o = kin?.length ? rng.pick(kin) : undefined;
    if (f && o && (f.p!.emo.estres + o.p!.emo.estres > 0.6 || rng.chance(0.3))) {
      bond(w, f.id, o.id, -12, 0);
      logEvent(w, regionId, 'familia', `En casa de ${f.name} se oyen gritos: discute con ${o.name}.`, [f.id, o.id]);
    }
  }
  // Fiesta de la cosecha: el último día del otoño todo el pueblo sale a la plaza.
  if (detail > 0 && seasonOf(w.day) === 'otoño' && seasonOf(w.day + 1) !== 'otoño' && !s.festivals.some((x) => x.regionId === regionId && x.day === w.day)) {
    s.festivals.push({ regionId, day: w.day, kind: 'fiesta', who: [] });
    logEvent(w, regionId, 'fiesta', `${r.name} celebra la fiesta de la cosecha en la plaza.`, []);
  }
  // Retiro: los mayores dejan su oficio.
  for (const f of adults) if (f.age >= 64 && f.role !== 'anciano' && f.role !== 'lider' && !f.charId && rng.chance(0.25)) {
    const from = f.role;
    changeJob(w, f, 'anciano', 'al hacerse mayor');
    logEvent(w, regionId, 'retiro', `${f.name} ha dejado de trabajar de ${ROLE_TITLE[from]}: ya tiene sus años.`, [f.id]);
  }
  // Los cambios de oficio por salario, las migraciones y las llegadas los decide population.ts.
}

/**
 * Cadenas de consecuencias de la economía: sequía → mala cosecha → escasez →
 * precios → enfado → peleas → bandidos → migración (y al revés, cuando la
 * tierra vuelve a dar).
 */
function chainsFromEconomy(w: WorldState, rng: Rng, regionId: number, people: Folk[], eco: EconomyNotes, detail: number): void {
  const m = marketOf(w, regionId);
  const r = w.regions[regionId];
  const merchants = people.filter((f) => f.role === 'comerciante');
  const farmers = people.filter((f) => f.role === 'campesino').map((f) => f.id);
  const s = societyOf(w) as ReturnType<typeof societyOf> & { ecoSeen?: Record<string, number> };
  const seen = (s.ecoSeen ??= {});
  const once = (key: string, days: number) => {
    const k = `${regionId}:${key}`;
    if ((seen[k] ?? -999) > w.day - days) return false;
    seen[k] = w.day;
    return true;
  };
  // Lo que pasa en los campos.
  for (const n of eco.farm) {
    if (!once(n.kind, 6)) continue;
    logEvent(w, regionId, n.kind === 'cosecha-buena' ? 'cosecha' : n.kind === 'cosecha-mala' ? 'cosecha' : n.kind, n.text, []);
    const versions = n.kind === 'cosecha-mala' ? [n.text, 'Dicen que este año no habrá grano para todos.', 'Dicen que el pueblo pasará hambre este invierno.'] : n.kind === 'cosecha-buena' ? [n.text, 'Dicen que nunca se vio una cosecha igual.'] : [n.text, 'Dicen que la tierra está maldita.'];
    seedRumor(w, { regionId, kind: `campo-${n.kind}`, subject: farmers[0] ?? people[0].id, witnesses: farmers, versions, tone: n.kind === 'cosecha-buena' ? 0.3 : -0.2 });
    for (const f of people) if (f.role === 'campesino') f.p!.emo.estres = clamp(f.p!.emo.estres + (n.kind === 'cosecha-buena' ? -0.3 : 0.3));
  }
  if (eco.notes.includes('sube-comida') && merchants.length && once('precio', 4)) {
    const mer = rng.pick(merchants);
    logEvent(w, regionId, 'precio', `La comida ha subido de precio en el mercado de ${r.name}.`, [mer.id]);
    seedRumor(w, { regionId, kind: 'precio', subject: mer.id, witnesses: people.filter(() => rng.chance(0.3)).map((f) => f.id) });
    for (const f of people) if (f.role !== 'comerciante' && f.p!.coins < 6) bond(w, f.id, mer.id, -4, 0), (f.p!.emo.enojo = clamp(f.p!.emo.enojo + 0.15));
  }
  if (eco.notes.includes('baja-comida') && once('baja', 6)) logEvent(w, regionId, 'precio', `En ${r.name} la comida vuelve a estar a buen precio.`, []);
  if (eco.notes.includes('hambre') && detail > 0 && once('hambre', 5)) logEvent(w, regionId, 'hambre', `En ${r.name} hay familias que no tienen qué comer.`, []);
  // Sin hierro, el herrero no forja; sin herramientas, el campo rinde menos.
  if (eco.notes.includes('sin-hierro') && once('sin-hierro', 10)) {
    const smith = people.find((f) => f.role === 'artesano');
    const echo = impactEcho(w, regionId, 'hierro');
    logEvent(w, regionId, 'escasez', `${smith?.name ?? 'El herrero'} no tiene hierro: no puede hacer herramientas.${echo ? ' ' + echo : ''}`, smith ? [smith.id] : []);
    seedRumor(w, { regionId, kind: 'escasez', subject: smith?.id ?? people[0].id, witnesses: people.filter(() => rng.chance(0.3)).map((f) => f.id), versions: [`${smith?.name ?? 'El herrero'} se ha quedado sin hierro.`, echo ? 'Dicen que el forastero se llevó todo el hierro del pueblo.' : 'Dicen que no llega hierro de ninguna parte.', 'Dicen que este año no habrá herramientas para nadie.'], tone: -0.2 });
  }
  if (eco.notes.includes('sin-herramientas') && once('sin-herramientas', 10)) logEvent(w, regionId, 'escasez', `En ${r.name} faltan herramientas: azadas rotas, redes sin remendar. Se trabaja peor.`, []);
  // Quiebras: un comerciante sin dinero ni crédito cierra su puesto.
  for (const n of eco.notes.filter((x) => x.startsWith('quiebra:'))) {
    const f = folkById(w, n.split(':')[1]);
    if (!f || !once(`quiebra-${f.id}`, 30)) continue;
    changeJob(w, f, rng.chance(0.5) ? 'campesino' : 'carpintero', 'después de arruinarse');
    logEvent(w, regionId, 'quiebra', `${f.name} ha cerrado su puesto: se ha arruinado. Ahora trabaja de ${ROLE_TITLE[f.role]}.`, [f.id]);
    seedRumor(w, { regionId, kind: 'quiebra', subject: f.id, witnesses: people.filter(() => rng.chance(0.4)).map((x) => x.id), versions: [`${f.name} se ha arruinado.`, `Dicen que ${f.name} debe dinero a medio pueblo.`, `Dicen que ${f.name} lo ha perdido todo jugando.`], tone: -0.3 });
    f.p!.emo.tristeza = clamp(f.p!.emo.tristeza + 0.4);
  }
  // Bandidos: con hambre y poco orden, hay quien sale a los caminos.
  const desperate = m.hungry >= Math.max(3, people.length * 0.3) && r.stability < 0.55;
  if (desperate && !r.flags.bandidos && rng.chance(0.15)) {
    r.flags.bandidos = { since: w.day };
    logEvent(w, regionId, 'bandidos', `Hay bandidos en los caminos de ${r.name}. Gente desesperada, dicen.`, []);
    seedRumor(w, { regionId, kind: 'bandidos', subject: people[0].id, witnesses: merchants.map((f) => f.id), versions: [`Hay bandidos en los caminos de ${r.name}.`, 'Dicen que los bandidos son vecinos que pasan hambre.', 'Dicen que nadie que salga de noche vuelve.'], tone: -0.3 });
  } else if (r.flags.bandidos && !desperate && w.day - r.flags.bandidos.since > 8 && rng.chance(0.2)) {
    delete r.flags.bandidos;
    logEvent(w, regionId, 'bandidos', `Los caminos de ${r.name} vuelven a ser seguros.`, []);
  }
  // Una mina nueva (a veces): alguien encuentra una veta en los montes.
  if (!m.mine && r.resource !== 'hierro' && rng.chance(0.0025) && nearTiles(w, regionId, (t) => t === T.Mountain || t === T.Rock) > 25) {
    const f = people.find((x) => x.role === 'minero' || x.role === 'exploradora' || trait(x, 'curioso') > 75);
    if (f) {
      m.mine = true;
      logEvent(w, regionId, 'mina', `${f.name} ha encontrado una veta de hierro en los montes de ${r.name}.`, [f.id]);
      seedRumor(w, { regionId, kind: 'mina', subject: f.id, witnesses: people.map((x) => x.id), versions: [`${f.name} ha encontrado hierro en los montes.`, 'Dicen que en los montes hay hierro para cien años.', 'Dicen que en los montes hay oro.'], tone: 0.3 });
    }
  }
}

/** El clima también tiene sus años: a veces, una sequía cae sobre una comarca. */
function climateDay(w: WorldState, rng: Rng): void {
  const c = climateOf(w);
  if (c.drought && c.drought.until < w.day) {
    for (const id of c.drought.regions) logEvent(w, id, 'lluvia', `Vuelve a llover en ${w.regions[id].name}. La tierra respira.`, []);
    delete c.drought;
  }
  const season = seasonOf(w.day);
  if (!c.drought && (season === 'primavera' || season === 'verano') && rng.chance(0.006)) {
    const r = rng.pick(w.regions);
    startDrought(w, r.id, rng.int(8, 26));
    for (const id of climateOf(w).drought!.regions) logEvent(w, id, 'sequia', `Hace semanas que no llueve en ${w.regions[id].name}.`, []);
  }
}

function comeBack(w: WorldState, f: Folk): void {
  const a = f.p!.away!;
  delete f.p!.away;
  const dest = w.regions[a.to]?.name ?? 'lejos';
  if (a.why === 'desaparicion') logEvent(w, f.regionId, 'regreso', `${f.name} ha vuelto. Dice que se perdió en el bosque; no todos le creen.`, [f.id]);
  else {
    logEvent(w, f.regionId, 'regreso', `${f.name} ha vuelto de ${dest} con noticias.`, [f.id]);
    if (f.role === 'comerciante') marketOf(w, f.regionId).stock.trigo += 4;
  }
}

/** A veces, dos que se llevan muy mal empiezan un pleito largo. */
function maybeNewArc(w: WorldState, rng: Rng, regionId: number, people: Folk[], detail: number): void {
  const s = societyOf(w);
  if (detail === 0 || s.arcs.filter((a) => !a.outcome && a.regionId === regionId).length >= 2 || !rng.chance(0.025)) return;
  for (const f of people) {
    const t = tiesOf(w, f.id).find((x) => x.aff <= -35 && x.fam >= 20 && !x.kin);
    if (!t) continue;
    const o = folkById(w, other(t, f.id));
    if (!o?.alive || o.regionId !== regionId || o.age < 18 || f.age < 18 || activeArcOf(w, f.id) || activeArcOf(w, o.id)) continue;
    startArc(w, rng, f, o);
    return;
  }
}

/** La historia que el jugador puede seguir desde el día 1: el comerciante que conoce en el prólogo. */
export function startFirstStory(w: WorldState): void {
  if (societyOf(w).arcs.length) return;
  const rng = new Rng(w.seed ^ 0xa2c5);
  const life = w.life!;
  const home = life.folk.filter((f) => f.alive && f.regionId === w.player.home && f.age >= 18 && !f.charId);
  const pro = life.prologue;
  const busy = new Set([pro?.first, pro?.inn, pro?.kid, pro?.artisan, pro?.a, pro?.b].filter(Boolean) as string[]);
  const a = (pro && home.find((f) => f.id === pro.merchant)) ?? home.find((f) => f.role === 'comerciante');
  const b = home.filter((f) => f !== a && !busy.has(f.id) && f.role !== 'lider').sort((x, y) => (x.role === 'comerciante' ? -1 : 0) - (y.role === 'comerciante' ? -1 : 0))[0];
  if (!a || !b) return;
  startArc(w, rng, a, b, b.role === 'comerciante' ? 'clientes' : 'deuda');
}

// ---------------------------------------------------------------------------
// El día de hoy (solo donde está el jugador): planes visibles
// ---------------------------------------------------------------------------
/** Planes del primer día (el resto se hacen cada amanecer). */
export function planToday(w: WorldState): void {
  const rng = new Rng(w.seed ^ 0x77a1);
  const people = w.life!.folk.filter((f) => f.alive && f.p && f.regionId === w.player.home);
  planDay(w, rng, w.player.home, people);
}

function planDay(w: WorldState, rng: Rng, regionId: number, people: Folk[]): void {
  const s = societyOf(w);
  const v = getLayout(w).villages[regionId];
  const fest = s.festivals.find((x) => x.regionId === regionId && x.day === w.day);
  // Amigos que quedan por la tarde: los dos irán al mismo sitio.
  for (const f of people) {
    if (f.age < 14 || trait(f, 'sociable') < 45 || rng.chance(0.5) || f.p!.plans.length) continue;
    const t = tiesOf(w, f.id).filter((x) => x.aff >= 30 && !x.kin).sort((a, b) => b.aff - a.aff)[0];
    const o = t ? folkById(w, other(t, f.id)) : undefined;
    if (!o?.alive || o.regionId !== regionId || o.p!.plans.length || o.p!.away) continue;
    const salt = hashString(`${f.id}${o.id}${w.day}`);
    const posada = v.keys.find((k) => k.kind === 'posada');
    const atInn = salt % 3 === 0 && posada;
    const base = atInn ? { x: posada.x + posada.w / 2, y: posada.y + posada.h + 1.3 } : { x: v.cx + 0.5 + Math.cos(salt) * (v.plazaR - 1.8), y: v.cy + 0.5 + Math.sin(salt) * (v.plazaR - 1.8) };
    const from = 18 + (salt % 3) * 0.5;
    for (const [x, dx] of [[f, -0.5], [o, 0.5]] as const) x.p!.plans.push({ day: w.day, from, to: from + 1.5, x: base.x + dx, y: base.y, activity: `charla con ${x === f ? o.name : f.name}`, with: x === f ? o.id : f.id });
    bond(w, f.id, o.id, 1.5, 3);
  }
  if (fest) {
    const funeral = fest.kind === 'funeral';
    const temple = v.keys.find((k) => k.kind === 'templo') ?? v.keys[0];
    for (const f of people) {
      if (f.p!.away || (f.p!.sick && f.p!.sick >= w.day)) continue;
      const salt = hashString(f.id) % 628;
      const at = funeral ? { x: temple.x + temple.w / 2 + Math.cos(salt) * 2.4, y: temple.y + temple.h + 1.6 + Math.abs(Math.sin(salt)) * 1.2 } : { x: v.cx + 0.5 + Math.cos(salt / 100) * (2.4 + (salt % 4)), y: v.cy + 0.5 + Math.sin(salt / 100) * (2.4 + (salt % 4)) };
      const names = fest.who.map((id) => folkById(w, id)?.name).filter(Boolean).join(' y ');
      f.p!.plans.push({ day: w.day, from: funeral ? 17 : 18, to: funeral ? 18.5 : 22.5, x: at.x, y: at.y, activity: funeral ? `despide a ${names}` : fest.kind === 'boda' ? `celebra la boda de ${names}` : 'celebra la fiesta de la cosecha' });
    }
  }
  // Los enfermos guardan cama; los de luto, en casa o en el templo.
  for (const f of people) {
    if (f.p!.mourning !== undefined && f.p!.mourning >= w.day && rng.chance(0.5)) {
      const temple = v.keys.find((k) => k.kind === 'templo');
      if (temple) f.p!.plans.push({ day: w.day, from: 16, to: 18, x: temple.x + temple.w / 2 + 0.6, y: temple.y + temple.h + 0.9, activity: 'reza por los suyos, en silencio' });
    }
  }
}

// ---------------------------------------------------------------------------
// Muertes, nacimientos y mayoría de edad (llamado desde life.ts)
// ---------------------------------------------------------------------------
export function mournDeaths(w: WorldState, dead: Folk[]): void {
  if (!w.life || !dead.length) return;
  ensurePeople(w);
  const s = societyOf(w);
  for (const d of dead) {
    d.died ??= w.day;
    const close = tiesOf(w, d.id).filter((t) => t.kin || t.aff >= 40);
    for (const t of close) {
      const o = folkById(w, other(t, d.id));
      if (!o?.alive || !o.p) continue;
      o.p.mourning = w.day + (t.kin ? 6 : 3);
      o.p.emo.tristeza = clamp(o.p.emo.tristeza + (t.kin ? 0.6 : 0.35));
      memorize(w, o, { kind: 'muerte', about: d.id, text: `Murió ${d.name}.`, w: -0.8, src: 'propio' });
    }
    // Herencia: la pareja (o el hijo mayor) se queda con lo que tenía; un hijo puede seguir su oficio.
    const heirs = close.filter((t) => t.kin === 'pareja' || (t.kin === 'progenitor' && t.parent === d.id)).map((t) => folkById(w, other(t, d.id))).filter((o): o is Folk => !!o?.alive && !!o.p);
    if (heirs[0] && d.p) heirs[0].p!.coins += d.p.coins;
    const child = heirs.find((h) => h.age >= 16 && h.role !== d.role && (d.role === 'comerciante' || d.role === 'artesano'));
    if (child && !child.charId) {
      changeJob(w, child, d.role, `para seguir con el oficio de su familia`);
      logEvent(w, d.regionId, 'herencia', `${child.name} se ha quedado con el ${d.role === 'comerciante' ? 'puesto' : 'taller'} de ${d.name}.`, [child.id]);
    }
    s.festivals.push({ regionId: d.regionId, day: w.day, kind: 'funeral', who: [d.id] });
    logEvent(w, d.regionId, 'muerte', `Ha muerto ${d.name}. ${close.length ? `${folkById(w, other(close[0], d.id))?.name ?? 'Su familia'} no se separa del templo.` : ''}`, [d.id, ...close.map((t) => other(t, d.id))]);
    seedRumor(w, { regionId: d.regionId, kind: 'muerte', subject: d.id, witnesses: close.map((t) => other(t, d.id)) });
    // Los conflictos con el muerto se apagan (o pasan a la familia).
    for (const arc of s.arcs) if (!arc.outcome && (arc.a === d.id || arc.b === d.id)) arc.heat *= 0.5;
  }
}

export function welcomeBirth(w: WorldState, baby: Folk, parent: Folk | undefined): void {
  if (!w.life || !parent) return;
  ensurePeople(w);
  const partner = partnerOf(w, parent.id);
  for (const pid of [parent.id, partner].filter(Boolean) as string[]) {
    Object.assign(ensureTie(w, pid, baby.id), { kin: 'progenitor', parent: pid, aff: 85, fam: 95 });
    const pf = folkById(w, pid);
    if (pf?.p) (pf.p.emo.felicidad = clamp(pf.p.emo.felicidad + 0.4)), memorize(w, pf, { kind: 'nacimiento', about: baby.id, text: `Nació ${baby.name}.`, w: 0.8, src: 'propio' });
  }
  for (const k of kinOf(w, parent.id)) if ((k.rel === 'hijo' || k.rel === 'hija') && k.id !== baby.id) Object.assign(ensureTie(w, k.id, baby.id), { kin: 'hermanos', aff: 40, fam: 80 });
  baby.house = parent.house;
  logEvent(w, parent.regionId, 'nacimiento', `Ha nacido ${baby.name}, ${partner ? `de ${parent.name} y ${folkById(w, partner)?.name}` : `de ${parent.name}`}.`, [parent.id, baby.id]);
  seedRumor(w, { regionId: parent.regionId, kind: 'nacimiento', subject: parent.id, witnesses: [parent.id, partner ?? parent.id], extra: { baby: baby.id } });
}

/** Elige padres para un recién nacido: mejor una pareja joven del pueblo. */
export function chooseParent(w: WorldState, rng: Rng, alive: Folk[]): Folk | undefined {
  if (!w.life?.society) return undefined;
  const couples = alive.filter((f) => f.age >= 18 && f.age < 46 && partnerOf(w, f.id));
  return couples.length ? rng.pick(couples) : undefined;
}

/** A los 15 años se elige oficio: casi siempre el de la familia, a veces el que pide el carácter. */
export function comingOfAge(w: WorldState, rng: Rng, f: Folk): FolkRole {
  const parent = kinOf(w, f.id).map((k) => (k.rel === 'padre' || k.rel === 'madre' ? folkById(w, k.id) : undefined)).find((x) => x && x.role !== 'anciano' && x.role !== 'lider');
  if (parent && rng.chance(0.6)) return parent.role === 'nino' ? 'campesino' : parent.role;
  if (trait(f, 'curioso') > 70) return rng.pick(['exploradora', 'sanadora', 'artesano'] as FolkRole[]);
  if (trait(f, 'valiente') > 70) return 'guardia';
  if (trait(f, 'ambicioso') > 70) return 'comerciante';
  return rng.pick(['campesino', 'comerciante', 'guardia', 'artesano', 'pastor'] as FolkRole[]);
}

// ---------------------------------------------------------------------------
// Lo que hace el jugador también se cuenta
// ---------------------------------------------------------------------------
const DEED_KIND: Record<string, string> = { ayuda: 'p_ayuda', salvado: 'p_ayuda', refugio: 'p_ayuda', comida: 'p_comida', trabajo: 'p_trabajo', justicia: 'p_ayuda', mentira: 'p_mentira', robo: 'p_robo', ofensa: 'p_ofensa', injusticia: 'p_ofensa', fuerza: 'p_ofensa' };

function playerDeedsToRumors(w: WorldState): void {
  const s = societyOf(w);
  const life = w.life!;
  const gen = life.player.generation;
  for (const f of life.folk) {
    if (!f.alive || !f.p) continue;
    for (const m of f.memories) {
      if (m.gen !== gen || m.day <= s.memDay || Math.abs(m.weight) < 0.3) continue;
      const kind = DEED_KIND[m.kind];
      if (!kind) continue;
      const kin = kinOf(w, f.id).map((k) => k.id);
      seedRumor(w, { regionId: f.regionId, kind, subject: 'jugador', target: f.id, witnesses: [f.id, ...kin], heat: 1 });
      memorize(w, f, { kind: m.kind, about: 'jugador', text: m.weight > 0 ? 'Me ayudó.' : 'Me hizo daño.', w: m.weight, src: 'propio' });
      // La familia quiere saber si es verdad.
      if (m.weight > 0.3) {
        const k = kinOf(w, f.id).find((x) => folkById(w, x.id)?.regionId === f.regionId && folkById(w, x.id)!.age >= 14);
        if (k) {
          const kf = folkById(w, k.id)!;
          pushApproach(w, { folk: kf.id, kind: 'pariente', lines: [`«¿Es verdad que ayudaste a ${f.gender === 'f' ? 'mi' : 'mi'} ${relWord(w, kf, f)} ${f.name}?»`], choices: [{ id: 'si', label: '«Hice lo que pude.»' }, { id: 'nada', label: '«No fue nada.»' }], data: { about: f.id } });
        }
      }
    }
  }
  s.memDay = w.day;
}

function relWord(w: WorldState, who: Folk, of: Folk): string {
  return kinOf(w, who.id).find((k) => k.id === of.id)?.rel ?? 'familia';
}

// ---------------------------------------------------------------------------
// Vecinos que se acercan a hablar contigo
// ---------------------------------------------------------------------------
export function pushApproach(w: WorldState, a: Omit<Approach, 'id' | 'day' | 'until'> & { until?: number }): void {
  const s = societyOf(w);
  if (s.approaches.some((x) => x.folk === a.folk)) return;
  s.approaches.push({ ...a, id: `ap${++s.seq}`, day: w.day, until: a.until ?? w.day + 2 });
}

function makeApproaches(w: WorldState, rng: Rng, regionId: number): void {
  const s = societyOf(w);
  const life = w.life!;
  const people = life.folk.filter((f) => f.alive && f.p && f.regionId === regionId && f.age >= 12);
  // Quien tiene un pleito y te conoce quiere contarte su versión.
  for (const arc of s.arcs) {
    if (arc.outcome || arc.regionId !== regionId || arc.stage < 2) continue;
    for (const [id, heard] of [[arc.a, arc.player.heardA], [arc.b, arc.player.heardB]] as const) {
      const f = folkById(w, id);
      if (!f || heard || f.lastMet < 0 || trait(f, 'timido') > 75 || !rng.chance(0.35)) continue;
      const o = folkById(w, id === arc.a ? arc.b : arc.a);
      pushApproach(w, { folk: id, kind: 'version', lines: [`«Oye, tú. Seguro que te han contado cosas de mí y de ${o?.name}. Quiero que sepas la verdad.»`], choices: [{ id: 'escuchar', label: '«Te escucho.»' }, { id: 'no', label: '«No es asunto mío.»' }], data: { arc: arc.id } });
    }
  }
  // Quien ha oído algo grave de ti viene a preguntártelo.
  for (const f of people) {
    if (f.lastMet < 0 || rng.chance(0.75)) continue;
    const bad = rumorsKnownBy(w, f, true).find((x) => x.r.tone < -0.3);
    if (bad) {
      pushApproach(w, { folk: f.id, kind: 'rumor', lines: [`«${bad.r.versions[bad.v]} ¿Es verdad?»`], choices: [{ id: 'negar', label: '«No es verdad.»' }, { id: 'admitir', label: '«Sí. No me enorgullezco.»' }, { id: 'explicar', label: '«No fue exactamente así.»' }], data: { rumor: bad.r.id } });
      break;
    }
  }
  // Agradecimientos y favores: la gente que confía en ti te pide cosas.
  for (const f of people) {
    if (f.lastMet < 0 || !f.p || rng.chance(0.8)) continue;
    const thanks = f.p.mem.find((m) => m.about === 'jugador' && m.w > 0.4 && w.day - m.day <= 3);
    if (thanks && trait(f, 'sociable') > 45) {
      pushApproach(w, { folk: f.id, kind: 'gracias', lines: ['«Quería darte las gracias. No todo el mundo hace lo que hiciste.»', trait(f, 'generoso') > 55 ? '«Toma. No es mucho, pero es de corazón.»' : '«Te debo una.»'], choices: [{ id: 'ok', label: '«No hay de qué.»' }], data: { gift: trait(f, 'generoso') > 55 ? 1 : 0 } });
      break;
    }
    if (f.trust > 0.5 && (f.p.needs.comida < 0.45 || kinOf(w, f.id).some((k) => (folkById(w, k.id)?.p?.sick ?? -1) >= w.day))) {
      const sick = kinOf(w, f.id).map((k) => folkById(w, k.id)).find((o) => (o?.p?.sick ?? -1) >= w.day);
      pushApproach(w, { folk: f.id, kind: 'favor', lines: ['«Necesito preguntarte algo.»', sick ? `«${sick.name} sigue con fiebre y no tengo hierbas. Si encuentras alguna…»` : '«En casa no queda nada que comer. ¿Podrías darme algo?»'], choices: [{ id: 'dar', label: sick ? '🌿 Darle hierbas' : '🍞 Darle comida' }, { id: 'prometer', label: '«Veré qué puedo hacer.»' }, { id: 'negar', label: '«Lo siento, no puedo.»' }], data: { need: sick ? 'hierbas' : 'comida', sick: sick?.id ?? '' }, until: w.day + 3 });
      break;
    }
  }
  // Una buena acción trae otra: alguien recomendado te ofrece trabajo.
  for (const f of people) {
    if (f.lastMet >= 0 || !f.p || rng.chance(0.85)) continue;
    const friend = tiesOf(w, f.id).filter((t) => t.aff >= 30).map((t) => folkById(w, other(t, f.id))).find((o) => o && o.lastMet >= 0 && o.trust > 0.62);
    if (friend && ['campesino', 'artesano', 'comerciante', 'pescador', 'carpintero', 'minero', 'posadero'].includes(f.role)) {
      pushApproach(w, { folk: f.id, kind: 'oferta', lines: [`«Tú eres a quien llaman el forastero, ¿no? ${friend.name} me ha hablado bien de ti.»`, `«Me vendrían bien unas manos. Pago mejor que la mayoría.»`], choices: [{ id: 'aceptar', label: '«Cuenta conmigo.»' }, { id: 'luego', label: '«Ahora no puedo.»' }], data: { from: friend.id }, until: w.day + 3 });
      break;
    }
  }
}

/** Alguien te vio hablando con otra persona: quizá venga a preguntarte. */
export function noticeConversation(w: WorldState, talkedTo: string, onlookers: string[]): void {
  const t = folkById(w, talkedTo);
  if (!t) return;
  for (const id of onlookers) {
    const f = folkById(w, id);
    if (!f?.p || f.lastMet < 0 || f.age < 12) continue;
    const tie = tieOf(w, f.id, talkedTo);
    memorize(w, f, { kind: 'vio_hablar', about: 'jugador', with: talkedTo, text: `Le vi hablando con ${t.name}.`, w: 0, i: 0.5, src: 'visto' });
    if (tie && (tie.aff <= -25 || tie.kin) && trait(f, 'timido') < 70) {
      const enemy = tie.aff <= -25;
      pushApproach(w, { folk: f.id, kind: 'vio', lines: [enemy ? `«Te vi hablando con ${t.name}. Ten cuidado con lo que te cuente.»` : `«Te vi hablando con ${t.name}. ¿Qué te ha dicho de mí?»`], choices: [{ id: 'nada', label: '«Nada importante.»' }, { id: 'preguntar', label: enemy ? `«¿Qué pasa con ${t.name}?»` : '«Que te aprecia.»' }], data: { about: talkedTo } });
      return;
    }
  }
}

/** La respuesta del jugador a quien se le ha acercado. */
export function answerApproach(w: WorldState, apId: string, choice: string): { lines: string[]; give?: 'comida' | 'hierbas'; work?: string; arcListen?: string } {
  const s = societyOf(w);
  const ap = s.approaches.find((a) => a.id === apId);
  if (!ap) return { lines: [] };
  s.approaches = s.approaches.filter((a) => a !== ap);
  const f = folkById(w, ap.folk)!;
  const life = w.life!;
  const id = life.identity;
  f.lastMet = w.day;
  switch (`${ap.kind}:${choice}`) {
    case 'version:escuchar': {
      const arc = s.arcs.find((a) => a.id === ap.data?.arc);
      return { lines: [], arcListen: arc?.id };
    }
    case 'vio:preguntar': {
      const o = folkById(w, String(ap.data?.about));
      const t = o && tieOf(w, f.id, o.id);
      if (o && t) learnFact(w, o.id, `${f.name}: ${t.aff <= -25 ? 'no se soportan' : 'son familia'}`);
      return { lines: [t && t.aff <= -25 ? `«${o?.name} y yo… digamos que tenemos cuentas pendientes. No te fíes.»` : `«Ah, bueno. Si ${o?.name} dice eso, será verdad. Es de la familia.»`] };
    }
    case 'rumor:negar': {
      const r = s.rumors.find((x) => x.id === ap.data?.rumor);
      const exaggerated = r && (r.knownBy[f.id] ?? 0) > 0;
      if (exaggerated || (id && hashString(`${f.id}${w.day}`) % 2 === 0)) {
        f.trust = Math.min(1, f.trust + 0.05);
        return { lines: [`${f.name} te mira un buen rato. «Bueno. La gente habla mucho.»`] };
      }
      f.trust = Math.max(0, f.trust - 0.05);
      return { lines: [`«Ya.» No parece creerte.`] };
    }
    case 'rumor:admitir':
      f.trust = Math.max(0, f.trust - 0.03);
      f.resentment = Math.max(0, f.resentment - 0.05);
      memorize(w, f, { kind: 'sinceridad', about: 'jugador', text: 'Al menos lo admitió.', w: 0.2, src: 'propio' });
      return { lines: [`«Al menos lo dices a la cara. Eso es más de lo que hace mucha gente.»`] };
    case 'rumor:explicar': {
      const r = s.rumors.find((x) => x.id === ap.data?.rumor);
      return { lines: [r ? `Le cuentas lo que pasó de verdad: «${r.versions[0]}»` : 'Le cuentas tu versión.', trait(f, 'desconfiado') > 60 ? '«Eso dices tú.»' : '«Ah. Pues no es lo que se cuenta.»'] };
    }
    case 'gracias:ok': {
      if (Number(ap.data?.gift) && life.player) life.player.inventory.comida += 1;
      return { lines: Number(ap.data?.gift) ? ['Te da un poco de pan envuelto en un paño.'] : [] };
    }
    case 'favor:dar': {
      const need = String(ap.data?.need) as 'comida' | 'hierbas';
      if (life.player.inventory[need] <= 0) return { lines: [`No llevas ${need}.`, `«Vaya… bueno, gracias de todos modos.»`] };
      life.player.inventory[need]--;
      if (need === 'hierbas' && ap.data?.sick) {
        const sick = folkById(w, String(ap.data.sick));
        if (sick?.p?.sick) sick.p.sick = Math.min(sick.p.sick, w.day + 1);
      } else if (f.p) f.p.needs.comida = Math.min(1, f.p.needs.comida + 0.4);
      f.memories.push({ day: w.day, kind: need === 'comida' ? 'comida' : 'salvado', weight: 0.6, gen: life.player.generation });
      f.trust = Math.min(1, f.trust + 0.1);
      f.gratitude = Math.min(1, f.gratitude + 0.25);
      return { lines: [`${f.name} lo coge con las dos manos. «No lo olvidaré.»`], give: need };
    }
    case 'favor:prometer':
      memorize(w, f, { kind: 'promesa', about: 'jugador', text: 'Me prometió ayudarme.', w: 0.15, src: 'propio' });
      return { lines: [`«Gracias. Te espero.»`] };
    case 'favor:negar':
      memorize(w, f, { kind: 'rechazo', about: 'jugador', text: 'No quiso ayudarme.', w: -0.2, src: 'propio' });
      return { lines: [`«Ya. Entiendo.» Se aleja sin mirarte.`] };
    case 'oferta:aceptar':
      return { lines: [`«Bien. Ven conmigo.»`], work: f.id };
    case 'pariente:si':
    case 'pariente:nada':
      f.trust = Math.min(1, f.trust + 0.06);
      memorize(w, f, { kind: 'gratitud', about: 'jugador', text: 'Ayudó a mi familia.', w: 0.4, src: 'oido' });
      return { lines: [choice === 'si' ? '«Pues gracias. De verdad. Aquí tienes una amiga… o un amigo, como prefieras.»' : '«Para nosotros sí fue algo.»'] };
  }
  return { lines: [] };
}

/** La primera persona que querría acercarse al jugador, entre las que tiene cerca. */
export function approachNear(w: WorldState, near: string[]): Approach | undefined {
  const s = societyOf(w);
  return s.approaches.find((a) => near.includes(a.folk) && a.day <= w.day);
}

// ---------------------------------------------------------------------------
// Rutina: lo que cambia hoy para cada persona
// ---------------------------------------------------------------------------
export interface SocialOverride {
  kind: 'plan' | 'casa' | 'fuera';
  x?: number;
  y?: number;
  activity: string;
}

export function socialOverride(w: WorldState, f: Folk, clock: number): SocialOverride | null {
  const p = f.p;
  if (!p) return null;
  if (p.away && p.away.back > w.day) return { kind: 'fuera', activity: p.away.why === 'desaparicion' ? 'nadie sabe dónde está' : `está de viaje en ${w.regions[p.away.to]?.name ?? 'otra tierra'}` };
  const h = hourOf(clock);
  const day = Math.floor(clock / 1440) + 1;
  const plan = p.plans.find((x) => x.day === day && h >= x.from && h < x.to);
  if (plan) return { kind: 'plan', x: plan.x, y: plan.y, activity: plan.activity };
  if (p.sick !== undefined && p.sick >= day && h >= 7 && h < 21) return { kind: 'casa', activity: 'guarda cama, con fiebre' };
  // Quien trabaja para el forastero, va a su negocio.
  const employer = (p as { employer?: string }).employer;
  if (employer && h >= 8 && h < 18) {
    const b = (societyOf(w) as { player?: { businesses: { id: string; kind: string; regionId: number }[] } }).player?.businesses.find((x) => x.id === employer);
    if (b && b.regionId === f.regionId) {
      const v = getLayout(w).villages[b.regionId];
      const st = v.stalls[Math.min(v.stalls.length - 1, 5)] ?? { x: v.cx + 2, y: v.cy + 2 };
      if (b.kind === 'puesto') return { kind: 'plan', x: st.x + 0.4, y: st.y + 1.1, activity: 'atiende el puesto del forastero' };
      if (b.kind === 'granja') return { kind: 'plan', x: v.cx + 9, y: v.cy + 7, activity: 'trabaja el campo del forastero' };
      if (b.kind === 'transporte') return { kind: 'fuera', activity: 'lleva la carreta del forastero' };
    }
  }
  if (p.mourning !== undefined && p.mourning >= day && h >= 8 && h < 20 && trait(f, 'trabajador') < 70) return { kind: 'casa', activity: 'está de luto, no sale de casa' };
  // Tormenta: nadie va al campo.
  const weather = weatherIn(w, f.regionId, day);
  if (weather === 'tormenta' && h >= 7 && h < 18 && (f.role === 'campesino' || f.role === 'pastor' || f.role === 'pescador' || f.role === 'minero')) return { kind: 'casa', activity: 'espera en casa a que amaine la tormenta' };
  // Guerra: los comerciantes cierran.
  const r = w.regions[f.regionId];
  if (r.flags.guerra && f.role === 'comerciante' && h >= 8 && h < 18 && hashString(f.id + day) % 3 !== 0) return { kind: 'casa', activity: 'ha cerrado el puesto por la guerra' };
  // Mercado vacío: el puesto no abre.
  if (f.role === 'comerciante' && h >= 8 && h < 18 && w.life?.society && stallLook(w, f.regionId) === 'vacio') return { kind: 'casa', activity: 'no tiene nada que vender' };
  return null;
}

/** Para la rutina: escasez (se trabaja más), pereza (se trabaja menos), adolescentes que ayudan. */
export function routineMood(w: WorldState, f: Folk): { extraHours: number; lazy: boolean; teen: Folk | undefined } {
  const scarce = w.life?.society ? stallLook(w, f.regionId) === 'escaso' || stallLook(w, f.regionId) === 'vacio' : false;
  const lazy = trait(f, 'perezoso') > 72;
  const teen = f.age >= 12 && f.age < 15 ? kinOf(w, f.id).map((k) => (k.rel === 'padre' || k.rel === 'madre' ? folkById(w, k.id) : undefined)).find((x) => x?.alive && x.role !== 'anciano' && x.role !== 'lider' && x.role !== 'nino') : undefined;
  return { extraHours: scarce && f.role === 'campesino' ? 2 : 0, lazy, teen };
}

// ---------------------------------------------------------------------------
// Lo que ocurre mientras miras (avisos en vivo) y al volver a un pueblo
// ---------------------------------------------------------------------------
/** Acontecimientos de hoy que empiezan ahora cerca del jugador (para avisar en voz baja). */
export function liveNotices(w: WorldState, regionId: number, hourNow: number, prevHour: number): string[] {
  const out: string[] = [];
  const life = w.life!;
  for (const f of life.folk) {
    if (!f.alive || f.regionId !== regionId || !f.p) continue;
    for (const p of f.p.plans) {
      if (p.day !== w.day || p.from <= prevHour || p.from > hourNow || !p.with || p.with < f.id) continue;
      const o = folkById(w, p.with);
      if (/discute|pelea/.test(p.activity)) out.push(`Se oyen gritos: ${f.name} y ${o?.name} discuten.`);
    }
  }
  const s = societyOf(w);
  const fest = s.festivals.find((x) => x.regionId === regionId && x.day === w.day);
  if (fest && prevHour < (fest.kind === 'funeral' ? 17 : 18) && hourNow >= (fest.kind === 'funeral' ? 17 : 18)) {
    const names = fest.who.map((id) => folkById(w, id)?.name).filter(Boolean).join(' y ');
    out.push(fest.kind === 'funeral' ? `Las campanas tocan a muerto: despiden a ${names}.` : fest.kind === 'boda' ? `Música en la plaza: se celebra la boda de ${names}.` : 'Música y hogueras en la plaza: es la fiesta de la cosecha.');
  }
  return out;
}

/** Al volver a un pueblo después de días fuera: lo que te cuentan que pasó. */
export function catchUp(w: WorldState, regionId: number): string[] {
  const s = societyOf(w);
  const last = s.lastSeen[regionId];
  s.lastSeen[regionId] = w.day;
  if (last === undefined || w.day - last < 3) return [];
  const life = w.life!;
  const known = (id: string) => life.folk.find((f) => f.id === id)?.lastMet ?? -1;
  const news = s.events.filter((e) => e.regionId === regionId && e.day > last && e.day < w.day && ['boda', 'muerte', 'nacimiento', 'migracion', 'oficio', 'pelea', 'reconciliacion', 'separacion', 'robo', 'marcha', 'enemistad', 'pueblo', 'herencia', 'cosecha', 'ley', 'eleccion', 'gobierno', 'protesta', 'huelga', 'boicot', 'motin', 'rebelion', 'guerra', 'batalla', 'tratado'].includes(e.kind));
  const POL = ['ley', 'eleccion', 'gobierno', 'protesta', 'huelga', 'boicot', 'motin', 'rebelion', 'guerra', 'batalla', 'tratado'];
  const relevant = news.filter((e) => e.who.some((id) => known(id) >= 0) || e.kind === 'cosecha' || e.kind === 'pueblo' || POL.includes(e.kind)).slice(-5);
  for (const e of relevant) if (!s.heard.includes(e.id)) s.heard.push(e.id);
  const out = [...economyChanges(w, regionId), ...relevant.map((e) => `Mientras no estabas: ${e.text.charAt(0).toLowerCase()}${e.text.slice(1)}`)];
  // Tras años fuera, no solo ha cambiado el pueblo: ha cambiado el mundo (Fase 6).
  if (w.day - last >= DAYS_PER_YEAR * 2 && life.atlas) out.unshift(...worldSince(w, last));
  snapshot(w, regionId);
  return out;
}

interface Snap {
  day: number;
  food: number;
  pop: number;
  folk: number;
  houses: number;
  abandoned: number;
  prosperity: number;
  closed: number;
  goods: string[];
}

/** Lo que el jugador recuerda de un pueblo la última vez que estuvo (para notar los cambios al volver). */
function snapshot(w: WorldState, regionId: number): void {
  const s = societyOf(w) as ReturnType<typeof societyOf> & { snaps?: Record<number, Snap> };
  const m = marketOf(w, regionId);
  const t = w.life!.towns[regionId];
  (s.snaps ??= {})[regionId] = {
    day: w.day,
    food: foodIndex(m),
    pop: w.regions[regionId].population,
    folk: w.life!.folk.filter((f) => f.alive && f.regionId === regionId).length,
    houses: t?.houses ?? 0,
    abandoned: t?.abandoned ?? 0,
    prosperity: m.prosperity,
    closed: m.closedStalls,
    goods: GOODS.filter((g) => m.stock[g] >= 2),
  };
}

/** Al volver: precios, gente, casas, mercancías… lo que ha cambiado (sin cifras). */
function economyChanges(w: WorldState, regionId: number): string[] {
  const s = societyOf(w) as ReturnType<typeof societyOf> & { snaps?: Record<number, Snap> };
  const old = s.snaps?.[regionId];
  if (!old || w.day - old.day < 3) return [];
  const m = marketOf(w, regionId);
  const t = w.life!.towns[regionId];
  const out: string[] = [];
  const food = foodIndex(m);
  if (food > old.food * 1.4) out.push('La comida está mucho más cara que cuando te fuiste.');
  else if (food < old.food * 0.7) out.push('La comida está más barata que la última vez.');
  const folk = w.life!.folk.filter((f) => f.alive && f.regionId === regionId).length;
  const pop = w.regions[regionId].population;
  if (pop < old.pop * 0.88 || folk < old.folk - 1) out.push('Faltan caras conocidas: hay menos gente por la calle que antes.');
  else if (pop > old.pop * 1.12 || folk > old.folk + 1) out.push('Hay gente nueva en el pueblo. Caras que no conoces.');
  if ((t?.houses ?? 0) > old.houses) out.push('Han levantado casas nuevas desde la última vez.');
  if ((t?.abandoned ?? 0) > old.abandoned) out.push('Hay casas cerradas que antes estaban habitadas.');
  if (m.closedStalls > old.closed) out.push('Algún puesto del mercado ha cerrado.');
  const fresh = GOODS.filter((g) => m.stock[g] >= 2 && !old.goods.includes(g));
  const gone = old.goods.filter((g) => m.stock[g as Good] < 0.5);
  if (fresh.length) out.push(`En el mercado ahora hay ${GOOD[fresh[0]].name}, que antes no había.`);
  if (gone.length) out.push(`Ya no se encuentra ${GOOD[gone[0] as Good].name} en el mercado.`);
  if (m.prosperity > old.prosperity + 0.12) out.push('Se nota más vida: más gente trabajando, más ruido en la plaza.');
  else if (m.prosperity < old.prosperity - 0.12) out.push('El pueblo parece más apagado que cuando te fuiste.');
  return out.slice(0, 4).map((x) => `Al volver: ${x.charAt(0).toLowerCase()}${x.slice(1)}`);
}

/** El pueblo de un vistazo: para describir cómo está (sin cifras). */
export function townMood(w: WorldState, regionId: number): { prosperity: number; worried: number; look: ReturnType<typeof stallLook> } {
  const people = w.life!.folk.filter((f) => f.alive && f.regionId === regionId && f.p);
  const avg = people.length ? people.reduce((s, f) => s + NEEDS.reduce((t, k) => t + f.p!.needs[k], 0) / NEEDS.length, 0) / people.length : 0.6;
  const worried = people.filter((f) => f.p!.emo.estres > 0.5 || f.p!.emo.miedo > 0.5).length / Math.max(1, people.length);
  const m = marketOf(w, regionId);
  m.prosperity = avg;
  return { prosperity: avg, worried, look: stallLook(w, regionId) };
}

export { versionsFor };
export type { Plan };
