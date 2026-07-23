import { readFile, writeFile, unlink } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const content = await readFile(path, 'utf8');
  if (!content.includes(before)) {
    throw new Error(`更新対象が見つかりません: ${path}: ${before.slice(0, 100)}`);
  }
  await writeFile(path, content.replace(before, after));
}

await replaceOnce(
  'apps/desktop/src/AppV2.tsx',
  `    void publishBroadcastSnapshotWithAssets(
      liveBoardApi,
      requestId,
      snapshot,
      registeredBroadcastAssetHashesRef.current,
    ).then((response) => {
        if (active && response.requestId === requestId) {
          setBroadcastRevision(response.acceptedRevision);
          setBroadcastSyncError(false);
        }
      })
      .catch(() => {`,
  `    void publishBroadcastSnapshotWithAssets(
      liveBoardApi,
      requestId,
      snapshot,
      registeredBroadcastAssetHashesRef.current,
    )
      .then((response) => {
        if (active && response.requestId === requestId) {
          setBroadcastRevision(response.acceptedRevision);
          setBroadcastSyncError(false);
        }
      })
      .catch(() => {`,
);

await replaceOnce(
  'apps/desktop/electron/contracts.ts',
  `  const requestId = parseRequestId(input.requestId);
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
  return { requestId, assets };`,
  `  const requestId = parseRequestId(input.requestId);
  let inputBytes = 0;
  for (const inputAsset of input.assets) {
    if (!isRecord(inputAsset) || !(inputAsset.bytes instanceof Uint8Array)) {
      throw new Error('IPC_INVALID_BROADCAST_ASSETS');
    }
    inputBytes += inputAsset.bytes.byteLength;
    if (inputBytes > 256 * 1024 * 1024) {
      throw new Error('IPC_BROADCAST_ASSET_TOTAL_LIMIT');
    }
  }

  const assets = input.assets.map(parseBroadcastAssetRegistration);
  const hashes = new Set<string>();
  for (const asset of assets) {
    if (hashes.has(asset.sha256)) {
      throw new Error('IPC_DUPLICATE_BROADCAST_ASSET');
    }
    hashes.add(asset.sha256);
  }
  return { requestId, assets };`,
);

for (const removable of [
  'scripts/finalize-ipc-assets.mjs',
  '.github/workflows/finalize-ipc-assets.yml',
]) {
  await unlink(removable).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
