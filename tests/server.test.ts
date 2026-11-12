import { describe, expect, it } from 'vitest';
import { GEMINI_MODELS, parseMissionText, resolveMission } from '../src/server/weatherMind.js';
import { STAGE_MOOD, STAGES, validateMission } from '../src/core/mission.js';

const mission = {
  name: 'Glass Rain',
  skyMood: 'storm',
  ambientWind: 0.55,
  turbulence: 0.5,
  thermalCount: 1,
  hazards: ['rain', 'gustFront'],
  narrativeBeat: 'Lightning shows the way through, then the rain swells.',
  cues: ['lightning', 'rain_swell'],
};
const geminiReply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({ error: { message: 'nope' } }) });

describe('/api/mission — live when it can be, graceful when it cannot', () => {
  it('reports source "gemini" when the model answers with a valid mission', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const r = await resolveMission(
      { stage: 1, losses: 2 },
      {
        apiKey: 'test-key',
        fetch: async (url, init) => {
          calls.push({ url, headers: init.headers, body: init.body });
          return ok(geminiReply(JSON.stringify(mission)));
        },
      },
    );
    expect(r.source).toBe('gemini');
    expect(r.mission.name).toBe('Glass Rain');
    expect(r.model).toBe(GEMINI_MODELS[0]);
    expect(calls.length).toBe(1);
    // the key travels in a header, never in the URL
    expect(calls[0].url).not.toContain('test-key');
    expect(calls[0].headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(calls[0].body);
    expect(body.generationConfig.temperature).toBeCloseTo(0.9);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toContain('seeds lost: 2');
  });

  it('falls back without a key — and never calls the network', async () => {
    let called = false;
    const r = await resolveMission({ stage: 2 }, { fetch: async () => ((called = true), ok({})) });
    expect(r.source).toBe('fallback');
    expect(r.reason).toBe('no-key');
    expect(called).toBe(false);
    expect(validateMission(r.mission, 2)).toEqual(r.mission);
  });

  it('skips a model that 404s and tries the next (stale model strings fix themselves)', async () => {
    const tried: string[] = [];
    const r = await resolveMission(
      { stage: 1 },
      {
        apiKey: 'k',
        model: 'gemini-9-flash-imaginary',
        fetch: async (url) => {
          tried.push(url);
          return tried.length < 3 ? status(404) : ok(geminiReply(JSON.stringify(mission)));
        },
      },
    );
    expect(r.source).toBe('gemini');
    expect(tried.length).toBe(3);
    expect(tried[0]).toContain('gemini-9-flash-imaginary');
    expect(r.model).toBe(GEMINI_MODELS[1]);
  });

  it('falls back on every kind of failure, always with a valid mission', async () => {
    const cases: [string, () => Promise<ReturnType<typeof ok>>][] = [
      ['http-403', async () => status(403)],
      ['network', async () => Promise.reject(new Error('offline'))],
      ['invalid-mission', async () => ok(geminiReply('{"name": 42}'))],
      ['invalid-mission', async () => ok(geminiReply('I am a poem, not JSON'))],
      ['empty', async () => ok({ candidates: [] })],
      ['http-500', async () => status(500)],
      ['model-not-found', async () => status(404)],
      ['bad-json', async () => ({ ok: true, status: 200, json: async () => Promise.reject(new Error('bad')) })],
    ];
    for (const [reason, fetch] of cases) {
      for (let stage = 0; stage < 4; stage++) {
        const r = await resolveMission({ stage }, { apiKey: 'k', fetch });
        expect(r.source).toBe('fallback');
        expect(r.reason).toBe(reason);
        expect(validateMission(r.mission, stage)).toEqual(r.mission);
        expect(r.mission.skyMood).toBe(STAGE_MOOD[STAGES[stage]]);
      }
    }
  });

  it('gives up at the timeout and answers from the bank', async () => {
    const t0 = Date.now();
    const r = await resolveMission(
      { stage: 3 },
      { apiKey: 'k', timeoutMs: 60, fetch: () => new Promise(() => undefined) },
    );
    expect(r.source).toBe('fallback');
    expect(r.reason).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('never leaks the key into the response', async () => {
    const r = await resolveMission({ stage: 0 }, { apiKey: 'SECRET-KEY-123', fetch: async () => status(403) });
    expect(JSON.stringify(r)).not.toContain('SECRET-KEY-123');
  });

  it('never throws, whatever the request body is', async () => {
    for (const body of [null, undefined, 'x', 42, [], { stage: 'nine' }, { stage: -Infinity }]) {
      const r = await resolveMission(body, {});
      expect(r.source).toBe('fallback');
      expect(r.mission.name.length).toBeGreaterThan(0);
    }
  });

  it('reads JSON even when the model wraps it in a code fence', () => {
    const m = parseMissionText('```json\n' + JSON.stringify(mission) + '\n```', 1);
    expect(m?.name).toBe('Glass Rain');
    expect(parseMissionText('nothing here', 1)).toBeNull();
  });

  it('a hostile model cannot break the game: values are clamped, mood is coerced', async () => {
    const evil = { ...mission, skyMood: 'golden', ambientWind: 1e9, turbulence: -5, thermalCount: 400, hazards: ['rain', 'nukes'] };
    const r = await resolveMission({ stage: 1 }, { apiKey: 'k', fetch: async () => ok(geminiReply(JSON.stringify(evil))) });
    expect(r.source).toBe('gemini');
    expect(r.mission.skyMood).toBe('storm');
    expect(r.mission.ambientWind).toBe(1);
    expect(r.mission.turbulence).toBe(0);
    expect(r.mission.thermalCount).toBe(5);
    expect(r.mission.hazards).toEqual(['rain']);
  });
});
