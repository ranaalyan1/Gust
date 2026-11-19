# GUST and Horizon OS: what is built, and what is not

The Meta VR Start Developer Competition 2026 judges the **technical implementation
of Horizon OS capabilities**: hand interactions, passthrough camera access with
AI, and multiplayer (see `COMPETITION_2026.md` §4). This file says, capability by
capability, what GUST actually does on a Quest, and what it does not.

## 1. Hand interactions: built

- The whole game runs on hands. Open palm, sweep, cupped updraft, clap and
  whirlwind are recognised from tracked hand poses (`src/core/gestures.ts`,
  `src/input/xrHands.ts`) and fed to the same simulation as the desktop mouse.
- Controllers are optional. `handTracking` is requested in both the VR and the
  passthrough session (`iwsdk.config.json` and `launchXR` merge their features).
- Haptic ticks on each recognised gesture, with no-op fallback when a hand has no
  actuator (`XRHands.pulse`).

**Not yet proven on a device.** It has been exercised only in the IWER emulator.

## 2. Passthrough: built as a second entry point (v1)

Horizon OS passthrough is an `immersive-ar` session with an alpha-blend
environment. GUST keeps its VR session as the default and adds a **Passthrough
desk** button, shown only when the browser reports `immersive-ar` as supported.

What happens in a passthrough session:

| Element | Behaviour |
| --- | --- |
| Clear colour | Fully transparent, so the real room shows through |
| Sky dome and backdrop | Hidden |
| Walnut desk, paperwork, shelves, floor, lamp stem and arm | Hidden (tagged in `Room.env()`) |
| Bell jar, brass, islands, seed, light, shade and bulb | Kept: this is the specimen |
| Lights | Never hidden, because the specimen is lit by them |

Verified in the IWER emulator: the session starts with `environmentBlendMode`
`alpha-blend`, passthrough switches on, and all 85 room objects step out of the
frame. The emulator has no camera feed, so the real-room view itself has **not**
been seen. That needs a headset.

**Known limits of v1**

- The specimen floats at a fixed spot in front of the player. It is not yet
  placed on a real table.
- Real-world occlusion is not on. The next step is the SDK's depth sensing:
  `world.xr.features.depthSensing`, the `DepthSensingSystem`, and `DepthOccludable`
  on the specimen (see `.agents/skills/iwsdk-depth-occlusion`). That would put
  the real desk and hands in front of the jar.

**Next step (in order)**

1. Hit-test placement: a reticle on the real desk, and a pinch to set the
   specimen's origin, so the jar stands on the real table.
2. Depth occlusion of the specimen by real furniture and hands.

## 3. Multiplayer: not built

GUST has no networking. A shared keeper's book, or two players planting seeds
into one garden, would be the natural first step, and nothing in the simulation
blocks it: the core is deterministic and pure (`src/core`). It is not in this
submission.

## 4. Passthrough camera access with AI: not built

The Quest camera access API would let the Weather Mind react to the real room
(for example, a lamp that is on in your room is the lamp in the book). That needs
explicit consent, a privacy note, and a device. It is not in this submission,
and `PRIVACY.md` does not yet cover camera access.

## Status, for the submission text

| Capability | Status |
| --- | --- |
| Hand interactions | Built; device test pending |
| Passthrough | Entry point and visual handling built; placement and occlusion pending |
| Multiplayer | Not built |
| Passthrough camera + AI | Not built |

Verification: `tsc --noEmit` clean, 168/168 tests, production build succeeds, and
the passthrough session was started and inspected in the IWER emulator.

## Depth occlusion in the passthrough desk

- The passthrough session asks for `depth-sensing` as an **optional** feature
  (`gust.ts`, `offerPassthrough`), with `usage: gpu-optimized` and
  `format: float32`. A device without depth still gets the desk, without the
  real furniture passing in front of it.
- `DepthSensingSystem` is registered once in `src/index.ts`, with the recipe's
  config. It does nothing outside an AR session that has depth.
- The room's entity gets `DepthOccludable` only while a passthrough session is
  active, and loses it on exit. The VR room never takes the depth path.
- Checked in the IWER emulator: the button starts an `alpha-blend` session, the
  room entity exists, and there are no page errors. The emulator has no depth
  data, so the occlusion itself is not verified. Real-room occlusion needs a
  Quest 3 or 3S.

## Hand input

- `src/input/xrHands.ts` turns a tracked hand into a palm pose and joints. It
  uses the wrist, index and pinky joints. A hand that loses tracking reads as
  absent, and it does not fall back to a controller. Controllers are used only
  when there is no hand source.
- `tests/xrHands.test.ts` covers the tracked hand, the lost hand, the controller
  fallback, and the cleared state with no frame. These run in plain Node.
- Real hand input is not verified here. It needs a Quest 3 or 3S, and the
  hand-only path has to be checked there before the submission.
