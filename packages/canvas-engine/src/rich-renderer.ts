import {
  getBroadcastAssetSource,
  type BroadcastAsset,
  type BroadcastImageLayer,
  type BroadcastLayer,
  type BroadcastShapeLayer,
  type BroadcastSnapshot,
  type BroadcastTextLayer,
} from '@live-board/obs-protocol';
import {
  CanvasRenderer as RasterCanvasRenderer,
  type CanvasContext,
  type CanvasLike,
  type RenderMetrics,
} from './renderer-v2.js';
import { rgbaToHex } from './flood-fill.js';

interface CachedImage {
  image: CanvasImageSource;
  sha256: string;
}

export class RichCanvasRenderer {
  private readonly rasterRenderer = new RasterCanvasRenderer();
  private readonly imageCache = new Map<string, CachedImage>();
  private readonly pending = new Set<string>();
  private readonly layerCanvases = new Map<string, CanvasLike>();
  private invalidate: (() => void) | undefined;

  constructor(onInvalidate?: () => void) {
    this.invalidate = onInvalidate;
  }

  setInvalidationCallback(callback: (() => void) | undefined): void {
    this.invalidate = callback;
  }

  render(target: CanvasLike, snapshot: BroadcastSnapshot): RenderMetrics {
    const startedAt = now();
    this.primeAssets(snapshot.assets ?? []);
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
        const canvas = this.getLayerCanvas(
          layer.id,
          snapshot.canvas.width,
          snapshot.canvas.height,
        );
        const metrics = this.rasterRenderer.render(canvas, {
          ...snapshot,
          canvas: { ...snapshot.canvas, background: { type: 'transparent' } },
          layers: [layer],
          assets: [],
        });
        cacheHits += metrics.cacheHits;
        cacheMisses += metrics.cacheMisses;
        context.drawImage(canvas, 0, 0);
      } else if (layer.type === 'image') {
        const drawn = this.renderImage(context, layer, snapshot.assets ?? []);
        if (drawn) cacheHits += 1;
        else cacheMisses += 1;
      } else if (layer.type === 'text') {
        renderText(context, layer);
      } else if (layer.type === 'shape') {
        renderShape(context, layer);
      } else {
        context.fillStyle = layer.content.color;
        context.fillRect(0, 0, snapshot.canvas.width, snapshot.canvas.height);
      }
      context.restore();
    }
    context.restore();
    for (const id of this.layerCanvases.keys()) {
      if (!activeLayerIds.has(id)) this.layerCanvases.delete(id);
    }
    return {
      renderedAt: Date.now(),
      durationMs: Math.max(0, now() - startedAt),
      cacheHits,
      cacheMisses,
      layerCount: snapshot.layers.length,
    };
  }

  sampleColor(target: CanvasLike, x: number, y: number): string | null {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= target.width || py >= target.height) {
      return null;
    }
    const data = getContext(target).getImageData(px, py, 1, 1).data;
    return rgbaToHex({
      r: data[0]!,
      g: data[1]!,
      b: data[2]!,
      a: data[3]!,
    });
  }

  clear(): void {
    this.imageCache.clear();
    this.pending.clear();
    this.layerCanvases.clear();
    this.rasterRenderer.cache.clear();
  }

  private getLayerCanvas(id: string, width: number, height: number): CanvasLike {
    const existing = this.layerCanvases.get(id);
    if (existing !== undefined) {
      if (existing.width !== width) existing.width = width;
      if (existing.height !== height) existing.height = height;
      return existing;
    }
    const canvas = createCanvas(width, height);
    this.layerCanvases.set(id, canvas);
    return canvas;
  }

  private renderImage(
    context: CanvasContext,
    layer: BroadcastImageLayer,
    assets: readonly BroadcastAsset[],
  ): boolean {
    const assetId = layer.content.assetId;
    const asset = assetId === null
      ? undefined
      : assets.find((candidate) => candidate.id === assetId);
    const cached = assetId === null ? undefined : this.imageCache.get(assetId);
    if (
      asset === undefined ||
      cached === undefined ||
      cached.sha256 !== asset.sha256
    ) {
      drawImagePlaceholder(context, layer.content.width, layer.content.height);
      return false;
    }
    const crop = layer.content.crop;
    context.save();
    context.translate(
      layer.content.flipX ? layer.content.width : 0,
      layer.content.flipY ? layer.content.height : 0,
    );
    context.scale(layer.content.flipX ? -1 : 1, layer.content.flipY ? -1 : 1);
    context.drawImage(
      cached.image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      layer.content.width,
      layer.content.height,
    );
    context.restore();
    return true;
  }

  private primeAssets(assets: readonly BroadcastAsset[]): void {
    for (const asset of assets) {
      if (
        this.imageCache.get(asset.id)?.sha256 === asset.sha256 ||
        this.pending.has(asset.id)
      ) {
        continue;
      }
      if (typeof Image === 'undefined') continue;
      this.pending.add(asset.id);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        this.pending.delete(asset.id);
        this.imageCache.set(asset.id, { image, sha256: asset.sha256 });
        if (this.invalidate !== undefined) this.invalidate();
      };
      image.onerror = () => {
        this.pending.delete(asset.id);
      };
      image.src = getBroadcastAssetSource(asset);
    }
  }
}

