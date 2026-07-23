import { readFile, writeFile, unlink } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const content = await readFile(path, 'utf8');
  if (!content.includes(before)) {
    throw new Error(`更新対象が見つかりません: ${path}: ${before.slice(0, 100)}`);
  }
  await writeFile(path, content.replace(before, after));
}

await replaceOnce(
  'packages/obs-bridge/src/index.ts',
  `import {
  createBroadcastLayerPatch,
  parseBroadcastSnapshot,
  parseObsBridgeClientMessage,
  parsePageTransition,
  type BroadcastSnapshot,
  type ObsBridgeClientMessage,
  type ObsBridgeServerMessage,
  type PageTransition,
} from '@live-board/obs-protocol';`,
  `import {
  createBroadcastLayerPatch,
  parseBroadcastSnapshot,
  parseBroadcastSnapshotDescriptor,
  parseObsBridgeClientMessage,
  parsePageTransition,
  type BroadcastAssetRegistration,
  type BroadcastSnapshot,
  type BroadcastSnapshotDescriptor,
  type ObsBridgeClientMessage,
  type ObsBridgeServerMessage,
  type PageTransition,
} from '@live-board/obs-protocol';`,
);

await replaceOnce(
  'packages/obs-bridge/src/index.ts',
  `export interface ObsBridge {
  readonly info: ObsBridgeInfo;
  getConnectionCount(): number;
  getLatestRevision(): number | null;
  getAssetStats(): BroadcastAssetRegistryStats;
  publishSnapshot(snapshot: BroadcastSnapshot): number;
  close(): Promise<void>;
}`,
  `export interface ObsBridge {
  readonly info: ObsBridgeInfo;
  getConnectionCount(): number;
  getLatestRevision(): number | null;
  getAssetStats(): BroadcastAssetRegistryStats;
  registerAssets(assets: readonly BroadcastAssetRegistration[]): string[];
  publishSnapshot(snapshot: BroadcastSnapshot): number;
  publishSnapshotDescriptor(snapshot: BroadcastSnapshotDescriptor): number;
  close(): Promise<void>;
}`,
);

await replaceOnce(
  'packages/obs-bridge/src/index.ts',
  `export {
  type BroadcastSnapshot,
  type ObsBridgeClientMessage,
  type PageTransition,
};`,
  `export {
  type BroadcastAssetRegistration,
  type BroadcastSnapshot,
  type BroadcastSnapshotDescriptor,
  type ObsBridgeClientMessage,
  type PageTransition,
};`,
);

await replaceOnce(
  'packages/obs-bridge/src/index.ts',
  `  const info: ObsBridgeInfo = Object.freeze({
    host,
    port: resolvedPort,
    overlayUrl: \`${'${ownOrigin}'}/overlay/${'${token}'}\`,
    webSocketUrl: \`ws://${'${formattedHost}'}:${'${resolvedPort}'}/ws?token=${'${token}'}\`,
  });

  return {
    info,
    getConnectionCount: () => webSocketServer.clients.size,
    getLatestRevision: () => latestSnapshot?.revision ?? null,
    getAssetStats: () => assetRegistry.getStats(),
    publishSnapshot: (input) => {
      const parsedSnapshot = parseBroadcastSnapshot(input);
      if (
        latestSnapshot !== undefined &&
        parsedSnapshot.revision <= latestSnapshot.revision
      ) {
        throw new Error('OBS_BRIDGE_STALE_REVISION');
      }
      const snapshot = assetRegistry.prepareSnapshot(parsedSnapshot, token);

      const message = createSnapshotMessage(
        latestSnapshot,
        snapshot,
        pageTransition,
      );
      latestSnapshot = snapshot;
      for (const client of webSocketServer.clients) {
        if (client.readyState === 1) sendServerMessage(client, message);
      }
      return snapshot.revision;
    },`,
  `  const info: ObsBridgeInfo = Object.freeze({
    host,
    port: resolvedPort,
    overlayUrl: \`${'${ownOrigin}'}/overlay/${'${token}'}\`,
    webSocketUrl: \`ws://${'${formattedHost}'}:${'${resolvedPort}'}/ws?token=${'${token}'}\`,
  });

  const assertFreshRevision = (revision: number): void => {
    if (latestSnapshot !== undefined && revision <= latestSnapshot.revision) {
      throw new Error('OBS_BRIDGE_STALE_REVISION');
    }
  };
  const publishPreparedSnapshot = (snapshot: BroadcastSnapshot): number => {
    const message = createSnapshotMessage(
      latestSnapshot,
      snapshot,
      pageTransition,
    );
    latestSnapshot = snapshot;
    for (const client of webSocketServer.clients) {
      if (client.readyState === 1) sendServerMessage(client, message);
    }
    return snapshot.revision;
  };

  return {
    info,
    getConnectionCount: () => webSocketServer.clients.size,
    getLatestRevision: () => latestSnapshot?.revision ?? null,
    getAssetStats: () => assetRegistry.getStats(),
    registerAssets: (input) => assetRegistry.registerAssets(input),
    publishSnapshot: (input) => {
      const parsedSnapshot = parseBroadcastSnapshot(input);
      assertFreshRevision(parsedSnapshot.revision);
      return publishPreparedSnapshot(
        assetRegistry.prepareSnapshot(parsedSnapshot, token),
      );
    },
    publishSnapshotDescriptor: (input) => {
      const parsedSnapshot = parseBroadcastSnapshotDescriptor(input);
      assertFreshRevision(parsedSnapshot.revision);
      return publishPreparedSnapshot(
        assetRegistry.prepareSnapshotDescriptor(parsedSnapshot, token),
      );
    },`,
);

