import {
  parseBroadcastSnapshot,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';

export const SECURITY_STATUS_CHANNEL = 'security:get-status';
export const BROADCAST_PUBLISH_CHANNEL = 'broadcast:publish-snapshot';
export const OBS_COPY_SOURCE_URL_CHANNEL = 'obs:copy-source-url';
export const WORKSPACE_SAVE_CHANNEL = 'workspace:save';
export const WORKSPACE_OPEN_CHANNEL = 'workspace:open';
export const WORKSPACE_OPEN_RECENT_CHANNEL = 'workspace:open-recent';
export const WORKSPACE_LIST_RECENT_CHANNEL = 'workspace:list-recent';
export const WORKSPACE_SET_FAVORITE_CHANNEL = 'workspace:set-favorite';
export const WORKSPACE_APPEND_OPERATION_CHANNEL = 'workspace:append-operation';
export const WORKSPACE_AUTOSAVE_CHANNEL = 'workspace:autosave';
export const RECOVERY_LIST_CHANNEL = 'recovery:list';
export const RECOVERY_LOAD_CHANNEL = 'recovery:load';
export const RECOVERY_DISCARD_CHANNEL = 'recovery:discard';

export const MAX_IPC_ARCHIVE_BYTES = 512 * 1024 * 1024;

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

export interface PublicDocumentRecord {
  documentId: string;
  displayName: string;
  favorite: boolean;
  lastOpenedAt: string;
  lastSavedAt: string | null;
}

export interface PublicRecoveryCandidate {
  candidateId: string;
  workspaceId: string;
  revision: number;
  savedAt: string;
  operationCountAfterSnapshot: number;
}

export interface WorkspaceSaveRequest extends SecurityStatusRequest {
  workspaceId: string;
  revision: number;
  archive: Uint8Array;
  documentId?: string | undefined;
  saveAs: boolean;
}

export interface WorkspaceSaveResponse {
  requestId: string;
  canceled: boolean;
  document?: PublicDocumentRecord;
  archiveSha256?: string;
}

export interface WorkspaceOpenResponse {
  requestId: string;
  canceled: boolean;
  document?: PublicDocumentRecord;
  archive?: Uint8Array;
}

export interface WorkspaceOpenRecentRequest extends SecurityStatusRequest {
  documentId: string;
}

export interface WorkspaceListRecentResponse {
  requestId: string;
  documents: PublicDocumentRecord[];
}

export interface WorkspaceSetFavoriteRequest extends SecurityStatusRequest {
  documentId: string;
  favorite: boolean;
}

export interface WorkspaceSetFavoriteResponse {
  requestId: string;
  document: PublicDocumentRecord;
}

export interface WorkspaceRevisionRequest extends SecurityStatusRequest {
  workspaceId: string;
  revision: number;
}

export interface WorkspaceAutosaveRequest extends WorkspaceRevisionRequest {
  archive: Uint8Array;
}

export interface WorkspaceMutationResponse {
  requestId: string;
  accepted: true;
}

export interface RecoveryListResponse {
  requestId: string;
  candidates: PublicRecoveryCandidate[];
}

export interface RecoveryCandidateRequest extends SecurityStatusRequest {
  candidateId: string;
}

export interface RecoveryLoadResponse {
  requestId: string;
  archive: Uint8Array;
}

export interface RecoveryDiscardRequest extends RecoveryCandidateRequest {
  revision: number;
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

export function parseWorkspaceSaveRequest(input: unknown): WorkspaceSaveRequest {
  const base = parseWorkspaceAutosaveRequest(input);
  if (!isRecord(input) || typeof input.saveAs !== 'boolean') {
    throw new Error('IPC_INVALID_SAVE_REQUEST');
  }
  return {
    ...base,
    saveAs: input.saveAs,
    documentId:
      input.documentId === undefined
        ? undefined
        : parseOpaqueId(input.documentId, 'DOCUMENT_ID'),
  };
}

export function parseWorkspaceOpenRecentRequest(
  input: unknown,
): WorkspaceOpenRecentRequest {
  const request = parseSecurityStatusRequest(input);
  if (!isRecord(input)) throw new Error('IPC_INVALID_REQUEST');
  return {
    ...request,
    documentId: parseOpaqueId(input.documentId, 'DOCUMENT_ID'),
  };
}

export function parseWorkspaceSetFavoriteRequest(
  input: unknown,
): WorkspaceSetFavoriteRequest {
  const request = parseWorkspaceOpenRecentRequest(input);
  if (!isRecord(input) || typeof input.favorite !== 'boolean') {
    throw new Error('IPC_INVALID_FAVORITE');
  }
  return { ...request, favorite: input.favorite };
}

export function parseWorkspaceRevisionRequest(
  input: unknown,
): WorkspaceRevisionRequest {
  const request = parseSecurityStatusRequest(input);
  if (!isRecord(input)) throw new Error('IPC_INVALID_REQUEST');
  return {
    ...request,
    workspaceId: parseWorkspaceId(input.workspaceId),
    revision: parseRevision(input.revision),
  };
}

export function parseWorkspaceAutosaveRequest(
  input: unknown,
): WorkspaceAutosaveRequest {
  const request = parseWorkspaceRevisionRequest(input);
  if (!isRecord(input)) throw new Error('IPC_INVALID_REQUEST');
  return {
    ...request,
    archive: parseArchive(input.archive),
  };
}

export function parseRecoveryCandidateRequest(
  input: unknown,
): RecoveryCandidateRequest {
  const request = parseSecurityStatusRequest(input);
  if (!isRecord(input)) throw new Error('IPC_INVALID_REQUEST');
  return {
    ...request,
    candidateId: parseOpaqueId(input.candidateId, 'CANDIDATE_ID'),
  };
}

export function parseRecoveryDiscardRequest(
  input: unknown,
): RecoveryDiscardRequest {
  const request = parseRecoveryCandidateRequest(input);
  if (!isRecord(input)) throw new Error('IPC_INVALID_REQUEST');
  return { ...request, revision: parseRevision(input.revision) };
}

function parseArchive(input: unknown): Uint8Array {
  if (
    !(input instanceof Uint8Array) ||
    input.byteLength < 22 ||
    input.byteLength > MAX_IPC_ARCHIVE_BYTES
  ) {
    throw new Error('IPC_INVALID_ARCHIVE');
  }
  return new Uint8Array(input);
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

function parseWorkspaceId(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(input)
  ) {
    throw new Error('IPC_INVALID_WORKSPACE_ID');
  }
  return input;
}

function parseRevision(input: unknown): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0) {
    throw new Error('IPC_INVALID_REVISION');
  }
  return input as number;
}

function parseOpaqueId(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) {
    throw new Error(`IPC_INVALID_${label}`);
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
