import type { WorldState } from '../core/types';
import { ensureLife } from './life';
import type { Folk } from './types';

/**
 * Lo que cambia entre el protagonista y los demás, y cuánto debe notarse.
 *
 * El juego nunca enseña cifras: lo que alguien piensa de ti se ve en su cara,
 * en un gesto y, si de verdad importa, en un aviso. Este módulo compara cómo
 * te miraba cada vecino antes y después de lo que acabas de hacer y decide el
 * tamaño de la reacción:
 *
 *  - nivel 1 (un detalle): un gesto pequeño sobre su cabeza, sin texto;
 *  - nivel 2 (algo que recordará): gesto + una línea discreta con su cara;
 *  - nivel 3 (algo que no se olvida): cartel grande, sonido y gesto marcado.
 *
 * El mismo acto pesa distinto según la historia: con quien ya tienes mucho
 * vivido, todo cuenta más; y lo que va contra lo que esa persona pensaba de ti
 * (un favor a quien te guardaba rencor, una traición a quien confiaba) se nota
 * el doble.
 */
export type BondTier = 1 | 2 | 3;
export type BondSign = 'corazon' | 'agrado' | 'enfado' | 'miedo' | 'desagrado' | 'sorpresa';

export interface BondChange {
  folk: Folk;
  /** Cambio neto con su peso (positivo = te mira mejor). */
  delta: number;
  tier: BondTier;
  good: boolean;
  /** Va contra lo que pensaba de ti hasta ahora. */
  turn: boolean;
  sign: BondSign;
  /** Lo que se dice de ello (vacío en el nivel 1). */
  text: string;
}

export interface TownChange {
  regionId: number;
  count: number;
  good: boolean;
  tier: BondTier;
  text: string;
}

type Snap = [trust: number, fear: number, gratitude: number, resentment: number];

/** Cómo te mira alguien, en un solo número (solo para comparar antes y después). */
export function regard(f: Pick<Folk, 'trust' | 'fear' | 'gratitude' | 'resentment'>): number {
  return f.trust + f.gratitude * 0.8 - f.resentment - f.fear * 0.5;
}

/** Umbrales del cambio ponderado para cada nivel. */
export const BOND_TIERS: [number, number, number] = [0.03, 0.1, 0.28];

export function tierOf(weighted: number): 0 | BondTier {
  const a = Math.abs(weighted);
  return a >= BOND_TIERS[2] ? 3 : a >= BOND_TIERS[1] ? 2 : a >= BOND_TIERS[0] ? 1 : 0;
}

const pick = <T>(list: T[], seed: string): T => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return list[Math.abs(h) % list.length];
};

function describe(f: Folk, tier: BondTier, good: boolean, turn: boolean, d: { trust: number; fear: number; gratitude: number; resentment: number }, day: number): { text: string; sign: BondSign } {
  const fem = f.gender === 'f';
  const o = fem ? 'a' : 'o';
  const seed = `${f.id}:${day}:${tier}`;
  if (good) {
    const thanks = d.gratitude > Math.max(d.trust, 0.02);
    const sign: BondSign = thanks || tier === 3 ? 'corazon' : 'agrado';
    if (tier === 1) return { text: '', sign: 'agrado' };
    if (turn) return { text: tier === 3 ? 'A pesar de todo lo que pasó, hoy te ha mirado de otra manera.' : 'No se lo esperaba de ti. Algo se ablanda.', sign: tier === 3 ? 'corazon' : 'sorpresa' };
    if (tier === 3) return { text: pick(thanks ? ['No va a olvidar lo que has hecho.', `Te está agradecid${o} de verdad. Esto se sabrá.`] : ['Ahora confía en ti de verdad.', 'Te ha abierto la puerta. Así empieza una amistad.'], seed), sign };
    return { text: pick(thanks ? ['Te lo agradece.', 'Se acordará de esto.'] : d.resentment < -0.05 ? ['Te guarda un poco menos de rencor.'] : ['Empieza a fiarse de ti.', 'Te mira con mejores ojos.'], seed), sign };
  }
  const scared = d.fear > Math.max(d.resentment, -d.trust, 0.02);
  const sign: BondSign = scared ? 'miedo' : tier === 1 ? 'desagrado' : 'enfado';
  if (tier === 1) return { text: '', sign };
  if (turn) return { text: tier === 3 ? 'Confiaba en ti. Eso es lo que más le duele.' : 'No esperaba eso de ti.', sign: scared ? 'miedo' : 'enfado' };
  if (tier === 3) return { text: pick(scared ? ['Te tiene miedo. Lo contará.', 'Se aparta de ti. No lo olvidará.'] : ['Te guarda rencor. Esto no se olvida.', 'Has perdido su confianza. Costará recuperarla.'], seed), sign };
  return { text: pick(scared ? ['Te mira con miedo.'] : d.resentment > 0.05 ? ['Eso no le ha gustado.', 'Se lo ha tomado mal.'] : ['Se fía menos de ti.', 'Te mira con recelo.'], seed), sign };
}

