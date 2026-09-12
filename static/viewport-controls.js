/** Pure interaction policy keeps map gestures testable without a browser. */
export function canStartViewportPan({ button, pointerType, spacePressed, overControl }) {
  return button === 0 && pointerType === 'mouse' && spacePressed === true && overControl === false;
}

export function viewportShortcut(key) {
  if (key === '+' || key === '=') return { type: 'zoom', delta: .25 };
  if (key === '-' || key === '_') return { type: 'zoom', delta: -.25 };
  return null;
}

export function viewportFit(width, height, padding = 16) {
  return Math.max(.25, Math.min(1, (width - padding * 2) / 1000, (height - padding * 2) / 520));
}
