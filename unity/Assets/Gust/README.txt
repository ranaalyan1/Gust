GUST — Unity project (native Quest port)

This folder is a Unity 6 project. It is a SCAFFOLD, not a playable game.

What works now
  - Opens in Unity 6000.1+ and compiles.
  - Assets/Gust/Scripts/Core  : Rng (mulberry32) and FixedStepper, ported from
    src/core/random.ts and src/core/stepper.ts, with parity tests against
    golden values generated from the TypeScript build.
  - Assets/Gust/Scripts/Runtime/GustBootstrap.cs : placeholder seeded diorama,
    so you can press Play and see the RNG port working.
  - GUST > Setup > Create Main Scene  /  Configure for Quest  editor menus.

What does NOT exist yet
  Wind field, seed physics, gestures, courses, terrain, renderer, audio,
  Weather Mind, OpenXR/Meta XR integration, any Quest build.

Setup
  1. Open this folder as a project with Unity 6000.1 or newer.
  2. Package Manager > + > Add package by name:
       com.unity.xr.management
       com.unity.xr.openxr
       com.unity.xr.hands
       com.unity.inputsystem
  3. Import the Meta XR All-in-One SDK (Unity Asset Store, or Meta's scoped
     registry https://npm.developer.oculus.com scope com.meta.xr).
  4. GUST > Setup > Create Main Scene, then GUST > Setup > Configure for Quest.
  5. Edit > Project Settings > XR Plug-in Management > Android: enable OpenXR,
     add the Meta Quest feature group and hand-tracking features.
  6. Window > Package Manager > Meta XR Tools > (follow the tool's checklist).

Tests
  Window > General > Test Runner > EditMode > Run All.
  The Rng parity tests compare against values produced by the TypeScript core;
  a failure means the two builds will generate different worlds.

Roadmap
  docs/NATIVE_QUEST_PLAN.md in the repository root maps every TypeScript module
  to its C# equivalent, and lists the delivery gates.
