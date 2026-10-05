import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { gain, levelOf, story, KNOWS, SKILLS, type GainNote, type KnowId, type SkillId } from './identity';
import { compatibility, dropTie, makePersona, ensureTie, folkById, genderFor, kinOf, logEvent, memorize, partnerOf, playerRegion, societyOf, tieOf, tiesOf, trait, TRAITS } from './society';
import { makeFolk } from './folk';
import { playerEco } from './business';
import type { Folk, FolkRole, Kin } from './types';
import { DAYS_PER_YEAR } from './types';
import { gensOf, playerLabel, type Bond, type Condition, type LearnKey } from './genstate';

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
import { recordHist } from './history';
import { createHeirloom } from './estate';

/**
 * Fase 5: el jugador no es eterno. Envejece poco a poco (y cada etapa trae
 * ventajas propias), enferma, se hiere, puede quedar incapacitado y muere por
 * algo (la edad, una fiebre, una herida, el hambre, la guerra), nunca por
 * azar sin sentido. Puede tener pareja, hijos, adoptar, tomar aprendices o
 * quedarse solo: nada de eso es obligatorio. Lo que sabe se puede enseñar, y
 * lo enseñado sigue vivo en otros cuando él ya no está.
 */

// ---------------------------------------------------------------------------
// Etapas de la vida: cada una con sus ventajas
// ---------------------------------------------------------------------------
export type Stage = 'infancia' | 'adolescencia' | 'adultez' | 'madurez' | 'vejez';

export const STAGES: Record<Stage, { name: string; good: string; hard: string }> = {
  infancia: { name: 'Infancia', good: 'Aprende muy deprisa y todos le protegen.', hard: 'Depende de los adultos.' },
  adolescencia: { name: 'Adolescencia', good: 'Aprende rápido, tiene energía y decide por su cuenta.', hard: 'Le falta experiencia: no le toman en serio.' },
  adultez: { name: 'Adultez', good: 'Plena fuerza: trabajo, negocios, familia, política, viajes.', hard: 'Todo a la vez: el tiempo no alcanza.' },
  madurez: { name: 'Madurez', good: 'Experiencia e influencia: le escuchan más, negocia y dirige mejor.', hard: 'El cuerpo empieza a pedir descanso.' },
  vejez: { name: 'Vejez', good: 'Sabe lo que otros no: enseña mejor que nadie y su palabra pesa.', hard: 'Menos fuerza, más cansancio, la salud se resiente.' },
};

export function stageOf(age: number): Stage {
  return age < 12 ? 'infancia' : age < 18 ? 'adolescencia' : age < 40 ? 'adultez' : age < 60 ? 'madurez' : 'vejez';
}

/** Lo que la edad hace al cuerpo y a la mente (gradual, sin saltos). */
export function vigorOf(age: number): { body: number; mind: number; learn: number; teach: number; social: number } {
  const body = age < 18 ? 0.55 + (age / 18) * 0.45 : age < 40 ? 1 : age < 60 ? 1 - (age - 40) * 0.006 : Math.max(0.3, 0.88 - (age - 60) * 0.018);
  const mind = age < 18 ? 0.6 + (age / 18) * 0.35 : Math.min(1.3, 0.95 + Math.max(0, age - 25) * 0.009);
  const learn = age < 18 ? 1.6 - (age / 18) * 0.4 : Math.max(0.65, 1.2 - Math.max(0, age - 18) * 0.012);
  const teach = Math.min(1.6, 0.7 + Math.max(0, age - 20) * 0.018);
  const social = Math.min(1.25, 0.7 + Math.max(0, age - 16) * 0.012);
  return { body, mind, learn, teach, social };
}

/** Las habilidades que dependen del cuerpo (y las que dependen de la cabeza). */
export const BODY_SKILLS: SkillId[] = ['combate', 'agricultura', 'artesania', 'supervivencia', 'sigilo'];

// ---------------------------------------------------------------------------
// Salud y muerte
// ---------------------------------------------------------------------------
export function healthOf(w: WorldState) {
  return gensOf(w).health;
}

/** Una herida (en una batalla, un accidente…). */
export function injure(w: WorldState, severity: number, why: string): void {
  const h = healthOf(w);
  h.conditions.push({ kind: 'herida', since: w.day, until: w.day + Math.ceil(severity * 16), severity: clamp(severity), why });
  h.value = clamp(h.value - severity * 0.4);
}

