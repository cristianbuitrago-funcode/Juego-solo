import type { Appearance, Item } from '../../render/appearance';
import { alpha, blob, cyl, ell, lit, mix, shd, smoothPath, vgrad } from '../paint';
import type { Body } from './body';
import type { Facing } from './types';

/**
 * Ropa y cuerpo. Cada prenda dice algo: el lino remangado del campo, el
 * jubón con botones del comerciante, el acolchado del guardia, la túnica
 * larga y bordada de quien gobierna, los remiendos de quien no tiene. Las
 * telas tienen pliegues, luz y sombra; la riqueza se ve en el color, los
 * ribetes y las joyas; el clima, en capas y pieles.
 */

const wetten = (c: string, wet?: boolean) => (wet ? shd(c, 0.22) : c);

/** Tela con volumen: luz a la izquierda, sombra a la derecha, oscurece hacia abajo. */
function cloth(g: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, c: string): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, lit(c, 0.16));
  gr.addColorStop(0.35, c);
  gr.addColorStop(1, shd(c, 0.32));
  return gr;
}

function folds(g: CanvasRenderingContext2D, c: string, lines: number[][], w: number): void {
  g.strokeStyle = alpha(shd(c, 0.45), 0.4);
  g.lineWidth = w;
  for (const l of lines) {
    g.beginPath();
    g.moveTo(l[0], l[1]);
    g.quadraticCurveTo(l[2], l[3], l[4], l[5]);
    g.stroke();
  }
}

