import { CULTURES } from '../../core/content/cultures';
import { ROLES } from '../../core/content/roles';
import { dominantEmotion } from '../../core/systems/characters';
import type { Character, Entry, EntryKind, FactKey, WorldState } from '../../core/types';
import { ago } from '../../core/util';
import { h } from '../dom';

export const ENTRY_ICON: Record<EntryKind, string> = {
  accion: '✋', consecuencia: '↪', evento: '✦', descubrimiento: '💡', conflicto: '⚔', tecnologia: '⚙',
  diplomacia: '🤝', personaje: '👤', ecologia: '🌿', migracion: '🧳', informacion: '📜',
};

export const FACT_LABEL: Record<FactKey, string> = {
  poblacion: 'Tamaño', alimento: 'Alimento', ecologia: 'Tierra', animo: 'Ánimo', tension: 'Tensión', confianza: 'Hacia ti',
  recurso: 'Vive de', cultura: 'Pueblo', tecnologias: 'Técnicas', relaciones: 'Vecinos', necesidades: 'Necesita', investigacion: 'Trabajan en',
};

export const FACT_ORDER: FactKey[] = ['confianza', 'alimento', 'tension', 'animo', 'ecologia', 'poblacion', 'necesidades', 'relaciones', 'investigacion', 'tecnologias', 'recurso', 'cultura'];

export const EMOTION_WORD: Record<string, string> = {
  trust: 'confía en ti', fear: 'parece asustado', resentment: 'te guarda rencor', gratitude: 'te está agradecido',
  ambition: 'es ambicioso', curiosity: 'es curioso', neutral: 'es reservado',
};

export function entryRow(w: WorldState, e: Entry, onClick?: () => void): HTMLElement {
  return h('div', { class: `entry imp${e.importance} ${e.byPlayer ? 'player' : ''}`, onclick: onClick },
    h('div', { class: 'ico' }, ENTRY_ICON[e.kind]),
    h('div', { class: 'txt' }, e.text, h('div', { class: 'tiny' }, `Día ${e.day} · ${ago(w.day - e.day)}`)),
  );
}

export function regionLabel(w: WorldState, id: number): string {
  return w.intel[id].level === 0 ? 'una tierra sin explorar' : w.regions[id].name;
}

export function avatar(w: WorldState, c: Character): HTMLElement {
  const culture = CULTURES.find((x) => x.id === w.regions[c.regionId].culture);
  return h('div', { class: 'avatar', style: `background:hsl(${culture?.hue ?? 30} 35% 42%)` }, c.name.charAt(0));
}

export function characterTitle(w: WorldState, c: Character): string {
  return `${c.name}, ${ROLES[c.role]?.title ?? c.role} de ${w.regions[c.regionId].name}`;
}

export function emotionRead(c: Character): string {
  return EMOTION_WORD[dominantEmotion(c)];
}

/** Contenido de la ventanita de "mantener pulsado" sobre una región. */
export function describeTooltip(w: WorldState, id: number, status: string): Node[] {
  const r = w.regions[id];
  const intel = w.intel[id];
  if (intel.level === 0) return [h('b', null, '¿Tierra sin explorar?'), h('div', { class: 'muted' }, 'No sabes nada de este lugar. Envía un observador.')];
  const f = intel.facts;
  const lines: Node[] = [h('b', null, r.name), h('div', { class: 'tiny' }, status)];
  for (const k of ['confianza', 'alimento', 'tension'] as FactKey[]) {
    const fact = f[k];
    if (fact) lines.push(h('div', null, `${FACT_LABEL[k]}: ${fact.value} `, h('span', { class: 'tiny' }, `(${ago(w.day - fact.day)}${fact.reliable ? '' : ', de oídas'})`)));
  }
  const rumors = w.rumors.filter((x) => x.known && x.about === id).length;
  if (rumors) lines.push(h('div', { class: 'tiny' }, `💬 ${rumors} rumor${rumors > 1 ? 'es' : ''} sobre esta región`));
  return lines;
}

export function section(title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h('div', null, h('h3', null, title), ...children);
}

export function empty(text: string): HTMLElement {
  return h('div', { class: 'empty' }, text);
}
