# Competition final checklist

Status of the release as it stands on branch `arena/7c31f15c-gust`.
Every line here was produced by running something; nothing is inferred from
documentation. Where a check needs hardware, a key or an account that this
environment does not have, it says so instead of guessing.

Statuses: **VERIFIED** (observed here), **NOT VERIFIED** (no evidence yet),
**BLOCKED** (needs something outside this workspace), **NOT APPLICABLE**.

---

## 1. Build and test baseline

| Check | Command | Result | Status |
| --- | --- | --- | --- |
| Install | `npm ci` | completes; npm reports audit advisories in transitive dev dependencies | VERIFIED |
| Tests | `npm test` | **168 passed, 14 files** (8.0–10.2 s) | VERIFIED |
| Types | `npm run typecheck` | `tsc --noEmit`, exit 0 | VERIFIED |
| Build | `npm run build` | built in ~9–12 s; entry **2,267.86 kB (615.75 kB gzip)**, `worker` 201.88 kB (64.69 gzip), no MSDF worker | VERIFIED |
| Headless playthrough | `npm run ghost` | four stages clear, **run complete at 87.9 s** | VERIFIED |
| Whitespace | `git diff --check` | clean | VERIFIED |

## 2. Deployment and hosting

| Check | Result | Status |
| --- | --- | --- |
| `vercel.json` present with the mission function | present (`api/mission.ts`, `maxDuration: 15`) | VERIFIED (config only) |
| Public HTTPS URL reachable without auth | **no URL exists** | BLOCKED — owner must deploy |
| WebXR entry flow on the deployed origin | secure context required; cannot be tested without the deployment | BLOCKED |
| `/api/mission` on the deployed function | not deployed | BLOCKED |

Deploy commands for the owner:

```bash
npm ci && npm run build
npx vercel link            # project: gust
npx vercel env add GEMINI_API_KEY production   # server-side only, no VITE_ prefix
npx vercel --prod
curl -s "https://<deployment>/api/mission?stage=1" | head -c 200   # expect {"source":"gemini",...}
```

## 3. Hands-first experience

Verified in the **IWER emulator** (`IWER_DEVICE.primaryInputMode = 'hand'`), inside
an immersive session, reading live state — not from screenshots.

| Check | Evidence | Status |
| --- | --- | --- |
| XR session enters and presents | `renderer.xr.isPresenting === true` | VERIFIED (emulator) |
| Both hands tracked as hands, not controllers | 25/25 joints valid per hand, `isHand: true`, `live: [true,true]` | VERIFIED (emulator) |
| Joints reach the game core | `game.hands.energy` 1.05–10.9 and both `streams.enabled` from a static emulated hand | VERIFIED (emulator) |
| Hand visuals drawn in the session | `handViews[*].group.visible === true`; capture `handmode.png` | VERIFIED (emulator) |
| Palm shadow drawn in the session | shadow mesh visible, opacity ≈0.35 | VERIFIED (emulator) |
| Tracking loss and reacquisition | `handReacquired` increments across input-mode switches; no page errors | VERIFIED (emulator) |
| Open palm, sweep, cupped updraft, clap, whirlwind **as real gestures** | gesture maths is unit-tested with synthetic samples; the emulator's hand is a static pose, so no sweep can be performed here and **no pluck was observed in XR** | NOT VERIFIED |
| Complete hands-only journey, first sweep to bloom | needs a moving tracked hand | NOT VERIFIED — run `docs/DEVICE_TEST_SCRIPT.md` |
| Left- and right-hand independently | both hands tracked; per-hand gestures not exercised | PARTIAL |
| Controller fallback | controller path present and used by the emulator's default mode | VERIFIED (emulator) |

## 4. Opening and teaching

| Check | Result | Status |
| --- | --- | --- |
| Room fades up out of black | 2.8 s exposure ramp implemented; not captured (software rendering boots slower than the ramp) | IMPLEMENTED, NOT CAPTURED |
| Entry line fires on first tracked hand in XR | `spokeEntry === true` after entering XR with hand input | VERIFIED (emulator) |
| Entry line respects the gesture/audio-unlock rules | audio context created on first gesture or session start | VERIFIED |
| Ghost hands after ~3.5 s of stillness | threshold 3.5 s (9 s after a first pluck) | VERIFIED (code + earlier captures) |
| `hint` line plays once, with the first ghost hands | wired at the first hint, guarded by `!audio.speaking` so it cannot cut the entry line | VERIFIED (code path) |
| No tutorial text or panels in the headset | desktop-only hint line; no headset UI | VERIFIED |

## 5. Weather Mind

| Check | Command / evidence | Status |
| --- | --- | --- |
| No key → valid fallback | `GET /api/mission?stage=1` → **200**, `source:"fallback"`, `reason:"no-key"`, full mission | VERIFIED |
| Key present but request fails → valid fallback | `GEMINI_API_KEY=<fake>` → **200**, `source:"fallback"`, `reason:"network"`, `ms:27` | VERIFIED |
| Invalid model output, timeout, API error → fallback | covered by unit tests with injected `fetch` (`tests/server.test.ts`, 9 tests) | VERIFIED (unit) |
| Live Gemini answer (`source:"gemini"`) | no real key, and this sandbox cannot reach Google's API; the gemini path is unit-tested only | NOT VERIFIED |
| Key never in the client bundle | `grep -rl "GEMINI_API_KEY\|<key>" dist/` → nothing | VERIFIED |
| Key never logged | server log contains no key material | VERIFIED |
| Local director adapts difficulty in-play | `src/core/weatherMind.ts`, deterministic, covered by core tests | VERIFIED (unit) |

