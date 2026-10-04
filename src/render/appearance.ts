import { CULTURES } from '../core/content/cultures';
import type { WorldState } from '../core/types';
import type { Avatar, Folk } from '../world/types';

/**
 * Apariencia de las personas: rasgos individuales (cara, piel, pelo, barba,
 * edad, complexión) y vestuario. El vestuario depende de la REGIÓN (corte,
 * materiales, sombreros, capas, patrones) y de la CLASE SOCIAL (campesino,
 * comerciante, soldado, líder…). Así se reconoce de dónde es alguien y qué
 * hace solo con mirarlo, sin estadísticas.
 */
export type HairStyle = 'corto' | 'rapado' | 'largo' | 'coleta' | 'trenza' | 'mono' | 'rizado' | 'calvo' | 'melena';
export type Beard = 'ninguna' | 'sombra' | 'corta' | 'larga' | 'bigote' | 'perilla';
export type Hat = 'paja' | 'gorro' | 'piel' | 'capucha' | 'panuelo' | 'pluma' | 'casco' | 'corona' | 'turbante' | 'impermeable' | 'boina' | undefined;
export type Item = 'azada' | 'martillo' | 'cana' | 'cayado' | 'cesta' | 'lanza' | 'saco' | 'baston' | 'arco' | 'farol' | 'libro' | 'red' | undefined;

export interface Outfit {
  top: 'camisa' | 'tunica' | 'jubon' | 'abrigo' | 'tunicaLarga' | 'acolchado';
  topColor: string;
  trim: string;
  pattern: 'liso' | 'rayas' | 'cuadros' | 'bordado' | 'acolchado' | 'hojas';
  sleeves: 'largas' | 'remangadas' | 'cortas';
  bottom: 'pantalon' | 'falda' | 'calzas';
  bottomColor: string;
  hem: number; // 0 = cintura … 1 = tobillo (faldas, túnicas y abrigos largos)
  vest?: string;
  apron?: string;
  cloak?: { color: string; fur: boolean; hood: boolean; clasp: string };
  shawl?: string;
  belt: string;
  sash?: string; // fajín (comerciantes, gente acomodada)
  pouch?: string;
  strap?: string; // bandolera
  shoes: 'botas' | 'zapatos' | 'sandalias' | 'descalzo' | 'botasPiel';
  shoeColor: string;
  hat: Hat;
  hatColor: string;
  armor?: { tabard: string; mail: boolean; emblem: string };
  item: Item;
  jewelry?: string;
  gloves?: string;
  patches: boolean;
  backpack?: string;
}

export interface Appearance {
  seed: number;
  height: number; // 1 = adulto
  build: number; // anchura
  fem: boolean;
  age: number;
  skin: string;
  skinShade: string;
  lips: string;
  hair: { style: HairStyle; color: string };
  beard: Beard;
  jaw: number; // 0.85 (fina) … 1.15 (ancha)
  faceLen: number;
  eye: { size: number; color: string; spacing: number };
  brow: { thick: number; color: string; tilt: number };
  nose: number; // 0 pequeña … 2 grande
  mouthW: number;
  ears: number;
  freckles: boolean;
  wrinkles: number; // 0..1
  stoop: number; // encorvamiento de la vejez
  outfit: Outfit;
  important: boolean; // líderes y personajes con nombre: más detalle
}

/** Generador determinista por persona. */
function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

export const darken = shade;

export const SKINS = ['#f2d3b8', '#e8c19e', '#d9a882', '#c48e66', '#a8714c', '#8a5a3a', '#6e4630', '#f5dcc8'];
const HAIRS = ['#1d1612', '#2e2018', '#4a3020', '#6b4428', '#8f5e30', '#b07b3e', '#c9a060', '#a33f22', '#d8b878'];
const EYES = ['#4a3020', '#3a2a1a', '#4f6a3a', '#3f5f7a', '#6a5a3a', '#2a2a2a'];

/** Familias de vestuario regional. */
export type RegionalStyle = 'frio' | 'bosque' | 'campo' | 'costa' | 'comercio' | 'alfarero' | 'hogar';

interface Palette {
  tops: string[];
  bottoms: string[];
  cloaks: string[];
  trims: string[];
  hats: Hat[];
  pattern: Outfit['pattern'][];
  shoes: Outfit['shoes'][];
  skins: number[]; // índices de piel más frecuentes
  label: string;
}

