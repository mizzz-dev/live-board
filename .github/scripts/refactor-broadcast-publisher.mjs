import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/desktop/electron/main.ts';
let content = await readFile(path, 'utf8');

function replaceExact(before, after) {
  if (!content.includes(before)) {
    throw new Error(`置換対象が見つかりません: ${before.slice(0, 80)}`);
  }
  content = content.replace(before, after);
}

replaceExact(
  `import { startObsBridge, type ObsBridge } from '@live-board/obs-bridge';\nimport {\n  applyBroadcastLayerPatchDescriptor,\n  type BroadcastSnapshotDescriptor,\n} from '@live-board/obs-protocol';`,
  `import { startObsBridge, type ObsBridge } from '@live-board/obs-bridge';`,
);
replaceExact(
  `import {\n  registerPersistenceIpcHandlers,`,
  `import { BroadcastDescriptorPublisher } from './broadcast-publisher.js';\nimport {\n  registerPersistenceIpcHandlers,`,
);
replaceExact(
  `  let latestBroadcastSnapshotDescriptor: BroadcastSnapshotDescriptor | undefined;`,
  `  const publisher = new BroadcastDescriptorPublisher(bridge);`,
);
replaceExact(
  `    const acceptedRevision = bridge.publishSnapshotDescriptor(request.snapshot);\n    latestBroadcastSnapshotDescriptor = request.snapshot;`,
  `    const acceptedRevision = publisher.publishSnapshot(request.snapshot);`,
);
replaceExact(
  `      if (latestBroadcastSnapshotDescriptor === undefined) {\n        throw new Error('IPC_BROADCAST_SNAPSHOT_REQUIRED');\n      }\n      const nextSnapshot = applyBroadcastLayerPatchDescriptor(\n        latestBroadcastSnapshotDescriptor,\n        request.patch,\n      );\n      const acceptedRevision = bridge.publishSnapshotDescriptor(nextSnapshot);\n      latestBroadcastSnapshotDescriptor = nextSnapshot;`,
  `      const acceptedRevision = publisher.publishLayerPatch(request.patch);`,
);

await writeFile(path, content);
