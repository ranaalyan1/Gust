/**
 * THE WEATHER MIND (the part that never sleeps)
 *
 * Between stages the Weather Mind asks Gemini for the next mission. But the
 * sky also has to respond *right now*, every frame, offline, with no latency.
 * This is that half: a tiny deterministic director that watches the flight and
 * answers with weather the player can see and feel.
 *
 *   struggling -> `assist` rises: a tailwind gathers behind the seed, a thermal
 *                 ignites in the gap, hostile drafts lose their teeth.
 *   mastering  -> `menace` rises: rougher air, sharper drafts.
 *
 * It has no UI and no words. It is observed only through what the sky does.
 */
import { clamp01, damp } from './vec3.js';
import type { MissionRequest } from './mission.js';

export interface MindObservation {
  /** 0..1 best progress of any seed toward the goal right now. */
  progress: number;
  /** True while at least one seed is in the air. */
  flying: boolean;
  /** Peak wind speed the player is producing (m/s). */
  handEnergy: number;
}

export type MindIntent = 'watching' | 'helping' | 'testing';

export class WeatherMind {
  /** 0..1 how much the sky is helping right now. */
  assist = 0;
  /** 0..1 how hard the sky is pushing back right now. */
  menace = 0;
  /** 0..1 long-running estimate of the player's skill, carried across stages. */
  mastery = 0.5;
  /** Seeds lost in the current stage. */
  losses = 0;
  /** Seconds spent in the current stage. */
  stageTime = 0;
  /** Seconds since the seed last made real headway. */
  stall = 0;
  /** Peak assist given during the current stage (reported to Gemini as "struggle"). */
  peakAssist = 0;

  private bestProgress = 0;
  private assistTarget = 0;

  get intent(): MindIntent {
    if (this.assist > 0.25) return 'helping';
    if (this.menace > 0.35) return 'testing';
    return 'watching';
  }

  /** A new stage begins. `difficulty` 0..1 comes from the mission (wind + turbulence). */
  beginStage(difficulty: number): void {
    this.losses = 0;
    this.stageTime = 0;
    this.stall = 0;
    this.bestProgress = 0;
    this.peakAssist = 0;
    this.assistTarget = 0;
    this.assist *= 0.3;
    // a skilled player meets a sky that pushes back; a new one meets a patient sky
    this.menaceBase = clamp01((this.mastery - 0.45) * 1.4) * (0.5 + 0.5 * difficulty);
  }

  private menaceBase = 0;

  /** A seed fell into the clouds. The sky notices. */
  onLoss(): void {
    this.losses++;
    this.assistTarget = clamp01(this.assistTarget + 0.34);
    this.mastery = clamp01(this.mastery - 0.08);
    this.stall = 0;
    this.bestProgress = 0;
  }

  /** The stage was completed. Updates long-term mastery. */
  onSuccess(parTime: number): void {
    const speed = clamp01(parTime / Math.max(this.stageTime, 1)); // 1 = at or under par
    const clean = 1 / (1 + this.losses);
    const score = clamp01(0.55 * clean + 0.45 * speed - 0.5 * this.peakAssist);
    this.mastery = clamp01(this.mastery + (score - this.mastery) * 0.5);
  }

  step(dt: number, obs: MindObservation): void {
    this.stageTime += dt;
    if (obs.progress > this.bestProgress + 0.02) {
      this.bestProgress = obs.progress;
      this.stall = 0;
      // real headway: the sky steps back a little
      this.assistTarget = Math.max(0, this.assistTarget - 0.006);
    } else {
      this.stall += dt;
    }
    // a long stall, in the air or not, also draws help — gently
    const stallHelp = clamp01((this.stall - 14) / 25) * 0.6;
    const target = clamp01(Math.max(this.assistTarget, stallHelp));
    this.assist += (target - this.assist) * damp(target > this.assist ? 0.5 : 0.25, dt);
    if (this.assist > this.peakAssist) this.peakAssist = this.assist;
    // menace only shows itself to a player who is clearly coping
    const menaceTarget = this.menaceBase * (1 - clamp01(this.assist * 2.5)) * (this.losses === 0 ? 1 : 0.4);
    this.menace += (menaceTarget - this.menace) * damp(0.4, dt);
  }

  /** Multiplier on hostile drafts and downdrafts. */
  get hostility(): number {
    return (1 - 0.65 * this.assist) * (1 + 0.35 * this.menace);
  }

  /** Multiplier on turbulence. */
  get roughness(): number {
    return (1 - 0.5 * this.assist) * (1 + 0.7 * this.menace);
  }

  /** Strength of the helping tailwind behind the seed (m/s at its source). */
  get tailwind(): number {
    return 3.4 * this.assist;
  }

  /** Strength of the helping thermal in the gap (m/s). */
  get reliefThermal(): number {
    return 3.4 * clamp01((this.assist - 0.3) / 0.4);
  }

  /** What the sky tells Gemini about the stage that just ended. */
  report(nextStage: number, run: number, gardenSize: number, previous: string): MissionRequest {
    return {
      stage: nextStage,
      run,
      losses: this.losses,
      clearTime: Math.round(this.stageTime * 10) / 10,
      mastery: Math.round(this.mastery * 100) / 100,
      struggle: Math.round(this.peakAssist * 100) / 100,
      gardenSize,
      previous,
    };
  }
}
