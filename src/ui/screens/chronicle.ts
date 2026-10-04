import { chainRoots, childrenOf } from '../../core/chronicle';
import type { Entry, EntryKind, WorldState } from '../../core/types';
import type { App } from '../app';
import { clear, h } from '../dom';
import { empty, ENTRY_ICON } from './common';
import { ensureLife } from '../../world/life';
import { seasonOf, yearOf } from '../../world/clock';
import { storyLine, type StoryEntry } from '../../world/identity';

/**
 * Crónica (registro de acontecimientos) e historial de consecuencias.
 * Las cadenas muestran cómo una decisión desencadenó otras; los eslabones
 * que aún no conoces aparecen como huecos por descubrir.
 */
type Filter = 'todo' | 'mias' | 'conflicto' | 'descubrimiento';
let filter: Filter = 'todo';

export function renderChronicle(app: App): Node[] {
  const w = app.w!;
  const container = h('div');
  const draw = () => {
    clear(container).append(
      h('h2', null, app.chronicleTab === 'vida' ? 'Tu historia' : 'Crónica del mundo'),
      h('div', { class: 'tabs' },
        h('button', { class: app.chronicleTab === 'vida' ? 'on' : '', onclick: () => ((app.chronicleTab = 'vida'), draw()) }, 'Tu historia'),
        h('button', { class: app.chronicleTab === 'dias' ? 'on' : '', onclick: () => ((app.chronicleTab = 'dias'), draw()) }, 'El mundo'),
        h('button', { class: app.chronicleTab === 'cadenas' ? 'on' : '', onclick: () => ((app.chronicleTab = 'cadenas'), draw()) }, 'Consecuencias'),
      ),
      ...(app.chronicleTab === 'vida' ? personal(w) : app.chronicleTab === 'dias' ? days(app, draw) : chains(w)),
    );
  };
  draw();
  return [container];
}

/**
 * La crónica del personaje: lo que hizo, descubrió, aprendió y decidió,
 * contado como un libro. Las vidas anteriores del linaje quedan debajo.
 */
const STORY_ICON: Record<string, string> = { despertar: '🌅', habilidad: '✋', conocimiento: '📖', talento: '✦', memoria: '🔱', logro: '★', decision: '⚖', relacion: '🤝', lugar: '🧭', error: '✗', cargo: '🏛' };

function personal(w: WorldState): Node[] {
  const life = ensureLife(w);
  const id = life.identity;
  if (!id) return [empty('Aún no hay nada que contar.')];
  const block = (name: string, entries: StoryEntry[]) =>
    h('div', null, h('h3', null, name), ...(entries.length ? entries.map((e) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, STORY_ICON[e.kind] ?? '·'), h('div', { class: 'txt' }, storyLine(e), h('div', { class: 'tiny' }, `día ${e.day} · ${seasonOf(e.day)} del año ${yearOf(e.day)}`)))) : [empty('Todavía nada.')]));
  return [
    block(life.player.name === 'Sin nombre' ? 'Alguien sin nombre' : life.player.name, [...id.story].reverse()),
    ...[...id.lives].reverse().map((l) => block(l.name, [...l.story].reverse())),
  ];
}

/**
 * La historia del mundo, por años, estaciones y generaciones. Se genera sola a
 * partir de los acontecimientos reales que conoces.
 */
