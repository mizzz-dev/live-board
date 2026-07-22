import type { Point } from './geometry.js';

export type SelectionMode = 'rectangle' | 'ellipse' | 'lasso';

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSelection {
  mode: SelectionMode;
  points: Point[];
  bounds: SelectionBounds;
}

export interface SelectionTransformDelta {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export function createCanvasSelection(
  mode: SelectionMode,
  points: readonly Point[],
): CanvasSelection {
  if (points.length < 2) throw new Error('SELECTION_POINTS_REQUIRED');
  const normalized = points.map(assertPoint);
  const bounds = boundsFromPoints(normalized);
  if (bounds.width < 1 || bounds.height < 1) {
    throw new Error('SELECTION_ZERO_AREA');
  }
  if (mode === 'lasso' && normalized.length < 3) {
    throw new Error('SELECTION_LASSO_POINTS_REQUIRED');
  }
  return { mode, points: normalized, bounds };
}

export function updateDragSelection(
  mode: Exclude<SelectionMode, 'lasso'>,
  start: Point,
  current: Point,
): CanvasSelection {
  return createCanvasSelection(mode, [start, current]);
}

export function hitTestSelection(
  selection: CanvasSelection,
  point: Point,
): boolean {
  const target = assertPoint(point);
  const bounds = selection.bounds;
  if (
    target.x < bounds.x ||
    target.y < bounds.y ||
    target.x > bounds.x + bounds.width ||
    target.y > bounds.y + bounds.height
  ) return false;
  if (selection.mode === 'rectangle') return true;
  if (selection.mode === 'ellipse') {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const normalizedX = (target.x - centerX) / (bounds.width / 2);
    const normalizedY = (target.y - centerY) / (bounds.height / 2);
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }
  return pointInPolygon(selection.points, target);
}

export function moveSelection(
  selection: CanvasSelection,
  deltaX: number,
  deltaY: number,
): CanvasSelection {
  assertFinite(deltaX, 'SELECTION_INVALID_TRANSLATE');
  assertFinite(deltaY, 'SELECTION_INVALID_TRANSLATE');
  const points = selection.points.map((point) => ({
    x: point.x + deltaX,
    y: point.y + deltaY,
  }));
  return { ...selection, points, bounds: boundsFromPoints(points) };
}

export function scaleSelection(
  selection: CanvasSelection,
  scaleX: number,
  scaleY: number,
  anchor: Point = selectionCenter(selection),
): CanvasSelection {
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX === 0 || scaleY === 0 || Math.abs(scaleX) > 1_000 || Math.abs(scaleY) > 1_000) {
    throw new Error('SELECTION_INVALID_SCALE');
  }
  const fixed = assertPoint(anchor);
  const points = selection.points.map((point) => ({
    x: fixed.x + (point.x - fixed.x) * scaleX,
    y: fixed.y + (point.y - fixed.y) * scaleY,
  }));
  return { ...selection, points, bounds: boundsFromPoints(points) };
}

export function rotateSelection(
  selection: CanvasSelection,
  degrees: number,
  anchor: Point = selectionCenter(selection),
): CanvasSelection {
  assertFinite(degrees, 'SELECTION_INVALID_ROTATION');
  if (Math.abs(degrees) > 360_000) throw new Error('SELECTION_INVALID_ROTATION');
  const fixed = assertPoint(anchor);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const points = selection.points.map((point) => {
    const x = point.x - fixed.x;
    const y = point.y - fixed.y;
    return {
      x: fixed.x + x * cosine - y * sine,
      y: fixed.y + x * sine + y * cosine,
    };
  });
  return { ...selection, points, bounds: boundsFromPoints(points) };
}

export function selectionCenter(selection: CanvasSelection): Point {
  return {
    x: selection.bounds.x + selection.bounds.width / 2,
    y: selection.bounds.y + selection.bounds.height / 2,
  };
}

export function selectionTransformDelta(
  before: CanvasSelection,
  after: CanvasSelection,
): SelectionTransformDelta {
  const beforeCenter = selectionCenter(before);
  const afterCenter = selectionCenter(after);
  return {
    translateX: afterCenter.x - beforeCenter.x,
    translateY: afterCenter.y - beforeCenter.y,
    scaleX: after.bounds.width / before.bounds.width,
    scaleY: after.bounds.height / before.bounds.height,
    rotation: estimateRotation(before, after),
  };
}

export function clampSelectionToCanvas(
  selection: CanvasSelection,
  width: number,
  height: number,
): CanvasSelection {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('SELECTION_INVALID_CANVAS');
  }
  const deltaX = selection.bounds.x < 0
    ? -selection.bounds.x
    : selection.bounds.x + selection.bounds.width > width
      ? width - selection.bounds.x - selection.bounds.width
      : 0;
  const deltaY = selection.bounds.y < 0
    ? -selection.bounds.y
    : selection.bounds.y + selection.bounds.height > height
      ? height - selection.bounds.y - selection.bounds.height
      : 0;
  return moveSelection(selection, deltaX, deltaY);
}

function boundsFromPoints(points: readonly Point[]): SelectionBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function pointInPolygon(points: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index]!;
    const previousPoint = points[previous]!;
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || Number.EPSILON) +
        currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function estimateRotation(before: CanvasSelection, after: CanvasSelection): number {
  if (before.points.length < 2 || after.points.length < 2) return 0;
  const beforeCenter = selectionCenter(before);
  const afterCenter = selectionCenter(after);
  const beforeAngle = Math.atan2(
    before.points[0]!.y - beforeCenter.y,
    before.points[0]!.x - beforeCenter.x,
  );
  const afterAngle = Math.atan2(
    after.points[0]!.y - afterCenter.y,
    after.points[0]!.x - afterCenter.x,
  );
  return (afterAngle - beforeAngle) * 180 / Math.PI;
}

function assertPoint(point: Point): Point {
  assertFinite(point.x, 'SELECTION_INVALID_POINT');
  assertFinite(point.y, 'SELECTION_INVALID_POINT');
  return { x: point.x, y: point.y };
}

function assertFinite(value: number, code: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) throw new Error(code);
}
