import {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  parseObsBridgeClientMessage,
  parsePageTransition,
  type ObsBridgeClientMessage,
  type PageTransition,
} from './index.js';

export {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  parseObsBridgeClientMessage,
  parsePageTransition,
};
export type { ObsBridgeClientMessage, PageTransition };

export type BroadcastBackground =
  | { type: 'transparent' }
  | { type: 'color'; value: string };

export type BroadcastBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'add'
  | 'overlay';

export interface RasterPoint {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  timestamp: number;
}

export interface RasterStroke {
  id: string;
  tool: 'pen' | 'eraser';
  pointerType: 'mouse' | 'pen' | 'touch';
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  spacing: number;
  smoothing: number;
  taperStart: number;
  taperEnd: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  points: RasterPoint[];
}

export interface RasterFill {
  id: string;
  x: number;
  y: number;
  color: string;
  opacity: number;
  tolerance: number;
}

export interface RasterDrawing {
  revision: number;
  strokes: RasterStroke[];
  fills: RasterFill[];
}

export interface BroadcastTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

interface BroadcastLayerBase {
  id: string;
  parentId: string | null;
  name: string;
  visible: true;
  opacity: number;
  blendMode: BroadcastBlendMode;
  color: string | null;
  transform: BroadcastTransform;
}

export interface BroadcastRasterLayer extends BroadcastLayerBase {
  type: 'raster';
  content: {
    assetId: string | null;
    sourceLayerIds: string[];
    drawing: RasterDrawing;
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
  content: { color: string };
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

export type ObsBridgeServerMessage =
  | { type: 'pong'; timestamp: number }
  | { type: 'snapshot'; snapshot: BroadcastSnapshot }
  | {
      type: 'page.changed';
      snapshot: BroadcastSnapshot;
      transition: PageTransition;
    }
  | { type: 'layer.updated'; snapshot: BroadcastSnapshot };

const IDENTITY_TRANSFORM: BroadcastTransform = Object.freeze({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
});

export function createEmptyRasterDrawing(): RasterDrawing {
  return { revision: 0, strokes: [], fills: [] };
}

export function parseRasterDrawing(input: unknown): RasterDrawing {
  if (!isRecord(input) || !isRevision(input.revision)) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_DRAWING');
  }
  if (
    !Array.isArray(input.strokes) ||
    input.strokes.length > 10_000 ||
    !Array.isArray(input.fills) ||
    input.fills.length > 10_000
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_DRAWING');
  }
  const strokes = input.strokes.map(parseRasterStroke);
  const fills = input.fills.map(parseRasterFill);
  const pointCount = strokes.reduce(
    (sum, stroke) => sum + stroke.points.length,
    0,
  );
  if (pointCount > 500_000) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_DRAWING');
  }
  return { revision: input.revision, strokes, fills };
}

export function parseBroadcastSnapshot(input: unknown): BroadcastSnapshot {
  if (!isRecord(input)) throw new Error('OBS_PROTOCOL_INVALID_SNAPSHOT');
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
  const base = readLayerBase(input);
  if (input.type === 'folder') {
    if (
      !Array.isArray(input.childLayerIds) ||
      !input.childLayerIds.every(isEntityId)
    ) {
      throw new Error('OBS_PROTOCOL_INVALID_LAYER');
    }
    return { ...base, type: 'folder', childLayerIds: [...input.childLayerIds] };
  }
  const content = input.content;
  if (!isRecord(content)) throw new Error('OBS_PROTOCOL_INVALID_LAYER');
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
        ...base,
        type: 'raster',
        content: {
          assetId: content.assetId,
          sourceLayerIds: [...content.sourceLayerIds],
          drawing:
            content.drawing === undefined
              ? createEmptyRasterDrawing()
              : parseRasterDrawing(content.drawing),
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
        ...base,
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
        ...base,
        type: 'image',
        content: {
          assetId: content.assetId,
          width: content.width,
          height: content.height,
        },
      };
    case 'shape':
      if (
        !isShapeType(content.shape) ||
        !isNullableColor(content.fill) ||
        !isColor(content.stroke) ||
        !isPositiveFiniteNumber(content.strokeWidth, 1_000)
      ) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER');
      }
      return {
        ...base,
        type: 'shape',
        content: {
          shape: content.shape,
          fill: content.fill,
          stroke: content.stroke,
          strokeWidth: content.strokeWidth,
        },
      };
    case 'background':
      if (!isColor(content.color)) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER');
      }
      return { ...base, type: 'background', content: { color: content.color } };
    default:
      throw new Error('OBS_PROTOCOL_INVALID_LAYER');
  }
}

