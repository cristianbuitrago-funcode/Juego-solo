import type { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { folkById, trait } from './society';
import type { Folk } from './types';
import { orgsOf, orgsOfFolk } from './orgs';
import { govOf, leanOf, votersOf } from './politics';
import { secretsHeldBy } from './intrigue';
import { warOf, enemyOf } from './war';
import { GOV, LAWS, polOf } from './polstate';
import { stanceOf } from './diplomacy';

/**
 * La política se oye en la calle: quien vota cuenta (o insinúa) qué votará,
 * los del gremio repiten sus quejas, alguien deja caer lo que sabe, otro
 * se preocupa por la guerra. Así se mide el apoyo: con conversaciones, no
 * con números.
 */
export function politicalTalk(w: WorldState, f: Folk, rng: Rng): string | null {
  if (!w.life?.politics || f.age < 14 || !f.p) return null;
  const pol = polOf(w);
  const g = govOf(w, f.regionId);
  const options: { w: number; line: () => string }[] = [];
  const mine = orgsOfFolk(w, f.id);
  for (const o of mine) o.known = o.known || !o.hidden;
  // Una votación en la que participa.
  const prop = pol.proposals.find((p) => p.regionId === f.regionId && p.status === 'abierta' && votersOf(w, p).some((v) => v.id === f.id));
  if (prop) {
    options.push({
      w: 3,
      line: () => {
        if (!prop.heard.includes(f.id) && (f.trust > 0.4 || trait(f, 'sociable') > 60)) prop.heard.push(f.id);
        const l = leanOf(w, f.id, prop);
        const what = LAWS[prop.law].label[prop.value];
        if (f.trust < 0.4 && trait(f, 'reservado') > 55) return `Se vota lo de ${what}. Lo que yo vote es cosa mía.`;
        return l > 0.35 ? `Lo de ${what}: votaré que sí, y con ganas.` : l > 0.06 ? `Lo de ${what}… creo que votaré a favor.` : l > -0.06 ? `Lo de ${what}: aún no sé qué votar. Hay razones para todo.` : l > -0.35 ? `Lo de ${what} no me convence. Votaré que no, salvo que alguien me dé una buena razón.` : `¿${what.charAt(0).toUpperCase() + what.slice(1)}? Por encima de mi cadáver.`;
      },
    });
  } else {
    const any = pol.proposals.find((p) => p.regionId === f.regionId && p.status === 'abierta');
    const o = mine.find((x) => x.kind !== 'comunidad') ?? mine[0];
    if (any && o) options.push({ w: 1.5, line: () => `En ${o.name} se habla de lo de ${LAWS[any.law].label[any.value]}. ${leanOf(w, o.leader && o.leader !== 'jugador' ? o.leader : f.id, any) > 0 ? 'Casi todos lo quieren.' : 'No gusta nada.'}` });
  }
  // Las quejas de su grupo.
  const angry = mine.find((o) => o.discontent > 0.55 && o.grievance);
  if (angry) options.push({ w: 2, line: () => (angry.action ? `Estamos ${angry.action.kind === 'huelga' ? 'de huelga' : angry.action.kind === 'boicot' ? 'con los puestos cerrados' : 'en la calle'}: ${angry.grievance}. No pararemos hasta que nos escuchen.` : `En ${angry.name} estamos hartos: ${angry.grievance}.`) });
  // Quien gobierna.
  const ruler = g.ruler && g.ruler !== 'jugador' ? folkById(w, g.ruler) : undefined;
  if (ruler && ruler.id !== f.id) {
    if (g.legitimacy < 0.35) options.push({ w: 1.5, line: () => `${ruler.name} no durará mucho. Ya nadie le hace caso.` });
    else if (g.legitimacy > 0.7) options.push({ w: 0.5, line: () => `Con ${ruler.name} se vive tranquilo. Que dure.` });
  }
  if (g.ruler === 'jugador') options.push({ w: 1, line: () => (g.legitimacy > 0.55 ? 'Dicen que gobiernas con cabeza. Ya veremos.' : 'Hay quien dice que no estás a la altura del cargo.') });
  // Elecciones cerca.
  if (GOV[g.system].elections && g.nextElection !== undefined && g.nextElection - w.day <= 6) options.push({ w: 1.5, line: () => `Pronto hay elecciones. ${pol.candidacy[f.regionId] ? (f.trust > 0.6 ? 'Yo te votaré.' : f.trust < 0.4 ? 'A ti no te votaría ni loco.' : 'Aún no sé a quién votar.') : 'Siempre ganan los mismos.'}` });
  // La oposición.
  const reb = pol.rebellions[f.regionId];
  if (reb && reb.stage >= 2 && reb.leader && reb.leader !== f.id) {
    const lead = folkById(w, reb.leader);
    if (lead) options.push({ w: 1.5, line: () => (mine.some((o) => o.discontent > 0.55) ? `${lead.name} dice lo que muchos pensamos.` : `${lead.name} va a acabar mal, con tanto hablar contra quien manda.`) });
  }
  // Lo que sabe y deja caer (si se fía).
  const sec = secretsHeldBy(w, f).find((s) => s.about !== f.id);
  if (sec && f.trust > 0.62) options.push({ w: 2, line: () => ((sec.suspected = true), sec.hint) });
  // La guerra.
  const war = warOf(w, f.regionId);
  if (war) {
    const side = war.a === f.regionId || war.b === f.regionId ? f.regionId : Number(Object.entries(war.allies).find(([, l]) => l.includes(f.regionId))?.[0] ?? f.regionId);
    const enemy = w.regions[enemyOf(war, side)]?.name;
    options.push({ w: 3, line: () => rng.pick([`Con la guerra contra ${enemy} no hay quien viva. Todo sube.`, `Mi primo está en el frente. No sabemos nada de él.`, `Que acabe ya esta guerra. Me da igual quién gane.`, `Hay que plantar cara a los de ${enemy}. Si no, vendrán aquí.`]) });
  } else {
    const tense = Object.keys(w.regions[f.regionId].relations).map(Number).find((id) => stanceOf(w, f.regionId, id) === 'rivalidad');
    if (tense !== undefined) options.push({ w: 1, line: () => `Con los de ${w.regions[tense].name} acabaremos mal. Ya lo verás.` });
  }
  // Un grupo del pueblo que hace ruido.
  const loud = orgsOf(w, f.regionId).find((o) => o.action && !mine.includes(o));
  if (loud) options.push({ w: 1.2, line: () => `${loud.name} ${loud.action!.kind === 'huelga' ? 'está de huelga' : loud.action!.kind === 'boicot' ? 'tiene los puestos cerrados' : 'protesta en la plaza'}. ${mine.some((o) => o.discontent > 0.5) ? 'Hacen bien.' : 'Así no se arregla nada.'}` });
  if (!options.length) return null;
  const pick = rng.weighted(options, (o) => o.w);
  return pick ? pick.line() : null;
}

/** En la posada se oye cómo va cada votación y alguna cosa que no debería saberse. */
export function tavernPolitics(w: WorldState, regionId: number, rng: Rng): string[] {
  if (!w.life?.politics) return [];
  const pol = polOf(w);
  const out: string[] = [];
  for (const p of pol.proposals.filter((x) => x.regionId === regionId && x.status === 'abierta')) {
    if (!p.heard.includes('posada')) p.heard.push('posada');
    out.push(`En las mesas se discute lo de ${LAWS[p.law].label[p.value]}. Unos golpean la mesa a favor; otros se van dando un portazo.`);
  }
  const s = pol.secrets.find((x) => x.regionId === regionId && !x.known && !x.public && x.expires > w.day && rng.chance(0.5));
  if (s) {
    s.suspected = true;
    out.push(`Alguien baja la voz: «${s.hint}»`);
  }
  for (const o of orgsOf(w, regionId).filter((x) => x.discontent > 0.6 && !x.hidden).slice(0, 1)) out.push(`Los de ${o.name} beben callados en un rincón. Están que trinan: ${o.grievance ?? 'no se sabe bien por qué'}.`);
  return out.slice(0, 3);
}
