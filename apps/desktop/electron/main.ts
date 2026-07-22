import { startObsBridge, type ObsBridge } from '@live-board/obs-bridge';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BROADCAST_PUBLISH_CHANNEL,
  OBS_COPY_SOURCE_URL_CHANNEL,
  parsePublishBroadcastSnapshotRequest,
  parseSecurityStatusRequest,
  SECURITY_STATUS_CHANNEL,
  type CopyObsSourceUrlResponse,
  type PublishBroadcastSnapshotResponse,
  type SecurityStatus,
} from './contracts.js';
import {
  registerPersistenceIpcHandlers,
  removePersistenceIpcHandlers,
} from './persistence-ipc.js';
import { createWorkspacePersistenceService } from './persistence-service.js';
import {
  assertTrustedIpcSender,
  createRendererContentSecurityPolicy,
  installContentSecurityPolicy,
  installPermissionDenyPolicy,
  isTrustedRendererUrl,
  type RendererTrustConfig,
} from './security.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;

let obsBridge: ObsBridge | undefined;
let shutdownPromise: Promise<void> | undefined;
let shutdownComplete = false;
let removeRegisteredPersistenceHandlers: (() => void) | undefined;

async function createMainWindow(
  rendererEntryUrl: string,
  trustConfig: RendererTrustConfig,
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#111827',
    webPreferences: {
      preload: join(currentDirectory, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, trustConfig)) {
      event.preventDefault();
    }
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  await window.loadURL(rendererEntryUrl);

  return window;
}

function createTrustConfig(): RendererTrustConfig {
  const packagedRendererUrl = pathToFileURL(
    join(currentDirectory, '../dist/index.html'),
  ).toString();

  if (developmentServerUrl === undefined) {
    return { packagedRendererUrl };
  }

  return {
    packagedRendererUrl,
    developmentServerUrl,
  };
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

function registerIpcHandlers(
  trustConfig: RendererTrustConfig,
  bridge: ObsBridge,
): void {
  ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
  ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);
  ipcMain.removeHandler(OBS_COPY_SOURCE_URL_CHANNEL);

  ipcMain.handle(SECURITY_STATUS_CHANNEL, (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseSecurityStatusRequest(input);
    const response: SecurityStatus = {
      requestId: request.requestId,
      electron: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
      obsBridge: {
        running: true,
        host: bridge.info.host,
        port: bridge.info.port,
        connectionCount: bridge.getConnectionCount(),
        latestRevision: bridge.getLatestRevision(),
      },
    };

    return response;
  });

  ipcMain.handle(BROADCAST_PUBLISH_CHANNEL, (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parsePublishBroadcastSnapshotRequest(input);
    const response: PublishBroadcastSnapshotResponse = {
      requestId: request.requestId,
      acceptedRevision: bridge.publishSnapshot(request.snapshot),
    };

    return response;
  });

  ipcMain.handle(OBS_COPY_SOURCE_URL_CHANNEL, (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseSecurityStatusRequest(input);
    clipboard.writeText(bridge.info.overlayUrl);
    const response: CopyObsSourceUrlResponse = {
      requestId: request.requestId,
      copied: true,
    };

    return response;
  });
}

async function initializeApplication(): Promise<void> {
  const trustConfig = createTrustConfig();
  const rendererEntryUrl =
    developmentServerUrl ?? trustConfig.packagedRendererUrl;

  installContentSecurityPolicy(
    session.defaultSession,
    createRendererContentSecurityPolicy(),
  );
  installPermissionDenyPolicy(session.defaultSession);

  const persistenceService = createWorkspacePersistenceService(
    join(app.getPath('userData'), 'persistence'),
  );
  await persistenceService.initialize();

  obsBridge = await startObsBridge({
    allowedOrigins:
      developmentServerUrl === undefined
        ? []
        : ['http://127.0.0.1:5174'],
    overlayRoot: join(currentDirectory, '../../overlay/dist'),
  });
  registerIpcHandlers(trustConfig, obsBridge);
  removeRegisteredPersistenceHandlers = registerPersistenceIpcHandlers(
    trustConfig,
    persistenceService,
  );

  await createMainWindow(rendererEntryUrl, trustConfig);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow(rendererEntryUrl, trustConfig);
    }
  });
}

void app
  .whenReady()
  .then(initializeApplication)
  .catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Live Board] startup failed', {
      errorName,
      errorMessage,
    });
    app.quit();
  });

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();

  shutdownPromise ??= Promise.resolve()
    .then(async () => {
      if (obsBridge !== undefined) await obsBridge.close();
    })
    .catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error('[Live Board] shutdown failed', { errorName });
    })
    .finally(() => {
      shutdownComplete = true;
      ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
      ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);
      ipcMain.removeHandler(OBS_COPY_SOURCE_URL_CHANNEL);
      removeRegisteredPersistenceHandlers?.();
      removePersistenceIpcHandlers();
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
