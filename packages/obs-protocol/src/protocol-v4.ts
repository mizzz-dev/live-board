import {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  createEmptyRasterDrawing,
  parseBroadcastLayer as parseBaseBroadcastLayer,
  parseBroadcastSnapshot as parseBaseBroadcastSnapshot,
  parseObsBridgeClientMessage,
  parsePageTransition,
  parseRasterDrawing,
  type BroadcastLayer as BaseBroadcastLayer,
  type BroadcastSnapshot as BaseBroadcastSnapshot,
} from './protocol-v3.js';

export {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  createEmptyRasterDrawing,
  parseObsBridgeClientMessage,
  parsePageTransition,
  parseRasterDrawing,
};
export type {
  BroadcastBackground,
  BroadcastBackgroundLayer,
  BroadcastBlendMode,
  BroadcastFolderLayer,
  BroadcastRasterLayer,
  BroadcastTransform,
  ObsBridgeClientMessage,
  PageTransition,
  RasterDrawing,
  RasterFill,
  RasterPoint,
  RasterStroke,
} from './protocol-v3.js';

export type BroadcastAssetMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/svg+xml';

export interface BroadcastAsset {
  id: string;
  sha256: string;
  mime: BroadcastAssetMime;
  width: number;
  height: number;
  byteLength: number;
  dataUrl: string;
  animated: false;
  sanitized: boolean;
}

type BaseTextLayer = Extract<BaseBroadcastLayer, { type: 'text' }>;
type BaseImageLayer = Extract<BaseBroadcastLayer, { type: 'image' }>;
type BaseShapeLayer = Extract<BaseBroadcastLayer, { type: 'shape' }>;

export interface BroadcastTextLayer extends Omit<BaseTextLayer, 'content'> {
  content: BaseTextLayer['content'] & {
    fontWeight: number;
    fontStyle: 'normal' | 'italic';
    align: 'left' | 'center' | 'right';
    lineHeight: number;
    strokeColor: string | null;
    strokeWidth: number;
    shadowColor: string | null;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    maxWidth: number | null;
  };
}

export interface BroadcastImageLayer extends Omit<BaseImageLayer, 'content'> {
  content: BaseImageLayer['content'] & {
    crop: { x: number; y: number; width: number; height: number };
    flipX: boolean;
    flipY: boolean;
  };
}

export interface BroadcastShapeLayer extends Omit<BaseShapeLayer, 'content'> {
  content: BaseShapeLayer['content'] & {
    width: number;
    height: number;
    cornerRadius: number;
  };
}

export type BroadcastLayer =
  | Exclude<BaseBroadcastLayer, BaseTextLayer | BaseImageLayer | BaseShapeLayer>
  | BroadcastTextLayer
  | BroadcastImageLayer
  | BroadcastShapeLayer;

export interface BroadcastSnapshot extends Omit<BaseBroadcastSnapshot, 'layers'> {
  layers: BroadcastLayer[];
  assets?: BroadcastAsset[];
}

export type ObsBridgeServerMessage =
  | { type: 'pong'; timestamp: number }
  | { type: 'snapshot'; snapshot: BroadcastSnapshot }
  | {
      type: 'page.changed';
      snapshot: BroadcastSnapshot;
      transition: import('./protocol-v3.js').PageTransition;
    }
  | { type: 'layer.updated'; snapshot: BroadcastSnapshot };

export function parseBroadcastAsset(input: unknown): BroadcastAsset {
  if (!isRecord(input)) throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  if (
    !isEntityId(input.id) ||
    typeof input.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(input.sha256) ||
    !isAssetMime(input.mime) ||
    !isDimension(input.width) ||
    !isDimension(input.height) ||
    input.width * input.height > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > 25 * 1024 * 1024 ||
    typeof input.dataUrl !== 'string' ||
    input.dataUrl.length > 36 * 1024 * 1024 ||
    !input.dataUrl.startsWith(`data:${input.mime};base64,`) ||
    input.animated !== false ||
    typeof input.sanitized !== 'boolean' ||
    (input.mime === 'image/svg+xml' && !input.sanitized)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }
  return {
    id: input.id,
    sha256: input.sha256.toLowerCase(),
    mime: input.mime,
    width: input.width,
    height: input.height,
    byteLength: input.byteLength,
    dataUrl: input.dataUrl,
    animated: false,
    sanitized: input.sanitized,
  };
}

