import type { WorldState } from '../core/types';
import type { Folk } from '../world/types';
import type { Action, Expr } from './human';

/**
 * Del estado del mundo a la cara y el cuerpo. La expresión de cada vecino
 * sale de lo que siente por el jugador (confianza, miedo, gratitud,
 * resentimiento), de lo que ha vivido hace poco (sus recuerdos) y de lo que
 * pasa en su región (hambre, guerra, fiebre). No hay estados nuevos: solo se
 * lee lo que la simulación ya guarda.
 */
export function moodOf(w: WorldState, f: Folk): Expr {
  const r = w.regions[f.regionId];
  // Lo reciente pesa más que el carácter: un regalo de ayer se ve en la cara.
  const recent = f.memories.filter((m) => w.day - m.day <= 2).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))[0];
  if (recent) {
    if (recent.weight >= 0.3) return recent.kind === 'comida' || recent.kind === 'salvado' || recent.kind === 'refugio' ? 'alivio' : 'feliz';
    if (recent.weight <= -0.3) return recent.kind === 'fuerza' ? 'miedo' : 'enfadado';
  }
  if (f.resentment > 0.6) return 'hostil';
  if (f.fear > 0.6) return 'miedo';
  if (r.flags.guerra) return f.role === 'guardia' ? 'enfadado' : f.age > 55 || f.role === 'nino' ? 'triste' : 'miedo';
  if (r.flags.hambre) return f.role === 'nino' ? 'triste' : 'preocupado';
  if (r.flags.fiebre) return 'triste';
  if (r.flags.emigrando) return 'preocupado';
  if (f.resentment > 0.4) return 'desconfianza';
  if (f.gratitude > 0.5 || f.trust > 0.68) return 'feliz';
  if (f.lastMet >= 0 && f.trust < 0.25) return 'desconfianza';
  if (r.militancy > 0.6) return 'preocupado';
  return f.honesty > 0.7 && r.food > 12 ? 'feliz' : 'neutral';
}

/** Lo que hace el cuerpo según la actividad de la rutina (en palabras). */
export function actionOf(activity: string): Action {
  if (/forja|martill/.test(activity)) return 'hammer';
  if (/campo|siembra|cosecha|taller|remedios/.test(activity)) return 'work';
  if (/redes|pesca/.test(activity)) return 'fish';
  if (/cola|cuenta sus|vacío|no ha abierto/.test(activity)) return 'cross';
  if (/charla|discute|historias|tratos|recibe|pide pan/.test(activity)) return 'talk';
  if (/puesto/.test(activity)) return 'point';
  if (/vigila|ronda|patrulla|vaga/.test(activity)) return 'look';
  if (/sol|banco/.test(activity)) return 'sit';
  if (/reza|bebe/.test(activity)) return 'listen';
  return 'idle';
}