/** Estampado recortado a la forma actual (que ya está en el trazado del contexto). */
function pattern(g: CanvasRenderingContext2D, ap: Appearance, x0: number, y0: number, x1: number, y1: number, base: string): void {
  const p = ap.outfit.pattern;
  const u = (x1 - x0) / 12;
  g.save();
  g.clip();
  if (p === 'rayas') {
    g.fillStyle = alpha(ap.outfit.trim, 0.55);
    for (let y = y0; y < y1; y += u * 1.6) g.fillRect(x0, y, x1 - x0, u * 0.6);
  } else if (p === 'cuadros') {
    g.fillStyle = alpha(shd(base, 0.35), 0.35);
    for (let y = y0; y < y1; y += u * 2.2) g.fillRect(x0, y, x1 - x0, u * 0.7);
    for (let x = x0; x < x1; x += u * 2.2) g.fillRect(x, y0, u * 0.7, y1 - y0);
  } else if (p === 'acolchado') {
    g.strokeStyle = alpha(shd(base, 0.4), 0.55);
    g.lineWidth = u * 0.18;
    for (let k = -12; k < 12; k++) {
      g.beginPath();
      g.moveTo(x0 + k * u * 1.6, y0);
      g.lineTo(x0 + k * u * 1.6 + (y1 - y0), y1);
      g.moveTo(x1 - k * u * 1.6, y0);
      g.lineTo(x1 - k * u * 1.6 - (y1 - y0), y1);
      g.stroke();
    }
  } else if (p === 'hojas') {
    g.fillStyle = alpha(ap.outfit.trim, 0.6);
    for (let y = y0 + u; y < y1; y += u * 2.4)
      for (let x = x0 + ((y / u) % 2) * u; x < x1; x += u * 2.4) ell(g, x, y, u * 0.55, u * 0.3, alpha(ap.outfit.trim, 0.55), 0.6);
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Torso (con cuello), en coordenadas de la cadera: (0,0) = centro de la cadera
// ---------------------------------------------------------------------------
export function paintTorso(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, wet?: boolean): void {
  const o = ap.outfit;
  const T = B.torso;
  const S = B.shoulder;
  const Wa = B.waist;
  const Hp = B.hip;
  const top = wetten(o.armor ? o.armor.tabard : o.topColor, wet);
  const skin = ap.skin;
  const side = facing === 'side';
  const back = facing === 'back';
  const k = side ? 0.7 : 1; // de perfil, algo de pecho y espalda: no una lámina
  // Cuello.
  const nw = B.headW * (B.child ? 0.5 : ap.fem ? 0.4 : 0.47);
  ell(g, side ? S * 0.05 : 0, -T - B.neck * 0.6, nw * (side ? 0.85 : 1), B.neck * 1.3, cyl(g, -nw, nw, skin));
  ell(g, side ? S * 0.05 : 0, -T - B.neck * 0.1, nw * 1.05, B.neck * 0.55, alpha(shd(skin, 0.4), 0.55));
  // Silueta del torso: hombros redondeados, cintura, cadera.
  const chest = ap.fem && !B.child && !B.teen ? 0.35 : 0;
  const pts = side
    ? [-S * 0.5, -T + 0.3, S * 0.25, -T - 0.1, S * 0.62 + chest * 0.5, -T * 0.72, S * 0.55, -T * 0.4, Wa * 0.55, -T * 0.28, Hp * 0.62, 0, Hp * 0.6, 0.9, -Hp * 0.62, 0.9, -Hp * 0.65, 0, -Wa * 0.62, -T * 0.32, -S * 0.62, -T * 0.7]
    : [-S, -T + 0.6, -S * 0.75, -T - 0.15, 0, -T - 0.35, S * 0.75, -T - 0.15, S, -T + 0.6, S * 0.92, -T * 0.6, Wa, -T * 0.32, Hp, -0.2, Hp * 1.02, 0.9, -Hp * 1.02, 0.9, -Hp, -0.2, -Wa, -T * 0.32, -S * 0.92, -T * 0.6];
  g.fillStyle = cloth(g, -S * k, S * k, -T, 1, top);
  g.beginPath();
  smoothPath(g, pts, true, 0.42);
  g.fill();
  g.beginPath();
  smoothPath(g, pts, true, 0.42);
  pattern(g, ap, -S * 1.2, -T - 1, S * 1.2, 1, top);
  // Acolchado / cota de malla del guardia.
  if (o.top === 'acolchado' || o.armor) {
    g.save();
    g.beginPath();
    smoothPath(g, pts, true, 0.42);
    g.clip();
    if (o.armor?.mail) {
      g.fillStyle = vgrad(g, -T, 0, [[0, '#c4c9ce'], [1, '#7a8088']]);
      g.fillRect(-S * 1.2, -T - 1, S * 2.4, T * 0.35);
      g.strokeStyle = 'rgba(60,64,70,0.45)';
      g.lineWidth = 0.12;
      for (let y = -T; y < -T * 0.65; y += 0.35)
        for (let x = -S; x < S; x += 0.35) {
          g.beginPath();
          g.arc(x + ((y * 3) % 2) * 0.17, y, 0.14, 0, Math.PI);
          g.stroke();
        }
    }
    if (o.armor) {
      // Sobreveste con el emblema del pueblo.
      const tb = o.armor.tabard;
      blob(g, side ? [-S * 0.45, -T * 0.68, S * 0.5, -T * 0.68, Hp * 0.6, 1.5, -Hp * 0.6, 1.5] : [-S * 0.68, -T * 0.66, S * 0.68, -T * 0.66, Hp * 0.85, 1.6, -Hp * 0.85, 1.6], cloth(g, -S, S, -T, 1, wetten(tb, wet)), 0.15);
      if (!side && !back) {
        blob(g, [0, -T * 0.55, S * 0.32, -T * 0.42, S * 0.25, -T * 0.18, 0, -T * 0.05, -S * 0.25, -T * 0.18, -S * 0.32, -T * 0.42], o.armor.emblem, 0.3);
        ell(g, 0, -T * 0.32, S * 0.1, S * 0.1, shd(tb, 0.2));
      }
    }
    g.restore();
  }
  // Pliegues según la prenda.
  folds(g, top, side ? [[S * 0.2, -T * 0.6, S * 0.35, -T * 0.4, S * 0.25, -T * 0.15]] : [[-S * 0.5, -T * 0.75, -S * 0.3, -T * 0.5, -Wa * 0.6, -T * 0.25], [S * 0.55, -T * 0.7, S * 0.35, -T * 0.45, Wa * 0.6, -T * 0.2]], T * 0.035);
  if (!back && !side) {
    // Cuello de la prenda y botones.
    const col = o.top === 'jubon' || o.top === 'abrigo' || o.top === 'tunicaLarga';
    g.strokeStyle = o.top === 'tunicaLarga' || o.pattern === 'bordado' ? o.trim : shd(top, 0.45);
    g.lineWidth = T * 0.07;
    g.beginPath();
    if (o.top === 'camisa') {
      g.moveTo(-nw * 1.6, -T - 0.1);
      g.lineTo(0, -T * 0.72);
      g.lineTo(nw * 1.6, -T - 0.1);
    } else {
      g.moveTo(-nw * 1.5, -T - 0.15);
      g.quadraticCurveTo(0, -T * (col ? 0.86 : 0.9), nw * 1.5, -T - 0.15);
    }
    g.stroke();
    if (o.top === 'camisa') ell(g, 0, -T * 0.86, nw * 0.6, T * 0.08, alpha(skin, 0.95));
    if (o.top === 'jubon' || o.top === 'abrigo') {
      for (let i = 0; i < 4; i++) ell(g, o.top === 'abrigo' ? S * 0.1 : 0, -T * (0.78 - i * 0.18), T * 0.035, T * 0.035, o.trim);
      if (o.top === 'abrigo') {
        // Solapas.
        blob(g, [-nw * 1.4, -T - 0.1, -S * 0.15, -T * 0.55, -S * 0.35, -T * 0.82], shd(top, 0.18), 0.2);
        blob(g, [nw * 1.4, -T - 0.1, S * 0.3, -T * 0.55, S * 0.4, -T * 0.82], shd(top, 0.28), 0.2);
      }
    }
    if (o.pattern === 'bordado' || o.top === 'tunicaLarga') {
      g.strokeStyle = alpha(o.trim, 0.9);
      g.lineWidth = T * 0.05;
      g.setLineDash([T * 0.06, T * 0.05]);
      g.beginPath();
      g.moveTo(-nw * 1.7, -T * 0.95);
      g.quadraticCurveTo(0, -T * 0.78, nw * 1.7, -T * 0.95);
      g.stroke();
      g.setLineDash([]);
    }
  }
  // Chaleco.
  if (o.vest && !back) {
    const v = wetten(o.vest, wet);
    const pts2 = side ? [-S * 0.45, -T + 0.4, S * 0.35, -T + 0.2, S * 0.5, -T * 0.4, Hp * 0.55, -0.4, -Hp * 0.55, -0.4, -S * 0.5, -T * 0.6] : [-S * 0.85, -T + 0.5, -nw * 1.2, -T * 0.95, -S * 0.15, -T * 0.25, -Wa * 0.9, -0.3, -S * 0.9, -T * 0.6];
    blob(g, pts2, cloth(g, -S, S, -T, 0, v), 0.3);
    if (!side) blob(g, pts2.map((n, i) => (i % 2 ? n : -n)), cloth(g, -S, S, -T, 0, shd(v, 0.08)), 0.3);
  }
  // Mochila (correas por delante; el fardo, por detrás).
  if (o.backpack && !back) {
    g.strokeStyle = shd(o.backpack, 0.2);
    g.lineWidth = T * 0.09;
    g.beginPath();
    if (side) {
      g.moveTo(-S * 0.1, -T);
      g.lineTo(-S * 0.25, -T * 0.25);
    } else {
      g.moveTo(-S * 0.62, -T + 0.2);
      g.lineTo(-S * 0.55, -T * 0.3);
      g.moveTo(S * 0.62, -T + 0.2);
      g.lineTo(S * 0.55, -T * 0.3);
    }
    g.stroke();
  }
  if (back && o.backpack) {
    blob(g, [-S * 0.7, -T * 0.92, S * 0.7, -T * 0.92, S * 0.75, -T * 0.25, -S * 0.75, -T * 0.25], cloth(g, -S, S, -T, -T * 0.2, o.backpack), 0.25);
    ell(g, 0, -T * 0.55, S * 0.4, T * 0.12, shd(o.backpack, 0.2));
  }
  // Delantal.
  if (o.apron && !back) {
    const a = wetten(o.apron, wet);
    blob(g, side ? [S * 0.3, -T * 0.6, S * 0.55, -T * 0.55, Hp * 0.75, B.thigh * 0.7, Hp * 0.25, B.thigh * 0.75] : [-S * 0.55, -T * 0.7, S * 0.55, -T * 0.7, Hp * 0.85, B.thigh * 0.85, -Hp * 0.85, B.thigh * 0.85], cloth(g, -S, S, -T, B.thigh, a), 0.2);
    g.strokeStyle = shd(a, 0.3);
    g.lineWidth = T * 0.04;
    g.beginPath();
    g.moveTo(-nw * 1.3, -T - 0.1);
    g.lineTo(-S * 0.5, -T * 0.7);
    g.moveTo(nw * 1.3, -T - 0.1);
    g.lineTo(S * 0.5, -T * 0.7);
    g.stroke();
  }
  // Remiendos (pobreza visible).
  if (o.patches && !side) {
    g.fillStyle = `rgb(${mix(top, '#8a7a5a', 0.5).map(Math.round).join(',')})`;
    g.fillRect(-S * 0.55, -T * 0.55, S * 0.38, T * 0.2);
    g.strokeStyle = alpha('#2a2018', 0.5);
    g.lineWidth = T * 0.02;
    g.setLineDash([T * 0.03, T * 0.03]);
    g.strokeRect(-S * 0.55, -T * 0.55, S * 0.38, T * 0.2);
    g.setLineDash([]);
  }
  // Cinturón, fajín, bolsa y bandolera.
  const belt = wetten(o.belt, wet);
  const by = -T * 0.24;
  if (o.sash) {
    blob(g, side ? [-Wa * 0.65, by - T * 0.06, Wa * 0.62, by - T * 0.08, Wa * 0.62, by + T * 0.1, -Wa * 0.66, by + T * 0.1] : [-Wa * 1.08, by - T * 0.08, Wa * 1.08, by - T * 0.08, Wa * 1.1, by + T * 0.1, -Wa * 1.1, by + T * 0.1], cloth(g, -Wa, Wa, by, by + 1, o.sash), 0.2);
    if (!side && !back) blob(g, [Wa * 0.6, by, Wa * 0.95, by + T * 0.3, Wa * 0.7, by + T * 0.35], o.sash, 0.4);
  } else {
    g.fillStyle = belt;
    g.fillRect(side ? -Wa * 0.66 : -Wa * 1.08, by - T * 0.04, side ? Wa * 1.3 : Wa * 2.16, T * 0.1);
    if (!back) {
      g.strokeStyle = '#c8a860';
      g.lineWidth = T * 0.025;
      g.strokeRect(side ? Wa * 0.3 : -T * 0.05, by - T * 0.035, T * 0.1, T * 0.08);
    }
  }
  if (o.strap && !back) {
    g.strokeStyle = shd(o.strap, 0.1);
    g.lineWidth = T * 0.07;
    g.beginPath();
    g.moveTo(side ? -S * 0.2 : -S * 0.75, -T + 0.2);
    g.lineTo(side ? S * 0.35 : Wa * 0.85, by + T * 0.05);
    g.stroke();
  }
  if (o.pouch && !back) blob(g, side ? [Wa * 0.2, by + T * 0.05, Wa * 0.65, by + T * 0.05, Wa * 0.6, by + T * 0.28, Wa * 0.25, by + T * 0.3] : [Wa * 0.55, by + T * 0.05, Wa * 1.0, by + T * 0.05, Wa * 0.95, by + T * 0.3, Wa * 0.6, by + T * 0.32], cloth(g, Wa * 0.5, Wa, by, by + T * 0.3, o.pouch), 0.3);
  // Joyas: collar o cadena de cargo.
  if (o.jewelry && !back && !side) {
    g.strokeStyle = o.jewelry;
    g.lineWidth = T * 0.035;
    g.beginPath();
    g.moveTo(-nw * 1.3, -T - 0.05);
    g.quadraticCurveTo(0, -T * (ap.important ? 0.6 : 0.78), nw * 1.3, -T - 0.05);
    g.stroke();
    ell(g, 0, -T * (ap.important ? 0.62 : 0.79), T * 0.06, T * 0.07, ap.important ? '#c84a3a' : lit(o.jewelry, 0.2));
  }
  // Chal sobre los hombros (ancianas, frío).
  if (o.shawl && !side) {
    const s = wetten(o.shawl, wet);
    blob(g, [-S * 1.05, -T + 0.4, -S * 0.5, -T - 0.4, S * 0.5, -T - 0.4, S * 1.05, -T + 0.4, S * 0.7, -T * 0.55, 0, back ? -T * 0.45 : -T * 0.5, -S * 0.7, -T * 0.55], cloth(g, -S, S, -T, -T * 0.4, s), 0.4);
  }
}

/** Falda, túnica o faldón de abrigo: cuelga de la cadera y se mueve al andar. */
export function skirtLen(ap: Appearance, B: Body): number {
  const o = ap.outfit;
  if (o.bottom === 'falda' || o.top === 'tunicaLarga' || o.top === 'abrigo') return Math.max(0.25, o.hem) * B.leg;
  if (o.top === 'tunica') return B.thigh * 0.55;
  if (o.armor) return B.thigh * 0.5;
  return 0;
}

export function paintSkirt(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, wet?: boolean): void {
  const o = ap.outfit;
  const L = skirtLen(ap, B);
  if (!L) return;
  const c = wetten(o.bottom === 'falda' && o.top !== 'tunicaLarga' && o.top !== 'abrigo' ? o.bottomColor : o.armor ? o.armor.tabard : o.topColor, wet);
  const Hp = B.hip;
  const side = facing === 'side';
  const flare = 1 + Math.min(1, L / B.leg) * 0.55;
  const w0 = side ? Hp * 0.62 : Hp * 1.02;
  const w1 = w0 * flare;
  const pts = [-w0, -0.4, w0, -0.4, w1, L * 0.92, w1 * 0.6, L, 0, L * 0.98, -w1 * 0.6, L, -w1, L * 0.92];
  blob(g, pts, cloth(g, -w1, w1, 0, L, c), 0.3);
  folds(g, c, [[-w0 * 0.3, 0.5, -w1 * 0.35, L * 0.5, -w1 * 0.4, L * 0.95], [w0 * 0.35, 0.5, w1 * 0.4, L * 0.5, w1 * 0.45, L * 0.95], [0, 1, 0, L * 0.5, 0, L * 0.97]], B.torso * 0.04);
  // Ribete del bajo.
  if (o.pattern === 'bordado' || o.top === 'tunicaLarga') {
    g.strokeStyle = o.trim;
    g.lineWidth = B.torso * 0.07;
    g.beginPath();
    g.moveTo(-w1, L * 0.9);
    g.quadraticCurveTo(0, L * 1.03, w1, L * 0.9);
    g.stroke();
  } else {
    g.strokeStyle = alpha(shd(c, 0.45), 0.6);
    g.lineWidth = B.torso * 0.03;
    g.beginPath();
    g.moveTo(-w1, L * 0.92);
    g.quadraticCurveTo(0, L * 1.02, w1, L * 0.92);
    g.stroke();
  }
  if (o.top === 'abrigo' && facing === 'front') {
    g.strokeStyle = alpha(shd(c, 0.5), 0.7);
    g.lineWidth = B.torso * 0.04;
    g.beginPath();
    g.moveTo(B.shoulder * 0.1, 0);
    g.lineTo(B.shoulder * 0.15, L);
    g.stroke();
  }
}

// ---------------------------------------------------------------------------
// Extremidades (cada segmento cuelga de su articulación en 0,0 hacia abajo)
// ---------------------------------------------------------------------------
function capsule(g: CanvasRenderingContext2D, w0: number, w1: number, len: number, fill: string, wet?: boolean): void {
  const c = wetten(fill, wet);
  g.fillStyle = cyl(g, -w0, w0, c);
  g.beginPath();
  smoothPath(g, [-w0 * 0.5, 0, 0, -w0 * 0.42, w0 * 0.5, 0, w1 * 0.5, len, 0, len + w1 * 0.4, -w1 * 0.5, len], true, 0.55);
  g.fill();
}

export function paintUpperArm(g: CanvasRenderingContext2D, ap: Appearance, B: Body, wet?: boolean): void {
  const o = ap.outfit;
  const len = B.upperArm;
  const w = B.armW;
  const sleeve = o.armor?.mail ? '#9aa0a8' : o.top === 'acolchado' && o.armor ? o.armor.tabard : o.topColor;
  if (o.sleeves === 'cortas') {
    capsule(g, w * 0.95, w * 0.85, len, ap.skin);
    capsule(g, w * 1.05, w * 1.0, len * 0.45, sleeve, wet);
  } else capsule(g, w * 1.05, w * 0.95, len, sleeve, wet);
  folds(g, sleeve, [[-w * 0.2, len * 0.3, w * 0.1, len * 0.5, -w * 0.1, len * 0.75]], w * 0.12);
}

export function paintForeArm(g: CanvasRenderingContext2D, ap: Appearance, B: Body, fist: boolean, wet?: boolean): void {
  const o = ap.outfit;
  const len = B.foreArm;
  const w = B.armW * 0.88;
  const bare = o.sleeves !== 'largas';
  const sleeve = o.armor?.mail ? '#9aa0a8' : o.topColor;
  const handLen = len * 0.3;
  const armLen = len - handLen * 0.6;
  if (bare) {
    capsule(g, w * 0.95, w * 0.75, armLen, ap.skin);
    if (o.sleeves === 'remangadas') ell(g, 0, w * 0.1, w * 0.62, w * 0.42, cyl(g, -w, w, wetten(sleeve, wet)));
  } else {
    capsule(g, w, w * 0.88, armLen, sleeve, wet);
    // Puño de la manga.
    ell(g, 0, armLen * 0.97, w * 0.52, w * 0.22, o.pattern === 'bordado' ? o.trim : shd(sleeve, 0.2));
  }
  // Mano: palma, pulgar y dedos (o puño cerrado).
  const hc = o.gloves ?? ap.skin;
  const hy = armLen + handLen * 0.35;
  if (fist) {
    ell(g, 0, hy + handLen * 0.15, w * 0.62, handLen * 0.55, cyl(g, -w * 0.6, w * 0.6, hc));
    g.strokeStyle = alpha(shd(hc, 0.4), 0.6);
    g.lineWidth = w * 0.08;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(i * w * 0.2, hy + handLen * 0.1);
      g.lineTo(i * w * 0.2, hy + handLen * 0.5);
      g.stroke();
    }
  } else {
    blob(g, [-w * 0.5, hy - handLen * 0.3, w * 0.5, hy - handLen * 0.3, w * 0.55, hy + handLen * 0.35, w * 0.3, hy + handLen * 0.85, -w * 0.25, hy + handLen * 0.9, -w * 0.55, hy + handLen * 0.4], cyl(g, -w * 0.6, w * 0.6, hc), 0.5);
    ell(g, -w * 0.55, hy, w * 0.2, handLen * 0.3, shd(hc, 0.08), 0.4);
    g.strokeStyle = alpha(shd(hc, 0.4), 0.5);
    g.lineWidth = w * 0.06;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(i * w * 0.18, hy + handLen * 0.35);
      g.lineTo(i * w * 0.16, hy + handLen * 0.8);
      g.stroke();
    }
  }
}

