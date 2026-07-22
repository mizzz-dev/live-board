export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  flipX: boolean;
}

export interface SnapSettings {
  enabled: boolean;
  gridSize: number;
  guideX: number[];
  guideY: number[];
  threshold: number;
}

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = Object.freeze({
  zoom: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
  flipX: false,
});

export function assertViewport(viewport: CanvasViewport): void {
  if (
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom < 0.05 ||
    viewport.zoom > 32 ||
    !Number.isFinite(viewport.panX) ||
    !Number.isFinite(viewport.panY) ||
    !Number.isFinite(viewport.rotation) ||
    Math.abs(viewport.rotation) > 360_000
  ) {
    throw new Error('CANVAS_INVALID_VIEWPORT');
  }
}

export function canvasToScreen(
  point: Point,
  viewport: CanvasViewport,
  viewportSize: Size,
  canvasSize: Size,
): Point {
  assertViewport(viewport);
  const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
  const localX = (point.x - center.x) * (viewport.flipX ? -1 : 1);
  const localY = point.y - center.y;
  const rotated = rotate({ x: localX, y: localY }, viewport.rotation);
  return {
    x: viewportSize.width / 2 + viewport.panX + rotated.x * viewport.zoom,
    y: viewportSize.height / 2 + viewport.panY + rotated.y * viewport.zoom,
  };
}

export function screenToCanvas(
  point: Point,
  viewport: CanvasViewport,
  viewportSize: Size,
  canvasSize: Size,
): Point {
  assertViewport(viewport);
  const translated = {
    x: (point.x - viewportSize.width / 2 - viewport.panX) / viewport.zoom,
    y: (point.y - viewportSize.height / 2 - viewport.panY) / viewport.zoom,
  };
  const unrotated = rotate(translated, -viewport.rotation);
  return {
    x: canvasSize.width / 2 + unrotated.x * (viewport.flipX ? -1 : 1),
    y: canvasSize.height / 2 + unrotated.y,
  };
}

export function zoomViewportAt(
  viewport: CanvasViewport,
  screenPoint: Point,
  nextZoom: number,
  viewportSize: Size,
  canvasSize: Size,
): CanvasViewport {
  const clampedZoom = clamp(nextZoom, 0.05, 32);
  const before = screenToCanvas(screenPoint, viewport, viewportSize, canvasSize);
  const candidate = { ...viewport, zoom: clampedZoom };
  const afterScreen = canvasToScreen(before, candidate, viewportSize, canvasSize);
  return {
    ...candidate,
    panX: candidate.panX + screenPoint.x - afterScreen.x,
    panY: candidate.panY + screenPoint.y - afterScreen.y,
  };
}

export function panViewport(
  viewport: CanvasViewport,
  deltaX: number,
  deltaY: number,
): CanvasViewport {
  return {
    ...viewport,
    panX: viewport.panX + finite(deltaX),
    panY: viewport.panY + finite(deltaY),
  };
}

export function snapCanvasPoint(point: Point, settings: SnapSettings): Point {
  if (!settings.enabled) return { ...point };
  if (
    !Number.isFinite(settings.gridSize) ||
    settings.gridSize <= 0 ||
    !Number.isFinite(settings.threshold) ||
    settings.threshold < 0
  ) {
    throw new Error('CANVAS_INVALID_SNAP_SETTINGS');
  }
  let x = snapToValue(point.x, Math.round(point.x / settings.gridSize) * settings.gridSize, settings.threshold);
  let y = snapToValue(point.y, Math.round(point.y / settings.gridSize) * settings.gridSize, settings.threshold);
  for (const guide of settings.guideX) {
    x = snapToValue(x, guide, settings.threshold);
  }
  for (const guide of settings.guideY) {
    y = snapToValue(y, guide, settings.threshold);
  }
  return { x, y };
}

export function viewportTransformCss(
  viewport: CanvasViewport,
  canvasSize: Size,
): string {
  assertViewport(viewport);
  const flip = viewport.flipX ? -1 : 1;
  return [
    `translate(${viewport.panX}px, ${viewport.panY}px)`,
    `rotate(${viewport.rotation}deg)`,
    `scale(${viewport.zoom * flip}, ${viewport.zoom})`,
    `translate(${-canvasSize.width / 2}px, ${-canvasSize.height / 2}px)`,
  ].join(' ');
}

function rotate(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

function snapToValue(value: number, target: number, threshold: number): number {
  return Math.abs(value - target) <= threshold ? target : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('CANVAS_INVALID_DELTA');
  return value;
}