const conditionWord: Record<Condition['kind'], string> = { fiebre: 'fiebre', herida: 'una herida', achaques: 'los achaques de la edad', hambre: 'hambre', agotamiento: 'agotamiento' };

/** Cómo está, en palabras. */
export function healthLines(w: WorldState): string[] {
  const h = healthOf(w);
  const p = w.life!.player;
  const out: string[] = [];
  out.push(h.value > 0.85 ? 'Te encuentras con fuerzas.' : h.value > 0.6 ? 'Estás bien, aunque no como antes.' : h.value > 0.35 ? 'Tu salud flaquea.' : 'Apenas te tienes en pie.');
  for (const c of h.conditions) out.push(`Arrastras ${conditionWord[c.kind]}${c.why ? ` (${c.why})` : ''}${c.severity > 0.6 ? ', y es grave' : ''}.`);
  if (h.incapacitated) out.push('No puedes trabajar ni luchar. Pero puedes hablar, enseñar y dejar las cosas en orden.');
  if (p.age >= 70 && !h.incapacitated) out.push('A tu edad, cada invierno cuenta.');
  return out;
}

/** Un amanecer en el cuerpo del protagonista: edad, enfermedades, heridas… y quizá la muerte. */
export function healthDay(w: WorldState): void {
  const life = w.life!;
  const id = life.identity;
  const p = life.player;
  if (!id || p.pendingDeath || id.mode === 'gobernante') return;
  const h = healthOf(w);
  const rng = new Rng((w.seed ^ Math.imul(w.day, 0x2f6b1d3) ^ 0xdead) >>> 0);
  const r = w.regions[playerRegion(w)];
  // Lo que pasa al cuerpo.
  if (id.needs.hunger >= 0.95 && !h.conditions.some((c) => c.kind === 'hambre')) h.conditions.push({ kind: 'hambre', since: w.day, until: w.day + 2, severity: 0.35, why: 'días sin comer bien' });
  if (id.needs.fatigue >= 0.95 && !h.conditions.some((c) => c.kind === 'agotamiento')) h.conditions.push({ kind: 'agotamiento', since: w.day, until: w.day + 2, severity: 0.25, why: 'sin descanso' });
  if (r.flags.fiebre && !h.conditions.some((c) => c.kind === 'fiebre') && rng.chance(0.06 * (1.4 - h.value) * (levelOf(id, 'medicina') >= 2 ? 0.4 : 1))) {
    const sev = clamp(0.25 + rng.range(0, 0.35) + Math.max(0, p.age - 55) * 0.01);
    h.conditions.push({ kind: 'fiebre', since: w.day, until: w.day + rng.int(4, 9), severity: sev, why: `la fiebre de ${r.name}` });
  }
  if (p.age >= 64 && !h.conditions.some((c) => c.kind === 'achaques')) h.conditions.push({ kind: 'achaques', since: w.day, severity: 0.15, why: 'los años' });
  for (const c of h.conditions) {
    if (c.kind === 'achaques') c.severity = clamp(0.1 + (p.age - 60) / 45);
    // Las medicinas y el descanso curan antes.
    if ((c.kind === 'fiebre' || c.kind === 'herida') && (playerEco(w).cargo.medicinas ?? 0) >= 1 && c.severity > 0.2) {
      playerEco(w).cargo.medicinas! -= 1;
      if (!playerEco(w).cargo.medicinas) delete playerEco(w).cargo.medicinas;
      c.severity = clamp(c.severity - 0.2);
    }
    if (c.kind === 'herida' && id.needs.fatigue < 0.3) c.severity = clamp(c.severity - 0.04);
  }
  h.conditions = h.conditions.filter((c) => c.until === undefined || c.until > w.day || c.severity > 0.65);
  const load = h.conditions.reduce((s, c) => s + c.severity * (c.kind === 'achaques' ? 0.4 : 0.55), 0);
  const target = clamp(1 - Math.max(0, p.age - 52) * 0.012 - load);
  h.value = clamp(h.value + (target - h.value) * 0.15);
  h.incapacitated = h.value < 0.3;
  id.vigor = { ...vigorOf(p.age), body: vigorOf(p.age).body * (0.55 + h.value * 0.45) };
  // ¿Muere hoy? La edad, la salud y lo que arrastra; nunca un dado sin causa.
  const yearRisk = p.age < 45 ? 0.0015 : 0.0015 + Math.pow((p.age - 45) / 40, 3) * 0.6;
  const parts: { cause: string; v: number }[] = [{ cause: 'vejez', v: (yearRisk / DAYS_PER_YEAR) * (1.7 - h.value) }];
  for (const c of h.conditions) {
    const old = p.age > 60 ? 2 : 1;
    if (c.kind === 'fiebre') parts.push({ cause: 'fiebre', v: Math.max(0, c.severity - 0.35) * 0.012 * old });
    if (c.kind === 'herida') parts.push({ cause: 'herida', v: Math.max(0, c.severity - 0.4) * 0.012 * old });
    if (c.kind === 'hambre') parts.push({ cause: 'hambre', v: 0.0015 * old });
  }
  if (p.age >= 96) parts.push({ cause: 'vejez', v: 1 });
  const risk = parts.reduce((s, x) => s + x.v, 0);
  if (rng.chance(risk)) die(w, parts.sort((a, b) => b.v - a.v)[0].cause);
}


