import { readFile, writeFile } from 'node:fs/promises';

await patchProtocolSettings();
await patchPersistence();

async function patchProtocolSettings() {
  const path = 'packages/obs-protocol/src/overlay-settings.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `  { pattern: /@namespace\\b/i, reason: '@namespaceは利用できません' },\n`,
    `  { pattern: /@namespace\\b/i, reason: '@namespaceは利用できません' },\n  { pattern: /<\\/?style\\b/i, reason: 'styleタグ断片は利用できません' },\n`,
  );
  await writeFile(path, source);
}

async function patchPersistence() {
  const path = 'packages/persistence/src/archive.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `  getLayerDocument,\n`,
    `  getBroadcastOverlaySettings,\n  getLayerDocument,\n`,
  );
  source = replaceOnce(
    source,
    `  const workspace = cloneJson(options.workspace);\n  validateWorkspace(workspace);\n`,
    `  const workspace = cloneJson(options.workspace);\n  normalizeBroadcastSettings(workspace);\n  validateWorkspace(workspace);\n`,
  );
  source = replaceOnce(
    source,
    `  const manifest = parseManifestV1(migration.manifest);\n  const assetLibraries = restoreAssetLibraries(manifest, entries);\n`,
    `  const manifest = parseManifestV1(migration.manifest);\n  normalizeBroadcastSettings(manifest.workspace);\n  const assetLibraries = restoreAssetLibraries(manifest, entries);\n`,
  );
  source = replaceOnce(
    source,
    `function validateWorkspace(workspace: Workspace): void {\n`,
    `function normalizeBroadcastSettings(workspace: Workspace): void {\n  for (const project of workspace.projects) {\n    project.broadcastSettings = getBroadcastOverlaySettings(project);\n  }\n}\n\nfunction validateWorkspace(workspace: Workspace): void {\n`,
  );
  await writeFile(path, source);
}

function replaceOnce(value, search, replacement) {
  const first = value.indexOf(search);
  if (first < 0) {
    if (value.includes(replacement)) return value;
    throw new Error(`Patch target not found: ${search.slice(0, 100)}`);
  }
  if (value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Patch target is ambiguous: ${search.slice(0, 100)}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}
