import { advanceDay } from '../core/api';
import type { WorldState } from '../core/types';
import { appearanceOf, SKINS, type PlayerLook } from '../render/appearance';
import { ensureLife } from '../world/life';
import { doorOf, getLayout, nearestWalkable } from '../world/layout';
import { levelOf, type GainNote } from '../world/identity';
import { folkById } from '../world/society';
import type { Folk } from '../world/types';
import { DAYS_PER_YEAR } from '../world/types';
import { adopt, bondOf, canApprentice, canCourt, court, healthLines, isOrphan, keyName, partnerFolk, proposeUnion, shareSecret, takeApprentice, talkChildren, teach, teachable } from '../world/generations';
import { assetsOf, beneficiaryName, describeHeirloom, FAME_WORD, fameOf, heirloomsHeld, payDebt, resolveDispute, setWill } from '../world/estate';
import { lifeChronicle, stageLines, successorsOf, succeedTo, type Successor } from '../world/succession';
import { housesLines, templeRecords, timeline, worldChronicle } from '../world/history';
import { gensOf, type Asset, type Beneficiary } from '../world/genstate';
import { orgsOf } from '../world/orgs';
import type { App } from './app';
import { h } from './dom';
import { empty, section } from './screens/common';
import { dialogue } from './world-dialogs';

/**
 * Las generaciones en la interfaz: nada de «fin de la partida». Al morir el
 * protagonista se cuenta su vida y se elige quién continúa; antes, se puede
 * enseñar, dejar testamento, formar (o no) una familia. Y siempre se puede
 * mirar atrás: la línea temporal, la crónica del mundo, las familias.
 */
interface Choice {
  label: string;
  run: () => void;
  hint?: string;
  primary?: boolean;
}

const say = (app: App, title: string, lines: string[], notes: GainNote[] = []) => {
  app.notes(notes);
  dialogue(app, title, '', lines, [{ label: 'Seguir', run: () => app.refresh(), primary: true }]);
};

// ---------------------------------------------------------------------------
// La muerte: «Tu historia continúa»
// ---------------------------------------------------------------------------
let showing = false;

export function successionScreen(app: App): void {
  const w = app.w!;
  const life = ensureLife(w);
  if (!life.player.pendingDeath || showing) return;
  showing = true;
  const old = life.player;
  const chronicle = lifeChronicle(w);
  app.modal((close) => [
    h('div', { class: 'continues' },
      h('small', null, `Año ${Math.floor((w.day - 1) / DAYS_PER_YEAR) + 1}`),
      h('h2', null, old.name === 'Sin nombre' ? 'Quien llegó sin nombre' : old.name),
      ...chronicle.map((l) => h('p', null, l)),
      h('h3', null, 'Tu historia continúa'),
      h('p', { class: 'tiny' }, '¿Quién sigue? No será una copia: es otra vida dentro de la misma historia.'),
      h('div', { class: 'dlg-choices' }, ...successorsOf(w).map((s, i) => h('button', { class: `btn ${i === 0 ? 'teal' : ''}`, onclick: () => (close(), candidate(app, s)) }, `${s.name} · ${s.relation}${s.age ? `, ${s.age} años` : ''}`, h('small', null, s.wait ? `Aún es pequeño: pasarán ${s.wait} años hasta que tome el relevo.` : s.why)))),
    ),
  ], { cls: 'dialog', onClose: () => (showing = false) });
}

function candidate(app: App, s: Successor): void {
  const lines = [
    `${s.why} Carácter: ${s.character}.`,
    s.skills.length ? `Sabe: ${s.skills.join(', ')}.` : 'Aún no sabe hacer gran cosa.',
    s.gains.length ? `Heredaría: ${s.gains.join(', ')}.` : 'No heredaría casi nada.',
    s.burdens.length ? `Y también: ${s.burdens.join('; ')}.` : '',
    s.wait ? `Hasta que crezca, el mundo seguirá sin ti durante ${s.wait} años.` : '',
  ].filter(Boolean);
  dialogue(app, s.name, `${s.relation}${s.age ? `, ${s.age} años` : ''}`, lines, [
    { label: '🕯 Honrar el legado', hint: 'Hereda más reputación… y más enemigos y expectativas.', primary: true, run: () => takeOver(app, s, true) },
    { label: '🌱 Seguir su propio camino', hint: 'Pocos le juzgarán por lo que hizo su familia.', run: () => takeOver(app, s, false) },
    { label: 'Elegir a otra persona', run: () => ((showing = false), successionScreen(app)) },
  ]);
}

