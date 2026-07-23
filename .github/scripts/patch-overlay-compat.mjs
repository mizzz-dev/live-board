import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/overlay/src/App.tsx';
let source = await readFile(path, 'utf8');

source = replaceOnce(
  source,
  "  parseObsBridgeServerMessage,\n",
  "  DEFAULT_BROADCAST_OVERLAY_SETTINGS,\n  parseObsBridgeServerMessage,\n",
);
source = replaceOnce(
  source,
  "              ? incomingSnapshot.overlay.transition\n",
  "              ? (incomingSnapshot.overlay ?? DEFAULT_BROADCAST_OVERLAY_SETTINGS).transition\n",
);
source = replaceOnce(
  source,
  `  const pageBackground =\n`,
  `  const overlay = snapshot.overlay ?? DEFAULT_BROADCAST_OVERLAY_SETTINGS;\n  const pageBackground =\n`,
);
source = source.replaceAll('snapshot.overlay.', 'overlay.');

await writeFile(path, source);

function replaceOnce(value, search, replacement) {
  const first = value.indexOf(search);
  if (first < 0) {
    if (value.includes(replacement)) return value;
    throw new Error(`Overlay patch target not found: ${search.slice(0, 100)}`);
  }
  if (value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Overlay patch target is ambiguous: ${search.slice(0, 100)}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}
