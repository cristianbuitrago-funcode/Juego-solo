import type { App } from './app';
import type { Folk } from '../world/types';
import { ensureLife } from '../world/life';
import { atlasOf } from '../world/atlas';
import { examinePoi, describeSettlement, playerFound } from '../world/settlements';
import { learnTech, teachTech, techName, techsOfFolk, knowOf } from '../world/knowledge';
import { story } from '../world/identity';
import { cultureOf, profileOf } from '../world/culture';
import { dialogue } from './world-dialogs';

/**
 * El mundo completo en la interfaz (Fase 6): visitar asentamientos y
 * lugares con historia, aprender y enseñar técnicas, fundar un lugar.
 */
interface Choice {
  label: string;
  run: () => void;
  hint?: string;
  primary?: boolean;
}

const done = (app: App): Choice => ({ label: 'Seguir', run: () => app.refresh(), primary: true });

export function settlementDialog(app: App, id: string): void {
  const w = app.w!;
  const s = atlasOf(w).settlements.find((x) => x.id === id);
  if (!s) return;
  const lines = describeSettlement(w, s);
  if (s.state === 'vivo' && s.regionId !== w.player.home) {
    const lang = profileOf(cultureOf(w, s.regionId)).language;
    lines.push(`Alguien te saluda: «${lang.words.hola}».`);
  }
  dialogue(app, s.name, w.regions[s.regionId].name, lines, [done(app)]);
}

export function poiDialog(app: App, id: string): void {
  const w = app.w!;
  const p = atlasOf(w).pois.find((x) => x.id === id);
  if (!p) return;
  const first = p.found === undefined;
  const lines = examinePoi(w, p);
  if (first) story(w, `Encontró ${p.name.charAt(0).toLowerCase()}${p.name.slice(1)} en ${w.regions[p.regionId].name}.`, 'lugar');
  dialogue(app, p.name, w.regions[p.regionId].name, lines, [done(app)]);
}

/** Lo que se puede hacer con alguien en relación con el mundo grande. */
export function worldChoices(app: App, f: Folk): Choice[] {
  const w = app.w!;
  const life = ensureLife(w);
  if (!life.atlas || life.identity?.mode !== 'forastero' || f.age < 14) return [];
  const out: Choice[] = [];
  const a = atlasOf(w);
  // Aprender lo que esta persona sabe hacer (si te tiene confianza).
  const learnable = techsOfFolk(w, f);
  if (learnable.length && f.trust >= 0.45) out.push({ label: `🛠 Pedirle que te enseñe ${techName(learnable[0])}`, hint: 'Cuesta unas horas. Luego podrás llevarlo a otros pueblos.', run: () => {
    const r = learnTech(w, f, learnable[0]);
    app.notes(r.notes);
    dialogue(app, f.name, '', r.lines, [done(app)]);
  } });
  // Enseñar lo que tú sabes y aquí no se practica.
  const teach = a.playerTechs.filter((t) => !w.regions[f.regionId].techs.includes(t) && (knowOf(w, f.regionId, t)?.adoption ?? 0) < 0.35);
  if (teach.length && f.trust >= 0.35) out.push({ label: `📐 Enseñarle ${techName(teach[0])}`, hint: 'Las técnicas viajan con la gente: contigo también.', run: () => dialogue(app, f.name, '', [teachTech(w, f, teach[0])], [done(app)]) });
  // Fundar un lugar con quienes te siguen.
  const followers = life.folk.filter((x) => x.alive && x.regionId === f.regionId && x.trust >= 0.6 && x.age >= 16).length;
  if (f.trust >= 0.6 && followers >= 4 && !a.settlements.some((s) => s.byPlayer && s.state === 'vivo')) out.push({ label: '🏕 Proponerle fundar un lugar nuevo', hint: `${followers} personas confían en ti lo bastante. Cuesta unas 30 monedas.`, run: () => {
    const r = playerFound(w, followers);
    dialogue(app, r.ok ? r.s!.name : f.name, '', [r.text], [done(app)]);
  } });
  return out;
}
