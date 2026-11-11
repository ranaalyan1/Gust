/**
 * MISSIONS — the contract between the Weather Mind and the world.
 *
 * A mission is a tiny structured document describing the next stretch of sky.
 * It can come from Gemini (through the serverless proxy) or from the
 * hand-written bank below; the game cannot tell the difference and never has
 * to: everything is validated, clamped and coerced here before it is used.
 *
 * This module is pure and is shared by the client, the serverless function
 * and the tests.
 */

export type SkyMood = 'dawn' | 'storm' | 'golden';

export const SKY_MOODS: readonly SkyMood[] = ['dawn', 'storm', 'golden'];

/** Things the sky can do TO the player. */
export const HAZARDS = ['downdraft', 'crosswind', 'rain', 'gustFront', 'lightning', 'fog'] as const;
export type Hazard = (typeof HAZARDS)[number];

/**
 * Things the sky can SAY to the player. The narrative beat is never shown as
 * text: it is acted out by the world through these cues.
 */
export const CUES = [
  'birds_guide',
  'birds_scatter',
  'clouds_gather',
  'clouds_part',
  'sunbeam',
  'lightning',
  'rain_swell',
  'rain_ease',
  'wind_hush',
  'petals',
  'fireflies',
] as const;
export type Cue = (typeof CUES)[number];

export interface Mission {
  name: string;
  skyMood: SkyMood;
  /** 0..1 strength of the prevailing wind. */
  ambientWind: number;
  /** 0..1 roughness of the air. */
  turbulence: number;
  /** 0..5 rising columns placed along the gap. */
  thermalCount: number;
  hazards: Hazard[];
  /** One sentence of intent. For logs and the director's eyes only. */
  narrativeBeat: string;
  /** How the world performs the beat. */
  cues: Cue[];
}

/** The four stages of a run. */
export const STAGES = ['canyon', 'tunnel', 'crossing', 'burst'] as const;
export type StageKind = (typeof STAGES)[number];
export const STAGE_COUNT = STAGES.length;

/** The three-act arc is fixed: the AI shapes the weather inside an act, never the act itself. */
export const STAGE_MOOD: Record<StageKind, SkyMood> = {
  canyon: 'dawn',
  tunnel: 'storm',
  crossing: 'storm', // the storm breaks DURING the crossing; the world clears as the seed advances
  burst: 'golden',
};

/** What the game tells the Weather Mind about the player before asking for the next mission. */
export interface MissionRequest {
  /** Stage the mission is FOR (0 canyon, 1 tunnel, 2 crossing, 3 burst). */
  stage: number;
  /** Completed runs so far. */
  run: number;
  /** Seeds lost during the stage just played. */
  losses: number;
  /** Seconds the stage just played took. */
  clearTime: number;
  /** 0..1 how comfortably the player is flying. */
  mastery: number;
  /** 0..1 how much help the sky had to give. */
  struggle: number;
  /** Plants in the persistent garden. */
  gardenSize: number;
  /** Name of the mission just played, so the next one can answer it. */
  previous: string;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function sanitizeMissionRequest(raw: unknown): MissionRequest {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    stage: clampN(Math.round(num(r.stage, 0)), 0, STAGE_COUNT - 1),
    run: clampN(Math.round(num(r.run, 0)), 0, 9999),
    losses: clampN(Math.round(num(r.losses, 0)), 0, 99),
    clearTime: clampN(num(r.clearTime, 0), 0, 3600),
    mastery: clampN(num(r.mastery, 0.5), 0, 1),
    struggle: clampN(num(r.struggle, 0), 0, 1),
    gardenSize: clampN(Math.round(num(r.gardenSize, 0)), 0, 9999),
    previous: typeof r.previous === 'string' ? r.previous.replace(/[^\w '\-]/g, '').slice(0, 60) : '',
  };
}

const MAX_NAME = 48;
const MAX_BEAT = 220;

/** Infer performance cues from the prose when the model forgot to list any. */
export function cuesFromBeat(beat: string): Cue[] {
  const t = beat.toLowerCase();
  const cues: Cue[] = [];
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (has('bird', 'swallow', 'flock', 'wing')) cues.push(has('scatter', 'flee', 'startle') ? 'birds_scatter' : 'birds_guide');
  if (has('lightning', 'thunder', 'flash')) cues.push('lightning');
  if (has('cloud')) cues.push(has('part', 'open', 'break', 'clear', 'lift') ? 'clouds_part' : 'clouds_gather');
  if (has('sunbeam', 'sun ', 'light ', 'ray', 'glow', 'golden')) cues.push('sunbeam');
  if (has('rain', 'downpour', 'drizzle')) cues.push(has('ease', 'stop', 'thin', 'fade', 'soften') ? 'rain_ease' : 'rain_swell');
  if (has('hush', 'still', 'quiet', 'calm', 'silence')) cues.push('wind_hush');
  if (has('petal', 'blossom')) cues.push('petals');
  if (has('firefl', 'spark', 'ember')) cues.push('fireflies');
  return cues.slice(0, 4);
}

/**
 * Validate and normalise anything that claims to be a mission.
 * Returns null when the shape is unusable; otherwise a mission that is safe to
 * build a world from: every number clamped, every enum checked, mood coerced
 * to the act the stage belongs to.
 */
export function validateMission(raw: unknown, stage: number): Mission | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.trim().length === 0) return null;
  if (typeof r.ambientWind !== 'number' || !Number.isFinite(r.ambientWind)) return null;
  if (typeof r.turbulence !== 'number' || !Number.isFinite(r.turbulence)) return null;
  if (typeof r.thermalCount !== 'number' || !Number.isFinite(r.thermalCount)) return null;
  if (typeof r.skyMood !== 'string' || !SKY_MOODS.includes(r.skyMood as SkyMood)) return null;

