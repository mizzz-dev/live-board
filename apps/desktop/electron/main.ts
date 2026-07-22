import { startObsBridge, type ObsBridge } from '@live-board/obs-bridge';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseSecurityStatusRequest,
  SECURITY_STATUS_CHANNEL,
  type SecurityStatus,
} from './contracts.js';
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

function registerSecurityIpcHandlers(
  trustConfig: RendererTrustConfig,
  bridge: ObsBridge,
): void {
  ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
  ipcMain.handle(SECURITY_STATUS_CHANNEL, (event, input: unknown) => {
    const senderFrame = event.senderFrame;

    assertTrustedIpcSender(
      {
        senderUrl: senderFrame?.url ?? '',
        isMainFrame:
          senderFrame !== null && senderFrame === event.sender.mainFrame,
      },
      trustConfig,
    );

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
      },
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

  obsBridge = await startObsBridge({
    allowedOrigins:
      developmentServerUrl === undefined
        ? []
        : ['http://127.0.0.1:5174'],
  });
  registerSecurityIpcHandlers(trustConfig, obsBridge);

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
  if (obsBridge === undefined || shutdownComplete) {
    return;
  }

  event.preventDefault();

  shutdownPromise ??= obsBridge
    .close()
    .catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error('[Live Board] OBS bridge shutdown failed', { errorName });
    })
    .finally(() => {
      shutdownComplete = true;
      ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
