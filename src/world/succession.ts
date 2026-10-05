import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { commitCtx, makeCtx } from '../core/world';
import { record } from '../core/chronicle';
import { distillLegacy } from '../core/legacy';
import { eraTitle } from '../core/simulation';
import { LEVEL_XP, story, syncAuthority, updateStanding, type Identity, type KnowId, type SkillId } from './identity';
import { dropTie, folkById, genderFor, kinOf, logEvent, memorize, societyOf, tieOf, tiesOf, trait } from './society';
import { makeFolk } from './folk';
import { playerEco } from './business';
import type { Avatar, Folk, Kin } from './types';
import { DAYS_PER_YEAR } from './types';
import { gensOf, type LearnKey } from './genstate';
import { ancestorRel, bondOf, familyYear, healthDay, keyName, partnerFolk, pruneDead, ROLE_SKILL, stageOf, STAGES, vigorOf } from './generations';
import { addFame, ensureHeirlooms, estateDay, fameOf, heirloomsHeld, previewEstate, settleEstate } from './estate';
import { archiveDay, historyYear, housesYear, recordHist, yearOfDay } from './history';
import { influenceLevel } from './influence';
import { orgsOf, repOf } from './orgs';

/**
 * Cuando el protagonista muere, la historia continúa. Quien sigue no es una
 * copia: es otra persona del mundo (una hija, un aprendiz, una amiga, alguien
 * a quien inspiró), con su carácter, lo que aprendió, sus amistades y sus
 * enemistades. Hereda parte de lo que había —casa, dinero, objetos, nombre,
 * rencores, deudas— y el mundo le recuerda de quién viene.
 */
export interface Successor {
  key: string;
  folkId?: string;
  name: string;
  relation: string; // lo que era para quien muere
  age: number;
  wait: number; // años hasta que pueda tomar el relevo (si es menor)
  character: string;
  skills: string[];
  why: string;
  gains: string[];
  burdens: string[];
}

const TRAIT_WORD: Record<string, string> = { amable: 'amable', desconfiado: 'desconfiado', ambicioso: 'ambicioso', timido: 'tímido', curioso: 'curioso', trabajador: 'trabajador', perezoso: 'perezoso', orgulloso: 'orgulloso', generoso: 'generoso', egoista: 'egoísta', valiente: 'valiente', cobarde: 'miedoso', reservado: 'reservado', sociable: 'sociable' };

function characterOf(f: Folk): string {
  if (!f.p) return 'de carácter propio';
  const top = Object.entries(f.p.t).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => TRAIT_WORD[k] ?? k);
  return top.join(' y ');
}