export const STYLES: Record<RegionalStyle, Palette> = {
  frio: { tops: ['#4a4f5a', '#5a3a36', '#3e4a4a', '#6a5a4a'], bottoms: ['#3a3430', '#4a4038', '#2e3236'], cloaks: ['#6a5442', '#4a3a30', '#5a5a5a'], trims: ['#c8b8a0', '#8a2e2a', '#d9cfbf'], hats: ['piel', 'piel', 'gorro', undefined], pattern: ['bordado', 'liso', 'acolchado'], shoes: ['botasPiel', 'botasPiel', 'botas'], skins: [0, 7, 1, 2], label: 'ropa gruesa de lana y pieles para el frío de la montaña' },
  bosque: { tops: ['#4a5a3a', '#5a4a30', '#3e5040', '#6a5a3a'], bottoms: ['#4a3a2a', '#3a3a2a', '#5a4a36'], cloaks: ['#3f5a36', '#4f4a2a', '#5a6a40'], trims: ['#a8b878', '#c9a65a', '#7a8a4a'], hats: ['capucha', 'capucha', 'boina', undefined], pattern: ['hojas', 'liso', 'bordado'], shoes: ['botas', 'botas', 'zapatos'], skins: [1, 2, 3, 0], label: 'capas con capucha, cuero y verdes de bosque' },
  campo: { tops: ['#e2d6b8', '#cdb88a', '#b8a070', '#d9c8a0', '#9aa070'], bottoms: ['#6a5a40', '#5a4a3a', '#7a6a4a', '#8a6a4a'], cloaks: ['#8a6a4a', '#7a7050'], trims: ['#9a5a3a', '#6a7a4a', '#b8863a'], hats: ['paja', 'paja', 'panuelo', undefined, 'boina'], pattern: ['liso', 'liso', 'cuadros'], shoes: ['zapatos', 'botas', 'sandalias'], skins: [1, 2, 3, 4], label: 'lino ligero, mangas remangadas y sombreros de paja' },
  costa: { tops: ['#e8e4dc', '#3f5f7a', '#d8d0c0', '#5a7a8a'], bottoms: ['#3a4a5a', '#5a5a50', '#4a5a6a'], cloaks: ['#d9b44a', '#4a5a6a'], trims: ['#2f4a6a', '#a3362b', '#e8e4dc'], hats: ['panuelo', 'impermeable', undefined, 'panuelo'], pattern: ['rayas', 'rayas', 'liso'], shoes: ['sandalias', 'descalzo', 'botas'], skins: [3, 4, 2, 5], label: 'camisas a rayas, pañuelos y pantalones remangados' },
  comercio: { tops: ['#2f6f73', '#7a2f3a', '#a8782a', '#3f3a6a', '#6a3a5a'], bottoms: ['#2e2a2a', '#3a3036', '#4a3a2a'], cloaks: ['#5a2a3a', '#2a4a5a', '#6a5a2a'], trims: ['#e2b84a', '#e8dcc0', '#c0c8d0'], hats: ['pluma', 'turbante', 'pluma', undefined], pattern: ['bordado', 'liso', 'bordado'], shoes: ['zapatos', 'botas', 'zapatos'], skins: [2, 3, 4, 5, 6], label: 'telas teñidas, fajines, joyas y sombreros con pluma' },
  alfarero: { tops: ['#b8774e', '#c9a07a', '#9a6a4a', '#d9b894'], bottoms: ['#5a4030', '#6a4a36'], cloaks: ['#8a5a3a'], trims: ['#e8d8b8', '#5a3a2a'], hats: ['turbante', 'panuelo', undefined], pattern: ['cuadros', 'liso'], shoes: ['sandalias', 'zapatos'], skins: [3, 4, 5, 2], label: 'ropa de tonos de tierra y tocados para el sol' },
  hogar: { tops: ['#2f5f63', '#6a4a7a', '#8a5a3a', '#4a6a4a'], bottoms: ['#3a3430', '#4a4038'], cloaks: ['#c9902c', '#7a2f3a'], trims: ['#e9b44c', '#e8dcc0'], hats: [undefined, 'boina', 'paja'], pattern: ['bordado', 'liso'], shoes: ['botas', 'zapatos'], skins: [1, 2, 3, 4, 0], label: 'ropa sencilla y cuidada, con detalles dorados' },
};

