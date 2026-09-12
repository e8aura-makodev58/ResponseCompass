export interface PanStart { button: number; pointerType: string; spacePressed: boolean; overControl: boolean }
export function canStartViewportPan(input: PanStart): boolean;
export function viewportShortcut(key: string): { type: 'zoom'; delta: number } | null;
export function viewportFit(width: number, height: number, padding?: number): number;
