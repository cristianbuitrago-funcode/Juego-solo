import type { WorldState } from '../core/types';
import { GOOD, GOODS, type Good } from '../world/economy';
import { playerEco } from '../world/business';
import { story, type GainNote } from '../world/identity';
import { folkById } from '../world/society';
import type { Folk } from '../world/types';
import { canFound, completeTask, describeOrg, foundOrg, offerTask, orgById, orgsOf, orgsOfFolk, repWord, respondTo } from '../world/orgs';
import { answerPolOffer, canPropose, declareCandidacy, govOf, isAdviser, lobby, playerPropose, playerSeat, REBEL_STAGE, supportReading, votersOf } from '../world/politics';
import { canRepresent, type Offer, describeRelations, interest, negotiate, proposeFederation, relOf, stanceOf, STANCE_WORD, treatiesOf } from '../world/diplomacy';
import { pry, readDocuments, readMarket, secretsHeldBy, secretUses, useSecret } from '../world/intrigue';
import { describeWar, enemyOf, enlist, helpRefugees, mediationAgreed, spyArmy, supplyArmy, warOf } from '../world/war';
import { FORECAST_VARS, makeForecast } from '../world/forecast';
import { INFLUENCE, influenceLevel, influenceLines } from '../world/influence';
import { legacyLines } from '../world/legacy';
import { GOV, LAWS, LAW_IDS, ORG_RANK, polOf, TREATY, type LawId, type Org, type Proposal, type TreatyKind } from '../world/polstate';
import type { App } from './app';
import { h } from './dom';
import { section, empty } from './screens/common';
import { dialogue } from './world-dialogs';

/**
 * La política en la interfaz: siempre dentro del mundo (hablando con la
 * gente, en el salón, en la posada) y nunca como una lista de botones de
 * poder. Lo que se puede hacer depende de quién eres, a quién conoces, qué
 * sabes y qué tienes.
 */
interface Choice {
  label: string;
  run: () => void;
  hint?: string;
  primary?: boolean;
}

const say = (app: App, title: string, lines: string[], notes: GainNote[] = [], then?: () => void) => {
  app.notes(notes);
  dialogue(app, title, '', lines, [{ label: 'Seguir', run: () => (then ? then() : app.refresh()), primary: true }]);
};

const nameOf = (w: WorldState, id: string | undefined) => (id === 'jugador' ? 'tú' : id ? folkById(w, id)?.name ?? 'alguien' : 'nadie');

// ---------------------------------------------------------------------------
// El salón: el gobierno del pueblo, sus leyes, lo que se debate
// ---------------------------------------------------------------------------
export function townAffairs(app: App, regionId: number): void {
  const w = app.w!;
  const r = w.regions[regionId];
  const g = govOf(w, regionId);
  const pol = polOf(w);
  const id = w.life!.identity!;
  const stand = id.standing[regionId] ?? 0;
  const open = pol.proposals.filter((p) => p.regionId === regionId && p.status === 'abierta');
  const lines = [
    `Aquí manda ${GOV[g.system].name === 'consejo' ? 'un consejo' : `un ${GOV[g.system].name}`}: ${GOV[g.system].how}`,
    g.ruler ? `Al frente: ${nameOf(w, g.ruler)}. ${g.legitimacy > 0.65 ? 'La gente lo acepta.' : g.legitimacy > 0.4 ? 'Hay quien murmura.' : 'Casi nadie le respeta ya.'}` : 'Ahora mismo nadie manda del todo.',
    g.council.length > 1 ? `Votan o aconsejan: ${g.council.map((c) => nameOf(w, c)).join(', ')}.` : '',
    open.length ? `Se debate: ${open.map((p) => LAWS[p.law].label[p.value]).join('; ')}.` : 'Ahora no se debate nada importante.',
    GOV[g.system].elections && g.nextElection !== undefined ? `Las próximas elecciones, ${g.nextElection - w.day <= 0 ? 'hoy' : `dentro de ${g.nextElection - w.day} días`}.` : '',
    ...g.history.slice(-2).map((x) => `Hace poco: ${x.text}`),
  ].filter(Boolean);
  const choices: Choice[] = [];
  for (const [i, o] of pol.offers.entries()) if (o.regionId === regionId) choices.push({ label: `✉ ${offerLabel(w, o)}`, primary: true, run: () => offerDialog(app, i) });
  for (const p of open) choices.push({ label: `🗳 ${LAWS[p.law].label[p.value]}`, hint: playerSeat(w, regionId) ? 'Tienes voto' : 'Ver quién apoya y quién no', run: () => proposalDialog(app, p.id) });
  choices.push({ label: '📜 Las leyes de aquí', run: () => lawsDialog(app, regionId) });
  if (orgsOf(w, regionId).some((o) => o.known && !o.hidden)) choices.push({ label: '👥 Los grupos del pueblo', run: () => orgsDialog(app, regionId) });
  if (g.ruler === 'jugador') choices.push(...rulerDuties(app, regionId));
  if (GOV[g.system].elections && g.ruler !== 'jugador' && !pol.candidacy[regionId] && stand >= 2) choices.push({ label: '🗣 Presentarte a las elecciones', run: () => { const res = declareCandidacy(w, regionId); say(app, 'Elecciones', [res.text]); } });
  choices.push({ label: '🤝 Los vecinos y los tratados', run: () => relationsDialog(app, regionId) });
  choices.push({ label: stand >= 3 ? '📒 Revisar las cuentas del pueblo' : '🌒 Mirar las cuentas a escondidas', hint: stand >= 3 ? 'Te dejan.' : 'Si te pillan, lo sabrá todo el mundo.', run: () => { const res = readDocuments(w, regionId); say(app, 'Las cuentas', res.lines, res.notes); } });
  if (stand >= 2) choices.push({ label: '✊ Fundar un grupo con una causa', run: () => foundDialog(app, regionId) });
  const war = warOf(w, regionId);
  if (war) choices.push({ label: '⚔ La guerra', primary: true, run: () => warDialog(app, regionId) });
  choices.push({ label: 'Salir', run: () => app.refresh() });
  dialogue(app, `Asuntos de ${r.name}`, stand >= 3 ? 'Te dejan estar' : stand >= 1 ? 'Te miran de reojo' : 'Nadie te conoce', lines, choices);
}