function skillsOf(f: Folk): string[] {
  const out = Object.entries(f.learned ?? {}).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${keyName(k as LearnKey)} ${'●'.repeat(v!)}`);
  const own = ROLE_SKILL[f.role];
  if (own && !(f.learned ?? {})[own] && f.role !== 'nino') out.push(`${keyName(own)} (su oficio)`);
  return out;
}

/** Quién podría continuar la historia. Nunca está vacío: siempre hay alguien a quien inspiraste. */
export function successorsOf(w: WorldState): Successor[] {
  const life = w.life!;
  const g = gensOf(w);
  const seen = new Set<string>();
  const out: Successor[] = [];
  const add = (f: Folk, relation: string, why: string) => {
    if (seen.has(f.id) || !f.alive || f.age < 1) return;
    seen.add(f.id);
    const p = previewEstate(w, f.id);
    out.push({ key: f.id, folkId: f.id, name: f.name, relation, age: f.age, wait: Math.max(0, 16 - f.age), character: characterOf(f), skills: skillsOf(f), why, gains: p.gains, burdens: p.burdens });
  };
  const fam = life.player.family;
  for (const k of fam) {
    const f = k.folkId ? folkById(w, k.folkId) : undefined;
    if (f && (k.relation === 'hijo' || k.relation === 'hija')) add(f, k.relation, k.adopted ? 'Lo criaste como propio.' : 'Lleva tu sangre.');
  }
  for (const k of fam) {
    const f = k.folkId ? folkById(w, k.folkId) : undefined;
    if (!f) continue;
    if (k.relation === 'aprendiz') add(f, 'aprendiz', 'Le enseñaste lo que sabías.');
    else if (k.relation === 'pareja') add(f, 'pareja', 'Compartisteis la vida.');
    else if (k.relation === 'hermano' || k.relation === 'hermana' || k.relation === 'nieto' || k.relation === 'nieta') add(f, k.relation, 'Es de tu familia.');
  }
  for (const b of Object.values(g.bonds).sort((a, b2) => b2.affection - a.affection)) {
    const f = folkById(w, b.folk);
    if (f && f.age >= 16 && (b.affection >= 0.55 || b.taught >= 2)) add(f, b.taught >= 2 ? 'discípulo' : f.gender === 'f' ? 'amiga' : 'amigo', b.taught >= 2 ? 'Aprendió de ti.' : 'Os unía una amistad de años.');
  }
  for (const biz of playerEco(w).businesses) for (const wk of biz.workers) {
    const f = folkById(w, wk);
    if (f && f.age >= 16) add(f, 'socio', `Trabajó contigo en el ${biz.kind}.`);
  }
  for (const o of orgsOf(w).filter((x) => x.player.rank >= 2)) {
    const best = o.members.map((m) => folkById(w, m)).filter((f): f is Folk => !!f?.alive && f.age >= 16 && f.lastMet >= 0).sort((a, b) => b.trust - a.trust)[0];
    if (best) add(best, `compañero de ${o.name}`, `Comparte vuestra causa en ${o.name}.`);
  }
  // Quien no tuvo a nadie también deja huella: alguien a quien inspiró.
  if (out.filter((s) => s.wait === 0).length < 2) {
    const inspired = life.folk.filter((f) => f.alive && f.age >= 16 && f.age <= 45 && f.lastMet >= 0 && !seen.has(f.id) && f.resentment < 0.3).sort((a, b) => b.trust + b.gratitude - (a.trust + a.gratitude))[0];
    if (inspired) add(inspired, 'alguien a quien inspiraste', 'Te admiraba más de lo que llegaste a saber.');
  }
  // Partidas antiguas: familia sin vecino en el mundo.
  for (const k of fam.filter((x) => !x.folkId)) {
    if (seen.has(`kin:${k.name}`)) continue;
    seen.add(`kin:${k.name}`);
    const p = previewEstate(w);
    out.push({ key: `kin:${k.name}`, name: k.name, relation: k.relation, age: k.age, wait: Math.max(0, 16 - k.age), character: 'de carácter propio', skills: [], why: 'Es de tu familia.', gains: p.gains, burdens: p.burdens });
  }
  if (!out.length) {
    // Ni siquiera eso: llega alguien nuevo al pueblo que oyó hablar de ti.
    out.push({ key: 'nuevo', name: 'alguien que llega al pueblo', relation: 'desconocido', age: 19, wait: 0, character: 'por descubrir', skills: [], why: 'Oyó hablar de ti en el camino.', gains: [], burdens: [] });
  }
  return out;
}

/** La crónica de una vida, con lo que pasó de verdad. */
export function lifeChronicle(w: WorldState): string[] {
  const life = w.life!;
  const p = life.player;
  const id = life.identity!;
  const out: string[] = [`Vivió ${p.age} años.`];
  const origin = p.origin;
  if (p.generation === 1) out.push(id.named ? `Llegó al valle sin recordar su pasado. Con el tiempo supo que se llamaba ${p.name}.` : 'Llegó al valle sin recordar su pasado, y nunca llegó a saber quién había sido.');
  else if (origin) out.push(origin);
  const picked = id.story.filter((e) => e.kind === 'cargo' || e.kind === 'logro').slice(0, 4);
  for (const e of picked) out.push(e.text);
  const treaties = life.politics?.treaties.filter((t) => t.by === 'jugador' && t.day >= p.since) ?? [];
  for (const t of treaties.slice(0, 2)) out.push(`Participó en la negociación del ${t.kind === 'paz' ? 'tratado de paz' : `tratado de ${t.kind}`} entre ${w.regions[t.a].name} y ${w.regions[t.b].name}.`);
  const kids = p.family.filter((k) => k.relation === 'hijo' || k.relation === 'hija');
  const partner = p.family.find((k) => k.relation === 'pareja');
  if (partner) out.push(`Compartió su vida con ${partner.name}.`);
  out.push(kids.length ? `Tuvo ${kids.length === 1 ? (kids[0].relation === 'hija' ? 'una hija' : 'un hijo') : `${kids.length} hijos`}${kids.some((k) => k.adopted) ? ' (no todos de su sangre)' : ''}.` : 'No tuvo hijos.');
  const app = p.family.filter((k) => k.relation === 'aprendiz');
  if (app.length) out.push(`Enseñó su oficio a ${app.map((k) => k.name).join(' y ')}.`);
  const errors = id.story.filter((e) => e.kind === 'error').slice(-1);
  for (const e of errors) out.push(e.text);
  if (p.death) out.push(`${p.death.text.charAt(0).toUpperCase()}${p.death.text.slice(1)}.`);
  return out;
}

/** Cómo le recordarán (un título sacado de lo que hizo). */
export function titleOf(w: WorldState): string {
  const life = w.life!;
  const pol = life.politics;
  const gen = life.player.generation;
  const mine = pol?.legacy.filter((l) => l.gen === gen) ?? [];
  if (mine.some((l) => l.kind === 'paz')) return 'quien trajo la paz';
  const ruled = w.regions.find((r) => pol?.govs[r.id]?.ruler === 'jugador');
  if (ruled) return `quien gobernó ${ruled.name}`;
  const founded = mine.find((l) => l.kind === 'organizacion');
  if (founded) return founded.text.replace(/^Fundó /, 'quien fundó ').replace(/\.$/, '');
  const fame = fameOf(w);
  if (fame) return `la persona ${fame}`;
  if (playerEco(w).businesses.length) return 'quien abrió negocio';
  return life.player.generation === 1 ? 'quien llegó sin memoria' : eraTitle(w);
}

/** Pasa el tiempo (años de verdad: el mundo sigue sin el jugador). */
export function skipDays(w: WorldState, days: number, step: (w: WorldState) => void): void {
  const g = gensOf(w);
  (g as typeof g & { interregnum?: boolean }).interregnum = true;
  for (let i = 0; i < days; i++) step(w);
  (g as typeof g & { interregnum?: boolean }).interregnum = false;
}

const inInterregnum = (w: WorldState) => !!(gensOf(w) as ReturnType<typeof gensOf> & { interregnum?: boolean }).interregnum;

export interface SuccessionResult {
  name: string;
  lines: string[];
  burdens: string[];
  waited: number;
}

/**
 * El relevo. `step` avanza un día del mundo (el motor): se usa si quien
 * continúa aún es menor y hay que esperar a que crezca.
 */
export function succeedTo(w: WorldState, key: string, honor: boolean, step?: (w: WorldState) => void, look?: Avatar['look']): SuccessionResult {
  const life = w.life!;
  const g = gensOf(w);
  const old = life.player;
  const oldId = life.identity!;
  const cands = successorsOf(w);
  const s = cands.find((c) => c.key === key) ?? cands[0];
  const deathDay = old.death?.day ?? w.day;
  const oldLabel = old.name === 'Sin nombre' ? 'el forastero sin nombre' : old.name;
  // 1) Lo que queda escrito: crónica, linaje, dinastía, archivo.
  const title = titleOf(w);
  const chronicle = lifeChronicle(w);
  if (!g.dynasty.name) g.dynasty.name = old.name === 'Sin nombre' ? 'los del forastero' : `la casa de ${old.name}`;
  addFame(w);
  const power = clamp(influenceLevel(w) / 5 * 0.7 + Math.min(0.3, oldId.needs.coins / 400 + playerEco(w).businesses.length * 0.06));
  g.dynasty.power.push({ gen: old.generation, day: deathDay, value: power });
  if (g.dynasty.power.length > 60) g.dynasty.power.shift();
  g.dynasty.members.push({ name: old.name, gen: old.generation, from: old.since, to: deathDay, age: old.age, title, cause: old.death?.cause ?? 'vejez', role: topSkill(oldId) });
  old.lineage.push({ name: old.name, fromDay: old.since, toDay: deathDay, title, relation: s.relation === 'hija' || s.relation === 'hijo' || s.relation === 'aprendiz' ? s.relation : 'sucesor', fem: !!(old.look as { fem?: boolean } | undefined)?.fem, age: old.age, chronicle });
  const ctx = makeCtx(w);
  record(ctx, { kind: 'personaje', text: `Muere ${oldLabel} a los ${old.age} años. Le recordarán como ${title}. ${s.folkId ? `${s.name}, ${s.relation === 'alguien a quien inspiraste' ? 'alguien a quien inspiró' : `su ${s.relation}`}, continúa su historia.` : ''}`, regions: [w.player.home], known: true, importance: 3, byPlayer: true });
  commitCtx(ctx);
  recordHist(w, { day: deathDay, kind: 'muerte', regionId: w.player.home, text: `Muere ${oldLabel}, ${title}, a los ${old.age} años.`, actor: oldLabel, gen: old.generation, importance: power > 0.45 ? 3 : 2, fame: clamp(0.3 + power * 0.6), witnessed: true });
  distillLegacy(w, title);
  // 2) El funeral: quienes le querían le lloran.
  const mourners: string[] = [];
  for (const b of Object.values(g.bonds)) {
    const f = folkById(w, b.folk);
    if (!f?.alive || b.affection < 0.4 || !f.p) continue;
    f.p.mourning = w.day + 5;
    f.p.emo.tristeza = clamp(f.p.emo.tristeza + 0.5);
    memorize(w, f, { kind: 'muerte', about: 'jugador', text: `Murió ${oldLabel}.`, w: -0.8, src: 'propio' });
    mourners.push(f.id);
  }
  societyOf(w).festivals.push({ regionId: w.player.home, day: w.day, kind: 'funeral', who: mourners.slice(0, 3) });
  logEvent(w, w.player.home, 'muerte', `Ha muerto ${oldLabel}. ${mourners.length > 4 ? 'Medio pueblo va al entierro.' : mourners.length ? 'Lo despiden los suyos.' : 'Casi nadie va al entierro.'}`, mourners);
  // 3) Quién continúa: si no es alguien del mundo, aparece (un pariente de fuera, alguien que llega).
  let heir = s.folkId ? folkById(w, s.folkId) : undefined;
  if (!heir) {
    const rng = new Rng(hashString(`heir:${w.day}:${s.key}`));
    heir = makeFolk(life, w, rng, w.player.home, 'campesino', Math.max(16, s.age), new Set(life.folk.map((f) => f.name)), { trust: 0.6, lastMet: w.day });
    if (s.key.startsWith('kin:')) heir.name = s.name;
    life.folk.push(heir);
  }
  // 4) El reparto (testamento o ley), antes de que pasen los años.
  const knowledgeTo = g.will?.lines.find((l) => l.asset === 'conocimiento')?.to ?? 'heredero';
  const estate = settleEstate(w, heir.id, heir.name);
  // 5) Los cargos no se heredan (salvo un señorío, si se honra el legado).
  cleanOffices(w, honor);
  // 6) Si es menor, el mundo sigue hasta que crezca.
  let waited = 0;
  if (heir.age < 16 && step) {
    waited = 16 - heir.age;
    life.player.pendingDeath = false;
    skipDays(w, waited * DAYS_PER_YEAR, step);
  }
  // 7) Toma el relevo: otra persona, otra vida.
  const heirFolk = heir;
  const origin = `Nació en ${w.regions[heirFolk.regionId].name}${s.relation === 'hijo' || s.relation === 'hija' ? `, ${s.relation === 'hija' ? 'hija' : 'hijo'} de ${oldLabel}` : s.relation === 'aprendiz' ? `, y aprendió el oficio de ${oldLabel}` : `; ${oldLabel} cambió su vida`}.`;
  const family = familyFromTies(w, heirFolk);
  const keep = honor ? 0.5 : 0.25;
  for (const f of life.folk) {
    if (!f.alive || f.id === heirFolk.id) continue;
    const t = tieOf(w, f.id, heirFolk.id);
    f.trust = clamp(0.5 + (t ? t.aff / 220 : 0) + (f.trust - 0.5) * keep);
    f.gratitude = clamp((t && t.aff > 40 ? 0.2 : 0) + f.gratitude * keep);
    f.resentment = clamp((t && t.aff < -30 ? 0.4 : 0) + f.resentment * keep * 1.2);
    if (t && t.fam > 25) f.lastMet = w.day;
    if (f.p) for (const m of f.p.mem) if (m.about === heirFolk.id) m.about = 'jugador';
  }
  // Los lazos del protagonista: los del heredero (los del anterior quedan como recuerdo).
  const bonds: typeof g.bonds = {};
  for (const t of tiesOf(w, heirFolk.id)) {
    const o = t.a === heirFolk.id ? t.b : t.a;
    if (t.aff < 25 && !t.kin) continue;
    const kind = t.kin === 'pareja' ? 'pareja' : t.kin === 'progenitor' && t.parent === heirFolk.id ? 'hijo' : t.aff < -30 ? 'rival' : 'amistad';
    bonds[o] = { folk: o, kind, affection: clamp(Math.abs(t.aff) / 100), since: w.day, taught: 0, gen: old.generation + 1 };
  }
  g.bonds = bonds;
  g.self = heirFolk.id;
  g.health = { value: 1, conditions: [], incapacitated: false };
  g.wantsChildren = false;
  const heirCoins = estate.heirCoins + (heirFolk.p?.coins ?? 0);
  life.identity = heirIdentity(w, oldId, old.name, honor, heirFolk, heirCoins, s.relation, knowledgeTo === 'heredero' || knowledgeTo === `vecino:${heirFolk.id}`);
  if (!(knowledgeTo === 'heredero' || knowledgeTo === `vecino:${heirFolk.id}`)) playerEco(w).notes = {};
  const derivedLook = look ?? lookFor(heirFolk);
  life.player = {
    ...old,
    name: heirFolk.name,
    age: heirFolk.age,
    birthDay: heirFolk.born,
    since: w.day,
    generation: old.generation + 1,
    family,
    inventory: { comida: old.inventory.comida, hierbas: old.inventory.hierbas, reliquias: old.inventory.reliquias },
    pendingDeath: false,
    death: undefined,
    look: derivedLook,
    origin,
  };
  // Si gobernaba quien hereda (o hereda un señorío), ahora gobierna el jugador.
  for (const r of w.regions) {
    const gv = life.politics?.govs[r.id];
    if (gv && gv.ruler === heirFolk.id) gv.ruler = 'jugador';
    if (gv) gv.council = gv.council.map((c) => (c === heirFolk.id ? 'jugador' : c));
  }
  // El heredero deja de ser un vecino más: ahora es el protagonista.
  for (const t of tiesOf(w, heirFolk.id)) dropTie(w, t);
  life.folk = life.folk.filter((f) => f.id !== heirFolk.id);
  for (const o of orgsOf(w)) o.members = o.members.filter((m) => m !== heirFolk.id);
  recordHist(w, { kind: 'herencia', regionId: w.player.home, text: `${heirFolk.name} toma el relevo de ${oldLabel}.`, actor: heirFolk.name, gen: old.generation + 1, importance: 1, fame: 0.25, witnessed: true });
  story(w, honor ? `Tomó el relevo de ${old.name} y decidió honrar su legado.` : `Tomó el relevo de ${old.name}, pero eligió su propio camino.`, 'despertar');
  updateStanding(w);
  syncAuthority(w);
  return { name: heirFolk.name, lines: [...estate.lines], burdens: estate.burdens, waited };
}

function topSkill(id: Identity): string {
  const top = (Object.entries(id.skills) as [SkillId, { level: number; xp: number }][]).sort((a, b) => b[1].xp - a[1].xp)[0];
  return top && top[1].level > 0 ? top[0] : 'sin oficio';
}

/** Cargos, grupos y promesas: no pasan solos al heredero. */
function cleanOffices(w: WorldState, honor: boolean): void {
  const pol = w.life!.politics;
  const id = w.life!.identity!;
  if (!pol) return;
  for (const r of w.regions) {
    const gv = pol.govs[r.id];
    if (!gv) continue;
    if (gv.ruler === 'jugador' && !(gv.system === 'monarquia' && honor)) gv.ruler = undefined;
    gv.council = gv.council.filter((c) => c !== 'jugador' || (gv.ruler === 'jugador'));
    if ((id.rank[r.id] ?? 0) >= 6 && gv.ruler !== 'jugador') id.rank[r.id] = 0;
  }
  for (const o of pol.orgs) {
    if (o.leader === 'jugador') o.leader = undefined;
    o.player.rank = honor && repOf(w, o) > 0.25 ? Math.min(1, o.player.rank) : 0;
    o.player.rep *= honor ? 0.5 : 0.2;
    o.player.task = undefined;
  }
  for (const r of pol.roles) r.lost ??= w.day;
  pol.candidacy = {};
  pol.promises = [];
  for (const k of Object.keys(pol.favors)) pol.favors[k] = Math.trunc((pol.favors[k] ?? 0) / 2);
  pol.offers = [];
}

/** La familia del nuevo protagonista: la suya (pareja, hijos, hermanos, padres). */
function familyFromTies(w: WorldState, f: Folk): Kin[] {
  const out: Kin[] = [];
  for (const k of kinOf(w, f.id)) {
    const o = folkById(w, k.id);
    if (!o?.alive || o.id === f.id || out.some((x) => x.folkId === o.id)) continue;
    const rel = k.rel as Kin['relation'];
    out.push({ name: o.name, relation: rel, age: o.age, folkId: o.id });
  }
  return out;
}

/** El aspecto del heredero (lo que ya se veía de él en el mundo). */
function lookFor(f: Folk): Avatar['look'] {
  const rng = new Rng(hashString(`look:${f.id}`));
  const fem = genderFor(f) === 'f';
  return { cloak: rng.pick(['#c9902c', '#8a2f2a', '#2f4f7a', '#3f5f3a', '#5a4a6a']), tunic: rng.pick(['#2f5f63', '#6a3a2a', '#4a5a2a', '#2a3a5a']), hair: rng.pick(fem ? ['largo', 'coleta', 'trenza'] : ['corto', 'rizado', 'rapado']), hairColor: rng.pick(['#2a1e14', '#4a3020', '#7a4a22', '#a8743a']), fem, beard: fem ? 'ninguna' : rng.pick(['ninguna', 'sombra', 'corta']), skin: rng.int(0, 6) };
}

const TEMPERS: [string, (f: Folk) => number][] = [
  ['inquieto', (f) => trait(f, 'curioso') + trait(f, 'valiente')],
  ['prudente', (f) => trait(f, 'desconfiado') + trait(f, 'cobarde')],
  ['ambicioso', (f) => trait(f, 'ambicioso') * 2],
  ['compasivo', (f) => trait(f, 'amable') + trait(f, 'generoso')],
  ['testarudo', (f) => trait(f, 'orgulloso') * 2],
  ['soñador', (f) => trait(f, 'curioso') + trait(f, 'perezoso')],
  ['callado', (f) => trait(f, 'reservado') + trait(f, 'timido')],
  ['alegre', (f) => trait(f, 'sociable') * 2],
];

/** La identidad del heredero: lo suyo (lo que aprendió, su oficio, su carácter) y parte de lo heredado. */
function heirIdentity(w: WorldState, prev: Identity, oldName: string, honor: boolean, f: Folk, coins: number, relation: string, keepsKnowledge: boolean): Identity {
  const life = w.life!;
  const next: Identity = JSON.parse(JSON.stringify(prev));
  next.lives = [...prev.lives, { name: oldName, story: prev.story }];
  next.story = [];
  next.named = true;
  next.nickname = f.name;
  next.past = null;
  next.fragments = [];
  next.items = prev.items.filter((x) => x !== 'colgante');
  next.latent = {};
  next.talents = [];
  next.offers = [];
  next.worked = {};
  next.vow = undefined;
  next.deeds = {};
  next.needs = { hunger: 0.2, fatigue: 0.1, coins, warned: 0 };
  next.temper = TEMPERS.sort((a, b) => b[1](f) - a[1](f))[0][0];
  next.housed = true; // vive en la casa de su familia (aunque la casa del anterior fuera a otro)
  next.vigor = vigorOf(f.age);
  for (const t of Object.values(next.skills)) Object.assign(t, { xp: 0, level: 0, found: -1, past: false });
  for (const t of Object.values(next.know)) Object.assign(t, { xp: 0, level: 0, found: -1, past: false });
  // Lo que aprendió en su vida (de sus padres, de su oficio, del protagonista).
  const learned: Partial<Record<LearnKey, number>> = { ...(f.learned ?? {}) };
  const own = ROLE_SKILL[f.role];
  if (own && f.role !== 'nino') learned[own] = Math.max(learned[own] ?? 0, 2);
  for (const [k, lv] of Object.entries(learned) as [LearnKey, number][]) {
    if (!lv) continue;
    const t = k.startsWith('k:') ? next.know[k.slice(2) as KnowId] : next.skills[k as SkillId];
    if (t) Object.assign(t, { xp: LEVEL_XP[Math.min(lv, LEVEL_XP.length - 1)], level: lv, found: w.day });
  }
  // La reputación pasa en parte; la del heredero también cuenta (ya le conocían).
  for (const k of Object.keys(next.score)) next.score[Number(k)] = (next.score[Number(k)] ?? 0) * (honor ? 0.6 : 0.25);
  next.score[f.regionId] = (next.score[f.regionId] ?? 0) + 6;
  next.rank = Object.fromEntries(Object.entries(prev.rank).map(([k, v]) => [k, (life.politics?.govs[Number(k)]?.ruler === 'jugador' ? 6 : honor ? Math.min(3, v ?? 0) : 0)]));
  next.standing = {};
  // Lo que sabía el anterior solo se conserva si se lo dejó (o se lo contó).
  const knew = ((f as Folk & { secrets?: string[] }).secrets ?? []);
  for (const s of life.politics?.secrets ?? []) if (s.known && !knew.includes(s.id)) s.known = keepsKnowledge && honor;
  next.story.push({ day: w.day, age: f.age, kind: 'despertar', text: `${relation === 'hijo' || relation === 'hija' ? `Creció a la sombra de ${oldName}` : `Conoció a ${oldName}`}. Ahora le tocaba a ${genderFor(f) === 'f' ? 'ella' : 'él'}.` });
  return next;
}

// ---------------------------------------------------------------------------
// Un día de generaciones
// ---------------------------------------------------------------------------
export function generationsDay(w: WorldState): string[] {
  const life = w.life!;
  if (!life.identity) return [];
  const g = gensOf(w);
  const out: string[] = [];
  ensureHeirlooms(w);
  if (!g.history.some((e) => e.kind === 'llegada') && life.player.generation === 1 && life.identity.mode === 'forastero') {
    recordHist(w, { day: life.player.since, kind: 'llegada', regionId: w.player.home, text: `Un desconocido llega a ${w.regions[w.player.home].name} sin recordar quién es.`, actor: life.player.name === 'Sin nombre' ? 'el forastero' : life.player.name, gen: 1, importance: 2, fame: 0.4, witnessed: true });
  }
  if (!inInterregnum(w)) healthDay(w);
  out.push(...estateDay(w));
  archiveDay(w);
  const year = yearOfDay(w.day);
  if (year !== g.lastYear) {
    g.lastYear = year;
    out.push(...historyYear(w));
    out.push(...housesYear(w));
    if (!inInterregnum(w)) familyYear(w, new Rng(hashString(`fam:${w.day}`)));
    pruneDead(w);
    if (!inInterregnum(w)) g.dynasty.power.push({ gen: life.player.generation, day: w.day, value: clamp(influenceLevel(w) / 5 * 0.7 + Math.min(0.3, life.identity.needs.coins / 400 + playerEco(w).businesses.length * 0.06)) });
    if (g.dynasty.power.length > 80) g.dynasty.power.shift();
  }
  return out;
}

/** La etapa de la vida del protagonista, en palabras. */
export function stageLines(w: WorldState): string[] {
  const p = w.life!.player;
  const st = STAGES[stageOf(p.age)];
  return [`${st.name} (${p.age} años).`, `A favor: ${st.good}`, `En contra: ${st.hard}`];
}

export { ancestorRel, bondOf, heirloomsHeld, partnerFolk };
