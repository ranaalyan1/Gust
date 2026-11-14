# Video storyboard — 2:45, hard limit 3:00

The video is judged before anything else is read. It must be **headset footage or
emulator/simulator footage** for the core of the piece (competition rules, see
[`COMPETITION_2026.md`](./COMPETITION_2026.md)); flat desktop frames are allowed
only as clearly labelled b-roll.

Everything below names the capture source and the URL flags. "Emulator" means the
IWER emulator inside the dev server with `?ghost=1` for determinism; "Device"
means a Quest capture from [`DEVICE_TEST_SCRIPT.md`](./DEVICE_TEST_SCRIPT.md).

---

## 0:00–0:12 — the hook

| # | Shot | Source | Flags | What the viewer must feel |
| --- | --- | --- | --- | --- |
| 1 | Black. A click. The lamp comes up over a walnut desk; the room resolves out of the dark | Emulator | `?ghost=1&quality=0.9` | *This is a place, not a demo* |
| 2 | A hand enters from the right, its shadow falls across the tiny world | Device, if available; else emulator with hands mode | `?diag=0` | *I am the weather* |
| 3 | One sweep; the seed lifts off the dandelion; grass, dust and light answer in the same frame | Emulator | `?ghost=1&stage=0` | *The room is alive and it answers me* |

Cut on the pluck. No title yet — the title comes when the viewer has already
believed the image.

## 0:12–0:40 — the premise in one line

- One sentence on screen, lower third: **"You don't move the seed. You move the
  air."** Hold 2 s.
- Hands visible, palm shadow crossing the island (this is the signature image).
- Title card: **GUST — The Wind Cabinet**, keeper's book and brass plaque in
  frame, `1:30 scale` cut into the brass.

## 0:40–1:35 — the verbs

| # | Shot | Source | What it shows |
| --- | --- | --- | --- |
| 5 | Palm stream in slow motion, seed drifting | Emulator, `?stage=0` | The basic gesture |
| 6 | Sweep → gust; wind streaks thicken | Emulator | Speed becomes force |
| 7 | Cupped hands → updraft; seed rises on the thermal | Emulator | The counter-intuitive verb |
| 8 | Clap → shockwave rings, dust jumps | Emulator | Scale of the reaction |
| 9 | Whirlwind, seed orbiting | Emulator | Mastery |

Each shot 8–11 s. Cut on the reaction, never on the gesture.

## 1:35–2:15 — the arc

| # | Shot | Source | What it shows |
| --- | --- | --- | --- |
| 10 | Storm gate: seed lost, room says one consoling line | Emulator `?stage=1` | Failure with dignity |
| 11 | The long crossing; the world slides only half as far as the seed | Emulator `?stage=2` | Design: nothing is a treadmill |
| 12 | Dandelion burst; petals, birds, bloom | Emulator `?stage=3` | Payoff |
| 13 | The score changes mode as the sky does | Emulator | The music is not a loop |

## 2:15–2:45 — the book, the plaque, the URL

| # | Shot | Source | What it shows |
| --- | --- | --- | --- |
| 14 | The ledger writes the entry left to right, the blot pools | Emulator, tight | The last twenty seconds |
| 15 | Plaque catches the lamp; the keeper's name | Emulator, tight | The object is signed |
| 16 | End card: name, one-line tagline, hosted URL | Rendered in-engine (`?ghost=1&end=1`) or typography | Where to go |

Audio: the actual room tone and the actual score from 0:04 onwards. The voice
lines are the game's own recordings — do not re-record them.

---

## Production notes

- **Determinism**: `?ghost=1` drives a scripted player, so a re-take is the same
  take. `?stage=N` starts an act. `?mute=1` when you want to lay your own music
  under a b-roll shot.
- **Post chain**: in an immersive session the cinematic pass is bypassed. Emulator
  captures are therefore *not* identical to the desktop hero frame; do not mix a
  desktop hero still into headset footage without labelling it.
- **No fake UI**: never composite a HUD, cursor or caption into a headset shot
  except the end card and the one-line premise.
- **Length**: 2:45 target; if any shot is cut, cut shot 9 (whirlwind) first.
