import { readFile, writeFile } from 'node:fs/promises';

await patchFile('apps/desktop/src/AppV2.tsx', (source) => {
  source = replaceOnce(
    source,
    "import { RichLayerInspector } from './RichLayerInspector';\n",
    "import { RichLayerInspector } from './RichLayerInspector';\nimport { WorkspacePersistencePanel } from './WorkspacePersistencePanel';\nimport { useWorkspacePersistence } from './useWorkspacePersistence';\n",
  );
  source = replaceOnce(
    source,
    '  const nextBroadcastRevisionRef = useRef(1);\n',
    `  const nextBroadcastRevisionRef = useRef(1);\n  const persistence = useWorkspacePersistence({\n    commandState,\n    assetLibraries,\n    setCommandState,\n    setAssetLibraries,\n  });\n`,
  );
  source = replaceOnce(
    source,
    `        <AssetPanel\n          library={assetLibrary}\n          onImport={importAssets}\n          error={assetError}\n        />\n\n        <p className="domain-message" role="status" aria-live="polite">\n`,
    `        <AssetPanel\n          library={assetLibrary}\n          onImport={importAssets}\n          error={assetError}\n        />\n\n        <WorkspacePersistencePanel controller={persistence} />\n\n        <p className="domain-message" role="status" aria-live="polite">\n`,
  );
  return source;
});

await patchFile('apps/desktop/electron/persistence-service.ts', (source) => {
  source = replaceOnce(
    source,
    `async function atomicWriteFile(path: string, bytes: Uint8Array): Promise<void> {\n  await mkdir(dirname(path), { recursive: true });\n  const temporaryPath = \`\${path}.\${randomUUID()}.tmp\`;\n`,
    `async function atomicWriteFile(path: string, bytes: Uint8Array): Promise<void> {\n  await mkdir(dirname(path), { recursive: true });\n  await recoverAtomicTarget(path);\n  const temporaryPath = \`\${path}.\${randomUUID()}.tmp\`;\n`,
  );
  source = replaceOnce(
    source,
    '    await handle.writeFile(bytes);\n',
    '    await writeFile(handle, bytes);\n',
  );
  source = replaceOnce(
    source,
    '  try {\n    await recoverAtomicTarget(path);\n    try {\n      await rename(path, backupPath);\n',
    '  try {\n    try {\n      await rename(path, backupPath);\n',
  );
  return source;
});

await patchFile('packages/persistence/src/archive.ts', (source) => {
  return replaceOnce(
    source,
    `      return {\n        ...asset,\n        dataUrl: \`data:\${asset.mime};base64,\${bytesToBase64(bytes)}\`,\n        fileNames: [...asset.fileNames],\n      } satisfies ProjectAsset;\n`,
    `      const { archivePath: _archivePath, ...metadata } = asset;\n      return {\n        ...metadata,\n        dataUrl: \`data:\${asset.mime};base64,\${bytesToBase64(bytes)}\`,\n        fileNames: [...asset.fileNames],\n      } satisfies ProjectAsset;\n`,
  );
});

async function patchFile(path, transform) {
  const source = await readFile(path, 'utf8');
  await writeFile(path, transform(source));
}

function replaceOnce(value, search, replacement) {
  const first = value.indexOf(search);
  if (first < 0) {
    if (value.includes(replacement)) return value;
    throw new Error(`Patch target not found: ${search.slice(0, 80)}`);
  }
  if (value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Patch target is ambiguous: ${search.slice(0, 80)}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}
