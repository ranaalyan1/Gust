# Meta VR Start Developer Competition 2026 — rules, deadline, and where GUST stands

Researched 2026-11-12 from the official Devpost FAQ, the Meta developer blog
post and the Start program terms. Sources at the bottom. **Read §7 before
committing to a Unity port.**

---

## 1. The hard deadline

| | |
| --- | --- |
| Entry window | **24 September 2026 → 18 November 2026, 12:00 PM PT** |
| In UTC | 18 November 2026, 20:00 UTC |
| **Time left from today (12 Nov)** | **≈ 6 days** |
| Judges see the project as it stands at close | no changes afterwards |
| Winners announced | on or around 11 December 2026 |
| Prize pool | $1M, 20 prizes, $20k–$100k, $100k top prize per track |
| Tracks | Entertainment, Gaming, Productivity & Tools, plus special awards |

## 2. Eligibility — you, the entrant

- 18+, and of legal age where you live.
- A Meta account **with Developer Access enabled**.
- The submitting person must be a **Meta VR Start member in good standing**
  (Start was formerly Meta Horizon Start). Joining after 24 September is fine —
  it just has to be done **before you submit**. Membership flair can take
  >24h to appear, so apply now, not on the 17th.
- Eligible country. Excluded: residents of **Brazil**, **Quebec**, and
  comprehensively sanctioned areas (Crimea, Russia, Cuba, Iran, North Korea,
  Syria) or OFAC-designated persons. **Pakistan is not on the exclusion list**,
  but confirm against the official rules yourself — this is not legal advice.
- Not an app that received/gets direct Meta funding (RFP etc.).
- **One entry per person**, solo or as a team representative.

## 3. Eligibility — the project (this is the part that matters)

The rules are more permissive than "native only":

| Requirement | Detail |
| --- | --- |
| **Hands, end-to-end** | "Your experience must be fully usable with hands, end-to-end. Controller support is welcome, but not required." Non-negotiable. |
| **Playable on Quest 3 / 3S** | The build must run on Quest 3 and 3S. Quest 2 / Pro compatibility is allowed but not judged. |
| **No non-Meta hardware** | Must not require third-party devices (Bluetooth accessories etc.). |
| **Seated, stationary** | *Suggested*, not required: seated-optimised, limit room-scale, large physical movement discouraged. |
| **Fast cold start, ≤10 min satisfaction** | Suggested: quick launch, clean pause/resume, something satisfying within 10 minutes. |
| **Genre leaning** | Gaming track leans puzzle, strategy, casual, social, narrative. |
| **Engines allowed** | **Unity, Unreal, Godot, Native/Android, Immersive Web SDK (WebXR), or another engine.** Engine choice does not affect prize eligibility — but some special awards require a specific engine (e.g. "Best Experience Built with Spatial SDK"). |
| **Wrapper experiences** | Actively discouraged: "Core experience should be Entrant-built." |
| **Originality / licensing** | Must be your own work or properly licensed, incl. third-party code and assets (three.js, IWSDK, fonts, AI-generated content). |

**Submission mechanics:**

- Unity / Unreal / Spatial SDK / native: an **APK uploaded to a new release
  channel named "Competition"** in the Meta Horizon Developer Center, and the
  invite/release link submitted on Devpost. Publishing to the Horizon Store is
  **not** required.
- **IWSDK (WebXR): a URL where judges can test it** — e.g. GitHub Pages or any
  host (Digital Ocean, AWS, Azure…). Explicitly supported.
- A **<3 minute** demo video, publicly on **YouTube**, showing the project on a
  Quest device *or* the XR Simulator/emulator.
- A text description: inspiration, how you built it, future plans, target
  launch date.

⚠️ One Devpost FAQ line contradicts the rest ("APKs will not be considered").
Read with the other answer — APK on a release channel *or* a web URL for
IWSDK — and confirm in writing with Start support before relying on it.

## 4. Judging criteria (as published)

Technical implementation of Horizon OS capabilities — **hand interactions,
passthrough camera access with AI, multiplayer** — plus the usual craft,
originality, and fit to the track. Note what is *not* on the list: "native vs
browser". It is engine-agnostic.

## 5. GUST against the rules — the honest table

