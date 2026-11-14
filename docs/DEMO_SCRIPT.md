# Demo video — 2:40

A shot list for the submission video. **All footage must be the real running
application** — headset or XR emulator for the core of it, with any flat-screen
frames clearly labelled. Do not composite hands, gestures or frame rates that were
not recorded. Do not use the scripted ghost run as evidence of hand interaction;
it is fine as a *camera*, never as proof of a player.

Engine flags that make a re-take identical: `?ghost=1` (scripted player),
`?stage=0..3` (start in an act), `?quality=0.9` (captures), `?mute=1` (silent
b-roll), `?diag=1` (numbers on screen — **avoid in the final cut**, use it only
when the piece is about performance).

---

## 0:00–0:15 · The cabinet, and the seed that is waiting

| Shot | Source | What must be seen |
| --- | --- | --- |
| 1 | Emulator, `?ghost=1&quality=0.9` | Black. A click. The lamp comes up over the walnut desk; brass, glass, dust in the light |
| 2 | Same take, push in | The bell jar, the two islands, the dandelion, one seed hanging on it |

**Voice under:** the game's own `entry` line (4.95 s). No narration over it.
**Text on screen (lower third, 3 s):** *"Your hands are the wind. You don't move
the seed — you change the air."*

## 0:15–0:45 · The sweep makes real airflow

| Shot | Source | What must be seen |
| --- | --- | --- |
| 3 | Device or emulator with hands, `?diag=0` | A hand enters frame; its **shadow** crosses the island before the hand does |
| 4 | Same | The sweep; wind streaks thicken; grass bends; dust lifts at the palm |
| 5 | Same, slow to 50% | The seed comes off the dandelion. This is the hook — hold it |

**Do not** cut on the gesture. Cut on the room's answer.

## 0:45–1:15 · Cupped hands lift and steer

| Shot | Source | What must be seen |
| --- | --- | --- |
| 6 | Hands capture | Two palms level under the seed; a thermal column; the seed hovers |
| 7 | Same | Steering: the seed leans with the palms; the world slides only half as far as the seed |
| 8 | Same, tight | The seed's glow rolling across the brass ring of the case |

**Voice under:** an `s0`–`s2` act line, once. Let the score be audible under it —
this is the shot where a viewer should hear that the music is composed.

## 1:15–1:45 · A harder stage, and the Weather Mind answering

| Shot | Source | What must be seen |
| --- | --- | --- |
| 9 | `?stage=1` | The storm gate breathing; the seed lost once; the lamp guttering |
| 10 | Same | The consolation line (`lost`), and the recovery — a thermal opening where there was none |

The honest sentence for this section: the Weather Mind's *in-play* half is
deterministic code that leans on the weather when a player struggles; the Gemini
half writes the next stage's mission between acts and is validated before use. Do
not say "AI generates the weather in real time".

## 1:45–2:15 · Landing, bloom, the last seed

| Shot | Source | What must be seen |
| --- | --- | --- |
| 11 | `?stage=3` | The final seed burst; petals, birds, the island blooming |
| 12 | Same | The lamp steady, the case at golden hour, the score in its lydian mode |

## 2:15–2:40 · The book, and the garden that remembers

| Shot | Source | What must be seen |
| --- | --- | --- |
| 13 | Tight on the ledger | The entry **writing itself** left to right (2.6 s), the blot pooling when the pen lifts |
| 14 | Same frame | The `written` line, then `close` — the room's last word |
| 15 | The plaque and the book together | The keeper's name cut in brass; the page beneath it |
| 16 | End card (render it, do not fake gameplay) | `GUST — The Wind Cabinet`, one line, the hosted URL |

---

## Production rules

- **Capture source per shot is mandatory.** Headset or emulator for the core;
  a desktop still may appear only as labelled b-roll.
- **No fake hands.** If the capture has no tracked hands, the shot has no hands.
- **One line at a time.** The game ducks wind and music under every voice line;
  cutting a line mid-word to fit the length would misrepresent the audio.
- **Colour and grade:** use what the game renders. The lens (depth of field,
  halation, grain) is bypassed inside a session, so emulator and device frames do
  not match a desktop still — do not mix them in one sequence.
- **Length:** 2:40 target, 3:00 hard stop. If time must be cut, drop shot 8
  (the glow) first, then shot 12.
- **Sound:** master the video around the game's own mix. Do not add music.

## What the viewer should be able to say afterwards

*"The seed moved because of the air their hands made, and the room noticed."*