const DEATH_TEXT: Record<string, string> = {
  vejez: 'se apagó de viejo, en su cama',
  fiebre: 'murió de fiebre',
  herida: 'no se recuperó de sus heridas',
  hambre: 'murió en tiempos de hambre',
  guerra: 'cayó en la guerra',
  accidente: 'murió en un accidente',
};

/** La muerte del protagonista: no termina la partida, abre una transición. */
export function die(w: WorldState, cause: string, where?: string): void {
  const life = w.life!;
  const p = life.player;
  if (p.pendingDeath) return;
  p.pendingDeath = true;
  const season = ['primavera', 'verano', 'otoño', 'invierno'][Math.floor(((w.day - 1) % DAYS_PER_YEAR) / 5)];
  p.death = { day: w.day, cause, text: `${DEATH_TEXT[cause] ?? 'murió'}${where ? ` ${where}` : ''}, en ${season === 'invierno' ? 'pleno invierno' : season === 'otoño' ? 'otoño' : season === 'verano' ? 'verano' : 'primavera'}`, regionId: w.player.home };
}

// ---------------------------------------------------------------------------
// Lazos del protagonista: amigos, pareja, hijos, aprendices
// ---------------------------------------------------------------------------
export function bondOf(w: WorldState, folkId: string): Bond | undefined {
  return gensOf(w).bonds[folkId];
}

function ensureBond(w: WorldState, folkId: string, kind: Bond['kind'] = 'amistad'): Bond {
  const g = gensOf(w);
  return (g.bonds[folkId] ??= { folk: folkId, kind, affection: 0.2, since: w.day, taught: 0, gen: w.life!.player.generation });
}

/** Cómo es el protagonista, en rasgos (para la compatibilidad y para sus hijos). */
export function playerTraits(w: WorldState): Record<(typeof TRAITS)[number], number> {
  const id = w.life!.identity!;
  const t = Object.fromEntries(TRAITS.map((k) => [k, 50])) as Record<(typeof TRAITS)[number], number>;
  const temper = id.temper ?? '';
  const bias: Record<string, Partial<typeof t>> = {
    inquieto: { curioso: 75, valiente: 62 }, prudente: { desconfiado: 62, cobarde: 58 }, ambicioso: { ambicioso: 80, orgulloso: 62 }, compasivo: { amable: 80, generoso: 75 },
    testarudo: { orgulloso: 75, desconfiado: 58 }, 'soñador': { curioso: 72, perezoso: 58 }, callado: { reservado: 75, timido: 62 }, alegre: { sociable: 80, amable: 64 },
  };
  Object.assign(t, bias[temper] ?? {});
  const d = id.deeds;
  if ((d.ayudar ?? 0) > 5) t.generoso = Math.min(95, t.generoso + 15);
  if ((d.enganar ?? 0) > 3) t.amable = Math.max(10, t.amable - 15);
  if ((d.trabajar ?? 0) > 10) t.trabajador = Math.min(95, t.trabajador + 15);
  return t;
}