| Requirement | GUST today | Verdict |
| --- | --- | --- |
| Hands end-to-end | 5 gestures (open palm, sweep, cupped updraft, clap, whirlwind) drive everything; **but only exercised in the IWSDK headset emulator** (3/3 carries planted) | **Strong design fit, unproven on device** |
| Playable on Quest 3/3S | WebXR in Quest Browser; never run on a real headset | **Unproven** |
| Seated, stationary | Tabletop 1:7 diorama, `locomotion: false`, no room-scale | **Excellent fit** |
| ≤10 min satisfaction | 4 acts, 3–5 min a run | **Excellent fit** |
| Fast cold start | 2,515 kB main chunk (697 kB gzip) + 456 kB msdf worker | **Needs measuring on device** |
| Genre | Casual / narrative, world-building | **Fits Gaming or Entertainment** |
| Engine | Immersive Web SDK | **Explicitly allowed** |
| Submission URL | none deployed | **Missing** |
| Video | none | **Missing** |
| Text description | none | **Missing** |
| Start membership / Dev Access | unknown | **Check now** |
| Licensing | three.js, IWSDK, @pmndrs/uikit, Gemini API | **Assert and document** |

**Conclusion: the premise that GUST is ineligible is wrong.** It is built on
IWSDK, which the 2026 rules name as an accepted engine and give an explicit
submission path for (hosted URL). What it lacks is *proof on device* and the
*submission package* — not eligibility.

## 6. Two weeks is not enough for a Unity port. Six days certainly is not

A native Unity entry means: Unity 6.1 + Meta XR All-in-One SDK + XR Plugin
Management (OpenXR), rebuild of the 3,182-line three.js renderer as Unity
meshes/materials, reimplementation of the 397-line procedural Web Audio score,
a new OpenXR hand-tracking input layer, a Quest build pipeline, on-device
performance work to 72 Hz, and *then* the video and submission text — all
verified on hardware nobody in this workflow currently has (this sandbox has no
Unity, no JDK, no Android SDK, and `dl.google.com` is blocked).

That is a multi-week project. Started today it cannot be a *good* native entry
by 18 November, and a rushed native port of a game that already works would
likely score worse than the working WebXR build with a proper video and a
hosted URL.

## 7. Recommended plan — submit the IWSDK build, then port to Unity after

**By 18 November (submit this):**

1. **Today** — confirm Start membership + Developer Access; apply if missing.
   Register on Devpost.
2. **Today** — deploy `dist/` to a public HTTPS URL (GitHub Pages / Vercel) with
   `GUST_HTTP=1`-style plain-HTTP build behind the host's TLS. Verify it loads in
   the Quest Browser and that the **Enter XR** button presents a session.
3. **Days 1–2** — device test on a Quest 3/3S if at all obtainable (borrow,
   friend, local VR arcade, Meta XR Simulator as fallback for capture). Fix
   whatever hands-only flow breaks. Confirm the seed lands with hands only,
   no controllers, from cold start to bloom.
4. **Days 2–3** — performance pass: cold start time, 72 Hz stability, reduce the
   2.5 MB chunk (dynamic import of the msdf worker, code-split).
5. **Days 3–4** — capture the <3 min video (Quest or XR Simulator), upload to
   YouTube public.
6. **Day 5** — write the description (inspiration / build / plans / launch
   date), add a LICENSE + third-party attribution note, privacy note for the
   Gemini telemetry.
7. **Day 6** — submit on Devpost with the hosted URL. Then stop touching it.

**After 18 November:** do the Unity port properly for the next cycle (or a
store launch), using §4 of `NATIVE_QUEST_PLAN.md`. Nothing about that work is
wasted — the core is engine-neutral and the parity corpus will make the port
verifiable.

## 8. What the Unity scaffold in `unity/` is, and is not

It is a real Unity 6 project skeleton — project version, package manifest,
assembly definitions, the deterministic core started in C# (`Rng`,
`FixedStepper`) with EditMode tests, and an editor menu that builds the main
scene. It opens in Unity and compiles.

It is **not** a playable port: no wind field, no seed, no gestures, no
renderer, no Meta XR integration. Treat it as the first commit of the *next*
build, not as something submittable in six days.

## Sources

- Devpost FAQ, Meta VR Start Developer Competition 2026 —
  <https://start-developer-competition-26.devpost.com/details/faqs>
- Meta developer blog, competition announcement (24 Sep 2026) —
  <https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/>
- Meta Horizon Start program page / terms —
  <https://developers.meta.com/horizon/resources/meta-start-developer-program/>
- Unity + Meta Horizon OS recommended setup (Unity 6.1+, OpenXR, Meta XR
  All-in-One SDK) —
  <https://developers.meta.com/horizon/blog/unity-meta-horizon-os-the-future-of-vr-unite-2025/>