function lookFromFolk(w: WorldState, f: Folk | undefined): PlayerLook | undefined {
  if (!f) return undefined;
  const ap = appearanceOf(w, f);
  const skin = Math.max(0, SKINS.indexOf(ap.skin));
  const hair = ap.hair.style === 'calvo' || ap.hair.style === 'mono' || ap.hair.style === 'melena' ? (ap.fem ? 'largo' : 'corto') : ap.hair.style;
  return { cloak: ap.outfit.cloak?.color ?? '#8a6a3a', tunic: ap.outfit.topColor, hair: hair as PlayerLook['hair'], hairColor: ap.hair.color, fem: ap.fem, beard: (['ninguna', 'sombra', 'corta', 'larga', 'bigote'].includes(ap.beard) ? ap.beard : 'corta') as PlayerLook['beard'], skin };
}

function takeOver(app: App, s: Successor, honor: boolean): void {
  const w = app.w!;
  const look = lookFromFolk(w, s.folkId ? folkById(w, s.folkId) : undefined);
  const veil = h('div', { class: 'years-pass' }, h('div', null, s.wait ? `Pasan los años…` : 'Pasan los días del duelo…'));
  (app.stage ?? app.root).append(veil);
  window.setTimeout(() => {
    const res = succeedTo(w, s.key, honor, (x) => advanceDay(x), look);
    veil.remove();
    showing = false;
    const l = getLayout(w);
    const home = l.villages[w.player.home];
    const hogar = home.keys.find((b) => b.kind === 'hogar') ?? home.keys[0];
    const d = hogar ? doorOf(hogar) : { x: home.cx, y: home.cy };
    const spot = nearestWalkable(l, d.x, d.y);
    app.scene?.setWorld(w);
    app.scene?.teleport(spot.x, spot.y);
    app.banner(res.waited ? `${res.waited} años después` : 'Una nueva generación', res.name);
    dialogue(app, res.name, `generación ${ensureLife(w).player.generation}`, [
      ...(res.waited ? [`Han pasado ${res.waited} años. El mundo no te ha esperado.`] : []),
      'Lo que se repartió:', ...res.lines.slice(0, 6),
      ...(res.burdens.length ? [`Lo que también heredas: ${res.burdens.join('; ')}.`] : []),
    ], [{ label: 'Empezar', primary: true, run: () => app.refresh() }]);
  }, 60);
}

// ---------------------------------------------------------------------------
// En casa: testamento, dejar pasar el tiempo, tu familia
// ---------------------------------------------------------------------------
export function homeChoices(app: App): Choice[] {
  const w = app.w!;
  if (!ensureLife(w).gens) return [];
  return [
    { label: '👪 Tu familia y tu gente', run: () => familyDialog(app) },
    { label: '📜 Tu testamento', hint: 'Quién recibe qué cuando ya no estés.', run: () => willDialog(app) },
    { label: '⏳ Dejar pasar el tiempo', hint: 'Una estación o un año: el mundo sigue.', run: () => timeDialog(app) },
  ];
}

function timeDialog(app: App): void {
  const w = app.w!;
  const pass = (days: number) => () => {
    const veil = h('div', { class: 'years-pass' }, h('div', null, days >= DAYS_PER_YEAR ? 'Pasa un año…' : 'Pasa una estación…'));
    (app.stage ?? app.root).append(veil);
    window.setTimeout(() => {
      const life = ensureLife(w);
      for (let i = 0; i < days && !life.player.pendingDeath; i++) {
        advanceDay(w);
        const id = life.identity!;
        id.needs.hunger = Math.min(id.needs.hunger, 0.3);
        id.needs.fatigue = Math.min(id.needs.fatigue, 0.3);
      }
      life.clock = (w.day - 1) * 1440 + 60;
      veil.remove();
      app.scene?.setWorld(w);
      if (life.player.pendingDeath) return successionScreen(app);
      app.banner(`Día ${w.day}`, `${life.player.name}, ${life.player.age} años`);
      app.refresh();
    }, 60);
  };
  dialogue(app, 'El tiempo', '', ['Los días pasan igual: trabajas, comes, duermes. El mundo sigue a lo suyo.'], [
    { label: 'Una estación', run: pass(5) },
    { label: 'Un año', run: pass(DAYS_PER_YEAR) },
    { label: 'Mejor no', run: () => {} },
  ]);
}