**Do not advertise live Gemini generation until a deployed call returns
`"source":"gemini"`.**

## 6. Persistence

| Check | Evidence | Status |
| --- | --- | --- |
| Completing a run changes the garden | `garden.runs` 0 → 1, plants written to `gust.garden.v1` | VERIFIED |
| Completing a run appends to the ledger | journal entries 9 → 10; newest `{day, seeds:7, bearing:90, course:"Dandelion Burst"}` | VERIFIED |
| Garden survives reload | after reload `runs: 1`, plants present | VERIFIED |
| Ledger survives reload | after reload 10 entries, newest intact, keeper inscription intact | VERIFIED |
| `?reset=1` clears both | `runs: 0`, entries back to the seeded 9, `localStorage` keys removed | VERIFIED |
| Corrupt storage is handled | `parseGarden` / `parseJournal` guards, covered by `tests/journal.test.ts` | VERIFIED (unit) |
| No streaks, scarcity or nudges | none in the code | NOT APPLICABLE |

## 7. Performance

| Check | Evidence | Status |
| --- | --- | --- |
| Bundle size | 615.75 kB gzip entry + 64.69 kB worker | VERIFIED |
| Old MSDF font worker removed | no `msdf-worker` chunk in `dist` | VERIFIED |
| Desktop cold start (software renderer) | 8.5–11.2 s to first frame, 6.9 s to interactive, in headless SwiftShader | MEASURED, NOT REPRESENTATIVE |
| JS memory over a run | heap 188 MB before and after a fast-forwarded run | VERIFIED (desktop) |
| XR frame stability | **not measured**; the only in-session numbers come from a software renderer (12–34 fps, 29–85 ms) | NOT VERIFIED |
| ≥60 fps on Quest 3 | no device available | NOT VERIFIED |
| Shadow cost, reflection cost, particle cost | not isolated; `?diag=1` exposes draw calls (170–370), triangles (27k–55k) and shadow casters (122) per view | NOT VERIFIED |
| Frame monitor degrades safely | `src/core/perf.ts`, 7 unit tests; XR only; never reduces shaders, never removes the lamp's jar/hand shadow | VERIFIED (unit) |
| Post chain bypassed in XR | preserved by design; not changed | VERIFIED (code) |
| Pause/resume | `visibilitychange` suspends audio and the sim, resets the frame guard | VERIFIED (code) |

## 8. Audio

| Check | Evidence | Status |
| --- | --- | --- |
| Audio starts after user interaction | context `none` → `running` after the first click | VERIFIED |
| All ten lines decode | durations: entry 4.95 s, s0 7.72, s1 7.34, s2 7.08, s3 6.14, lost 4.21, home 1.28, written 6.30, hint 4.21, close 2.98 | VERIFIED |
| Lines never overlap | `say()` stops the previous source; second call replaces, remaining resets | VERIFIED |
| No stuck source after a line | `voiceSource` cleared on `ended` | VERIFIED |
| Wind ducks under the voice | measured gain ratio during/after a line = **0.499** (target 0.42). This was broken and is now fixed: the air bed's gain is recomputed every frame, so a one-shot duck was being overwritten | VERIFIED (fixed) |
| Music ducks under the voice | score bus to 0.35 during a line, restored on end | VERIFIED |
| Score follows the sky | `setMood` from the sky blend, three modes | VERIFIED (code) |
| Mute | master gain → 0.018 within 0.8 s, restored to 0.867 | VERIFIED |
| **A human listened to the full mix** | not possible in this environment; automated checks only | NOT VERIFIED |

## 9. Licensing and submission integrity

| Check | Evidence | Status |
| --- | --- | --- |
| Third-party notices exist and match installed licences | `THIRD_PARTY_NOTICES.md` (three/super-three, IWSDK, IWER, eLics, Vite, Vitest, TypeScript; uikit declared but stubbed out) | VERIFIED |
| No third-party models, textures or samples | all geometry/materials/audio generated in code | VERIFIED |
| Voice assets | ten MP3s in `public/voice`, generated synthetic narration; declared in `PRIVACY.md` | VERIFIED as authored here — owner must confirm provenance |
| Root `LICENSE` | MIT present. **The licence choice is the owner's**; change it if a different one is intended | PRESENT |
| Secrets | `.env.example` documents the key; no `.env*` committed | VERIFIED |

## 10. Submission materials

| Item | State | Status |
| --- | --- | --- |
| Track / division | Gaming + **New Experience**, confirmed by the owner on 16 Nov 2026 | CONFIRMED BY OWNER |
| Devpost text | `docs/DEVPOST_SUBMISSION.md`, owner-only fields marked `_TBD_` | READY (draft) |
| Video script | `docs/DEMO_SCRIPT.md` (2:40) and `docs/VIDEO_STORYBOARD.md` | READY |
| Video footage | none recorded; must be real footage of the running app | BLOCKED — needs device or emulator capture |
| Judge's first minute | `docs/JUDGE_FIRST_MINUTE.md` | READY |
| Device test script | `docs/DEVICE_TEST_SCRIPT.md` | READY |
| Public URL | none | BLOCKED |

---

## Bottom line

**Ship-blocking, and outside this environment:** the deployment, the video, a
device session, and a live Gemini check.

**Ready to ship:** the build, the tests, the ghost run, the mission endpoint's
fallback behaviour, persistence, the audio graph and its ducking, the bundle, and
the documentation set.

**Do not claim:** Quest frame rate, hand-tracking reliability on hardware, live
Gemini generation, or deployment success. None of those has been observed.
