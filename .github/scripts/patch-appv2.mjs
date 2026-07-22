import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/desktop/src/AppV2.tsx';
let source = await readFile(path, 'utf8');

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
  '          <span>{broadcastSyncLabel}</span>\n',
  '          <span>{broadcastSyncLabel}</span>\n          <span>{persistence.status}</span>\n',
);

source = replaceOnce(
  source,
  `        <AssetPanel\n          library={assetLibrary}\n          onImport={importAssets}\n          error={assetError}\n        />\n\n        <p className="domain-message" role="status" aria-live="polite">\n`,
  `        <AssetPanel\n          library={assetLibrary}\n          onImport={importAssets}\n          error={assetError}\n        />\n\n        <WorkspacePersistencePanel controller={persistence} />\n\n        <p className="domain-message" role="status" aria-live="polite">\n`,
);

await writeFile(path, source);

function replaceOnce(value, search, replacement) {
  const first = value.indexOf(search);
  if (first < 0) {
    if (value.includes(replacement)) return value;
    throw new Error(`AppV2 patch target not found: ${search.slice(0, 80)}`);
  }
  if (value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`AppV2 patch target is ambiguous: ${search.slice(0, 80)}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}
