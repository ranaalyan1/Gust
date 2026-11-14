# The judge's first minute

A stopwatch checklist for the hosted link. Written to be followed with one hand
while holding a headset in the other. Everything here is observable; nothing here
is a claim about a device we have not measured (see
[`DEVICE_TEST_SCRIPT.md`](./DEVICE_TEST_SCRIPT.md) for what still needs a Quest).

Target: **a naive player lifts the seed within ten seconds of entering XR.**

---

## 0:00 — open the URL

- The page is dark. A lamp is lit above a walnut desk. A bell jar sits on it.
- If nothing appears within **10 s**, the link is broken, not slow: report it.
  The boot guard replaces a failed start with a sentence rather than a blank page.

## 0:00–0:04 — look, do not click

- The room fades up over ~2.5 s: lamp, desk, brass, glass, dust in the light.
- The bell jar holds a small landscape on water. Two islands, a dandelion.
- On a desktop: `Enter XR` sits at the top of the screen. **In a headset the
  session is offered by the browser's own Enter VR control.**
- The first gesture (a click on desktop, a tracked hand in a session) unlocks
  audio and the room speaks its first line.

## 0:04–0:12 — the first sweep

| Time | What happens | What the player should feel |
| --- | --- | --- |
| 0:04 | Room tone, then the first spoken line | *Someone is in the room with me.* |
| 0:05 | The score starts: a celesta, slow, far back | *This was composed, not looped.* |
| 0:06–0:09 | Golden ghost hands fade in **if the player is still** (~3.5 s of stillness) | An invitation that is not a tutorial |
| 0:09 | Sweep a hand across the desk | The seed lifts; grass, dust and light all move at once |
| 0:10 | A heard tick + a puff of seeds | *My hand did that.* |

If the player does nothing for ~6 s the ghost hands return. If they are lost for
a seed and have not found the updraft, the cupped-hands hint returns with one
spoken line — once.

## 0:12–2:00 — the four acts

1. **Canyon (dawn)** — carry the seed to the far island. Wind in the grass.
2. **Tunnel (storm)** — a gate that opens and closes; a downdraft; the seed can
   be lost, and the room says so at most once every 18 s.
3. **Crossing** — the long one. Thermals, and a course that fits in one reach.
4. **Burst (golden hour)** — the last seed, the bloom, the lamp steady.

## End of the run — the last twenty seconds

- The keeper's ledger writes the entry **in front of the player**: the line
  arrives left to right over ~2.6 s, the blot pools when the pen lifts.
- Only then does the room say the book is written, and then the last word.
- The plaque catches the lamp; the case settles.

## Things a judge may ask

| Question | Answer |
| --- | --- |
| Controllers? | Optional. Everything works with tracked hands alone. |
| Seated? | Yes, by design. No locomotion, no roomscale requirement. |
| Timers? | None. Losing a seed costs nothing but a line of consolation. |
| Text or panels in the headset? | None. The world speaks. |
| Internet? | Only the Weather Mind's mission text uses the network; the game is complete offline (`?offline=1`). |

## Flags, for a judge who opens devtools

| Flag | Purpose |
| --- | --- |
| `?ghost=1` | Deterministic cinematic autoplay (the ghost plays) |
| `?stage=0..3` | Start in an act |
| `?quality=0.6` | Lighter rendering for a weak GPU |
| `?mute=1` | Silence |
| `?reset=1` | Clear the garden and the keeper's book |
| `?perf=1` | Live fps, frame ms, draw calls, triangles, shadow casters |
| `?diag=1` | All of the above plus act, tier, hand status, time to first pluck |
