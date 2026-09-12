import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coordinateBounds, fanOutResponders, layoutResponders, normalizePoint, placeLabels, projectPoint, stationFocus } from '../static/projection.js';
import { canStartViewportPan, viewportFit, viewportShortcut } from '../static/viewport-controls.js';

describe('floor viewport geometry', () => {
  it('projects fixed normalized coordinates deterministically with stable depth', () => {
    const bounds = coordinateBounds([{ x: 10, y: 20 }, { x: 90, y: 80 }]);
    const point = normalizePoint({ x: 30, y: 40, z: 12 }, bounds);
    assert.deepEqual(projectPoint(point), projectPoint(point));
    assert.ok(projectPoint({ x: .5, y: .5, z: 0 }).depth > projectPoint({ x: -.5, y: -.5, z: 0 }).depth);
  });

  it('keeps every normalized floor corner inside the scene safe area', () => {
    const corners = [
      { x: -.82, y: -.82 }, { x: -.82, y: .82 },
      { x: .82, y: -.82 }, { x: .82, y: .82 },
    ].map((point) => projectPoint(point));
    assert.ok(corners.every((point) => point.sx >= 80 && point.sx <= 920));
    assert.ok(corners.every((point) => point.sy >= 80 && point.sy <= 460));
  });

  it('uses every available upper lane before placing a label below', () => {
    const inputs = Array.from({ length: 4 }, (_, index) => ({ id: `S-${index}`, anchor: { x: 100, y: 90 }, width: 80, height: 24 }));
    const placements = placeLabels(inputs, { width: 200, height: 300, upperLanes: 1 });
    const firstBelow = placements.findIndex((item) => !item.hidden && item.side === 'below');
    assert.ok(firstBelow > 0);
    assert.ok(placements.slice(0, firstBelow).every((item) => !item.hidden && item.side === 'above'));
    for (const item of placements) {
      assert.equal(item.hidden, false);
      if (item.hidden) continue;
      assert.equal(item.leader.y2, item.side === 'above' ? item.rect.y + item.rect.height : item.rect.y);
    }
    assert.deepEqual(placements, placeLabels(inputs, { width: 200, height: 300, upperLanes: 1 }));
  });

  it('uses the full usable upper height by default before placing below', () => {
    const inputs = Array.from({ length: 7 }, (_, index) => ({ id: `upper-${index}`, anchor: { x: 56, y: 300 }, width: 100, height: 20 }));
    const placements = placeLabels(inputs, { width: 112, height: 360, laneGap: 10 });
    assert.ok(placements.every((item) => !item.hidden && item.side === 'above'));
  });

  it('places a dense shared-anchor set deterministically without overlap', () => {
    const inputs = Array.from({ length: 30 }, (_, index) => ({ id: `dense-${index.toString().padStart(2, '0')}`, anchor: { x: 500, y: 300 }, width: 112, height: 38 }));
    const placements = placeLabels(inputs);
    assert.equal(placements.length, inputs.length);
    assert.ok(placements.every((item) => !item.hidden && item.rect));
    for (let left = 0; left < placements.length; left += 1) {
      for (let right = left + 1; right < placements.length; right += 1) {
        const leftPlacement = placements[left]!;
        const rightPlacement = placements[right]!;
        assert.equal(leftPlacement.hidden, false);
        assert.equal(rightPlacement.hidden, false);
        if (leftPlacement.hidden || rightPlacement.hidden) continue;
        const a = leftPlacement.rect;
        const b = rightPlacement.rect;
        assert.ok(a.x + a.width + 6 <= b.x || b.x + b.width + 6 <= a.x || a.y + a.height + 6 <= b.y || b.y + b.height + 6 <= a.y);
      }
    }
    assert.deepEqual(placements, placeLabels([...inputs].reverse()));
  });

  it('fans shared-coordinate personnel out by stable id without collisions', () => {
    const responders = [{ id: 'B', x: 2, y: 3 }, { id: 'A', x: 2, y: 3 }, { id: 'C', x: 2, y: 3 }];
    const first = fanOutResponders(responders);
    assert.deepEqual(first, fanOutResponders([...responders].reverse()));
    assert.equal(new Set(first.map((person) => `${person.offsetX.toFixed(3)}:${person.offsetY.toFixed(3)}`)).size, 3);
  });

  it('places active assignees beside their equipment and excludes off-shift personnel', () => {
    const room = {
      stations: [{ id: 'S-1', floorId: 'floor-1', x: 10, y: 20 }, { id: 'S-2', floorId: 'floor-2', x: 70, y: 80 }],
      issues: [{ id: 'I-1', stationId: 'S-1' }],
      assignments: [{ responderId: 'R-1', issueId: 'I-1', status: 'ACTIVE' }, { responderId: 'R-2', issueId: 'I-1', status: 'ACTIVE' }],
      responders: [
        { id: 'R-2', dutyStatus: 'ASSIGNED', publicLocation: { floorId: 'floor-2', x: 0, y: 0 } },
        { id: 'R-1', dutyStatus: 'ASSIGNED', publicLocation: { floorId: 'floor-2', x: 0, y: 0 } },
        { id: 'R-3', dutyStatus: 'OFF_SHIFT', publicLocation: { floorId: 'floor-1', x: 10, y: 20 } },
        { id: 'R-4', dutyStatus: 'AVAILABLE', publicLocation: { floorId: 'floor-2', x: 70, y: 80 } },
      ],
    };
    const people = layoutResponders(room);
    assert.deepEqual(people.map((person) => person.id), ['R-1', 'R-2', 'R-4']);
    const assigned = people.filter((person) => person.assigned);
    assert.ok(assigned.every((person) => person.floorId === 'floor-1' && person.x === 10 && person.y === 20));
    assert.equal(new Set(assigned.map((person) => `${person.offsetX}:${person.offsetY}`)).size, 2);
    assert.equal(people.find((person) => person.id === 'R-4')?.floorId, 'floor-2');
  });

  it('resolves station focus to the correct floor and projected anchor', () => {
    const stations = [{ id: 'A', floorId: 'floor-1', x: 0, y: 0 }, { id: 'B', floorId: 'floor-2', x: 10, y: 30 }, { id: 'C', floorId: 'floor-2', x: 30, y: 10 }];
    const target = stationFocus(stations, 'B');
    assert.equal(target?.floorId, 'floor-2');
    assert.equal(target?.stationId, 'B');
    assert.ok(Number.isFinite(target?.sx));
    assert.equal(stationFocus(stations, 'missing'), null);
  });
});

describe('floor viewport interaction policy', () => {
  it('requires Space plus a primary mouse drag on empty map space', () => {
    assert.equal(canStartViewportPan({ button: 0, pointerType: 'mouse', spacePressed: true, overControl: false }), true);
    assert.equal(canStartViewportPan({ button: 0, pointerType: 'mouse', spacePressed: false, overControl: false }), false);
    assert.equal(canStartViewportPan({ button: 0, pointerType: 'touch', spacePressed: true, overControl: false }), false);
    assert.equal(canStartViewportPan({ button: 0, pointerType: 'mouse', spacePressed: true, overControl: true }), false);
    assert.equal(canStartViewportPan({ button: 2, pointerType: 'mouse', spacePressed: true, overControl: false }), false);
  });

  it('supports only explicit keyboard zoom shortcuts and responsive fitting', () => {
    assert.deepEqual(viewportShortcut('+'), { type: 'zoom', delta: .25 });
    assert.deepEqual(viewportShortcut('-'), { type: 'zoom', delta: -.25 });
    assert.equal(viewportShortcut('ArrowLeft'), null);
    assert.ok(viewportFit(700, 400) < 1);
    assert.equal(viewportFit(1400, 900), 1);
  });
});
