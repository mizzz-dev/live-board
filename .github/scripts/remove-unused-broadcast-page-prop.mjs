import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/desktop/src/AppV2.tsx';
let source = await readFile(path, 'utf8');
source = replaceOnce(source, '          broadcastPage={broadcastPage}\n', '');
source = replaceOnce(source, '  broadcastPage: Page;\n', '');
source = replaceOnce(source, '  broadcastPage,\n', '');
await writeFile(path, source);

function replaceOnce(value, search, replacement) {
  const first = value.indexOf(search);
  if (first < 0) throw new Error(`Patch target not found: ${search}`);
  if (value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Patch target is ambiguous: ${search}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}