function willDialog(app: App): void {
  const w = app.w!;
  const g = gensOf(w);
  const assets = assetsOf(w);
  const to = (a: Asset) => g.will?.lines.find((l) => l.asset === a)?.to ?? 'heredero';
  dialogue(app, 'Tu testamento', g.will ? `Escrito el día ${g.will.day}` : 'Aún no has dejado nada escrito', [
    'Si no dejas nada escrito, decidirá la ley del pueblo (y quizá tu familia se pelee).',
    ...assets.map((a) => `${a.label} → ${beneficiaryName(w, to(a.asset))}.`),
  ], [
    ...assets.map((a) => ({ label: `✎ ${a.label}`, run: () => pickBeneficiary(app, a.asset, a.label) })),
    { label: 'Volver', run: () => app.refresh() },
  ]);
}

function pickBeneficiary(app: App, asset: Asset, label: string): void {
  const w = app.w!;
  const life = ensureLife(w);
  const people = [...life.player.family.filter((k) => k.folkId).map((k) => ({ id: k.folkId!, label: `${k.name} (${k.relation})` })), ...Object.values(gensOf(w).bonds).filter((b) => b.affection >= 0.5 && !life.player.family.some((k) => k.folkId === b.folk)).map((b) => ({ id: b.folk, label: `${folkById(w, b.folk)?.name ?? '¿?'} (amistad)` }))].filter((x) => folkById(w, x.id)?.alive);
  const groups = orgsOf(w).filter((o) => o.player.rank >= 1);
  const set = (b: Beneficiary) => () => (setWill(w, asset, b), willDialog(app));
  dialogue(app, label, '¿Para quién?', [], [
    { label: 'Para quien continúe tu historia', run: set('heredero'), primary: true },
    ...people.slice(0, 8).map((p) => ({ label: p.label, run: set(`vecino:${p.id}`) })),
    ...groups.map((o) => ({ label: o.name, run: set(`grupo:${o.id}`) })),
    { label: 'Para el pueblo', run: set('pueblo') },
    { label: 'Volver', run: () => willDialog(app) },
  ]);
}

function familyDialog(app: App): void {
  const w = app.w!;
  const life = ensureLife(w);
  const g = gensOf(w);
  const lines = life.player.family.length ? life.player.family.map((k) => `${k.name}, ${k.relation}${k.adopted ? ' (de corazón)' : ''}, ${k.age} años.`) : ['No tienes familia. No hace falta: también se deja huella de otras maneras.'];
  const friends = Object.values(g.bonds).filter((b) => b.affection >= 0.5 && !life.player.family.some((k) => k.folkId === b.folk)).map((b) => folkById(w, b.folk)).filter((f): f is Folk => !!f?.alive);
  if (friends.length) lines.push(`Gente cercana: ${friends.slice(0, 6).map((f) => f.name).join(', ')}.`);
  const choices: Choice[] = [];
  for (const d of g.disputes.filter((x) => x.status === 'abierta')) {
    const c = folkById(w, d.claimants[0]);
    choices.push({ label: `⚖ La herencia: ${c?.name ?? 'alguien'} reclama ${d.asset}`, primary: true, run: () => dialogue(app, 'La herencia', '', [`${c?.name} cree que le corresponde ${d.asset}.`], [
      { label: 'Repartirlo', run: () => say(app, 'La herencia', resolveDispute(w, d.id, 'dividir')) },
      { label: 'Cedérselo', run: () => say(app, 'La herencia', resolveDispute(w, d.id, 'ceder')) },
      { label: 'Que decida el consejo', hint: 'Según la ley del pueblo. Alguien saldrá perdiendo.', run: () => say(app, 'La herencia', resolveDispute(w, d.id, 'juicio')) },
      { label: 'Ahora no', run: () => {} },
    ]) });
  }
  for (const d of g.debts.filter((x) => !x.paid)) choices.push({ label: `🪙 Pagar: ${d.why} (${d.amount})`, hint: `Vence en ${Math.max(0, d.due - w.day)} días`, run: () => say(app, 'La deuda', [payDebt(w, d.id)]) });
  choices.push({ label: 'Volver', run: () => app.refresh() });
  dialogue(app, 'Tu familia y tu gente', '', lines, choices);
}

