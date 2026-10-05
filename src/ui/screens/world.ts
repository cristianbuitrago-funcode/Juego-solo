import type { App } from '../app';
import { clear, h } from '../dom';
import { empty } from './common';
import { ensureLife } from '../../world/life';
import { gensOf, type HistKind } from '../../world/genstate';
import { told, yearOfDay } from '../../world/history';
import { atlasOf, TIER_NAME } from '../../world/atlas';
import { AIMS, AIM_BY_ID, chooseAim, dropAim, myAims } from '../../world/aims';
import { currentEra } from '../../world/epochs';
import { describeRealms, describeStates } from '../../world/states';
import { GOV } from '../../world/polstate';
import { describeSettlement } from '../../world/settlements';
import { techName } from '../../world/knowledge';

/**
 * El archivo del mundo: un museo de lo que ha pasado (familia, pueblos,
 * guerras, descubrimientos, personajes, ciudades, épocas, estados, tierras
 * lejanas) y los propósitos de quien vive ahora. Solo se ve lo que se sabe:
 * lo que nadie recuerda no está en ninguna vitrina.
 */
type Room = 'propositos' | 'epocas' | 'estados' | 'lugares' | 'guerras' | 'saberes' | 'personajes' | 'familia' | 'lejos';
let room: Room = 'propositos';

const ROOMS: [Room, string][] = [
  ['propositos', '🎯 Propósitos'],
  ['epocas', '⏳ Épocas'],
  ['estados', '🏛 Estados'],
  ['lugares', '🏘 Lugares'],
  ['guerras', '⚔ Guerras'],
  ['saberes', '💡 Saberes'],
  ['personajes', '👤 Personajes'],
  ['familia', '🌳 Familia'],
  ['lejos', '⛵ Más allá'],
];

export function renderWorld(app: App): Node[] {
  const box = h('div');
  const draw = () => {
    clear(box).append(
      h('h2', null, 'El mundo y su memoria'),
      h('p', { class: 'tiny' }, `${currentEra(app.w!)} · año ${yearOfDay(app.w!.day)} · semilla ${app.w!.seed}`),
      h('div', { class: 'tabs wrap' }, ...ROOMS.map(([k, l]) => h('button', { class: room === k ? 'on' : '', onclick: () => ((room = k), draw()) }, l))),
      ...ROOM[room](app, draw),
    );
  };
  draw();
  return [box];
}

const card = (title: string, ...lines: (string | Node | null)[]) => h('div', { class: 'card' }, h('b', null, title), ...lines.filter(Boolean).map((l) => (typeof l === 'string' ? h('p', { class: 'muted' }, l) : l)));

function hist(app: App, kinds: HistKind[], limit = 30): Node[] {
  const w = app.w!;
  const ev = gensOf(w).history.filter((e) => kinds.includes(e.kind)).slice(-limit).reverse();
  if (!ev.length) return [empty('Nadie recuerda nada de esto todavía.')];
  return ev.map((e) => h('div', { class: `entry imp${Math.min(3, e.importance)}` }, h('div', { class: 'txt' }, told(w, e), h('div', { class: 'tiny' }, `Año ${yearOfDay(e.day)}${e.monument ? ' · tiene monumento' : ''}`))));
}

