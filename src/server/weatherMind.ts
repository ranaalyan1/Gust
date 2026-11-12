/**
 * THE WEATHER MIND (the part that dreams) — server side.
 *
 * One function, `resolveMission`, used by both the Vercel function
 * (api/mission.ts) and the dev server middleware. It asks Gemini Flash for the
 * next mission and ALWAYS returns a valid one:
 *
 *   key present + good answer  -> { source: 'gemini',   mission }
 *   anything else at all       -> { source: 'fallback', mission, reason }
 *
 * It never throws and never takes longer than the timeout. `fetch` is injected
 * so the whole decision tree is unit-tested without a network.
 */
import {
  type Mission,
  type MissionRequest,
  MISSION_RESPONSE_SCHEMA,
  WEATHER_MIND_SYSTEM,
  adaptMission,
  buildMissionPrompt,
  fallbackMission,
  sanitizeMissionRequest,
  validateMission,
} from '../core/mission.js';

export interface MissionResponse {
  source: 'gemini' | 'fallback';
  mission: Mission;
  /** Which model answered (gemini only). */
  model?: string;
  /** Why the fallback was used (fallback only). Never contains secrets. */
  reason?: string;
  ms: number;
}

/**
 * Flash models to try, in order. A model that 404s (renamed / retired) is
 * skipped and the next is tried, so a stale model string can never take the
 * Weather Mind down. Override with the GEMINI_MODEL env var.
 */
export const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'] as const;

export const MISSION_TIMEOUT_MS = 8000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface ResolveOptions {
  apiKey?: string;
  /** Preferred model (tried first). */
  model?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
  now?: () => number;
}

function extractText(payload: unknown): string | null {
  const p = payload as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null;
  const parts = p?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  let text = '';
  for (const part of parts) if (typeof part?.text === 'string') text += part.text;
  return text.length > 0 ? text : null;
}

/** Parse model output that should be JSON but may arrive wrapped in a code fence. */
export function parseMissionText(text: string, stage: number): Mission | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return validateMission(JSON.parse(t.slice(a, b + 1)), stage);
  } catch {
    return null;
  }
}

export async function resolveMission(rawRequest: unknown, options: ResolveOptions = {}): Promise<MissionResponse> {
  const now = options.now ?? Date.now;
  const started = now();
  const request: MissionRequest = sanitizeMissionRequest(rawRequest);
  const fallback = (reason: string): MissionResponse => ({
    source: 'fallback',
    mission: adaptMission(fallbackMission(request.stage, request.run + request.losses), request),
    reason,
    ms: now() - started,
  });

  const apiKey = options.apiKey?.trim();
  if (!apiKey) return fallback('no-key');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) return fallback('no-fetch');

  const timeoutMs = options.timeoutMs ?? MISSION_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve('timeout');
    }, timeoutMs);
  });

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: WEATHER_MIND_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: buildMissionPrompt(request) }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: MISSION_RESPONSE_SCHEMA,
    },
  });

  const models = [options.model?.trim(), ...GEMINI_MODELS].filter((m, i, all): m is string => !!m && all.indexOf(m) === i);

  const attempt = async (): Promise<MissionResponse> => {
    let reason = 'no-model';
    for (const model of models) {
      if (timedOut) return fallback('timeout');
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: controller.signal,
        });
      } catch {
        return fallback(timedOut ? 'timeout' : 'network');
      }
      if (res.status === 404) {
        reason = 'model-not-found'; // stale model string: try the next one
        continue;
      }
      if (!res.ok) {
        reason = `http-${res.status}`;
        if (res.status === 429 || res.status >= 500) continue; // busy: another model may answer
        return fallback(reason);
      }
      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        return fallback('bad-json');
      }
      const text = extractText(payload);
      if (text === null) {
        reason = 'empty';
        continue;
      }
      const mission = parseMissionText(text, request.stage);
      if (mission === null) return fallback('invalid-mission');
      return { source: 'gemini', mission, model, ms: now() - started };
    }
    return fallback(reason);
  };

  try {
    const result = await Promise.race([attempt(), deadline]);
    return result === 'timeout' ? fallback('timeout') : result;
  } catch {
    return fallback('error');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
