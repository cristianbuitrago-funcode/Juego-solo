import { compareRumors, contradictions, formConclusion, freeAgents } from '../../core/api';
import { FRAGMENTS_NEEDED, fragmentText, mysteryOptions, mysteryQuestion } from '../../core/systems/mystery';
import { ago } from '../../core/util';
import { audio } from '../../audio/audio';
import type { App } from '../app';
import { h } from '../dom';
import { empty, section } from './common';
import { openAction, openHypothesisComposer } from './composer';

/**
 * Panel de investigación: la información es el recurso principal.
 * Emisarios en camino, rumores, testimonios contradictorios, el cuaderno de
 * pistas y la verdad oculta del mundo.
 */
const MISSION_WORD: Record<string, string> = { observar: 'Observando', espiar: 'Escuchando conversaciones en', investigar: 'Investigando un rumor en', sabotaje: 'Saboteando', diplomacia: 'En misión diplomática en' };

export function renderResearch(app: App): Node[] {
  const w = app.w!;
  const out: Node[] = [h('h2', null, 'Investigación'), h('p', { class: 'lead' }, 'Nada de lo que oyes es seguro. Compara, comprueba y deduce.')];

  // Emisarios.
  const free = freeAgents(w);
  const stationed = w.regions.filter((r) => w.intel[r.id].observerStationed);
  out.push(section(`Emisarios: ${free} de ${w.player.agents} disponibles`,
    ...w.missions.map((m) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, '🧭'), h('div', { class: 'txt' }, `${MISSION_WORD[m.kind]} ${w.regions[m.regionId].name}`, h('div', { class: 'tiny' }, `Vuelve ${m.returnDay - w.day <= 0 ? 'hoy' : `en ${m.returnDay - w.day} días`}`)))),
    ...stationed.map((r) => h('div', { class: 'entry', onclick: () => app.openRegion(r.id) }, h('div', { class: 'ico' }, '👁'), h('div', { class: 'txt' }, `Destacado en ${r.name}`))),
    !w.missions.length && !stationed.length ? h('p', { class: 'muted' }, 'Todos tus emisarios esperan órdenes. Toca una región del mapa para enviarlos.') : null,
  ));

  // Verdad oculta.
  const m = w.mystery;
  if (m.revealed) {
    const can = m.fragmentsFound.length >= FRAGMENTS_NEEDED && !m.solved && w.day >= m.nextGuessDay;
    out.push(section('La verdad oculta',
      h('div', { class: 'card' },
        h('p', { class: 'quote' }, mysteryQuestion(w)),
        ...m.fragmentsFound.map((f) => h('p', null, `🧩 ${fragmentText(w, f)}`)),
        m.solved ? h('span', { class: 'tag good' }, 'Resuelto') : h('p', { class: 'tiny' }, m.fragmentsFound.length < FRAGMENTS_NEEDED ? `Necesitas al menos ${FRAGMENTS_NEEDED} fragmentos para formular una conclusión. Observa, espía, habla con la gente, investiga rumores.` : w.day < m.nextGuessDay ? `Tu última acusación falló. Podrás intentarlo de nuevo en ${m.nextGuessDay - w.day} días.` : 'Tienes suficientes indicios. ¿Qué crees que ocurre?'),
        !m.solved ? h('button', { class: 'btn primary block', disabled: !can, onclick: () => conclusion(app) }, 'Formular conclusión') : null,
      )));
  }

  // Rumores.
  const rumors = w.rumors.filter((r) => r.known).slice().reverse();
  out.push(section('Rumores', rumors.length ? null : empty('No has oído ningún rumor. Aún.')));
  for (const ru of rumors.slice(0, 14)) {
    const fresh = !ru.investigated;
    out.push(h('div', { class: 'card' },
      h('div', { class: 'tiny' }, `${w.regions[ru.heardIn].isHome ? 'Se comenta en tu hogar' : `Región ${w.regions[ru.heardIn].name}`} · ${ago(w.day - ru.day)}`),
      h('p', { class: 'quote' }, `«${ru.text}»`),
      ru.verdict ? h('div', null, h('span', { class: `tag ${ru.verdict === 'cierto' ? 'bad' : ru.verdict === 'falso' ? 'good' : 'warn'}` }, ru.verdict.toUpperCase()), ru.note ? h('span', { class: 'tiny' }, ` ${ru.note}`) : null) : null,
      h('div', { class: 'actions' },
        fresh ? h('button', { class: 'btn small teal', disabled: free <= 0, onclick: () => openAction(app, 'investigar', { rumor: ru.id }) }, '🔎 Investigar') : null,
        h('button', { class: 'btn small', disabled: free <= 0, onclick: () => openAction(app, 'compartir', { rumor: ru.id }) }, '📜 Compartir'),
        fresh ? h('button', { class: 'btn small', onclick: () => openHypothesisComposer(app, { kind: 'rumor', rumorId: ru.id, regionId: ru.about, days: 7 }) }, '🧪') : null,
      ),
    ));
  }

  // Contradicciones.
  const pairs = contradictions(w);
  if (pairs.length) {
    out.push(section('Testimonios que no encajan',
      ...pairs.slice(-4).map(([a, b]) => h('div', { class: 'card' },
        h('p', { class: 'quote' }, `«${a.text}»`), h('p', { class: 'quote' }, `«${b.text}»`),
        h('p', { class: 'tiny' }, '¿Quizás ambos recibieron información falsa?'),
        h('button', { class: 'btn small', onclick: () => {
          const msg = compareRumors(w, a.id, b.id);
          audio.sfx('tap');
          app.modal(() => [h('h2', null, 'Comparación'), h('p', null, msg)], { onClose: () => app.refresh() });
        } }, '⚖ Comparar testimonios'),
      ))));
  }

  // Cuaderno de pistas.
  const clues = w.clues.filter((c) => w.day - c.day <= 8).slice().reverse();
  out.push(section('Cuaderno de pistas', clues.length ? null : empty('Sin pistas recientes.')));
  let day = -1;
  for (const c of clues) {
    if (c.day !== day) {
      day = c.day;
      out.push(h('div', { class: 'daysep' }, day === w.day ? 'Hoy' : `Día ${day}`));
    }
    c.read = true;
    out.push(h('div', { class: 'entry', onclick: () => app.openRegion(c.regionId) }, h('div', { class: 'ico' }, c.fragment ? '🧩' : '·'), h('div', { class: 'txt' }, c.text)));
  }
  out.push(h('p', { class: 'tiny' }, 'Algunas pistas son ruido o malentendidos. Toca una para ver la región.'));
  return out;
}

function conclusion(app: App): void {
  const w = app.w!;
  const opts = mysteryOptions(w);
  const close = app.modal(() => [
    h('h2', null, 'Tu conclusión'),
    h('p', { class: 'quote' }, mysteryQuestion(w)),
    h('p', { class: 'tiny' }, 'Una conclusión equivocada dañará tu credibilidad.'),
    ...opts.map((o) => h('button', { class: 'btn block', style: 'margin:6px 0', onclick: () => {
      const r = formConclusion(w, o.id);
      close();
      if (r === 'correcta') audio.sfx('descubrimiento');
      app.toast(r === 'correcta' ? '¡Lo has descubierto!' : r === 'incorrecta' ? 'No era eso…' : 'Aún no puedes concluir.', r !== 'correcta');
      app.refresh();
    } }, o.label)),
  ]);
}
