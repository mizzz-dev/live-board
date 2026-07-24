import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, before, after) {
  const current = await readFile(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`置換対象が見つかりません: ${path}`);
  }
  await writeFile(path, current.replace(before, after));
}

await replaceExact(
  'apps/desktop/electron/contracts.ts',
  `import {\n  parseBroadcastAssetRegistration,\n  parseBroadcastSnapshotDescriptor,\n  type BroadcastAssetRegistration,\n  type BroadcastSnapshotDescriptor,\n} from '@live-board/obs-protocol';`,
  `import {\n  parseBroadcastAssetRegistration,\n  parseBroadcastLayerPatchDescriptor,\n  parseBroadcastSnapshotDescriptor,\n  type BroadcastAssetRegistration,\n  type BroadcastLayerPatchDescriptor,\n  type BroadcastSnapshotDescriptor,\n} from '@live-board/obs-protocol';`,
);
await replaceExact(
  'apps/desktop/electron/contracts.ts',
  `export const BROADCAST_REGISTER_ASSETS_CHANNEL = 'broadcast:register-assets';\nexport const BROADCAST_PUBLISH_CHANNEL = 'broadcast:publish-snapshot';`,
  `export const BROADCAST_REGISTER_ASSETS_CHANNEL = 'broadcast:register-assets';\nexport const BROADCAST_PUBLISH_CHANNEL = 'broadcast:publish-snapshot';\nexport const BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL = 'broadcast:publish-layer-patch';`,
);
await replaceExact(
  'apps/desktop/electron/contracts.ts',
  `export interface PublishBroadcastSnapshotResponse {\n  requestId: string;\n  acceptedRevision: number;\n}\n`,
  `export interface PublishBroadcastSnapshotResponse {\n  requestId: string;\n  acceptedRevision: number;\n}\n\nexport interface PublishBroadcastLayerPatchRequest {\n  requestId: string;\n  patch: BroadcastLayerPatchDescriptor;\n}\n`,
);
await replaceExact(
  'apps/desktop/electron/contracts.ts',
  `export function parsePublishBroadcastSnapshotRequest(\n  input: unknown,\n): PublishBroadcastSnapshotRequest {\n  if (!isRecord(input)) {\n    throw new Error('IPC_INVALID_REQUEST');\n  }\n  return {\n    requestId: parseRequestId(input.requestId),\n    snapshot: parseBroadcastSnapshotDescriptor(input.snapshot),\n  };\n}\n`,
  `export function parsePublishBroadcastSnapshotRequest(\n  input: unknown,\n): PublishBroadcastSnapshotRequest {\n  if (!isRecord(input)) {\n    throw new Error('IPC_INVALID_REQUEST');\n  }\n  return {\n    requestId: parseRequestId(input.requestId),\n    snapshot: parseBroadcastSnapshotDescriptor(input.snapshot),\n  };\n}\n\nexport function parsePublishBroadcastLayerPatchRequest(\n  input: unknown,\n): PublishBroadcastLayerPatchRequest {\n  if (!isRecord(input)) {\n    throw new Error('IPC_INVALID_REQUEST');\n  }\n  return {\n    requestId: parseRequestId(input.requestId),\n    patch: parseBroadcastLayerPatchDescriptor(input.patch),\n  };\n}\n`,
);

await replaceExact(
  'apps/desktop/electron/main.ts',
  `import { startObsBridge, type ObsBridge } from '@live-board/obs-bridge';`,
  `import { startObsBridge, type ObsBridge } from '@live-board/obs-bridge';\nimport {\n  applyBroadcastLayerPatchDescriptor,\n  type BroadcastSnapshotDescriptor,\n} from '@live-board/obs-protocol';`,
);
await replaceExact(
  'apps/desktop/electron/main.ts',
  `  BROADCAST_PUBLISH_CHANNEL,\n  BROADCAST_REGISTER_ASSETS_CHANNEL,`,
  `  BROADCAST_PUBLISH_CHANNEL,\n  BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL,\n  BROADCAST_REGISTER_ASSETS_CHANNEL,`,
);
await replaceExact(
  'apps/desktop/electron/main.ts',
  `  parsePublishBroadcastSnapshotRequest,\n  parseRegisterBroadcastAssetsRequest,`,
  `  parsePublishBroadcastLayerPatchRequest,\n  parsePublishBroadcastSnapshotRequest,\n  parseRegisterBroadcastAssetsRequest,`,
);
await replaceExact(
  'apps/desktop/electron/main.ts',
  `): void {\n  ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);`,
  `): void {\n  let latestBroadcastSnapshotDescriptor: BroadcastSnapshotDescriptor | undefined;\n\n  ipcMain.removeHandler(SECURITY_STATUS_CHANNEL);`,
);
await replaceExact(
  'apps/desktop/electron/main.ts',
  `  ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);\n  ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);`,
  `  ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);\n  ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);\n  ipcMain.removeHandler(BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL);`,
);
await replaceExact(
  'apps/desktop/electron/main.ts',
  `  ipcMain.handle(BROADCAST_PUBLISH_CHANNEL, (event, input: unknown) => {\n    assertTrustedEvent(event, trustConfig);\n    const request = parsePublishBroadcastSnapshotRequest(input);\n    const response: PublishBroadcastSnapshotResponse = {\n      requestId: request.requestId,\n      acceptedRevision: bridge.publishSnapshotDescriptor(request.snapshot),\n    };\n\n    return response;\n  });`,
  `  ipcMain.handle(BROADCAST_PUBLISH_CHANNEL, (event, input: unknown) => {\n    assertTrustedEvent(event, trustConfig);\n    const request = parsePublishBroadcastSnapshotRequest(input);\n    const acceptedRevision = bridge.publishSnapshotDescriptor(request.snapshot);\n    latestBroadcastSnapshotDescriptor = request.snapshot;\n    const response: PublishBroadcastSnapshotResponse = {\n      requestId: request.requestId,\n      acceptedRevision,\n    };\n\n    return response;\n  });\n\n  ipcMain.handle(\n    BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL,\n    (event, input: unknown) => {\n      assertTrustedEvent(event, trustConfig);\n      const request = parsePublishBroadcastLayerPatchRequest(input);\n      if (latestBroadcastSnapshotDescriptor === undefined) {\n        throw new Error('IPC_BROADCAST_SNAPSHOT_REQUIRED');\n      }\n      const nextSnapshot = applyBroadcastLayerPatchDescriptor(\n        latestBroadcastSnapshotDescriptor,\n        request.patch,\n      );\n      const acceptedRevision = bridge.publishSnapshotDescriptor(nextSnapshot);\n      latestBroadcastSnapshotDescriptor = nextSnapshot;\n      const response: PublishBroadcastSnapshotResponse = {\n        requestId: request.requestId,\n        acceptedRevision,\n      };\n      return response;\n    },\n  );`,
);
await replaceExact(
  'apps/desktop/electron/main.ts',
  `      ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);\n      ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);`,
  `      ipcMain.removeHandler(BROADCAST_REGISTER_ASSETS_CHANNEL);\n      ipcMain.removeHandler(BROADCAST_PUBLISH_CHANNEL);\n      ipcMain.removeHandler(BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL);`,
);

