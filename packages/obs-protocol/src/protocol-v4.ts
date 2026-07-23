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

interface BroadcastAssetBase {
  id: string;
  sha256: string;
  mime: BroadcastAssetMime;
  width: number;
  height: number;
  byteLength: number;
  animated: false;
  sanitized: boolean;
}

export interface InlineBroadcastAsset extends BroadcastAssetBase {
  delivery?: 'inline';
  dataUrl: string;
  url?: never;
}

export interface HttpBroadcastAsset extends BroadcastAssetBase {
  delivery: 'http';
  url: string;
  dataUrl?: never;
}

export type BroadcastAsset = InlineBroadcastAsset | HttpBroadcastAsset;

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

export interface BroadcastLayerPatch {
  projectId: string;
  pageId: string;
  baseRevision: number;
  revision: number;
  generatedAt: string;
  upsertedLayers: BroadcastLayer[];
  removedLayerIds: string[];
  layerOrder: string[];
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
  | { type: 'layer.updated'; snapshot: BroadcastSnapshot }
  | { type: 'layer.patch'; patch: BroadcastLayerPatch };

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
    input.animated !== false ||
    typeof input.sanitized !== 'boolean' ||
    (input.mime === 'image/svg+xml' && !input.sanitized)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }

  const base = {
    id: input.id,
    sha256: input.sha256.toLowerCase(),
    mime: input.mime,
    width: input.width,
    height: input.height,
    byteLength: input.byteLength,
    animated: false as const,
    sanitized: input.sanitized,
  };

  if (input.delivery === 'http') {
    if (
      typeof input.url !== 'string' ||
      input.dataUrl !== undefined ||
      !isHttpAssetUrl(input.url, base.sha256)
    ) {
      throw new Error('OBS_PROTOCOL_INVALID_ASSET');
    }
    return { ...base, delivery: 'http', url: input.url };
  }

  if (
    input.delivery !== undefined &&
    input.delivery !== 'inline'
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }
  if (
    typeof input.dataUrl !== 'string' ||
    input.url !== undefined ||
    input.dataUrl.length > 36 * 1024 * 1024 ||
    !input.dataUrl.startsWith(`data:${input.mime};base64,`)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }
  return { ...base, dataUrl: input.dataUrl };
}

export function isInlineBroadcastAsset(
  asset: BroadcastAsset,
): asset is InlineBroadcastAsset {
  return asset.delivery !== 'http';
}

export function getBroadcastAssetSource(asset: BroadcastAsset): string {
  return isInlineBroadcastAsset(asset) ? asset.dataUrl : asset.url;
}

export function createBroadcastLayerPatch(
  previousInput: BroadcastSnapshot,
  nextInput: BroadcastSnapshot,
): BroadcastLayerPatch | null {
  const previous = parseBroadcastSnapshot(previousInput);
  const next = parseBroadcastSnapshot(nextInput);
  if (
    previous.projectId !== next.projectId ||
    previous.pageId !== next.pageId ||
    !hasEqualPatchMetadata(previous, next)
  ) {
    return null;
  }

  const previousById = new Map(previous.layers.map((layer) => [layer.id, layer]));
  const nextIds = new Set(next.layers.map((layer) => layer.id));
  const upsertedLayers = next.layers.filter((layer) => {
    const previousLayer = previousById.get(layer.id);
    return previousLayer === undefined ||
      JSON.stringify(previousLayer) !== JSON.stringify(layer);
  });
  const removedLayerIds = previous.layers
    .filter((layer) => !nextIds.has(layer.id))
    .map((layer) => layer.id);
  const previousLayerOrder = previous.layers.map((layer) => layer.id);
  const nextLayerOrder = next.layers.map((layer) => layer.id);
  const layerOrderChanged =
    JSON.stringify(previousLayerOrder) !== JSON.stringify(nextLayerOrder);

  if (
    upsertedLayers.length === 0 &&
    removedLayerIds.length === 0 &&
    !layerOrderChanged
  ) {
    return null;
  }

  return {
    projectId: next.projectId,
    pageId: next.pageId,
    baseRevision: previous.revision,
    revision: next.revision,
    generatedAt: next.generatedAt,
    upsertedLayers,
    removedLayerIds,
    layerOrder: nextLayerOrder,
    ...(next.assets === undefined ? {} : { assets: next.assets }),
  };
}

