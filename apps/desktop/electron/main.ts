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
import { BroadcastDescriptorPublisher } from './broadcast-publisher.js';
import {
  BROADCAST_PUBLISH_CHANNEL,
  BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL,
  BROADCAST_REGISTER_ASSETS_CHANNEL,
  OBS_COPY_SOURCE_URL_CHANNEL,
  parsePublishBroadcastLayerPatchRequest,
  parsePublishBroadcastSnapshotRequest,
  parseRegisterBroadcastAssetsRequest,
  parseSecurityStatusRequest,
  SECURITY_STATUS_CHANNEL,
  type CopyObsSourceUrlResponse,
  type PublishBroadcastSnapshotResponse,
  type RegisterBroadcastAssetsResponse,
  type SecurityStatus,
} from './contracts.js';
import {
  parsePackagedSmokeArguments,
  resolvePackagedResourcePaths,
} from './packaged-resources.js';
import {
  runPackagedSmokeTest,
  writePackagedSmokeResult,
} from './packaged-smoke-test.js';
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

function resolveOverlayRoot(): string {
  if (!app.isPackaged) {
    return join(currentDirectory, '../../overlay/dist');
  }
  return resolvePackagedResourcePaths(
    currentDirectory,
    process.resourcesPath,
  ).overlayRoot;
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
  const publisher = new BroadcastDescriptorPublisher(bridge);

  ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
  ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);
  ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);
  ipcMain.removeHandler(BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL);
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

  ipcMain.handle(BROADCAST_REGISTER_ASSETS_CHANNEL, (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parseRegisterBroadcastAssetsRequest(input);
    const response: RegisterBroadcastAssetsResponse = {
      requestId: request.requestId,
      registeredSha256: bridge.registerAssets(request.assets),
    };
    return response;
  });

  ipcMain.handle(BROADCAST_PUBLISH_CHANNEL, (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parsePublishBroadcastSnapshotRequest(input);
    const acceptedRevision = publisher.publishSnapshot(request.snapshot);
    const response: PublishBroadcastSnapshotResponse = {
      requestId: request.requestId,
      acceptedRevision,
    };

    return response;
  });

  ipcMain.handle(
    BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL,
    (event, input: unknown) => {
      assertTrustedEvent(event, trustConfig);
      const request = parsePublishBroadcastLayerPatchRequest(input);
      const acceptedRevision = publisher.publishLayerPatch(request.patch);
      const response: PublishBroadcastSnapshotResponse = {
        requestId: request.requestId,
        acceptedRevision,
      };
      return response;
    },
  );

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
  const smokeArguments = parsePackagedSmokeArguments(process.argv);
  if (smokeArguments.enabled) {
    if (!app.isPackaged) {
      throw new Error('PACKAGED_SMOKE_TEST_REQUIRES_PACKAGED_APP');
    }

    const result = await runPackagedSmokeTest({
      currentDirectory,
      resourcesPath: process.resourcesPath,
      version: app.getVersion(),
    });
    if (smokeArguments.outputPath !== undefined) {
      await writePackagedSmokeResult(smokeArguments.outputPath, result);
    }
    console.log('[Live Board] packaged smoke test passed', result);
    shutdownComplete = true;
    app.quit();
    return;
  }

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
    overlayRoot: resolveOverlayRoot(),
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
    process.exitCode = 1;
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
      ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);
      ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);
      ipcMain.removeHandler(BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL);
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
