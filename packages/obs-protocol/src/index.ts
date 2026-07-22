export const BROADCAST_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type BroadcastBackground =
  | { type: 'transparent' }
  | { type: 'color'; value: string };

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
  layers: readonly [];
}

export type ObsBridgeClientMessage =
  | { type: 'ping'; timestamp: number }
  | { type: 'snapshot.request'; lastRevision: number | null };

export type ObsBridgeServerMessage =
  | { type: 'pong'; timestamp: number }
  | { type: 'snapshot'; snapshot: BroadcastSnapshot };

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
    input.layers.length !== 0
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_SNAPSHOT');
  }

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
    layers: [],
  };
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

  if (input.type === 'snapshot') {
    return {
      type: 'snapshot',
      snapshot: parseBroadcastSnapshot(input.snapshot),
    };
  }

  throw new Error('OBS_PROTOCOL_UNKNOWN_SERVER_MESSAGE');
}

function isEntityId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value)
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isCanvasDimension(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 32768;
}

function isDpi(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 2400;
}

function isBackground(value: unknown): value is BroadcastBackground {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === 'transparent') {
    return true;
  }

  return (
    value.type === 'color' &&
    typeof value.value === 'string' &&
    /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value.value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