export function paintThigh(g: CanvasRenderingContext2D, ap: Appearance, B: Body, wet?: boolean): void {
  const o = ap.outfit;
  const c = o.bottom === 'falda' ? shd(o.bottomColor, 0.15) : o.bottomColor;
  capsule(g, B.thighW * 1.05, B.thighW * 0.82, B.thigh, c, wet);
  if (o.patches && o.bottom !== 'falda') {
    g.fillStyle = `rgb(${mix(c, '#9a8a6a', 0.5).map(Math.round).join(',')})`;
    g.fillRect(-B.thighW * 0.35, B.thigh * 0.55, B.thighW * 0.6, B.thigh * 0.25);
  }
}

export function paintShin(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, wet?: boolean): void {
  const o = ap.outfit;
  const len = B.shin;
  const w = B.shinW;
  const pants = o.bottom === 'falda' ? shd(o.bottomColor, 0.15) : o.bottomColor;
  const shoe = o.shoes;
  const leather = wetten(o.shoeColor, wet);
  const footLen = w * 1.45;
  const side = facing === 'side';
  // Pierna (pantalón o piel).
  if (shoe === 'descalzo' || shoe === 'sandalias') {
    capsule(g, w * 0.95, w * 0.7, len * 0.7, pants, wet);
    capsule(g, w * 0.7, w * 0.6, len * 0.95, ap.skin);
    capsule(g, w * 0.95, w * 0.78, len * 0.68, pants, wet);
  } else capsule(g, w * 0.95, w * 0.78, len * 0.92, pants, wet);
  // Calzado.
  const bootTop = shoe === 'botas' || shoe === 'botasPiel' ? len * 0.48 : len * 0.86;
  const footCol = shoe === 'descalzo' || shoe === 'sandalias' ? ap.skin : leather;
  if (shoe === 'botas' || shoe === 'botasPiel') {
    g.save();
    g.translate(0, bootTop);
    capsule(g, w * 0.92, w * 0.88, len - bootTop, leather);
    g.restore();
    if (shoe === 'botasPiel') ell(g, 0, bootTop, w * 0.7, w * 0.35, '#d8cfc0');
    else ell(g, 0, bootTop + w * 0.05, w * 0.55, w * 0.15, lit(leather, 0.15));
  }
  // Pie.
  const fy = len;
  if (side) blob(g, [-w * 0.45, fy - w * 0.55, w * 0.25, fy - w * 0.5, footLen, fy - w * 0.1, footLen * 1.02, fy + w * 0.28, -w * 0.5, fy + w * 0.3], cyl(g, -w, footLen, footCol), 0.35);
  else ell(g, 0, fy + w * 0.05, w * 0.6, w * 0.42, cyl(g, -w * 0.6, w * 0.6, footCol));
  if (shoe === 'sandalias') {
    g.strokeStyle = leather;
    g.lineWidth = w * 0.15;
    g.beginPath();
    g.moveTo(-w * 0.5, fy - w * 0.25);
    g.lineTo(side ? footLen * 0.7 : w * 0.5, fy - w * 0.1);
    g.stroke();
  }
  // Suela.
  g.strokeStyle = shd(footCol, 0.5);
  g.lineWidth = w * 0.14;
  g.beginPath();
  g.moveTo(side ? -w * 0.5 : -w * 0.55, fy + w * 0.33);
  g.lineTo(side ? footLen : w * 0.55, fy + w * 0.33);
  g.stroke();
}

