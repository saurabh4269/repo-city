/**
 * All sound is synthesised with Web Audio: nothing to license or download.
 * Pattern adapted from chausar/src/game/audio.ts (same kit).
 * - city rise rumble, pinch tick, roof lift, floor tap, button click,
 * - a fire crackle loop whose level follows the fire,
 * - test-run ticks and a success chord,
 * - the guide's voice through speechSynthesis when available (captions always show the text).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private crackleGain: GainNode | null = null;
  private crackleTimer: number | null = null;
  voice = true;

  /** Call from a user gesture (Enter XR, a click). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, glideTo = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, type: BiquadFilterType, freq: number, vol: number, delay = 0, q = 1, freqTo = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** The city rising out of the table: a low swell plus soft stone grit. */
  rise(): void {
    this.tone(55, 2.4, 'sine', 0.35, 0, 82);
    this.tone(110, 2.2, 'triangle', 0.08, 0.2, 165);
    this.noise(2.2, 'lowpass', 300, 0.18, 0, 0.7, 1200);
  }
  tick(pitch = 1): void {
    this.tone(1800 * pitch, 0.05, 'sine', 0.12);
  }
  hover(): void {
    this.tone(1250, 0.04, 'sine', 0.05);
  }
  click(): void {
    this.tone(900, 0.06, 'square', 0.06);
    this.tone(1350, 0.08, 'sine', 0.08, 0.02);
  }
  lift(): void {
    this.noise(0.5, 'bandpass', 500, 0.12, 0, 1.2, 2200);
    this.tone(330, 0.45, 'sine', 0.1, 0, 495);
  }
  close(): void {
    this.noise(0.35, 'bandpass', 1600, 0.08, 0, 1.2, 400);
    this.tone(330, 0.2, 'sine', 0.08, 0.15, 220);
  }
  floor(i: number): void {
    this.tone(520 * Math.pow(2, (i % 8) / 12), 0.12, 'triangle', 0.1);
  }
  alarm(): void {
    this.tone(620, 0.22, 'sawtooth', 0.05, 0);
    this.tone(520, 0.22, 'sawtooth', 0.05, 0.24);
  }
  testTick(i: number): void {
    this.tone(880 + (i % 5) * 110, 0.05, 'sine', 0.05);
  }
  steam(): void {
    this.noise(1.6, 'highpass', 3000, 0.22, 0, 0.6, 900);
  }
  success(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, 1.4 - i * 0.15, 'triangle', 0.12, i * 0.11));
    this.tone(261.6, 1.8, 'sine', 0.12, 0.05);
  }

  /** Fire crackle loop; level 0 stops it. */
  setFire(level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.crackleGain) {
      this.crackleGain = ctx.createGain();
      this.crackleGain.gain.value = 0;
      this.crackleGain.connect(this.master);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      src.connect(f).connect(g).connect(this.crackleGain);
      src.start();
      // Random pops on top of the roar.
      this.crackleTimer = window.setInterval(() => {
        if (!this.crackleGain || this.crackleGain.gain.value < 0.02) return;
        if (Math.random() < 0.6) this.noise(0.03 + Math.random() * 0.04, 'highpass', 1800 + Math.random() * 2500, 0.06 * this.crackleGain.gain.value, Math.random() * 0.1, 0.8);
      }, 90);
    }
    this.crackleGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), ctx.currentTime, 0.25);
  }

  speak(text: string): void {
    if (!this.voice) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 1.05;
      const v = synth.getVoices().find((x) => /en[-_](US|GB)/i.test(x.lang));
      if (v) u.voice = v;
      synth.speak(u);
    } catch {
      /* no TTS */
    }
  }

  stopSpeech(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    if (this.crackleTimer !== null) window.clearInterval(this.crackleTimer);
  }
}

export const sfx = new Sfx();
