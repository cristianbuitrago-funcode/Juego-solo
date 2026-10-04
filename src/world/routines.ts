import type { WorldState } from '../core/types';
import { hourOf, weatherOf } from './clock';
import { doorOf, getLayout, type Village } from './layout';
import type { Folk } from './types';

/**
 * Rutinas diarias. Dada una hora, cada vecino tiene un lugar al que ir y una
 * actividad. Lo que ocurre en su región cambia su rutina: con hambre los
 * campos se abandonan y se hacen colas ante el almacén; sin comercio, los
 * comerciantes desaparecen; con tensión, los guardias vigilan las afueras.
 */
export interface RoutineTarget {
  x: number;
  y: number;
  inside: boolean; // dentro de un edificio (no se dibuja)
  activity: string; // lo que hace, en palabras
}

function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const keyDoor = (v: Village, kind: string) => {
  const b = v.keys.find((k) => k.kind === kind);
  return b ? doorOf(b) : { x: v.cx, y: v.cy + v.plazaR };
};

function plazaSpot(v: Village, f: Folk, salt: number) {
  // Alrededor de la fuente, nunca dentro de ella.
  const a = hash(f.id, salt) * Math.PI * 2;
  const d = 2.6 + hash(f.id, salt + 7) * (v.plazaR - 3.2);
  return { x: v.cx + 0.5 + Math.cos(a) * d, y: v.cy + 0.5 + Math.sin(a) * d };
}