// ---------------------------------------------------------------------------
// Capa (detrás) y cuello de piel
// ---------------------------------------------------------------------------
export function paintCape(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, wet?: boolean): void {
  const cl = ap.outfit.cloak;
  if (!cl) return;
  const c = wetten(cl.color, wet);
  const T = B.torso;
  const S = B.shoulder;
  const L = T + B.leg * 0.62;
  const side = facing === 'side';
  const pts = side ? [-S * 0.3, -T - 0.2, S * 0.1, -T, -S * 0.2, L * 0.45 - T, -S * 0.9, L - T, -S * 1.5, L - T - 0.5, -S * 0.85, -T * 0.4] : [-S * 1.05, -T + 0.2, S * 1.05, -T + 0.2, S * 1.35, L - T, S * 0.4, L - T + 0.4, -S * 0.4, L - T + 0.4, -S * 1.35, L - T];
  blob(g, pts, cloth(g, -S * 1.3, S * 1.3, -T, L - T, facing === 'back' ? c : shd(c, 0.18)), 0.35);
  folds(g, c, side ? [[-S * 0.4, -T * 0.5, -S * 0.7, L * 0.4 - T, -S * 1.1, L - T]] : [[-S * 0.6, -T * 0.6, -S * 0.75, L * 0.3 - T, -S * 0.9, L - T], [S * 0.6, -T * 0.6, S * 0.75, L * 0.3 - T, S * 0.9, L - T], [0, -T * 0.5, 0, L * 0.4 - T, 0, L - T]], T * 0.05);
  if (cl.fur) for (let i = 0; i < 8; i++) ell(g, (side ? -S * 0.5 : -S * 1.0) + i * (side ? S * 0.12 : S * 0.29), -T + 0.3, S * 0.2, S * 0.16, i % 2 ? '#d8cfc0' : '#bfb5a4');
}