function offerLabel(w: WorldState, o: ReturnType<typeof polOf>['offers'][number]): string {
  const org = orgById(w, o.orgId);
  const r = w.regions[o.regionId];
  switch (o.kind) {
    case 'miembro': return `Te invitan a entrar en ${org?.name}`;
    case 'representante': return `${org?.name} quiere que hables por ellos`;
    case 'liderazgo': return `${org?.name} te pide que lo dirijas`;
    case 'candidatura': return `Te animan a presentarte a las elecciones de ${r.name}`;
    case 'emisario': return `Llevar una propuesta a ${o.mission ? w.regions[o.mission.to].name : 'otro pueblo'}`;
    case 'diplomatico': return `Negociar en nombre de ${r.name}`;
    case 'consejero': return `Aconsejar a quien gobierna ${r.name}`;
  }
}

function offerDialog(app: App, index: number): void {
  const w = app.w!;
  const o = polOf(w).offers[index];
  if (!o) return app.refresh();
  const extra = o.kind === 'emisario' && o.mission ? [`La propuesta: un ${TREATY[o.mission.treaty].name} con ${w.regions[o.mission.to].name}. ${TREATY[o.mission.treaty].what}`, 'Tendrás que ir hasta allí y hablar con quien gobierna.'] : o.kind === 'representante' ? ['Si aceptas, tendrás asiento donde se decide (si aquí se decide en consejo).'] : [];
  dialogue(app, offerLabel(w, o), '', ['Es una oportunidad. También es una responsabilidad: lo que hagas a partir de ahora lo harás en nombre de otros.', ...extra], [
    { label: 'Aceptar', primary: true, run: () => say(app, 'Aceptas', [answerPolOffer(w, index, true)]) },
    { label: 'Rechazar', run: () => say(app, 'Rechazas', [answerPolOffer(w, index, false)]) },
  ]);
}

function lawsDialog(app: App, regionId: number): void {
  const w = app.w!;
  const g = govOf(w, regionId);
  const can = canPropose(w, regionId);
  const lines = LAW_IDS.map((l) => `${LAWS[l].name.charAt(0).toUpperCase() + LAWS[l].name.slice(1)}: ${LAWS[l].label[g.laws[l]]}.`);
  lines.push(can.ok ? can.why || 'Puedes proponer un cambio.' : can.why);
  dialogue(app, `Leyes de ${w.regions[regionId].name}`, '', lines, [
    ...(can.ok ? LAW_IDS.map((l) => ({ label: `✎ Cambiar ${LAWS[l].name}`, run: () => proposeDialog(app, regionId, l) })) : []),
    { label: 'Volver', run: () => townAffairs(app, regionId) },
  ]);
}

function proposeDialog(app: App, regionId: number, law: LawId): void {
  const w = app.w!;
  const cur = govOf(w, regionId).laws[law];
  dialogue(app, `Proponer: ${LAWS[law].name}`, `Ahora: ${LAWS[law].label[cur]}`, LAWS[law].options.filter((v) => v !== cur).map((v) => `${LAWS[law].label[v]}: ${LAWS[law].effect[v]}`), [
    ...LAWS[law].options.filter((v) => v !== cur).map((v) => ({ label: `Proponer ${LAWS[law].label[v]}`, run: () => { const res = playerPropose(w, regionId, law, v); say(app, 'Tu propuesta', [res.text]); } })),
    { label: 'Volver', run: () => lawsDialog(app, regionId) },
  ]);
}

