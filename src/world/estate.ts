import { Rng, hashString } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { GOOD, marketOf, type Good } from './economy';
import { playerEco } from './business';
import { story } from './identity';
import { folkById, logEvent, memorize, tieOf, trait } from './society';
import { migrate, changeJob } from './arcs';
import type { Folk } from './types';
import { gensOf, gid, type Asset, type Beneficiary, type Debt, type Dispute, type Heirloom } from './genstate';
import { orgById } from './orgs';
import { lawsOf } from './politics';
import { recordHist } from './history';
import { cultureOf, profileOf } from './culture';

/**
 * Lo que queda: casa, dinero, carga, negocios, objetos con historia,
 * conocimiento. Se reparte según el testamento (si lo hay) o según la ley
 * del pueblo, y no siempre en paz: dos hermanos pueden querer lo mismo.
 * Lo heredado también pesa: deudas, enemigos, expectativas.
 */

// ---------------------------------------------------------------------------
// Objetos con historia
// ---------------------------------------------------------------------------
export function heirloomsHeld(w: WorldState, holder = 'jugador'): Heirloom[] {
  return gensOf(w).heirlooms.filter((h) => h.holder === holder);
}

export function createHeirloom(w: WorldState, kind: Heirloom['kind'], name: string, origin: string): Heirloom {
  const g = gensOf(w);
  const same = g.heirlooms.find((h) => h.kind === kind && h.holder === 'jugador' && (kind === 'espada' || kind === 'colgante' || kind === 'cuaderno'));
  if (same) return same;
  const p = w.life!.player;
  const h: Heirloom = { id: gid(w, 'h'), name, kind, made: w.day, origin, holder: 'jugador', owners: [{ name: p.name, gen: p.generation, from: w.day }], deeds: [] };
  g.heirlooms.push(h);
  return h;
}

/** El colgante con el que despertó (partidas nuevas y antiguas). */
export function ensureHeirlooms(w: WorldState): void {
  const id = w.life?.identity;
  if (!id) return;
  if (id.items.includes('colgante') && !gensOf(w).heirlooms.some((h) => h.kind === 'colgante')) createHeirloom(w, 'colgante', 'El colgante del símbolo', 'Lo llevaba al cuello quien despertó sin memoria junto al camino.');
}

/** Lo que pasa mientras alguien lleva el objeto, se queda en él. */
export function heirloomDeed(w: WorldState, text: string): void {
  for (const h of heirloomsHeld(w)) {
    h.deeds.push({ day: w.day, text });
    if (h.deeds.length > 6) h.deeds.splice(1, 1); // se conserva la primera y las últimas
  }
}

export function passHeirloom(w: WorldState, h: Heirloom, to: string, toName: string, gen?: number): void {
  const last = h.owners[h.owners.length - 1];
  if (last && last.to === undefined) last.to = w.day;
  h.holder = to;
  h.owners.push({ name: toName, folk: to.startsWith('v') ? to : undefined, gen, from: w.day });
}

export function describeHeirloom(w: WorldState, h: Heirloom): string[] {
  const out = [h.origin];
  if (h.owners.length > 1) out.push(`Ha pasado por ${h.owners.length} manos: ${h.owners.map((o) => o.name).join(', ')}.`);
  for (const d of h.deeds.slice(-3)) out.push(`Estuvo allí cuando: ${d.text.charAt(0).toLowerCase()}${d.text.slice(1)}`);
  return out;
}

/** Alguien reconoce el objeto: lo vio en manos de otro, hace años. */
export function recognizeHeirloom(w: WorldState, f: Folk): string | null {
  for (const h of heirloomsHeld(w)) {
    const prev = h.owners.slice(0, -1).reverse().find((o) => o.gen !== undefined && f.memories.some((m) => m.gen === o.gen));
    if (prev && f.age >= 30) return `Ese ${h.kind === 'espada' ? 'acero' : h.kind}… ${h.kind === 'espada' ? 'la' : 'lo'} llevaba ${prev.name}. Lo reconocería en cualquier parte.`;
  }
  const mine = gensOf(w).heirlooms.find((h) => h.holder === f.id);
  if (mine) return `Guardo algo que fue de ${mine.owners[mine.owners.length - 2]?.name ?? 'tu familia'}: ${mine.name.toLowerCase()}. Me lo dejó antes de morir.`;
  return null;
}

