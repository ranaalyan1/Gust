# The Wind Cabinet — direction and first slice

Committed 2026-11-12. Direction chosen by the owner: **B, The Wind Cabinet**, to
be built as a competition showpiece.

---

## Why the previous version failed

Not lighting. It failed because:

1. **The art direction was a default.** Pastel low-poly floating islands are the
   most common look in VR demo footage. Nothing in it was a choice.
2. **Nothing carried a human trace.** No wear, no handwriting, no object anyone
   would have owned.
3. **It had no reason to exist.** A wind toy is a tech demo.

More lighting on a stock composition makes a stock composition look expensive.
It does not give it a soul.

## The direction

**A naturalist's specimen table, at night, one lamp on.** The floating islands do
not change — what changes is that they are no longer a landscape. They are an
object on a desk, inside brass and glass, being studied.

References, and the specific thing borrowed:

| Reference | Borrowed |
| --- | --- |
| Victorian naturalist's specimen tables; the Harvard glass flowers | The intimacy and the premise: this is a thing someone made, keeps and labels. |
| *The Room VR* | Material honesty at arm's length — brass reads as brass because it is worn. |
| *Red Matter 2* | One source of light, and everything else earned by it. |
| *Moss* | Scale as affection: a small world you lean over. |
| *Demeo* | Framing a tabletop so the whole board is legible from a seated pose. |

Target frame: `docs/concepts/direction-b-cabinet.png`.
First in-engine frame: `docs/images/cabinet-first-slice.png`.

## What is actually in this slice

| Change | Detail |
| --- | --- |
| **`src/render/room.ts`** (new) | Desks, bell jar, lamp, dust and the room behind it. All procedural: walnut and brass are generated `DataTexture`s, so there are still no asset files. |
| **The world is now 1:18, not 1:7** | The single most important fix. At 1:7 the course was a metre wide — a playset — and the "specimen" was a 1.6 m vitrine with its rim cutting across the player's view. At 1:18 it is ~39 cm across: something you lean over. |
| **Gesture feel preserved** | `UNIT` is both the render scale and the gesture `unitScale`, so shrinking the world keeps a sweep feeling like a sweep. Only the size of the world it moves changed. |
| **The lamp is the light** | The old sky sun stops casting; a spot inside a brass shade does the work, with a warm bulb, a soft beam cone and a dim wall wash. The three "skies" became three qualities of lamplight. |
| **Palette muted** | Grass, earth and rock moved from pastel to olive, umber and ash — specimens under a warm lamp, not a mobile game. |
| **Indoors is indoors** | The cloud sea and the gulls are gone; dust in the beam replaced them. |
| **Case centred on the course** | The room sits over the *middle of the course* (`root.localToWorld(viewX)`), not over island zero — which is why the world used to spill out of the jar. |

Verified: `tsc` clean, **132/132 tests pass**, production build succeeds, and the
frame above is the running build, not a mock-up.

## What is missing, and what I would do next

This is a **first slice**, and it is not yet the concept. In priority order:

1. **The human trace.** Pinned specimen cards with handwritten labels; a brass
   plaque that takes the player's name; a drawer that keeps every seed ever
   planted, with the date. This is the soul the frame still lacks — right now
   the room is empty of people.
2. **Interaction with the furniture.** The magnifier should be pickable; the
   lens should actually magnify the specimen. That is the *toy* a museum case
   wants, and it is one shader.
3. **The cabinet as UI.** No floating panels: the act select is a drawer, the
   options are brass switches. Diegetic or nothing.
4. **Lamp craft.** The shade silhouette is currently crude and the arm reads as
   a stick. A lathed profile would fix it in an afternoon.
5. **Performance.** MeshStandardMaterial + spot shadows is a heavier stack than
   the old flat-shaded build; this needs on-device measurement before anyone
   claims it runs at 72 Hz.