export function proposalDialog(app: App, propId: string): void {
  const w = app.w!;
  const p = polOf(w).proposals.find((x) => x.id === propId);
  if (!p) return app.refresh();
  const who = p.from === 'jugador' ? 'Lo propusiste tú.' : p.from === 'gobierno' ? 'Lo propone el gobierno.' : `Lo propone ${orgById(w, p.from)?.name}.`;
  const voters = votersOf(w, p).filter((v) => v.id !== 'jugador');
  const lines = [who, LAWS[p.law].effect[p.value], `Se vota ${p.voteDay - w.day <= 0 ? 'hoy' : `dentro de ${p.voteDay - w.day} días`}. Votan ${voters.length > 8 ? 'todos los vecinos' : voters.map((v) => nameOf(w, v.id)).join(', ')}.`, ...supportReading(w, p)];
  const seat = playerSeat(w, p.regionId);
  const choices: Choice[] = [];
  if (seat) for (const v of ['si', 'no', 'abstencion'] as const) choices.push({ label: v === 'si' ? '✔ Votarás a favor' : v === 'no' ? '✘ Votarás en contra' : '· Te abstendrás', primary: p.playerVote === v, run: () => { p.playerVote = v; story(w, `Decidió votar ${v === 'si' ? 'a favor de' : v === 'no' ? 'en contra de' : 'en blanco sobre'} ${LAWS[p.law].label[p.value]}.`, 'decision'); proposalDialog(app, propId); } });
  choices.push({ label: 'Volver', run: () => townAffairs(app, p.regionId) });
  dialogue(app, LAWS[p.law].label[p.value].charAt(0).toUpperCase() + LAWS[p.law].label[p.value].slice(1), w.regions[p.regionId].name, [...lines, seat ? '' : 'Para cambiar votos, habla con quienes votan.'].filter(Boolean), choices);
}

