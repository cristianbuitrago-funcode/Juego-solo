import { DEFAULT_PLAYER_LOOK, playerAppearance, SKINS, type PlayerLook } from '../../render/appearance';
import { drawPortrait } from '../../render/human';
import { ensureLife, heirs } from '../../world/life';
import { yearOf } from '../../world/clock';
import type { App } from '../app';
import { h } from '../dom';
import { empty, section } from './common';

/** Linaje: el personaje envejece; cuando muera, otro miembro de la familia seguirá. */
export function renderFamily(app: App): Node[] {
  const w = app.w!;
  const life = ensureLife(w);
  const p = life.player;
  const hs = heirs(life);
  const metFolk = life.folk.filter((f) => f.lastMet >= 0 && f.alive);
  const friends = metFolk.filter((f) => f.gratitude > 0.45 || f.trust > 0.6).length;
  const enemies = metFolk.filter((f) => f.resentment > 0.5).length;
  return [
    h('h2', null, 'Tu linaje'),
    h('div', { class: 'card' },
      h('b', null, `${p.name}`),
      h('p', { class: 'muted' }, `${p.age} años · generación ${p.generation} · al frente de tu gente desde el año ${yearOf(p.since)}`),
      h('p', { class: 'muted' }, `🎒 ${p.inventory.comida} de comida · ${p.inventory.hierbas} hierbas · ${p.inventory.reliquias} reliquias`),
      h('p', { class: 'muted' }, `Has conocido a ${metFolk.length} personas. ${friends ? `${friends} te aprecian.` : ''} ${enemies ? `${enemies} te guardan rencor.` : ''}`),
      p.age > 55 ? h('p', { class: 'tiny' }, 'Los años pesan. Piensa en quién tomará el relevo.') : null,
    ),
    lookEditor(app),
    section('Familia',
      p.family.length ? null : empty('No tienes familia. Si mueres, un aprendiz del pueblo tomará el relevo.'),
      ...p.family.map((k) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, k.relation === 'aprendiz' ? '🧑‍🎓' : '🧒'), h('div', { class: 'txt' }, `${k.name}, ${k.relation}`, h('div', { class: 'tiny' }, `${k.age} años${hs.includes(k) ? ' · podría sucederte' : ''}`)))),
    ),
    section('Quienes vinieron antes',
      p.lineage.length ? null : empty('Eres el primero de tu linaje en este mundo.'),
      ...p.lineage.map((a) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, '🕯'), h('div', { class: 'txt' }, `${a.name} · «${a.title}»`, h('div', { class: 'tiny' }, `del año ${yearOf(a.fromDay)} al año ${yearOf(a.toDay)}`)))),
    ),
    h('p', { class: 'tiny' }, 'Quien te suceda heredará la casa, el conocimiento, la reputación y los enemigos. Los vecinos recordarán a tus antepasados.'),
  ];
}

const CLOAKS = ['#c9902c', '#8a2f2a', '#2f4f7a', '#3f5f3a', '#5a4a6a', '#3a3430'];
const TUNICS = ['#2f5f63', '#6a3a2a', '#4a5a2a', '#2a3a5a', '#7a6a4a', '#5a2a4a'];
const HAIR_COLORS = ['#2a1e14', '#4a3020', '#7a4a22', '#a8743a', '#c9a060', '#8a3a1a'];
const HAIRS: [PlayerLook['hair'], string][] = [['corto', 'Corto'], ['rizado', 'Rizado'], ['largo', 'Largo'], ['coleta', 'Coleta'], ['trenza', 'Trenza'], ['rapado', 'Rapado']];
const BEARDS: [PlayerLook['beard'], string][] = [['ninguna', 'Sin barba'], ['sombra', 'Sombra'], ['corta', 'Corta'], ['larga', 'Larga'], ['bigote', 'Bigote']];

/** Tu aspecto: capa, túnica, pelo, barba y piel. Lo ven todos en el mundo. */
function lookEditor(app: App): HTMLElement {
  const p = ensureLife(app.w!).player;
  const look: PlayerLook = { ...DEFAULT_PLAYER_LOOK, ...(p.look as PlayerLook | undefined) };
  const set = (k: Partial<PlayerLook>) => {
    p.look = { ...look, ...k };
    app.refresh();
  };
  const canvas = h('canvas', { class: 'portrait big', width: 200, height: 200 }) as HTMLCanvasElement;
  drawPortrait(canvas, playerAppearance({ ...p, look }), 'neutral', 1.3);
  const swatches = (list: string[], cur: string, key: 'cloak' | 'tunic' | 'hairColor') =>
    h('div', { class: 'swatches' }, ...list.map((c) => h('button', { class: `swatch ${c === cur ? 'on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => set({ [key]: c }) })));
  const chips = <T extends string>(list: [T, string][], cur: T, fn: (v: T) => void) =>
    h('div', { class: 'chips' }, ...list.map(([v, label]) => h('button', { class: `opt-chip ${v === cur ? 'on' : ''}`, onclick: () => fn(v) }, label)));
  return section('Tu aspecto',
    h('div', { class: 'look-editor' },
      canvas,
      h('div', { class: 'look-opts' },
        h('div', { class: 'tiny' }, 'Capa'), swatches(CLOAKS, look.cloak, 'cloak'),
        h('div', { class: 'tiny' }, 'Jubón'), swatches(TUNICS, look.tunic, 'tunic'),
        h('div', { class: 'tiny' }, 'Pelo'), swatches(HAIR_COLORS, look.hairColor, 'hairColor'),
      ),
    ),
    chips(HAIRS, look.hair, (hair) => set({ hair })),
    chips([['m', 'Hombre'], ['f', 'Mujer']] as ['m' | 'f', string][], look.fem ? 'f' : 'm', (v) => set({ fem: v === 'f' })),
    look.fem ? null : chips(BEARDS, look.beard, (beard) => set({ beard })),
    h('div', { class: 'swatches' }, ...SKINS.slice(0, 7).map((c, i) => h('button', { class: `swatch ${i === look.skin ? 'on' : ''}`, style: `background:${c}`, 'aria-label': `piel ${i + 1}`, onclick: () => set({ skin: i }) }))),
  );
}