/** Cada conversación acerca (o no): el cariño depende de cómo encajan. */
export function talkedWith(w: WorldState, f: Folk): void {
  if (!f.alive || f.age < 6 || !f.p) return;
  const b = ensureBond(w, f.id);
  const pt = playerTraits(w);
  const fake = { ...f, p: { ...f.p, t: pt } } as Folk;
  const compat = compatibility(fake, f);
  if (w.day !== (b as Bond & { lastTalk?: number }).lastTalk) {
    b.affection = clamp(b.affection + 0.025 + compat * 0.02 + f.gratitude * 0.01 - f.resentment * 0.03);
    (b as Bond & { lastTalk?: number }).lastTalk = w.day;
  }
  if (b.kind === 'amistad' && f.resentment > 0.55 && b.affection < 0.15) b.kind = 'rival';
}

const isKinOfPlayer = (w: WorldState, folkId: string) => w.life!.player.family.some((k) => k.folkId === folkId);

/** ¿Podría ser su pareja? (adulto, sin pareja, no de la familia) */
export function canCourt(w: WorldState, f: Folk): boolean {
  const p = w.life!.player;
  const b = bondOf(w, f.id);
  return f.alive && f.age >= 18 && p.age >= 18 && Math.abs(f.age - p.age) <= 18 && !partnerOf(w, f.id) && !isKinOfPlayer(w, f.id) && !partnerFolk(w) && (b?.affection ?? 0) >= 0.3 && f.role !== 'nino';
}

export const partnerFolk = (w: WorldState): Folk | undefined => {
  const b = Object.values(gensOf(w).bonds).find((x) => x.kind === 'pareja');
  const f = b ? folkById(w, b.folk) : undefined;
  return f?.alive ? f : undefined;
};

/** Cortejar: a veces sale bien, a veces no; depende de cuánto os queréis y de cómo eres. */
export function court(w: WorldState, f: Folk): { ok: boolean; lines: string[]; notes: GainNote[] } {
  const id = w.life!.identity!;
  const b = ensureBond(w, f.id);
  const rng = new Rng(hashString(`court:${f.id}:${w.day}`));
  const odds = b.affection * 0.8 + (f.trust - 0.5) * 0.4 + levelOf(id, 'persuasion') * 0.04 - (trait(f, 'timido') - 50) / 300;
  const notes = gain(w, 'persuasion', 0.3);
  w.life!.clock += 90;
  if (rng.chance(clamp(odds, 0.05, 0.9))) {
    b.affection = clamp(b.affection + 0.12);
    return { ok: true, lines: [rng.pick(['Pasáis la tarde paseando junto al río. Se ríe de tus historias.', 'Os sentáis en la plaza hasta que se encienden los faroles.', 'Te enseña su rincón favorito del pueblo. Es la primera vez que lo comparte con alguien.'])], notes };
  }
  b.affection = clamp(b.affection - 0.04);
  return { ok: false, lines: [rng.pick(['«Hoy no, de verdad.» Sonríe, pero se va.', 'Parece incómodo. Quizá vas demasiado deprisa.', '«Eres buena gente. Pero no sé…»'])], notes };
}

/** Pedirle que comparta la vida contigo. */
export function proposeUnion(w: WorldState, f: Folk): { ok: boolean; lines: string[] } {
  const life = w.life!;
  const b = ensureBond(w, f.id);
  if (b.affection < 0.65 || partnerOf(w, f.id)) return { ok: false, lines: ['«Te aprecio. Pero no así. Todavía no.»'] };
  b.kind = 'pareja';
  gensOf(w).partnerSince = w.day;
  // Si tenía pareja entre los vecinos, esa historia termina.
  for (const t of tiesOf(w, f.id)) if (t.kin === 'pareja') t.kin = 'expareja';
  f.trust = Math.max(f.trust, 0.85);
  f.gratitude = Math.max(f.gratitude, 0.5);
  f.lastMet = w.day;
  life.player.family = life.player.family.filter((k) => k.folkId !== f.id);
  life.player.family.unshift({ name: f.name, relation: 'pareja', age: f.age, folkId: f.id });
  memorize(w, f, { kind: 'boda', about: 'jugador', text: 'Nos casamos.', w: 0.95, src: 'propio' });
  story(w, `Compartió su vida con ${f.name}.`, 'relacion');
  logEvent(w, f.regionId, 'boda', `${f.name} y ${playerLabel(w)} se han casado. Hubo fiesta en la plaza.`, [f.id]);
  societyOf(w).festivals.push({ regionId: f.regionId, day: w.day, kind: 'boda', who: [f.id] });
  createHeirloom(w, 'anillo', `El anillo de la boda con ${f.name}`, `Lo intercambiaron el día de su boda, en ${w.regions[f.regionId].name}.`);
  recordHist(w, { kind: 'boda', regionId: f.regionId, text: `${cap(playerLabel(w))} se casa con ${f.name}.`, actor: playerLabel(w), gen: life.player.generation, importance: 1, fame: 0.25, witnessed: true });
  return { ok: true, lines: [`${f.name} se queda en silencio un momento. Luego te coge la mano. «Sí.»`] };
}

