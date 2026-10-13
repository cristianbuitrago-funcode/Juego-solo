import { Rng } from '../core/rng';
import type { WorldState } from '../core/types';
import { clamp } from '../core/util';
import { seedRumor } from './gossip';
import { chanceOf, gain, story, type FragmentEvent, type GainNote } from './identity';
import { playerRegion } from './society';

/**
 * El secreto del heredero. Si decide callar quién es, el secreto se va filtrando: el sello de su
 * casa en el colgante, viajeros de su tierra que le miran dos veces, su forma de hablar. Cada día
 * se calienta un poco (más deprisa si anda cerca de su reino), y un día corre por el pueblo donde
 * vive un rumor que crece de boca en boca: de «es de allí» a «es su heredero y viene a espiarnos».
 * La gente desconfía de golpe (más si de verdad vino a espiar). Después, quien le pregunte le da
 * la ocasión de responder: confesar o negarlo.
 */
export function heirSecretDay(w: WorldState): string[] {
  const id = w.life?.identity;
  const past = id?.past;
  if (!id || !past?.heir || past.claim !== 'callar' || past.secretOut) return [];
  const here = playerRegion(w);
  const nearHome = here === past.origin || w.regions[past.origin].neighbors.includes(here);
  past.secretHeat = (past.secretHeat ?? 0) + 0.05 + (nearHome ? 0.06 : 0);
  if (past.secretHeat < 1) return [];
  past.secretOut = w.day;
  const H = w.regions[w.player.home];
  const O = w.regions[past.origin];
  const town = w.life!.folk.filter((f) => f.alive && f.regionId === w.player.home && f.age >= 14);
  const spy = past.deed === 'terrible';
  seedRumor(w, {
    regionId: w.player.home,
    kind: 'p_heredero',
    subject: 'jugador',
    witnesses: town.slice(0, 3).map((f) => f.id),
    heat: 1.1,
    tone: spy ? -0.7 : -0.45,
    versions: [`Dicen que el forastero es de ${O.name}.`, `Dicen que el forastero es alguien importante en ${O.name}.`, `Dicen que el forastero es el heredero de ${O.name}, y que vino a espiarnos.`, `Dicen que el heredero de ${O.name} vive entre nosotros y prepara la guerra.`],
  });
  for (const f of town) {
    f.trust = clamp(f.trust - (spy ? 0.16 : 0.1));
    f.fear = clamp(f.fear + 0.08);
  }
  story(w, `Corrió por ${H.name} el rumor de que era el heredero de ${O.name}.`, 'relacion');
  return [`Corre un rumor por ${H.name}: que eres el heredero de ${O.name}. Te miran de otra manera; alguien escupe al suelo al verte pasar.`];
}

/** Tras el rumor, la primera persona del pueblo que te lo saca te deja responder. */
export function rumorFragment(w: WorldState, folkId: string): FragmentEvent | null {
  const life = w.life!;
  const id = life.identity!;
  const past = id.past;
  if (!past?.heir || !past.secretOut || id.fragments.some((f) => f.id === 'rumor')) return null;
  const f = life.folk.find((x) => x.id === folkId);
  if (!f || f.regionId !== w.player.home) return null;
  id.fragments.push({ id: 'rumor', day: w.day });
  const O = w.regions[past.origin];
  return {
    id: 'rumor',
    title: 'Lo que se dice',
    lines: [`${f.name} no te deja ni saludar. «Dicen que eres el heredero de ${O.name}. ¿Es verdad?»`, 'A su espalda, dos vecinos han dejado de hablar para escucharte.'],
    choices: [
      { id: 'confesar', label: '«Es verdad. Y no he venido a haceros daño.»' },
      { id: 'negar', label: '«Habladurías. Soy un forastero, nada más.»' },
    ],
  };
}

/** Lo que pasa según respondas al rumor. */
export function answerRumor(w: WorldState, choice: string): { lines: string[]; notes: GainNote[] } {
  const life = w.life!;
  const id = life.identity!;
  const past = id.past!;
  const H = w.regions[w.player.home];
  const O = w.regions[past.origin];
  const town = life.folk.filter((f) => f.alive && f.regionId === w.player.home);
  const gen = life.player.generation;
  const frag = id.fragments.find((f) => f.id === 'rumor');
  if (frag) frag.choice = choice;
  if (choice === 'confesar') {
    // La verdad dicha a tiempo duele menos que la descubierta: se recupera parte de la confianza.
    for (const f of town) {
      f.trust = clamp(f.trust + 0.06);
      f.memories.push({ day: w.day, kind: 'honestidad', weight: 0.2, gen });
    }
    past.claim = 'renunciar';
    story(w, `Reconoció ante ${H.name} que era el heredero de ${O.name}.`, 'decision');
    return { lines: ['Lo dices en voz alta. Hay un silencio largo.', `«Al menos no nos mientes a la cara», dice alguien. No te abrazan, pero tampoco te echan. En ${H.name} te tratarán como a quien eres: el de ${O.name} que decidió quedarse.`], notes: gain(w, 'diplomacia', 0.8) };
  }
  // Negarlo: con labia, el rumor se enfría; si no te creen, empeora.
  const ok = new Rng(w.seed ^ Math.imul(w.day, 0x2545f491) ^ 0x5ec4e7).next() < chanceOf(id, 'persuasion', 1.5);
  const notes = gain(w, 'persuasion', 1);
  if (ok) {
    for (const f of town) f.trust = clamp(f.trust + 0.04);
    story(w, `Negó ser el heredero de ${O.name}, y en ${H.name} casi todos le creyeron.`, 'decision');
    return { lines: ['Te ríes, cuentas que el colgante lo compraste en un mercado y cambias de tema con soltura.', 'Al día siguiente ya casi nadie habla de ello. Casi.'], notes };
  }
  for (const f of town) {
    f.trust = clamp(f.trust - 0.06);
    f.memories.push({ day: w.day, kind: 'mentira', weight: -0.25, gen });
  }
  story(w, `Negó ser el heredero de ${O.name}, pero en ${H.name} nadie le creyó.`, 'decision');
  return { lines: ['Lo niegas, pero la voz te tiembla y el colgante te delata.', '«Encima, mentiroso», murmura alguien. La noticia corre más deprisa que tú.'], notes };
}
