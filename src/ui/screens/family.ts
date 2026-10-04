import { DEFAULT_PLAYER_LOOK, playerAppearance, SKINS, type PlayerLook } from '../../render/appearance';
import { drawPortrait } from '../../render/human';
import { KNOWS, MAX_LEVEL, questions, SKILLS, STANDING, TALENTS, tryFragment, whoAmI, type KnowId, type SkillId } from '../../world/identity';
import { ensureLife, heirs } from '../../world/life';
import { showFragment } from '../world-dialogs';
import { yearOf } from '../../world/clock';
import type { App } from '../app';
import { h } from '../dom';
import { empty, section } from './common';

/**
 * Quién soy: lo que el protagonista sabe de sí mismo. Al principio casi nada:
 * ni su nombre. Poco a poco aparecen habilidades, conocimientos, recuerdos,
 * reputación y, con suerte, una familia. Solo se muestra lo descubierto.
 */
export function renderFamily(app: App): Node[] {
  const w = app.w!;
  const life = ensureLife(w);
  const p = life.player;
  const id = life.identity!;
  const hs = heirs(life);
  const metFolk = life.folk.filter((f) => f.lastMet >= 0 && f.alive);
  const friends = metFolk.filter((f) => f.gratitude > 0.45 || f.trust > 0.6).length;
  const enemies = metFolk.filter((f) => f.resentment > 0.5).length;
  const amnesia = id.mode === 'forastero' && id.past && !id.named;
  const bar = (v: number, bad: boolean) => h('div', { class: `meter ${bad ? 'bad' : v > 0.5 ? 'warm' : ''}` }, h('div', { class: 'meter-fill', style: `width:${Math.round(v * 100)}%` }));
  const skills = (Object.entries(id.skills) as [SkillId, (typeof id.skills)[SkillId]][]).filter(([, t]) => t.level > 0).sort((a, b) => b[1].xp - a[1].xp);
  const know = (Object.entries(id.know) as [KnowId, (typeof id.know)[KnowId]][]).filter(([, t]) => t.level > 0).sort((a, b) => b[1].xp - a[1].xp);
  const dots = (lv: number) => '●'.repeat(lv) + '○'.repeat(MAX_LEVEL - lv);
  const places = w.regions.filter((r) => (id.standing[r.id] ?? 0) > 0 || life.visited[r.id] !== undefined);
  const memories = id.story.filter((e) => e.kind === 'memoria');
  const out: (Node | null)[] = [
    h('h2', null, 'Quién soy'),
    h('div', { class: 'card' },
      h('b', null, amnesia ? (id.nickname === 'Sin nombre' ? 'No recuerdas tu nombre' : `Te llaman «${id.nickname}»`) : p.name),
      h('p', { class: 'muted' }, `${amnesia ? `Aparentas unos ${p.age} años` : `${p.age} años`}${p.generation > 1 ? ` · generación ${p.generation}` : ''}${id.temper ? ` · de carácter ${id.temper}` : ''}`),
      h('p', null, whoAmI(id)),
      h('p', { class: 'muted' }, `${metFolk.length === 1 ? 'Has conocido a una persona.' : `Has conocido a ${metFolk.length} personas.`} ${friends ? `${friends} te aprecian.` : ''} ${enemies ? `${enemies} te guardan rencor.` : ''}`),
      p.age > 55 ? h('p', { class: 'tiny' }, 'Los años pesan. Piensa en quién tomará el relevo.') : null,
    ),
    id.mode === 'forastero'
      ? section('Cómo estás',
          h('div', { class: 'need' }, h('span', null, '🍞 Hambre'), bar(id.needs.hunger, id.needs.hunger > 0.8)),
          h('div', { class: 'need' }, h('span', null, '💤 Cansancio'), bar(id.needs.fatigue, id.needs.fatigue > 0.85)),
          h('p', { class: 'muted' }, `🪙 ${id.needs.coins} monedas · 🎒 ${p.inventory.comida} de comida · ${p.inventory.hierbas} hierbas · ${p.inventory.reliquias} objetos de valor`),
          h('p', { class: 'tiny' }, id.housed ? 'Tienes una casa donde dormir.' : 'No tienes dónde dormir: la posada cuesta dinero; al raso se descansa mal.'),
        )
      : null,
    id.past ? section('Preguntas', ...questions(w).map((q) => h('p', { class: 'quote' }, q))) : null,
    section('Habilidades',
      skills.length ? null : empty('Aún no sabes qué se te da bien. Lo descubrirás haciendo cosas.'),
      ...skills.map(([k, t]) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, SKILLS[k].icon), h('div', { class: 'txt' }, `${SKILLS[k].name} `, h('span', { class: 'dots' }, dots(t.level)), h('div', { class: 'tiny' }, t.past ? 'Lo sabías antes de olvidarlo todo.' : `Desde el día ${t.found}.`)))),
    ),
    section('Conocimientos',
      know.length ? null : empty('Lo que comprendes del mundo aparecerá aquí.'),
      ...know.map(([k, t]) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, KNOWS[k].icon), h('div', { class: 'txt' }, `${KNOWS[k].name} `, h('span', { class: 'dots' }, dots(t.level)), t.past ? h('div', { class: 'tiny' }, 'No recuerdas haberlo aprendido.') : null))),
    ),
    id.talents.length ? section('Dones', ...id.talents.map((t) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, '✦'), h('div', { class: 'txt' }, h('b', null, TALENTS[t].name), h('div', { class: 'tiny' }, TALENTS[t].desc))))) : null,
    section('Reputación',
      places.length ? null : empty('Nadie te conoce todavía.'),
      ...places.map((r) => {
        const lv = id.standing[r.id] ?? 0;
        const offer = id.offers.find((o) => o.regionId === r.id);
        return h('div', { class: 'entry' }, h('div', { class: 'ico' }, lv >= 4 ? '🏛' : lv >= 2 ? '🤝' : '·'), h('div', { class: 'txt' }, `${r.name}: ${STANDING[lv].name}`, h('div', { class: 'tiny' }, offer ? `Te esperan en el salón: quieren que seas ${STANDING[offer.level].name.toLowerCase()}.` : STANDING[lv].hint)));
      }),
    ),
    id.items.length
      ? section('Lo que llevas',
          ...id.items.map((it) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, '🔱'), h('div', { class: 'txt' }, it === 'colgante' ? 'Un colgante con un símbolo' : it, h('div', null, h('button', { class: 'btn small', onclick: () => { const ev = tryFragment(w, { kind: 'colgante' }); if (ev) showFragment(app, ev); } }, 'Mirarlo'))))),
        )
      : null,
    memories.length ? section('Recuerdos', ...memories.map((e) => h('p', { class: 'quote' }, e.text))) : null,
    lookEditor(app),
    section('Familia',
      p.family.length ? null : empty(id.past?.family && id.fragments.some((f) => f.id === 'sueno') ? 'Quizá tuviste una familia. No la recuerdas.' : 'No tienes familia.'),
      ...p.family.map((k) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, k.relation === 'aprendiz' ? '🧑‍🎓' : '🧒'), h('div', { class: 'txt' }, `${k.name}, ${k.relation}`, h('div', { class: 'tiny' }, `${k.age} años${hs.includes(k) ? ' · podría sucederte' : ''}`)))),
    ),
    p.lineage.length
      ? section('Quienes vinieron antes', ...p.lineage.map((a) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, '🕯'), h('div', { class: 'txt' }, `${a.name} · «${a.title}»`, h('div', { class: 'tiny' }, `del año ${yearOf(a.fromDay)} al año ${yearOf(a.toDay)}`)))))
      : null,
  ];
  return out.filter((x): x is Node => !!x);
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
