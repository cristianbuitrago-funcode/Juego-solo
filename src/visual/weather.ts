import { VQ } from './quality';

/**
 * El tiempo, a la resolución de la pantalla. Cada partícula tiene
 * profundidad (las cercanas son más grandes, rápidas y opacas; las lejanas,
 * finas y tenues), de modo que la lluvia y la nieve tienen volumen. La
 * lluvia salpica al llegar al suelo; la tormenta trae relámpagos; la niebla
 * se mueve en bancos; el viento arrastra hojas y polvo.
 */
interface P {
  x: number;
  y: number;
  z: number; // 0 lejos … 1 cerca
  vx: number;
  vy: number;
  r: number;
  rot: number;
  life: number;
  ground: number;
  splash: number;
  c: number;
}

const LEAVES = ['#c9862f', '#9a6424', '#7aa04a', '#d8a83a', '#b8462a', '#8a9a3a'];

export class Weather {
  private ps: P[] = [];
  private kind = '';
  flash = 0;
  private bolt: { x: number; pts: number[]; t: number } | null = null;
  private fog: { x: number; y: number; r: number; v: number }[] = [];
  private flakeTex: HTMLCanvasElement | null = null;

  /** Dibuja el tiempo sobre la pantalla (coordenadas CSS, ya escaladas por la densidad). */
  draw(g: CanvasRenderingContext2D, weather: string, W: number, H: number, t: number, dt: number, calm: boolean, camDx: number, camDy: number): void {
    if (weather !== this.kind) {
      this.kind = weather;
      this.ps.length = 0;
      this.fog.length = 0;
    }
    const storm = weather === 'tormenta';
    const rain = weather === 'lluvia' || storm;
    const snow = weather === 'nieve';
    const wind = weather === 'viento';
    const fog = weather === 'niebla';
    const budget = VQ().particles * (calm ? 0.4 : 1);
    if (fog) return this.drawFog(g, W, H, t, dt, camDx, camDy);
    if (!rain && !snow && !wind) {
      this.ps.length = 0;
      return;
    }
    const n = Math.round(budget * (storm ? 1 : rain ? 0.75 : snow ? 0.7 : 0.18) * ((W * H) / (400 * 850)));
    while (this.ps.length < n) this.ps.push(this.spawn(W, H, true, rain, snow));
    if (this.ps.length > n) this.ps.length = n;
    const k = Math.min(3, dt * 60);
    if (rain) {
      const slant = storm ? 0.42 : 0.16;
      // Oscurece un poco el aire.
      g.lineCap = 'round';
      // Tres capas de profundidad, cada una en un solo trazo (sin degradados por gota):
      // las lejanas finas y tenues, las cercanas largas, gruesas y claras.
      const layers: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
      g.strokeStyle = 'rgba(210,226,245,0.4)';
      g.lineWidth = 0.8;
      g.beginPath();
      for (const p of this.ps) {
        if (p.splash > 0) {
          // Salpicadura: un anillo que se abre y unas gotitas.
          const s = p.splash;
          const rr = 1 + s * 5 * (0.5 + p.z);
          g.moveTo(p.x + rr, p.ground);
          g.ellipse(p.x, p.ground, rr, rr * 0.35, 0, 0, Math.PI * 2);
          if (s < 0.4) {
            g.moveTo(p.x - 2 - s * 4, p.ground - 3 - s * 6);
            g.lineTo(p.x - 2.6 - s * 4, p.ground - 4 - s * 6);
            g.moveTo(p.x + 2 + s * 4, p.ground - 3 - s * 6);
            g.lineTo(p.x + 2.6 + s * 4, p.ground - 4 - s * 6);
          }
          p.splash += 0.06 * k;
          if (p.splash >= 1) Object.assign(p, this.spawn(W, H, false, rain, snow));
          continue;
        }
        const sp = (storm ? 22 : 15) * (0.55 + p.z * 0.7);
        p.y += sp * k + camDy * (0.3 + p.z);
        p.x -= slant * sp * k - camDx * (0.3 + p.z);
        const len = (storm ? 22 : 15) * (0.5 + p.z * 0.9);
        const L = layers[p.z < 0.4 ? 0 : p.z < 0.8 ? 1 : 2];
        L.moveTo(p.x + slant * len, p.y - len);
        L.lineTo(p.x, p.y);
        if (p.y >= p.ground && p.z < 0.85) p.splash = 0.01;
        if (p.x < -30) p.x += W + 60;
        if (p.x > W + 30) p.x -= W + 60;
        if (p.y > H + 30) Object.assign(p, this.spawn(W, H, false, rain, snow));
      }
      g.stroke();
      const styles: [string, number][] = [['rgba(190,205,228,0.22)', 0.7], ['rgba(205,220,240,0.36)', 1.1], ['rgba(225,235,250,0.5)', 1.8]];
      layers.forEach((L, i) => {
        g.strokeStyle = styles[i][0];
        g.lineWidth = styles[i][1];
        g.stroke(L);
      });
      if (storm && !calm) {
        if (this.flash <= 0 && Math.random() < dt * 0.25) {
          this.flash = 1;
          const x = W * (0.15 + Math.random() * 0.7);
          const pts: number[] = [x, -10];
          let px = x;
          for (let y = 0; y < H * 0.45; y += 18 + Math.random() * 20) pts.push((px += (Math.random() - 0.5) * 40), y);
          this.bolt = { x, pts, t: 0.25 };
        }
        if (this.bolt && this.bolt.t > 0) {
          g.strokeStyle = `rgba(240,245,255,${Math.min(1, this.bolt.t * 4).toFixed(3)})`;
          g.lineWidth = 2.2;
          g.beginPath();
          for (let i = 0; i < this.bolt.pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, this.bolt.pts[i], this.bolt.pts[i + 1]);
          g.stroke();
          this.bolt.t -= dt;
        }
        if (this.flash > 0) {
          g.fillStyle = `rgba(230,236,255,${(this.flash * 0.5).toFixed(3)})`;
          g.fillRect(0, 0, W, H);
          this.flash -= dt * 3;
        }
      }
      return;
    }
    if (snow) {
      const tx = this.flake();
      for (const p of this.ps) {
        p.y += (0.6 + p.z * 1.2) * k + camDy * (0.3 + p.z);
        p.x += Math.sin(t / 900 + p.c * 7) * (0.3 + p.z * 0.4) * k + camDx * (0.3 + p.z);
        const r = p.r * (0.6 + p.z);
        g.globalAlpha = 0.45 + p.z * 0.5;
        g.drawImage(tx, p.x - r, p.y - r, r * 2, r * 2);
        if (p.y > H + 8 || p.x < -20 || p.x > W + 20) Object.assign(p, this.spawn(W, H, false, rain, snow));
      }
      g.globalAlpha = 1;
      return;
    }
    // Viento: ráfagas de polvo y hojas que giran.
    const gust = 0.6 + Math.sin(t / 1400) * 0.4;
    g.strokeStyle = 'rgba(240,236,220,0.18)';
    g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const y = (i * 113 + t * 0.012) % H;
      const x = ((t * 0.25 * gust + i * 217) % (W + 200)) - 100;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 30, y - 4, x + 70, y + 2);
      g.stroke();
    }
    for (const p of this.ps) {
      p.x += (2.4 + p.z * 2) * gust * k;
      p.y += (Math.sin(t / 260 + p.c * 9) * 0.6 + 0.25) * k;
      p.rot += 0.1 * k;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.abs(Math.sin(p.rot * 1.3)) + 0.2);
      g.fillStyle = LEAVES[Math.floor(p.c * LEAVES.length)];
      const s = 2 + p.z * 2.5;
      g.beginPath();
      g.ellipse(0, 0, s, s * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      if (p.x > W + 10) Object.assign(p, this.spawn(W, H, false, rain, snow), { x: -8 });
    }
  }

  private drawFog(g: CanvasRenderingContext2D, W: number, H: number, t: number, dt: number, camDx: number, camDy: number): void {
    if (!this.fog.length) for (let i = 0; i < 9; i++) this.fog.push({ x: Math.random() * W, y: Math.random() * H, r: 140 + Math.random() * 180, v: 6 + Math.random() * 10 });
    g.fillStyle = 'rgba(214,220,226,0.22)';
    g.fillRect(0, 0, W, H);
    const blob = this.fogTex('blob');
    for (const f of this.fog) {
      f.x += f.v * dt + camDx * 0.6;
      f.y += camDy * 0.6;
      if (f.x - f.r > W) f.x = -f.r;
      if (f.y - f.r > H) f.y = -f.r;
      if (f.y + f.r < 0) f.y = H + f.r;
      g.drawImage(blob, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    // La niebla se espesa en los bordes.
    g.drawImage(this.fogTex('edge'), 0, 0, W, H);
    void t;
  }

  private fogCache: Record<string, HTMLCanvasElement> = {};
  private fogTex(kind: 'blob' | 'edge'): HTMLCanvasElement {
    const hit = this.fogCache[kind];
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = kind === 'blob' ? g.createRadialGradient(64, 64, 0, 64, 64, 64) : g.createRadialGradient(64, 64, 32, 64, 64, 90);
    gr.addColorStop(0, kind === 'blob' ? 'rgba(226,230,234,0.42)' : 'rgba(220,225,230,0)');
    gr.addColorStop(1, kind === 'blob' ? 'rgba(226,230,234,0)' : 'rgba(220,225,230,0.55)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return (this.fogCache[kind] = c);
  }

  private flake(): HTMLCanvasElement {
    if (this.flakeTex) return this.flakeTex;
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(240,246,255,0.85)');
    gr.addColorStop(1, 'rgba(230,240,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 16, 16);
    return (this.flakeTex = c);
  }

  private spawn(W: number, H: number, anywhere: boolean, rain: boolean, snow: boolean): P {
    const z = Math.random();
    return {
      x: Math.random() * (W + 60) - 30,
      y: anywhere ? Math.random() * H : -20 - Math.random() * 40,
      z,
      vx: 0,
      vy: 0,
      r: snow ? 1.6 + Math.random() * 2.2 : 1,
      rot: Math.random() * 6,
      life: 0,
      ground: H * (0.15 + Math.random() * 0.85),
      splash: 0,
      c: Math.random(),
    };
  }
}