// ---------------------------------------------------------------------------
// Testamento
// ---------------------------------------------------------------------------
export interface AssetInfo {
  asset: Asset;
  label: string;
  value: number;
}

export function assetsOf(w: WorldState): AssetInfo[] {
  const id = w.life!.identity!;
  const pe = playerEco(w);
  const out: AssetInfo[] = [];
  if (id.needs.coins > 0) out.push({ asset: 'monedas', label: `${id.needs.coins} monedas`, value: id.needs.coins });
  if (id.housed) out.push({ asset: 'casa', label: 'La casa', value: 40 });
  const cargo = Object.entries(pe.cargo).reduce((s, [g, n]) => s + (n ?? 0) * GOOD[g as Good].base, 0);
  if (cargo > 0 || pe.vehicle !== 'pie') out.push({ asset: 'carga', label: `La carga${pe.vehicle !== 'pie' ? ` y la ${pe.vehicle}` : ''}`, value: Math.round(cargo + (pe.vehicle === 'carreta' ? 34 : pe.vehicle === 'mula' ? 14 : 0)) });
  for (const b of pe.businesses) out.push({ asset: `negocio:${b.id}`, label: `El ${b.kind === 'puesto' ? 'puesto' : b.kind === 'granja' ? 'campo' : 'transporte'} de ${w.regions[b.regionId].name}`, value: Math.round(20 + b.cash) });
  for (const h of heirloomsHeld(w)) out.push({ asset: `objeto:${h.id}`, label: h.name, value: 10 + h.deeds.length * 5 });
  const secrets = w.life!.politics?.secrets.filter((s) => s.known).length ?? 0;
  if (secrets || Object.keys(pe.notes).length) out.push({ asset: 'conocimiento', label: 'Tus cuadernos y lo que sabes', value: secrets * 5 + Object.keys(pe.notes).length * 2 });
  return out;
}

export function setWill(w: WorldState, asset: Asset, to: Beneficiary): void {
  const g = gensOf(w);
  g.will ??= { day: w.day, lines: [] };
  g.will.day = w.day;
  g.will.lines = g.will.lines.filter((l) => l.asset !== asset);
  g.will.lines.push({ asset, to });
}

export function beneficiaryName(w: WorldState, b: Beneficiary): string {
  if (b === 'heredero') return 'quien continúe tu historia';
  if (b === 'pueblo') return 'el pueblo';
  if (b.startsWith('vecino:')) return folkById(w, b.slice(7))?.name ?? 'alguien';
  return orgById(w, b.slice(6))?.name ?? 'un grupo';
}

// ---------------------------------------------------------------------------
// El reparto
// ---------------------------------------------------------------------------
export interface EstateResult {
  lines: string[];
  heirCoins: number;
  disputes: Dispute[];
  debts: Debt[];
  burdens: string[];
}

/** Hijos y pareja que siguen vivos (los que esperan algo). */
function relatives(w: WorldState, heirId?: string): Folk[] {
  return w.life!.player.family.filter((k) => k.folkId && k.folkId !== heirId && k.relation !== 'aprendiz').map((k) => folkById(w, k.folkId!)).filter((f): f is Folk => !!f?.alive && f.age >= 16);
}

/** Lo que se repartiría (para enseñarlo antes de elegir). */
export function previewEstate(w: WorldState, heirId?: string): { gains: string[]; burdens: string[] } {
  const gains: string[] = [];
  const burdens: string[] = [];
  const g = gensOf(w);
  const will = g.will;
  for (const a of assetsOf(w)) {
    const to = will?.lines.find((l) => l.asset === a.asset)?.to ?? 'heredero';
    if (to === 'heredero' || to === `vecino:${heirId}`) gains.push(a.label);
  }
  const enemies = w.life!.folk.filter((f) => f.alive && f.resentment > 0.55 && f.memories.some((m) => m.gen === w.life!.player.generation && m.weight < -0.3)).length;
  if (enemies) burdens.push(enemies > 3 ? 'muchos enemigos' : 'algunos enemigos');
  const unpaid = playerEco(w).businesses.filter((b) => b.workers.length && b.cash < b.wage * b.workers.length * 5).length;
  if (unpaid) burdens.push('sueldos que pagar');
  if (relatives(w, heirId).length && (!will || will.lines.some((l) => l.to === 'heredero'))) burdens.push('familia que también espera su parte');
  const fame = Object.entries(g.dynasty.fame).sort((a, b) => b[1] - a[1])[0];
  if (fame && fame[1] > 1.2) burdens.push(`todos esperarán que seas tan ${fame[0]} como quien se fue`);
  return { gains, burdens };
}

