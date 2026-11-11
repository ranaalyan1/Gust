/**
 * /api/mission — the Weather Mind's voice.
 *
 * Vercel serverless function. The browser never sees the Gemini key: it lives
 * only in the GEMINI_API_KEY environment variable (Vercel env / .env.local),
 * with no VITE_ prefix, so it can never be bundled into client code.
 *
 * Always answers 200 with a valid mission. `source` is "gemini" when the model
 * answered and "fallback" when the hand-written bank did.
 */
import { resolveMission } from '../src/server/weatherMind.js';

interface Req {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
  end(): unknown;
}

export const config = { maxDuration: 15 };

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  let input: unknown = {};
  try {
    if (req.method === 'POST') {
      input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    } else if (req.query) {
      // GET /api/mission?stage=1 — handy for checking the deployment from a browser
      const q: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(req.query)) {
        const s = Array.isArray(v) ? v[0] : v;
        q[k] = k === 'previous' ? s : Number(s);
      }
      input = q;
    }
  } catch {
    input = {};
  }
  try {
    const result = await resolveMission(input, {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
    });
    res.status(200).json(result);
  } catch {
    // unreachable by construction, but the deployed link must never show an error
    const result = await resolveMission(input, {});
    res.status(200).json(result);
  }
}
