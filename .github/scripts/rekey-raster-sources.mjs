import { readFile, writeFile } from 'node:fs/promises';

const path = 'packages/persistence/src/archive.ts';
let source = await readFile(path, 'utf8');
const search = '        sourceLayerIds: layer.content.sourceLayerIds.map((sourceId) => idMap.get(sourceId) ?? sourceId),\n';
const replacement = `        sourceLayerIds: layer.content.sourceLayerIds.map(\n          (sourceId) =>\n            idMap.get(sourceId) ??\n            \`\${pageId}:source:\${sha256Hex(encodeUtf8(sourceId)).slice(0, 16)}\`,\n        ),\n`;
const count = source.split(search).length - 1;
if (count !== 1) throw new Error(`Expected one Raster sourceLayerIds target, got ${count}`);
source = source.replace(search, replacement);
await writeFile(path, source);