/** Lo que va sobre los hombros por delante: el broche y el cuello de piel de la capa. */
export function paintCapeFront(g: CanvasRenderingContext2D, ap: Appearance, B: Body, facing: Facing, wet?: boolean): void {
  const cl = ap.outfit.cloak;
  if (!cl || facing === 'back') return;
  const T = B.torso;
  const S = B.shoulder;
  const c = wetten(cl.color, wet);
  if (facing === 'side') {
    blob(g, [-S * 0.55, -T - 0.3, S * 0.3, -T - 0.1, S * 0.2, -T * 0.7, -S * 0.6, -T * 0.6], cloth(g, -S, S, -T, -T * 0.6, c), 0.4);
    return;
  }
  for (const sx of [-1, 1]) blob(g, [sx * S * 0.3, -T - 0.3, sx * S * 1.1, -T + 0.3, sx * S * 1.05, -T * 0.55, sx * S * 0.75, -T * 0.68], cloth(g, -S, S, -T, -T * 0.5, c), 0.4);
  if (cl.fur) for (let i = 0; i < 9; i++) ell(g, -S * 1.0 + i * S * 0.25, -T + 0.1 + Math.abs(i - 4) * 0.1, S * 0.2, S * 0.16, i % 2 ? '#e2dacb' : '#c4baa8');
  ell(g, 0, -T * 0.88, T * 0.08, T * 0.08, cl.clasp);
  ell(g, -T * 0.02, -T * 0.9, T * 0.03, T * 0.03, 'rgba(255,255,255,0.7)');
}

