import type { Culture } from '../types';

/**
 * Catálogo de culturas. Cada partida toma un subconjunto. Como las culturas
 * se repiten entre partidas, el "legado" puede recordar agravios entre ellas.
 * Para añadir una cultura basta con añadir una entrada aquí.
 */
export const CULTURES: Culture[] = [
  { id: 'velmari', name: 'los Velmari', adjective: 'velmari', hue: 195, traits: { curiosity: 0.7, pride: 0.4, mercantile: 0.6, caution: 0.3, spirituality: 0.3 }, syllables: ['ve', 'lo', 'ma', 'ri', 'sa', 'nel'] },
  { id: 'orunde', name: 'los Orunde', adjective: 'orunde', hue: 25, traits: { curiosity: 0.3, pride: 0.8, mercantile: 0.4, caution: 0.6, spirituality: 0.5 }, syllables: ['o', 'run', 'de', 'ka', 'tor', 'ba'] },
  { id: 'saelith', name: 'los Saelith', adjective: 'saelí', hue: 140, traits: { curiosity: 0.5, pride: 0.3, mercantile: 0.3, caution: 0.4, spirituality: 0.8 }, syllables: ['sae', 'li', 'th', 'en', 'ia', 'mir'] },
  { id: 'kharu', name: 'los Kharu', adjective: 'kharu', hue: 355, traits: { curiosity: 0.4, pride: 0.7, mercantile: 0.5, caution: 0.8, spirituality: 0.2 }, syllables: ['kha', 'ru', 'zan', 'go', 'dar', 'ek'] },
  { id: 'imbra', name: 'los Imbra', adjective: 'imbreño', hue: 50, traits: { curiosity: 0.6, pride: 0.5, mercantile: 0.9, caution: 0.2, spirituality: 0.3 }, syllables: ['im', 'bra', 'lu', 'co', 'te', 'ssa'] },
  { id: 'tovesh', name: 'los Tovesh', adjective: 'tovesho', hue: 275, traits: { curiosity: 0.9, pride: 0.4, mercantile: 0.4, caution: 0.3, spirituality: 0.6 }, syllables: ['to', 've', 'sh', 'ai', 'ne', 'ul'] },
  { id: 'marrow', name: 'los Marrú', adjective: 'marrú', hue: 90, traits: { curiosity: 0.3, pride: 0.6, mercantile: 0.3, caution: 0.5, spirituality: 0.7 }, syllables: ['ma', 'rru', 'ho', 'ga', 'pe', 'nd'] },
  { id: 'quessa', name: 'los Quessa', adjective: 'quesano', hue: 320, traits: { curiosity: 0.6, pride: 0.6, mercantile: 0.7, caution: 0.4, spirituality: 0.4 }, syllables: ['que', 'ssa', 'ri', 'ol', 'fa', 'vi'] },
  { id: 'dunai', name: 'los Dunai', adjective: 'dunai', hue: 170, traits: { curiosity: 0.5, pride: 0.5, mercantile: 0.5, caution: 0.6, spirituality: 0.5 }, syllables: ['du', 'nai', 'se', 'mo', 'ar', 'in'] },
  { id: 'yrth', name: 'los Yrth', adjective: 'yrtho', hue: 230, traits: { curiosity: 0.4, pride: 0.9, mercantile: 0.2, caution: 0.7, spirituality: 0.6 }, syllables: ['yr', 'th', 'ga', 'lo', 'vek', 'u'] },
];

/** Cultura del jugador: tu pequeña civilización. */
export const PLAYER_CULTURE: Culture = {
  id: 'eco',
  name: 'tu gente',
  adjective: 'de tu gente',
  hue: 38,
  traits: { curiosity: 0.6, pride: 0.4, mercantile: 0.5, caution: 0.4, spirituality: 0.5 },
  syllables: ['a', 'le', 'no', 'ri', 'ta', 'vin'],
};
