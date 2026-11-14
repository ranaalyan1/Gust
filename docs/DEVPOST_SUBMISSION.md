# Devpost submission — paste-ready

Every claim below is true of this repository at the commit it was written. Where
something has not been measured, it says so. Fields marked **_TBD by the
entrant_** are the only things a person can fill in (URLs, name, dates).

---

## Name

**GUST — The Wind Cabinet**

## Tagline (140 characters max)

> You don't move the seed. You move the air. A 1:30 diorama under a bell jar
> where your hands are the weather. Hands-only WebXR.

_Count: 139 including spaces._

## Track — recommendation

**Primary: Gaming.** The piece is a game: wind as an input, a course to cross,
seeds to land, four acts, a run that ends and is recorded. The judging criteria
(innovation, experience design, technical implementation, polish) are equally
weighted, and this text is written to all four rather than to one.

**Division: New Experience — confirmed by the owner** (16 Nov 2026). The owner has
reviewed the project's history and the division's definition and has made the call;
this document follows it. For the record, so the claim rests on something true:
the cabinet as submitted is a new experience *of the game* — the room, the 1:30
specimen scale under the bell jar, the hands-as-wind model, the keeper's book and
garden, the recorded voice and the composed score are all this entry's work, and
the earlier prototype shared the premise but not the experience. The owner is
accountable for how the division reads against the rules; nobody else should
restate this as an independent finding.

If the form asks for the division: **New Experience**. Track: **Gaming**.

## Inspiration

I wanted a tabletop diorama you could reach into, and I wanted the player's body
to be the mechanic rather than the cursor. Wind is the oldest thing in the world
that is invisible and undeniable, and a dandelion seed is the smallest thing that
can be carried by it. Everything else followed from those two facts: a room with
one lamp, a bell jar, and a landscape small enough that a hand crossing it is
weather.

The strongest image in the game is not the seed. It is the shadow of your own
hand falling across the islands while you move them.

## What it is

A 1:30 specimen diorama on a walnut desk: two islands, a dandelion, and a seed
waiting for weather. Tracked hands — no controllers needed — make five kinds of
air:

- **palm stream** — still palms push a steady current;
- **sweep** — a swinging hand makes a gust;
- **cupped updraft** — two palms level under the seed make a jet it can hover on;
- **clap** — a shockwave that moves everything in the room, dust included;
- **whirlwind** — a circling hand gathers seeds.

Four acts, three to five minutes, one continuous take: dawn, the storm gate, the
long crossing, the dandelion burst. At the end the keeper's ledger writes your run
in front of you, in ink, and the room says the book is written.

## Why this has to be hands (and not a controller)

A controller gives you a cursor with a position. Wind is not a cursor: it is
direction, speed, spread and the shape of the thing making it. On a hand you get
all four for free — the palm's facing sets the direction, the swing sets the speed,
how far the fingers are spread sets the width of the stream, and how fast you stop
sets the gust. None of that needs to be explained, because everyone already knows
how a hand moves air.

The second reason is the picture. In a session the player's own shadow falls across
the islands as their hand passes over the case. That image — a hand, a shadow, and a
tiny world that leans away from it — is only possible with hands. With a controller
you would see a plastic wand and a cursor ring.

The game is still playable with controllers and with a mouse or a finger, and the
whole gesture set has a pointer equivalent. Hands are not a gate; they are the
reason the piece exists.

## How it was built