export function settleEstate(w: WorldState, heirId: string | undefined, heirName: string): EstateResult {
  const life = w.life!;
  const id = life.identity!;
  const g = gensOf(w);
  const pe = playerEco(w);
  const will = g.will;
  const law = lawsOf(w, w.player.home).propiedad;
  const lines: string[] = [];
  const disputes: Dispute[] = [];
  const debts: Debt[] = [];
  const burdens: string[] = [];
  const rel = relatives(w, heirId);
  const toOf = (a: Asset): Beneficiary => will?.lines.find((l) => l.asset === a)?.to ?? 'heredero';
  const give = (b: Beneficiary, what: string) => lines.push(`${what} → ${b === 'heredero' ? heirName : beneficiaryName(w, b)}.`);
  // Dinero: testamento o ley.
  let heirCoins = 0;
  const coins = id.needs.coins;
  const coinTo = toOf('monedas');
  if (will?.lines.some((l) => l.asset === 'monedas')) {
    if (coinTo === 'heredero') heirCoins = coins;
    else payTo(w, coinTo, coins);
    give(coinTo, `${coins} monedas`);
  } else {
    const town = law === 'comunal' ? 0.25 : 0;
    // La costumbre también cuenta (Fase 6): donde hereda el mayor, los demás reciben poco.
    const custom = profileOf(cultureOf(w, w.player.home)).inheritance;
    const others = rel.length ? (custom === 'primogenitura' ? 0.1 : law === 'comunal' || custom === 'comunal' ? 0.25 : 0.4) : 0;
    heirCoins = Math.round(coins * (1 - town - others));
    if (town) {
      marketOf(w, w.player.home).treasury += coins * town;
      lines.push(`Por la ley de ${w.regions[w.player.home].name} (tierra comunal), una parte va a las arcas del pueblo.`);
    }
    for (const r of rel) r.p && (r.p.coins += Math.round((coins * others) / rel.length));
    lines.push(`${heirCoins} monedas → ${heirName}${rel.length === 1 ? `; el resto, para ${rel[0].name}` : rel.length ? `; el resto, a partes iguales entre ${rel.map((r) => r.name).join(' y ')}` : ''}.`);
  }
  // Negocios.
  for (const b of [...pe.businesses]) {
    const to = toOf(`negocio:${b.id}`);
    if (to === 'heredero' || to === `vecino:${heirId}`) {
      lines.push(`El ${b.kind} de ${w.regions[b.regionId].name} → ${heirName}.`);
      const owed = b.workers.length && b.cash < b.wage * b.workers.length * 5;
      if (owed) for (const wk of b.workers) {
        const d: Debt = { id: gid(w, 'd'), to: wk, amount: Math.round(b.wage * 5), why: `el sueldo de ${folkById(w, wk)?.name ?? 'quien trabajaba'} en el ${b.kind}`, due: w.day + 20 };
        debts.push(d);
      }
      continue;
    }
    pe.businesses = pe.businesses.filter((x) => x !== b);
    if (to.startsWith('vecino:')) {
      const f = folkById(w, to.slice(7));
      if (f?.p) {
        f.p.coins += b.cash;
        if (b.kind === 'puesto' && f.role !== 'comerciante' && f.age >= 16) changeJob(w, f, 'comerciante', 'porque heredó un puesto');
        if (b.kind === 'granja' && f.role !== 'campesino' && f.age >= 16) changeJob(w, f, 'campesino', 'porque heredó un campo');
      }
    } else payTo(w, to, b.cash);
    give(to, `El ${b.kind} de ${w.regions[b.regionId].name}`);
  }
  // Objetos con historia.
  for (const h of heirloomsHeld(w)) {
    const to = toOf(`objeto:${h.id}`);
    if (to === 'heredero') {
      passHeirloom(w, h, 'jugador', heirName, life.player.generation + 1);
      lines.push(`${h.name} → ${heirName}.`);
    } else if (to.startsWith('vecino:')) {
      const f = folkById(w, to.slice(7));
      passHeirloom(w, h, f?.id ?? 'perdido', f?.name ?? 'alguien');
      give(to, h.name);
    } else {
      passHeirloom(w, h, to === 'pueblo' ? `pueblo:${w.player.home}` : to, to === 'pueblo' ? `el pueblo de ${w.regions[w.player.home].name}` : beneficiaryName(w, to));
      give(to, h.name);
    }
  }
  // Carga y casa.
  const cargoTo = toOf('carga');
  if (cargoTo !== 'heredero') {
    for (const [gd, n] of Object.entries(pe.cargo) as [Good, number][]) marketOf(w, w.player.home).stock[gd] += n;
    pe.cargo = {};
    pe.vehicle = 'pie';
    give(cargoTo, 'La carga');
  }
  const houseTo = toOf('casa');
  if (id.housed && houseTo !== 'heredero' && houseTo !== `vecino:${heirId}`) {
    id.housed = false;
    give(houseTo, 'La casa');
  }
  // Conflictos: hermanos que se sienten apartados.
  const bigToHeir = (!will || will.lines.filter((l) => l.to === 'heredero').length >= 2) && (id.housed || pe.businesses.length);
  for (const r of rel) {
    if (!heirId || !bigToHeir) break;
    const greed = (trait(r, 'ambicioso') + trait(r, 'orgulloso') + trait(r, 'egoista')) / 300;
    const t = tieOf(w, r.id, heirId);
    if (greed + (t ? -t.aff / 200 : 0) < 0.45) continue;
    const what = pe.businesses[0] ? `el ${pe.businesses[0].kind} de la familia` : 'la casa familiar';
    const d: Dispute = { id: gid(w, 'x'), day: w.day, asset: what, value: pe.businesses[0] ? 20 + pe.businesses[0].cash : 40, claimants: [r.id, 'jugador'], status: 'abierta', regionId: r.regionId };
    disputes.push(d);
    if (t) t.aff = Math.max(-100, t.aff - 25);
    memorize(w, r, { kind: 'herencia', about: heirId, text: `Se lo quedó todo. A mí no me dejó nada.`, w: -0.6, src: 'propio' });
    burdens.push(`${r.name} reclama ${what}`);
  }
  // Las deudas propias también se heredan.
  for (const d of g.debts.filter((x) => !x.paid)) debts.push({ ...d, due: Math.max(d.due, w.day + 10) });
  g.debts = debts;
  g.disputes.push(...disputes);
  g.will = undefined;
  if (debts.length) burdens.push(`${debts.length === 1 ? 'una deuda' : `${debts.length} deudas`}`);
  return { lines, heirCoins, disputes, debts, burdens };
}