/** Si gobiernas: responder a las protestas y decidir lo que te piden. */
function rulerDuties(app: App, regionId: number): Choice[] {
  const w = app.w!;
  const out: Choice[] = [];
  for (const o of orgsOf(w, regionId).filter((x) => x.action && x.action.answered === 'pendiente')) {
    out.push({ label: `📣 ${o.name} protesta`, primary: true, run: () => dialogue(app, o.name, '', [`${o.grievance ?? 'Quieren que se les escuche'}.`, o.goal ? `Piden ${LAWS[o.goal.law].label[o.goal.value]}.` : ''].filter(Boolean), [
      { label: '🤝 Ceder y estudiar lo que piden', run: () => say(app, o.name, respondTo(w, o, 'ceder', 'tú')) },
      { label: '… No hacer nada', run: () => say(app, o.name, respondTo(w, o, 'ignorar', 'tú')) },
      { label: '🛡 Mandar a la guardia', hint: 'Se acaba la protesta. No el enfado.', run: () => say(app, o.name, respondTo(w, o, 'reprimir', 'tú')) },
    ]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------
function orgsDialog(app: App, regionId: number): void {
  const w = app.w!;
  const list = orgsOf(w, regionId).filter((o) => o.known && !(o.hidden && !o.known));
  dialogue(app, `Grupos de ${w.regions[regionId].name}`, '', list.map((o) => `${o.name}: ${repWord(w, o)}.`), [
    ...list.map((o) => ({ label: o.name, run: () => orgDialog(app, o.id) })),
    { label: 'Volver', run: () => townAffairs(app, regionId) },
  ]);
}

export function orgDialog(app: App, orgId: string, viaFolk?: string): void {
  const w = app.w!;
  const o = orgById(w, orgId);
  if (!o) return app.refresh();
  o.known = true;
  const lead = o.leader && o.leader !== 'jugador' ? folkById(w, o.leader) : undefined;
  const talkingToLeader = !viaFolk || viaFolk === o.leader;
  const choices: Choice[] = [];
  const pol = polOf(w);
  const t = o.player.task && o.player.task.until >= w.day ? o.player.task : undefined;
  if (o.player.expelled && w.day - o.player.expelled < 30) {
    dialogue(app, o.name, '', ['«Tú ya no eres bienvenido aquí.»'], [{ label: 'Irte', run: () => app.refresh() }]);
    return;
  }
  if (t) choices.push({ label: `✔ Cumplir el encargo`, hint: t.text, primary: true, run: () => { const res = completeTask(w, o); say(app, o.name, [res.text], res.notes); } });
  else if (talkingToLeader && o.leader !== 'jugador') choices.push({ label: '🤲 Ofrecer tu ayuda', run: () => { const task = offerTask(w, o); say(app, o.name, task ? [`«Pues mira, nos vendría bien esto:» ${task.text}`, `(Tienes hasta dentro de ${task.until - w.day} días.)`] : ['«Ahora no necesitamos nada. Gracias.»']); } });
  const inv = pol.offers.findIndex((x) => x.orgId === o.id);
  if (inv >= 0) choices.push({ label: `✉ ${offerLabel(w, pol.offers[inv])}`, primary: true, run: () => offerDialog(app, inv) });
  if (o.player.rank >= 2 && o.goal) {
    const p = pol.proposals.find((x) => x.regionId === o.regionId && x.status === 'abierta' && x.law === o.goal!.law);
    if (!p) choices.push({ label: `📜 Que el grupo pida ${LAWS[o.goal.law].label[o.goal.value]}`, run: () => { const res = playerPropose(w, o.regionId, o.goal!.law, o.goal!.value); say(app, o.name, [res.text]); } });
  }
  if (o.player.rank >= 2 && o.player.rank < 4) choices.push({ label: '🚪 Dejar el grupo', run: () => { o.player.rank = 1; story(w, `Dejó ${o.name}.`, 'decision'); say(app, o.name, ['Te vas. Algunos lo entienden; otros, no.']); } });
  if (o.player.rank === 4 && o.founder === 'jugador') choices.push({ label: '📣 Llevar la causa al consejo', run: () => { const res = playerPropose(w, o.regionId, o.cause!.law, o.cause!.value); say(app, o.name, [res.text]); } });
  choices.push({ label: 'Volver', run: () => app.refresh() });
  dialogue(app, o.name, lead ? `Lo dirige ${lead.name}` : o.leader === 'jugador' ? 'Lo diriges tú' : '', describeOrg(w, o), choices);
}

function foundDialog(app: App, regionId: number): void {
  const w = app.w!;
  const laws = govOf(w, regionId).laws;
  const opts = LAW_IDS.flatMap((l) => LAWS[l].options.filter((v) => v !== laws[l]).map((v) => ({ l, v })));
  dialogue(app, 'Fundar un grupo', '', ['Un grupo necesita una causa: algo que cambiar. Y gente que la comparta.'], [
    ...opts.slice(0, 12).map(({ l, v }) => {
      const c = canFound(w, regionId, l, v);
      return { label: `Por ${LAWS[l].label[v]}`, hint: c.ok ? `${c.who.length} personas te seguirían` : c.why, run: () => {
        const name = `${l === 'agricultura' ? 'Los del granero' : l === 'impuestos' ? 'Los del bolsillo' : l === 'educacion' ? 'Los de la escuela' : l === 'recursos' ? 'Los del bosque' : l === 'migracion' ? 'Puertas abiertas' : l === 'seguridad' ? 'Los vigilantes' : l === 'comercio' ? 'Los del camino' : l === 'trabajo' ? 'Manos libres' : 'Los de la tierra'} de ${w.regions[regionId].name}`;
        const res = foundOrg(w, regionId, l, v, name);
        say(app, 'Un grupo nuevo', [res.text]);
      } };
    }),
    { label: 'Volver', run: () => townAffairs(app, regionId) },
  ]);
}

// ---------------------------------------------------------------------------
// Hablar con alguien de política (se añade a la conversación normal)
// ---------------------------------------------------------------------------
export function politicalChoices(app: App, f: Folk): Choice[] {
  const w = app.w!;
  if (!w.life?.politics) return [];
  const pol = polOf(w);
  const out: Choice[] = [];
  const g = govOf(w, f.regionId);
  // Una votación en la que vota.
  const prop = pol.proposals.find((p) => p.regionId === f.regionId && p.status === 'abierta' && votersOf(w, p).some((v) => v.id === f.id));
  if (prop) out.push({ label: `🗳 Hablarle de ${LAWS[prop.law].label[prop.value]}`, hint: 'Convencer, negociar, cambiar favores…', run: () => lobbyDialog(app, f.id, prop.id) });
  // Sus grupos.
  for (const o of orgsOfFolk(w, f.id).filter((x) => !x.hidden && (x.leader === f.id || x.kind !== 'comunidad')).slice(0, 1)) out.push({ label: `👥 ${o.name}`, hint: repWord(w, o), run: () => orgDialog(app, o.id, f.id) });
  // Quien gobierna.
  if (g.ruler === f.id) out.push({ label: '⚖ Tratar con quien gobierna', run: () => rulerDialog(app, f.id) });
  // Lo que sabe.
  if (secretsHeldBy(w, f).some((s) => s.suspected)) out.push({ label: '🔎 Sonsacarle lo que sabe', hint: 'Puede decir la verdad, callar… o mentir.', run: () => { const res = pry(w, f); say(app, f.name, res.lines, res.notes); } });
  // La oposición.
  const reb = pol.rebellions[f.regionId];
  if (reb && reb.stage >= 2 && reb.leader === f.id && f.trust > 0.45) {
    out.push({ label: reb.joined ? '✊ Estás con la oposición' : '✊ Unirte a la oposición', hint: 'Si triunfa, cambiará el gobierno. Si fracasa, caerás con ellos.', run: () => { reb.joined = true; story(w, `Se unió a la oposición de ${w.regions[f.regionId].name}.`, 'decision'); say(app, f.name, ['«Sabía que no eras como los demás.» Te aprieta la mano.']); } });
  }
  // La guerra.
  if (warOf(w, f.regionId) && (f.role === 'guardia' || g.ruler === f.id)) out.push({ label: '⚔ La guerra', run: () => warDialog(app, f.regionId) });
  return out;
}

function lobbyDialog(app: App, folkId: string, propId: string): void {
  const w = app.w!;
  const f = folkById(w, folkId)!;
  const p = polOf(w).proposals.find((x) => x.id === propId)!;
  const pol = polOf(w);
  const id = w.life!.identity!;
  const known = pol.secrets.filter((s) => s.known && !s.public);
  const onThem = known.filter((s) => s.about === f.id);
  const owed = pol.favors[f.id] ?? 0;
  const run = (how: Parameters<typeof lobby>[3], extra?: Parameters<typeof lobby>[4]) => () => {
    const res = lobby(w, folkId, propId, how, extra);
    app.notes(res.notes);
    dialogue(app, f.name, LAWS[p.law].label[p.value], res.lines, [{ label: 'Seguir hablando', run: () => lobbyDialog(app, folkId, propId) }, { label: 'Dejarlo', run: () => app.refresh(), primary: true }]);
  };
  const choices: Choice[] = [
    { label: '💬 Darle razones', hint: 'Lo que sabes cuenta: economía, política, lo que has visto.', run: run('argumento') },
    { label: '🤝 Ofrecerle tu apoyo a cambio', hint: 'Te comprometes a apoyar lo que pide su grupo.', run: run('favor') },
  ];
  if (owed > 0) choices.push({ label: '🪙 Recordarle que te debe un favor', run: run('cobro') });
  for (const s of known.filter((x) => x.regionId === p.regionId && x.about !== f.id).slice(0, 2)) choices.push({ label: `📜 Contarle lo que sabes`, hint: s.text.slice(0, 60), run: run('informacion', { secret: s.id }) });
  for (const s of onThem.slice(0, 1)) choices.push({ label: '🌒 Recordarle lo que sabes de él', hint: 'Votará lo que digas. Y no lo olvidará.', run: run('chantaje', { secret: s.id }) });
  if (id.needs.coins >= 5) choices.push({ label: '💰 Ofrecerle unas monedas', hint: 'A unos les ofende; a otros les convence.', run: run('soborno', { coins: Math.min(15, id.needs.coins) }) });
  choices.push({ label: 'Mejor no', run: () => app.refresh() });
  dialogue(app, f.name, `Sobre ${LAWS[p.law].label[p.value]}`, [`Se vota ${p.voteDay - w.day <= 0 ? 'hoy' : `dentro de ${p.voteDay - w.day} días`}.`], choices);
}

function rulerDialog(app: App, folkId: string): void {
  const w = app.w!;
  const f = folkById(w, folkId)!;
  const regionId = f.regionId;
  const pol = polOf(w);
  const choices: Choice[] = [];
  const can = canPropose(w, regionId);
  if (can.ok) choices.push({ label: '📜 Pedirle un cambio de ley', run: () => lawsDialog(app, regionId) });
  if (isAdviser(w, regionId)) choices.push({ label: '🧭 Aconsejarle', hint: 'Lo tendrá en cuenta cuando decida.', run: () => adviceDialog(app, regionId) });
  // Negociar en nombre de otro pueblo (si lo representas).
  for (const from of w.regions.filter((r) => r.id !== regionId && canRepresent(w, r.id))) choices.push({ label: `🤝 Negociar en nombre de ${from.name}`, run: () => negotiateDialog(app, from.id, regionId) });
  // Mediar en una guerra.
  const war = warOf(w, regionId);
  if (war) choices.push({ label: '🕊 Proponerle la paz', run: () => mediate(app, regionId) });
  // Avisarle de una conspiración.
  for (const s of pol.secrets.filter((x) => x.known && x.kind === 'conspiracion' && x.regionId === regionId && !x.used.includes('advertir'))) choices.push({ label: '🗝 Avisarle de la conspiración', hint: 'Te lo agradecerá. Los conjurados, no.', run: () => { const res = useSecret(w, s.id, 'advertir'); say(app, f.name, res.lines, res.notes); } });
  // Una oposición que pide cosas: mediar.
  const reb = pol.rebellions[regionId];
  const angry = orgsOf(w, regionId).filter((o) => o.discontent > 0.55 && o.goal);
  if (angry.length) choices.push({ label: '⚖ Interceder por los descontentos', hint: angry.map((o) => o.name).join(', '), run: () => intercede(app, folkId, angry[0]) });
  choices.push({ label: 'Volver', run: () => app.refresh() });
  dialogue(app, f.name, `Gobierna ${w.regions[regionId].name}`, [reb && reb.stage >= 1 ? `En el pueblo hay ${REBEL_STAGE[reb.stage]}.` : '', `${GOV[govOf(w, regionId).system].how}`].filter(Boolean), choices);
}

function intercede(app: App, rulerId: string, o: Org): void {
  const w = app.w!;
  const f = folkById(w, rulerId)!;
  const id = w.life!.identity!;
  const odds = (f.trust - 0.4) + (id.standing[f.regionId] ?? 0) * 0.1 + (polOf(w).favors[f.id] ?? 0) * 0.15;
  if (odds > 0.35) {
    const lines = respondTo(w, o, 'ceder', f.name);
    story(w, `Intercedió por ${o.name} ante ${f.name}.`, 'decision');
    say(app, f.name, ['«Está bien. Les escucharé. Pero que sepan que lo hago porque me lo pides tú.»', ...lines]);
  } else say(app, f.name, ['«¿Y tú quién eres para decirme cómo gobernar?»']);
}

function adviceDialog(app: App, regionId: number): void {
  const w = app.w!;
  const g = govOf(w, regionId);
  const open = polOf(w).proposals.filter((p) => p.regionId === regionId && p.status === 'abierta');
  dialogue(app, 'Tu consejo', '', open.length ? ['Te pregunta qué opinas de lo que se debate.'] : ['Ahora no hay nada que decidir.'], [
    ...open.flatMap((p) => [
      { label: `A favor de ${LAWS[p.law].label[p.value]}`, run: () => { (g.advice ??= {})[p.law] = p.value; say(app, 'Tu consejo', ['Asiente despacio. Lo tendrá en cuenta.']); } },
      { label: `En contra de ${LAWS[p.law].label[p.value]}`, run: () => { (g.advice ??= {})[p.law] = g.laws[p.law]; say(app, 'Tu consejo', ['Frunce el ceño, pero escucha.']); } },
    ]),
    { label: 'Volver', run: () => app.refresh() },
  ]);
}

// ---------------------------------------------------------------------------
// Diplomacia
// ---------------------------------------------------------------------------
function relationsDialog(app: App, regionId: number): void {
  const w = app.w!;
  const tr = treatiesOf(w, regionId);
  const lines = [...describeRelations(w, regionId), ...(tr.length ? [] : ['No hay ningún tratado en vigor.'])];
  const choices: Choice[] = [];
  if (canRepresent(w, regionId)) for (const t of tr.filter((x) => x.kind === 'alianza')) {
    const other = t.a === regionId ? t.b : t.a;
    choices.push({ label: `🏛 Proponer una federación con ${w.regions[other].name}`, run: () => say(app, 'Federación', [proposeFederation(w, regionId, other)]) });
  }
  choices.push({ label: 'Volver', run: () => townAffairs(app, regionId) });
  dialogue(app, `${w.regions[regionId].name} y sus vecinos`, '', lines, choices);
}

function negotiateDialog(app: App, from: number, to: number): void {
  const w = app.w!;
  const kinds: TreatyKind[] = relOf(w, from, to).war ? ['paz'] : ['comercio', 'recursos', 'defensa', 'fronteras', 'alianza'];
  const st = stanceOf(w, from, to);
  dialogue(app, `Negociar con ${w.regions[to].name}`, `En nombre de ${w.regions[from].name} · ${STANCE_WORD[st]}`, ['¿Qué les propones?'], [
    ...kinds.map((k) => ({ label: TREATY[k].name.charAt(0).toUpperCase() + TREATY[k].name.slice(1), hint: `${TREATY[k].what}${interest(w, to, from, k) > 0.3 ? ' Parece que les interesa.' : ''}`, run: () => tryDeal(app, from, to, k, {}) })),
    { label: 'Volver', run: () => app.refresh() },
  ]);
}

function tryDeal(app: App, from: number, to: number, kind: TreatyKind, offer: Offer): void {
  const w = app.w!;
  const res = negotiate(w, from, to, kind, offer);
  app.notes(res.notes);
  app.passTime(60);
  const choices: Choice[] = [];
  if (res.status === 'contraoferta' && res.ask) {
    const id = w.life!.identity!;
    const pe = playerEco(w);
    const canPay = res.ask.coins ? id.needs.coins >= res.ask.coins : (pe.cargo[res.ask.good!] ?? 0) >= (res.ask.n ?? 1);
    if (canPay) choices.push({ label: `Aceptar: ${res.ask.coins ? `${res.ask.coins} monedas` : `${res.ask.n} de ${GOOD[res.ask.good!].name}`}`, primary: true, run: () => tryDeal(app, from, to, kind, { ...offer, coins: (offer?.coins ?? 0) + (res.ask!.coins ?? 0), good: res.ask!.good ?? offer?.good, n: (offer?.n ?? 0) + (res.ask!.n ?? 0) }) });
  }
  if (res.status !== 'acepta') {
    const leverage = polOf(w).secrets.find((s) => s.known && !s.public && (s.regionId === to || s.about === govOf(w, to).ruler) && !offer?.secret);
    if (leverage) choices.push({ label: '📜 Usar lo que sabes', hint: leverage.text.slice(0, 60), run: () => tryDeal(app, from, to, kind, { ...offer, secret: leverage.id }) });
  }
  choices.push({ label: res.status === 'acepta' ? 'Seguir' : 'Dejarlo', run: () => app.refresh(), primary: res.status === 'acepta' });
  dialogue(app, res.status === 'acepta' ? '¡Acuerdo!' : res.status === 'contraoferta' ? 'Regatean' : 'No hay trato', TREATY[kind].name, res.lines, choices);
}

function mediate(app: App, regionId: number): void {
  const w = app.w!;
  const war = warOf(w, regionId)!;
  const side = war.a === regionId || war.b === regionId ? regionId : war.a;
  const enemy = enemyOf(war, side);
  const res = negotiate(w, enemy, side, 'paz', {});
  app.notes(res.notes);
  if (res.status === 'acepta' || res.treaty) return say(app, 'La paz', [...res.lines, ...mediationAgreed(w, war, side)]);
  say(app, 'La paz', [...res.lines, 'Habrá que volver más tarde, o con algo que ofrecer.']);
}

export function warDialog(app: App, regionId: number): void {
  const w = app.w!;
  const war = warOf(w, regionId);
  if (!war) return say(app, 'La guerra', ['Ya no hay guerra aquí.']);
  const side = war.a === regionId || war.b === regionId ? regionId : war.a;
  const enemy = enemyOf(war, side);
  const pe = playerEco(w);
  const hasSupply = Object.keys(pe.cargo).some((g) => GOODS.includes(g as Good) && (['trigo', 'verdura', 'fruta', 'carne', 'pescado', 'armas'] as string[]).includes(g));
  dialogue(app, `Guerra: ${w.regions[war.a].name} contra ${w.regions[war.b].name}`, war.playerSide !== undefined ? `Luchas por ${w.regions[war.playerSide].name}` : 'No has tomado partido', describeWar(w, war), [
    { label: `⚔ Luchar por ${w.regions[side].name}`, hint: 'Arriesgas la piel. Te lo recordarán los dos bandos.', run: () => { const res = enlist(w, war, side); say(app, 'La batalla', res.lines, res.notes); } },
    ...(hasSupply ? [
      { label: '🍞 Regalar tu carga al ejército', run: () => { const res = supplyArmy(w, war, side, false); say(app, 'Suministros', res.lines, res.notes); } },
      { label: '🪙 Vender tu carga al ejército', hint: 'A precio de guerra.', run: () => { const res = supplyArmy(w, war, side, true); say(app, 'Suministros', res.lines, res.notes); } },
    ] : []),
    { label: `👁 Espiar al ejército de ${w.regions[enemy].name}`, hint: 'Lo que sepas puede decidir la guerra.', run: () => { const res = spyArmy(w, war, enemy); say(app, 'Espiar', res.lines, res.notes); } },
    { label: '🕊 Mediar la paz', hint: 'Hay que convencer a los dos bandos, a cada uno en su casa.', run: () => mediate(app, regionId) },
    { label: '🤲 Ayudar a los que huyen', run: () => { const res = helpRefugees(w, regionId); say(app, 'Refugiados', res.lines, res.notes); } },
    { label: 'Mantenerte al margen', run: () => app.refresh() },
  ]);
}

// ---------------------------------------------------------------------------
// Lo que sabes (secretos) e hipótesis
// ---------------------------------------------------------------------------
export function secretsDialog(app: App): void {
  const w = app.w!;
  const pol = polOf(w);
  const known = pol.secrets.filter((s) => s.known && !s.public);
  const sus = pol.secrets.filter((s) => s.suspected && !s.known);
  dialogue(app, 'Lo que sabes', '', [...(known.length ? known.map((s) => `✔ ${s.text}`) : ['No sabes nada con certeza.']), ...sus.map((s) => `? ${s.hint} (${s.testimonies.length ? `${s.testimonies.length} versiones` : 'sin confirmar'})`)], [
    ...known.map((s) => ({ label: `Qué hacer con: «${s.text.slice(0, 40)}…»`, run: () => dialogue(app, 'Qué hacer con lo que sabes', w.regions[s.regionId].name, [s.text], [
      ...secretUses(w, s).map((u) => ({ label: u.label, hint: u.hint, run: () => { const res = useSecret(w, s.id, u.use); say(app, 'Lo que sabes', res.lines, res.notes); } })),
      { label: 'Guardártelo', run: () => app.refresh() },
    ]) })),
    { label: 'Cerrar', run: () => app.refresh() },
  ]);
}

export function marketSuspicion(app: App, regionId: number): void {
  const res = readMarket(app.w!, regionId);
  say(app, 'Los precios', res.lines, res.notes);
}

export function forecastDialog(app: App, regionId: number): void {
  const w = app.w!;
  dialogue(app, 'Una hipótesis', w.regions[regionId].name, ['¿Qué crees que pasará? Elige qué mirar, qué esperas y para cuándo. El mundo dirá si acertaste.'], [
    ...FORECAST_VARS.map((v) => ({ label: v.label, run: () => forecastStep(app, regionId, v.v) })),
    { label: 'Volver', run: () => app.refresh() },
  ]);
}

function forecastStep(app: App, regionId: number, variable: (typeof FORECAST_VARS)[number]['v']): void {
  const w = app.w!;
  const due = w.day + 10;
  const mk = (o: Partial<Parameters<typeof makeForecast>[1]> & { prediction: 'sube' | 'baja' | 'igual' | 'si' | 'no' }) => () => {
    const f = makeForecast(w, { variable, regionId, due, ...o } as Parameters<typeof makeForecast>[1]);
    story(w, `Se atrevió a predecir: ${f.text}`, 'decision');
    say(app, 'Hipótesis', [`Apuntado: «${f.text}» Lo comprobarás el día ${f.due}.`]);
  };
  const dirs = (extra: object) => [
    { label: 'Subirá', run: mk({ ...extra, prediction: 'sube' }) },
    { label: 'Bajará', run: mk({ ...extra, prediction: 'baja' }) },
    { label: 'Seguirá igual', run: mk({ ...extra, prediction: 'igual' }) },
  ];
  const yesNo = (extra: object) => [{ label: 'Sí', run: mk({ ...extra, prediction: 'si' }) }, { label: 'No', run: mk({ ...extra, prediction: 'no' }) }];
  let choices: Choice[] = [];
  if (variable === 'precio') choices = (['trigo', 'carne', 'hierro', 'herramientas', 'madera', 'armas'] as Good[]).flatMap((g) => [{ label: `${GOOD[g].icon} ${GOOD[g].name}: subirá`, run: mk({ good: g, prediction: 'sube' }) }, { label: `${GOOD[g].icon} ${GOOD[g].name}: bajará`, run: mk({ good: g, prediction: 'baja' }) }]);
  else if (variable === 'descontento') choices = orgsOf(w, regionId).filter((o) => o.known && !o.hidden).flatMap((o) => [{ label: `${o.name}: más enfado`, run: mk({ orgId: o.id, prediction: 'sube' }) }, { label: `${o.name}: menos`, run: mk({ orgId: o.id, prediction: 'baja' }) }]);
  else if (variable === 'votacion') choices = polOf(w).proposals.filter((p) => p.regionId === regionId && p.status === 'abierta').flatMap((p: Proposal) => [{ label: `${LAWS[p.law].label[p.value]}: saldrá`, run: mk({ propId: p.id, prediction: 'si' }) }, { label: `${LAWS[p.law].label[p.value]}: no saldrá`, run: mk({ propId: p.id, prediction: 'no' }) }]);
  else if (variable === 'guerra') choices = Object.keys(w.regions[regionId].relations).map(Number).flatMap((o) => [{ label: `Con ${w.regions[o].name}: habrá guerra`, run: mk({ other: o, prediction: 'si' }) }, { label: `Con ${w.regions[o].name}: no`, run: mk({ other: o, prediction: 'no' }) }]);
  else if (variable === 'ley') choices = LAW_IDS.flatMap((l) => yesNo({ law: l }).map((c) => ({ ...c, label: `${LAWS[l].name}: ${c.label === 'Sí' ? 'cambiará' : 'no cambiará'}` })));
  else choices = dirs({});
  if (!choices.length) choices = [{ label: 'No hay nada que mirar aquí ahora', run: () => forecastDialog(app, regionId) }];
  dialogue(app, 'Una hipótesis', `En diez días`, [], [...choices.slice(0, 14), { label: 'Volver', run: () => forecastDialog(app, regionId) }]);
}

// ---------------------------------------------------------------------------
// Quién soy: influencia, grupos, cargos, lo que sabes, predicciones, legado
// ---------------------------------------------------------------------------
export function politicsSections(app: App): HTMLElement[] {
  const w = app.w!;
  if (!w.life?.politics) return [];
  const pol = polOf(w);
  const lv = influenceLevel(w);
  const out: HTMLElement[] = [];
  out.push(section('Influencia',
    h('div', { class: 'entry' }, h('div', { class: 'ico' }, ['·', '👋', '🤝', '⭐', '🏛', '👑'][lv]), h('div', { class: 'txt' }, h('b', null, INFLUENCE[lv].name), h('div', { class: 'tiny' }, INFLUENCE[lv].hint))),
    ...influenceLines(w).map((l) => h('p', { class: 'tiny' }, l)),
  ));
  const mine = orgsOf(w).filter((o) => o.player.rank > 0 || Math.abs(o.player.rep) > 0.15 || o.player.expelled);
  if (mine.length) out.push(section('Los grupos y tú', ...mine.map((o) => h('div', { class: 'entry' }, h('div', { class: 'ico' }, o.player.rank >= 3 ? '🏛' : o.player.rank >= 2 ? '🤝' : '·'), h('div', { class: 'txt' }, h('b', null, `${o.name} · ${w.regions[o.regionId].name}`), h('div', { class: 'tiny' }, `${repWord(w, o)}${o.player.rank >= 1 ? ` · ${ORG_RANK[o.player.rank]}` : ''}${o.player.task && o.player.task.until >= w.day ? ` · encargo: ${o.player.task.text}` : ''}`))))));
  const roles = pol.roles.filter((r) => !r.lost);
  const seats = w.regions.filter((r) => govOf(w, r.id).ruler === 'jugador' || playerSeat(w, r.id));
  if (roles.length || seats.length) out.push(section('Cargos', ...seats.map((r) => h('p', null, govOf(w, r.id).ruler === 'jugador' ? `Gobiernas ${r.name}.` : `Tienes voto en ${r.name}.`)), ...roles.map((r) => h('p', null, `${r.kind === 'diplomatico' ? 'Diplomático' : r.kind === 'emisario' ? 'Emisario' : 'Consejero'} de ${w.regions[r.regionId].name}${r.mission ? `: llevar un ${TREATY[r.mission.treaty].name} a ${w.regions[r.mission.to].name}` : ''}.`))));
  const known = pol.secrets.filter((s) => s.known || s.suspected);
  out.push(section('Lo que sabes', known.length ? null : empty('Aún no sabes nada que otros quieran esconder.'), ...known.slice(-6).map((s) => h('p', { class: 'tiny' }, s.known ? `✔ ${s.text}` : `? ${s.hint}`)), known.length ? h('button', { class: 'btn small', onclick: () => secretsDialog(app) }, 'Qué hacer con ello') : null));
  const fc = pol.forecasts.slice(-6);
  if (fc.length) out.push(section('Tus hipótesis', ...fc.map((f) => h('p', { class: 'tiny' }, `${f.result ? ({ acierto: '✔', fallo: '✘', parcial: '½', inesperado: '⁉' } as const)[f.result] : '…'} ${f.text}${f.explanation ? ` — ${f.explanation}` : ''}`))));
  const leg = legacyLines(w);
  if (leg.length) out.push(section('Lo que dejas', ...leg.map((l) => h('p', { class: 'tiny' }, l))));
  return out;
}