await replaceOnce(
  'apps/desktop/electron/contracts.ts',
  `import {
  parseBroadcastSnapshot,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';`,
  `import {
  parseBroadcastAssetRegistration,
  parseBroadcastSnapshotDescriptor,
  type BroadcastAssetRegistration,
  type BroadcastSnapshotDescriptor,
} from '@live-board/obs-protocol';`,
);

await replaceOnce(
  'apps/desktop/electron/contracts.ts',
  `export const SECURITY_STATUS_CHANNEL = 'security:get-status';
export const BROADCAST_PUBLISH_CHANNEL = 'broadcast:publish-snapshot';`,
  `export const SECURITY_STATUS_CHANNEL = 'security:get-status';
export const BROADCAST_REGISTER_ASSETS_CHANNEL = 'broadcast:register-assets';
export const BROADCAST_PUBLISH_CHANNEL = 'broadcast:publish-snapshot';`,
);

await replaceOnce(
  'apps/desktop/electron/contracts.ts',
  `export interface PublishBroadcastSnapshotRequest {
  requestId: string;
  snapshot: BroadcastSnapshot;
}

export interface PublishBroadcastSnapshotResponse {
  requestId: string;
  acceptedRevision: number;
}`,
  `export interface RegisterBroadcastAssetsRequest {
  requestId: string;
  assets: BroadcastAssetRegistration[];
}

export interface RegisterBroadcastAssetsResponse {
  requestId: string;
  registeredSha256: string[];
}

export interface PublishBroadcastSnapshotRequest {
  requestId: string;
  snapshot: BroadcastSnapshotDescriptor;
}

export interface PublishBroadcastSnapshotResponse {
  requestId: string;
  acceptedRevision: number;
}`,
);