/**
 * Vigila cómo te mira cada vecino. `sync` guarda la foto sin decir nada (al
 * cargar, al amanecer: el olvido de cada día no es noticia); `diff` devuelve lo
 * que ha cambiado desde la última foto y la renueva.
 */
export class BondWatch {
  private snap = new Map<string, Snap>();

  sync(w: WorldState): void {
    this.snap.clear();
    for (const f of ensureLife(w).folk) if (f.alive) this.snap.set(f.id, [f.trust, f.fear, f.gratitude, f.resentment]);
  }

  diff(w: WorldState): { folk: BondChange[]; town: TownChange | null } {
    const out: BondChange[] = [];
    const life = ensureLife(w);
    for (const f of life.folk) {
      if (!f.alive) continue;
      const now: Snap = [f.trust, f.fear, f.gratitude, f.resentment];
      const was = this.snap.get(f.id);
      this.snap.set(f.id, now);
      if (!was) continue;
      const d = { trust: now[0] - was[0], fear: now[1] - was[1], gratitude: now[2] - was[2], resentment: now[3] - was[3] };
      const raw = d.trust + d.gratitude * 0.8 - d.resentment - d.fear * 0.5;
      if (Math.abs(raw) < 0.012) continue;
      // La historia pesa: con quien has vivido mucho, todo cuenta más…
      const history = Math.min(1, f.memories.length / 6);
      // …y lo que contradice lo que pensaba de ti se nota el doble.
      const before = was[0] + was[2] * 0.8 - was[3] - was[1] * 0.5 - 0.5;
      const turn = Math.abs(before) > 0.22 && Math.sign(before) !== Math.sign(raw) && Math.abs(raw) >= 0.06;
      const delta = raw * (1 + history * 0.5) * (turn ? 1.6 : 1);
      const tier = tierOf(delta);
      if (!tier) continue;
      const good = raw > 0;
      out.push({ folk: f, delta, tier, good, turn, ...describe(f, tier, good, turn, d, w.day) });
    }
    out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    // Cuando cambia medio pueblo a la vez, la noticia es el pueblo, no cada vecino.
    let town: TownChange | null = null;
    const byRegion = new Map<number, BondChange[]>();
    for (const c of out) byRegion.set(c.folk.regionId, [...(byRegion.get(c.folk.regionId) ?? []), c]);
    for (const [regionId, list] of byRegion) {
      const good = list.filter((c) => c.good).length;
      const bad = list.length - good;
      const n = Math.max(good, bad);
      if (n < 4 || (town && town.count >= n)) continue;
      const isGood = good >= bad;
      const mean = list.filter((c) => c.good === isGood).reduce((s, c) => s + Math.abs(c.delta), 0) / n;
      const tier: BondTier = n >= 12 || mean >= BOND_TIERS[2] ? 3 : n >= 7 || mean >= BOND_TIERS[1] ? 2 : 1;
      const name = w.regions[regionId]?.name ?? 'el pueblo';
      const text = isGood
        ? tier === 3 ? `Todo ${name} habla bien de ti.` : tier === 2 ? `En ${name} se te mira con mejores ojos.` : `En ${name} se comenta lo que has hecho.`
        : tier === 3 ? `${name} entero te ha vuelto la espalda.` : tier === 2 ? `En ${name} se habla mal de ti.` : `En ${name} hay quien murmura a tu paso.`;
      town = { regionId, count: n, good: isGood, tier, text };
    }
    return { folk: out, town };
  }
}