/** Decidir juntos si tener hijos (o no). */
export function talkChildren(w: WorldState, f: Folk, want: boolean): string {
  const g = gensOf(w);
  const theyWant = trait(f, 'amable') + trait(f, 'generoso') - trait(f, 'ambicioso') * 0.5 > 50;
  g.wantsChildren = want && (theyWant || bondOf(w, f.id)!.affection > 0.8);
  if (!want) return '«Está bien así. Nos tenemos el uno al otro.»';
  return g.wantsChildren ? `${f.name} sonríe. «Yo también lo he pensado.»` : `${f.name} duda. «Ahora no. Quizá más adelante.»`;
}

/** Cada año en familia: puede llegar un hijo (si los dos quieren y aún hay edad). */
export function familyYear(w: WorldState, rng: Rng): void {
  const life = w.life!;
  const p = life.player;
  const partner = partnerFolk(w);
  for (const k of p.family) {
    const f = k.folkId ? folkById(w, k.folkId) : undefined;
    if (f) k.age = f.age;
  }
  p.family = p.family.filter((k) => !k.folkId || folkById(w, k.folkId)?.alive);
  if (!partner || !gensOf(w).wantsChildren || p.age >= 50 || partner.age >= 46) return;
  const kids = p.family.filter((k) => (k.relation === 'hijo' || k.relation === 'hija') && !k.adopted).length;
  if (!rng.chance(kids >= 4 ? 0.08 : 0.35)) return;
  birthChild(w, partner, rng);
}

export function birthChild(w: WorldState, partner: Folk, rng: Rng): Folk {
  const life = w.life!;
  const used = new Set(life.folk.map((f) => f.name));
  const baby = makeFolk(life, w, rng, partner.regionId, 'nino', 0, used, { parentId: partner.id, trust: 0.9, gratitude: 0.5, lastMet: w.day });
  baby.born = w.day;
  baby.houseId = 'dyn';
  life.folk.push(baby);
  baby.gender = genderFor(baby);
  baby.p = makePersona(w, baby);
  // Sus padres: tu pareja (y tú, que no eres un vecino más). Sus hermanos: tus otros hijos.
  Object.assign(ensureTie(w, partner.id, baby.id), { kin: 'progenitor', parent: partner.id, aff: 88, fam: 95 });
  for (const k of life.player.family) if (k.folkId && (k.relation === 'hijo' || k.relation === 'hija') && k.folkId !== baby.id) Object.assign(ensureTie(w, k.folkId, baby.id), { kin: 'hermanos', aff: 45, fam: 85 });
  baby.house = partner.house;
  memorize(w, partner, { kind: 'nacimiento', about: baby.id, text: `Nació ${baby.name}.`, w: 0.9, src: 'propio' });
  logEvent(w, partner.regionId, 'nacimiento', `Ha nacido ${baby.name}, de ${partner.name} y ${playerLabel(w)}.`, [partner.id, baby.id]);
  inheritTraits(w, baby, [partner], playerTraits(w));
  baby.gender = genderFor(baby);
  const rel = baby.gender === 'f' ? 'hija' : 'hijo';
  life.player.family.push({ name: baby.name, relation: rel, age: 0, folkId: baby.id });
  const b = ensureBond(w, baby.id, 'hijo');
  b.kind = 'hijo';
  b.affection = 0.9;
  story(w, `Nació ${rel === 'hija' ? 'su hija' : 'su hijo'} ${baby.name}.`, 'relacion');
  recordHist(w, { kind: 'nacimiento', regionId: partner.regionId, text: `Nace ${baby.name}, ${rel} de ${playerLabel(w)} y ${partner.name}.`, actor: playerLabel(w), gen: life.player.generation, importance: 1, fame: 0.2, witnessed: true });
  return baby;
}

