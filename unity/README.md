# GUST — Unity project (native Quest port)

This is a **Unity 6 project skeleton**, not a playable game. It is the first
commit of the native build, started so the port has a real home.

Read `docs/COMPETITION_2026.md` in the repository root first: the
Meta VR Start Developer Competition 2026 closes **18 November 2026, 12:00 PM PT**,
and this port cannot be a competitive native entry by then.

## Open it

1. Unity **6000.1** or newer (`ProjectSettings/ProjectVersion.txt` pins 6000.1.0f1;
   let your Unity upgrade it if you have a different 6.x).
2. Open **this folder** (`unity/`) as a Unity project.

The package manifest is deliberately minimal — only the test framework and core
modules — because pinning versions for OpenXR/Meta XR that don't match your
editor breaks resolution. Add the XR packages from the Package Manager UI:

| Package | Purpose |
| --- | --- |
| `com.unity.xr.management` | XR plug-in lifecycle |
| `com.unity.xr.openxr` | OpenXR runtime |
| `com.unity.xr.hands` | hand-tracking API |
| `com.unity.inputsystem` | input actions |

Then import the **Meta XR All-in-One SDK** — Unity Asset Store, or Meta's scoped
registry `https://npm.developer.oculus.com` with scope `com.meta.xr`.

## Set it up

```
GUST ▸ Setup ▸ Create Main Scene      # generates Assets/Gust/Scenes/Main.unity
GUST ▸ Setup ▸ Configure for Quest    # Android, IL2CPP, ARM64, min SDK 32, ASTC
```

Then `Edit ▸ Project Settings ▸ XR Plug-in Management ▸ Android`: enable OpenXR,
add the **Meta Quest** feature group and the hand-tracking features, and run the
Meta XR Tools checklist.

## What is actually implemented

| File | Status |
| --- | --- |
| `Assets/Gust/Scripts/Core/Rng.cs` | ✅ mulberry32, `hash01`, `hashString` — ported bit-for-bit from `src/core/random.ts` |
| `Assets/Gust/Scripts/Core/FixedStepper.cs` | ✅ fixed-timestep accumulator from `src/core/stepper.ts` |
| `Assets/Gust/Scripts/Runtime/GustBootstrap.cs` | 🟡 placeholder seeded diorama (press Play) |
| `Assets/Gust/Scripts/Editor/GustProjectSetup.cs` | ✅ scene + player-setting menus |
| `Assets/Gust/Tests/EditMode/` | ✅ parity + stepper tests |

**Not started:** wind field, seed physics, five gestures, four courses, terrain,
renderer, procedural audio, Weather Mind, OpenXR input, Quest build.

## The parity tests matter

`RngTests` compares this C# implementation against numbers produced by running
the **TypeScript** core — not against values observed from this port. Golden
values were generated with:

```bash
npx vite-node -e "import {createRng} from './src/core/random.js'; ..."
```

If those tests go red, the two builds generate different worlds from the same
seed, and every ported module downstream inherits the drift. Add a golden case
whenever a new module is ported.

Run them in `Window ▸ General ▸ Test Runner ▸ EditMode ▸ Run All`.

## Port order

Follow `docs/NATIVE_QUEST_PLAN.md` §4: `vec3` → `wind` → `seed` → `hands` /
`gestures` → `course` / `terrain` → `game` (state machine) → `mission` /
`weatherMind` → `garden`. Rendering and audio come after the core is green.

`Vector3` replaces the project's own `vec3`, so `src/core/vec3.ts` only needs
its helper functions (`clamp01`, `smoothstep`, …) ported as static methods.
