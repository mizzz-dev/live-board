import { readFile, writeFile, unlink } from 'node:fs/promises';

const path = 'packages/obs-bridge/test/obs-bridge.test.ts';
const current = await readFile(path, 'utf8');
const startMarker = "  it('画像data URLをWebSocketへ送らず、認証付きhash URLから配信する', async () => {";
const suffixMarker = "  it('不正tokenと外部OriginをUpgrade前に拒否する', async () => {";
const start = current.indexOf(startMarker);
const suffix = current.lastIndexOf(suffixMarker);

if (start < 0 || suffix < 0 || suffix <= start) {
  throw new Error('OBS Bridgeテストの修復境界を特定できません');
}

const cleanBlock = [
  "  it('画像data URLをWebSocketへ送らず、認証付きhash URLから配信する', async () => {",
  '    activeBridge = await startObsBridge({ initialSnapshot: httpAssetSnapshot });',
  '    const origin = new URL(activeBridge.info.overlayUrl).origin;',
  '    const webSocket = new WebSocket(activeBridge.info.webSocketUrl, { origin });',
  "    const messagePromise = once(webSocket, 'message');",
  "    await once(webSocket, 'open');",
  '    const [rawMessage] = await messagePromise;',
  '    const message = JSON.parse(rawMessage.toString());',
  '',
  "    expect(JSON.stringify(message)).not.toContain('data:image');",
  '    expect(message.snapshot.assets).toHaveLength(1);',
  '    const deliveredAsset = message.snapshot.assets[0];',
  '    expect(deliveredAsset).toMatchObject({',
  '      sha256: httpAssetHash,',
  "      delivery: 'http',",
  '    });',
  "    expect(deliveredAsset.url.startsWith('/asset/')).toBe(true);",
  '    expect(deliveredAsset.url.endsWith(`/${httpAssetHash}`)).toBe(true);',
  "    expect(deliveredAsset.url.split('/')[2]).toMatch(/^[0-9a-f]{64}$/);",
  '',
  '    const response = await fetch(`${origin}${deliveredAsset.url}`);',
  '    expect(response.status).toBe(200);',
  "    expect(response.headers.get('content-type')).toBe('image/png');",
  "    expect(response.headers.get('cache-control')).toContain('immutable');",
  "    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');",
  "    const etag = response.headers.get('etag');",
  '    expect(etag).toBe(`"${httpAssetHash}"`);',
  '    expect(Buffer.from(await response.arrayBuffer())).toEqual(httpAssetBytes);',
  '',
  '    const cached = await fetch(`${origin}${deliveredAsset.url}`, {',
  "      headers: { 'If-None-Match': etag! },",
  '    });',
  '    expect(cached.status).toBe(304);',
  '    const head = await fetch(`${origin}${deliveredAsset.url}`, { method: \'HEAD\' });',
  '    expect(head.status).toBe(200);',
  "    expect(await head.text()).toBe('');",
  '',
  "    const pathParts = deliveredAsset.url.split('/');",
  "    pathParts[2] = pathParts[2].startsWith('0')",
  "      ? `1${pathParts[2].slice(1)}`",
  "      : `0${pathParts[2].slice(1)}`;",
  "    expect((await fetch(`${origin}${pathParts.join('/')}`)).status).toBe(401);",
  '    expect((await fetch(',
  "      `${origin}/asset/${pathParts[2]}/${'0'.repeat(64)}`,",
  '    )).status).toBe(404);',
  '    expect(activeBridge.getAssetStats()).toMatchObject({',
  '      count: 1,',
  '      totalBytes: httpAssetBytes.length,',
  '    });',
  '',
  '    webSocket.close();',
  "    await once(webSocket, 'close');",
  '  });',
  '',
].join('\n');

const repaired = current.slice(0, start) + cleanBlock + current.slice(suffix);
if ((repaired.match(/import \{ createHash \}/g) ?? []).length !== 1) {
  throw new Error('createHash importの重複を解消できません');
}
if ((repaired.match(/describe\('OBS bridge'/g) ?? []).length !== 1) {
  throw new Error('OBS bridge describeの重複を解消できません');
}
if ((repaired.match(/画像data URLをWebSocketへ送らず/g) ?? []).length !== 1) {
  throw new Error('HTTP Assetテストの重複を解消できません');
}

await writeFile(path, repaired);
for (const removable of [
  'scripts/repair-obs-bridge-test.mjs',
  '.github/workflows/ivr-247-repair.yml',
  '.github/ivr-247-repair.trigger',
  '.github/workflows/ivr-247-lint-diagnostics.yml',
]) {
  await unlink(removable).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