// ---------------------------------------------------------------------------
// Hablar con alguien: cortejar, casarse, hijos, enseñar, aprendices, acoger
// ---------------------------------------------------------------------------
export function lifeChoices(app: App, f: Folk): Choice[] {
  const w = app.w!;
  const life = ensureLife(w);
  if (!life.gens || life.identity?.mode !== 'forastero') return [];
  const out: Choice[] = [];
  const b = bondOf(w, f.id);
  const partner = partnerFolk(w);
  if (canCourt(w, f)) out.push({ label: (b?.affection ?? 0) >= 0.65 ? '💍 Pedirle compartir la vida' : '💞 Pasar la tarde con quien te gusta', hint: 'Nada te obliga. Puede salir bien… o no.', run: () => {
    if ((b?.affection ?? 0) >= 0.65) {
      const r = proposeUnion(w, f);
      return say(app, f.name, r.lines);
    }
    const r = court(w, f);
    say(app, f.name, r.lines, r.notes);
  } });
  if (partner?.id === f.id) out.push({ label: '👶 Hablar de tener hijos', run: () => dialogue(app, f.name, '', ['¿Queréis tener hijos?'], [
    { label: 'Sí, quiero', run: () => say(app, f.name, [talkChildren(w, f, true)]) },
    { label: 'No, así estamos bien', run: () => say(app, f.name, [talkChildren(w, f, false)]) },
  ]) });
  const keys = teachable(w);
  if (keys.length && f.age >= 6 && (b?.affection ?? 0) >= 0.25) out.push({ label: '📖 Enseñarle algo de lo que sabes', hint: 'Lo que enseñes seguirá vivo cuando tú no estés.', run: () => dialogue(app, `Enseñar a ${f.name}`, '', ['¿Qué quieres enseñarle?'], [
    ...keys.slice(0, 10).map((k) => ({ label: `${keyName(k)} ${'●'.repeat(levelOf(life.identity!, k))}`, hint: (f.learned?.[k] ?? 0) ? `Ya sabe algo (${'●'.repeat(f.learned![k]!)})` : undefined, run: () => { const r = teach(w, f, k); say(app, f.name, r.lines, r.notes); } })),
    ...(life.politics?.secrets.filter((s) => s.known && !s.holders.includes(f.id)).slice(0, 2).map((s) => ({ label: `🗝 Contarle: «${s.text.slice(0, 40)}…»`, hint: 'Para que alguien lo sepa cuando tú ya no estés.', run: () => say(app, f.name, [shareSecret(w, f, s.id)]) })) ?? []),
    { label: 'Ahora no', run: () => {} },
  ]) });
  if (canApprentice(w, f)) out.push({ label: '🎓 Tomarle como aprendiz', run: () => say(app, f.name, [takeApprentice(w, f)]) });
  if (isOrphan(w, f) && life.identity!.housed && !life.player.family.some((k) => k.folkId === f.id)) out.push({ label: '🏠 Acogerle en tu casa', hint: 'No tiene a nadie.', run: () => say(app, f.name, [adopt(w, f)]) });
  return out;
}

// ---------------------------------------------------------------------------
// Templo: los registros (más fieles que la gente, pero incompletos)
// ---------------------------------------------------------------------------
export function recordsChoice(app: App, regionId: number): Choice[] {
  const w = app.w!;
  if (!ensureLife(w).gens) return [];
  return [{ label: '📜 Leer los registros del templo', hint: 'Lo que quedó escrito.', run: () => dialogue(app, 'Los registros', w.regions[regionId].name, templeRecords(w, regionId), [{ label: 'Cerrar', run: () => app.refresh(), primary: true }]) }];
}