/** Huérfanos: niños sin nadie que les cuide. */
export function isOrphan(w: WorldState, f: Folk): boolean {
  if (!f.alive || f.age >= 14) return false;
  return !kinOf(w, f.id).some((k) => (k.rel === 'padre' || k.rel === 'madre') && folkById(w, k.id)?.alive);
}

export function adopt(w: WorldState, f: Folk): string {
  const life = w.life!;
  const b = ensureBond(w, f.id, 'hijo');
  b.kind = 'hijo';
  b.adopted = true;
  b.affection = Math.max(b.affection, 0.6);
  f.trust = Math.max(f.trust, 0.75);
  f.lastMet = w.day;
  f.houseId = 'dyn';
  const rel = genderFor(f) === 'f' ? 'hija' : 'hijo';
  life.player.family.push({ name: f.name, relation: rel, age: f.age, folkId: f.id, adopted: true });
  memorize(w, f, { kind: 'refugio', about: 'jugador', text: 'Me dio una casa cuando no tenía a nadie.', w: 0.95, src: 'propio' });
  story(w, `Acogió a ${f.name} como ${rel}.`, 'relacion');
  logEvent(w, f.regionId, 'familia', `${cap(playerLabel(w))} ha acogido a ${f.name}, que no tenía a nadie.`, [f.id]);
  return `${f.name} te mira sin entender del todo. Luego coge su hatillo y te sigue.`;
}

export function takeApprentice(w: WorldState, f: Folk): string {
  const life = w.life!;
  const b = ensureBond(w, f.id, 'aprendiz');
  b.kind = 'aprendiz';
  life.player.family = life.player.family.filter((k) => k.folkId !== f.id);
  life.player.family.push({ name: f.name, relation: 'aprendiz', age: f.age, folkId: f.id });
  memorize(w, f, { kind: 'aprendiz', about: 'jugador', text: 'Me tomó como aprendiz.', w: 0.7, src: 'propio' });
  story(w, `Tomó a ${f.name} como aprendiz.`, 'relacion');
  return `«¿De verdad?» A ${f.name} le brillan los ojos. «No te defraudaré.»`;
}

export const canApprentice = (w: WorldState, f: Folk) => f.alive && f.age >= 12 && f.age <= 35 && (bondOf(w, f.id)?.taught ?? 0) >= 3 && f.trust >= 0.6 && bondOf(w, f.id)?.kind !== 'aprendiz' && !isKinOfPlayer(w, f.id);

// ---------------------------------------------------------------------------
// Enseñar: lo que sabes puede sobrevivirte
// ---------------------------------------------------------------------------
export const keyName = (k: LearnKey) => (k.startsWith('k:') ? KNOWS[k.slice(2) as KnowId].name : SKILLS[k as SkillId].name);

/** Lo que el protagonista sabe y podría enseñar. */
export function teachable(w: WorldState): LearnKey[] {
  const id = w.life!.identity!;
  return [...(Object.keys(id.skills) as SkillId[]).filter((k) => id.skills[k].level >= 1), ...(Object.keys(id.know) as KnowId[]).filter((k) => id.know[k].level >= 1).map((k) => `k:${k}` as LearnKey)];
}

