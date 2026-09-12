# Response Compass viewport implementation prompt

```text
Implement a polished manufacturing-floor viewport for Response Compass.

Goal:
Create a responsive Control Room map viewport that is fully usable on desktop without accidental panning or zooming during normal page navigation.

Requirements:

1. Desktop layout
- At a reference desktop viewport around 1920×1200, keep the application header, core control-room panels, and floor viewport visible without normal page scrolling.
- Use responsive sizing; smaller windows and mobile layouts may scroll naturally.
- The floor viewport must have a bounded height and should not expand indefinitely with page content.

2. Manufacturing Floor viewport
- Show a selectable manufacturing floor layout with stations/equipment placed at public X/Y coordinates.
- Support multiple floors and provide a clear floor selector.
- Each station should visibly show normal versus issue-active state.
- Selecting a station, issue, search result, or event should switch to the correct floor and smoothly focus the relevant station.
- Do not place personnel directly on top of equipment. Assigned personnel appear beside their assigned station using deterministic adjacent offsets; two assigned people must appear as two separate circles.
- On-duty but unassigned personnel appear at their duty-station location.
- Off-shift personnel must not appear on the floor.

3. Deliberate map interaction
- Mouse-wheel scrolling must continue to scroll the page; it must not zoom the map.
- Panning requires a deliberate desktop gesture: hold Space while dragging an empty map area with a mouse.
- Do not enable drag-to-pan on normal click/drag.
- Touch interaction should preserve normal page scrolling.
- Provide visible zoom controls and keyboard support using + and -.
- Keep selected/focused entities visible after state refreshes or polling.

4. Labels and collision handling
- Station labels and personnel bubbles must not overlap.
- For labels, search available placement lanes above the anchor first.
- Only use lanes below the anchor after upper lanes are exhausted.
- Labels may use the full usable vertical viewport space before considering a lower placement.
- Draw leader lines from the correct label edge to the station.
- Personnel visual state is neutral by default; highlight only on hover and when selected.

5. Accessibility
- The viewport must have an understandable accessible label and keyboard-operable zoom controls.
- Station/personnel markers must be focusable controls with useful accessible names.
- Selection must have a visible non-color-only indicator.
- Respect reduced-motion preferences.

6. Responsive behavior
- Preserve a structured desktop Control Room layout.
- On narrow or short screens, stack content into normal document flow rather than clipping critical information.
- Never make the viewport interfere with touch scrolling.

Deliverables:
- Production-ready implementation with clear component boundaries.
- Deterministic coordinate and placement utilities.
- Tests covering: deliberate pan gesture, no wheel zoom, focus-to-station/floor, adjacent assigned-person placement, label collision avoidance, desktop bounded layout, and mobile scroll behavior.
- Do not use hidden simulation skill, private personnel data, or continuous location tracking. Locations are event snapshots only.
```