function payTo(w: WorldState, b: Beneficiary, coins: number): void {
  if (coins <= 0) return;
  if (b === 'pueblo') marketOf(w, w.player.home).treasury += coins;
  else if (b.startsWith('vecino:')) {
    const f = folkById(w, b.slice(7));
    if (f?.p) f.p.coins += coins;
  } else if (b.startsWith('grupo:')) {
    const o = orgById(w, b.slice(6));
    if (o) o.funds += coins;
  }
}

// ---------------------------------------------------------------------------
// Disputas y deudas (las vive quien continúa)
// ---------------------------------------------------------------------------
export function resolveDispute(w: WorldState, disputeId: string, how: 'dividir' | 'ceder' | 'juicio'): string[] {
  const g = gensOf(w);
  const d = g.disputes.find((x) => x.id === disputeId && x.status === 'abierta');
  if (!d) return ['Ya no hay nada que resolver.'];
  const id = w.life!.identity!;
  const claimant = folkById(w, d.claimants[0]);
  const pe = playerEco(w);
  if (!claimant) {
    d.status = 'cedida';
    return ['Quien reclamaba ya no está.'];
  }
  const out: string[] = [];
  if (how === 'dividir') {
    const half = Math.round(d.value / 2);
    const paid = Math.min(id.needs.coins, half);
    id.needs.coins -= paid;
    if (claimant.p) claimant.p.coins += paid;
    if (paid < half && pe.businesses[0]) pe.businesses[0].cash = Math.max(0, pe.businesses[0].cash - (half - paid));
    claimant.trust = clamp(claimant.trust + 0.25);
    claimant.resentment = clamp(claimant.resentment - 0.3);
    d.status = 'dividida';
    out.push(`Lo repartís. A ${claimant.name} le cuesta sonreír, pero acepta. «Es lo justo.»`);
    story(w, `Repartió la herencia con ${claimant.name}.`, 'decision');
  } else if (how === 'ceder') {
    if (pe.businesses[0] && d.asset.includes(pe.businesses[0].kind)) {
      const b = pe.businesses.shift()!;
      if (claimant.p) claimant.p.coins += b.cash;
    } else id.housed = false;
    claimant.trust = clamp(claimant.trust + 0.4);
    claimant.gratitude = clamp(claimant.gratitude + 0.5);
    claimant.resentment = 0;
    d.status = 'cedida';
    out.push(`Le dejas ${d.asset}. ${claimant.name} no se lo esperaba. Te abraza, y por un momento volvéis a ser críos.`);
    story(w, `Cedió ${d.asset} a ${claimant.name}.`, 'decision');
  } else {
    // El consejo decide según la ley de propiedad (y lo que pese cada uno en el pueblo).
    const law = lawsOf(w, d.regionId).propiedad;
    const rng = new Rng(hashString(`juicio:${d.id}`));
    const heirWins = rng.chance(law === 'privada' ? 0.7 : 0.4);
    d.status = 'juicio';
    if (heirWins) {
      claimant.resentment = clamp(claimant.resentment + 0.5);
      claimant.trust = clamp(claimant.trust - 0.4);
      memorize(w, claimant, { kind: 'juicio', about: 'jugador', text: 'Me llevó a juicio y me quitó lo que era mío.', w: -0.9, src: 'propio' });
      out.push(`El consejo te da la razón. ${claimant.name} sale del salón sin mirarte.`);
      if (rng.chance(0.5)) {
        const to = w.regions[d.regionId].neighbors[0];
        if (to !== undefined) migrate(w, claimant, to, true);
        out.push(`Días después, ${claimant.name} se marcha del pueblo. La familia ya no es la misma.`);
        d.status = 'ruptura';
      }
      story(w, `Ganó el juicio por la herencia contra ${claimant.name}.`, 'decision');
    } else {
      const lose = Math.min(id.needs.coins, Math.round(d.value * 0.6));
      id.needs.coins -= lose;
      if (claimant.p) claimant.p.coins += lose;
      out.push(`El consejo da la razón a ${claimant.name}. Te toca pagarle su parte.`);
      story(w, `Perdió el juicio por la herencia frente a ${claimant.name}.`, 'error');
    }
  }
  logEvent(w, d.regionId, 'herencia', `La herencia de la familia se resuelve: ${d.status === 'dividida' ? 'la reparten' : d.status === 'cedida' ? `${claimant.name} se queda con ${d.asset}` : d.status === 'ruptura' ? 'la familia se rompe' : 'la decide el consejo'}.`, [claimant.id]);
  return out;
}

