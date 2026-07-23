import { readFile, writeFile, unlink } from 'node:fs/promises';

const path = 'packages/obs-bridge/test/obs-bridge.test.ts';
const current = await readFile(path, 'utf8');
const before = `    const pathParts = deliveredAsset.url.split('/');
    pathParts[2] = pathParts[2].startsWith('0')
      ? \`1\${pathParts[2].slice(1)}\`
      : \`0\${pathParts[2].slice(1)}\`;
    expect((await fetch(\`\${origin}\${pathParts.join('/')}\`)).status).toBe(401);
    expect((await fetch(
      \`\${origin}/asset/\${pathParts[2]}/\${'0'.repeat(64)}\`,
    )).status).toBe(404);`;
const after = `    const pathParts = deliveredAsset.url.split('/');
    const validToken = pathParts[2]!;
    pathParts[2] = validToken.startsWith('0')
      ? \`1\${validToken.slice(1)}\`
      : \`0\${validToken.slice(1)}\`;
    expect((await fetch(\`\${origin}\${pathParts.join('/')}\`)).status).toBe(401);
    expect((await fetch(
      \`\${origin}/asset/\${validToken}/\${'0'.repeat(64)}\`,
    )).status).toBe(404);`;

if (!current.includes(before)) {
  throw new Error('Asset HTTPテストの修正対象が見つかりません');
}
await writeFile(path, current.replace(before, after));

for (const removable of [
  'scripts/fix-asset-http-test-token.mjs',
  '.github/workflows/ivr-247-fix-test.yml',
  '.github/ivr-247-fix-test.trigger',
  '.github/workflows/ivr-247-type-diagnostics.yml',
]) {
  await unlink(removable).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
