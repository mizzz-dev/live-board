import type {
  BroadcastAssetRegistration,
  BroadcastLayerPatchDescriptor,
  BroadcastSnapshotDescriptor,
} from '@live-board/obs-protocol';
import { contextBridge, ipcRenderer } from 'electron';
import {
  BROADCAST_PUBLISH_CHANNEL,
  BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL,
  BROADCAST_REGISTER_ASSETS_CHANNEL,
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
  type RegisterBroadcastAssetsResponse,
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
  registerBroadcastAssets(
    requestId: string,
    assets: BroadcastAssetRegistration[],
  ): Promise<RegisterBroadcastAssetsResponse>;
  publishBroadcastSnapshot(
    requestId: string,
    snapshot: BroadcastSnapshotDescriptor,
  ): Promise<PublishBroadcastSnapshotResponse>;
  publishBroadcastLayerPatch(
    requestId: string,
    patch: BroadcastLayerPatchDescriptor,
  ): Promise<PublishBroadcastSnapshotResponse>;
  copyObsSourceUrl(requestId: string): Promise<CopyObsSourceUrlResponse>;
  saveWorkspace(input: {
    requestId: string;
    workspaceId: string;
    revision: number;
    archive: Uint8Array;
    documentId?: string | undefined;
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
  registerBroadcastAssets: (
    requestId: string,
    assets: BroadcastAssetRegistration[],
  ): Promise<RegisterBroadcastAssetsResponse> =>
    ipcRenderer.invoke(BROADCAST_REGISTER_ASSETS_CHANNEL, {
      requestId,
      assets,
    }) as Promise<RegisterBroadcastAssetsResponse>,
  publishBroadcastSnapshot: (
    requestId: string,
    snapshot: BroadcastSnapshotDescriptor,
  ): Promise<PublishBroadcastSnapshotResponse> =>
    ipcRenderer.invoke(BROADCAST_PUBLISH_CHANNEL, {
      requestId,
      snapshot,
    }) as Promise<PublishBroadcastSnapshotResponse>,
  publishBroadcastLayerPatch: (
    requestId: string,
    patch: BroadcastLayerPatchDescriptor,
  ): Promise<PublishBroadcastSnapshotResponse> =>
    ipcRenderer.invoke(BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL, {
      requestId,
      patch,
    }) as Promise<PublishBroadcastSnapshotResponse>,
  copyObsSourceUrl: (requestId: string): Promise<CopyObsSourceUrlResponse> =>
    ipcRenderer.invoke(OBS_COPY_SOURCE_URL_CHANNEL, { requestId }) as Promise<CopyObsSourceUrlResponse>,
  saveWorkspace: (input: Parameters<LiveBoardApi['saveWorkspace']>[0]): Promise<WorkspaceSaveResponse> =>
    ipcRenderer.invoke(WORKSPACE_SAVE_CHANNEL, input) as Promise<WorkspaceSaveResponse>,
  openWorkspace: (requestId: string): Promise<WorkspaceOpenResponse> =>
    ipcRenderer.invoke(WORKSPACE_OPEN_CHANNEL, { requestId }) as Promise<WorkspaceOpenResponse>,
  openRecentWorkspace: (requestId: string, documentId: string): Promise<WorkspaceOpenResponse> =>
    ipcRenderer.invoke(WORKSPACE_OPEN_RECENT_CHANNEL, {
      requestId,
      documentId,
    }) as Promise<WorkspaceOpenResponse>,
  listRecentWorkspaces: (requestId: string): Promise<WorkspaceListRecentResponse> =>
    ipcRenderer.invoke(WORKSPACE_LIST_RECENT_CHANNEL, { requestId }) as Promise<WorkspaceListRecentResponse>,
  setWorkspaceFavorite: (
    requestId: string,
    documentId: string,
    favorite: boolean,
  ): Promise<WorkspaceSetFavoriteResponse> =>
    ipcRenderer.invoke(WORKSPACE_SET_FAVORITE_CHANNEL, {
      requestId,
      documentId,
      favorite,
    }) as Promise<WorkspaceSetFavoriteResponse>,
  appendWorkspaceOperation: (
    requestId: string,
    workspaceId: string,
    revision: number,
  ): Promise<WorkspaceMutationResponse> =>
    ipcRenderer.invoke(WORKSPACE_APPEND_OPERATION_CHANNEL, {
      requestId,
      workspaceId,
      revision,
    }) as Promise<WorkspaceMutationResponse>,
  autosaveWorkspace: (
    requestId: string,
    workspaceId: string,
    revision: number,
    archive: Uint8Array,
  ): Promise<WorkspaceMutationResponse> =>
    ipcRenderer.invoke(WORKSPACE_AUTOSAVE_CHANNEL, {
      requestId,
      workspaceId,
      revision,
      archive,
    }) as Promise<WorkspaceMutationResponse>,
  listRecoveryCandidates: (requestId: string): Promise<RecoveryListResponse> =>
    ipcRenderer.invoke(RECOVERY_LIST_CHANNEL, { requestId }) as Promise<RecoveryListResponse>,
  loadRecoveryCandidate: (
    requestId: string,
    candidateId: string,
  ): Promise<RecoveryLoadResponse> =>
    ipcRenderer.invoke(RECOVERY_LOAD_CHANNEL, {
      requestId,
      candidateId,
    }) as Promise<RecoveryLoadResponse>,
  discardRecoveryCandidate: (
    requestId: string,
    candidateId: string,
    revision: number,
  ): Promise<WorkspaceMutationResponse> =>
    ipcRenderer.invoke(RECOVERY_DISCARD_CHANNEL, {
      requestId,
      candidateId,
      revision,
    }) as Promise<WorkspaceMutationResponse>,
});

contextBridge.exposeInMainWorld('liveBoard', liveBoardApi);
