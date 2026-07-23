import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/desktop/src/AppV2.tsx';
let source = await readFile(path, 'utf8');
const legacy = `      <button\n        type="button"\n        className="visually-hidden"\n        onClick={() =>\n          executeCommand(\n            createSelectBroadcastPageCommand(\n              project.id,\n              broadcastPage.id,\n              createCommandMetadata('broadcast-current'),\n            ),\n          )\n        }\n      >\n        現在の配信ページを維持\n      </button>\n`;
if (!source.includes(legacy)) {
  throw new Error('Legacy broadcast button was not found');
}
source = source.replace(legacy, '');
await writeFile(path, source);