export function parseBroadcastLayerPatch(input: unknown): BroadcastLayerPatch {
  if (
    !isRecord(input) ||
    !isEntityId(input.projectId) ||
    !isEntityId(input.pageId) ||
    !isPatchRevision(input.baseRevision) ||
    !isPatchRevision(input.revision) ||
    input.revision <= input.baseRevision ||
    !isPatchTimestamp(input.generatedAt) ||
    !Array.isArray(input.upsertedLayers) ||
    input.upsertedLayers.length > 1_000 ||
    !Array.isArray(input.removedLayerIds) ||
    input.removedLayerIds.length > 1_000 ||
    !input.removedLayerIds.every(isEntityId) ||
    !Array.isArray(input.layerOrder) ||
    input.layerOrder.length > 1_000 ||
    !input.layerOrder.every(isEntityId)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER_PATCH');
  }

  const upsertedLayers = input.upsertedLayers.map(parseBroadcastLayer);
  const upsertedIds = new Set<string>();
  for (const layer of upsertedLayers) {
    if (upsertedIds.has(layer.id)) {
      throw new Error('OBS_PROTOCOL_INVALID_LAYER_PATCH');
    }
    upsertedIds.add(layer.id);
  }
  const removedLayerIds = [...input.removedLayerIds];
  if (
    new Set(removedLayerIds).size !== removedLayerIds.length ||
    removedLayerIds.some((id) => upsertedIds.has(id)) ||
    new Set(input.layerOrder).size !== input.layerOrder.length
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER_PATCH');
  }

  const assets =
    input.assets === undefined ? undefined : parseAssetList(input.assets);
  return {
    projectId: input.projectId,
    pageId: input.pageId,
    baseRevision: input.baseRevision,
    revision: input.revision,
    generatedAt: input.generatedAt,
    upsertedLayers,
    removedLayerIds,
    layerOrder: [...input.layerOrder],
    ...(assets === undefined ? {} : { assets }),
  };
}

export function applyBroadcastLayerPatch(
  currentInput: BroadcastSnapshot,
  patchInput: BroadcastLayerPatch,
): BroadcastSnapshot {
  const current = parseBroadcastSnapshot(currentInput);
  const patch = parseBroadcastLayerPatch(patchInput);
  if (
    patch.projectId !== current.projectId ||
    patch.pageId !== current.pageId
  ) {
    throw new Error('OBS_PROTOCOL_LAYER_PATCH_PAGE_MISMATCH');
  }
  if (patch.baseRevision !== current.revision) {
    throw new Error('OBS_PROTOCOL_LAYER_PATCH_BASE_REVISION_MISMATCH');
  }

  const layerById = new Map(current.layers.map((layer) => [layer.id, layer]));
  for (const removedLayerId of patch.removedLayerIds) {
    if (!layerById.delete(removedLayerId)) {
      throw new Error('OBS_PROTOCOL_LAYER_PATCH_REMOVE_NOT_FOUND');
    }
  }
  for (const layer of patch.upsertedLayers) {
    layerById.set(layer.id, layer);
  }
  if (layerById.size !== patch.layerOrder.length) {
    throw new Error('OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH');
  }
  const layers = patch.layerOrder.map((layerId) => {
    const layer = layerById.get(layerId);
    if (layer === undefined) {
      throw new Error('OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH');
    }
    return layer;
  });

  const { assets: _currentAssets, ...currentWithoutAssets } = current;
  return parseBroadcastSnapshot({
    ...currentWithoutAssets,
    revision: patch.revision,
    generatedAt: patch.generatedAt,
    layers,
    ...(patch.assets === undefined ? {} : { assets: patch.assets }),
  });
}

function hasEqualPatchMetadata(
  previous: BroadcastSnapshot,
  next: BroadcastSnapshot,
): boolean {
  return JSON.stringify({
    schemaVersion: previous.schemaVersion,
    projectId: previous.projectId,
    pageId: previous.pageId,
    pageName: previous.pageName,
    canvas: previous.canvas,
    overlay: previous.overlay,
  }) === JSON.stringify({
    schemaVersion: next.schemaVersion,
    projectId: next.projectId,
    pageId: next.pageId,
    pageName: next.pageName,
    canvas: next.canvas,
    overlay: next.overlay,
  });
}

function isPatchRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function isPatchTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isHttpAssetUrl(value: string, sha256: string): boolean {
  const match = /^\/asset\/([0-9a-f]{64})\/([0-9a-f]{64})$/.exec(value);
  return match !== null && match[2] === sha256;
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
  if (input.type === 'layer.patch') {
    return { type: 'layer.patch', patch: parseBroadcastLayerPatch(input.patch) };
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