  const kind = STAGES[clampN(Math.round(stage), 0, STAGE_COUNT - 1)];
  const hazards: Hazard[] = [];
  if (Array.isArray(r.hazards)) {
    for (const h of r.hazards) {
      if (typeof h === 'string' && (HAZARDS as readonly string[]).includes(h) && !hazards.includes(h as Hazard)) {
        hazards.push(h as Hazard);
      }
    }
  }
  const beat = typeof r.narrativeBeat === 'string' ? r.narrativeBeat.replace(/\s+/g, ' ').trim().slice(0, MAX_BEAT) : '';
  let cues: Cue[] = [];
  if (Array.isArray(r.cues)) {
    for (const c of r.cues) {
      if (typeof c === 'string' && (CUES as readonly string[]).includes(c) && !cues.includes(c as Cue)) {
        cues.push(c as Cue);
      }
    }
  }
  if (cues.length === 0) cues = cuesFromBeat(beat);

  return {
    name: r.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME),
    skyMood: STAGE_MOOD[kind], // the arc is not negotiable
    ambientWind: clampN(r.ambientWind, 0, 1),
    turbulence: clampN(r.turbulence, 0, 1),
    thermalCount: clampN(Math.round(r.thermalCount), 0, 5),
    hazards: hazards.slice(0, 4),
    narrativeBeat: beat,
    cues: cues.slice(0, 4),
  };
}

// ── the fallback bank: hand-written, always available, fully offline ─────────

const m = (
  name: string,
  skyMood: SkyMood,
  ambientWind: number,
  turbulence: number,
  thermalCount: number,
  hazards: Hazard[],
  narrativeBeat: string,
  cues: Cue[],
): Mission => ({ name, skyMood, ambientWind, turbulence, thermalCount, hazards, narrativeBeat, cues });

/** Two hand-written missions per stage. Index [stage][variant]. */
export const FALLBACK_MISSIONS: readonly (readonly Mission[])[] = [
  [
    m('First Breath', 'dawn', 0.15, 0.1, 0, ['downdraft'],
      'Dawn holds its breath over the canyon; swallows trace the way across and wait.',
      ['birds_guide', 'wind_hush']),
    m('The Quiet Canyon', 'dawn', 0.25, 0.2, 1, ['downdraft', 'fog'],
      'Mist pools in the canyon while one warm column of light marks the safe air.',
      ['sunbeam', 'birds_guide']),
  ],
  [
    m('The Storm Gate', 'storm', 0.6, 0.45, 0, ['rain', 'gustFront', 'lightning'],
      'Clouds slam shut and the tunnel starts to breathe; lightning counts the beats between gusts.',
      ['clouds_gather', 'lightning', 'rain_swell']),
    m('Throat of Thunder', 'storm', 0.75, 0.55, 0, ['rain', 'gustFront', 'lightning', 'crosswind'],
      'The gate howls like a flute; birds scatter and the rain leans sideways.',
      ['birds_scatter', 'lightning', 'rain_swell']),
  ],
  [
    m('The Long Crossing', 'storm', 0.5, 0.4, 3, ['crosswind', 'rain'],
      'The storm tires. Each thermal that ignites tears a little more gold into the clouds.',
      ['clouds_part', 'rain_ease', 'sunbeam']),
    m('Between Two Hands', 'storm', 0.6, 0.5, 2, ['crosswind', 'rain', 'gustFront'],
      'Crosswinds shear the open sky; only a channel held from both sides stays calm.',
      ['clouds_part', 'rain_ease', 'birds_guide']),
  ],
  [
    m('Dandelion Burst', 'golden', 0.2, 0.25, 4, [],
      'Golden hour. The air stands up in warm pillars and the whole sky leans toward home.',
      ['sunbeam', 'fireflies', 'birds_guide']),
    m('A Sky Full of Wishes', 'golden', 0.3, 0.3, 5, ['crosswind'],
      'Thermals bloom like lanterns and petals ride them upward, showing every seed the road.',
      ['petals', 'sunbeam', 'fireflies']),
  ],
];

