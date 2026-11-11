import { audio } from '../audio/audio';
import { syllableAt, voiceFor, VOICE_PRESETS, type VoiceProfile } from '../audio/voice';
import type { WorldState } from '../core/types';
import { ensureLife } from '../world/life';
import type { Settings } from './settings';

/**
 * Quien habla en un diálogo: su voz y el estado de su boca. El retrato (y la
 * figura del mundo) leen `talking` y `mouthUntil` para mover la boca al ritmo
 * de las sílabas que suenan.
 */
export interface Speaker {
  voice: VoiceProfile;
  talking: boolean;
  /** La boca está abierta hasta este instante (performance.now()). */
  mouthUntil: number;
  /** Un gesto de reacción al empezar (sorpresa, alivio…), hasta `reactUntil`. */
  onTalk?: (talking: boolean) => void;
}

export function speakerOf(voice: VoiceProfile, onTalk?: (talking: boolean) => void): Speaker {
  return { voice, talking: false, mouthUntil: 0, onTalk };
}

/** La voz del protagonista (para cuando es él quien dice la frase elegida). */
export function playerVoice(w: WorldState): VoiceProfile {
  const p = ensureLife(w).player;
  const look = p.look as { fem?: boolean } | undefined;
  return voiceFor({ id: `@jugador:${p.generation}`, age: p.age, fem: !!look?.fem, name: p.name });
}

const CPS: Record<Settings['textSpeed'], number> = { pausada: 26, normal: 42, rapida: 80, instantanea: Infinity };

export interface SpeechHandle {
  /** Termina de escribir de golpe. */
  skip(): void;
  /** Se corta (se cerró el diálogo). */
  stop(): void;
  done: boolean;
}

interface Line {
  el: HTMLElement;
  text: string;
  spoken: boolean;
  on: HTMLElement;
  off: HTMLElement;
}

/**
 * Escribe los párrafos de un diálogo letra a letra. Lo que alguien dice
 * («entre comillas») suena con su voz y le mueve la boca; lo que se narra se
 * escribe más deprisa y en silencio. Las opciones aparecen al terminar.
 * Tocar el cuadro lo completa todo de golpe.
 */
export function typeDialogue(box: HTMLElement, ps: HTMLElement[], choices: HTMLElement | null, speaker: Speaker | null, speed: Settings['textSpeed'], reduce: boolean): SpeechHandle {
  const handle: SpeechHandle = { skip: () => {}, stop: () => {}, done: false };
  const cps = CPS[speed] ?? 42;
  const finish = () => {
    handle.done = true;
    if (speaker) (speaker.talking = false), speaker.onTalk?.(false);
    box.classList.remove('typing');
    if (!choices) return;
    const waited = choices.classList.contains('pending');
    choices.classList.remove('pending');
    choices.classList.add('ready');
    // Las opciones despliegan el cuadro hacia arriba en vez de aparecer de golpe.
    if (waited && !reduce && choices.animate) {
      const hgt = choices.scrollHeight;
      choices.style.overflow = 'hidden';
      choices.animate([{ height: '0px', marginTop: '0px' }, { height: `${hgt}px`, marginTop: getComputedStyle(choices).marginTop }], { duration: Math.min(360, 160 + hgt * 0.5), easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }).onfinish = () => (choices.style.overflow = '');
    }
  };
  if (!ps.length || cps === Infinity || reduce) {
    finish();
    return handle;
  }
  const lines: Line[] = ps.map((el) => {
    const text = el.textContent ?? '';
    const on = document.createElement('span');
    const off = document.createElement('span');
    off.className = 'tw-off';
    off.textContent = text;
    el.replaceChildren(on, off);
    return { el, text, spoken: /^[«—]/.test(text), on, off };
  });
  choices?.classList.add('pending');
  box.classList.add('typing');
  box.classList.toggle('voiced', !!speaker);
  const fallback: VoiceProfile = VOICE_PRESETS.narrador;
  let li = 0;
  let ci = 0;
  let wait = 180; // el cuadro termina de entrar antes de la primera letra
  let budget = 0;
  let last = performance.now();
  let lastBlip = 0;
  let raf = 0;
  let stopped = false;
  const reveal = (l: Line, n: number) => {
    l.on.textContent = l.text.slice(0, n);
    l.off.textContent = l.text.slice(n);
  };
  const setTalking = (v: boolean) => {
    if (!speaker || speaker.talking === v) return;
    speaker.talking = v;
    speaker.onTalk?.(v);
  };
  handle.stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    setTalking(false);
  };
  handle.skip = () => {
    if (handle.done) return;
    handle.stop();
    for (const l of lines) reveal(l, l.text.length);
    finish();
  };
  const frame = (now: number) => {
    if (stopped) return;
    if (!box.isConnected) return handle.stop();
    const dt = Math.min(80, now - last);
    last = now;
    if (wait > 0) {
      wait -= dt;
      if (wait > 0 || li >= lines.length) return void (raf = requestAnimationFrame(frame));
    }
    const l = lines[li];
    if (!l) return finish();
    setTalking(l.spoken);
    const voice = speaker?.voice ?? fallback;
    // Lo narrado va más deprisa; cada voz tiene su ritmo.
    budget += (dt / 1000) * (l.spoken ? cps * voice.speed : cps * 1.7);
    let n = 0;
    while (budget >= 1 && ci < l.text.length) {
      budget -= 1;
      const ch = l.text[ci];
      ci++;
      n++;
      if (l.spoken) {
        const syl = syllableAt(l.text, ci - 1);
        // Una sílaba cada ~70 ms como mucho: a más velocidad se saltan, no se amontonan.
        if (syl && now - lastBlip > 68) {
          lastBlip = now;
          audio.syllable(voice, syl, speaker ? 1 : 0.7);
          if (speaker) speaker.mouthUntil = now + 85;
        }
      }
      // Las pausas de quien habla: comas, puntos, puntos suspensivos.
      const next = l.text[ci];
      if (',;:'.includes(ch)) wait = l.spoken ? 110 : 50;
      else if ('.!?…'.includes(ch) && !(next && '.!?…»'.includes(next))) wait = l.spoken ? 250 : 110;
      else if (ch === '»' && next) wait = 120;
      if (wait > 0) {
        budget = 0;
        break;
      }
    }
    if (n) {
      reveal(l, ci);
      // El texto que entra queda a la vista aunque el cuadro tenga que desplazarse.
      if (l.el.offsetTop + l.el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = l.el.offsetTop + l.el.offsetHeight - box.clientHeight + 8;
    }
    if (ci >= l.text.length) {
      li++;
      ci = 0;
      budget = 0;
      wait = Math.max(wait, li < lines.length ? 200 : 120);
      if (wait > 150) setTalking(false);
      if (li >= lines.length) {
        setTalking(false);
        window.setTimeout(() => !stopped && finish(), 120);
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return handle;
}

/** El protagonista dice la frase que has elegido: unas sílabas con su voz. */
export function sayChoice(w: WorldState, label: string): void {
  const m = /«([^»]+)»/.exec(label);
  if (!m) return;
  const voice = playerVoice(w);
  const text = m[1];
  let k = 0;
  for (let i = 0; i < text.length && k < 7; i++) {
    const syl = syllableAt(text, i);
    if (!syl) continue;
    window.setTimeout(() => audio.syllable(voice, syl, 0.8), k * 74);
    k++;
  }
}
