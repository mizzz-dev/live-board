import { readFile, writeFile } from 'node:fs/promises';

const path = 'packages/obs-bridge/test/obs-bridge.test.ts';
let source = await readFile(path, 'utf8');
const search = `  },\n  layers: [],\n};\n`;
const replacement = `  },\n  overlay: {\n    preset: 'simple',\n    theme: 'transparent',\n    transition: { type: 'fade', durationMs: 120 },\n    performanceMode: 'balanced',\n    customCss: '',\n    customCssEnabled: false,\n    customCssFallback: false,\n  },\n  layers: [],\n};\n`;
const first = source.indexOf(search);
if (first < 0) throw new Error('OBS Bridge fixture target not found');
if (source.indexOf(search, first + search.length) >= 0) {
  throw new Error('OBS Bridge fixture target is ambiguous');
}
source = source.slice(0, first) + replacement + source.slice(first + search.length);
await writeFile(path, source);