/** A mission that is always there. Deterministic in (stage, variant). */
export function fallbackMission(stage: number, variant = 0): Mission {
  const s = clampN(Math.round(num(stage, 0)), 0, STAGE_COUNT - 1);
  const bank = FALLBACK_MISSIONS[s];
  const pick = bank[((Math.round(num(variant, 0)) % bank.length) + bank.length) % bank.length];
  return { ...pick, hazards: [...pick.hazards], cues: [...pick.cues] };
}

/**
 * The fallback bank still listens to the player: struggling softens the
 * weather, mastery sharpens it. (The same adaptation Gemini is asked to make.)
 */
export function adaptMission(mission: Mission, request: MissionRequest): Mission {
  const ease = request.struggle * 0.5 + Math.min(request.losses, 4) * 0.08;
  const push = request.mastery * 0.35 + Math.min(request.run, 5) * 0.04;
  const delta = push - ease;
  return {
    ...mission,
    hazards: [...mission.hazards],
    cues: [...mission.cues],
    ambientWind: clampN(mission.ambientWind + delta * 0.5, 0, 1),
    turbulence: clampN(mission.turbulence + delta * 0.5, 0, 1),
    thermalCount: clampN(Math.round(mission.thermalCount + (ease > push + 0.15 ? 1 : 0)), 0, 5),
  };
}

// ── Gemini request shaping (used by api/mission.ts) ──────────────────────────

/** JSON schema handed to Gemini as `responseSchema`, so the reply is structured by construction. */
export const MISSION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'Evocative 2-4 word title.' },
    skyMood: { type: 'STRING', enum: [...SKY_MOODS] },
    ambientWind: { type: 'NUMBER', description: '0..1 prevailing wind strength.' },
    turbulence: { type: 'NUMBER', description: '0..1 roughness of the air.' },
    thermalCount: { type: 'INTEGER', description: '0..5 rising columns of warm air that help the player.' },
    hazards: { type: 'ARRAY', items: { type: 'STRING', enum: [...HAZARDS] } },
    narrativeBeat: {
      type: 'STRING',
      description: 'One sentence describing what the SKY does. It is performed by light, birds, clouds and rain, never shown as text.',
    },
    cues: {
      type: 'ARRAY',
      description: '1-4 stage directions the world performs to act out the narrative beat.',
      items: { type: 'STRING', enum: [...CUES] },
    },
  },
  required: ['name', 'skyMood', 'ambientWind', 'turbulence', 'thermalCount', 'hazards', 'narrativeBeat', 'cues'],
} as const;

const STAGE_BRIEF: Record<StageKind, string> = {
  canyon:
    'ACT 1, DAWN. A canyon between two floating islands. The player is learning that cupping both palms upward raises an updraft. Keep it calm and generous.',
  tunnel:
    'ACT 2, THE STORM. A rain-lashed stone tunnel that "breathes" hostile back-drafts on a rhythm; the player must time gusts between them. This is the hardest moment of the arc.',
  crossing:
    'ACT 2 BREAKING INTO ACT 3. A long open crossing with crosswinds. The storm clears as the seed advances and thermals ignite one by one. Tension resolving into relief.',
  burst:
    'ACT 3, GOLDEN HOUR — THE FINALE. A dandelion releases a whole flock of seeds; thermals carry them home and the island blooms. Awe, warmth, generosity.',
};

/** The system instruction: who the Weather Mind is. */
export const WEATHER_MIND_SYSTEM = [
  'You are the Weather Mind of GUST: the sky of a tiny floating world.',
  'A player moves a glowing dandelion seed using only the wind made by their hands. They can never touch it.',
  'You are not a narrator and never speak to the player. You ARE the weather: you shape the next stretch of sky.',
  'Read how the player is doing and answer with intent: if they struggled, be kinder (calmer air, more thermals, fewer hazards);',
  'if they flew with mastery, test them (more wind, more turbulence, sharper hazards). Never be cruel; never be boring.',
  'Reply with JSON only, matching the schema.',
].join(' ');

/** The per-request prompt: the stage brief plus what the sky has observed. */
export function buildMissionPrompt(request: MissionRequest): string {
  const kind = STAGES[request.stage];
  const lines = [
    STAGE_BRIEF[kind],
    `Required skyMood for this stage: "${STAGE_MOOD[kind]}".`,
    '',
    'What you observed in the stage the player just finished:',
    `- seeds lost: ${request.losses}`,
    `- time taken: ${Math.round(request.clearTime)} s`,
    `- mastery (0 clumsy .. 1 graceful): ${request.mastery.toFixed(2)}`,
    `- help you had to give (0 none .. 1 a lot): ${request.struggle.toFixed(2)}`,
    `- completed journeys: ${request.run}, plants in their garden: ${request.gardenSize}`,
    request.previous ? `- the previous mission was called "${request.previous}"; answer it, do not repeat it` : '',
    '',
    'Design the next mission. ambientWind and turbulence are 0..1. thermalCount is 0..5 (thermals HELP the player).',
    'hazards may include: ' + HAZARDS.join(', ') + '.',
    'narrativeBeat: ONE vivid sentence about what the sky does. cues: 1-4 stage directions from: ' + CUES.join(', ') + '.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
