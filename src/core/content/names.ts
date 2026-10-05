import type { Rng } from '../rng';

const REGION_PREFIX = ['Val', 'Mor', 'Asc', 'Bre', 'Cal', 'Dor', 'Esk', 'Fen', 'Gal', 'Hal', 'Ister', 'Lun', 'Nar', 'Olm', 'Pra', 'Quel', 'Ros', 'Sel', 'Tar', 'Umb', 'Ver', 'Yel', 'Zar', 'Cor', 'Brum'];
const REGION_SUFFIX = ['mor', 'dal', 'ena', 'ia', 'garde', 'vel', 'ura', 'es', 'ondo', 'aria', 'ith', 'era', 'una', 'ast', 'ín', 'ova'];
const REGION_DESC = ['Bajo', 'Alto', 'Viejo', 'de las Nieblas', 'del Eco', 'Hondo', 'de la Ribera', 'del Collado'];

/** Nombre de región único dentro de una partida. */
export function regionName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    let n = rng.pick(REGION_PREFIX) + rng.pick(REGION_SUFFIX);
    if (rng.chance(0.15)) n = `${n} ${rng.pick(REGION_DESC)}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  const n = `Tierra ${used.size + 1}`;
  used.add(n);
  return n;
}

/** Nombre de persona construido con las sílabas de su cultura. */
export function personName(rng: Rng, syllables: string[], used: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const parts = rng.int(2, 3);
    let n = '';
    for (let p = 0; p < parts; p++) n += rng.pick(syllables);
    n = n.charAt(0).toUpperCase() + n.slice(1);
    if (n.length >= 3 && n.length <= 9 && !used.has(n)) {
      used.add(n);
      return n;
    }
  }
  // Si ya se han usado los nombres cortos, se prueban nombres más largos antes de numerar.
  for (let i = 0; i < 80; i++) {
    let m = '';
    for (let p = 0; p < 3 + (i % 2); p++) m += rng.pick(syllables);
    m = m.charAt(0).toUpperCase() + m.slice(1);
    if (m.length <= 12 && !used.has(m)) {
      used.add(m);
      return m;
    }
  }
  const n = `Ana${used.size}`;
  used.add(n);
  return n;
}

export const RELATIVES = ['mi hermano', 'mi hermana', 'mi hijo', 'mi hija', 'mi padre', 'mi madre', 'mi compañero', 'mi compañera'];
