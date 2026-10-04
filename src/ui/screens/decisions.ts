import { answerPetition, performAction } from '../../core/api';
import { LESSONS } from '../../core/systems/patterns';
import type { Method, Priority } from '../../core/types';
import { ago } from '../../core/util';
import { audio } from '../../audio/audio';
import type { App } from '../app';
import { h, meter, vibrate } from '../dom';
import { avatar, characterTitle, empty, section } from './common';

/** Pantalla de decisiones: peticiones, tu civilización, prioridades y leyes. */
const PRIORITIES: [Priority, string, string][] = [
  ['comercio', '⚖ Comercio', 'Más provisiones y caminos concurridos. Más presión sobre las tierras ajenas.'],
  ['seguridad', '🛡 Seguridad', 'Tu guardia está lista. Tus vecinos te temen un poco más.'],
  ['conocimiento', '📚 Conocimiento', 'Un emisario más, informes más fiables, más rumores te llegan.'],
  ['ecologia', '🌿 Cuidado de la tierra', 'Menos presión sobre los ecosistemas vecinos. Menos provisiones.'],
];

const LAWS: ['hospitalidad' | 'secreto' | 'racionamiento', string, string][] = [
  ['hospitalidad', 'Ley de hospitalidad', 'Acoges a quienes huyen del hambre o la guerra. Cuesta provisiones; genera gratitud duradera.'],
  ['secreto', 'Ley del secreto', 'Tus engaños se descubren menos. Tu gente desconfía un poco de su propio gobierno.'],
  ['racionamiento', 'Racionamiento', 'Tu gente consume menos. Su ánimo se resiente.'],
];

const METHOD_WORD: Record<Method, string> = {
  ayuda: 'quien reparte ayuda', fuerza: 'quien usa la fuerza', dialogo: 'quien media', engano: 'quien engaña',
  informacion: 'quien comparte la verdad', comercio: 'quien comercia', abandono: 'quien abandona',
};

export function renderDecisions(app: App): Node[] {
  const w = app.w!;
  const p = w.player;
  const out: Node[] = [h('h2', null, 'Decisiones'), h('p', { class: 'lead' }, 'Lo que te piden, lo que decides para tu gente y cómo te ve el mundo.')];

  // Peticiones.
  const pets = [...w.petitions].sort((a, b) => a.expires - b.expires);
  out.push(section(`Peticiones (${pets.length})`, pets.length ? null : empty('Nadie te pide nada hoy. Eso también es información.')));
  for (const pet of pets) {
    const c = w.characters.find((x) => x.id === pet.characterId);
    out.push(h('div', { class: 'card' },
      h('div', { class: 'person' }, c ? avatar(w, c) : null,
        h('div', { style: 'flex:1' },
          h('b', null, pet.title),
          h('div', { class: 'tiny' }, `${c ? characterTitle(w, c) + ' · ' : ''}caduca ${pet.expires - w.day <= 0 ? 'hoy' : `en ${pet.expires - w.day} días`}`),
        )),
      h('p', { class: 'quote' }, pet.text),
      h('div', { class: 'actions' }, ...pet.choices.map((ch, i) =>
        h('button', {
          class: `btn small ${i === 0 ? 'teal' : ''}`,
          onclick: () => {
            const res = answerPetition(w, pet.id, i);
            if (!res.ok) return app.toast(res.message, true);
            vibrate(15);
            audio.sfx('accion');
            app.toast(res.message);
            app.refresh();
          },
        }, ch.label))),
      ...pet.choices.filter((ch) => ch.hint).map((ch) => h('div', { class: 'tiny' }, `${ch.label}: ${ch.hint}`)),
    ));
  }

  // Tu civilización.
  const cohesionWord = p.cohesion > 0.7 ? 'unida' : p.cohesion > 0.5 ? 'tranquila' : p.cohesion > 0.3 ? 'inquieta' : 'al borde de dispersarse';
  const credWord = p.credibility > 0.7 ? 'muy creíble' : p.credibility > 0.45 ? 'creíble' : p.credibility > 0.25 ? 'dudosa' : 'sin valor';
  out.push(section('Tu civilización',
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('span', { style: 'min-width:120px' }, '🌾 Provisiones'), meter(p.reserves / 100, p.reserves < 20 ? 'bad' : 'warm'), h('b', null, String(Math.round(p.reserves)))),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { style: 'min-width:120px' }, '🔥 Cohesión'), meter(p.cohesion, p.cohesion < 0.3 ? 'bad' : ''), h('span', { class: 'tiny' }, cohesionWord)),
      h('p', { class: 'muted' }, `🧭 Emisarios: ${p.agents} · 🗣 Tu palabra es ${credWord} · 🛡 Guardia ${p.guardReady > w.day ? `lista en ${p.guardReady - w.day} días` : 'lista'}`),
    ),
  ));

  out.push(section('Prioridad de tu gente',
    h('div', { class: 'grid2' }, ...PRIORITIES.map(([id, label, desc]) =>
      h('button', {
        class: `card ${p.priority === id ? '' : 'flat'}`,
        style: `text-align:left;cursor:pointer;${p.priority === id ? 'border-color:var(--accent-2);border-width:2px' : ''}`,
        onclick: () => {
          if (p.priority === id) return;
          const res = performAction(w, 'prioridad', { priority: id });
          app.toast(res.message, !res.ok);
          app.refresh();
        },
      }, h('b', null, label), h('div', { class: 'tiny' }, desc)))),
    h('p', { class: 'tiny' }, 'Cambiar de prioridad a menudo cansa a tu gente.'),
  ));

  out.push(section('Leyes',
    ...LAWS.map(([id, label, desc]) =>
      h('label', { class: 'switch' },
        h('span', null, h('b', null, label), h('div', { class: 'tiny' }, desc)),
        h('input', {
          type: 'checkbox', checked: p.laws[id],
          onchange: (e: Event) => {
            const res = performAction(w, 'ley', { law: id, value: (e.target as HTMLInputElement).checked ? 1 : 0 });
            app.toast(res.message, !res.ok);
            app.refresh();
          },
        }))),
  ));

  // Cómo te ve el mundo (patrones aprendidos).
  const pats = (Object.entries(p.patterns) as [Method, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const lessons = w.entries.filter((e) => Object.values(LESSONS).some((l) => l?.text === e.text));
  out.push(section('Cómo te ve el mundo',
    pats.length ? h('p', null, `Te conocen como ${pats.slice(0, 2).map(([m]) => METHOD_WORD[m]).join(' y ')}.`) : h('p', { class: 'muted' }, 'Aún no saben qué esperar de ti.'),
    ...lessons.map((e) => h('div', { class: 'card' }, h('div', { class: 'tiny' }, `Día ${e.day} · ${ago(w.day - e.day)}`), h('p', null, e.text))),
    h('p', { class: 'tiny' }, 'Si resuelves siempre los problemas de la misma manera, los pueblos aprenden el patrón y se adaptan a él.'),
  ));
  return out;
}