/** Familia de vestuario de una región: clima, bosque, costa, comercio… */
export function regionalStyle(w: WorldState, regionId: number): RegionalStyle {
  const r = w.regions[regionId];
  if (r.isHome) return 'hogar';
  const traits = CULTURES.find((c) => c.id === r.culture)?.traits;
  if (r.resource === 'hierro' || r.culture === 'kharu' || r.culture === 'yrth') return 'frio';
  if (r.resource === 'hierbas' || r.resource === 'ambar') return 'bosque';
  if (r.resource === 'pesca' || r.resource === 'sal') return 'costa';
  if ((traits?.mercantile ?? 0) > 0.65) return 'comercio';
  if (r.resource === 'arcilla') return 'alfarero';
  return 'campo';
}

export function regionHue(w: WorldState, regionId: number): number {
  const r = w.regions[regionId];
  return r.isHome ? 38 : (CULTURES.find((c) => c.id === r.culture)?.hue ?? 30);
}

function hslHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255);
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Apariencia de un vecino. Los cambios de clima (lluvia, nieve) se aplican al dibujar. */
export function appearanceOf(w: WorldState, f: Folk): Appearance {
  const r = prng(seedOf(f.id) ^ (f.charId ? 0x9e37 : 0));
  const style = regionalStyle(w, f.regionId);
  const P = STYLES[style];
  const hue = regionHue(w, f.regionId);
  const fem = r() < (f.role === 'sanadora' || f.role === 'exploradora' ? 0.85 : f.role === 'guardia' ? 0.25 : 0.48);
  const child = f.role === 'nino' || f.age < 14;
  const old = f.age >= 60;
  const skin = SKINS[r() < 0.75 ? P.skins[Math.floor(r() * P.skins.length)] : Math.floor(r() * SKINS.length)];
  const hairColor = old ? pick(r, ['#d8d4cc', '#bdb8b0', '#e8e4dc', '#9a948c']) : pick(r, HAIRS);
  const hairStyles: HairStyle[] = fem ? ['largo', 'coleta', 'trenza', 'mono', 'melena', 'rizado'] : ['corto', 'rapado', 'rizado', 'corto', 'melena', old ? 'calvo' : 'corto'];
  const beard: Beard = fem || child ? 'ninguna' : pick(r, old ? ['larga', 'corta', 'bigote', 'ninguna'] : ['ninguna', 'ninguna', 'sombra', 'corta', 'bigote', 'perilla', 'larga']);

  const top = pick(r, P.tops);
  const trim = pick(r, P.trims);
  const o: Outfit = {
    top: fem && r() < 0.5 ? 'tunica' : pick(r, ['camisa', 'tunica', 'jubon'] as const),
    topColor: top,
    trim,
    pattern: pick(r, P.pattern),
    sleeves: style === 'campo' || style === 'costa' ? pick(r, ['remangadas', 'cortas', 'largas'] as const) : 'largas',
    bottom: fem ? pick(r, ['falda', 'falda', 'pantalon'] as const) : 'pantalon',
    bottomColor: pick(r, P.bottoms),
    hem: fem ? 0.82 + r() * 0.15 : 0,
    belt: pick(r, ['#5a3a22', '#3a2a1a', '#6a4a2a']),
    shoes: pick(r, P.shoes),
    shoeColor: pick(r, ['#3a2a1e', '#4a3424', '#5a4030', '#2a2420']),
    hat: r() < 0.55 ? pick(r, P.hats) : undefined,
    hatColor: pick(r, [...P.cloaks, trim]),
    item: undefined,
    patches: false,
  };
  if (style === 'frio') {
    o.cloak = { color: pick(r, P.cloaks), fur: true, hood: false, clasp: '#b8b0a0' };
    o.top = r() < 0.5 ? 'abrigo' : o.top;
    o.hem = Math.max(o.hem, o.top === 'abrigo' ? 0.55 : 0);
  }
  if (style === 'bosque' && r() < 0.7) o.cloak = { color: pick(r, P.cloaks), fur: false, hood: true, clasp: '#a8b878' };
  if (style === 'campo' && r() < 0.4) o.vest = pick(r, ['#6a5a3a', '#4a5a3a', '#7a4a3a']);
  if (style === 'comercio') o.sash = pick(r, P.trims);

  // Clase social: lo que haces se ve en lo que llevas.
  switch (f.role) {
    case 'campesino':
      o.patches = r() < 0.6;
      o.item = pick(r, ['azada', 'cesta', 'azada', undefined] as const);
      if (fem && r() < 0.6) o.apron = pick(r, ['#d9cfb8', '#c8b898']);
      o.jewelry = undefined;
      break;
    case 'pastor':
      o.item = 'cayado';
      o.hat = o.hat ?? 'paja';
      o.cloak = o.cloak ?? { color: '#8a7a5a', fur: false, hood: false, clasp: '#6a5a3a' };
      break;
    case 'pescador':
      o.item = pick(r, ['red', 'cana'] as const);
      o.hat = style === 'costa' ? pick(r, ['impermeable', 'panuelo'] as const) : 'panuelo';
      o.pattern = 'rayas';
      o.sleeves = 'remangadas';
      break;
    case 'comerciante':
      o.top = pick(r, ['jubon', 'abrigo'] as const);
      o.topColor = shade(top, 1.05);
      o.pouch = '#7a4a22';
      o.strap = '#5a3a22';
      o.jewelry = '#e2b84a';
      o.hat = o.hat ?? pick(r, ['pluma', 'boina', 'gorro'] as const);
      o.item = r() < 0.4 ? 'saco' : undefined;
      o.hem = o.top === 'abrigo' ? 0.55 : o.hem;
      o.shoes = 'zapatos';
      break;
    case 'guardia':
      o.top = 'acolchado';
      o.armor = { tabard: hslHex(hue, 45, 38), mail: r() < 0.6, emblem: hslHex(hue, 55, 70) };
      o.hat = 'casco';
      o.hatColor = '#8f959c';
      o.item = 'lanza';
      o.shoes = 'botas';
      o.bottom = 'pantalon';
      o.hem = 0;
      o.gloves = '#5a4030';
      break;
    case 'artesano':
      o.apron = '#6a4a30';
      o.gloves = '#5a3a24';
      o.item = 'martillo';
      o.sleeves = 'remangadas';
      break;
    case 'nino':
      o.top = 'tunica';
      o.hat = r() < 0.2 ? o.hat : undefined;
      o.cloak = undefined;
      o.item = undefined;
      o.shoes = style === 'costa' || r() < 0.3 ? 'descalzo' : o.shoes;
      break;
    case 'anciano':
      o.shawl = pick(r, ['#7a6a5a', '#5a4a4a', '#8a7a6a']);
      o.item = 'baston';
      break;
    case 'lider':
      o.top = 'tunicaLarga';
      o.hem = 0.95;
      o.topColor = hslHex(hue, 45, 32);
      o.trim = '#e2b84a';
      o.pattern = 'bordado';
      o.cloak = { color: hslHex((hue + 10) % 360, 50, 24), fur: style === 'frio', hood: false, clasp: '#e2b84a' };
      o.jewelry = '#e2b84a';
      o.hat = 'corona';
      o.hatColor = '#e2b84a';
      o.shoes = 'zapatos';
      break;
    case 'sanadora':
      o.apron = '#ece6d8';
      o.strap = '#7a5a30';
      o.pouch = '#8a6a3a';
      o.hat = 'panuelo';
      o.hatColor = '#e8e2d2';
      o.item = 'cesta';
      break;
    case 'exploradora':
      o.cloak = { color: pick(r, ['#3f5a36', '#5a4a30', '#4a4a3a']), fur: false, hood: true, clasp: '#c9a65a' };
      o.backpack = '#6a4a2a';
      o.item = pick(r, ['arco', 'farol'] as const);
      o.shoes = 'botas';
      o.bottom = 'pantalon';
      o.hem = 0;
      break;
  }
  if (f.charId && f.role !== 'lider') {
    // Personajes con nombre: un detalle propio que los hace reconocibles.
    o.jewelry = o.jewelry ?? pick(r, ['#e2b84a', '#c0c8d0', '#b84a3a']);
    o.cloak = o.cloak ?? { color: shade(pick(r, P.cloaks), 0.9), fur: false, hood: false, clasp: '#e2b84a' };
  }
  const ap: Appearance = {
    seed: seedOf(f.id),
    height: child ? 0.6 + Math.min(1, f.age / 14) * 0.18 : (fem ? 0.95 : 1) * (0.96 + r() * 0.08) * (old ? 0.97 : 1),
    build: child ? 0.92 : 0.88 + r() * 0.28 + (f.role === 'artesano' || f.role === 'guardia' ? 0.06 : 0),
    fem,
    age: f.age,
    skin,
    skinShade: shade(skin, 0.82),
    lips: shade(skin, 0.78),
    hair: { style: child && fem ? pick(r, ['coleta', 'trenza', 'largo'] as const) : old && !fem && r() < 0.4 ? 'calvo' : pick(r, hairStyles), color: hairColor },
    beard,
    jaw: fem ? 0.86 + r() * 0.12 : 0.95 + r() * 0.2,
    faceLen: 0.94 + r() * 0.12,
    eye: { size: 0.9 + r() * 0.25 + (child ? 0.2 : 0), color: pick(r, EYES), spacing: 0.92 + r() * 0.16 },
    brow: { thick: (fem ? 0.7 : 1) * (0.8 + r() * 0.5), color: old ? '#cfcac0' : shade(hairColor, 0.85), tilt: (r() - 0.5) * 0.3 },
    nose: r() * 2,
    mouthW: 0.85 + r() * 0.3,
    ears: 0.9 + r() * 0.25,
    freckles: r() < 0.15,
    wrinkles: old ? 0.5 + (f.age - 60) / 40 : f.age > 45 ? 0.25 : 0,
    stoop: old ? Math.min(1, (f.age - 58) / 25) : 0,
    outfit: o,
    important: !!f.charId,
  };
  return ap;
}

