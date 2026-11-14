# GUST — The Wind Cabinet

**You don't move the seed. You move the air.**

A bell jar on a walnut desk, one lamp, and a landscape 1:30 its real size: two
islands, a dandelion, a seed that has been waiting for weather. Your hands are
the weather. Sweep a palm past the seed and it lifts; cup both hands under it and
it rides the air; clap and the shockwave moves everything in the room, dust
included. Four acts, three to five minutes, hands only.

It runs in a headset (hand tracking or controllers) and in any ordinary browser
with a mouse or a finger. There is no menu and no tutorial text in the headset:
the world speaks, and when a player hesitates a pair of golden ghost hands shows
the next move.

- **Hosted:** _add the deployed URL here_
- **Video:** _add the Devpost video URL here_
- **Engine:** the Immersive Web SDK (`@iwsdk/core`) over three.js, TypeScript
- **Scale:** the diorama is `UNIT = 30` simulation metres per real metre
- **Assets:** no texture or model files. Every surface, every sound and every
  line of music is made in code, except the ten recorded voice lines.

## Playing

| You do | Headset | Mouse / touch | The air does |
| --- | --- | --- | --- |
| Open palm | hold a hand still | rest the pointer | a gentle stream from the palm |
| Sweep | swing a hand | flick the pointer | a gust along the motion |
| Cup both hands | two palms up, together | hold the button / finger | a jet the seed hovers on; lean it to steer |
| Clap | clap | right-click or Space | a shockwave |
| Stir | circle a hand | draw circles | a whirlwind that gathers seeds |

To land the seed, take the jet away: open your hands wide apart (more than about
75 cm) or turn the palms over; on desktop, let go of the button. Controllers held
level count as palms up, so with controllers you let go by spreading or rolling
them.

The four acts: **First Breath** (dawn, one seed, one gap), **The Storm Gate**
(a stone gate that exhales on a rhythm, and a seed you can lose), **The Long
Crossing** (thermals light up like stepping stones) and **Dandelion Burst**
(golden hour, a whole flock; bring 40% home). At the end, the keeper's ledger
writes the run in front of you, in ink.

### URL flags

`?ghost=1` lets the scripted ghost play (a good first look). `?stage=0..3` starts
at an act. `?mute=1` silences audio. `?offline=1` never calls the mission API.
`?reset=1` clears the saved garden and the book. `?quality=0.5` is a lighter
mode. `?perf=1` shows fps, frame ms, draw calls and triangles; `?diag=1` adds the
act, the quality tier, hand status and the time to the first pluck. `?flock=N`,
`?seed=N`, `?speed=N`, `?keeper=NAME` and `?raw=1` (no post chain) are for
testing and captures.

## The Weather Mind

Two layers decide what the sky does.

1. **A realtime director** (`src/core/weatherMind.ts`) runs every physics step in
   the browser. It watches progress, stalls and losses and leans on the weather:
   a struggling player gets a tailwind and a relief thermal, a player who is
   cruising gets a little more menace.
2. **A mission writer** (`api/mission.ts`, `src/server/weatherMind.ts`). Between
   acts the client posts how the last act went to `/api/mission`. If
   `GEMINI_API_KEY` is set, Gemini answers with a structured mission (sky mood,
   wind, turbulence, hazards, cues such as birds, lightning and sunbeams). The
   answer is validated and clamped before the game will use it. With no key, a
   slow answer or a bad answer, a hand-written mission bank is used and the game
   carries on: the endpoint always returns `200` with a valid mission and says
   which source it came from.

AI never touches per-frame gameplay, and the game is complete offline.

## The room has a voice

Ten recorded lines, played from `public/voice` above the room on their own gain,
with the wind and the score ducking under each one. The entry line arrives the
first time a player's hand is tracked in a session. One line per act. A
consolation when a seed is lost, at most once every eighteen seconds. A word for
the first seed home. At the end the ledger writes itself and *then* the room
speaks — the book is written, and the last word.

The music is a celesta figure over a bowed bass, in three modes (dorian for dawn,
natural minor for the storm, lydian for golden hour), scheduled against the audio
clock and following the sky. The reverb is generated at start-up; there is no
sample to load.

## Running it

```bash
npm ci
npm test           # core + systems tests
npx tsc --noEmit
npm run build
npm run ghost      # a scripted headless run, no browser
npm run dev        # IWSDK dev server with the IWER emulator
```

`GEMINI_API_KEY` (no `VITE_` prefix) and optionally `GEMINI_MODEL` go in
`.env.local` or the Vercel project's environment variables. Without them,
`/api/mission` still answers `200` from the offline bank.

Deploying: `vercel.json` builds with Vite and serves `api/mission.ts` as a
function. Any static host plus a single serverless function will do; the client
treats a missing endpoint as "use the offline bank".

## What is where

```
src/core/      pure, headless game: wind, seed, gestures, courses, weather,
               journal, the frame guard. Runs unchanged in Node (see tests/).
src/systems/   the shell: WebXR input, the camera, the room, sound, missions.
src/render/    the cabinet: glass, brass, marks, ink, the lens and its post chain.
src/audio/     procedural room tone, the score, and the recorded voice.
api/           the one serverless function.
docs/          direction, art direction, rules, judge and device scripts, video.
public/voice/  ten recorded lines.
```

## Documents

- [`docs/CABINET_DIRECTION.md`](docs/CABINET_DIRECTION.md) — what this is and why
- [`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md) — the materials, and the failures
- [`docs/JUDGE_FIRST_MINUTE.md`](docs/JUDGE_FIRST_MINUTE.md) — a stopwatch checklist
- [`docs/DEVICE_TEST_SCRIPT.md`](docs/DEVICE_TEST_SCRIPT.md) — 20 minutes on a Quest
- [`docs/VIDEO_STORYBOARD.md`](docs/VIDEO_STORYBOARD.md) — the video, shot by shot
- [`docs/DEVPOST_SUBMISSION.md`](docs/DEVPOST_SUBMISSION.md) — the submission text
- [`docs/COMPETITION_2026.md`](docs/COMPETITION_2026.md) — the rules and the clock

## Licence and privacy

MIT — see [`LICENSE`](LICENSE). Third-party code and its licences are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). What the game sends anywhere,
and what it does not, is in [`PRIVACY.md`](PRIVACY.md).
