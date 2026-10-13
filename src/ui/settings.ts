import { storage } from '../core/storage';

/** Preferencias del jugador (se guardan aparte de las partidas). */
export interface Settings {
  music: number; // 0..1
  sfx: number; // 0..1
  textSize: 'normal' | 'grande';
  reduceMotion: boolean;
  haptics: boolean;
  tutorial: boolean;
  quality: 'auto' | 'ultra' | 'alta' | 'media' | 'baja'; // nivel gráfico (auto = según el dispositivo)
}

const KEY = 'ecos_ajustes_v1';
const DEFAULTS: Settings = { music: 0.6, sfx: 0.7, textSize: 'normal', reduceMotion: false, haptics: true, tutorial: true, quality: 'auto' };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(storage.get(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  storage.set(KEY, JSON.stringify(s));
}

export function applySettings(s: Settings): void {
  document.documentElement.dataset.text = s.textSize;
  document.body.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  document.body.dataset.haptics = s.haptics ? 'on' : 'off';
}
