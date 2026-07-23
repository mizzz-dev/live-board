import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/desktop/src/AppV2.tsx';
let source = await readFile(path, 'utf8');

source = replaceOnce(
  source,
  '  createSelectBroadcastPageCommand,\n',
  '',
);
source = replaceOnce(
  source,
  "import { AssetPanel } from './AssetPanel';\n",
  "import { AssetPanel } from './AssetPanel';\nimport { BroadcastControlPanel } from './BroadcastControlPanel';\n",
);
source = replaceOnce(
  source,
  "import { LayerPanel } from './LayerPanel';\n",
  "import { LayerPanel } from './LayerPanel';\nimport { PageThumbnail } from './PageThumbnail';\n",
);
source = replaceOnce(
  source,
  "import { useWorkspacePersistence } from './useWorkspacePersistence';\n",
  "import { useBroadcastControls } from './useBroadcastControls';\nimport { useWorkspacePersistence } from './useWorkspacePersistence';\n",
);
source = replaceOnce(
  source,
  `  const project =\n    workspace.projects.find((candidate) => candidate.id === workspace.activeProjectId) ??\n    workspace.projects[0]!;\n`,
  `  const project =\n    workspace.projects.find((candidate) => candidate.id === workspace.activeProjectId) ??\n    workspace.projects[0]!;\n  const broadcastControls = useBroadcastControls({\n    commandState,\n    setCommandState,\n    projectId: project.id,\n  });\n`,
);
source = replaceOnce(
  source,
  `  const broadcastLayerSignature = JSON.stringify(getLayerDocument(broadcastPage));\n`,
  `  const broadcastLayerSignature = JSON.stringify(getLayerDocument(broadcastPage));\n  const broadcastSettingsSignature = JSON.stringify(broadcastControls.settings);\n`,
);
source = replaceOnce(
  source,
  `    broadcastLayerSignature,\n    assetSignature,\n`,
  `    broadcastLayerSignature,\n    broadcastSettingsSignature,\n    assetSignature,\n`,
);
source = replaceOnce(
  source,
  `          <button\n            type="button"\n            disabled={editPage.id === broadcastPage.id}\n            onClick={() =>\n              executeCommand(\n                createSelectBroadcastPageCommand(\n                  project.id,\n                  editPage.id,\n                  createCommandMetadata('page-broadcast'),\n                ),\n              )\n            }\n          >\n            配信ページに設定\n          </button>\n`,
  `          <button\n            type="button"\n            disabled={broadcastControls.locked || editPage.id === broadcastPage.id}\n            onClick={() => broadcastControls.selectPage(editPage.id)}\n          >\n            {broadcastControls.locked ? '配信ページ固定中' : '配信ページに設定'}\n          </button>\n`,
);
source = replaceOnce(
  source,
  `          clearError={() => setDomainError(null)}\n        />\n`,
  `          clearError={() => setDomainError(null)}\n          assetLibrary={assetLibrary}\n        />\n`,
);
source = replaceOnce(
  source,
  `        <WorkspacePersistencePanel controller={persistence} />\n`,
  `        <BroadcastControlPanel controller={broadcastControls} />\n\n        <WorkspacePersistencePanel controller={persistence} />\n`,
);
source = replaceOnce(
  source,
  `  clearError(): void;\n}\n`,
  `  clearError(): void;\n  assetLibrary: ProjectAssetLibrary;\n}\n`,
);
source = replaceOnce(
  source,
  `  setState,\n  clearError,\n}: PagePanelProps) {\n`,
  `  setState,\n  clearError,\n  assetLibrary,\n}: PagePanelProps) {\n`,
);
source = replaceOnce(
  source,
  `              <span className="page-thumbnail" aria-hidden="true" />\n`,
  `              <PageThumbnail\n                page={page}\n                projectId={project.id}\n                assetLibrary={assetLibrary}\n              />\n`,
);

await writeFile(path, source);

function replaceOnce(value, search, replacement) {
  const first = value.indexOf(search);
  if (first < 0) {
    if (value.includes(replacement)) return value;
    throw new Error(`AppV2 patch target not found: ${search.slice(0, 100)}`);
  }
  if (value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`AppV2 patch target is ambiguous: ${search.slice(0, 100)}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}