// ---------------------------------------------------------------------------
// Quién soy (etapa, salud, familia, dinastía, objetos) y la línea temporal
// ---------------------------------------------------------------------------
export function lifeSections(app: App): HTMLElement[] {
  const w = app.w!;
  const life = ensureLife(w);
  if (!life.gens || life.identity?.mode !== 'forastero') return [];
  const g = gensOf(w);
  const out: HTMLElement[] = [];
  out.push(section('Tu vida', ...stageLines(w).map((l) => h('p', { class: 'tiny' }, l)), ...healthLines(w).map((l) => h('p', null, l))));
  const objects = heirloomsHeld(w);
  if (objects.length) out.push(section('Objetos con historia', ...objects.map((o) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, o.kind === 'espada' ? '🗡' : o.kind === 'anillo' ? '💍' : o.kind === 'llave' ? '🗝' : o.kind === 'cuaderno' ? '📓' : '🔱'), h('div', { class: 'txt' }, h('b', null, o.name), ...describeHeirloom(w, o).map((l) => h('div', { class: 'tiny' }, l)))))));
  if (g.dynasty.name || life.player.lineage.length) {
    const fame = fameOf(w);
    out.push(section('Tu familia en el mundo',
      h('p', null, `${g.dynasty.name ? `${g.dynasty.name.charAt(0).toUpperCase()}${g.dynasty.name.slice(1)}` : 'Tu linaje'}: ${life.player.generation} ${life.player.generation === 1 ? 'generación' : 'generaciones'}.${fame ? ` Tenéis fama de gente ${fame}.` : ''}`),
      ...Object.entries(g.dynasty.fame).filter(([, v]) => v > 0.4).map(([k, v]) => h('p', { class: 'tiny' }, `${FAME_WORD[k] ?? k}: ${v > 1.5 ? 'todo el mundo lo dice' : v > 0.8 ? 'se dice' : 'algunos lo dicen'}.`)),
    ));
  }
  const debts = g.debts.filter((d) => !d.paid);
  const disputes = g.disputes.filter((d) => d.status === 'abierta');
  if (debts.length || disputes.length) out.push(section('Lo que pesa', ...debts.map((d) => h('p', { class: 'tiny' }, `Debes ${d.amount} monedas: ${d.why} (vence en ${Math.max(0, d.due - w.day)} días).`)), ...disputes.map((d) => h('p', { class: 'tiny' }, `${folkById(w, d.claimants[0])?.name ?? 'Alguien'} reclama ${d.asset}.`))));
  return out;
}

/** La línea temporal y la crónica del mundo (pestaña de la crónica). */
export function historyView(app: App): Node[] {
  const w = app.w!;
  const life = ensureLife(w);
  if (!life.gens) return [empty('Aún no hay historia que contar.')];
  const tl = timeline(w);
  const wc = worldChronicle(w);
  const out: Node[] = [h('h3', null, 'Línea temporal')];
  if (!tl.length) out.push(empty('Todavía no ha pasado nada que merezca recordarse.'));
  for (const y of tl.slice(-30)) out.push(h('div', { class: 'entry' }, h('div', { class: 'ico' }, `${y.year}`), h('div', { class: 'txt' }, ...y.lines.slice(0, 4).map((l) => h('div', null, l)))));
  const block = (title: string, lines: string[]) => (lines.length ? [h('h3', null, title), ...lines.map((l) => h('p', { class: 'tiny' }, l))] : []);
  out.push(...block('Guerras y paces', wc.guerras), ...block('Gobiernos y leyes', wc.gobiernos), ...block('Pueblos', wc.pueblos), ...block('Familias', housesLines(w)), ...block('Descubrimientos', wc.descubrimientos));
  if (life.player.lineage.length) {
    out.push(h('h3', null, 'Tu linaje'));
    for (const a of life.player.lineage) out.push(h('div', { class: 'entry' }, h('div', { class: 'ico' }, '🕯'), h('div', { class: 'txt' }, h('b', null, `${a.name} · ${a.title}`), ...(a.chronicle ?? []).slice(0, 4).map((l) => h('div', { class: 'tiny' }, l)))));
  }
  return out;
}

export { gensOf };
