import type { WorldState } from '../core/types';
import { playerEco } from './business';
import { orgsOf, repOf } from './orgs';
import { polOf, type LegacyRec } from './polstate';

/**
 * Preparación de la Fase 5 (envejecimiento, muerte, herederos). Aún no hay
 * sistema generacional nuevo: solo se reúne en un sitio lo que una vida deja
 * y lo que heredaría quien venga después, para que la Fase 5 lo use sin
 * tener que buscarlo por todo el mundo.
 *
 * - Propiedad: dinero, carga, vehículo, negocios, casa.
 * - Reputación: lo que cada grupo y cada pueblo piensa de la familia (se
 *   hereda a medias: los hijos cargan con el nombre, para bien y para mal).
 * - Conocimiento: secretos confirmados, cuaderno de precios, hipótesis.
 * - Historia: leyes, tratados, grupos fundados, guerras, derrotas y
 *   traiciones; siguen en el mundo aunque su autor muera.
 */
export interface Inheritance {
  property: { coins: number; cargo: Record<string, number>; vehicle: string; businesses: string[]; housed: boolean };
  reputation: { orgs: { id: string; name: string; rep: number }[]; regions: Record<number, number> };
  knowledge: { secrets: string[]; priceNotes: number[]; forecasts: number };
  history: LegacyRec[];
}

export function inheritance(w: WorldState): Inheritance {
  const life = w.life!;
  const id = life.identity!;
  const pe = playerEco(w);
  const pol = polOf(w);
  return {
    property: { coins: id.needs.coins, cargo: { ...pe.cargo } as Record<string, number>, vehicle: pe.vehicle, businesses: pe.businesses.map((b) => b.id), housed: id.housed },
    reputation: {
      orgs: orgsOf(w).filter((o) => Math.abs(repOf(w, o)) > 0.1).map((o) => ({ id: o.id, name: o.name, rep: Math.round(repOf(w, o) * 50) / 100 })),
      regions: Object.fromEntries(Object.entries(id.score).map(([r, s]) => [Number(r), Math.round(s * 0.5)])),
    },
    knowledge: { secrets: pol.secrets.filter((s) => s.known).map((s) => s.id), priceNotes: Object.keys(pe.notes).map(Number), forecasts: pol.forecasts.filter((f) => f.result === 'acierto').length },
    history: pol.legacy.slice(),
  };
}

/** Lo que el mundo recuerda del linaje (para la crónica y, más adelante, para los herederos). */
export function legacyLines(w: WorldState): string[] {
  return polOf(w).legacy.slice(-12).map((l) => `${l.by}: ${l.text}`);
}
