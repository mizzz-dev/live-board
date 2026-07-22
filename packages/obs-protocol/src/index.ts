export const BROADCAST_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type BroadcastBackground =
  | { type: 'transparent' }
  | { type: 'color'; value: string };

export type BroadcastBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'add'
  | 'overlay';

interface BroadcastLayerBase {
  id: string;
  parentId: string | null;
  name: string;
  visible: true;
  opacity: number;
  blendMode: BroadcastBlendMode;
  color: string | null;
}

export interface BroadcastRasterLayer extends BroadcastLayerBase {
  type: 'raster';
  content: {
    assetId: string | null;
    sourceLayerIds: string[];
  };
}

export interface BroadcastTextLayer extends BroadcastLayerBase {
  type: 'text';
  content: {
    text: string;
    fontFamily: string;
    fontSize: number;
    color: string;
  };
}

export interface BroadcastImageLayer extends BroadcastLayerBase {
  type: 'image';
  content: {
    assetId: string | null;
    width: number;
    height: number;
  };
}

export interface BroadcastShapeLayer extends BroadcastLayerBase {
  type: 'shape';
  content: {
    shape: 'rectangle' | 'ellipse' | 'line';
    fill: string | null;
    stroke: string;
    strokeWidth: number;
  };
}

export interface BroadcastBackgroundLayer extends BroadcastLayerBase {
  type: 'background';
  content: {
    color: string;
  };
}

export interface BroadcastFolderLayer extends BroadcastLayerBase {
  type: 'folder';
  childLayerIds: string[];
}

export type BroadcastLayer =
  | BroadcastRasterLayer
  | BroadcastTextLayer
  | BroadcastImageLayer
  | BroadcastShapeLayer
  | BroadcastBackgroundLayer
  | BroadcastFolderLayer;

export type PageTransition =
  | { type: 'none'; durationMs: 0 }
  | { type: 'fade'; durationMs: number };

export interface BroadcastSnapshot {
  schemaVersion: typeof BROADCAST_SNAPSHOT_SCHEMA_VERSION;
  projectId: string;
  pageId: string;
  pageName: string;
  revision: number;
  generatedAt: string;
  canvas: {
    width: number;
    height: number;
    dpi: number;
    background: BroadcastBackground;
  };
  layers: BroadcastLayer[];
}

export type ObsBridgeClientMessage =
  | { type: 'ping'; timestamp: number }
  | { type: 'snapshot.request'; lastRevision: number | null };

export type ObsBridgeServerMessage =
  | { type: 'pong'; timestamp: number }
  | { type: 'snapshot'; snapshot: BroadcastSnapshot }
  | {
      type: 'page.changed';
      snapshot: BroadcastSnapshot;
      transition: PageTransition;
    }
  | { type: 'layer.updated'; snapshot: BroadcastSnapshot };

export function parseBroadcastSnapshot(input: unknown): BroadcastSnapshot {
  if (!isRecord(input)) {
    throw new Error('OBS_PROTOCOL_INVALID_SNAPSHOT');
  }

  const canvas = input.canvas;
  const background = isRecord(canvas) ? canvas.background : undefined;

  if (
    input.schemaVersion !== BROADCAST_SNAPSHOT_SCHEMA_VERSION ||
    !isEntityId(input.projectId) ||
    !isEntityId(input.pageId) ||
    typeof input.pageName !== 'string' ||
    input.pageName.trim().length < 1 ||
    input.pageName.length > 120 ||
    !isRevision(input.revision) ||
    !isIsoTimestamp(input.generatedAt) ||
    !isRecord(canvas) ||
    !isCanvasDimension(canvas.width) ||
    !isCanvasDimension(canvas.height) ||
    !isDpi(canvas.dpi) ||
    !isBackground(background) ||
    !Array.isArray(input.layers) ||
    input.layers.length > 1_000
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_SNAPSHOT');
  }

  const layers = input.layers.map(parseBroadcastLayer);
  assertBroadcastLayerTree(layers);

  return {
    schemaVersion: BROADCAST_SNAPSHOT_SCHEMA_VERSION,
    projectId: input.projectId,
    pageId: input.pageId,
    pageName: input.pageName,
    revision: input.revision,
    generatedAt: input.generatedAt,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      dpi: canvas.dpi,
      background,
    },
    layers,
  };
}