export function parseBroadcastLayer(input: unknown): BroadcastLayer {
  const base = parseBaseBroadcastLayer(input);
  if (!isRecord(input) || !isRecord(input.content)) return base as BroadcastLayer;
  const content = input.content;
  if (base.type === 'text') {
    return {
      ...base,
      content: {
        ...base.content,
        fontWeight: integerRange(content.fontWeight, 100, 900, 400, 100),
        fontStyle: content.fontStyle === 'italic' ? 'italic' : 'normal',
        align:
          content.align === 'center' || content.align === 'right'
            ? content.align
            : 'left',
        lineHeight: numberRange(content.lineHeight, 0.5, 4, 1.2),
        strokeColor: nullableColor(content.strokeColor),
        strokeWidth: numberRange(content.strokeWidth, 0, 100, 0),
        shadowColor: nullableColor(content.shadowColor),
        shadowBlur: numberRange(content.shadowBlur, 0, 500, 0),
        shadowOffsetX: numberRange(content.shadowOffsetX, -10_000, 10_000, 0),
        shadowOffsetY: numberRange(content.shadowOffsetY, -10_000, 10_000, 0),
        maxWidth: nullableNumberRange(content.maxWidth, 1, 32_768),
      },
    };
  }
  if (base.type === 'image') {
    return {
      ...base,
      content: {
        ...base.content,
        crop: parseCrop(content.crop, base.content.width, base.content.height),
        flipX: content.flipX === true,
        flipY: content.flipY === true,
      },
    };
  }
  if (base.type === 'shape') {
    return {
      ...base,
      content: {
        ...base.content,
        width: numberRange(content.width, 1, 32_768, 240),
        height: numberRange(content.height, 1, 32_768, 160),
        cornerRadius: numberRange(content.cornerRadius, 0, 16_384, 0),
      },
    };
  }
  return base as BroadcastLayer;
}

export function parseBroadcastSnapshot(input: unknown): BroadcastSnapshot {
  const base = parseBaseBroadcastSnapshot(input);
  const rawLayers =
    isRecord(input) && Array.isArray(input.layers) ? input.layers : [];
  const assets =
    isRecord(input) && input.assets !== undefined
      ? parseAssetList(input.assets)
      : undefined;
  const layers = base.layers.map((_, index) =>
    parseBroadcastLayer(rawLayers[index]),
  );
  const assetIds = new Set(assets?.map((asset) => asset.id) ?? []);
  for (const layer of layers) {
    if (
      layer.type === 'image' &&
      layer.content.assetId !== null &&
      !assetIds.has(layer.content.assetId)
    ) {
      throw new Error('OBS_PROTOCOL_IMAGE_ASSET_NOT_FOUND');
    }
  }
  return { ...base, layers, ...(assets === undefined ? {} : { assets }) };
}

export function parseObsBridgeServerMessage(
  input: unknown,
): ObsBridgeServerMessage {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new Error('OBS_PROTOCOL_INVALID_SERVER_MESSAGE');
  }
  if (input.type === 'pong') {
    if (
      typeof input.timestamp !== 'number' ||
      !Number.isFinite(input.timestamp) ||
      input.timestamp < 0
    ) {
      throw new Error('OBS_PROTOCOL_INVALID_SERVER_MESSAGE');
    }
    return { type: 'pong', timestamp: input.timestamp };
  }
  if (input.type === 'snapshot' || input.type === 'layer.updated') {
    return { type: input.type, snapshot: parseBroadcastSnapshot(input.snapshot) };
  }
  if (input.type === 'page.changed') {
    return {
      type: 'page.changed',
      snapshot: parseBroadcastSnapshot(input.snapshot),
      transition: parsePageTransition(input.transition),
    };
  }
  throw new Error('OBS_PROTOCOL_UNKNOWN_SERVER_MESSAGE');
}

function parseAssetList(input: unknown): BroadcastAsset[] {
  if (!Array.isArray(input) || input.length > 256) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSETS');
  }
  const assets = input.map(parseBroadcastAsset);
  const ids = new Set<string>();
  const hashes = new Set<string>();
  let totalBytes = 0;
  for (const asset of assets) {
    if (ids.has(asset.id) || hashes.has(asset.sha256)) {
      throw new Error('OBS_PROTOCOL_DUPLICATE_ASSET');
    }
    ids.add(asset.id);
    hashes.add(asset.sha256);
    totalBytes += asset.byteLength;
  }
  if (totalBytes > 256 * 1024 * 1024) {
    throw new Error('OBS_PROTOCOL_ASSET_TOTAL_LIMIT');
  }
  return assets;
}

function parseCrop(input: unknown, width: number, height: number) {
  if (input === undefined) return { x: 0, y: 0, width, height };
  if (!isRecord(input)) throw new Error('OBS_PROTOCOL_INVALID_IMAGE_CROP');
  const crop = {
    x: strictNumberRange(input.x, 0, width),
    y: strictNumberRange(input.y, 0, height),
    width: strictNumberRange(input.width, 1, width),
    height: strictNumberRange(input.height, 1, height),
  };
  if (crop.x + crop.width > width || crop.y + crop.height > height) {
    throw new Error('OBS_PROTOCOL_INVALID_IMAGE_CROP');
  }
  return crop;
}

function integerRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  step = 1,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max ||
    value % step !== 0
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER');
  }
  return value;
}

function numberRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  return strictNumberRange(value, min, max);
}

function strictNumberRange(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER');
  }
  return value;
}

function nullableNumberRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null) return null;
  return strictNumberRange(value, min, max);
}

function nullableColor(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER');
  }
  return value;
}

function isAssetMime(value: unknown): value is BroadcastAssetMime {
  return (
    value === 'image/png' ||
    value === 'image/jpeg' ||
    value === 'image/webp' ||
    value === 'image/gif' ||
    value === 'image/svg+xml'
  );
}

function isDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 16_384
  );
}

function isEntityId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
