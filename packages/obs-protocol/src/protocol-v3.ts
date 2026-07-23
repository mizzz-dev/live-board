import {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  createEmptyRasterDrawing as createBaseEmptyRasterDrawing,
  parseBroadcastLayer as parseBaseBroadcastLayer,
  parseBroadcastSnapshot as parseBaseBroadcastSnapshot,
  parseObsBridgeClientMessage,
  parsePageTransition,
  type BroadcastLayer as BaseBroadcastLayer,
  type BroadcastRasterLayer as BaseBroadcastRasterLayer,
  type BroadcastSnapshot as BaseBroadcastSnapshot,
  type ObsBridgeClientMessage,
  type PageTransition,
  type RasterDrawing as BaseRasterDrawing,
  type RasterFill as BaseRasterFill,
  type RasterStroke as BaseRasterStroke,
} from './protocol-v2.js';
import {
  DEFAULT_BROADCAST_OVERLAY_SETTINGS,
  applyBroadcastPreset,
  isBroadcastOverlayTheme,
  isBroadcastPreset,
  parseBroadcastOverlaySettings,
  sanitizeOverlayCustomCss,
  type BroadcastOverlaySettings,
  type BroadcastOverlayTheme,
  type BroadcastOverlayTransition,
  type BroadcastPerformanceMode,
  type BroadcastPreset,
  type OverlayCssSanitizeResult,
} from './overlay-settings.js';

export {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_BROADCAST_OVERLAY_SETTINGS,
  applyBroadcastPreset,
  isBroadcastOverlayTheme,
  isBroadcastPreset,
  parseBroadcastOverlaySettings,
  parseObsBridgeClientMessage,
  parsePageTransition,
  sanitizeOverlayCustomCss,
};
export type {
  BroadcastOverlaySettings,
  BroadcastOverlayTheme,
  BroadcastOverlayTransition,
  BroadcastPerformanceMode,
  BroadcastPreset,
  ObsBridgeClientMessage,
  OverlayCssSanitizeResult,
  PageTransition,
};
export type {
  BroadcastBackground,
  BroadcastBackgroundLayer,
  BroadcastBlendMode,
  BroadcastFolderLayer,
  BroadcastImageLayer,
  BroadcastShapeLayer,
  BroadcastTextLayer,
  BroadcastTransform,
  RasterPoint,
} from './protocol-v2.js';

export interface RasterStroke extends BaseRasterStroke {
  sequence?: number;
}

export interface RasterFill extends BaseRasterFill {
  sequence?: number;
}

export interface RasterDrawing
  extends Omit<BaseRasterDrawing, 'strokes' | 'fills'> {
  strokes: RasterStroke[];
  fills: RasterFill[];
}

export interface BroadcastRasterLayer
  extends Omit<BaseBroadcastRasterLayer, 'content'> {
  content: Omit<BaseBroadcastRasterLayer['content'], 'drawing'> & {
    drawing: RasterDrawing;
  };
}

export type BroadcastLayer =
  | Exclude<BaseBroadcastLayer, BaseBroadcastRasterLayer>
  | BroadcastRasterLayer;

export interface BroadcastSnapshot
  extends Omit<BaseBroadcastSnapshot, 'layers'> {
  layers: BroadcastLayer[];
  overlay: BroadcastOverlaySettings;
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

export function createEmptyRasterDrawing(): RasterDrawing {
  return createBaseEmptyRasterDrawing();
}

export function parseRasterDrawing(input: unknown): RasterDrawing {
  const drawing = parseBaseRasterDrawing(input);
  const raw = isRecord(input) ? input : undefined;
  const rawStrokes = Array.isArray(raw?.strokes) ? raw.strokes : [];
  const rawFills = Array.isArray(raw?.fills) ? raw.fills : [];
  return {
    revision: drawing.revision,
    strokes: drawing.strokes.map((stroke, index) => ({
      ...stroke,
      ...readSequence(rawStrokes[index]),
    })),
    fills: drawing.fills.map((fill, index) => ({
      ...fill,
      ...readSequence(rawFills[index]),
    })),
  };
}

export function parseBroadcastLayer(input: unknown): BroadcastLayer {
  const layer = parseBaseBroadcastLayer(input);
  if (layer.type !== 'raster') return layer;
  const drawing = readRawRasterDrawing(input);
  return {
    ...layer,
    content: {
      ...layer.content,
      drawing:
        drawing === undefined
          ? createEmptyRasterDrawing()
          : parseRasterDrawing(drawing),
    },
  };
}

export function parseBroadcastSnapshot(input: unknown): BroadcastSnapshot {
  const snapshot = parseBaseBroadcastSnapshot(input);
  const rawLayers = isRecord(input) && Array.isArray(input.layers)
    ? input.layers
    : [];
  const rawOverlay = isRecord(input) ? input.overlay : undefined;
  return {
    ...snapshot,
    overlay: parseBroadcastOverlaySettings(rawOverlay),
    layers: snapshot.layers.map((layer, index) => {
      if (layer.type !== 'raster') return layer;
      const rawDrawing = readRawRasterDrawing(rawLayers[index]);
      return {
        ...layer,
        content: {
          ...layer.content,
          drawing:
            rawDrawing === undefined
              ? createEmptyRasterDrawing()
              : parseRasterDrawing(rawDrawing),
        },
      };
    }),
  };
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

function readRawRasterDrawing(input: unknown): unknown {
  if (!isRecord(input) || input.type !== 'raster' || !isRecord(input.content)) {
    return undefined;
  }
  return input.content.drawing;
}

function readSequence(input: unknown): { sequence?: number } {
  if (!isRecord(input) || input.sequence === undefined) return {};
  if (
    typeof input.sequence !== 'number' ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_RASTER_SEQUENCE');
  }
  return { sequence: input.sequence };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
