import { describe, expect, it } from 'vitest';
import {
  CUES,
  FALLBACK_MISSIONS,
  HAZARDS,
  MISSION_RESPONSE_SCHEMA,
  STAGES,
  STAGE_COUNT,
  STAGE_MOOD,
  adaptMission,
  buildMissionPrompt,
  cuesFromBeat,
  fallbackMission,
  sanitizeMissionRequest,
  validateMission,
} from '../src/core/mission.js';

const good = {
  name: 'The Patient Storm',
  skyMood: 'storm',
  ambientWind: 0.6,
  turbulence: 0.4,
  thermalCount: 2,
  hazards: ['rain', 'gustFront'],
  narrativeBeat: 'The storm holds its breath, then exhales through the stone gate.',
  cues: ['lightning', 'rain_swell'],
};

describe('mission contract — the Weather Mind can never break the game', () => {
  it('accepts a well-formed mission', () => {
    const m = validateMission(good, 1)!;
    expect(m).not.toBeNull();
    expect(m.name).toBe('The Patient Storm');
    expect(m.hazards).toEqual(['rain', 'gustFront']);
    expect(m.cues).toEqual(['lightning', 'rain_swell']);
  });

  it('rejects garbage outright', () => {
    for (const bad of [null, undefined, 42, 'storm', [], {}, { name: 'x' }, { ...good, ambientWind: 'strong' }, { ...good, name: '' }]) {
      expect(validateMission(bad, 0)).toBeNull();
    }
  });

  it('clamps every number into its legal range', () => {
    const m = validateMission({ ...good, ambientWind: 9, turbulence: -3, thermalCount: 99.7 }, 1)!;
    expect(m.ambientWind).toBe(1);
    expect(m.turbulence).toBe(0);
    expect(m.thermalCount).toBe(5);
    expect(validateMission({ ...good, ambientWind: NaN }, 1)).toBeNull();
  });

  it('drops unknown hazards and cues instead of trusting them', () => {
    const m = validateMission({ ...good, hazards: ['rain', 'meteor', 7, 'rain'], cues: ['lightning', 'explode'] }, 1)!;
    expect(m.hazards).toEqual(['rain']);
    expect(m.cues).toEqual(['lightning']);
    for (const h of m.hazards) expect(HAZARDS).toContain(h);
    for (const c of m.cues) expect(CUES).toContain(c);
  });

  it('coerces the sky mood to the act being played (three-act structure is not negotiable)', () => {
    STAGES.forEach((kind, stage) => {
      const m = validateMission({ ...good, skyMood: 'dawn' }, stage)!;
      expect(m.skyMood).toBe(STAGE_MOOD[kind]);
    });
  });

  it('truncates runaway text', () => {
    const m = validateMission({ ...good, name: 'N'.repeat(500), narrativeBeat: 'b'.repeat(5000) }, 1)!;
    expect(m.name.length).toBeLessThanOrEqual(60);
    expect(m.narrativeBeat.length).toBeLessThanOrEqual(240);
  });

  it('derives stage directions from the beat when the model sends none', () => {
    const m = validateMission({ ...good, cues: undefined, narrativeBeat: 'Birds scatter as thunder rolls and the light breaks through.' }, 1)!;
    expect(m.cues.length).toBeGreaterThan(0);
    expect(cuesFromBeat('thunder rolls over the ridge')).toContain('lightning');
    expect(cuesFromBeat('')).toEqual([]);
  });
});

describe('fallback bank — GUST is complete offline', () => {
  it('has hand-written missions for every stage, and every one passes validation', () => {
    expect(FALLBACK_MISSIONS.length).toBe(STAGE_COUNT);
    let total = 0;
    FALLBACK_MISSIONS.forEach((bank, stage) => {
      expect(bank.length).toBeGreaterThan(0);
      for (const m of bank) {
        total++;
        expect(validateMission(m, stage)).toEqual(m);
        expect(m.skyMood).toBe(STAGE_MOOD[STAGES[stage]]);
      }
    });
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it('always answers, whatever it is asked', () => {
    for (const stage of [0, 1, 2, 3, 4, -1, 99, NaN]) {
      for (const variant of [0, 1, 2, -5, 1e9]) {
        expect(fallbackMission(stage, variant).name.length).toBeGreaterThan(0);
      }
    }
  });

  it('adapts to the player: eases off after losses, pushes back on mastery', () => {
    const base = fallbackMission(1, 0);
    const req = sanitizeMissionRequest({ stage: 1, run: 0 });
    const hard = adaptMission(base, { ...req, losses: 6, struggle: 0.9, mastery: 0.1 });
    const easy = adaptMission(base, { ...req, losses: 0, struggle: 0, mastery: 0.95 });
    expect(hard.ambientWind).toBeLessThan(base.ambientWind);
    expect(hard.turbulence).toBeLessThanOrEqual(base.turbulence);
    expect(easy.turbulence).toBeGreaterThan(base.turbulence);
    for (const m of [hard, easy]) expect(validateMission(m, 1)).toEqual(m);
  });
});

describe('request sanitising and prompt', () => {
  it('turns anything into a safe request', () => {
    const r = sanitizeMissionRequest({ stage: 77, run: -4, losses: 1e9, mastery: 5, struggle: 'lots', previous: 'x'.repeat(999) });
    expect(r.stage).toBeGreaterThanOrEqual(0);
    expect(r.stage).toBeLessThan(STAGE_COUNT);
    expect(r.run).toBeGreaterThanOrEqual(0);
    expect(r.mastery).toBeLessThanOrEqual(1);
    expect(r.struggle).toBeGreaterThanOrEqual(0);
    expect(r.previous.length).toBeLessThanOrEqual(80);
    expect(sanitizeMissionRequest(null).stage).toBe(0);
    expect(sanitizeMissionRequest('junk').losses).toBe(0);
  });

  it('builds a prompt that names the act and the player state', () => {
    const p = buildMissionPrompt(sanitizeMissionRequest({ stage: 2, losses: 3, mastery: 0.2 }));
    expect(p).toContain('crossing');
    expect(p).toMatch(/3/);
  });

  it('ships a response schema with every required field', () => {
    for (const k of ['name', 'skyMood', 'ambientWind', 'turbulence', 'thermalCount', 'hazards', 'narrativeBeat']) {
      expect(MISSION_RESPONSE_SCHEMA.required).toContain(k);
    }
  });
});
