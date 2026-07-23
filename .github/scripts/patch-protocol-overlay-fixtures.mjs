import { readFile, writeFile } from 'node:fs/promises';

const overlay = `  overlay: {\n    preset: 'simple',\n    theme: 'transparent',\n    transition: { type: 'fade', durationMs: 120 },\n    performanceMode: 'balanced',\n    customCss: '',\n    customCssEnabled: false,\n    customCssFallback: false,\n  },\n`;

await patch('packages/obs-protocol/test/protocol.test.ts', '  },\n  layers: [\n', `  },\n${overlay}  layers: [\n`);
await patch('packages/obs-protocol/test/protocol-v4.test.ts', '  },\n  assets: [asset],\n', `  },\n${overlay}  assets: [asset],\n`);

async function patch(path, search, replacement) {
  let source = await readFile(path, 'utf8');
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Fixture target not found: ${path}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Fixture target is ambiguous: ${path}`);
  }
  source = source.slice(0, first) + replacement + source.slice(first + search.length);
  await writeFile(path, source);
}
