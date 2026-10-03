import { registerEffect } from '../effects';
import type { Choice, Petition, RegionId } from '../types';
import { leaderOf, nextId, rootOf, routesOf, type Ctx } from '../world';
import { regionRemembers } from './characters';

/**
 * Peticiones y dilemas: los personajes acuden a ti con problemas. Algunas
 * peticiones son exageradas (el mundo aprendió que das sin comprobar).
 * Si no respondes antes de que caduquen, también es una respuesta.
 */
const MAX_OPEN = 4;

function open(ctx: Ctx, regionId: RegionId, kind: string): boolean {
  return ctx.w.petitions.some((p) => p.regionId === regionId && p.kind === kind);
}

function add(ctx: Ctx, p: Omit<Petition, 'id' | 'day' | 'expires'> & { ttl?: number }): Petition | undefined {
  const { w } = ctx;
  if (w.petitions.length >= MAX_OPEN) return undefined;
  const pet: Petition = { id: nextId(w, 'q'), day: w.day, expires: w.day + (p.ttl ?? 3), ...p };
  w.petitions.push(pet);
  if (pet.characterId) {
    const c = w.characters.find((x) => x.id === pet.characterId);
    if (c) c.known = true;
  }
  return pet;
}

const ignore: Choice = { label: 'No intervenir', action: 'ignorar', params: {} };

