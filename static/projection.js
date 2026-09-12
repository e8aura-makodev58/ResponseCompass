const DEFAULT_CAMERA = Object.freeze({
  width: 1000,
  height: 520,
  centerX: 500,
  centerY: 270,
  scaleX: 250,
  scaleY: 110,
  heightScale: 1.15,
});

/** Deterministic affine isometric projection; no DOM/layout reads. */
export function projectPoint(point, camera = DEFAULT_CAMERA) {
  const nx = Number(point.x);
  const ny = Number(point.y);
  const z = Number(point.z || 0);
  return {
    sx: camera.centerX + (nx - ny) * camera.scaleX,
    sy: camera.centerY + (nx + ny) * camera.scaleY - z * camera.heightScale,
    depth: nx + ny + z / 100,
  };
}

export function coordinateBounds(points) {
  if (!points.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX: minX === maxX ? minX - 1 : minX,
    maxX: minX === maxX ? maxX + 1 : maxX,
    minY: minY === maxY ? minY - 1 : minY,
    maxY: minY === maxY ? maxY + 1 : maxY,
  };
}

export function normalizePoint(point, bounds) {
  return {
    x: -0.82 + ((Number(point.x) - bounds.minX) / (bounds.maxX - bounds.minX)) * 1.64,
    y: -0.82 + ((Number(point.y) - bounds.minY) / (bounds.maxY - bounds.minY)) * 1.64,
    z: Number(point.z || 0),
  };
}

function intersects(a, b, gap = 6) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

function horizontalCandidates(item, width, edge, gap) {
  const minimum = edge;
  const maximum = width - edge - item.width;
  if (maximum < minimum) return [];
  const preferred = Math.max(minimum, Math.min(maximum, item.anchor.x - item.width / 2));
  const candidates = [preferred, minimum, maximum];
  for (let x = minimum; x <= maximum; x += item.width + gap) candidates.push(x);
  return [...new Set(candidates.map((value) => Number(value.toFixed(3))))]
    .sort((a, b) => Math.abs(a + item.width / 2 - item.anchor.x) - Math.abs(b + item.width / 2 - item.anchor.x) || a - b);
}

/** Upper lanes are searched exhaustively before any lower lane is considered. */
export function placeLabels(items, options = {}) {
  const width = options.width || 1000;
  const height = options.height || 520;
  const upperLanes = options.upperLanes ?? items.length + 6;
  const laneGap = options.laneGap || 10;
  const edge = options.edge || 6;
  const placed = [];
  const results = [];
  const ordered = [...items].sort((a, b) => a.anchor.y - b.anchor.y || String(a.id).localeCompare(String(b.id)));

  for (const item of ordered) {
    const horizontal = horizontalCandidates(item, width, edge, 6);
    let candidate = null;
    for (let lane = 0; lane < upperLanes && !candidate; lane += 1) {
      for (const x of horizontal) {
        const rect = {
          x,
          y: item.anchor.y - 25 - item.height - lane * (item.height + laneGap),
          width: item.width,
          height: item.height,
        };
        if (rect.x >= edge && rect.x + rect.width <= width - edge && rect.y >= edge && !placed.some((other) => intersects(rect, other))) {
          candidate = { rect, side: 'above', lane };
          break;
        }
      }
    }
    for (let lane = 0; !candidate && lane < items.length + 6; lane += 1) {
      for (const x of horizontal) {
        const rect = {
          x,
          y: item.anchor.y + 25 + lane * (item.height + laneGap),
          width: item.width,
          height: item.height,
        };
        if (rect.x >= edge && rect.x + rect.width <= width - edge && rect.y + rect.height <= height - edge && !placed.some((other) => intersects(rect, other))) {
          candidate = { rect, side: 'below', lane };
          break;
        }
      }
    }
    if (!candidate) {
      for (let y = edge; y + item.height <= height - edge && !candidate; y += item.height + laneGap) {
        for (const x of horizontal) {
          const rect = { x, y, width: item.width, height: item.height };
          if (!placed.some((other) => intersects(rect, other))) {
            candidate = { rect, side: y + item.height / 2 < item.anchor.y ? 'above' : 'below', lane: -1 };
            break;
          }
        }
      }
    }
    if (!candidate) {
      results.push({ id: item.id, hidden: true });
      continue;
    }
    placed.push(candidate.rect);
    results.push({
      id: item.id,
      hidden: false,
      ...candidate,
      leader: {
        x1: item.anchor.x,
        y1: item.anchor.y,
        x2: Math.max(candidate.rect.x, Math.min(candidate.rect.x + candidate.rect.width, item.anchor.x)),
        y2: candidate.side === 'above' ? candidate.rect.y + candidate.rect.height : candidate.rect.y,
      },
    });
  }
  return results;
}

/** Stable id sorting prevents personnel at one public coordinate from stacking. */
export function fanOutResponders(responders, radius = 28) {
  const groups = new Map();
  for (const responder of responders) {
    const key = `${responder.floorId || ''}:${Number(responder.x).toFixed(3)}:${Number(responder.y).toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(responder);
  }
  const result = [];
  for (const group of groups.values()) {
    group.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    group.forEach((responder, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / group.length;
      result.push({ ...responder, offsetX: Math.cos(angle) * radius, offsetY: Math.sin(angle) * radius });
    });
  }
  return result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Resolve public event-snapshot locations; active assignments anchor beside equipment. */
export function layoutResponders(room) {
  const issues = new Map(room.issues.map((issue) => [issue.id, issue]));
  const stations = new Map(room.stations.map((station) => [station.id, station]));
  const assignments = new Map(room.assignments.filter((assignment) => assignment.status === 'ACTIVE').map((assignment) => [assignment.responderId, assignment]));
  const visible = room.responders.filter((person) => person.dutyStatus !== 'OFF_SHIFT').map((person) => {
    const assignment = assignments.get(person.id);
    const assignedStation = assignment ? stations.get(issues.get(assignment.issueId)?.stationId) : null;
    const location = assignedStation || person.publicLocation;
    return { ...person, floorId: location.floorId, x: location.x, y: location.y, assigned: Boolean(assignedStation) };
  });
  return fanOutResponders(visible, 28);
}

/** Compute the selected station's stable projected anchor and floor. */
export function stationFocus(stations, stationId) {
  const station = stations.find((candidate) => candidate.id === stationId);
  if (!station) return null;
  const floorStations = stations.filter((candidate) => candidate.floorId === station.floorId);
  const point = projectPoint(normalizePoint(station, coordinateBounds(floorStations)));
  return { floorId: station.floorId, stationId: station.id, ...point };
}