export function teach(w: WorldState, f: Folk, key: LearnKey): { ok: boolean; lines: string[]; notes: GainNote[] } {
  const id = w.life!.identity!;
  const mine = levelOf(id, key);
  if (mine < 1) return { ok: false, lines: ['No sabes lo bastante de eso para enseñarlo.'], notes: [] };
  const cur = f.learned?.[key] ?? 0;
  if (cur >= mine) return { ok: false, lines: [`${f.name} ya sabe de ${keyName(key).toLowerCase()} tanto como tú.`], notes: [] };
  const rng = new Rng(hashString(`teach:${f.id}:${key}:${w.day}:${Math.floor(w.life!.clock / 120)}`));
  const v = vigorOf(w.life!.player.age);
  const learnerAge = vigorOf(f.age).learn;
  const odds = 0.3 + mine * 0.07 + (v.teach - 1) * 0.3 + (learnerAge - 1) * 0.3 + (trait(f, 'curioso') - 50) / 250 + (f.trust - 0.5) * 0.3;
  const b = ensureBond(w, f.id);
  b.taught++;
  b.affection = clamp(b.affection + 0.04);
  f.trust = clamp(f.trust + 0.03);
  f.lastMet = w.day;
  w.life!.clock += 120;
  const notes = gain(w, 'liderazgo', 0.15);
  if (!rng.chance(clamp(odds, 0.15, 0.95))) return { ok: false, lines: [`Pasáis la tarde con ${keyName(key).toLowerCase()}. A ${f.name} le cuesta; tendréis que volver a intentarlo.`], notes };
  (f.learned ??= {})[key] = cur + 1;
  memorize(w, f, { kind: 'leccion', about: 'jugador', text: `Me enseñó ${keyName(key).toLowerCase()}.`, w: 0.45, src: 'propio' });
  if (cur + 1 >= 2) story(w, `Enseñó ${keyName(key).toLowerCase()} a ${f.name}.`, 'decision');
  return { ok: true, lines: [cur === 0 ? `${f.name} empieza a entender lo básico de ${keyName(key).toLowerCase()}.` : `${f.name} ya sabe más de ${keyName(key).toLowerCase()}. Se nota que le has dedicado tiempo.`], notes };
}

/** Compartir un secreto con alguien (para que lo sepa cuando tú ya no estés). */
export function shareSecret(w: WorldState, f: Folk, secretId: string): string {
  const s = w.life!.politics?.secrets.find((x) => x.id === secretId);
  if (!s) return 'No hay nada que contar.';
  if (!s.holders.includes(f.id)) s.holders.push(f.id);
  ((f as Folk & { secrets?: string[] }).secrets ??= []).push(secretId);
  ensureBond(w, f.id).affection += 0.02;
  return `${f.name} escucha sin parpadear. «Lo guardaré.»`;
}

// ---------------------------------------------------------------------------
// Los vecinos también envejecen, aprenden de sus padres y se parecen a ellos
// ---------------------------------------------------------------------------
/** El oficio de cada uno, como habilidad que se enseña en casa. */
export const ROLE_SKILL: Partial<Record<FolkRole, LearnKey>> = {
  campesino: 'agricultura', pastor: 'agricultura', pescador: 'supervivencia', comerciante: 'comercio', posadero: 'comercio', guardia: 'combate',
  artesano: 'artesania', carpintero: 'artesania', tejedor: 'artesania', minero: 'artesania', lenador: 'supervivencia', sanadora: 'medicina',
  exploradora: 'supervivencia', lider: 'liderazgo', anciano: 'k:historia',
};

/** Los hijos se parecen a sus padres (en parte): carácter mezclado y un poco propio. */
export function inheritTraits(w: WorldState, baby: Folk, parents: Folk[], extra?: Record<string, number>): void {
  if (!baby.p) return;
  const rng = new Rng(hashString(`gen:${baby.id}`));
  const sources = [...parents.filter((x) => x.p).map((x) => x.p!.t as Record<string, number>), ...(extra ? [extra] : [])];
  if (!sources.length) return;
  for (const k of TRAITS) {
    const avg = sources.reduce((s, t) => s + (t[k] ?? 50), 0) / sources.length;
    baby.p.t[k] = Math.round(clamp((avg * 0.6 + baby.p.t[k] * 0.4 + rng.range(-12, 12)) / 100) * 100);
  }
}

/** Al crecer, cada uno sabe algo de lo que se hacía en su casa (y de lo que les enseñaron). */
export function educate(w: WorldState, f: Folk): void {
  const parents = kinOf(w, f.id).filter((k) => k.rel === 'padre' || k.rel === 'madre').map((k) => folkById(w, k.id)).filter((x): x is Folk => !!x);
  f.learned ??= {};
  for (const p of parents) {
    const sk = ROLE_SKILL[p.role];
    if (sk) f.learned[sk] = Math.max(f.learned[sk] ?? 0, 1 + ((p.learned?.[sk] ?? 0) >= 2 ? 1 : 0));
    // Lo que los padres aprendieron de otros (también del protagonista) pasa a los hijos.
    for (const [k, lv] of Object.entries(p.learned ?? {}) as [LearnKey, number][]) if (lv >= 2) f.learned[k] = Math.max(f.learned[k] ?? 0, lv - 1);
    if (!f.houseId && p.houseId) f.houseId = p.houseId;
  }
}

