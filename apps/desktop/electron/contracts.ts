import {
  parseBroadcastSnapshot,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';

export const SECURITY_STATUS_CHANNEL = 'security:get-status';
export const BROADCAST_PUBLISH_CHANNEL = 'broadcast:publish-snapshot';
export const OBS_COPY_SOURCE_URL_CHANNEL = 'obs:copy-source-url';

export interface SecurityStatusRequest {
  requestId: string;
}

export interface SecurityStatus {
  requestId: string;
  electron: {
    nodeIntegration: false;
    contextIsolation: true;
    sandbox: true;
    webSecurity: true;
  };
  obsBridge: {
    running: true;
    host: '127.0.0.1' | '::1';
    port: number;
    connectionCount: number;
    latestRevision: number | null;
  };
}

export interface PublishBroadcastSnapshotRequest {
  requestId: string;
  snapshot: BroadcastSnapshot;
}

export interface PublishBroadcastSnapshotResponse {
  requestId: string;
  acceptedRevision: number;
}

export interface CopyObsSourceUrlResponse {
  requestId: string;
  copied: true;
}

export function parseSecurityStatusRequest(
  input: unknown,
): SecurityStatusRequest {
  if (!isRecord(input)) {
    throw new Error('IPC_INVALID_REQUEST');
  }

  return { requestId: parseRequestId(input.requestId) };
}

export function parsePublishBroadcastSnapshotRequest(
  input: unknown,
): PublishBroadcastSnapshotRequest {
  if (!isRecord(input)) {
    throw new Error('IPC_INVALID_REQUEST');
  }

  return {
    requestId: parseRequestId(input.requestId),
    snapshot: parseBroadcastSnapshot(input.snapshot),
  };
}

function parseRequestId(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(input)
  ) {
    throw new Error('IPC_INVALID_REQUEST_ID');
  }

  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
