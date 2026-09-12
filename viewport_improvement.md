# Manufacturing Floor Viewport — 3D Enhancement Plan

**Author:** Claude Opus 5 (reviewer)
**Date:** 2026-09-12
**Baseline reviewed:** `develop` @ `d5fa4a3`
**Status:** Proposal. No implementation performed. Requires main-developer delegation before any code is written.

---

## 1. What exists today

`renderFloor()` in `static/app.js` builds a flat, absolutely-positioned map:

- `mapPosition()` normalizes each station's public `x`/`y` into an 8–92% box **scoped to the selected floor**, so the layout rescales whenever the floor's station spread changes.
- Stations render as `.station-marker` buttons, ~8.8rem wide, with the name and status **inside** the marker.
- Personnel render as `.person-marker` circles showing the first letter of the display name.
- Zoom is an explicit `--floor-zoom` scale (0.75–1.5) driven by `+` / `−` / `Reset focus` buttons. There is no pan.
- The whole map is torn down and rebuilt with `replaceChildren()` on every `render()`.

### Gaps against SOW §7.2 in the current build

| Requirement | Current state |
|---|---|
| Labels must avoid collision; upper lanes first, lower only when exhausted; leader lines meet the correct label edge | **Not implemented.** Labels are inside markers and overlap freely when stations are close. |
| Active responders render adjacent to the assigned station at deterministic, non-overlapping offsets | **Not implemented.** `acceptOffer` sets `publicLocation` to the station's exact coordinates, so every responder at a station stacks on the same pixel. |
| Pan and zoom must be deliberate | Partially met — zoom is explicit, but there is no pan at all. |
| Selecting a person focuses their location without replacing the last station selection | **Regression risk.** `selectStation()` clears `selectedResponderId`, and the personnel click handler leaves `selectedStationId` intact, but re-render rebuilds the scene and drops focus. |

These gaps are inherited by the 3D work and should be fixed as part of it, not after.

---

## 2. Rendering approach: CSS 3D transforms, not WebGL

**Recommendation: build the scene with CSS 3D transforms and DOM elements. Do not add a 3D library.**

Three reasons, in order of weight:

1. **The zero-dependency decision is frozen.** The handover decision log (2026-09-12, "Implementation stack") records zero runtime dependencies, and requires a new decision entry before any lane adds one. Pulling in three.js would be a contract-level change needing main-developer sign-off, and it buys little here: the scene is 12 boxes and 24 markers, not a rendered world.
2. **Accessibility survives.** Stations and personnel are already real `<button>` elements with `aria-label`s and keyboard focus. A WebGL canvas throws that away and forces a parallel DOM shadow structure to get it back. The SOW repeatedly requires keyboard-accessible, selectable floor entities.
3. **Simple boxes and a wireframe grid are exactly CSS 3D's competence.** A five-face box is five divs; a wireframe floor is one div with a repeating gradient. No mesh, no lighting model, no asset pipeline.

### Scene structure

```text
.floor-viewport                 perspective, overflow hidden, pan/zoom host
  └── .floor-scene              transform-style: preserve-3d
        ├── .floor-plane        wireframe grid (repeating-linear-gradient)
        ├── .machine[data-station-id]   5-face box, aria-hidden
        └── .person[data-responder-id]  small puck, aria-hidden
  └── .floor-overlay            FLAT 2D layer, not in the 3D context
        ├── .hit[data-station-id]       transparent focusable button
        ├── .hit[data-responder-id]     transparent focusable button
        ├── .bubble                     label bubble
        └── <svg class="leaders">       leader lines
```

**The key architectural decision is the split between the 3D scene and a flat 2D overlay.** The scene is presentational only (`aria-hidden="true"`). All interaction and all text live in the overlay, positioned by an analytic projection of each object's anchor point.

This avoids the two things that make CSS 3D painful:

- **Billboarding.** Text inside a `rotateX/rotateZ` context has to be counter-rotated to stay readable, and counter-rotated text renders blurry at fractional scales. Overlay labels are never rotated.
- **Rotated hit targets.** A transformed `<button>` has a transformed, hard-to-predict hit area and an outline that skews with it. Flat overlay hit targets keep pointer behaviour and focus rings correct.

---

## 3. Projection

Extract a pure module, `static/projection.js`, so the maths is unit-testable without a browser:

```text
projectPoint({x, y, z}, camera) -> {sx, sy, depth}
```

The camera is a fixed isometric-style view — roughly `rotateX(58deg) rotateZ(45deg)` — so projection is a constant affine transform, not a perspective divide. Computing it analytically rather than reading `getBoundingClientRect()` matters for three reasons: no layout thrash, no dependence on paint timing, and **deterministic output** — the same room state must always produce the same label layout, or bubbles will jitter on every poll.

Keep `mapPosition()`'s normalization, but **normalize against the floor's fixed coordinate bounds rather than the min/max of currently rendered stations**, so the floor doesn't rescale when a station is filtered out.

### Do not extend the frozen contract

The scene needs a height for each box. `Station` has no `z` and must not gain one — contract v1 is frozen, and a height is presentation, not a canonical fact. Derive it client-side as a constant, optionally varied by `status`. Same for personnel markers. **No new API fields are required for any of this work**; `station.x/y/floorId` and `responder.publicLocation` are already public.

---

## 4. Label bubbles and collision avoidance

This is the hardest part and the part the SOW is most specific about.

Bubbles are flat overlay elements anchored above each object's projected top-centre, joined to it by a leader line. The placement pass runs in **2D screen space after projection**, which is where collision actually matters.

### Algorithm

