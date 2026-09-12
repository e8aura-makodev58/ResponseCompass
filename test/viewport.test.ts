import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coordinateBounds, fanOutResponders, normalizePoint, placeLabels, projectPoint } from '../static/projection.js';

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
});
