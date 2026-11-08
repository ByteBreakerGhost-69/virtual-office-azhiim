/**
 * Chiptune audio generated with the Web Audio API (no audio files, nothing downloaded).
 * Nothing plays until the user flips a toggle (browser autoplay rules + the product requirement).
 */
export type Sfx = 'select' | 'deselect' | 'footstep' | 'door' | 'success' | 'error' | 'alert' | 'click';

const STORE = 'avo.audio';
interface Prefs { music: boolean; sfx: boolean }

const N = (name: string): number => {
  const m = /^([A-G])(#?)(\d)$/.exec(name)!;
  const idx = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'] + (m[2] ? 1 : 0);
  return 440 * 2 ** ((idx + (Number(m[3]) - 4) * 12 - 9) / 12);
};
// 16-step gentle loop in A minor: lead, bass, arpeggio. "-" = rest.
const LEAD = 'E5 - G5 - A5 - G5 E5 - D5 - C5 - D5 -  E5 - G5 - B5 - A5 G5 - E5 - D5 - - -'.split(/\s+/).filter(Boolean);
const BASS = 'A2 - - - A2 - - - F2 - - - F2 - - -  C3 - - - C3 - - - G2 - - - G2 - - -'.split(/\s+/).filter(Boolean);
const ARP = 'A3 C4 E4 C4 A3 C4 E4 C4 F3 A3 C4 A3 F3 A3 C4 A3 C3 E3 G3 E3 C3 E3 G3 E3 G3 B3 D4 B3 G3 B3 D4 B3'.split(/\s+/).filter(Boolean);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private lastFoot = 0;
  prefs: Prefs = { music: false, sfx: false };
  private listeners = new Set<() => void>();

  constructor() {
    // Remembered choice only restores the toggle UI; audio still needs a user gesture to actually start.
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Prefs>;
        this.prefs = { music: false, sfx: !!p.sfx };
      }
    } catch {
      /* ignore */
    }
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
    this.listeners.forEach((f) => f());
  }
  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    return this.ctx;
  }

  setSfx(on: boolean): void {
    this.prefs.sfx = on;
    if (on) {
      this.ensure();
      this.play('click');
    }
    this.emit();
  }
  setMusic(on: boolean): void {
    this.prefs.music = on;
    if (on) this.startMusic();
    else this.stopMusic();
    this.emit();
  }

  // ------------------------------------------------------------------ music
  private startMusic(): void {
    const ctx = this.ensure();
    if (!ctx || this.timer) return;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    const stepDur = 60 / 92 / 2; // eighth notes at 92 bpm
    this.timer = setInterval(() => {
      if (!this.ctx) return;
      while (this.nextTime < this.ctx.currentTime + 0.4) {
        this.scheduleStep(this.step % 32, this.nextTime, stepDur);
        this.step++;
        this.nextTime += stepDur;
      }
    }, 120);
  }
  private stopMusic(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private tone(freq: number, t: number, dur: number, type: OscillatorType, gain: number, dest: AudioNode, slideTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  private scheduleStep(i: number, t: number, d: number): void {
    const mg = this.musicGain!;
    const lead = LEAD[i];
    if (lead && lead !== '-') this.tone(N(lead), t, d * 1.8, 'square', 0.35, mg);
    const bass = BASS[i];
    if (bass && bass !== '-') this.tone(N(bass), t, d * 3.6, 'triangle', 0.9, mg);
    const arp = ARP[i];
    if (arp) this.tone(N(arp), t, d * 0.9, 'square', 0.12, mg);
  }

  // ------------------------------------------------------------------ effects
  play(name: Sfx): void {
    if (!this.prefs.sfx) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const m = this.master;
    switch (name) {
      case 'select':
        this.tone(N('E5'), t, 0.06, 'square', 0.25, m);
        this.tone(N('A5'), t + 0.06, 0.09, 'square', 0.25, m);
        break;
      case 'deselect':
        this.tone(N('A5'), t, 0.05, 'square', 0.2, m);
        this.tone(N('E5'), t + 0.05, 0.08, 'square', 0.2, m);
        break;
      case 'footstep':
        if (ctx.currentTime - this.lastFoot < 0.22) return;
        this.lastFoot = ctx.currentTime;
        this.tone(140, t, 0.04, 'triangle', 0.18, m, 80);
        break;
      case 'door':
        this.tone(N('C4'), t, 0.07, 'square', 0.18, m, N('G4'));
        break;
      case 'success':
        for (const [i, n] of ['C5', 'E5', 'G5', 'C6'].entries()) this.tone(N(n), t + i * 0.07, 0.12, 'square', 0.22, m);
        break;
      case 'error':
        this.tone(N('A3'), t, 0.14, 'sawtooth', 0.2, m);
        this.tone(N('E3'), t + 0.12, 0.2, 'sawtooth', 0.2, m);
        break;
      case 'alert':
        for (let i = 0; i < 3; i++) this.tone(N('B5'), t + i * 0.14, 0.08, 'square', 0.22, m);
        break;
      case 'click':
        this.tone(N('G5'), t, 0.04, 'square', 0.16, m);
        break;
    }
  }
}

export const audio = new AudioEngine();
