/// <reference types="vite/client" />

interface RuntimeInfo {
  platform: string;
  versions: {
    electron: string;
    chrome: string;
  };
}

interface SecurityStatus {
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

interface RegisterBroadcastAssetsResponse {
  requestId: string;
  registeredSha256: string[];
}

interface PublishBroadcastSnapshotResponse {
  requestId: string;
  acceptedRevision: number;
}

interface CopyObsSourceUrlResponse {
  requestId: string;
  copied: true;
}

interface PublicDocumentRecord {
  documentId: string;
  displayName: string;
  favorite: boolean;
  lastOpenedAt: string;
  lastSavedAt: string | null;
}

interface PublicRecoveryCandidate {
  candidateId: string;
  workspaceId: string;
  revision: number;
  savedAt: string;
  operationCountAfterSnapshot: number;
}

interface WorkspaceSaveResponse {
  requestId: string;
  canceled: boolean;
  document?: PublicDocumentRecord;
  archiveSha256?: string;
}

interface WorkspaceOpenResponse {
  requestId: string;
  canceled: boolean;
  document?: PublicDocumentRecord;
  archive?: Uint8Array;
}

interface WorkspaceListRecentResponse {
  requestId: string;
  documents: PublicDocumentRecord[];
}

interface WorkspaceSetFavoriteResponse {
  requestId: string;
  document: PublicDocumentRecord;
}

interface WorkspaceMutationResponse {
  requestId: string;
  accepted: true;
}

interface RecoveryListResponse {
  requestId: string;
  candidates: PublicRecoveryCandidate[];
}

interface RecoveryLoadResponse {
  requestId: string;
  archive: Uint8Array;
}

interface Window {
  liveBoard?: {
    getRuntimeInfo: () => RuntimeInfo;
    getSecurityStatus: (requestId: string) => Promise<SecurityStatus>;
    registerBroadcastAssets: (
      requestId: string,
      assets: import('@live-board/obs-protocol').BroadcastAssetRegistration[],
    ) => Promise<RegisterBroadcastAssetsResponse>;
    publishBroadcastSnapshot: (
      requestId: string,
      snapshot: import('@live-board/obs-protocol').BroadcastSnapshotDescriptor,
    ) => Promise<PublishBroadcastSnapshotResponse>;
    publishBroadcastLayerPatch: (
      requestId: string,
      patch: import('@live-board/obs-protocol').BroadcastLayerPatchDescriptor,
    ) => Promise<PublishBroadcastSnapshotResponse>;
    copyObsSourceUrl: (requestId: string) => Promise<CopyObsSourceUrlResponse>;
    saveWorkspace: (input: {
      requestId: string;
      workspaceId: string;
      revision: number;
      archive: Uint8Array;
      documentId?: string | undefined;
      saveAs: boolean;
    }) => Promise<WorkspaceSaveResponse>;
    openWorkspace: (requestId: string) => Promise<WorkspaceOpenResponse>;
    openRecentWorkspace: (
      requestId: string,
      documentId: string,
    ) => Promise<WorkspaceOpenResponse>;
    listRecentWorkspaces: (
      requestId: string,
    ) => Promise<WorkspaceListRecentResponse>;
    setWorkspaceFavorite: (
      requestId: string,
      documentId: string,
      favorite: boolean,
    ) => Promise<WorkspaceSetFavoriteResponse>;
    appendWorkspaceOperation: (
      requestId: string,
      workspaceId: string,
      revision: number,
    ) => Promise<WorkspaceMutationResponse>;
    autosaveWorkspace: (
      requestId: string,
      workspaceId: string,
      revision: number,
      archive: Uint8Array,
    ) => Promise<WorkspaceMutationResponse>;
    listRecoveryCandidates: (
      requestId: string,
    ) => Promise<RecoveryListResponse>;
    loadRecoveryCandidate: (
      requestId: string,
      candidateId: string,
    ) => Promise<RecoveryLoadResponse>;
    discardRecoveryCandidate: (
      requestId: string,
      candidateId: string,
      revision: number,
    ) => Promise<WorkspaceMutationResponse>;
  };
}