export function renderRichSnapshotToCanvas(
  target: CanvasLike,
  snapshot: BroadcastSnapshot,
  renderer = new RichCanvasRenderer(),
): RenderMetrics {
  return renderer.render(target, snapshot);
}

function renderText(context: CanvasContext, layer: BroadcastTextLayer): void {
  const content = layer.content;
  context.font = `${content.fontStyle} ${content.fontWeight} ${content.fontSize}px ${quoteFont(content.fontFamily)}`;
  context.textBaseline = 'top';
  context.textAlign = content.align;
  context.fillStyle = content.color;
  context.shadowColor = content.shadowColor ?? 'transparent';
  context.shadowBlur = content.shadowBlur;
  context.shadowOffsetX = content.shadowOffsetX;
  context.shadowOffsetY = content.shadowOffsetY;
  const x = content.align === 'center'
    ? (content.maxWidth ?? 0) / 2
    : content.align === 'right'
      ? content.maxWidth ?? 0
      : 0;
  const lines = content.text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const y = index * content.fontSize * content.lineHeight;
    if (content.strokeColor !== null && content.strokeWidth > 0) {
      context.strokeStyle = content.strokeColor;
      context.lineWidth = content.strokeWidth * 2;
      context.lineJoin = 'round';
      if (content.maxWidth === null) context.strokeText(line, x, y);
      else context.strokeText(line, x, y, content.maxWidth);
    }
    if (content.maxWidth === null) context.fillText(line, x, y);
    else context.fillText(line, x, y, content.maxWidth);
  });
}

function renderShape(context: CanvasContext, layer: BroadcastShapeLayer): void {
  const content = layer.content;
  context.strokeStyle = content.stroke;
  context.lineWidth = content.strokeWidth;
  if (content.fill !== null) context.fillStyle = content.fill;
  context.beginPath();
  if (content.shape === 'ellipse') {
    context.ellipse(
      content.width / 2,
      content.height / 2,
      content.width / 2,
      content.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else if (content.shape === 'line') {
    context.moveTo(0, 0);
    context.lineTo(content.width, content.height);
  } else {
    roundedRectPath(
      context,
      0,
      0,
      content.width,
      content.height,
      content.cornerRadius,
    );
  }
  if (content.fill !== null && content.shape !== 'line') context.fill();
  context.stroke();
}

function roundedRectPath(
  context: CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawImagePlaceholder(
  context: CanvasContext,
  width: number,
  height: number,
): void {
  context.save();
  context.strokeStyle = '#7A8299';
  context.fillStyle = 'rgba(122,130,153,0.12)';
  context.setLineDash([8, 8]);
  context.fillRect(0, 0, width, height);
  context.strokeRect(0, 0, width, height);
  context.restore();
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
  if (mode === 'normal') return 'source-over';
  if (mode === 'add') return 'lighter';
  return mode;
}

function createCanvas(width: number, height: number): CanvasLike {
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

function quoteFont(value: string): string {
  return value.includes(' ') ? `"${value.replace(/"/g, '')}"` : value;
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
