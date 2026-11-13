# GUST — from WebXR prototype to a native Quest submission

Status of this document: assessment written after merging PR #1 into
`arena/1cfb0188-gust` and re-verifying it. Date: 2026-11-12.

---

## 1. What we actually have

GUST today is a **WebXR game**: an Immersive Web SDK + three.js app that runs in
the **Meta Quest Browser**. It is genuinely Quest-flavoured (hand tracking,
controllers, `metaQuest3` emulator), but it is not a native application.

Verified on this branch, on this machine, today:

| Check | Result |
| --- | --- |
| `npm ci` | clean install |
| `npx tsc --noEmit` | no errors |
| `npx vitest run` | **124 passed / 10 files**, 5.3s |
| `GUST_HTTP=1 npx vite build` | succeeds, 6.7s |
| Bundle | main chunk 2,515 kB (697 kB gzip) + 456 kB msdf + 202 kB worker |
| Dev server + `/api/mission` | serves; returns `source: "fallback"` without a key |

Code shape:

| Layer | Lines | Framework coupling |
| --- | --- | --- |
| `src/core/` (16 modules: wind, seed, gestures, hands, course, terrain, mission, garden, ghost, weatherMind, stepper, vec3, random) | 4,147 | **None** — pure TypeScript, headless |
| `src/render/` + `src/systems/gust.ts` + `src/input/` (islands, foliage, air, seeds, sky, extras, xr/pointer input) | 3,182 | three.js + IWSDK |
| `src/audio/` (procedural, no audio files) | 397 | Web Audio |
| `tests/` | 1,805 | vitest, core only |

And from the merged PR's own honest accounting:

* **Never run on a real headset** — only the desktop Quest emulator.
* **Audio never listened to** — level/clipping measured only.
* **No live Gemini call** — only the local fallback bank has run.
* **No Vercel deploy** attempted.
* **No MR features**: `sceneUnderstanding`, `physics`, `grabbing`, `spatialUI`
  are all `false` in `iwsdk.config.json`. No passthrough, no occlusion.
* Large un-split bundle; no lightning geometry; controller "let go" rule is
  awkward (>75 cm spread or roll).

## 2. Why this is not a native-hackathon submission

A native Quest hackathon judges an **installable APK on the device**, built from
Unity/Unreal (or the Spatial SDK), using **OpenXR + the Meta XR / Presence
Platform** feature set. Judging language typically touches hand tracking,
passthrough/mixed reality, performance on device, and comfort.

GUST currently scores zero on all of the packaging items, and the absence of MR
features is a deliberate config choice, not a bug.

### The wrapper idea does not work

It is tempting to wrap the existing build in an Android shell (WebView /
Capacitor / Cordova) and ship an APK. **This does not produce an immersive
app on Quest.** WebXR immersive sessions are provided by the Meta Quest
Browser, not by an embedded WebView; a sideloaded web-wrapper APK stays inside
a flat window. Reports of exactly this failure are common:

> "I turned the app into a PWA, wrapped it as an APK and sideloaded it onto the
> device, but we're still within a window... To build a fully immersive
> experience you'll need to use native tools like Unity with the Meta XR SDK."
> — Stack Overflow, on Quest PWA/APK wrapping

So: no shortcut. Native means a real port.

## 3. Route comparison

| | A. Unity 6 + Meta XR SDK | B. Native Android + OpenXR | C. WebView wrapper APK | D. Stay WebXR |
| --- | --- | --- | --- | --- |
| Native APK on device | Yes (*.apk*) | Yes | Yes, but **not immersive** | No |
| Hand tracking (OpenXR) | Yes, `OVRHand` / XR Hands | Yes, hand-rolled | N/A | Browser only |
| Passthrough / MR | Yes, first-class | Yes, low-level | No | Limited |
| Reuses the 4,147-line core | Translate to C# (mechanical) | Translate to Kotlin/C++ | Reuses everything | Reuses everything |
| Reuses the renderer | **No** — rebuild in Unity | No | Yes | Yes |
| Tooling maturity | Highest; Meta's own samples | High, but DIY | N/A | N/A |
| Effort | High, but bounded | Very high | Low — and pointless | None |
| Verdict for this competition | **Recommended** | Only if Unity is off-limits | **Rejected** (§2) | **Rejected** |

## 4. Recommended route: Unity 6 + Meta XR All-in-One SDK

The good news is that the hard, novel part of GUST — the wind field, seed
physics, the five gestures, the four courses, the director — is **already
framework-free**. A port is mostly translation, not redesign.

### Mapping