/** Un niño que te conoció crece y te recuerda; los viejos recuerdan a tus antepasados. */
export function generationalLine(w: WorldState, f: Folk, rng: Rng): string | null {
  const life = w.life!;
  const gen = life.player.generation;
  const mine = f.memories.filter((m) => m.gen === gen);
  const first = mine.length ? Math.min(...mine.map((m) => m.day)) : f.lastMet;
  if (first >= 0) {
    const ageThen = f.age - (w.day - first) / DAYS_PER_YEAR;
    if (ageThen < 14 && f.age >= 18 && w.day - first >= DAYS_PER_YEAR * 5) {
      const good = mine.find((m) => m.weight > 0.2);
      return `No sé si me recuerdas. Yo era ${genderFor(f) === 'f' ? 'la niña' : 'el niño'} que ${f.role === 'campesino' ? 'correteaba por los campos' : 'vivía cerca de la plaza'}${good ? `. Nunca olvidé que ${good.kind === 'comida' ? 'nos diste de comer' : good.kind === 'refugio' ? 'nos abriste la puerta' : 'nos ayudaste'}` : ''}.`;
    }
  }
  const before = f.memories.filter((m) => m.gen < gen).sort((a, b) => b.gen - a.gen)[0];
  if (before) {
    const word = ancestorRel(w, before.gen);
    const anc = life.player.lineage[before.gen - 1];
    return before.weight >= 0 ? `Conocí a ${anc?.name ?? 'alguien de tu familia'}, ${word}. ${rng.pick(['Te pareces en la mirada.', 'Era buena gente. Espero que tú también.', 'Me ayudó cuando nadie lo hacía.'])}` : `Conocí a ${anc?.name ?? 'alguien de tu familia'}, ${word}. No le guardo cariño, y tú llevas su sangre.`;
  }
  return null;
}

/** Cómo se llama a un antepasado desde la generación actual. */
export function ancestorRel(w: WorldState, gen: number): string {
  const life = w.life!;
  const d = life.player.generation - gen;
  const a = life.player.lineage[gen - 1];
  const fem = (a as { fem?: boolean } | undefined)?.fem;
  const next = life.player.lineage[gen];
  if (d === 1 && (next?.relation === 'aprendiz' || a?.relation === 'aprendiz')) return fem ? 'tu maestra' : 'tu maestro';
  if (d <= 1) return a?.relation === 'aprendiz' ? (fem ? 'tu maestra' : 'tu maestro') : fem ? 'tu madre' : 'tu padre';
  if (d === 2) return fem ? 'tu abuela' : 'tu abuelo';
  if (d === 3) return fem ? 'tu bisabuela' : 'tu bisabuelo';
  return 'una de tus antepasadas o antepasados';
}

// ---------------------------------------------------------------------------
// Limpieza: los muertos de hace mucho pasan al archivo (rendimiento en Android)
// ---------------------------------------------------------------------------
export function pruneDead(w: WorldState): void {
  const life = w.life!;
  const g = gensOf(w);
  const keep = new Set([...Object.keys(g.bonds), ...life.player.family.map((k) => k.folkId).filter(Boolean)] as string[]);
  const gone = life.folk.filter((f) => !f.alive && !f.charId && !keep.has(f.id) && w.day - (f.died ?? w.day) > DAYS_PER_YEAR * 25);
  if (!gone.length) return;
  const ids = new Set(gone.map((f) => f.id));
  for (const f of gone) for (const t of tiesOf(w, f.id)) dropTie(w, t);
  life.folk = life.folk.filter((f) => !ids.has(f.id));
  // El registro del motor también se poda: solo queda lo importante (ya está en el archivo histórico).
  if (w.entries.length > 900) {
    const cut = w.entries.length - 600;
    w.entries = w.entries.filter((e, i) => i >= cut || e.importance >= 3 || e.byPlayer);
    if (w.entries.length > 1400) w.entries = w.entries.slice(-1200);
  }
}

export { tieOf, ensureTie };
export type { Kin };
