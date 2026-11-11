/**
 * THE SOUND OF AIR — pure Web Audio, zero assets.
 *
 * Everything is synthesised: one looped noise buffer shaped by filters becomes
 * hand wind, world wind, the seed's whisper and rain; sine bells mark the
 * moments that matter; birds sing only when the air is still.
 *
 * The context starts on the first user gesture and every call is safe before
 * that (and on browsers with no Web Audio at all).
 */

export interface AudioFrame {
  /** Peak wind speed the hands are making (m/s). */
  handEnergy: number;
  /** Speed of the air relative to the lead seed (m/s). */
  seedAir: number;
  /** Prevailing wind + turbulence (m/s). */
  ambient: number;
  rain: number;
  /** Sky weights. */
  dawn: number;
  storm: number;
  golden: number;
  /** 0..1 hostile draft blowing now / warning before it. */
  pulse: number;
  pulseWarning: number;
  /** -1..1 where the action is, for panning. */
  pan: number;
}

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const noteHz = (semitones: number, base = 261.63) => base * Math.pow(2, semitones / 12);

export class GustAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private handFilter!: BiquadFilterNode;
  private handGain!: GainNode;
  private worldFilter!: BiquadFilterNode;
  private worldGain!: GainNode;
  private seedFilter!: BiquadFilterNode;
  private seedGain!: GainNode;
  private rainGain!: GainNode;
  private pulseFilter!: BiquadFilterNode;
  private pulseGain!: GainNode;
  private pads: { gain: GainNode; key: 'dawn' | 'storm' | 'golden' }[] = [];
  private panner: StereoPannerNode | null = null;
  private birdTimer = 2;
  private stillness = 0;
  private dripTimer = 0;
  private plantStep = 0;
  private lastPlant = 0;
  muted = false;

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  start(): void {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') void this.ctx.resume();
        return;
      }
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 5;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);
      this.master.connect(comp);

      // one noise buffer feeds every "air" layer
      const len = ctx.sampleRate * 3;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // slightly pink: softer than white noise, closer to moving air
        const white = Math.random() * 2 - 1;
        last = 0.82 * last + 0.18 * white;
        data[i] = last * 2.4 + white * 0.25;
      }
      const layer = (type: BiquadFilterType, freq: number, q: number): [BiquadFilterNode, GainNode] => {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter).connect(gain);
        src.start(0, Math.random() * 2);
        return [filter, gain];
      };
      [this.handFilter, this.handGain] = layer('bandpass', 500, 0.7);
      [this.worldFilter, this.worldGain] = layer('lowpass', 320, 0.4);
      [this.seedFilter, this.seedGain] = layer('bandpass', 2600, 3.5);
      [this.pulseFilter, this.pulseGain] = layer('bandpass', 180, 1.2);
      const [, rainGain] = layer('highpass', 2600, 0.5);
      this.rainGain = rainGain;
      try {
        this.panner = ctx.createStereoPanner();
        this.panner.connect(this.master);
        this.handGain.connect(this.panner);
        this.seedGain.connect(this.panner);
      } catch {
        this.handGain.connect(this.master);
        this.seedGain.connect(this.master);
      }
      this.worldGain.connect(this.master);
      this.rainGain.connect(this.master);
      this.pulseGain.connect(this.master);

      // three quiet pads, one per act, crossfaded by the sky
      const pad = (key: 'dawn' | 'storm' | 'golden', notes: number[], type: OscillatorType) => {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = key === 'storm' ? 420 : 900;
        lp.connect(gain).connect(this.master);
        notes.forEach((n, i) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = noteHz(n, 130.81);
          o.detune.value = (i % 2 ? 1 : -1) * 5;
          const g = ctx.createGain();
          g.gain.value = 0.16;
          // slow breathing so the chord never sits still
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 0.05 + i * 0.023;
          const lg = ctx.createGain();
          lg.gain.value = 0.09;
          lfo.connect(lg).connect(g.gain);
          o.connect(g).connect(lp);
          o.start();
          lfo.start();
        });
        this.pads.push({ gain, key });
      };
      pad('dawn', [0, 7, 14, 16], 'sine'); // C add9: open, hopeful
      pad('storm', [-3, 4, 9, 12], 'triangle'); // A minor, low
      pad('golden', [5, 12, 16, 21], 'sine'); // F major 7: warm, resolved
    } catch {
      this.ctx = null;
    }
  }

  private set(param: AudioParam, value: number, time = 0.08): void {
    if (!this.ctx) return;
    param.setTargetAtTime(value, this.ctx.currentTime, time);
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.set(this.master.gain, this.muted ? 0 : 0.9, 0.2);
    const e = Math.min(1, f.handEnergy / 9);
    // hand wind: louder and brighter the harder you sweep
    this.set(this.handGain.gain, e * e * 0.55 + e * 0.12, 0.05);
    this.set(this.handFilter.frequency, 260 + 1500 * e, 0.06);
    // the world's own air
    const a = Math.min(1, f.ambient / 3.2);
    this.set(this.worldGain.gain, 0.05 + 0.22 * a + 0.2 * f.storm, 0.4);
    this.set(this.worldFilter.frequency, 220 + 420 * a + 200 * f.storm, 0.4);
    // the seed's whisper: air moving past it
    const s = Math.min(1, f.seedAir / 6);
    this.set(this.seedGain.gain, s * 0.1, 0.07);
    this.set(this.seedFilter.frequency, 1700 + 2600 * s, 0.07);
    this.set(this.rainGain.gain, f.rain * 0.16, 0.5);
    // the tunnel's breath: a low inhale that swells into the blow
    const p = Math.max(f.pulse, f.pulseWarning * 0.6);
    this.set(this.pulseGain.gain, p * 0.5, 0.12);
    this.set(this.pulseFilter.frequency, 110 + 260 * f.pulse + 90 * f.pulseWarning, 0.12);
    if (this.panner) this.set(this.panner.pan, Math.max(-0.7, Math.min(0.7, f.pan)), 0.15);
    for (const pad of this.pads) this.set(pad.gain.gain, f[pad.key] * 0.075, 1.2);

    // birds sing when the air has been still for a while (and never in a storm)
    const still = e < 0.12 && f.storm < 0.3;
    this.stillness = still ? Math.min(6, this.stillness + dt) : 0;
    if (this.stillness > 1.8) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 1.2 + Math.random() * 4.2;
        this.chirp();
      }
    }
    // rain taps
    if (f.rain > 0.1) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.03 + Math.random() * 0.14 / f.rain;
        this.tick(0.012 + Math.random() * 0.02, 2500 + Math.random() * 4000, 0.03 * f.rain, (Math.random() - 0.5) * 1.6);
      }
    }
  }

  // ── one-shots ──────────────────────────────────────────────────────────────

  private out(pan = 0): AudioNode {
    const ctx = this.ctx!;
    try {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.master);
      return p;
    } catch {
      return this.master;
    }
  }

  private bell(freq: number, gain: number, decay: number, delay = 0, pan = 0, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const out = this.out(pan);
    const voice = (f: number, g: number, d: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(g, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(env).connect(out);
      o.start(t);
      o.stop(t + d + 0.05);
    };
    voice(freq, gain, decay);
    voice(freq * 2.01, gain * 0.35, decay * 0.6);
    voice(freq * 3.02, gain * 0.12, decay * 0.35);
  }

  private tick(duration: number, freq: number, gain: number, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random() * 2, duration + 0.02);
  }

  private burst(duration: number, type: BiquadFilterType, f0: number, f1: number, gain: number, attack = 0.01, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = 0.8;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random() * 2);
    src.stop(t + duration + 0.05);
  }

  private chirp(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const out = this.out((Math.random() - 0.5) * 1.6);
    const base = 2300 + Math.random() * 1900;
    const notes = 2 + Math.floor(Math.random() * 4);
    let t = ctx.currentTime;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const d = 0.05 + Math.random() * 0.07;
      const f = base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.75), t + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.02);
      t += d + 0.03 + Math.random() * 0.06;
    }
  }

  /** The seed lets go of the dandelion. */
  pluck(pan = 0): void {
    this.bell(noteHz(12), 0.16, 1.6, 0, pan);
    this.bell(noteHz(19), 0.1, 1.9, 0.07, pan);
    this.burst(0.35, 'bandpass', 900, 3200, 0.1, 0.03, pan);
  }

  /** A sharp gust from a sweep. */
  gust(strength: number, pan = 0): void {
    const e = Math.min(1, strength / 12);
    this.burst(0.3 + 0.25 * e, 'bandpass', 500 + 900 * e, 220, 0.1 + 0.2 * e, 0.025, pan);
  }

  clap(pan = 0): void {
    this.burst(0.09, 'bandpass', 2400, 900, 0.5, 0.002, pan);
    this.burst(0.7, 'lowpass', 500, 60, 0.4, 0.006, pan);
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  whirl(): void {
    this.burst(1.6, 'bandpass', 300, 1500, 0.12, 0.5);
  }

  updraft(): void {
    this.burst(0.9, 'bandpass', 200, 900, 0.09, 0.3);
  }

  /** A seed takes root. Successive landings climb a pentatonic scale. */
  plant(pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.currentTime - this.lastPlant > 6) this.plantStep = 0;
    this.lastPlant = ctx.currentTime;
    const n = PENTATONIC[this.plantStep % PENTATONIC.length] + 12 * Math.floor(this.plantStep / PENTATONIC.length);
    this.plantStep++;
    this.bell(noteHz(n), 0.2, 2.2, 0, pan);
    this.bell(noteHz(n + 7), 0.08, 2.6, 0.09, pan);
    this.tick(0.08, 400, 0.12, pan);
  }

  /** The island blooms: a rising arpeggio into a held chord. */
  bloom(grand: boolean): void {
    const chord = grand ? [0, 4, 7, 12, 16, 19, 24, 28, 31] : [0, 7, 12, 16, 19];
    chord.forEach((n, i) => {
      this.bell(noteHz(n), grand ? 0.13 : 0.12, grand ? 5 : 3.2, i * (grand ? 0.16 : 0.11), (i / chord.length - 0.5) * 1.2);
    });
    this.burst(grand ? 4 : 2, 'bandpass', 400, 4200, grand ? 0.1 : 0.06, grand ? 1.5 : 0.7);
  }

  /** A seed falls into the clouds: a soft falling sigh, never a buzzer. */
  lost(pan = 0): void {
    this.bell(noteHz(4), 0.08, 1.4, 0, pan, 'triangle');
    this.bell(noteHz(-1), 0.07, 1.8, 0.16, pan, 'triangle');
  }

  /** A fresh seed appears on the dandelion. */
  respawn(): void {
    this.bell(noteHz(7), 0.07, 1.0);
    this.bell(noteHz(14), 0.06, 1.3, 0.1);
  }

  /** A thermal ignites. */
  ignite(pan = 0): void {
    this.burst(1.4, 'bandpass', 120, 520, 0.14, 0.5, pan);
    this.bell(noteHz(-12), 0.1, 2.2, 0, pan);
  }

  thunder(power = 1): void {
    this.burst(0.25, 'highpass', 3000, 800, 0.22 * power, 0.004);
    this.burst(3.2, 'lowpass', 300, 40, 0.8 * power, 0.03);
    this.burst(4.5, 'lowpass', 120, 30, 0.5 * power, 0.6);
  }

  /** The storm breaks / the journey moves on. */
  travel(): void {
    this.burst(3.2, 'bandpass', 250, 1100, 0.08, 1.2);
  }
}
