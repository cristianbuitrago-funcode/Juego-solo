/**
 * Voces de los personajes. No hay grabaciones: cada persona tiene un perfil
 * (tono, timbre, tamaño de la «garganta», ritmo) y su voz se sintetiza sílaba
 * a sílaba mientras el texto aparece, con las vocales del propio texto y la
 * entonación de la frase (pregunta, exclamación, final).
 *
 * El perfil sale de quién es (edad, género, oficio) más una variación propia y
 * estable. Para fijar la voz de alguien a mano, añade una entrada a
 * `VOICE_OVERRIDES`: por identificador, por nombre o por oficio.
 */
export type Timbre = 'suave' | 'clara' | 'grave' | 'rasgada' | 'nasal' | 'infantil';

export interface VoiceProfile {
  /** Tono base en Hz (hombre ≈ 95–135, mujer ≈ 175–235, niño ≈ 270–340). */
  pitch: number;
  /** Cuánto sube y baja al hablar, en semitonos. */
  range: number;
  /** Ritmo: 1 = normal; menos, más pausado. */
  speed: number;
  timbre: Timbre;
  /** Tamaño del tracto vocal: < 1 cuerpo grande y voz oscura; > 1 pequeña y brillante. */
  formant: number;
  /** Aire en la voz (0..1): susurro, vejez. */
  breath: number;
  /** Volumen relativo (0..1,3). */
  volume: number;
}

export interface VoiceSubject {
  id: string;
  name?: string;
  role?: string;
  age: number;
  fem: boolean;
  charId?: string;
}

/** Voces tipo, para usarlas tal cual o como punto de partida. */
export const VOICE_PRESETS = {
  hombre: { pitch: 118, range: 4, speed: 1, timbre: 'clara', formant: 0.96, breath: 0.1, volume: 1 },
  mujer: { pitch: 205, range: 5, speed: 1.04, timbre: 'clara', formant: 1.12, breath: 0.12, volume: 0.95 },
  nino: { pitch: 310, range: 7, speed: 1.2, timbre: 'infantil', formant: 1.32, breath: 0.08, volume: 0.9 },
  anciano: { pitch: 104, range: 3, speed: 0.82, timbre: 'rasgada', formant: 0.98, breath: 0.32, volume: 0.9 },
  anciana: { pitch: 178, range: 3.5, speed: 0.84, timbre: 'rasgada', formant: 1.08, breath: 0.3, volume: 0.88 },
  grave: { pitch: 92, range: 3, speed: 0.9, timbre: 'grave', formant: 0.88, breath: 0.08, volume: 1.1 },
  dulce: { pitch: 222, range: 5.5, speed: 0.96, timbre: 'suave', formant: 1.15, breath: 0.2, volume: 0.9 },
  aspera: { pitch: 110, range: 3.5, speed: 0.95, timbre: 'rasgada', formant: 0.92, breath: 0.22, volume: 1.05 },
  nasal: { pitch: 140, range: 5, speed: 1.12, timbre: 'nasal', formant: 1.02, breath: 0.06, volume: 0.95 },
  narrador: { pitch: 128, range: 2.5, speed: 1, timbre: 'suave', formant: 1, breath: 0.25, volume: 0.6 },
} satisfies Record<string, VoiceProfile>;

export type VoicePreset = keyof typeof VOICE_PRESETS;

/**
 * Voces fijadas a mano. La clave puede ser el identificador del vecino («v143»),
 * su nombre («Nori»), el de un personaje del motor o un oficio («rol:posadero»).
 * El valor es el nombre de una voz tipo o los rasgos que se quieren cambiar.
 *
 *   'Nori': 'nasal',
 *   'rol:lider': { pitch: 96, timbre: 'grave' },
 */
export const VOICE_OVERRIDES: Record<string, VoicePreset | Partial<VoiceProfile>> = {};

/** Matiz de cada oficio sobre la voz que le toca por edad y género. */
const ROLE_TINT: Record<string, Partial<VoiceProfile> & { pitchMul?: number }> = {
  guardia: { timbre: 'grave', pitchMul: 0.93, volume: 1.1, range: 3 },
  lider: { pitchMul: 0.95, speed: 0.9, range: 3.5, volume: 1.05 },
  comerciante: { timbre: 'nasal', speed: 1.12, range: 5.5 },
  posadero: { pitchMul: 0.97, volume: 1.12, range: 5 },
  artesano: { timbre: 'rasgada', pitchMul: 0.96 },
  minero: { timbre: 'rasgada', pitchMul: 0.94 },
  lenador: { timbre: 'grave', pitchMul: 0.94 },
  sanadora: { timbre: 'suave', speed: 0.92, breath: 0.2 },
  pastor: { timbre: 'suave', speed: 0.9 },
  pescador: { timbre: 'rasgada', speed: 0.94 },
  exploradora: { speed: 1.08, range: 5 },
};

function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const resolve = (o: VoicePreset | Partial<VoiceProfile>): Partial<VoiceProfile> => (typeof o === 'string' ? VOICE_PRESETS[o] : o);

