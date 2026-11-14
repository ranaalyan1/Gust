# Device test script — a borrowed Quest 3, 20 minutes

Everything in this document is **unverified on hardware** until someone runs it.
The build has been exercised in a headless Chromium and in the IWER emulator; no
frame rate, load time or "works on Quest" claim below has been measured on a
device. That is what this script is for.

Take the notes in a text file as you go — section, what happened, what it cost.
Bring back: the numbers from `?diag=1`, the console lines, and the captures.

---

## Before you put it on (3 min)

1. Headset on the same Wi-Fi as the machine serving the build.
2. Serve over HTTPS (WebXR needs a secure context): `npm run build` then
   `npm run preview` — or the deployed URL.
3. Load the URL on the Quest Browser **once without entering XR**, so the bundle
   is cached, and note the cold start line in the console:
   `[gust] cold start … ms to first frame, … ms to interactive`.
4. Reload with `?diag=1`. The overlay appears top-left.

## Cold start (2 min)

| Check | Pass looks like |
| --- | --- |
| Page paints before the 3D appears | Dark page, then the room fades up |
| Time to first frame | A number in `?diag=1`; write it down |
| Time to interactive | Same overlay; write it down |
| No console errors | No red in the Quest Browser devtools (or `chrome://inspect`) |

## Entering XR (2 min)

1. Tap **Enter VR**.
2. **Hands**: the beacon-bead hands should appear where your hands are — 25
   joints per hand, warm beads with faint bones. If only controllers show, the
   session started in controller mode; put the controllers down and raise your
   hands, the runtime switches.
3. Overlay should now read `hands xr L✓ R✓`.
4. The diorama should sit in front of you, just below eye level, about an arm's
   length away. **If it is too far or too small, write that down** — the seated
   anchor is the one framed for the desktop camera, and its headset distance is
   the number most likely to need a device pass.

## Hands-only full loop (8 min)

Do the whole run with your hands and nothing else. Score each line ✗ / ✓.

| Beat | What to watch |
| --- | --- |
| First line | Plays once, after ~2 s in the session with a tracked hand |
| Sweep | Seed lifts; grass, dust, lamp glow all answer |
| Cupped updraft | Two palms level under the seed lift it |
| Clap | Shockwave rings; dust jumps |
| Whirlwind | Both hands circling under the seed |
| Palm shadow | A soft round shadow under your hand, on the island **and** on the case floor |
| Lost seed | One consoling line, never more than once every 18 s |
| Act change | Sky, score mode and lamp colour all change together |
| Ledger | At the end, the entry writes itself left to right, then the blot |

## Tracking loss and pause (2 min)

1. Mid-flight, drop your hands out of view for **two seconds**: the seed should
   glide on the wind field, not freeze, and recover with no jump when the hands
   come back. Overlay: `re-acquired` increments.
2. Take the headset off for 15 s. Audio must stop; the sim must not run on.
3. Put it back on: no jump, no double-played line, audio resumes in the same bar.

## Frame time (2 min)

Read the overlay's `fps` and `frame ms` in each act. Write down the worst.

- If `tier` climbs to 1 or 2 on its own, the monitor is working (it needs two
  seconds of sustained misses). Note the tier and the numbers.
- If the picture degrades and the tier stays at 0, that is a bug: report it.

## What to capture

1. A screenshot from inside the session with your hand over the island (hands
   visible, palm shadow visible).
2. A screenshot of the ledger mid-write.
3. A 20-second screen recording of one sweep + pluck, for the video b-roll.
4. The `?diag=1` overlay in each act.

## Known gaps, stated plainly

- The cinematic post chain (depth of field, halation, grain) is **bypassed** in
  any immersive session, including the emulator: stereo frames are drawn without
  it. The headset therefore sees tone mapping, lamp falloff, fog and the seed's
  glow, but not the lens. This is a deliberate trade (no extra full-screen passes
  on a mobile GPU) and it is the largest remaining difference between the desktop
  hero frame and the headset.
- No device has run this build yet. Every number in `?diag=1` is available to be
  measured; none is claimed here.