// ---------------------------------------------------------------------------
// Objetos en la mano (el agarre en 0,0; «hacia delante» = +x, hacia abajo = +y)
// ---------------------------------------------------------------------------
const WOOD = '#8a6440';
export function paintItem(g: CanvasRenderingContext2D, item: Exclude<Item, undefined> | 'paraguas' | 'espada', B: Body): void {
  const s = B.H / 31;
  const stick = (x0: number, y0: number, x1: number, y1: number, w: number, c = WOOD) => {
    g.strokeStyle = shd(c, 0.25);
    g.lineWidth = w * s * 1.3;
    g.beginPath();
    g.moveTo(x0 * s, y0 * s);
    g.lineTo(x1 * s, y1 * s);
    g.stroke();
    g.strokeStyle = c;
    g.lineWidth = w * s;
    g.stroke();
    g.strokeStyle = lit(c, 0.25);
    g.lineWidth = w * s * 0.35;
    g.beginPath();
    g.moveTo(x0 * s - w * 0.15 * s, y0 * s);
    g.lineTo(x1 * s - w * 0.15 * s, y1 * s);
    g.stroke();
  };
  switch (item) {
    case 'azada':
      stick(0, -7, 0, 9, 0.7);
      blob(g, [-0.4 * s, 8.5 * s, 2.6 * s, 8.2 * s, 3.2 * s, 10.5 * s, -0.2 * s, 10 * s], vgrad(g, 8 * s, 10.5 * s, [[0, '#c8ccd0'], [1, '#6a7078']]), 0.2);
      break;
    case 'martillo':
      stick(0, -1, 0, 5, 0.65);
      g.fillStyle = vgrad(g, 4.2 * s, 6.4 * s, [[0, '#b8bec4'], [1, '#5a6068']]);
      g.fillRect(-1.6 * s, 4.4 * s, 3.2 * s, 1.8 * s);
      break;
    case 'cana':
      stick(0, 2, 13, -9, 0.4, '#a8864a');
      g.strokeStyle = 'rgba(230,230,230,0.6)';
      g.lineWidth = 0.12 * s;
      g.beginPath();
      g.moveTo(13 * s, -9 * s);
      g.quadraticCurveTo(15 * s, 0, 14 * s, 9 * s);
      g.stroke();
      break;
    case 'cayado':
      stick(0, -12, 0, 10, 0.75);
      g.strokeStyle = WOOD;
      g.lineWidth = 0.75 * s;
      g.beginPath();
      g.arc(1.3 * s, -12 * s, 1.3 * s, Math.PI, Math.PI * 2.1);
      g.stroke();
      break;
    case 'baston':
      stick(0, -1, 0.5, 9, 0.7);
      ell(g, 0, -1 * s, 0.7 * s, 0.5 * s, shd(WOOD, 0.2));
      break;
    case 'lanza':
      stick(0, -16, 0, 9, 0.65);
      blob(g, [0, -20 * s, 0.9 * s, -16.5 * s, 0, -15.5 * s, -0.9 * s, -16.5 * s], vgrad(g, -20 * s, -15 * s, [[0, '#f0f2f4'], [1, '#7a8088']]), 0.1);
      break;
    case 'espada':
      stick(0, -1, 0, 1.5, 0.6, '#5a3a22');
      g.fillStyle = '#c8a860';
      g.fillRect(-1.6 * s, 1.3 * s, 3.2 * s, 0.5 * s);
      blob(g, [-0.45 * s, 1.8 * s, 0.45 * s, 1.8 * s, 0.35 * s, 11 * s, 0, 12 * s, -0.35 * s, 11 * s], vgrad(g, 0, 12 * s, [[0, '#f2f4f6'], [1, '#8a9098']]), 0.1);
      break;
    case 'cesta': {
      const gr = vgrad(g, 1 * s, 5 * s, [[0, '#d8b070'], [1, '#8a6436']]);
      blob(g, [-2.4 * s, 1.5 * s, 2.4 * s, 1.5 * s, 2 * s, 5 * s, -2 * s, 5 * s], gr, 0.25);
      g.strokeStyle = '#8a6436';
      g.lineWidth = 0.35 * s;
      g.beginPath();
      g.arc(0, 1.5 * s, 2 * s, Math.PI, 0);
      g.stroke();
      ell(g, -0.8 * s, 1.5 * s, 0.8 * s, 0.5 * s, '#c84a3a');
      ell(g, 0.8 * s, 1.4 * s, 0.7 * s, 0.5 * s, '#6aa24f');
      break;
    }
    case 'saco':
      blob(g, [-0.5 * s, 0.5 * s, 2.8 * s, 1 * s, 3.4 * s, 5.5 * s, 1.2 * s, 6.8 * s, -1.6 * s, 5.8 * s], vgrad(g, 0, 7 * s, [[0, '#d8c8a0'], [1, '#8a7650']]), 0.45);
      break;
    case 'arco':
      g.strokeStyle = WOOD;
      g.lineWidth = 0.6 * s;
      g.beginPath();
      g.arc(-4 * s, 0, 8 * s, -0.95, 0.95);
      g.stroke();
      g.strokeStyle = 'rgba(240,235,220,0.8)';
      g.lineWidth = 0.12 * s;
      g.beginPath();
      g.moveTo(-4 * s + Math.cos(-0.95) * 8 * s, Math.sin(-0.95) * 8 * s);
      g.lineTo(-4 * s + Math.cos(0.95) * 8 * s, Math.sin(0.95) * 8 * s);
      g.stroke();
      break;
    case 'farol': {
      g.strokeStyle = '#3a3030';
      g.lineWidth = 0.3 * s;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, 1.2 * s);
      g.stroke();
      g.fillStyle = '#4a3a30';
      g.fillRect(-1.1 * s, 1.2 * s, 2.2 * s, 0.5 * s);
      const gr = g.createRadialGradient(0, 2.9 * s, 0.1 * s, 0, 2.9 * s, 1.4 * s);
      gr.addColorStop(0, '#fff6c8');
      gr.addColorStop(0.5, '#ffc860');
      gr.addColorStop(1, '#c87830');
      g.fillStyle = gr;
      g.fillRect(-0.95 * s, 1.7 * s, 1.9 * s, 2.4 * s);
      g.fillStyle = '#4a3a30';
      g.fillRect(-1.1 * s, 4.1 * s, 2.2 * s, 0.45 * s);
      break;
    }
    case 'libro':
      g.fillStyle = vgrad(g, 0, 3 * s, [[0, '#8a3a2a'], [1, '#5a2418']]);
      g.fillRect(-0.4 * s, -0.5 * s, 2.6 * s, 3.2 * s);
      g.fillStyle = '#efe6d2';
      g.fillRect(1.9 * s, -0.3 * s, 0.35 * s, 2.8 * s);
      break;
    case 'red':
      g.strokeStyle = 'rgba(200,190,160,0.85)';
      g.lineWidth = 0.15 * s;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo((i - 2) * 1.2 * s, 4 * s, (i - 2) * 1.6 * s, 7 * s);
        g.stroke();
      }
      for (let j = 1; j < 4; j++) {
        g.beginPath();
        g.moveTo(-j * 0.8 * s, j * 1.8 * s);
        g.quadraticCurveTo(0, j * 2 * s, j * 0.8 * s, j * 1.8 * s);
        g.stroke();
      }
      break;
    case 'paraguas': {
      stick(0, -13, 0, 1, 0.4, '#4a3020');
      const gr = vgrad(g, -19 * s, -13 * s, [[0, '#4a6a7a'], [1, '#22343e']]);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-8 * s, -12.5 * s);
      g.quadraticCurveTo(-7 * s, -19 * s, 0, -19.5 * s);
      g.quadraticCurveTo(7 * s, -19 * s, 8 * s, -12.5 * s);
      for (let i = 3; i >= -3; i--) g.quadraticCurveTo((i + 0.5) * 2.3 * s, -13.6 * s, i * 2.3 * s + (i > -3 ? 0 : -1.1 * s), -12.5 * s);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 0.15 * s;
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.moveTo(0, -19.3 * s);
        g.lineTo(i * 2.3 * s, -12.7 * s);
        g.stroke();
      }
      break;
    }
  }
}