await replaceOnce(
  'apps/desktop/electron/contracts.ts',
  `export function parsePublishBroadcastSnapshotRequest(
  input: unknown,
): PublishBroadcastSnapshotRequest {
  if (!isRecord(input)) {
    throw new Error('IPC_INVALID_REQUEST');
  }
  return {
    requestId: parseRequestId(input.requestId),
    snapshot: parseBroadcastSnapshot(input.snapshot),
  };
}`,
  `export function parseRegisterBroadcastAssetsRequest(
  input: unknown,
): RegisterBroadcastAssetsRequest {
  if (!isRecord(input) || !Array.isArray(input.assets) || input.assets.length > 256) {
    throw new Error('IPC_INVALID_BROADCAST_ASSETS');
  }
  const requestId = parseRequestId(input.requestId);
  const assets = input.assets.map(parseBroadcastAssetRegistration);
  const hashes = new Set<string>();
  let totalBytes = 0;
  for (const asset of assets) {
    if (hashes.has(asset.sha256)) {
      throw new Error('IPC_DUPLICATE_BROADCAST_ASSET');
    }
    hashes.add(asset.sha256);
    totalBytes += asset.byteLength;
  }
  if (totalBytes > 256 * 1024 * 1024) {
    throw new Error('IPC_BROADCAST_ASSET_TOTAL_LIMIT');
  }
  return { requestId, assets };
}

export function parsePublishBroadcastSnapshotRequest(
  input: unknown,
): PublishBroadcastSnapshotRequest {
  if (!isRecord(input)) {
    throw new Error('IPC_INVALID_REQUEST');
  }
  return {
    requestId: parseRequestId(input.requestId),
    snapshot: parseBroadcastSnapshotDescriptor(input.snapshot),
  };
}`,
);

await replaceOnce(
  'apps/desktop/electron/main.ts',
  `  BROADCAST_PUBLISH_CHANNEL,
  OBS_COPY_SOURCE_URL_CHANNEL,
  parsePublishBroadcastSnapshotRequest,
  parseSecurityStatusRequest,
  SECURITY_STATUS_CHANNEL,
  type CopyObsSourceUrlResponse,
  type PublishBroadcastSnapshotResponse,
  type SecurityStatus,`,
  `  BROADCAST_PUBLISH_CHANNEL,
  BROADCAST_REGISTER_ASSETS_CHANNEL,
  OBS_COPY_SOURCE_URL_CHANNEL,
  parsePublishBroadcastSnapshotRequest,
  parseRegisterBroadcastAssetsRequest,
  parseSecurityStatusRequest,
  SECURITY_STATUS_CHANNEL,
  type CopyObsSourceUrlResponse,
  type PublishBroadcastSnapshotResponse,
  type RegisterBroadcastAssetsResponse,
  type SecurityStatus,`,
);

await replaceOnce(
  'apps/desktop/electron/main.ts',
  `  ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
  ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);`,
  `  ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
  ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);
  ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);`,
);

await replaceOnce(
  'apps/desktop/electron/main.ts',
  `  ipcMain.handle(BROADCAST_PUBLISH_CHANNEL, (event, input: unknown) => {
    assertTrustedEvent(event, trustConfig);
    const request = parsePublishBroadcastSnapshotRequest(input);
    const response: PublishBroadcastSnapshotResponse = {
      requestId: request.requestId,
      acceptedRevision: bridge.publishSnapshot(request.snapshot),
    };

    return response;
  });`,
  `  ipcMain.handle(BROADCAST_REGISTER_ASSETS_CHANNEL, (event, input: unknown) => {
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
    const response: PublishBroadcastSnapshotResponse = {
      requestId: request.requestId,
      acceptedRevision: bridge.publishSnapshotDescriptor(request.snapshot),
    };

    return response;
  });`,
);

await replaceOnce(
  'apps/desktop/electron/main.ts',
  `      ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
      ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);`,
  `      ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);
      ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);
      ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);`,
);

await replaceOnce(
  'apps/desktop/electron/preload.ts',
  `import type { BroadcastSnapshot } from '@live-board/obs-protocol';`,
  `import type {
  BroadcastAssetRegistration,
  BroadcastSnapshotDescriptor,
} from '@live-board/obs-protocol';`,
);

await replaceOnce(
  'apps/desktop/electron/preload.ts',
  `  BROADCAST_PUBLISH_CHANNEL,
  OBS_COPY_SOURCE_URL_CHANNEL,`,
  `  BROADCAST_PUBLISH_CHANNEL,
  BROADCAST_REGISTER_ASSETS_CHANNEL,
  OBS_COPY_SOURCE_URL_CHANNEL,`,
);

await replaceOnce(
  'apps/desktop/electron/preload.ts',
  `  type PublishBroadcastSnapshotResponse,
  type RecoveryListResponse,`,
  `  type PublishBroadcastSnapshotResponse,
  type RegisterBroadcastAssetsResponse,
  type RecoveryListResponse,`,
);

