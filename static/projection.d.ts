export interface Point { x: number; y: number; z?: number }
export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }
export interface Camera { width: number; height: number; centerX: number; centerY: number; scaleX: number; scaleY: number; heightScale: number }
export interface LabelInput { id: string; anchor: { x: number; y: number }; width: number; height: number }
export type LabelPlacement =
  | { id: string; hidden: true }
  | { id: string; hidden: false; side: 'above' | 'below'; lane: number; rect: { x: number; y: number; width: number; height: number }; leader: { x1: number; y1: number; x2: number; y2: number } };
export function projectPoint(point: Point, camera?: Camera): { sx: number; sy: number; depth: number };
export function coordinateBounds(points: Point[]): Bounds;
export function normalizePoint(point: Point, bounds: Bounds): Point;
export function placeLabels(items: LabelInput[], options?: { width?: number; height?: number; upperLanes?: number; laneGap?: number; edge?: number }): LabelPlacement[];
export function fanOutResponders<T extends { id: string; x: number; y: number }>(responders: T[], radius?: number): Array<T & { offsetX: number; offsetY: number }>;
export function layoutResponders<T extends { responders: Array<{ id: string; dutyStatus: string; publicLocation: Point & { floorId: string } }>; assignments: Array<{ responderId: string; issueId: string; status: string }>; issues: Array<{ id: string; stationId: string }>; stations: Array<Point & { id: string; floorId: string }> }>(room: T): Array<T['responders'][number] & { floorId: string; x: number; y: number; assigned: boolean; offsetX: number; offsetY: number }>;
export function stationFocus<T extends Point & { id: string; floorId: string }>(stations: T[], stationId: string): ({ floorId: string; stationId: string; sx: number; sy: number; depth: number } | null);