/** El personaje del jugador: diseño propio y personalizable. */
export interface PlayerLook {
  cloak: string;
  tunic: string;
  hair: HairStyle;
  hairColor: string;
  fem: boolean;
  beard: Beard;
  skin: number;
}

export const DEFAULT_PLAYER_LOOK: PlayerLook = { cloak: '#c9902c', tunic: '#2f5f63', hair: 'corto', hairColor: '#4a3020', fem: false, beard: 'sombra', skin: 2 };

export function playerAppearance(p: Avatar): Appearance {
  const look = (p.look as PlayerLook | undefined) ?? DEFAULT_PLAYER_LOOK;
  const r = prng(seedOf(p.name) ^ p.generation);
  const skin = SKINS[look.skin % SKINS.length];
  const old = p.age >= 58;
  return {
    seed: seedOf(p.name),
    height: 1.03,
    build: 1.02,
    fem: look.fem,
    age: p.age,
    skin,
    skinShade: shade(skin, 0.82),
    lips: shade(skin, 0.78),
    hair: { style: look.hair, color: old ? '#cfcac0' : look.hairColor },
    beard: look.fem ? 'ninguna' : look.beard,
    jaw: look.fem ? 0.9 : 1.04,
    faceLen: 1,
    eye: { size: 1.08, color: '#3f5f7a', spacing: 1 },
    brow: { thick: look.fem ? 0.75 : 1.05, color: shade(look.hairColor, 0.8), tilt: 0 },
    nose: 0.9 + r() * 0.4,
    mouthW: 1,
    ears: 1,
    freckles: false,
    wrinkles: old ? 0.6 : p.age > 45 ? 0.25 : 0,
    stoop: old ? 0.3 : 0,
    important: true,
    outfit: {
      top: 'jubon',
      topColor: look.tunic,
      trim: '#e9b44c',
      pattern: 'bordado',
      sleeves: 'largas',
      bottom: 'pantalon',
      bottomColor: '#3a3430',
      hem: 0,
      cloak: { color: look.cloak, fur: false, hood: false, clasp: '#e9b44c' },
      belt: '#4a2e1a',
      pouch: '#7a4a22',
      strap: '#5a3a22',
      shoes: 'botas',
      shoeColor: '#3a2618',
      hat: undefined,
      hatColor: look.cloak,
      item: undefined,
      patches: false,
      backpack: '#6a4a2a',
    },
  };
}
