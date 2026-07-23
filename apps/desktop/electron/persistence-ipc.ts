import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  RECOVERY_DISCARD_CHANNEL,
  RECOVERY_LIST_CHANNEL,
  RECOVERY_LOAD_CHANNEL,
  WORKSPACE_APPEND_OPERATION_CHANNEL,
  WORKSPACE_AUTOSAVE_CHANNEL,
  WORKSPACE_LIST_RECENT_CHANNEL,
  WORKSPACE_OPEN_CHANNEL,
  WORKSPACE_OPEN_RECENT_CHANNEL,
  WORKSPACE_SAVE_CHANNEL,
  WORKSPACE_SET_FAVORITE_CHANNEL,
  parseRecoveryCandidateRequest,
  parseRecoveryDiscardRequest,
  parseSecurityStatusRequest,
  parseWorkspaceAutosaveRequest,
  parseWorkspaceOpenRecentRequest,
  parseWorkspaceRevisionRequest,
  parseWorkspaceSaveRequest,
  parseWorkspaceSetFavoriteRequest,
  type RecoveryListResponse,
  type RecoveryLoadResponse,
  type WorkspaceListRecentResponse,
  type WorkspaceMutationResponse,
  type WorkspaceOpenResponse,
  type WorkspaceSaveResponse,
  type WorkspaceSetFavoriteResponse,
} from './contracts.js';
import type { WorkspacePersistenceService } from './persistence-service.js';
import {
  assertTrustedIpcSender,
  type RendererTrustConfig,
} from './security.js';

const PERSISTENCE_CHANNELS = [
  WORKSPACE_SAVE_CHANNEL,
  WORKSPACE_OPEN_CHANNEL,
  WORKSPACE_OPEN_RECENT_CHANNEL,
  WORKSPACE_LIST_RECENT_CHANNEL,
  WORKSPACE_SET_FAVORITE_CHANNEL,
  WORKSPACE_APPEND_OPERATION_CHANNEL,
  WORKSPACE_AUTOSAVE_CHANNEL,
  RECOVERY_LIST_CHANNEL,
  RECOVERY_LOAD_CHANNEL,
  RECOVERY_DISCARD_CHANNEL,
] as const;

export function registerPersistenceIpcHandlers(
  trustConfig: RendererTrustConfig,
  service: WorkspacePersistenceService,
): () => void {
  removePersistenceIpcHandlers();

  ipcMain.handle(WORKSPACE_SAVE_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseWorkspaceSaveRequest(input);
    let targetPath: string | undefined;
    if (request.saveAs || request.documentId === undefined) {
      const result = await dialog.showSaveDialog({
        title: 'Live Boardワークスペースを保存',
        defaultPath: `${safeFileStem(request.workspaceId)}.liveboard`,
        filters: [{ name: 'Live Board Workspace', extensions: ['liveboard'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || result.filePath === '') {
        const response: WorkspaceSaveResponse = {
          requestId: request.requestId,
          canceled: true,
        };
        return response;
      }
      targetPath = ensureLiveboardExtension(result.filePath);
    }
    const saved = await service.saveDocument({
      workspaceId: request.workspaceId,
      revision: request.revision,
      archive: request.archive,
      documentId: request.saveAs ? undefined : request.documentId,
      targetPath,
    });
    const response: WorkspaceSaveResponse = {
      requestId: request.requestId,
      canceled: false,
      document: saved.document,
      archiveSha256: saved.archiveSha256,
    };
    return response;
  });

  ipcMain.handle(WORKSPACE_OPEN_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseSecurityStatusRequest(input);
    const result = await dialog.showOpenDialog({
      title: 'Live Boardワークスペースを開く',
      filters: [{ name: 'Live Board Workspace', extensions: ['liveboard'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length !== 1) {
      const response: WorkspaceOpenResponse = {
        requestId: request.requestId,
        canceled: true,
      };
      return response;
    }
    const opened = await service.openDocumentPath(result.filePaths[0]!);
    const response: WorkspaceOpenResponse = {
      requestId: request.requestId,
      canceled: false,
      document: opened.document,
      archive: opened.archive,
    };
    return response;
  });

  ipcMain.handle(WORKSPACE_OPEN_RECENT_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseWorkspaceOpenRecentRequest(input);
    const opened = await service.openRecentDocument(request.documentId);
    const response: WorkspaceOpenResponse = {
      requestId: request.requestId,
      canceled: false,
      document: opened.document,
      archive: opened.archive,
    };
    return response;
  });

  ipcMain.handle(WORKSPACE_LIST_RECENT_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseSecurityStatusRequest(input);
    const response: WorkspaceListRecentResponse = {
      requestId: request.requestId,
      documents: await service.listRecentDocuments(),
    };
    return response;
  });

  ipcMain.handle(WORKSPACE_SET_FAVORITE_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseWorkspaceSetFavoriteRequest(input);
    const response: WorkspaceSetFavoriteResponse = {
      requestId: request.requestId,
      document: await service.setFavorite(request.documentId, request.favorite),
    };
    return response;
  });

  ipcMain.handle(WORKSPACE_APPEND_OPERATION_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseWorkspaceRevisionRequest(input);
    await service.appendOperation(request.workspaceId, request.revision);
    const response: WorkspaceMutationResponse = {
      requestId: request.requestId,
      accepted: true,
    };
    return response;
  });

  ipcMain.handle(WORKSPACE_AUTOSAVE_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseWorkspaceAutosaveRequest(input);
    await service.saveRecoverySnapshot(
      request.workspaceId,
      request.revision,
      request.archive,
    );
    const response: WorkspaceMutationResponse = {
      requestId: request.requestId,
      accepted: true,
    };
    return response;
  });

  ipcMain.handle(RECOVERY_LIST_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseSecurityStatusRequest(input);
    const response: RecoveryListResponse = {
      requestId: request.requestId,
      candidates: await service.listRecoveryCandidates(),
    };
    return response;
  });

  ipcMain.handle(RECOVERY_LOAD_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseRecoveryCandidateRequest(input);
    const response: RecoveryLoadResponse = {
      requestId: request.requestId,
      archive: await service.loadRecoveryCandidate(request.candidateId),
    };
    return response;
  });

  ipcMain.handle(RECOVERY_DISCARD_CHANNEL, async (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseRecoveryDiscardRequest(input);
    await service.discardRecoveryCandidate(request.candidateId, request.revision);
    const response: WorkspaceMutationResponse = {
      requestId: request.requestId,
      accepted: true,
    };
    return response;
  });

  return removePersistenceIpcHandlers;
}

export function removePersistenceIpcHandlers(): void {
  for (const channel of PERSISTENCE_CHANNELS) ipcMain.removeHandler(channel);
}

function assertTrustedEvent(
  event: IpcMainInvokeEvent,
  trustConfig: RendererTrustConfig,
): void {
  const senderFrame = event.senderFrame;
  assertTrustedIpcSender(
    {
      senderUrl: senderFrame?.url ?? '',
      isMainFrame:
        senderFrame !== null && senderFrame === event.sender.mainFrame,
    },
    trustConfig,
  );
}

function ensureLiveboardExtension(path: string): string {
  return path.toLowerCase().endsWith('.liveboard') ? path : `${path}.liveboard`;
}

function safeFileStem(workspaceId: string): string {
  return workspaceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'workspace';
}