function days(app: App, redraw: () => void): Node[] {
  const w = app.w!;
  const life = ensureLife(w);
  const kinds: Record<Filter, (e: Entry) => boolean> = {
    todo: (e) => e.importance >= 2 || !!e.byPlayer,
    mias: (e) => !!e.byPlayer,
    conflicto: (e) => e.kind === 'conflicto' || e.kind === 'diplomacia',
    descubrimiento: (e) => e.kind === 'descubrimiento' || e.kind === 'informacion',
  };
  const list = w.entries.filter((e) => e.known && kinds[filter](e)).slice(-200).reverse();
  const reigns = [...life.player.lineage.map((a) => ({ name: a.name, from: a.fromDay, to: a.toDay, title: a.title })), { name: life.player.name, from: life.player.since, to: Infinity, title: '' }];
  const reignOf = (day: number) => reigns.find((r) => day >= r.from && day <= r.to) ?? reigns[reigns.length - 1];
  const out: Node[] = [
    h('div', { class: 'choices', style: 'margin-bottom:8px' },
      ...([['todo', 'Lo importante'], ['mias', 'Mis decisiones'], ['conflicto', 'Conflictos y tratados'], ['descubrimiento', 'Descubrimientos']] as [Filter, string][]).map(([f, l]) =>
        h('button', { class: filter === f ? 'on' : '', onclick: () => ((filter = f), redraw()) }, l))),
  ];
  if (!list.length) out.push(empty('Todavía no hay historia que contar. Sal a vivirla.'));
  let year = -1;
  let reign = '';
  for (const e of list) {
    const y = yearOf(e.day);
    const rg = reignOf(e.day);
    if (y !== year) {
      year = y;
      out.push(h('div', { class: 'year' }, h('span', null, `Año ${y}`)));
    }
    if (rg.name !== reign) {
      reign = rg.name;
      out.push(h('div', { class: 'reign' }, `En tiempos de ${rg.name}${rg.title ? `, «${rg.title}»` : ''}`));
    }
    out.push(h('div', { class: `chron ${e.byPlayer ? 'player' : ''} imp${e.importance}`, onclick: () => {
      const r = e.regions.find((id) => !w.regions[id].isHome);
      if (r !== undefined) app.openRegion(r);
    } },
      h('div', { class: 'chron-ico' }, ENTRY_ICON[e.kind]),
      h('div', null, h('div', { class: 'chron-date' }, `${capFirst(seasonOf(e.day))}, día ${((e.day - 1) % 5) + 1}${e.byPlayer ? ` · decisión de ${reignOf(e.day).name}` : ''}`), h('div', { class: 'chron-text' }, e.text)),
    ));
  }
  return out;
}

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function chains(w: WorldState): Node[] {
  // Raíces: tus decisiones y los grandes acontecimientos con consecuencias.
  const roots = chainRoots(w)
    .filter((e) => (e.known ? e.byPlayer || e.importance >= 2 || hasKnownDescendant(w, e) : hasKnownDescendant(w, e)))
    .reverse()
    // Primero las cadenas que empezaron con tus decisiones.
    .sort((a, b) => Number(!!b.byPlayer) - Number(!!a.byPlayer));
  const out: Node[] = [h('p', { class: 'lead' }, 'Cada decisión deja huella. Aquí ves qué provocó qué. Los huecos son consecuencias que aún no has descubierto.')];
  if (!roots.length) out.push(empty('Aún no hay cadenas de consecuencias visibles. Toma decisiones y deja pasar los días.'));
  for (const root of roots.slice(0, 30)) out.push(h('div', { class: 'chain' }, root.known ? node(w, root, true, 0) : hiddenNode(w, root, 0)));
  return out;
}

function node(w: WorldState, e: Entry, root: boolean, depth: number): HTMLElement {
  const kids = childrenOf(w, e.id);
  const visible = kids.filter((k) => k.known);
  const hidden = kids.filter((k) => !k.known);
  // Si un eslabón oculto tiene consecuencias conocidas, se muestra como hueco.
  const hiddenWithKnownDesc = hidden.filter((k) => hasKnownDescendant(w, k));
  const el = h('div', { class: `node ${root ? 'root' : ''}` },
    h('div', { class: 't' }, `${ENTRY_ICON[e.kind as EntryKind]} ${e.text}`),
    h('div', { class: 'd' }, `Día ${e.day}`),
  );
  if (depth < 8) {
    const children = h('div', { class: 'children' });
    for (const k of visible) children.append(node(w, k, false, depth + 1));
    for (const k of hiddenWithKnownDesc) children.append(hiddenNode(w, k, depth + 1));
    const silent = hidden.length - hiddenWithKnownDesc.length;
    if (silent > 0) children.append(h('div', { class: 'node hidden' }, h('div', { class: 't' }, `◌ ${silent === 1 ? 'Algo más ocurrió' : `${silent} cosas más ocurrieron`} como consecuencia… (sin descubrir)`)));
    el.append(children);
  }
  return el;
}

function hiddenNode(w: WorldState, e: Entry, depth: number): HTMLElement {
  const where = e.regions.map((id) => (w.intel[id].level ? w.regions[id].name : '¿?')).join(', ');
  const el = h('div', { class: 'node hidden' }, h('div', { class: 't' }, `◌ Algo ocurrió en ${where}… (investiga para saberlo)`), h('div', { class: 'd' }, `Día ${e.day}`));
  const children = h('div', { class: 'children' });
  for (const k of childrenOf(w, e.id)) {
    if (k.known) children.append(node(w, k, false, depth + 1));
    else if (hasKnownDescendant(w, k)) children.append(hiddenNode(w, k, depth + 1));
  }
  el.append(children);
  return el;
}

function hasKnownDescendant(w: WorldState, e: Entry, depth = 0): boolean {
  if (depth > 10) return false;
  return childrenOf(w, e.id).some((k) => k.known || hasKnownDescendant(w, k, depth + 1));
}
