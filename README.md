# GUST

Your hands are the wind. Carry a dandelion seed across a living sky.

GUST is a small WebXR game built on the Immersive Web SDK. A miniature world of
floating islands sits in front of you; a single glowing seed waits on a
dandelion. Sweep a hand past it and it lifts. Cup your hands beneath it and it
rides the air above your palms. Get it to the barren island and the island
blooms. Four short acts, about three to five minutes a run, and every run
plants something permanent in your home garden.

It plays in a headset with hand tracking or controllers, and in any ordinary
browser with a mouse or a finger.

## Playing

| You do | Headset | Mouse / touch | The air does |
| --- | --- | --- | --- |
| Open palm | hold a hand still | rest the pointer | a gentle stream from the palm |
| Sweep | swing a hand | flick the pointer | a gust along the motion |
| Cup both hands | two palms up, together | hold the button / finger | a jet the seed hovers on; lean it to steer |
| Clap | clap | right-click or Space | a shockwave |
| Stir | circle a hand | draw circles | a whirlwind that gathers seeds |

To land the seed, take the jet away: open your hands wide apart (more than
about 75 cm) or turn the palms over; on desktop, let go of the button. Controllers held level count as palms up, so with controllers you let
go by spreading or rolling them.

There is no menu and no tutorial text in the headset: if you hesitate, a pair of
golden ghost hands shows the next move. On desktop a single line of hint text
appears instead.

The four acts: **First Breath** (dawn, one seed, one gap), **The Storm Gate**
(rain, and a stone gate that exhales on a rhythm), **The Long Crossing** (the
storm breaks as you advance and thermals light up like stepping stones) and
**Dandelion Burst** (golden hour, a whole flock; bring 40% home).

### URL flags

`?ghost=1` lets the scripted ghost play (a good first look). `?stage=0..3`
starts at an act. `?mute=1` silences audio. `?offline=1` never calls the
mission API. `?reset=1` clears the saved garden. `?quality=0.5` is a lighter
mode. `?flock=N`, `?seed=N` and `?speed=N` are for testing.

## The Weather Mind

Two layers decide what the sky does.

1. **A realtime director** (`src/core/weatherMind.ts`) runs every physics step
   in the browser. It watches progress, stalls and losses, and leans on the
   weather: a struggling player gets a tailwind and a relief thermal, a player
   who is cruising gets a little more menace.
2. **A mission writer** (`api/mission.ts`, `src/server/weatherMind.ts`). Between
   acts the client posts how the last act went to `/api/mission`. If
   `GEMINI_API_KEY` is set, Gemini answers with a structured mission (sky mood,
   wind, turbulence, hazards, cues such as birds, lightning and sunbeams). The
   answer is validated and clamped before the game will use it. With no key, a
   slow answer or a bad answer, a hand-written mission bank is used and the game
   carries on; the endpoint always returns `200` with a valid mission and says
   which source it came from.

The key is read only on the server. It has no `VITE_` prefix and is never in
the client bundle.

## Running it

Requires Node 22.12 or newer.

```bash
npm install
npx vite            # https://localhost:8081 (self-signed, which WebXR needs)
```

`GUST_HTTP=1 npx vite` serves plain HTTP instead, for hosted previews that
terminate TLS themselves. The dev server also serves `/api/mission`; copy
`.env.example` to `.env.local` and add a key to hear from Gemini locally.

In development the IWSDK emulator is injected, so the **Enter XR** button works
on a desktop browser with an emulated Quest 3.

```bash
npm test            # 124 unit tests of the headless game core
npm run ghost       # the scripted ghost plays a whole run in the terminal
npm run typecheck
npm run build       # production build in dist/
```

## Deploying to Vercel

`vercel.json` is set up: Vite builds to `dist/` and `api/mission.ts` becomes a
serverless function.

1. Import the repository in Vercel, or run `npx vercel deploy --prod`.
2. Optional: add `GEMINI_API_KEY` under Project Settings, Environment Variables.
3. Open `https://<project>.vercel.app/api/mission?stage=1`. `"source":"gemini"`
   means the model answered; `"source":"fallback"` comes with a `reason`.

## How it is put together

```
src/core/      the whole game, headless and deterministic: wind field, seed
               flight, hand verbs, courses, missions, director, garden, ghost
src/render/    low-poly world drawn from that state (sky, islands, foliage,
               seeds, air, light)
src/input/     mouse/touch and WebXR hands or controllers, both reduced to the
               same thing: two palm poses
src/audio/     fully synthesised sound, no audio files
src/systems/   the one IWSDK system that wires it together
src/server/    mission resolver shared by the Vercel function and the dev server
api/           the Vercel function
tests/         unit tests for the core and the resolver
scripts/       headless ghost play-through
```

Everything the player touches is one physical model. A hand, a mouse, a
controller and the ghost all produce palm poses; palm poses become wind
sources; the seed is a point mass with drag in that wind. There are no
scripted trajectories.

The world is drawn at 1:7 and placed within arm's reach. There are no texture
or model files: every island, plant and sound is generated at load.