export function tickPetitions(ctx: Ctx): void {
  const { w, rng } = ctx;
  // Caducadas: el silencio también se recuerda.
  for (const p of w.petitions.filter((x) => x.expires < w.day)) expire(ctx, p);
  w.petitions = w.petitions.filter((x) => x.expires >= w.day);

  for (const r of w.regions) {
    if (r.isHome || r.abandoned) continue;
    const leader = leaderOf(w, r.id);
    if (!leader) continue;
    const who = `${leader.name}, líder de ${r.name}`;
    // Hambre real.
    if (r.flags.hambre && r.attitude.trust > 0.22 && !open(ctx, r.id, 'alimento') && rng.chance(0.5)) {
      add(ctx, {
        regionId: r.id, characterId: leader.id, kind: 'alimento', genuine: true, causeId: r.flags.hambre.causeId,
        title: `${r.name} pide alimento`,
        text: `${who}: «Nuestros graneros se vacían. Si nos ayudas, no lo olvidaremos.»`,
        choices: [
          { label: 'Enviar provisiones', action: 'ayuda', params: { region: r.id }, hint: 'Alivio inmediato. Puede crear dependencia.' },
          { label: 'Observar primero', action: 'observar', params: { region: r.id }, hint: 'Comprobar si es cierto antes de dar.' },
          { label: 'Negar la ayuda', action: 'negar', params: { region: r.id } },
        ],
      });
    }
    // Petición exagerada: el mundo aprendió que ayudas sin comprobar.
    if ((w.player.patterns.ayuda ?? 0) >= 3 && !r.flags.hambre && r.food > 6 && leader.emotions.ambition > 0.45 && !open(ctx, r.id, 'alimento') && rng.chance(0.06)) {
      add(ctx, {
        regionId: r.id, characterId: leader.id, kind: 'alimento', genuine: false,
        title: `${r.name} pide alimento`,
        text: `${who}: «Nuestros graneros se vacían. Si nos ayudas, no lo olvidaremos.»`,
        choices: [
          { label: 'Enviar provisiones', action: 'ayuda', params: { region: r.id }, hint: 'Alivio inmediato. Puede crear dependencia.' },
          { label: 'Observar primero', action: 'observar', params: { region: r.id }, hint: 'Comprobar si es cierto antes de dar.' },
          { label: 'Negar la ayuda', action: 'negar', params: { region: r.id } },
        ],
      });
    }
    // Amenaza percibida.
    for (const [idStr, rel] of Object.entries(r.relations)) {
      const enemy = w.regions[Number(idStr)];
      if (enemy.isHome || rel.tension < 0.6 || r.attitude.trust < 0.35 || open(ctx, r.id, 'amenaza') || !rng.chance(0.25)) continue;
      const choices: Choice[] = [
        { label: `Mediar con ${enemy.name}`, action: 'mediar', params: { region: r.id, other: enemy.id }, hint: 'Requiere un emisario y algo de confianza de ambos.' },
        { label: `Presionar a ${enemy.name}`, action: 'presion', params: { region: enemy.id }, hint: 'Funciona si dependen de ti; si no, genera rencor.' },
        { label: 'Investigar qué ocurre', action: 'observar', params: { region: enemy.id } },
      ];
      if (rel.war) choices.splice(2, 0, { label: 'Intervenir con tu guardia', action: 'intervenir', params: { region: enemy.id }, hint: 'Último recurso. El mundo lo recordará.' });
      add(ctx, {
        regionId: r.id, characterId: leader.id, kind: 'amenaza', genuine: true, causeId: rel.tensionCause,
        title: rel.war ? `${r.name} pide ayuda en la guerra` : `${r.name} teme a ${enemy.name}`,
        text: rel.war ? `${who}: «${enemy.name} nos desangra. ¿Vas a quedarte mirando?»` : `${who}: «${enemy.name} se arma contra nosotros. Lo sé. Ayúdanos antes de que sea tarde.»`,
        choices: [...choices, ignore],
      });
      break;
    }
    // Ruta cerrada por el jugador que asfixia a una región.
    if (r.flags.sinComercio && !open(ctx, r.id, 'ruta') && rng.chance(0.3)) {
      const closed = routesOf(w, r.id).find((x) => x.status === 'cerrada' && rootOf(w, x.closedCause)?.byPlayer);
      if (closed) {
        add(ctx, {
          regionId: r.id, characterId: leader.id, kind: 'ruta', genuine: true, causeId: r.flags.sinComercio.causeId,
          title: `${r.name} pide reabrir un camino`,
          text: `${who}: «Desde que cerraste el camino, nuestros mercados están muertos. Ábrelo.»`,
          choices: [
            { label: 'Reabrir la ruta', action: 'abrirRuta', params: { route: closed.id } },
            { label: 'Mantenerla cerrada', action: 'ignorar', params: {} },
          ],
        });
      }
    }
    // Disputa tecnológica reciente.
    const disp = r.flags.disputa;
    if (disp && w.day - disp.since <= 1 && !open(ctx, r.id, 'disputa')) {
      const other = w.regions[Number(disp.data?.with)];
      add(ctx, {
        regionId: r.id, characterId: leader.id, kind: 'disputa', genuine: true, causeId: disp.causeId,
        title: 'Disputa tecnológica',
        text: `${who}: «${other.name} nos ha robado lo que inventamos. Exijo que intervengas.»`,
        choices: [
          { label: 'Mediar en la disputa', action: 'mediar', params: { region: r.id, other: other.id } },
          { label: 'Difundir el invento a todos', action: 'compartirTecnologia', params: { region: r.id, tech: String(disp.data?.tech) }, hint: 'El mundo gana; el inventor se enfadará.' },
          ignore,
        ],
      });
    }
    // Refugiados que miran hacia tu hogar.
    if (r.flags.emigrando && r.neighbors.includes(w.player.home) && !w.player.laws.hospitalidad && !r.flags.pidioRefugio) {
      r.flags.pidioRefugio = { since: w.day };
      add(ctx, {
        regionId: r.id, characterId: leader.id, kind: 'refugio', genuine: true, causeId: r.flags.emigrando.causeId,
        title: `Familias de ${r.name} piden refugio`,
        text: `${who}: «Mi gente huye. ¿Les abrirás tus puertas?»`,
        choices: [
          { label: 'Acogerlos (ley de hospitalidad)', action: 'ley', params: { law: 'hospitalidad', value: 1 }, hint: 'Gastarás provisiones; ganarás gratitud.' },
          { label: 'Cerrar las puertas', action: 'negar', params: { region: r.id } },
        ],
      });
    }
  }

  // El rival se presenta.
  const rivalId = w.counters.rival;
  if (rivalId !== undefined && w.day >= 4 && !w.counters.rivalMet && rng.chance(0.3)) {
    const rival = w.regions[rivalId];
    const leader = leaderOf(w, rivalId);
    if (leader) {
      w.counters.rivalMet = w.day;
      add(ctx, {
        regionId: rivalId, characterId: leader.id, kind: 'rival', genuine: true, ttl: 4,
        title: `Un mensajero de ${rival.name}`,
        text: `${leader.name}, líder de ${rival.name}: «Sabemos quién eres y lo que hacen los de tu clase. No esperes nada de nosotros.»`,
        choices: [
          { label: 'Enviar un regalo', action: 'regalo', params: { region: rivalId }, hint: 'Un gesto pequeño. Quizás no baste.' },
          { label: 'Enviar un observador', action: 'observar', params: { region: rivalId } },
          { label: 'No responder', action: 'ignorar', params: {} },
        ],
      });
    }
  }
}

function expire(ctx: Ctx, p: Petition): void {
  if (p.kind === 'alimento' || p.kind === 'amenaza' || p.kind === 'refugio') {
    regionRemembers(ctx, p.regionId, 'negada', -0.35, p.causeId);
  }
}

registerEffect('peticionMediacion', (ctx, s) => {
  const a = Number(s.data.a);
  const b = Number(s.data.b);
  const { w } = ctx;
  const leader = leaderOf(w, a);
  add(ctx, {
    regionId: a, characterId: leader?.id, kind: 'mediacion', genuine: true, ttl: 2, causeId: w.regions[a].relations[b]?.tensionCause,
    title: `${w.regions[a].name} y ${w.regions[b].name} al borde de la guerra`,
    text: `${leader?.name ?? 'Un mensajero'}: «Sabemos que sueles mediar. Antes de que corra la sangre con ${w.regions[b].name}, te escucharemos.»`,
    choices: [
      { label: 'Mediar ahora', action: 'mediar', params: { region: a, other: b }, hint: 'Tu reputación de mediador ayuda.' },
      ignore,
    ],
  });
});