TypeScript on the **Immersive Web SDK** over three.js, rendered with WebGL 2 and
WebXR. No 3D models, no textures, no audio samples: every surface (walnut,
brass, glass, ink, paper), every sound (wind, thunder, the seed's whisper) and
every line of the score (a celesta over a bowed bass in three modes) is generated
by code at run time. The one exception is ten recorded voice lines for the Weather
Mind, which are AI-generated narration.

The architecture is deliberately split:

- `src/core` is pure TypeScript — wind field, seed physics, gesture recognition,
  course generation, the mission schema, the journal — and runs unchanged in Node,
  which is how the whole game is tested headlessly (163 tests) and how a scripted
  "ghost" plays a complete run in CI without a browser.
- `src/systems` is the thin shell that adapts the core to WebXR: tracked hands,
  fixed-step time, the camera, the room, the audio graph, the mission requests.

AI is used where it cannot touch the frame: between acts, the client posts an
anonymous summary of the last act to a serverless function, which asks Gemini for
the next mission in a fixed JSON schema. The answer is validated and clamped, and
if anything at all is wrong — no key, no network, a bad answer — a hand-written
mission bank is used and the game carries on. The Weather Mind's realtime half,
which reacts to the player during play, is deterministic code, not a model.

## Challenges

**The world got smaller three times.** At 1:7 the course was a metre wide and read
as a playset. At 1:18 it was a vitrine. At 1:30 it is 24 cm and fits under a bell
jar on a desk — which is the only scale at which it reads as a specimen rather
than a toy.

**The lens effect is a hand-written post chain.** Depth of field, halation, filmic
tone mapping and grain were written by hand on three's EffectComposer because the
stock passes looked like a video game filter. That chain is bypassed inside an
immersive session — fewer full-screen passes on a mobile GPU — which is an honest
gap between the promotional frame and the headset.

**Hands have to be drawn.** A comment in the shell claimed the headset renders the
player's real hands. It does not: an immersive session gives joint poses and never
composites hands into the app's frame. The failure was invisible on a desktop and
obvious the first time the game was run in an emulator with hand tracking. The
fix is 25 joints drawn as soft beads with faint bones — two draw calls per hand,
additive, depth-write off, so it can never z-fight the diorama.

**The voice.** Browser speech synthesis is a caption read aloud, and it would have
undone a room that was made by hand. The lines are recorded instead, played on
their own gain, with the wind and the score ducking under each one so the sentence
lands in a hole in the sound.

## What is still wrong (honestly)

- **No device measurements yet, and no public deployment yet.** Both are the
  remaining blockers; see `docs/COMPETITION_FINAL_CHECKLIST.md`. The build has been exercised in a headless Chromium
  and in the IWER emulator; no frame rate on a Quest has been claimed anywhere in
  this submission. `?diag=1` exists so the first person with a headset can produce
  those numbers in one session.
- The post chain does not run in a session, so the headset sees a flatter image
  than the desktop hero frame.
- The seated anchor distance in a session is framed for the desktop camera; it may
  want one device pass to tune.
- Full geometry, materials and audio synthesis are procedurally generated, which
  means they cannot be art-directed by an artist in a DCC tool — only in code.

## Accessibility (only what is real)

- **Seated by design.** No locomotion, no room-scale requirement.
- **No timers.** Nothing punishes hesitation; a lost seed costs one line of
  consolation.
- **Hands or controllers**, and a mouse or a finger on a desktop. The whole game
  is playable without a single controller.
- **Redundant cues**: every gesture has a visual and an audible answer, and the
  teaching is a pair of ghost hands rather than a wall of text.

## Future plans

- A native Meta Quest port (the core is already pure TypeScript with parity tests,
  and `unity/` holds the skeleton for it).
- Meta Ray-Ban Display / glasses-style surfaces, where a 24 cm diorama in front of
  a seated player is the right size for the medium.
- A daily sky: the same course for everyone on a given day, recorded in the
  keeper's book as the day's bearing. No streaks, no guilt.
- More keepers: the ledger already remembers previous owners, and one hidden line
  is written in the previous keeper's hand after a player's first completed run.

## Built with

TypeScript, WebXR, three.js, Immersive Web SDK (IWSDK), Vite, Vitest, Web Audio
API, Vercel serverless functions, Google Gemini (mission text only).

## Links to fill in

- **_TBD by the entrant_** — hosted URL
- **_TBD by the entrant_** — video URL (≤ 3:00)
- **_TBD by the entrant_** — repository URL
- **_TBD by the entrant_** — entrant name / team
- Launch date: **_TBD by the entrant_** — confirm before submitting; the game is
  playable today, so "live at submission" is defensible only once the hosted URL
  actually answers.