1. Project every visible object's anchor. Sort by screen `y` then by stable id — deterministic tie-breaking, no dependence on array order.
2. Measure each bubble once per render (text is known, so width can be estimated from character count and cached to avoid forced reflow).
3. For each object in order, walk candidate **lanes**: fixed vertical offsets above the anchor, nearest first.
4. Accept the first lane whose bubble rectangle intersects no already-placed rectangle. Record it.
5. **Only when every upper lane is exhausted**, walk lanes below the anchor the same way. This ordering is a literal SOW requirement, not a preference.
6. Draw the leader from the anchor to the **correct edge** of the bubble: bottom edge for a bubble placed above, top edge for one placed below. Also a SOW requirement, and the easiest detail to get wrong.

Leader lines go in one `<svg>` in the overlay — a single element with N `<line>` children, not N absolutely-positioned divs.

### Bubble contents

- **Machine:** station display name; second line with issue class and status when an issue is active, otherwise "Healthy".
- **Personnel:** display name; second line with role and duty status.

Keep bubbles visually neutral by default. SOW §7.2 requires personnel visuals to be neutral unless hovered or selected, so state colour belongs on the machine box and its bubble border, not on person markers.

---

## 5. Deterministic personnel placement

When responders are assigned, the server sets `publicLocation` to the station's exact coordinates, so they stack. Fix this **client-side** with a deterministic fan-out, since it is a presentation concern and needs no state change:

1. Group visible responders by rounded `(x, y)`.
2. Sort each group by responder id.
3. Place member *i* of a group of *n* at a fixed angular offset around the station box, at a constant radius — e.g. angle `i * 360/n` degrees, starting from a fixed bearing.

Same state in, same layout out. This satisfies SOW §4.1's "deterministic, non-overlapping offsets" without inventing continuous tracking.

---

## 6. Deliberate pan and zoom

SOW §7.2: *"normal page navigation must not accidentally pan or zoom the map."*

- **Keep** the existing explicit `+` / `−` / `Reset focus` buttons. They stay the primary control and the only one required.
- **Add drag-to-pan** bound to pointer events on the viewport, primary button only, with a small movement threshold so a click-to-select is never read as a drag.
- **Do not bind plain wheel to zoom.** A bare wheel event over the viewport must continue to scroll the page. Optionally support `Ctrl`/`⌘` + wheel with `preventDefault()` confined to the viewport.
- **Keyboard:** arrow keys pan and `+`/`−` zoom **only while the viewport itself has focus**, never globally.
- Clamp pan so the floor plane cannot be dragged entirely out of view; `Reset focus` restores both pan and zoom.

---

## 7. Re-render behaviour

`render()` currently calls `replaceChildren()` and rebuilds everything. With a 3D scene, bubbles, and leader lines this produces visible reflow on every poll and **drops keyboard focus mid-interaction**.

Move to keyed reconciliation: cache nodes by `data-station-id` / `data-responder-id`, update transforms and text in place, and create or remove only what changed. Skip the layout pass entirely when `room.revision` is unchanged and no selection has moved.

---

## 8. Suggested phasing

Each phase leaves the app working and reviewable.

| Phase | Deliverable | Acceptance |
|---|---|---|
| 1 | `projection.js` + wireframe floor plane; markers still flat | Unit tests for projection determinism; no visual regression in selection |
| 2 | Machine boxes + flat overlay hit targets; keyed reconciliation | Keyboard selection and focus retention unchanged; painter-order depth correct |
| 3 | Label bubbles, lane collision pass, leader lines | Unit tests: upper lanes exhausted before lower; leader meets correct edge; layout stable across identical renders |
| 4 | Personnel pucks + deterministic fan-out | Same state produces identical layout; no overlap at a shared station |
| 5 | Drag-pan, keyboard pan/zoom, `prefers-reduced-motion`, focus styling | Wheel over viewport still scrolls the page; reset restores pan and zoom |

---

## 9. Testing

The repo's suite is hermetic `node:test` with no browser, so the testable surface must be pure functions rather than rendered output:

- `projectPoint()` — determinism, stable ordering, correct depth sort.
- `placeLabels()` — returns lane assignments for a given set of anchors and box sizes. Assert upper-lane-first, lower-lane-only-on-exhaustion, no overlapping rectangles, and identical output for identical input.
- `fanOutResponders()` — deterministic offsets, no collisions within a group.
- Existing static markup assertions in `test/api.test.ts` extend to cover the new scene and overlay layers.

A browser test would cover the rest, but Playwright is **not currently installed** and adding it is a separate dependency decision.

---

## 10. Risks

1. **Safari `preserve-3d`** has historic bugs with nested transformed children and `overflow: hidden` ancestors. Mitigation: keep the 3D tree exactly two levels deep (scene → object → faces) and never clip inside the scene.
2. **Focus rings on transformed elements** render unpredictably. Mitigated by the overlay architecture — focus lives on flat elements — but must be verified, not assumed.
3. **Depth ordering.** `z-index` is unreliable inside a 3D context. Sort DOM insertion order by projected depth (painter's algorithm) rather than relying on stacking.
4. **Label density.** Twelve stations plus up to twenty-four personnel on one floor can exhaust upper lanes. The fallback to lower lanes must be verified with a worst-case fixture, not just the seeded two-issue room.
5. **Scope creep into Lane F.** Personnel on the floor depend on duty status. The 2-2-3 roster is not built, so exactly one crew is `AVAILABLE`. This plan must not start modelling shifts to make the floor look busier.

---

## 11. Out of scope

Analytics, station issue-history drill-down, smart search, simulation/lifecycle changes, workforce policy, provider settings, and deployment assets. No server, domain, persistence, or public-API change is required or proposed by this plan.