await replaceExact(
  'apps/desktop/electron/preload.ts',
  `  BroadcastAssetRegistration,\n  BroadcastSnapshotDescriptor,`,
  `  BroadcastAssetRegistration,\n  BroadcastLayerPatchDescriptor,\n  BroadcastSnapshotDescriptor,`,
);
await replaceExact(
  'apps/desktop/electron/preload.ts',
  `  BROADCAST_PUBLISH_CHANNEL,\n  BROADCAST_REGISTER_ASSETS_CHANNEL,`,
  `  BROADCAST_PUBLISH_CHANNEL,\n  BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL,\n  BROADCAST_REGISTER_ASSETS_CHANNEL,`,
);
await replaceExact(
  'apps/desktop/electron/preload.ts',
  `  publishBroadcastSnapshot(\n    requestId: string,\n    snapshot: BroadcastSnapshotDescriptor,\n  ): Promise<PublishBroadcastSnapshotResponse>;`,
  `  publishBroadcastSnapshot(\n    requestId: string,\n    snapshot: BroadcastSnapshotDescriptor,\n  ): Promise<PublishBroadcastSnapshotResponse>;\n  publishBroadcastLayerPatch(\n    requestId: string,\n    patch: BroadcastLayerPatchDescriptor,\n  ): Promise<PublishBroadcastSnapshotResponse>;`,
);
await replaceExact(
  'apps/desktop/electron/preload.ts',
  `  publishBroadcastSnapshot: (\n    requestId: string,\n    snapshot: BroadcastSnapshotDescriptor,\n  ): Promise<PublishBroadcastSnapshotResponse> =>\n    ipcRenderer.invoke(BROADCAST_PUBLISH_CHANNEL, {\n      requestId,\n      snapshot,\n    }) as Promise<PublishBroadcastSnapshotResponse>,`,
  `  publishBroadcastSnapshot: (\n    requestId: string,\n    snapshot: BroadcastSnapshotDescriptor,\n  ): Promise<PublishBroadcastSnapshotResponse> =>\n    ipcRenderer.invoke(BROADCAST_PUBLISH_CHANNEL, {\n      requestId,\n      snapshot,\n    }) as Promise<PublishBroadcastSnapshotResponse>,\n  publishBroadcastLayerPatch: (\n    requestId: string,\n    patch: BroadcastLayerPatchDescriptor,\n  ): Promise<PublishBroadcastSnapshotResponse> =>\n    ipcRenderer.invoke(BROADCAST_PUBLISH_LAYER_PATCH_CHANNEL, {\n      requestId,\n      patch,\n    }) as Promise<PublishBroadcastSnapshotResponse>,`,
);

await replaceExact(
  'apps/desktop/src/env.d.ts',
  `    publishBroadcastSnapshot: (\n      requestId: string,\n      snapshot: import('@live-board/obs-protocol').BroadcastSnapshotDescriptor,\n    ) => Promise<PublishBroadcastSnapshotResponse>;`,
  `    publishBroadcastSnapshot: (\n      requestId: string,\n      snapshot: import('@live-board/obs-protocol').BroadcastSnapshotDescriptor,\n    ) => Promise<PublishBroadcastSnapshotResponse>;\n    publishBroadcastLayerPatch: (\n      requestId: string,\n      patch: import('@live-board/obs-protocol').BroadcastLayerPatchDescriptor,\n    ) => Promise<PublishBroadcastSnapshotResponse>;`,
);
