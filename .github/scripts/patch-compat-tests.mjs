import { readFile, writeFile } from 'node:fs/promises';

await patchPersistence();
await patchBroadcastTest();

async function patchPersistence() {
  const path = 'packages/persistence/src/archive.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `  for (const project of workspace.projects) {\n    project.broadcastSettings = getBroadcastOverlaySettings(project);\n  }\n`,
    `  for (const project of workspace.projects) {\n    if (project.broadcastSettings !== undefined) {\n      project.broadcastSettings = getBroadcastOverlaySettings(project);\n    }\n  }\n`,
  );
  await writeFile(path, source);
}

async function patchBroadcastTest() {
  const path = 'packages/domain/test/broadcast.test.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `      layers: [],\n`,
    `      overlay: {\n        preset: 'simple',\n        theme: 'transparent',\n        transition: { type: 'fade', durationMs: 120 },\n        performanceMode: 'balanced',\n        customCss: '',\n        customCssEnabled: false,\n        customCssFallback: false,\n      },\n      layers: [],\n`,
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