await replaceOnce(
  'apps/desktop/electron/preload.ts',
  `  getSecurityStatus(requestId: string): Promise<SecurityStatus>;
  publishBroadcastSnapshot(
    requestId: string,
    snapshot: BroadcastSnapshot,
  ): Promise<PublishBroadcastSnapshotResponse>;`,
  `  getSecurityStatus(requestId: string): Promise<SecurityStatus>;
  registerBroadcastAssets(
    requestId: string,
    assets: BroadcastAssetRegistration[],
  ): Promise<RegisterBroadcastAssetsResponse>;
  publishBroadcastSnapshot(
    requestId: string,
    snapshot: BroadcastSnapshotDescriptor,
  ): Promise<PublishBroadcastSnapshotResponse>;`,
);

await replaceOnce(
  'apps/desktop/electron/preload.ts',
  `  getSecurityStatus: (requestId: string): Promise<SecurityStatus> =>
    ipcRenderer.invoke(SECURITY_STATUS_CHANNEL, { requestId }) as Promise<SecurityStatus>,
  publishBroadcastSnapshot: (
    requestId: string,
    snapshot: BroadcastSnapshot,
  ): Promise<PublishBroadcastSnapshotResponse> =>`,
  `  getSecurityStatus: (requestId: string): Promise<SecurityStatus> =>
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
  ): Promise<PublishBroadcastSnapshotResponse> =>`,
);

await replaceOnce(
  'apps/desktop/src/env.d.ts',
  `interface PublishBroadcastSnapshotResponse {
  requestId: string;
  acceptedRevision: number;
}`,
  `interface RegisterBroadcastAssetsResponse {
  requestId: string;
  registeredSha256: string[];
}

interface PublishBroadcastSnapshotResponse {
  requestId: string;
  acceptedRevision: number;
}`,
);

await replaceOnce(
  'apps/desktop/src/env.d.ts',
  `    getSecurityStatus: (requestId: string) => Promise<SecurityStatus>;
    publishBroadcastSnapshot: (
      requestId: string,
      snapshot: import('@live-board/obs-protocol').BroadcastSnapshot,
    ) => Promise<PublishBroadcastSnapshotResponse>;`,
  `    getSecurityStatus: (requestId: string) => Promise<SecurityStatus>;
    registerBroadcastAssets: (
      requestId: string,
      assets: import('@live-board/obs-protocol').BroadcastAssetRegistration[],
    ) => Promise<RegisterBroadcastAssetsResponse>;
    publishBroadcastSnapshot: (
      requestId: string,
      snapshot: import('@live-board/obs-protocol').BroadcastSnapshotDescriptor,
    ) => Promise<PublishBroadcastSnapshotResponse>;`,
);

await replaceOnce(
  'apps/desktop/src/AppV2.tsx',
  `import { AssetPanel } from './AssetPanel';
import { BroadcastControlPanel } from './BroadcastControlPanel';`,
  `import { AssetPanel } from './AssetPanel';
import { publishBroadcastSnapshotWithAssets } from './broadcast-ipc';
import { BroadcastControlPanel } from './BroadcastControlPanel';`,
);

await replaceOnce(
  'apps/desktop/src/AppV2.tsx',
  `  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics | null>(null);
  const nextBroadcastRevisionRef = useRef(1);`,
  `  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics | null>(null);
  const nextBroadcastRevisionRef = useRef(1);
  const registeredBroadcastAssetHashesRef = useRef(new Set<string>());`,
);

await replaceOnce(
  'apps/desktop/src/AppV2.tsx',
  `    void liveBoardApi
      .publishBroadcastSnapshot(requestId, snapshot)
      .then((response) => {`,
  `    void publishBroadcastSnapshotWithAssets(
      liveBoardApi,
      requestId,
      snapshot,
      registeredBroadcastAssetHashesRef.current,
    ).then((response) => {`,
);

for (const removable of [
  'scripts/apply-ipc-asset-registration.mjs',
  '.github/workflows/apply-ipc-asset-registration.yml',
]) {
  await unlink(removable).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