export function parseBroadcastLayer(input: unknown): BroadcastLayer {
  if (!isRecord(input) || !isLayerBase(input) || typeof input.type !== 'string') {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER');
  }

  if (input.type === 'folder') {
    if (
      !Array.isArray(input.childLayerIds) ||
      !input.childLayerIds.every(isEntityId)
    ) {
      throw new Error('OBS_PROTOCOL_INVALID_LAYER');
    }
    return {
      ...readLayerBase(input),
      type: 'folder',
      childLayerIds: [...input.childLayerIds],
    };
  }

  const content = input.content;
  if (!isRecord(content)) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER');
  }

  switch (input.type) {
    case 'raster':
      if (
        !isNullableEntityId(content.assetId) ||
        !Array.isArray(content.sourceLayerIds) ||
        !content.sourceLayerIds.every(isEntityId)
      ) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER');
      }
      return {
        ...readLayerBase(input),
        type: 'raster',
        content: {
          assetId: content.assetId,
          sourceLayerIds: [...content.sourceLayerIds],
        },
      };
    case 'text':
      if (
        typeof content.text !== 'string' ||
        content.text.length > 100_000 ||
        typeof content.fontFamily !== 'string' ||
        content.fontFamily.length < 1 ||
        content.fontFamily.length > 200 ||
        !isPositiveFiniteNumber(content.fontSize, 2_000) ||
        !isColor(content.color)
      ) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER');
      }
      return {
        ...readLayerBase(input),
        type: 'text',
        content: {
          text: content.text,
          fontFamily: content.fontFamily,
          fontSize: content.fontSize,
          color: content.color,
        },
      };
    case 'image':
      if (
        !isNullableEntityId(content.assetId) ||
        !isPositiveFiniteNumber(content.width, 32_768) ||
        !isPositiveFiniteNumber(content.height, 32_768)
      ) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER');
      }
      return {
        ...readLayerBase(input),
        type: 'image',
        content: {
          assetId: content.assetId,
          width: content.width,
          height: content.height,
        },
      };
    case 'shape':
      if (
        !['rectangle', 'ellipse', 'line'].includes(String(content.shape)) ||
        !isNullableColor(content.fill) ||
        !isColor(content.stroke) ||
        !isPositiveFiniteNumber(content.strokeWidth, 1_000)
      ) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER');
      }
      return {
        ...readLayerBase(input),
        type: 'shape',
        content: {
          shape: content.shape as 'rectangle' | 'ellipse' | 'line',
          fill: content.fill,
          stroke: content.stroke,
          strokeWidth: content.strokeWidth,
        },
      };
    case 'background':
      if (!isColor(content.color)) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER');
      }
      return {
        ...readLayerBase(input),
        type: 'background',
        content: { color: content.color },
      };
    default:
      throw new Error('OBS_PROTOCOL_INVALID_LAYER');
  }
}

export function parsePageTransition(input: unknown): PageTransition {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new Error('OBS_PROTOCOL_INVALID_PAGE_TRANSITION');
  }

  if (input.type === 'none' && input.durationMs === 0) {
    return { type: 'none', durationMs: 0 };
  }

  if (
    input.type === 'fade' &&
    typeof input.durationMs === 'number' &&
    Number.isInteger(input.durationMs) &&
    input.durationMs >= 50 &&
    input.durationMs <= 5_000
  ) {
    return { type: 'fade', durationMs: input.durationMs };
  }

  throw new Error('OBS_PROTOCOL_INVALID_PAGE_TRANSITION');
}