export function routineOf(w: WorldState, f: Folk, clock: number): RoutineTarget {
  const l = getLayout(w);
  const v = l.villages[f.regionId];
  const r = w.regions[f.regionId];
  const h = hourOf(clock);
  const houses = v.houses.length ? v.houses : v.keys;
  const home = doorOf(houses[Math.min(f.house, houses.length - 1)] ?? v.keys[0]);
  const bucket = Math.floor(clock / 25);
  const atHome = (activity = 'descansa en casa'): RoutineTarget => ({ ...home, inside: true, activity });
  const at = (p: { x: number; y: number }, activity: string): RoutineTarget => shelter({ x: p.x, y: p.y, inside: false, activity });
  const hungry = !!r.flags.hambre;
  const war = !!r.flags.guerra;
  const night = h < 6 || h >= 21.5;
  // Con lluvia o tormenta la gente busca refugio: el ocio al aire libre se suspende.
  const weather = weatherOf(w, w.day);
  const wet = weather === 'lluvia' || weather === 'tormenta';
  const shelter = (t: RoutineTarget): RoutineTarget => (wet && !t.inside && /plaza|juega|sol|charla|vaga|pasea|explora/.test(t.activity) ? atHome('se refugia de la lluvia') : t);

  if (f.role === 'guardia') {
    // Patrulla: un círculo alrededor del pueblo; con tensión, más amplio.
    const radius = (v.wallR || 12) * (r.militancy > 0.55 || war ? 1.05 : 0.7);
    const t = clock / (war ? 40 : 70) + hash(f.id) * 6.28;
    if (night && hash(f.id, 3) < 0.5 && !war) return atHome('duerme');
    return at({ x: v.cx + 0.5 + Math.cos(t) * radius, y: v.cy + 0.5 + Math.sin(t) * radius }, war ? 'vigila nervioso las afueras' : r.militancy > 0.55 ? 'patrulla con la mano en la espada' : 'hace su ronda');
  }
  if (night) return atHome('duerme');

  switch (f.role) {
    case 'campesino':
    case 'pastor':
    case 'pescador': {
      if (h >= 12 && h < 14) return h < 12.5 || h > 13.5 ? at(home, 'vuelve a comer') : atHome('come en casa');
      if (h >= 18) return at(plazaSpot(v, f, bucket), 'charla en la plaza');
      if (h < 7) return at(home, 'se prepara para el día');
      if (hungry && f.role === 'campesino') {
        if (h < 12) {
          const door = keyDoor(v, 'almacen');
          const pos = Math.floor(hash(f.id) * 6);
          return at({ x: door.x - 2 + pos * 0.9, y: door.y + 1.2 + (pos % 2) * 0.8 }, 'hace cola ante el almacén');
        }
        return at(plazaSpot(v, f, bucket), 'vaga sin nada que cosechar');
      }
      const fields = v.fields.length ? v.fields : [{ x: v.cx + 8, y: v.cy + 8, w: 4, h: 4 }];
      const field = fields[Math.floor(hash(f.id, 11) * fields.length)];
      const fx = field.x + hash(f.id, bucket) * field.w;
      const fy = field.y + hash(f.id, bucket + 3) * field.h;
      if (f.role === 'pastor') return at({ x: fx + field.w + 3, y: fy + 2 }, 'cuida del rebaño');
      return at({ x: fx, y: fy }, f.role === 'pescador' ? 'remienda redes junto al agua' : 'trabaja el campo');
    }
    case 'comerciante': {
      const gone = r.flags.sinComercio && hash(f.id, w.day) < 0.6;
      if (gone) return atHome('no ha abierto su puesto');
      if (h >= 8 && h < 18) {
        if (h >= 15 && h < 16) return at(keyDoor(v, 'posada'), 'cierra tratos en la posada');
        const s = v.stalls[Math.floor(hash(f.id, 5) * v.stalls.length)] ?? { x: v.cx, y: v.cy };
        return at({ x: s.x, y: s.y + 1.1 }, hungry ? 'atiende un puesto casi vacío' : 'atiende su puesto');
      }
      if (h >= 18 && h < 20) return at(keyDoor(v, 'posada'), 'bebe en la posada');
      return atHome('cuenta sus ganancias');
    }
    case 'nino':
      if (h >= 8 && h < 19.5) return at(plazaSpot(v, f, bucket), hungry ? 'pide pan a los mayores' : 'juega por el pueblo');
      return atHome('duerme');
    case 'anciano':
      if (h >= 9 && h < 12) {
        // Los mayores se sientan en los bancos de la plaza.
        const benches = v.props.filter((p) => p.kind === 'banco');
        const b = benches[Math.floor(hash(f.id, 11) * benches.length)];
        return at(b ? { x: b.x + (hash(f.id, 12) - 0.5) * 0.9, y: b.y + 0.05 } : plazaSpot(v, f, 1), 'toma el sol en la plaza');
      }
      if (h >= 15 && h < 19) return at(keyDoor(v, v.keys.some((k) => k.kind === 'templo') ? 'templo' : 'posada'), 'reza y recuerda');
      return atHome('descansa');
    case 'lider':
      if (h >= 8 && h < 18) return at(keyDoor(v, 'salon'), war ? 'discute la guerra a las puertas del salón' : 'recibe a la gente ante el salón');
      if (h >= 18 && h < 20) return at(plazaSpot(v, f, 2), 'pasea por la plaza');
      return { ...keyDoor(v, 'salon'), inside: true, activity: 'trabaja en el salón' };
    case 'sanadora':
      if (h >= 8 && h < 19) return at(keyDoor(v, v.keys.some((k) => k.kind === 'templo') ? 'templo' : 'posada'), r.flags.fiebre ? 'atiende a enfermos' : 'prepara remedios');
      return atHome();
    case 'exploradora':
      if (h >= 7 && h < 18) {
        const a = hash(f.id, Math.floor(clock / 120)) * Math.PI * 2;
        const d = 18 + hash(f.id, 9) * 10;
        return at({ x: v.cx + Math.cos(a) * d, y: v.cy + Math.sin(a) * d }, 'explora los alrededores');
      }
      return at(keyDoor(v, 'posada'), 'cuenta historias en la posada');
    case 'artesano':
    default:
      if (h >= 8 && h < 18) return at(keyDoor(v, v.keys.some((k) => k.kind === 'forja') ? 'forja' : 'almacen'), r.militancy > 0.55 ? 'forja armas sin descanso' : 'trabaja en el taller');
      if (h >= 18 && h < 20.5) return at(keyDoor(v, 'posada'), 'descansa en la posada');
      return atHome();
  }
}
