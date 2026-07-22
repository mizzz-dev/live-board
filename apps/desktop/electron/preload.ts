import type { BroadcastSnapshot } from '@live-board/obs-protocol';
import { contextBridge, ipcRenderer } from 'electron';
import {
  BROADCAST_PUBLISH_CHANNEL,
  OBS_COPY_SOURCE_URL_CHANNEL,
  RECOVERY_DISCARD_CHANNEL,
  RECOVERY_LIST_CHANNEL,
  RECOVERY_LOAD_CHANNEL,
  SECURITY_STATUS_CHANNEL,
  WORKSPACE_APPEND_OPERATION_CHANNEL,
  WORKSPACE_AUTOSAVE_CHANNEL,
  WORKSPACE_LIST_RECENT_CHANNEL,
  WORKSPACE_OPEN_CHANNEL,
  WORKSPACE_OPEN_RECENT_CHANNEL,
  WORKSPACE_SAVE_CHANNEL,
  WORKSPACE_SET_FAVORITE_CHANNEL,
  type CopyObsSourceUrlResponse,
  type PublishBroadcastSnapshotResponse,
  type RecoveryListResponse,
  type RecoveryLoadResponse,
  type SecurityStatus,
  type WorkspaceListRecentResponse,
  type WorkspaceMutationResponse,
  type WorkspaceOpenResponse,
  type WorkspaceSaveResponse,
  type WorkspaceSetFavoriteResponse,
} from './contracts.js';

export interface RuntimeInfo {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
  };
}

export interface LiveBoardApi {
  getRuntimeInfo(): RuntimeInfo;
  getSecurityStatus(requestId: string): Promise<SecurityStatus>;
  publishBroadcastSnapshot(
    requestId: string,
    snapshot: BroadcastSnapshot,
  ): Promise<PublishBroadcastSnapshotResponse>;
  copyObsSourceUrl(requestId: string): Promise<CopyObsSourceUrlResponse>;
  saveWorkspace(input: {
    requestId: string;
    workspaceId: string;
    revision: number;
    archive: Uint8Array;
    documentId?: string;
    saveAs: boolean;
  }): Promise<WorkspaceSaveResponse>;
  openWorkspace(requestId: string): Promise<WorkspaceOpenResponse>;
  openRecentWorkspace(
    requestId: string,
    documentId: string,
  ): Promise<WorkspaceOpenResponse>;
  listRecentWorkspaces(requestId: string): Promise<WorkspaceListRecentResponse>;
  setWorkspaceFavorite(
    requestId: string,
    documentId: string,
    favorite: boolean,
  ): Promise<WorkspaceSetFavoriteResponse>;
  appendWorkspaceOperation(
    requestId: string,
    workspaceId: string,
    revision: number,
  ): Promise<WorkspaceMutationResponse>;
  autosaveWorkspace(
    requestId: string,
    workspaceId: string,
    revision: number,
    archive: Uint8Array,
  ): Promise<WorkspaceMutationResponse>;
  listRecoveryCandidates(requestId: string): Promise<RecoveryListResponse>;
  loadRecoveryCandidate(
    requestId: string,
    candidateId: string,
  ): Promise<RecoveryLoadResponse>;
  discardRecoveryCandidate(
    requestId: string,
    candidateId: string,
    revision: number,
  ): Promise<WorkspaceMutationResponse>;
}

const runtimeInfo: RuntimeInfo = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
});

const liveBoardApi: LiveBoardApi = Object.freeze({
  getRuntimeInfo: (): RuntimeInfo => runtimeInfo,
  getSecurityStatus: (requestId: string): Promise<SecurityStatus> =>
    ipcRenderer.invoke(SECURITY_STATUS_CHANNEL, { requestId }) as Promise<SecurityStatus>,
  publishBroadcastSnapshot: (
    requestId: string,
    snapshot: BroadcastSnapshot,
  ): Promise<PublishBroadcastSnapshotResponse> =>
    ipcRenderer.invoke(BROADCAST_PUBLISH_CHANNEL, {
      requestId,
      snapshot,
    }) as Promise<PublishBroadcastSnapshotResponse>,
  copyObsSourceUrl: (requestId: string): Promise<CopyObsSourceUrlResponse> =>
    ipcRenderer.invoke(OBS_COPY_SOURCE_URL_CHANNEL, { requestId }) as Promise<CopyObsSourceUrlResponse>,
  saveWorkspace: (input): Promise<WorkspaceSaveResponse> =>
    ipcRenderer.invoke(WORKSPACE_SAVE_CHANNEL, input) as Promise<WorkspaceSaveResponse>,
  openWorkspace: (requestId): Promise<WorkspaceOpenResponse> =>
    ipcRenderer.invoke(WORKSPACE_OPEN_CHANNEL, { requestId }) as Promise<WorkspaceOpenResponse>,
  openRecentWorkspace: (requestId, documentId): Promise<WorkspaceOpenResponse> =>
    ipcRenderer.invoke(WORKSPACE_OPEN_RECENT_CHANNEL, {
      requestId,
      documentId,
    }) as Promise<WorkspaceOpenResponse>,
  listRecentWorkspaces: (requestId): Promise<WorkspaceListRecentResponse> =>
    ipcRenderer.invoke(WORKSPACE_LIST_RECENT_CHANNEL, { requestId }) as Promise<WorkspaceListRecentResponse>,
  setWorkspaceFavorite: (
    requestId,
    documentId,
    favorite,
  ): Promise<WorkspaceSetFavoriteResponse> =>
    ipcRenderer.invoke(WORKSPACE_SET_FAVORITE_CHANNEL, {
      requestId,
      documentId,
      favorite,
    }) as Promise<WorkspaceSetFavoriteResponse>,
  appendWorkspaceOperation: (
    requestId,
    workspaceId,
    revision,
  ): Promise<WorkspaceMutationResponse> =>
    ipcRenderer.invoke(WORKSPACE_APPEND_OPERATION_CHANNEL, {
      requestId,
      workspaceId,
      revision,
    }) as Promise<WorkspaceMutationResponse>,
  autosaveWorkspace: (
    requestId,
    workspaceId,
    revision,
    archive,
  ): Promise<WorkspaceMutationResponse> =>
    ipcRenderer.invoke(WORKSPACE_AUTOSAVE_CHANNEL, {
      requestId,
      workspaceId,
      revision,
      archive,
    }) as Promise<WorkspaceMutationResponse>,
  listRecoveryCandidates: (requestId): Promise<RecoveryListResponse> =>
    ipcRenderer.invoke(RECOVERY_LIST_CHANNEL, { requestId }) as Promise<RecoveryListResponse>,
  loadRecoveryCandidate: (
    requestId,
    candidateId,
  ): Promise<RecoveryLoadResponse> =>
    ipcRenderer.invoke(RECOVERY_LOAD_CHANNEL, {
      requestId,
      candidateId,
    }) as Promise<RecoveryLoadResponse>,
  discardRecoveryCandidate: (
    requestId,
    candidateId,
    revision,
  ): Promise<WorkspaceMutationResponse> =>
    ipcRenderer.invoke(RECOVERY_DISCARD_CHANNEL, {
      requestId,
      candidateId,
      revision,
    }) as Promise<WorkspaceMutationResponse>,
});

contextBridge.exposeInMainWorld('liveBoard', liveBoardApi);
