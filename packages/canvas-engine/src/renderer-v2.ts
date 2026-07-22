import type {
  BroadcastLayer,
  BroadcastRasterLayer,
  BroadcastSnapshot,
  RasterFill,
  RasterPoint,
  RasterStroke,
} from '@live-board/obs-protocol';
import { floodFillPixels, parseHexColor, rgbaToHex } from './flood-fill.js';
import { pressureFactor } from './tools.js';

export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
export type CanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;
export type CanvasFactory = (width: number, height: number) => CanvasLike;

export interface RenderMetrics {
  renderedAt: number;
  durationMs: number;
  cacheHits: number;
  cacheMisses: number;
  layerCount: number;
}

interface CacheEntry {
  signature: string;
  canvas: CanvasLike;
}

type RasterOperation =
  | { type: 'stroke'; value: RasterStroke; sequence: number; stableIndex: number }
  | { type: 'fill'; value: RasterFill; sequence: number; stableIndex: number };

export class CanvasLayerCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly createCanvas: CanvasFactory;

  constructor(createCanvas: CanvasFactory = defaultCanvasFactory) {
    this.createCanvas = createCanvas;
  }

  getRasterLayer(
    layer: BroadcastRasterLayer,
    width: number,
    height: number,
  ): { canvas: CanvasLike; hit: boolean } {
    const signature = [
      width,
      height,
      layer.content.assetId ?? '',
      layer.content.drawing.revision,
      layer.opacity,
      layer.blendMode,
    ].join(':');
    const cached = this.entries.get(layer.id);
    if (cached?.signature === signature) {
      return { canvas: cached.canvas, hit: true };
    }
    const canvas = this.createCanvas(width, height);
    renderRasterDrawing(canvas, layer, width, height);
    this.entries.set(layer.id, { signature, canvas });
    return { canvas, hit: false };
  }

  clearLayer(layerId: string): void {
    this.entries.delete(layerId);
  }

  retain(layerIds: ReadonlySet<string>): void {
    for (const layerId of this.entries.keys()) {
      if (!layerIds.has(layerId)) this.entries.delete(layerId);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export class CanvasRenderer {
  readonly cache: CanvasLayerCache;

  constructor(cache = new CanvasLayerCache()) {
    this.cache = cache;
  }

  render(target: CanvasLike, snapshot: BroadcastSnapshot): RenderMetrics {
    const startedAt = performanceNow();
    target.width = snapshot.canvas.width;
    target.height = snapshot.canvas.height;
    const context = getContext(target);
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, target.width, target.height);
    if (snapshot.canvas.background.type === 'color') {
      context.fillStyle = snapshot.canvas.background.value;
      context.fillRect(0, 0, target.width, target.height);
    }

    let cacheHits = 0;
    let cacheMisses = 0;
    const activeLayerIds = new Set(snapshot.layers.map((layer) => layer.id));
    for (const layer of snapshot.layers) {
      if (layer.type === 'folder') continue;
      context.save();
      applyLayerState(context, layer);
      if (layer.type === 'raster') {
        const cached = this.cache.getRasterLayer(
          layer,
          snapshot.canvas.width,
          snapshot.canvas.height,
        );
        if (cached.hit) cacheHits += 1;
        else cacheMisses += 1;
        context.drawImage(cached.canvas, 0, 0);
      } else {
        renderVectorLayer(
          context,
          layer,
          snapshot.canvas.width,
          snapshot.canvas.height,
        );
      }
      context.restore();
    }
    context.restore();
    this.cache.retain(activeLayerIds);
    return {
      renderedAt: Date.now(),
      durationMs: Math.max(0, performanceNow() - startedAt),
      cacheHits,
      cacheMisses,
      layerCount: snapshot.layers.length,
    };
  }

  sampleColor(target: CanvasLike, x: number, y: number): string | null {
    const context = getContext(target);
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= target.width || py >= target.height) {
      return null;
    }
    const data = context.getImageData(px, py, 1, 1).data;
    return rgbaToHex({
      r: data[0]!,
      g: data[1]!,
      b: data[2]!,
      a: data[3]!,
    });
  }
}

export function renderSnapshotToCanvas(
  target: CanvasLike,
  snapshot: BroadcastSnapshot,
  renderer = new CanvasRenderer(),
): RenderMetrics {
  return renderer.render(target, snapshot);
}

export function listRasterOperations(
  layer: BroadcastRasterLayer,
): RasterOperation[] {
  const legacyStrokeCount = layer.content.drawing.strokes.length;
  return [
    ...layer.content.drawing.strokes.map((value, index) => ({
      type: 'stroke' as const,
      value,
      sequence: value.sequence ?? index + 1,
      stableIndex: index,
    })),
    ...layer.content.drawing.fills.map((value, index) => ({
      type: 'fill' as const,
      value,
      sequence: value.sequence ?? legacyStrokeCount + index + 1,
      stableIndex: legacyStrokeCount + index,
    })),
  ].sort(
    (left, right) =>
      left.sequence - right.sequence || left.stableIndex - right.stableIndex,
  );
}

function renderRasterDrawing(
  canvas: CanvasLike,
  layer: BroadcastRasterLayer,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const context = getContext(canvas);
  context.clearRect(0, 0, width, height);
  for (const operation of listRasterOperations(layer)) {
    if (operation.type === 'stroke') {
      renderStroke(context, operation.value);
    } else {
      renderFill(context, operation.value, width, height);
    }
  }
}