export function parseObsBridgeClientMessage(input: unknown): ObsBridgeClientMessage {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new Error('OBS_PROTOCOL_INVALID_CLIENT_MESSAGE');
  }

  if (input.type === 'ping') {
    if (!isNonNegativeFiniteNumber(input.timestamp)) {
      throw new Error('OBS_PROTOCOL_INVALID_CLIENT_MESSAGE');
    }

    return { type: 'ping', timestamp: input.timestamp };
  }

  if (input.type === 'snapshot.request') {
    if (input.lastRevision !== null && !isRevision(input.lastRevision)) {
      throw new Error('OBS_PROTOCOL_INVALID_CLIENT_MESSAGE');
    }

    return {
      type: 'snapshot.request',
      lastRevision: input.lastRevision,
    };
  }

  throw new Error('OBS_PROTOCOL_UNKNOWN_CLIENT_MESSAGE');
}

export function parseObsBridgeServerMessage(input: unknown): ObsBridgeServerMessage {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new Error('OBS_PROTOCOL_INVALID_SERVER_MESSAGE');
  }

  if (input.type === 'pong') {
    if (!isNonNegativeFiniteNumber(input.timestamp)) {
      throw new Error('OBS_PROTOCOL_INVALID_SERVER_MESSAGE');
    }

    return { type: 'pong', timestamp: input.timestamp };
  }

  if (input.type === 'snapshot' || input.type === 'layer.updated') {
    return {
      type: input.type,
      snapshot: parseBroadcastSnapshot(input.snapshot),
    };
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

function readLayerBase(input: Record<string, unknown>): BroadcastLayerBase {
  return {
    id: input.id as string,
    parentId: input.parentId as string | null,
    name: input.name as string,
    visible: true,
    opacity: input.opacity as number,
    blendMode: input.blendMode as BroadcastBlendMode,
    color: input.color as string | null,
  };
}

function isLayerBase(input: Record<string, unknown>): boolean {
  return (
    isEntityId(input.id) &&
    (input.parentId === null || isEntityId(input.parentId)) &&
    typeof input.name === 'string' &&
    input.name.trim().length >= 1 &&
    input.name.length <= 120 &&
    input.visible === true &&
    typeof input.opacity === 'number' &&
    Number.isFinite(input.opacity) &&
    input.opacity >= 0 &&
    input.opacity <= 1 &&
    ['normal', 'multiply', 'screen', 'add', 'overlay'].includes(
      String(input.blendMode),
    ) &&
    isNullableColor(input.color)
  );
}

function assertBroadcastLayerTree(layers: BroadcastLayer[]): void {
  const layerMap = new Map<string, BroadcastLayer>();
  for (const layer of layers) {
    if (layerMap.has(layer.id)) {
      throw new Error('OBS_PROTOCOL_INVALID_LAYER_TREE');
    }
    layerMap.set(layer.id, layer);
  }

  const referenced = new Set<string>();
  for (const layer of layers) {
    if (layer.parentId !== null) {
      const parent = layerMap.get(layer.parentId);
      if (parent?.type !== 'folder' || !parent.childLayerIds.includes(layer.id)) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER_TREE');
      }
    }
    if (layer.type === 'folder') {
      for (const childId of layer.childLayerIds) {
        const child = layerMap.get(childId);
        if (child === undefined || child.parentId !== layer.id || referenced.has(childId)) {
          throw new Error('OBS_PROTOCOL_INVALID_LAYER_TREE');
        }
        referenced.add(childId);
      }
    }
  }
}

function isEntityId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value)
  );
}

function isNullableEntityId(value: unknown): value is string | null {
  return value === null || isEntityId(value);
}

function isRevision(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= max
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isCanvasDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 32768
  );
}

function isDpi(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 2400
  );
}

function isBackground(value: unknown): value is BroadcastBackground {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === 'transparent') {
    return true;
  }

  return value.type === 'color' && isColor(value.value);
}

function isColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)
  );
}

function isNullableColor(value: unknown): value is string | null {
  return value === null || isColor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