/** La voz de una persona: siempre la misma para la misma persona. */
export function voiceFor(s: VoiceSubject): VoiceProfile {
  const child = s.age < 13;
  const teen = !child && s.age < 17;
  const old = s.age >= 60;
  const base: VoiceProfile = { ...(child ? VOICE_PRESETS.nino : old ? (s.fem ? VOICE_PRESETS.anciana : VOICE_PRESETS.anciano) : s.fem ? VOICE_PRESETS.mujer : VOICE_PRESETS.hombre) };
  // Variación propia: nadie suena exactamente igual que su vecino.
  const a = hash01(s.id, 1);
  const b = hash01(s.id, 2);
  const c = hash01(s.id, 3);
  base.pitch *= 0.86 + a * 0.3;
  base.formant *= 0.95 + b * 0.1;
  base.speed *= 0.92 + c * 0.16;
  base.range *= 0.8 + hash01(s.id, 4) * 0.5;
  if (teen) (base.pitch *= s.fem ? 1.08 : 1.25), (base.formant *= 1.08);
  if (!child) {
    const tint = s.role ? ROLE_TINT[s.role] : undefined;
    if (tint) {
      const { pitchMul, ...rest } = tint;
      // (el timbre del oficio no pisa la voz cascada de la vejez)
      if (old) delete rest.timbre;
      Object.assign(base, rest);
      if (pitchMul) base.pitch *= pitchMul;
    } else if (!old && hash01(s.id, 5) < 0.22) base.timbre = (['suave', 'grave', 'nasal', 'rasgada'] as const)[Math.floor(hash01(s.id, 6) * 4)];
  }
  for (const key of [s.role ? `rol:${s.role}` : '', s.name ?? '', s.charId ?? '', s.id]) {
    const o = key ? VOICE_OVERRIDES[key] : undefined;
    if (o) Object.assign(base, resolve(o));
  }
  base.pitch = Math.max(70, Math.min(420, base.pitch));
  return base;
}

/** Lo que suena en un punto del texto. */
export interface Syllable {
  vowel: 'a' | 'e' | 'i' | 'o' | 'u';
  /** Semitonos sobre el tono base, por la entonación de la frase. */
  bend: number;
  /** Énfasis 0..1 (exclamaciones, mayúsculas). */
  stress: number;
  /** La consonante de antes silba (s, f, z, ch, j): un soplo de aire. */
  hiss: boolean;
}

const VOWELS: Record<string, Syllable['vowel']> = { a: 'a', á: 'a', e: 'e', é: 'e', i: 'i', í: 'i', y: 'i', o: 'o', ó: 'o', u: 'u', ú: 'u', ü: 'u' };

/**
 * Qué sílaba suena en la posición `i` del texto (o nada si ahí no hay vocal).
 * La entonación sale de la frase: las preguntas suben al final, las afirmaciones
 * bajan, las exclamaciones van más altas y con más fuerza.
 */
export function syllableAt(text: string, i: number): Syllable | null {
  const ch = text[i]?.toLowerCase();
  const vowel = ch ? VOWELS[ch] : undefined;
  if (!vowel) return null;
  // Los diptongos son una sola sílaba: la segunda vocal no vuelve a sonar.
  const prev = text[i - 1]?.toLowerCase();
  if (prev && VOWELS[prev] && !'áéíóú'.includes(ch)) return null;
  // Límites de la frase en la que cae.
  let a = i;
  while (a > 0 && !'.!?…¿¡:;'.includes(text[a - 1])) a--;
  let b = i;
  while (b < text.length && !'.!?…'.includes(text[b])) b++;
  const end = text[b] ?? '.';
  const pos = b > a ? (i - a) / (b - a) : 1;
  const question = end === '?';
  const shout = end === '!';
  let bend = Math.sin(pos * Math.PI) * 1.2; // la frase se arquea
  if (question) bend += pos > 0.7 ? ((pos - 0.7) / 0.3) * 5 : 0;
  else if (end === '…') bend -= pos * 1.5;
  else bend -= pos > 0.6 ? ((pos - 0.6) / 0.4) * (shout ? 2 : 3.5) : 0;
  if (shout) bend += 2.5;
  const accent = 'áéíóú'.includes(ch);
  if (accent) bend += 1.4;
  const raw = text[i];
  const upper = raw !== raw.toLowerCase();
  const before = text[i - 1]?.toLowerCase() ?? '';
  return { vowel, bend, stress: Math.min(1, (shout ? 0.6 : 0) + (accent ? 0.3 : 0) + (upper ? 0.2 : 0)), hiss: 'sfzjxc'.includes(before) && before !== '' };
}

/** Formantes (Hz) de las cinco vocales del castellano. */
export const FORMANTS: Record<Syllable['vowel'], [number, number, number]> = {
  a: [800, 1250, 2600],
  e: [460, 1900, 2550],
  i: [300, 2300, 3000],
  o: [500, 900, 2500],
  u: [330, 760, 2400],
};