| GUST today | Native equivalent |
| --- | --- |
| `src/core/wind.ts` | `Wind.cs` — same math, `Vector3` instead of `vec3` |
| `src/core/seed.ts` | `Seed.cs` — same integrator |
| `src/core/gestures.ts` | `Gestures.cs`, fed by `OVRHand` joint poses |
| `src/core/course.ts`, `terrain.ts` | `Course.cs`, `Terrain.cs` (data only) |
| `src/core/game.ts` (state machine) | `GameDirector.cs` MonoBehaviour, stepped from `Update` |
| `src/core/mission.ts`, `weatherMind.ts` | same, + `UnityWebRequest` for the Gemini call |
| `src/core/garden.ts` | replace storage with `PlayerPrefs` |
| `src/render/*` (procedural meshes) | rebuild as Unity meshes; keep the same generators and seeds so the islands look identical |
| `src/audio/audio.ts` | procedurally generated `AudioClip`s via `OnAudioFilterRead` / `AudioClip.Create` |
| `api/mission.ts` | server stays as-is (Vercel) — the Unity app just calls it |

### Why the core survives translation

Determinism is already central: `src/core/random.ts` + `seed.ts` mean the same
seeds must produce the same world. That property is what makes a port
verifiable: we can emit a **parity corpus** — recorded inputs and expected
outputs from the TypeScript core (wind samples, gesture classifications,
mission adaptation) — and assert the C# implementation reproduces it in
PlayMode tests. Without that, a port silently drifts.

### Delivery plan

| Step | Work | Gate |
| --- | --- | --- |
| 0 | Emit parity corpus from `src/core` (JSON), so any port is testable | runs here |
| 1 | Unity 6 project + Meta XR SDK + XR Origin, hand tracking on device | needs Unity |
| 2 | Port core to C#, run parity tests | needs Unity |
| 3 | Procedural world rebuild (islands, foliage, air, sky) with same seeds | needs Unity/headset |
| 4 | Gesture input from `OVRHand`, desktop pointer fallback | needs headset |
| 5 | Audio, Weather Mind call, garden persistence | needs device |
| 6 | MR layer: passthrough, occlusion, room-aware islands | needs headset |
| 7 | Performance: 72 Hz sustained, foveation, LOD | device profiler |

### What can and cannot be done in this sandbox

**Cannot**, and I want this to be explicit rather than discovered later:

* No JDK, no Android SDK, no Gradle, no Unity installed.
* `dl.google.com` is unreachable here, so Android SDK/platform tools cannot be
  downloaded even if a JDK were present.

So **the APK cannot be built or run in this environment**. It has to be built
either in your Unity Editor on your machine, or in CI (GitHub Actions +
GameCI) with a Unity licence secret. Everything in steps 2–3 is writable here
and reviewable by you; compile and device verification must happen there.

## 5. "No submission package" — the checklist

None of this exists in the repo today. A native hackathon submission needs,
typically:

- [ ] Signed **APK / AAB**, installable on Quest 2/3, no debug-only paths
- [ ] Store-style listing: name, short + long description, 3–5 screenshots,
      icon set, category
- [ ] **Trailer / 60–90 s capture** recorded on device (not emulator)
- [ ] **Pitch**: one-screen problem → experience → why it needs VR
- [ ] **Privacy policy** + data disclosure (we send player telemetry to a Gemini
      endpoint — must be declared)
- [ ] **Comfort & accessibility** notes: no forced locomotion, seated play,
      gesture alternatives, mute, reduced-motion
- [ ] **Performance evidence**: frame timings on device, thermal behaviour
- [ ] **Device test log**: which builds ran on which headset, what passed
- [ ] Source licence / third-party attribution (three.js, IWSDK, fonts)
- [ ] Judging-criteria mapping: one bullet per criterion, pointing at a feature

## 6. Decision needed

Route A is the only route that ends in a native, immersive, MR-capable Quest
build without starting the game's design over. It is a real port: the ~4.1k-line
core translates, the ~3.2k-line renderer is rebuilt.

Two ways to start, pick one:

1. **Parity corpus first** (recommended, and possible in this environment):
   freeze the TypeScript core's behaviour into JSON fixtures so the C# port can
   be proven equivalent. Small, verifiable, useful no matter what.
2. **Unity project first**: scaffold the Unity 6 + Meta XR project and the C#
   core translation, accepting that you verify it in your Editor.

If instead the competition's rules turn out to allow browser-based entries —
worth checking before committing to a port — then the existing build only needs
the packaging work in §5, and that we can largely do here.