const ROOM: Record<Room, (app: App, redraw: () => void) => Node[]> = {
  propositos: (app, redraw) => {
    const w = app.w!;
    const mine = myAims(w);
    const life = ensureLife(w);
    const past = atlasOf(w).aims.filter((a) => a.gen < life.player.generation && a.done);
    return [
      h('p', { class: 'lead' }, 'No hay un final. Elige qué quieres hacer con esta vida (hasta tres cosas). El mundo seguirá igual, lo consigas o no.'),
      ...(mine.length ? mine.map((a) => card(`${a.done ? '✔' : '◌'} ${AIM_BY_ID[a.id].name}`, AIM_BY_ID[a.id].text, a.done ? `Conseguido en el año ${yearOfDay(a.done)}.` : AIM_BY_ID[a.id].hint(w), a.done ? null : h('button', { class: 'btn small ghost', onclick: () => (dropAim(w, a.id), redraw()) }, 'Renunciar'))) : [empty('Aún no te has propuesto nada.')]),
      h('h3', null, 'Proponerse algo'),
      h('div', { class: 'actions' }, ...AIMS.filter((d) => !mine.some((a) => a.id === d.id)).map((d) => h('button', { class: 'btn small', onclick: () => (app.toast(chooseAim(w, d.id)), redraw()) }, d.name, h('small', null, d.text)))),
      past.length ? h('h3', null, 'Lo que lograron quienes vinieron antes') : null,
      ...past.map((a) => h('p', { class: 'muted' }, `Generación ${a.gen}: ${AIM_BY_ID[a.id].name.toLowerCase()} (año ${yearOfDay(a.done!)}).`)),
    ].filter(Boolean) as Node[];
  },
  epocas: (app) => {
    const w = app.w!;
    const eras = [...atlasOf(w).eras].reverse();
    return [
      h('p', { class: 'lead' }, 'Cada diez años la gente le pone nombre a lo vivido. Nadie lo decide: sale de lo que pasó.'),
      ...eras.map((e) => card(e.name, `Desde el año ${yearOfDay(e.from)}${e.to ? ` hasta el ${yearOfDay(e.to)}` : ' (ahora)'}.`, e.why)),
    ];
  },
  estados: (app) => {
    const w = app.w!;
    const pol = ensureLife(w).politics;
    return [
      h('p', { class: 'lead' }, 'Quién manda dónde. Las fronteras cambian con las guerras, los pactos y las independencias.'),
      ...describeStates(w).map((l) => h('p', null, l)),
      h('h3', null, 'Cómo se gobierna cada pueblo'),
      ...w.regions.filter((r) => w.intel[r.id].level > 0 || r.isHome).map((r) => h('p', { class: 'muted' }, `${r.name}: ${pol?.govs[r.id] ? GOV[pol.govs[r.id].system].name : 'un consejo'}.`)),
      h('h3', null, 'Gobiernos que cayeron, leyes, fronteras'),
      ...hist(app, ['gobierno', 'rebelion', 'frontera', 'tratado', 'ley'], 20),
    ];
  },
  lugares: (app) => {
    const w = app.w!;
    const a = atlasOf(w);
    const known = (id: number) => w.intel[id].level > 0 || w.regions[id].isHome;
    const sts = a.settlements.filter((s) => known(s.regionId));
    const pois = a.pois.filter((p) => p.found !== undefined);
    return [
      h('p', { class: 'lead' }, 'Los lugares nacen, crecen, se vacían y se arruinan.'),
      ...(sts.length ? sts.map((s) => card(`${s.name} · ${s.state === 'vivo' ? TIER_NAME[s.tier] : s.state}`, ...describeSettlement(w, s).slice(1))) : [empty('Aún no se ha fundado nada nuevo (que sepas).')]),
      h('h3', null, 'Lugares con historia que has visto'),
      ...(pois.length ? pois.map((p) => card(p.name, `${w.regions[p.regionId].name}. ${p.text}`)) : [empty('Explora: hay ruinas, cuevas y restos que esperan.')]),
      h('h3', null, 'Fundaciones y pueblos'),
      ...hist(app, ['fundacion', 'pueblo'], 20),
    ];
  },
  guerras: (app) => [h('p', { class: 'lead' }, 'Las guerras, sus causas y lo que dejaron.'), ...hist(app, ['guerra', 'paz'])],
  saberes: (app) => {
    const w = app.w!;
    const a = atlasOf(w);
    return [
      h('p', { class: 'lead' }, 'Las técnicas no se investigan: viajan con la gente que las sabe.'),
      a.playerTechs.length ? card('Lo que tú sabes hacer', a.playerTechs.map(techName).join(', ') + '.') : null,
      ...hist(app, ['descubrimiento']),
    ].filter(Boolean) as Node[];
  },
  personajes: (app) => [h('p', { class: 'lead' }, 'Gente que la isla no olvida (o que va olvidando).'), ...hist(app, ['hazana', 'muerte'])],
  familia: (app) => [h('p', { class: 'lead' }, 'Las familias del mundo: bodas, nacimientos, herencias.'), ...hist(app, ['familia', 'boda', 'nacimiento', 'herencia'])],
  lejos: (app) => {
    const w = app.w!;
    const lines = describeRealms(w);
    return [
      h('p', { class: 'lead' }, 'Más allá del mar hay otras tierras. Solo se sabe de ellas lo que traen los barcos.'),
      ...(lines.length ? lines.map((l) => h('p', null, l)) : [empty(Object.keys(atlasOf(w).ports).length ? 'Aún no ha llegado ningún barco de fuera.' : 'Sin un puerto, el mar es un muro.')]),
    ];
  },
};
