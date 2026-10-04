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
