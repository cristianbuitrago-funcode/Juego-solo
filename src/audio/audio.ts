import type { Mood } from '../core/types';

/**
 * Música ambiental generativa con Web Audio (sin archivos de sonido).
 * Cada estado del mundo tiene su escala, su tempo y su timbre:
 *  calma → pentatónica mayor lenta; tensión → menor con pulso grave;
 *  crisis → dron disonante; descubrimiento → destello brillante.
 */
const SCALES: Record<Mood, number[]> = {
  calma: [0, 2, 4, 7, 9, 12, 14, 16],
  tension: [0, 2, 3, 7, 8, 12, 14, 15],
  crisis: [0, 1, 3, 6, 7, 12, 13],
  descubrimiento: [0, 4, 7, 11, 12, 14, 16, 19],
};
const ROOT: Record<Mood, number> = { calma: 50, tension: 45, crisis: 40, descubrimiento: 52 };
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private delay!: DelayNode;
  private mood: Mood = 'calma';
  private timer: number | null = null;
  private drone: { osc: OscillatorNode; gain: GainNode } | null = null;
  musicVolume = 0.6;
  sfxVolume = 0.7;

  /** Debe llamarse tras un gesto del usuario (política de autoplay). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    // Eco sencillo para dar espacio.
    this.delay = this.ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.35;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    this.delay.connect(lp).connect(fb).connect(this.delay);
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.delay);
    this.delay.connect(this.master);
    this.sfxBus.connect(this.master);
    this.setVolumes(this.musicVolume, this.sfxVolume);
    this.startLoop();
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music * 0.22, this.ctx.currentTime, 0.3);
    this.sfxBus.gain.setTargetAtTime(sfx * 0.35, this.ctx.currentTime, 0.05);
  }

  setMood(m: Mood): void {
    if (m === this.mood) return;
    const prev = this.mood;
    this.mood = m;
    if (m === 'descubrimiento') {
      this.sfx('descubrimiento');
      // El descubrimiento es un destello: la música vuelve a la calma.
      window.setTimeout(() => (this.mood = prev === 'descubrimiento' ? 'calma' : prev), 9000);
    }
    this.updateDrone();
  }

  private startLoop(): void {
    const step = () => {
      this.playPhrase();
      const tempo = this.mood === 'tension' ? 2600 : this.mood === 'crisis' ? 3400 : 4200;
      this.timer = window.setTimeout(step, tempo);
    };
    step();
    this.updateDrone();
  }

  /** Una frase: un acorde suave y una o dos notas de melodía. */
  private playPhrase(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicVolume <= 0) return;
    const scale = SCALES[this.mood];
    const root = ROOT[this.mood];
    const t = ctx.currentTime + 0.05;
    const chord = [0, 2, 4].map((i) => scale[(i + Math.floor(Math.random() * 3)) % scale.length]);
    for (const n of chord) this.tone(midi(root + n), t, 5.5, 0.07, this.mood === 'crisis' ? 'sawtooth' : 'triangle', this.mood === 'crisis' ? 700 : 1400);
    if (Math.random() < 0.8) {
      const n = scale[Math.floor(Math.random() * scale.length)];
      this.tone(midi(root + 12 + n), t + 1 + Math.random(), 2.2, 0.05, 'sine', 3000);
    }
    if (this.mood === 'tension') for (let i = 0; i < 2; i++) this.tone(midi(root - 12), t + i * 1.2, 0.5, 0.12, 'sine', 300);
  }

  private tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType, cutoff: number, bus: GainNode = this.musicBus): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 8;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + Math.min(1.2, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(f).connect(g).connect(bus);
    osc.start(start);
    osc.stop(start + dur + 0.1);
  }

  /** Dron grave que aparece en la crisis. */
  private updateDrone(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = this.mood === 'crisis';
    if (want && !this.drone) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midi(28);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.09, ctx.currentTime, 2);
      osc.connect(f).connect(gain).connect(this.musicBus);
      osc.start();
      this.drone = { osc, gain };
    } else if (!want && this.drone) {
      const d = this.drone;
      d.gain.gain.setTargetAtTime(0, ctx.currentTime, 1.5);
      window.setTimeout(() => d.osc.stop(), 5000);
      this.drone = null;
    }
  }

  sfx(kind: 'tap' | 'dia' | 'peticion' | 'descubrimiento' | 'error' | 'accion'): void {
    const ctx = this.ctx;
    if (!ctx || this.sfxVolume <= 0) return;
    const t = ctx.currentTime + 0.01;
    switch (kind) {
      case 'tap':
        this.tone(1200, t, 0.08, 0.15, 'sine', 4000, this.sfxBus);
        break;
      case 'accion':
        this.tone(660, t, 0.25, 0.2, 'triangle', 3000, this.sfxBus);
        this.tone(990, t + 0.08, 0.3, 0.15, 'triangle', 3000, this.sfxBus);
        break;
      case 'dia':
        this.tone(midi(62), t, 2.5, 0.25, 'sine', 2000, this.sfxBus);
        this.tone(midi(69), t + 0.02, 2.5, 0.15, 'sine', 2000, this.sfxBus);
        this.tone(midi(74), t + 0.04, 3, 0.1, 'sine', 3000, this.sfxBus);
        break;
      case 'peticion':
        this.tone(midi(76), t, 0.6, 0.18, 'sine', 4000, this.sfxBus);
        this.tone(midi(81), t + 0.15, 0.8, 0.14, 'sine', 4000, this.sfxBus);
        break;
      case 'descubrimiento':
        [0, 4, 7, 11, 14].forEach((n, i) => this.tone(midi(72 + n), t + i * 0.09, 1.4, 0.13, 'sine', 6000, this.sfxBus));
        break;
      case 'error':
        this.tone(160, t, 0.25, 0.2, 'square', 600, this.sfxBus);
        break;
    }
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

export const audio = new AudioEngine();
