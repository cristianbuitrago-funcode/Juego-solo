import type { WorldState } from '../core/types';
import { ensureLife } from '../world/life';
import { TILE, type Folk, type FolkRole } from '../world/types';
import { appearanceOf, playerAppearance, type Appearance } from './appearance';
import { actionOf, moodOf } from './mood';
import type { Ent } from './scene';
import * as S from './sprites';
import { bodyOf } from '../visual/figure/body';
import type { Action, Expr, Facing, Pose } from '../visual/figure/types';
import { VQ } from '../visual/quality';

/**
 * Aspecto y postura de las personas: nivel de detalle por distancia, ropa según
 * el tiempo, aspecto de vecinos, figurantes y jugador (en caché), y la postura de
 * cada uno según lo que hace, con quién habla y si el jugador pasa cerca.
 */
export interface PoseHost {
  w: WorldState;
  cam: { x: number; y: number; z: number };
  apCache: Map<string, { key: string; ap: Appearance }>;
  dressed: WeakMap<Appearance, Record<string, Appearance>>;
  playerLook: unknown;
  playerLookKey: string;
  converseId: string | null;
  ents: Map<string, Ent>;
  facing: { x: number; y: number };
  playerAnim: number;
  playerMoving: boolean;
  playerRun: boolean;
  weatherHere(): string;
}

export function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Nivel de detalle por distancia al jugador (y por zoom). */
export function lodAt(s: PoseHost, x: number, y: number): 0 | 1 | 2 {
  const me = ensureLife(s.w).player;
  const d = Math.hypot(x - me.x, y - me.y) * (s.cam.z < 0.85 ? 1.6 : 1);
  const q = VQ();
  return d < q.lodNear ? 0 : d < q.lodMid ? 1 : 2;
}

/**
 * Ropa según el tiempo: con nieve, capa de abrigo con piel; con lluvia,
 * capa encerada con capucha. Solo para quien no lleva ya una.
 */
export function dress(s: PoseHost, ap: Appearance, wet: boolean, cold: boolean): Appearance {
  if ((!wet && !cold) || ap.age < 6) return ap;
  const key = `${wet}:${cold}`;
  let c = s.dressed.get(ap);
  if (!c) s.dressed.set(ap, (c = {}));
  if (c[key]) return c[key];
  const o = ap.outfit;
  const cloak = o.cloak ? { ...o.cloak, fur: o.cloak.fur || cold, hood: true } : { color: cold ? S.shade(o.topColor, 0.72) : '#5d5446', fur: cold, hood: true, clasp: '#8a7a5a' };
  const out: Appearance = { ...ap, outfit: { ...o, cloak, hat: wet && o.hat === 'paja' ? undefined : o.hat } };
  c[key] = out;
  return out;
}

export function apOf(s: PoseHost, f: Folk): Appearance {
  const key = `${f.age < 16 ? 0 : f.age >= 58 ? 2 : 1}:${f.role}:${f.charId ?? ''}`;
  const c = s.apCache.get(f.id);
  if (c && c.key === key) return c.ap;
  const ap = appearanceOf(s.w, f);
  s.apCache.set(f.id, { key, ap });
  return ap;
}

/** Aspecto de figurantes (soldados, refugiados, mensajeros, gentío). */
export function extraAp(s: PoseHost, id: string, regionId: number, role: FolkRole, age: number, mod?: (ap: Appearance) => void): Appearance {
  const key = `${regionId}:${role}`;
  const c = s.apCache.get(id);
  if (c && c.key === key) return c.ap;
  if (s.apCache.size > 1600) {
    // Se olvidan los más antiguos poco a poco (no todos de golpe: eso repintaría a todo el mundo).
    let n = 200;
    for (const k of s.apCache.keys()) {
      if (k === '@player' || n-- <= 0) continue;
      s.apCache.delete(k);
    }
  }
  const f: Folk = { id, name: id, regionId, role, age, born: 0, house: 0, alive: true, trust: 0.5, fear: 0, gratitude: 0, resentment: 0, honesty: 0.5, memories: [], lastMet: -1 };
  const ap = appearanceOf(s.w, f);
  mod?.(ap);
  s.apCache.set(id, { key, ap });
  return ap;
}

export function playerAp(s: PoseHost, lantern: boolean): Appearance {
  const p = ensureLife(s.w).player;
  if (s.playerLook !== p.look) (s.playerLook = p.look), (s.playerLookKey = JSON.stringify(p.look ?? ''));
  const key = `${p.name}:${p.generation}:${p.age >= 58 ? 1 : 0}:${lantern}:${s.playerLookKey}`;
  const c = s.apCache.get('@player');
  if (c && c.key === key) return c.ap;
  const ap = playerAppearance(p);
  if (lantern) ap.outfit.item = 'farol';
  s.apCache.set('@player', { key, ap });
  return ap;
}