export function payDebt(w: WorldState, debtId: string): string {
  const g = gensOf(w);
  const d = g.debts.find((x) => x.id === debtId && !x.paid);
  const id = w.life!.identity!;
  if (!d) return 'No debes nada.';
  if (id.needs.coins < d.amount) return `Necesitas ${d.amount} monedas. Tienes ${id.needs.coins}.`;
  id.needs.coins -= d.amount;
  d.paid = true;
  const f = folkById(w, d.to);
  if (f?.p) {
    f.p.coins += d.amount;
    f.trust = clamp(f.trust + 0.15);
  }
  return `Saldas la deuda: ${d.why}. ${f ? `${f.name} asiente, aliviado.` : ''}`;
}

/** Cada día: deudas que vencen y disputas que se pudren si nadie las atiende. */
export function estateDay(w: WorldState): string[] {
  const g = gensOf(w);
  const out: string[] = [];
  for (const d of g.debts) {
    if (d.paid || d.due > w.day) continue;
    d.paid = true; // ya no se puede pagar a tiempo: queda el rencor
    const f = folkById(w, d.to);
    if (f) {
      f.resentment = clamp(f.resentment + 0.35);
      memorize(w, f, { kind: 'deuda', about: 'jugador', text: 'Nunca me pagaron lo que me debían.', w: -0.6, src: 'propio' });
    }
    w.life!.identity!.score[w.player.home] = (w.life!.identity!.score[w.player.home] ?? 0) - 5;
    story(w, `No pagó una deuda heredada: ${d.why}.`, 'error');
    out.push(`${f?.name ?? 'Alguien'} cuenta por el pueblo que tu familia no paga sus deudas.`);
  }
  for (const d of g.disputes) {
    if (d.status !== 'abierta' || w.day - d.day < 20) continue;
    d.status = 'ruptura';
    const f = folkById(w, d.claimants[0]);
    if (f) {
      f.resentment = clamp(f.resentment + 0.4);
      memorize(w, f, { kind: 'herencia', about: 'jugador', text: 'Ni siquiera quiso hablar de la herencia.', w: -0.7, src: 'propio' });
    }
    out.push(`${f?.name ?? 'Tu familia'} ya no te habla: nadie quiso resolver lo de ${d.asset}.`);
    recordHist(w, { kind: 'familia', regionId: d.regionId, text: `La familia de ${w.life!.player.name} se rompe por la herencia.`, actor: w.life!.player.name, gen: w.life!.player.generation, importance: 1, fame: 0.2, witnessed: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// La dinastía: el nombre de la familia y lo que se dice de ella
// ---------------------------------------------------------------------------
export const FAME_WORD: Record<string, string> = { honesta: 'honrada', comerciante: 'buena para el comercio', politica: 'de política', guerrera: 'de armas tomar', sabia: 'de saber', generosa: 'generosa', mentirosa: 'de poco fiar', traidora: 'traidora', campesina: 'de la tierra', exploradora: 'de caminos' };

/** Lo que una vida deja en el nombre de la familia (se mezcla con lo de antes, que se va diluyendo). */
export function addFame(w: WorldState): void {
  const id = w.life!.identity!;
  const g = gensOf(w);
  const d = id.deeds;
  const legacy = w.life!.politics?.legacy.filter((l) => l.gen === w.life!.player.generation) ?? [];
  const add: Record<string, number> = {
    comerciante: (d.comerciar ?? 0) / 40,
    generosa: ((d.ayudar ?? 0) + (d.curar ?? 0)) / 20,
    mentirosa: (d.enganar ?? 0) / 6,
    guerrera: (d.combatir ?? 0) / 4,
    sabia: ((d.estudiar ?? 0) + (d.investigar ?? 0)) / 15,
    politica: legacy.filter((l) => l.kind === 'ley' || l.kind === 'cargo' || l.kind === 'gobierno').length / 2,
    traidora: legacy.filter((l) => l.kind === 'traicion').length,
    campesina: (d.trabajar ?? 0) / 40,
    exploradora: (d.explorar ?? 0) / 12,
    honesta: Math.max(0, 1 - (d.enganar ?? 0) / 4) * ((d.comerciar ?? 0) > 10 ? 1 : 0.2),
  };
  for (const k of Object.keys(g.dynasty.fame)) g.dynasty.fame[k] *= 0.6;
  for (const [k, v] of Object.entries(add)) if (v > 0.05) g.dynasty.fame[k] = (g.dynasty.fame[k] ?? 0) + Math.min(2, v);
}

export function fameOf(w: WorldState): string | undefined {
  const top = Object.entries(gensOf(w).dynasty.fame).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0.6 ? FAME_WORD[top[0]] ?? top[0] : undefined;
}

/** Lo que dicen de tu familia. */
export function familyTalk(w: WorldState, f: Folk, rng: Rng): string | null {
  const g = gensOf(w);
  const life = w.life!;
  if (life.player.generation < 2 || !g.dynasty.name) return null;
  const fame = fameOf(w);
  const lastAnc = life.player.lineage[life.player.lineage.length - 1];
  if (f.resentment > 0.5 && f.memories.some((m) => m.gen < life.player.generation && m.weight < -0.3)) return `${g.dynasty.name}… Tu familia no es bienvenida en mi casa.`;
  if (fame && rng.chance(0.5)) return `Los de ${g.dynasty.name} siempre habéis tenido fama de gente ${fame}. A ver si tú también.`;
  if (lastAnc && rng.chance(0.5)) return `Todos esperan que seas como ${lastAnc.name}. No es fácil, ¿eh?`;
  return null;
}
