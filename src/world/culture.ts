import { Rng, hashString } from '../core/rng';
import type { Culture, WorldState } from '../core/types';
import { CULTURES, PLAYER_CULTURE } from '../core/content/cultures';
import { clamp } from '../core/util';
import type { Good } from './economy';
import type { Folk } from './types';
import { atlasOf } from './atlas';
import { levelOf } from './identity';

/**
 * Culturas con comportamiento: no solo cambian el aspecto. Cada una tiene
 * comida preferida, forma de familia, costumbre de herencia, hospitalidad,
 * apego a la tradición, fiestas propias, valores… y una lengua. Todo sale
 * de sus rasgos (curiosidad, orgullo, comercio, cautela, espiritualidad), así
 * que añadir una cultura nueva es añadir una entrada al catálogo.
 */
export interface CultureProfile {
  id: string;
  name: string;
  diet: Good[]; // lo que más se come y se pide
  family: 'extendida' | 'nuclear';
  inheritance: 'primogenitura' | 'reparto' | 'comunal';
  hospitality: number; // 0..1: acoger a quien llega
  tradition: number; // 0..1: apego a las costumbres (frena los cambios de ley)
  honor: number; // 0..1: cuánto pesan las ofensas
  government: string[]; // formas de gobierno que le son propias
  festivals: string[];
  values: string[];
  language: Language;
}

export interface Language {
  name: string;
  words: Record<'hola' | 'adios' | 'gracias' | 'forastero' | 'amigo' | 'pan' | 'agua' | 'paz' | 'guerra' | 'oro', string>;
}

const cache = new Map<string, CultureProfile>();

export function cultureOf(w: WorldState, regionId: number): Culture {
  const r = w.regions[regionId];
  return r.isHome ? PLAYER_CULTURE : CULTURES.find((c) => c.id === r.culture) ?? PLAYER_CULTURE;
}

export function profileOf(c: Culture): CultureProfile {
  const hit = cache.get(c.id);
  if (hit) return hit;
  const t = c.traits;
  const rng = new Rng(hashString(`cultura:${c.id}`));
  const word = (n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += rng.pick(c.syllables);
    return s;
  };
  const diet: Good[] = t.mercantile > 0.65 ? ['pescado', 'fruta', 'trigo'] : t.caution > 0.6 ? ['carne', 'trigo', 'verdura'] : t.spirituality > 0.6 ? ['verdura', 'trigo', 'fruta'] : ['trigo', 'verdura', 'carne'];
  const p: CultureProfile = {
    id: c.id,
    name: c.name,
    diet,
    family: t.spirituality + t.caution > 1.1 ? 'extendida' : 'nuclear',
    inheritance: t.pride > 0.65 ? 'primogenitura' : t.spirituality > 0.65 ? 'comunal' : 'reparto',
    hospitality: clamp(0.3 + t.curiosity * 0.4 + t.mercantile * 0.3 - t.caution * 0.3),
    tradition: clamp(0.2 + t.spirituality * 0.4 + t.caution * 0.3 - t.curiosity * 0.2),
    honor: clamp(0.2 + t.pride * 0.7),
    government: t.spirituality > 0.65 && t.caution > 0.45 ? ['tribal', 'consejo'] : t.mercantile > 0.65 ? ['ciudad', 'familias', 'republica'] : t.pride > 0.65 ? ['monarquia', 'militar'] : t.curiosity > 0.65 ? ['republica', 'consejo'] : ['consejo', 'alcalde'],
    festivals: [`la fiesta de ${word(2)}`, t.spirituality > 0.5 ? 'la noche de los antepasados' : 'la feria de otoño', t.mercantile > 0.6 ? 'el gran mercado' : 'la fiesta de la siega'],
    values: [t.pride > 0.6 ? 'el honor' : 'la palabra dada', t.mercantile > 0.6 ? 'el buen trato' : 'el trabajo', t.spirituality > 0.6 ? 'los antepasados' : t.curiosity > 0.6 ? 'saber cosas nuevas' : 'la familia'],
    language: {
      name: `la lengua ${c.adjective}`,
      words: { hola: word(2), adios: word(2), gracias: word(2), forastero: word(3), amigo: word(2), pan: word(1), agua: word(2), paz: word(2), guerra: word(2), oro: word(1) },
    },
  };
  cache.set(c.id, p);
  return p;
}

/** Lo que el protagonista entiende de una lengua (0..1): lo que sabe de idiomas y el tiempo que la ha oído. */
export function comprehension(w: WorldState, c: Culture): number {
  if (c.id === PLAYER_CULTURE.id) return 1;
  const id = w.life?.identity;
  const days = w.life?.atlas?.exposure[c.id] ?? 0;
  return clamp(0.35 + (id ? levelOf(id, 'k:idiomas') * 0.15 + levelOf(id, 'k:culturas') * 0.05 : 0) + Math.min(0.45, days / 60));
}

/**
 * Lo que dice un extranjero: con su saludo, sus palabras y, si no se le
 * entiende del todo, solo trozos. Así se nota viajar.
 */
export function foreignSpeech(w: WorldState, f: Folk, lines: string[]): string[] {
  const c = cultureOf(w, f.regionId);
  if (c.id === PLAYER_CULTURE.id || !w.life?.atlas) return lines;
  const a = atlasOf(w);
  a.exposure[c.id] = (a.exposure[c.id] ?? 0) + 0.25;
  const lang = profileOf(c).language;
  const k = comprehension(w, c);
  // El saludo en su lengua abre la primera frase.
  const greet = `${lang.words.hola.charAt(0).toUpperCase()}${lang.words.hola.slice(1)}${f.lastMet < 0 ? `, ${lang.words.forastero}` : ''}.`;
  const [first, ...rest] = lines;
  const opening = first === undefined ? greet : first.startsWith('(') ? first : `${greet} ${first}`;
  if (k > 0.6) return first === undefined ? [opening] : [opening, ...rest];
  return [opening, ...rest.map((l, i) => {
    // Unas frases se entienden y otras no (cuanto más se sabe de su lengua, más).
    if (l.startsWith('(') || ((i * 37 + w.day * 11) % 100) / 100 < k) return l;
    // Algunas frases se escapan: solo se entiende una parte.
    const words = l.replace(/[«»]/g, '').split(' ');
    const keep = Math.max(2, Math.round(words.length * k));
    return `(Habla en ${lang.name}. Entiendes algo como: «…${words.slice(0, keep).join(' ')}…»)`;
  })];
}

/** Cómo es la gente de un pueblo, en palabras. */
export function describeCulture(w: WorldState, regionId: number): string[] {
  const c = cultureOf(w, regionId);
  const p = profileOf(c);
  return [
    `${c.name.charAt(0).toUpperCase()}${c.name.slice(1)}: valoran ${p.values.join(', ')}.`,
    `Comen sobre todo ${p.diet.join(', ')}. Familias ${p.family === 'extendida' ? 'grandes, varias generaciones bajo un techo' : 'pequeñas'}; ${p.inheritance === 'primogenitura' ? 'hereda el mayor' : p.inheritance === 'comunal' ? 'lo heredado es de todos' : 'la herencia se reparte'}.`,
    `${p.hospitality > 0.6 ? 'Reciben bien a quien llega.' : p.hospitality < 0.35 ? 'Desconfían de los forasteros.' : 'Ni abren ni cierran la puerta.'} Celebran ${p.festivals[0]} y ${p.festivals[1]}.`,
    `Hablan ${p.language.name}${comprehension(w, c) < 0.7 ? ' (no la entiendes del todo)' : ''}.`,
  ];
}