export function entPose(s: PoseHost, id: string, e: Ent, f: Folk | undefined, sec: number, wet: boolean, cold: boolean): Pose {
  const now = performance.now();
  const react = e.react && e.react.until > now ? e.react : undefined;
  let facing = e.facing;
  let action: Action;
  if (e.moving) {
    facing = Math.abs(e.dy) > Math.abs(e.dx) * 1.3 ? (e.dy > 0 ? 'front' : 'back') : 'side';
    action = 'walk';
  } else if (id === s.converseId) {
    action = Math.floor(sec / 1.8) % 3 === 2 ? 'nod' : 'talk';
  } else if (react?.action) action = react.action;
  else {
    action = actionOf(e.act);
    if (e.partner) {
      // Dos que charlan: uno habla y gesticula, el otro escucha y asiente.
      const turn = Math.floor(sec / 2.8 + (id < e.partner ? 0 : 1)) % 2 === 0;
      // (cruzarse de brazos, no señalar: el brazo estirado le apuntaba a la cara al otro)
      action = turn ? (Math.floor(sec / 2.8) % 4 === 1 ? 'cross' : 'talk') : Math.floor(sec / 0.9) % 5 === 0 ? 'nod' : 'listen';
    } else if (action === 'talk') action = 'idle';
    else if (action === 'idle' && Math.floor(sec / 4 + hash(id) * 9) % 6 === 0) action = 'look';
  }
  // Quien está quieto se fija en el jugador cuando pasa cerca: se gira hacia él,
  // saluda con la cabeza de vez en cuando y le mira según lo que piensa de él.
  let noticed: Expr | undefined;
  let flip = e.flip;
  if (!e.moving && !e.partner && id !== s.converseId && !react && (action === 'idle' || action === 'look' || action === 'sit')) {
    const me = ensureLife(s.w).player;
    const dx = me.x - e.x;
    const dy = me.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 3.2) {
      if (action !== 'sit') facing = Math.abs(dx) > Math.abs(dy) * 0.8 ? 'side' : dy > 0 ? 'front' : 'back';
      flip = dx < 0;
      if (action !== 'sit' && Math.floor(sec / 2.6 + hash(id) * 5) % 4 === 0) action = 'nod';
      noticed = !f ? 'neutral' : f.resentment > 0.4 ? 'desconfianza' : f.fear > 0.5 ? 'miedo' : f.trust > 0.62 || f.gratitude > 0.4 ? 'feliz' : f.trust < 0.35 ? 'desconfianza' : 'confiado';
    }
  }
  // Con lluvia, los que no pueden refugiarse se cubren con los brazos.
  if (wet && !e.moving && (action === 'idle' || action === 'look')) action = 'cross';
  const expr: Expr = react?.expr ?? noticed ?? (f ? moodOf(s.w, f) : hash(id, 8) < 0.3 ? 'feliz' : 'neutral');
  // Con lluvia: quien puede, saca un paraguas encerado; los demás, la capucha.
  const umbrella = wet && (action === 'walk' || action === 'idle' || action === 'look' || action === 'talk' || action === 'listen') && (f?.role === 'comerciante' || f?.role === 'lider' || hash(id, 11) < 0.22);
  return { facing, flip, phase: e.anim, action, t: sec + hash(id) * 20, expr, lod: lodAt(s, e.x, e.y), hood: (wet && !umbrella) || (cold && hash(id, 31) < 0.6), heavy: cold, umbrella, wet };
}

export function playerPose(s: PoseHost, sec: number, wet: boolean, cold: boolean): Pose {
  const conv = s.converseId ? s.ents.get(s.converseId) : undefined;
  const me = ensureLife(s.w).player;
  let fx = s.facing.x;
  let fy = s.facing.y;
  if (conv && !s.playerMoving) (fx = conv.x - me.x), (fy = conv.y - me.y);
  const side = Math.abs(fx) > 0.45 || Math.abs(fx) > Math.abs(fy) * 0.8;
  const facing: Facing = side ? 'side' : fy < 0 ? 'back' : 'front';
  const action: Action = s.playerMoving ? (s.playerRun ? 'run' : 'walk') : conv ? 'listen' : 'idle';
  return { facing, flip: fx < 0, phase: s.playerAnim, action, t: sec, expr: 'neutral', lod: 0, hood: wet || cold, heavy: cold, wet };
}

/** Postura de quien camina por un camino (soldados, refugiados, arrieros). */
export function marchPose(s: PoseHost, dx: number, dy: number, t: number, expr: Expr, px: number, py: number, ap: Appearance): Pose {
  const facing: Facing = Math.abs(dy) > Math.abs(dx) * 1.3 ? (dy > 0 ? 'front' : 'back') : 'side';
  const weather = s.weatherHere();
  // La fase sale de la posición en el camino: el paso va al ritmo del avance.
  const along = Math.abs(dx) >= Math.abs(dy) ? px : py;
  const phase = (along / (strideOf(ap, false) * TILE)) * Math.PI;
  return { facing, flip: dx < 0, phase, action: 'walk', t, expr, lod: lodAt(s, px / TILE, py / TILE), hood: weather === 'lluvia' || weather === 'tormenta', heavy: weather === 'nieve' };
}

export function strideOf(ap: Appearance | undefined, run: boolean): number {
  const leg = ap ? bodyOf(ap).leg : 14.4;
  return (2 * leg * Math.sin(run ? 0.78 : 0.52)) / TILE;
}