export function parseObsBridgeServerMessage(
  input: unknown,
): ObsBridgeServerMessage {
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

function parseRasterStroke(input: unknown): RasterStroke {
  if (
    !isRecord(input) ||
    !isEntityId(input.id) ||
    !isStrokeTool(input.tool) ||
    !isPointerType(input.pointerType) ||
    !isColor(input.color) ||
    !isPositiveFiniteNumber(input.size, 2_000) ||
    !isUnit(input.opacity) ||
    !isUnit(input.hardness) ||
    !isRange(input.spacing, 0.01, 5) ||
    !isUnit(input.smoothing) ||
    !isUnit(input.taperStart) ||
    !isUnit(input.taperEnd) ||
    typeof input.pressureSize !== 'boolean' ||
    typeof input.pressureOpacity !== 'boolean' ||
    !Array.isArray(input.points) ||
    input.points.length < 1 ||
    input.points.length > 100_000
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_STROKE');
  }
  return {
    id: input.id,
    tool: input.tool,
    pointerType: input.pointerType,
    color: input.color,
    size: input.size,
    opacity: input.opacity,
    hardness: input.hardness,
    spacing: input.spacing,
    smoothing: input.smoothing,
    taperStart: input.taperStart,
    taperEnd: input.taperEnd,
    pressureSize: input.pressureSize,
    pressureOpacity: input.pressureOpacity,
    points: input.points.map(parseRasterPoint),
  };
}

function parseRasterPoint(input: unknown): RasterPoint {
  if (
    !isRecord(input) ||
    !isCoordinate(input.x) ||
    !isCoordinate(input.y) ||
    !isUnit(input.pressure) ||
    !isRange(input.tiltX, -90, 90) ||
    !isRange(input.tiltY, -90, 90) ||
    !isNonNegativeFiniteNumber(input.timestamp)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_POINT');
  }
  return {
    x: input.x,
    y: input.y,
    pressure: input.pressure,
    tiltX: input.tiltX,
    tiltY: input.tiltY,
    timestamp: input.timestamp,
  };
}

function parseRasterFill(input: unknown): RasterFill {
  if (!isRecord(input)) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_FILL');
  }
  const tolerance = input.tolerance;
  if (
    !isEntityId(input.id) ||
    !isCoordinate(input.x) ||
    !isCoordinate(input.y) ||
    !isColor(input.color) ||
    !isUnit(input.opacity) ||
    !isIntegerRange(tolerance, 0, 255)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_FILL');
  }
  return {
    id: input.id,
    x: input.x,
    y: input.y,
    color: input.color,
    opacity: input.opacity,
    tolerance,
  };
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
    transform:
      input.transform === undefined
        ? { ...IDENTITY_TRANSFORM }
        : parseTransform(input.transform),
  };
}

function parseTransform(input: unknown): BroadcastTransform {
  if (
    !isRecord(input) ||
    !isCoordinate(input.x) ||
    !isCoordinate(input.y) ||
    !isNonZeroScale(input.scaleX) ||
    !isNonZeroScale(input.scaleY) ||
    !isRange(input.rotation, -360_000, 360_000)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_TRANSFORM');
  }
  return {
    x: input.x,
    y: input.y,
    scaleX: input.scaleX,
    scaleY: input.scaleY,
    rotation: input.rotation,
  };
}

function isLayerBase(input: Record<string, unknown>): boolean {
  if (input.transform !== undefined) {
    try {
      parseTransform(input.transform);
    } catch {
      return false;
    }
  }
  return (
    isEntityId(input.id) &&
    (input.parentId === null || isEntityId(input.parentId)) &&
    typeof input.name === 'string' &&
    input.name.trim().length >= 1 &&
    input.name.length <= 120 &&
    input.visible === true &&
    isUnit(input.opacity) &&
    isBlendMode(input.blendMode) &&
    isNullableColor(input.color)
  );
}

function assertBroadcastLayerTree(layers: BroadcastLayer[]): void {
  const map = new Map<string, BroadcastLayer>();
  for (const layer of layers) {
    if (map.has(layer.id)) throw new Error('OBS_PROTOCOL_INVALID_LAYER_TREE');
    map.set(layer.id, layer);
  }
  const referenced = new Set<string>();
  for (const layer of layers) {
    if (layer.parentId !== null) {
      const parent = map.get(layer.parentId);
      if (parent?.type !== 'folder' || !parent.childLayerIds.includes(layer.id)) {
        throw new Error('OBS_PROTOCOL_INVALID_LAYER_TREE');
      }
    }
    if (layer.type === 'folder') {
      for (const childId of layer.childLayerIds) {
        const child = map.get(childId);
        if (
          child === undefined ||
          child.parentId !== layer.id ||
          referenced.has(childId)
        ) {
          throw new Error('OBS_PROTOCOL_INVALID_LAYER_TREE');
        }
        referenced.add(childId);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isCanvasDimension(value: unknown): value is number {
  return isIntegerRange(value, 1, 32_768);
}

function isDpi(value: unknown): value is number {
  return isRange(value, 1, 2_400);
}

function isCoordinate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1_000_000
  );
}

function isUnit(value: unknown): value is number {
  return isRange(value, 0, 1);
}

function isRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function isIntegerRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isPositiveFiniteNumber(value: unknown, max: number): value is number {
  return isRange(value, Number.MIN_VALUE, max);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isRange(value, 0, Number.MAX_VALUE);
}

function isNonZeroScale(value: unknown): value is number {
  return isRange(value, -1_000, 1_000) && value !== 0;
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

function isBackground(value: unknown): value is BroadcastBackground {
  return (
    isRecord(value) &&
    (value.type === 'transparent' ||
      (value.type === 'color' && isColor(value.value)))
  );
}

function isStrokeTool(value: unknown): value is 'pen' | 'eraser' {
  return value === 'pen' || value === 'eraser';
}

function isPointerType(
  value: unknown,
): value is 'mouse' | 'pen' | 'touch' {
  return value === 'mouse' || value === 'pen' || value === 'touch';
}

function isShapeType(
  value: unknown,
): value is 'rectangle' | 'ellipse' | 'line' {
  return value === 'rectangle' || value === 'ellipse' || value === 'line';
}

function isBlendMode(value: unknown): value is BroadcastBlendMode {
  return (
    value === 'normal' ||
    value === 'multiply' ||
    value === 'screen' ||
    value === 'add' ||
    value === 'overlay'
  );
}