function renderFill(
  context: CanvasContext,
  fill: RasterFill,
  width: number,
  height: number,
): void {
  const imageData = context.getImageData(0, 0, width, height);
  floodFillPixels(
    imageData.data,
    width,
    height,
    fill.x,
    fill.y,
    parseHexColor(fill.color, fill.opacity),
    fill.tolerance,
  );
  context.putImageData(imageData, 0, 0);
}

function renderStroke(context: CanvasContext, stroke: RasterStroke): void {
  const points = stroke.points;
  if (points.length === 0) return;
  context.save();
  context.globalCompositeOperation =
    stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  const total = Math.max(1, points.length - 1);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[index + 1];
    const fraction = index / total;
    const taper = taperFactor(
      fraction,
      stroke.taperStart,
      stroke.taperEnd,
    );
    const pressure = pressureFactor(point.pressure);
    const radius =
      (stroke.size / 2) *
      taper *
      (stroke.pressureSize ? pressure : 1);
    const opacity =
      stroke.opacity * (stroke.pressureOpacity ? pressure : 1);
    stamp(
      context,
      point,
      radius,
      stroke.color,
      opacity,
      stroke.hardness,
    );
    if (next !== undefined) {
      stampSegment(
        context,
        point,
        next,
        radius,
        stroke,
        opacity,
        stroke.spacing,
      );
    }
  }
  context.restore();
}

function stampSegment(
  context: CanvasContext,
  from: RasterPoint,
  to: RasterPoint,
  fromRadius: number,
  stroke: RasterStroke,
  fromOpacity: number,
  spacing: number,
): void {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(0.5, stroke.size * Math.max(0.01, spacing));
  const count = Math.floor(distance / step);
  for (let index = 1; index <= count; index += 1) {
    const ratio = index / (count + 1);
    const pressure = pressureFactor(
      lerp(from.pressure, to.pressure, ratio),
    );
    const radius = lerp(
      fromRadius,
      (stroke.size / 2) * (stroke.pressureSize ? pressure : 1),
      ratio,
    );
    const opacity = stroke.pressureOpacity
      ? stroke.opacity * pressure
      : fromOpacity;
    stamp(
      context,
      {
        x: lerp(from.x, to.x, ratio),
        y: lerp(from.y, to.y, ratio),
      },
      radius,
      stroke.color,
      opacity,
      stroke.hardness,
    );
  }
}

function stamp(
  context: CanvasContext,
  point: { x: number; y: number },
  radius: number,
  color: string,
  opacity: number,
  hardness: number,
): void {
  if (radius <= 0 || opacity <= 0) return;
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0, opacity));
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  if (hardness >= 0.99) {
    context.fillStyle = color;
  } else {
    const innerRadius = radius * Math.max(0, Math.min(1, hardness));
    const gradient = context.createRadialGradient(
      point.x,
      point.y,
      innerRadius,
      point.x,
      point.y,
      radius,
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, `${color.slice(0, 7)}00`);
    context.fillStyle = gradient;
  }
  context.fill();
  context.restore();
}

function renderVectorLayer(
  context: CanvasContext,
  layer: Exclude<BroadcastLayer, BroadcastRasterLayer | { type: 'folder' }>,
  width: number,
  height: number,
): void {
  switch (layer.type) {
    case 'background':
      context.fillStyle = layer.content.color;
      context.fillRect(0, 0, width, height);
      return;
    case 'text':
      context.fillStyle = layer.content.color;
      context.font = `${layer.content.fontSize}px ${layer.content.fontFamily}`;
      context.textBaseline = 'top';
      context.fillText(layer.content.text, 0, 0);
      return;
    case 'shape':
      context.strokeStyle = layer.content.stroke;
      context.lineWidth = layer.content.strokeWidth;
      if (layer.content.fill !== null) {
        context.fillStyle = layer.content.fill;
      }
      if (layer.content.shape === 'rectangle') {
        if (layer.content.fill !== null) context.fillRect(0, 0, 240, 160);
        context.strokeRect(0, 0, 240, 160);
      } else if (layer.content.shape === 'ellipse') {
        context.beginPath();
        context.ellipse(120, 80, 120, 80, 0, 0, Math.PI * 2);
        if (layer.content.fill !== null) context.fill();
        context.stroke();
      } else {
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(240, 160);
        context.stroke();
      }
      return;
    case 'image':
      context.save();
      context.strokeStyle = '#7A8299';
      context.setLineDash([8, 8]);
      context.strokeRect(
        0,
        0,
        layer.content.width,
        layer.content.height,
      );
      context.restore();
      return;
  }
}

function applyLayerState(
  context: CanvasContext,
  layer: Exclude<BroadcastLayer, { type: 'folder' }>,
): void {
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = blendMode(layer.blendMode);
  context.translate(layer.transform.x, layer.transform.y);
  context.rotate((layer.transform.rotation * Math.PI) / 180);
  context.scale(layer.transform.scaleX, layer.transform.scaleY);
}

function blendMode(
  mode: BroadcastLayer['blendMode'],
): GlobalCompositeOperation {
  switch (mode) {
    case 'normal':
      return 'source-over';
    case 'add':
      return 'lighter';
    case 'multiply':
    case 'screen':
    case 'overlay':
      return mode;
  }
}

function taperFactor(
  fraction: number,
  start: number,
  end: number,
): number {
  const startFactor = start <= 0 ? 1 : Math.min(1, fraction / start);
  const endFactor = end <= 0 ? 1 : Math.min(1, (1 - fraction) / end);
  return Math.max(0.05, Math.min(startFactor, endFactor));
}

function defaultCanvasFactory(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('CANVAS_FACTORY_UNAVAILABLE');
}

function getContext(canvas: CanvasLike): CanvasContext {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE');
  return context as CanvasContext;
}

function performanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}
