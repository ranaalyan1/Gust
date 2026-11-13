/**
 * THE SCORE
 *
 * The room already had air — wind, wings, rain, a chord that breathes. What it
 * did not have was music: something with a shape you could remember, that is
 * different when you come back.
 *
 * So this is a small score, not a loop. A celesta plays a slow modal figure over
 * a bass pulse; each act of the game gets its own figure and its own mode, and
 * the whole thing sits far behind the wind because it is a room, not a concert
 * hall. The reverb is generated here too — a noise burst with an exponential
 * decay — so there is no sample to load and no licence to think about.
 *
 * Everything is scheduled a fraction of a second ahead of the audio clock, which
 * is the only way to play in time in a browser: the animation loop is not a
 * metronome and must never be treated as one.
 */
import type { Mood } from './audio.js';

/** D below middle C: the room is tuned to a low, warm room. */
const ROOT = 146.83;

/** Semitones above the root for the modes each act uses. */
const MODES: Record<Mood, number[]> = {
  // dorian: minor with a raised sixth, the "old" mode — hopeful without smiling
  dawn: [0, 2, 3, 5, 7, 9, 10],
  // natural minor, and nothing above the ninth: the storm has no high notes
  storm: [0, 2, 3, 5, 7, 8, 10],
  // lydian: the raised fourth is the whole trick, it sounds like light
  golden: [0, 2, 4, 6, 7, 9, 11],
};

/**
 * The figures. Each entry is a step of one beat; `null` is a rest, and a rest is
 * most of what makes a melody feel written rather than generated.
 */
const FIGURES: Record<Mood, (number | null)[]> = {
  dawn: [0, null, 4, null, 7, null, 4, null, null, 2, null, null, 4, null, 7, null],
  storm: [0, null, null, 2, null, null, 4, null, null, null, 2, null, null, 0, null, null],
  golden: [0, 2, 4, null, 7, null, 4, 2, null, 4, 6, null, 7, null, 4, null],
};

const BEAT: Record<Mood, number> = {
  dawn: 1.18, // ~51 bpm: slow enough to breathe between notes
  storm: 1.42,
  golden: 1.05,
};

export class Score {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode;
  private readonly wet: GainNode;
  private step = 0;
  private next = 0;
  private mood: Mood = 'dawn';
  private bar = 0;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.0;
    this.bus.connect(destination);

    // the tail: two and a half seconds of noise, squared off into a decay curve.
    // Cheap, and it does more for the sound than any of the notes.
    const seconds = 2.6;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = impulse.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (c === 0 ? 1 : 0.94);
      }
    }
    const verb = ctx.createConvolver();
    verb.buffer = impulse;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.34;
    verb.connect(this.wet).connect(this.bus);
    this.reverb = verb;
  }

  private readonly reverb: ConvolverNode;

  /** Bar one starts now. Safe to call once, from a user gesture. */
  start(at: number): void {
    this.next = at + 0.15;
    this.step = 0;
    this.bar = 0;
    this.bus.gain.cancelScheduledValues(at);
    this.bus.gain.setTargetAtTime(0.7, at, 2.0);
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    // a mode change lands on the bar, not mid-phrase
    this.mood = mood;
  }

  /** Called every frame; schedules only what is about to be heard. */
  update(now: number): void {
    const horizon = now + 0.7;
    let guard = 0;
    while (this.next < horizon && guard++ < 8) {
      this.play(this.step, this.next);
      this.next += BEAT[this.mood];
      this.step = (this.step + 1) % 32;
      if (this.step === 0) this.bar++;
    }
  }

  /** 0..1 — the room ducks the score when the Weather Mind speaks. */
  duck(amount: number): void {
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(0.7 * amount, t, 0.18);
  }

  private play(step: number, at: number): void {
    const mode = MODES[this.mood];
    const figure = FIGURES[this.mood];
    const idx = step % figure.length;
    const deg = figure[idx];

    // the bass: the root every four beats, an octave down, long and soft
    if (step % 8 === 0) {
      this.bass(at, ROOT * Math.pow(2, (mode[0] - 12) / 12));
    }
    // and a fifth under it two beats later, so the floor moves a little
    if (step % 8 === 4) {
      this.bass(at, ROOT * Math.pow(2, (mode[4] - 12) / 12));
    }

    if (deg === null) return;
    // every second phrase the figure is played an octave up: same tune, airier
    const octave = this.bar % 2 === 1 && step >= 16 ? 12 : 0;
    const semis = mode[deg % mode.length] + 12 * Math.floor(deg / mode.length) + octave;
    this.bell(at, ROOT * Math.pow(2, semis / 12));
    // a third below, quietly, on the first beat of the bar: a room, not a solo
    if (idx === 0 && this.bar % 2 === 0) {
      this.bell(at + 0.02, ROOT * Math.pow(2, (mode[2] + 12) / 12), 0.28);
    }
  }

  /** A struck, soft-edged bell: the note is in the attack and in the decay. */
  private bell(at: number, hz: number, level = 1): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, at);
    lp.frequency.exponentialRampToValueAtTime(900, at + 1.6);
    const peak = 0.14 * level;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.4);
    g.connect(lp);
    lp.connect(this.bus);
    lp.connect(this.reverb);

    const partials: [number, number, OscillatorType][] = [
      [1, 1, 'sine'],
      [2.01, 0.34, 'sine'],
      [3.02, 0.12, 'sine'],
      [1.004, 0.22, 'triangle'],
    ];
    for (const [mult, amp, type] of partials) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz * mult;
      const pg = ctx.createGain();
      pg.gain.value = amp;
      o.connect(pg).connect(g);
      o.start(at);
      o.stop(at + 2.6);
    }
  }

  /** A bowed floor: two detuned saws under a heavy filter, felt more than heard. */
  private bass(at: number, hz: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.075, at + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 3.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.7;
    g.connect(lp);
    lp.connect(this.bus);
    for (const detune of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.detune.value = detune;
      o.connect(g);
      o.start(at);
      o.stop(at + 3.6);
    }
  }
}
