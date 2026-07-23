import { readFile, writeFile, unlink } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const current = await readFile(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`${path}: replacement target not found`);
  }
  const next = current.replace(before, after);
  if (next === current) throw new Error(`${path}: replacement did not change file`);
  await writeFile(path, next);
}

async function appendBefore(path, marker, addition) {
  const current = await readFile(path, 'utf8');
  if (!current.includes(marker)) throw new Error(`${path}: append marker not found`);
  if (current.includes(addition.trim())) return;
  await writeFile(path, current.replace(marker, `${addition}${marker}`));
}

const protocolPath = 'packages/obs-protocol/src/protocol-v4.ts';
await replaceOnce(
  protocolPath,
`export interface BroadcastAsset {
  id: string;
  sha256: string;
  mime: BroadcastAssetMime;
  width: number;
  height: number;
  byteLength: number;
  dataUrl: string;
  animated: false;
  sanitized: boolean;
}`,
`interface BroadcastAssetBase {
  id: string;
  sha256: string;
  mime: BroadcastAssetMime;
  width: number;
  height: number;
  byteLength: number;
  animated: false;
  sanitized: boolean;
}

export interface InlineBroadcastAsset extends BroadcastAssetBase {
  delivery?: 'inline';
  dataUrl: string;
  url?: never;
}

export interface HttpBroadcastAsset extends BroadcastAssetBase {
  delivery: 'http';
  url: string;
  dataUrl?: never;
}

export type BroadcastAsset = InlineBroadcastAsset | HttpBroadcastAsset;`,
);

await replaceOnce(
  protocolPath,
`export function parseBroadcastAsset(input: unknown): BroadcastAsset {
  if (!isRecord(input)) throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  if (
    !isEntityId(input.id) ||
    typeof input.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(input.sha256) ||
    !isAssetMime(input.mime) ||
    !isDimension(input.width) ||
    !isDimension(input.height) ||
    input.width * input.height > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > 25 * 1024 * 1024 ||
    typeof input.dataUrl !== 'string' ||
    input.dataUrl.length > 36 * 1024 * 1024 ||
    !input.dataUrl.startsWith(\`data:\${input.mime};base64,\`) ||
    input.animated !== false ||
    typeof input.sanitized !== 'boolean' ||
    (input.mime === 'image/svg+xml' && !input.sanitized)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }
  return {
    id: input.id,
    sha256: input.sha256.toLowerCase(),
    mime: input.mime,
    width: input.width,
    height: input.height,
    byteLength: input.byteLength,
    dataUrl: input.dataUrl,
    animated: false,
    sanitized: input.sanitized,
  };
}`,
`export function parseBroadcastAsset(input: unknown): BroadcastAsset {
  if (!isRecord(input)) throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  if (
    !isEntityId(input.id) ||
    typeof input.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(input.sha256) ||
    !isAssetMime(input.mime) ||
    !isDimension(input.width) ||
    !isDimension(input.height) ||
    input.width * input.height > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > 25 * 1024 * 1024 ||
    input.animated !== false ||
    typeof input.sanitized !== 'boolean' ||
    (input.mime === 'image/svg+xml' && !input.sanitized)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }

  const base = {
    id: input.id,
    sha256: input.sha256.toLowerCase(),
    mime: input.mime,
    width: input.width,
    height: input.height,
    byteLength: input.byteLength,
    animated: false as const,
    sanitized: input.sanitized,
  };

  if (input.delivery === 'http') {
    if (
      typeof input.url !== 'string' ||
      input.dataUrl !== undefined ||
      !isHttpAssetUrl(input.url, base.sha256)
    ) {
      throw new Error('OBS_PROTOCOL_INVALID_ASSET');
    }
    return { ...base, delivery: 'http', url: input.url };
  }

  if (
    input.delivery !== undefined &&
    input.delivery !== 'inline'
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }
  if (
    typeof input.dataUrl !== 'string' ||
    input.url !== undefined ||
    input.dataUrl.length > 36 * 1024 * 1024 ||
    !input.dataUrl.startsWith(\`data:\${input.mime};base64,\`)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET');
  }
  return { ...base, dataUrl: input.dataUrl };
}

export function isInlineBroadcastAsset(
  asset: BroadcastAsset,
): asset is InlineBroadcastAsset {
  return asset.delivery !== 'http';
}

export function getBroadcastAssetSource(asset: BroadcastAsset): string {
  return isInlineBroadcastAsset(asset) ? asset.dataUrl : asset.url;
}

function isHttpAssetUrl(value: string, sha256: string): boolean {
  const match = /^\\/asset\\/([0-9a-f]{64})\\/([0-9a-f]{64})$/.exec(value);
  return match !== null && match[2] === sha256;
}`,
);

const rendererPath = 'packages/canvas-engine/src/rich-renderer.ts';
await replaceOnce(
  rendererPath,
`import type {
  BroadcastAsset,
  BroadcastImageLayer,
  BroadcastLayer,
  BroadcastShapeLayer,
  BroadcastSnapshot,
  BroadcastTextLayer,
} from '@live-board/obs-protocol';`,
`import {
  getBroadcastAssetSource,
  type BroadcastAsset,
  type BroadcastImageLayer,
  type BroadcastLayer,
  type BroadcastShapeLayer,
  type BroadcastSnapshot,
  type BroadcastTextLayer,
} from '@live-board/obs-protocol';`,
);
await replaceOnce(rendererPath, '      image.src = asset.dataUrl;', '      image.src = getBroadcastAssetSource(asset);');

await writeFile(
  'packages/obs-bridge/src/asset-registry.ts',
`import {
  isInlineBroadcastAsset,
  type BroadcastAssetMime,
  type BroadcastSnapshot,
  type HttpBroadcastAsset,
  type InlineBroadcastAsset,
} from '@live-board/obs-protocol';
import { createHash } from 'node:crypto';

export const DEFAULT_ASSET_RETENTION_MS = 60_000;
export const DEFAULT_MAX_ASSET_BYTES = 256 * 1024 * 1024;

export interface StoredBroadcastAsset {
  sha256: string;
  mime: BroadcastAssetMime;
  byteLength: number;
  bytes: Buffer;
  sanitized: boolean;
  lastReferencedAt: number;
}

export interface BroadcastAssetRegistryStats {
  count: number;
  totalBytes: number;
  maxBytes: number;
  retentionMs: number;
}

export interface BroadcastAssetRegistryOptions {
  maxBytes?: number;
  retentionMs?: number;
  now?: () => number;
}

export class BroadcastAssetRegistry {
  private readonly entries = new Map<string, StoredBroadcastAsset>();
  private readonly maxBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private totalBytes = 0;

  constructor(options: BroadcastAssetRegistryOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_ASSET_BYTES;
    this.retentionMs = options.retentionMs ?? DEFAULT_ASSET_RETENTION_MS;
    this.now = options.now ?? Date.now;
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1 ||
      this.maxBytes > 512 * 1024 * 1024
    ) {
      throw new Error('OBS_BRIDGE_INVALID_ASSET_BYTE_LIMIT');
    }
    if (
      !Number.isSafeInteger(this.retentionMs) ||
      this.retentionMs < 0 ||
      this.retentionMs > 24 * 60 * 60 * 1000
    ) {
      throw new Error('OBS_BRIDGE_INVALID_ASSET_RETENTION');
    }
  }

  prepareSnapshot(snapshot: BroadcastSnapshot, token: string): BroadcastSnapshot {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      throw new Error('OBS_BRIDGE_INVALID_ASSET_TOKEN');
    }
    const now = this.now();
    const prepared = (snapshot.assets ?? []).map((asset) => {
      if (!isInlineBroadcastAsset(asset)) {
        throw new Error('OBS_BRIDGE_HTTP_ASSET_INPUT_NOT_ALLOWED');
      }
      return { asset, bytes: decodeAndVerifyAsset(asset) };
    });
    const currentBytes = prepared.reduce((total, item) => total + item.bytes.length, 0);
    if (currentBytes > this.maxBytes) {
      throw new Error('OBS_BRIDGE_ASSET_REGISTRY_LIMIT');
    }

    const currentHashes = new Set<string>();
    for (const item of prepared) {
      currentHashes.add(item.asset.sha256);
      this.upsert(item.asset, item.bytes, now);
    }
    this.prune(currentHashes, now);

    if (snapshot.assets === undefined) return snapshot;
    const assets: HttpBroadcastAsset[] = prepared.map(({ asset }) => ({
      id: asset.id,
      sha256: asset.sha256,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      byteLength: asset.byteLength,
      animated: false,
      sanitized: asset.sanitized,
      delivery: 'http',
      url: \`/asset/\${token}/\${asset.sha256}\`,
    }));
    return { ...snapshot, assets };
  }

  get(sha256: string): StoredBroadcastAsset | undefined {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return undefined;
    const entry = this.entries.get(sha256);
    if (entry !== undefined) entry.lastReferencedAt = this.now();
    return entry;
  }

  getStats(): BroadcastAssetRegistryStats {
    return {
      count: this.entries.size,
      totalBytes: this.totalBytes,
      maxBytes: this.maxBytes,
      retentionMs: this.retentionMs,
    };
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private upsert(asset: InlineBroadcastAsset, bytes: Buffer, now: number): void {
    const existing = this.entries.get(asset.sha256);
    if (existing !== undefined) {
      if (
        existing.mime !== asset.mime ||
        existing.byteLength !== asset.byteLength ||
        existing.sanitized !== asset.sanitized
      ) {
        throw new Error('OBS_BRIDGE_ASSET_HASH_METADATA_MISMATCH');
      }
      existing.lastReferencedAt = now;
      return;
    }
    this.entries.set(asset.sha256, {
      sha256: asset.sha256,
      mime: asset.mime,
      byteLength: asset.byteLength,
      bytes,
      sanitized: asset.sanitized,
      lastReferencedAt: now,
    });
    this.totalBytes += bytes.length;
  }

  private prune(currentHashes: ReadonlySet<string>, now: number): void {
    for (const [sha256, entry] of this.entries) {
      if (
        !currentHashes.has(sha256) &&
        now - entry.lastReferencedAt > this.retentionMs
      ) {
        this.delete(sha256);
      }
    }
    if (this.totalBytes <= this.maxBytes) return;

    const removable = [...this.entries.values()]
      .filter((entry) => !currentHashes.has(entry.sha256))
      .sort((a, b) => a.lastReferencedAt - b.lastReferencedAt);
    for (const entry of removable) {
      this.delete(entry.sha256);
      if (this.totalBytes <= this.maxBytes) return;
    }
    if (this.totalBytes > this.maxBytes) {
      throw new Error('OBS_BRIDGE_ASSET_REGISTRY_LIMIT');
    }
  }

  private delete(sha256: string): void {
    const entry = this.entries.get(sha256);
    if (entry === undefined) return;
    this.entries.delete(sha256);
    this.totalBytes -= entry.byteLength;
  }
}

function decodeAndVerifyAsset(asset: InlineBroadcastAsset): Buffer {
  const prefix = \`data:\${asset.mime};base64,\`;
  if (!asset.dataUrl.startsWith(prefix)) {
    throw new Error('OBS_BRIDGE_INVALID_ASSET_DATA_URL');
  }
  const base64 = asset.dataUrl.slice(prefix.length);
  if (
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new Error('OBS_BRIDGE_INVALID_ASSET_DATA_URL');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (
    bytes.length !== asset.byteLength ||
    bytes.toString('base64') !== base64
  ) {
    throw new Error('OBS_BRIDGE_INVALID_ASSET_DATA_URL');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) {
    throw new Error('OBS_BRIDGE_ASSET_HASH_MISMATCH');
  }
  return bytes;
}
`,
);

const bridgePath = 'packages/obs-bridge/src/index.ts';
await replaceOnce(
  bridgePath,
`import { WebSocketServer, type RawData, type WebSocket } from 'ws';`,
`import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  BroadcastAssetRegistry,
  type BroadcastAssetRegistryStats,
  type StoredBroadcastAsset,
} from './asset-registry.js';`,
);
await replaceOnce(
  bridgePath,
`  pageTransition?: PageTransition;
}`,
`  pageTransition?: PageTransition;
  maxAssetBytes?: number;
  assetRetentionMs?: number;
  now?: () => number;
}`,
);
await replaceOnce(
  bridgePath,
`  getLatestRevision(): number | null;
  publishSnapshot(snapshot: BroadcastSnapshot): number;`,
`  getLatestRevision(): number | null;
  getAssetStats(): BroadcastAssetRegistryStats;
  publishSnapshot(snapshot: BroadcastSnapshot): number;`,
);
await replaceOnce(
  bridgePath,
`  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const configuredOrigins = new Set(`,
`  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const assetRegistry = new BroadcastAssetRegistry({
    maxBytes: options.maxAssetBytes,
    retentionMs: options.assetRetentionMs,
    now: options.now,
  });
  const configuredOrigins = new Set(`,
);
await replaceOnce(
  bridgePath,
`  let latestSnapshot =
    options.initialSnapshot === undefined
      ? undefined
      : parseBroadcastSnapshot(options.initialSnapshot);`,
`  let latestSnapshot =
    options.initialSnapshot === undefined
      ? undefined
      : assetRegistry.prepareSnapshot(
          parseBroadcastSnapshot(options.initialSnapshot),
          token,
        );`,
);
await replaceOnce(
  bridgePath,
`      ownOrigin,
      options.overlayRoot,
    ).catch(() => {`,
`      ownOrigin,
      options.overlayRoot,
      assetRegistry,
    ).catch(() => {`,
);
await replaceOnce(
  bridgePath,
`    getLatestRevision: () => latestSnapshot?.revision ?? null,
    publishSnapshot: (input) => {
      const snapshot = parseBroadcastSnapshot(input);
      if (
        latestSnapshot !== undefined &&
        snapshot.revision <= latestSnapshot.revision
      ) {`,
`    getLatestRevision: () => latestSnapshot?.revision ?? null,
    getAssetStats: () => assetRegistry.getStats(),
    publishSnapshot: (input) => {
      const parsedSnapshot = parseBroadcastSnapshot(input);
      if (
        latestSnapshot !== undefined &&
        parsedSnapshot.revision <= latestSnapshot.revision
      ) {`,
);
await replaceOnce(
  bridgePath,
`        throw new Error('OBS_BRIDGE_STALE_REVISION');
      }

      const message = createSnapshotMessage(`,
`        throw new Error('OBS_BRIDGE_STALE_REVISION');
      }
      const snapshot = assetRegistry.prepareSnapshot(parsedSnapshot, token);

      const message = createSnapshotMessage(`,
);
await replaceOnce(
  bridgePath,
`    close: async () => {
      for (const client of webSocketServer.clients) client.terminate();`,
`    close: async () => {
      assetRegistry.clear();
      for (const client of webSocketServer.clients) client.terminate();`,
);
await replaceOnce(
  bridgePath,
`  ownOrigin: string,
  overlayRoot: string | undefined,
): Promise<void> {`,
`  ownOrigin: string,
  overlayRoot: string | undefined,
  assetRegistry: BroadcastAssetRegistry,
): Promise<void> {`,
);
await replaceOnce(
  bridgePath,
`  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (
    request.method === 'GET' &&
    requestUrl.pathname.startsWith('/overlay/')`,
`  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    requestUrl.pathname.startsWith('/asset/')
  ) {
    serveRegisteredAsset(request, response, requestUrl, token, assetRegistry);
    return;
  }

  if (
    request.method === 'GET' &&
    requestUrl.pathname.startsWith('/overlay/')`,
);
await appendBefore(
  bridgePath,
`function registerClientMessageHandler(`,
`function serveRegisteredAsset(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  token: string,
  assetRegistry: BroadcastAssetRegistry,
): void {
  const match = /^\\/asset\\/([0-9a-f]{64})\\/([0-9a-f]{64})$/.exec(
    requestUrl.pathname,
  );
  if (match === null || requestUrl.search !== '') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }
  if (!isValidToken(token, match[1] ?? null)) {
    response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Unauthorized');
    return;
  }
  const asset = assetRegistry.get(match[2]!);
  if (asset === undefined) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  const etag = \`"\${asset.sha256}"\`;
  const headers = createAssetHeaders(asset, etag);
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') response.end();
  else response.end(asset.bytes);
}

function createAssetHeaders(
  asset: StoredBroadcastAsset,
  etag: string,
): Record<string, string | number> {
  const headers: Record<string, string | number> = {
    'Content-Type': asset.mime,
    'Content-Length': asset.byteLength,
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
  };
  if (asset.mime === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
  }
  return headers;
}

`,
);

await writeFile(
  'packages/obs-bridge/test/asset-registry.test.ts',
`import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BroadcastSnapshot, InlineBroadcastAsset } from '@live-board/obs-protocol';
import { BroadcastAssetRegistry } from '../src/asset-registry.js';

const token = 'a'.repeat(64);

function createAsset(content: string, id = 'asset:test'): InlineBroadcastAsset {
  const bytes = Buffer.from(content);
  return {
    id,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mime: 'image/png',
    width: 1,
    height: 1,
    byteLength: bytes.length,
    dataUrl: \`data:image/png;base64,\${bytes.toString('base64')}\`,
    animated: false,
    sanitized: false,
  };
}

function createSnapshot(asset: InlineBroadcastAsset, revision = 1): BroadcastSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision,
    generatedAt: '2026-07-23T00:00:00.000Z',
    canvas: {
      width: 1920,
      height: 1080,
      dpi: 72,
      background: { type: 'transparent' },
    },
    overlay: {
      preset: 'simple',
      theme: 'transparent',
      transition: { type: 'fade', durationMs: 120 },
      performanceMode: 'balanced',
      customCss: '',
      customCssEnabled: false,
      customCssFallback: false,
    },
    assets: [asset],
    layers: [],
  };
}

describe('BroadcastAssetRegistry', () => {
  it('inline Assetをhash URLへ変換し、バイナリを保持する', () => {
    const asset = createAsset('asset-body');
    const registry = new BroadcastAssetRegistry();
    const delivered = registry.prepareSnapshot(createSnapshot(asset), token);

    expect(delivered.assets?.[0]).toEqual({
      id: asset.id,
      sha256: asset.sha256,
      mime: asset.mime,
      width: 1,
      height: 1,
      byteLength: asset.byteLength,
      animated: false,
      sanitized: false,
      delivery: 'http',
      url: \`/asset/\${token}/\${asset.sha256}\`,
    });
    expect(JSON.stringify(delivered)).not.toContain('data:image');
    expect(registry.get(asset.sha256)?.bytes.toString()).toBe('asset-body');
    expect(registry.getStats()).toMatchObject({ count: 1, totalBytes: asset.byteLength });
  });

  it('同一hashを再登録しても1件だけ保持する', () => {
    const asset = createAsset('same-binary');
    const registry = new BroadcastAssetRegistry();
    registry.prepareSnapshot(createSnapshot(asset, 1), token);
    registry.prepareSnapshot(createSnapshot({ ...asset, id: 'asset:alias' }, 2), token);

    expect(registry.getStats()).toMatchObject({ count: 1, totalBytes: asset.byteLength });
  });

  it('byteLength・SHA-256改ざんとHTTP入力を拒否する', () => {
    const asset = createAsset('verified');
    const registry = new BroadcastAssetRegistry();
    expect(() => registry.prepareSnapshot(
      createSnapshot({ ...asset, byteLength: asset.byteLength + 1 }),
      token,
    )).toThrow('OBS_BRIDGE_INVALID_ASSET_DATA_URL');
    expect(() => registry.prepareSnapshot(
      createSnapshot({ ...asset, sha256: '0'.repeat(64) }),
      token,
    )).toThrow('OBS_BRIDGE_ASSET_HASH_MISMATCH');
    const delivered = registry.prepareSnapshot(createSnapshot(asset), token);
    expect(() => registry.prepareSnapshot(delivered, token)).toThrow(
      'OBS_BRIDGE_HTTP_ASSET_INPUT_NOT_ALLOWED',
    );
  });

  it('未参照Assetを猶予後に解放し、上限超過時は古い未参照Assetを先に除去する', () => {
    let now = 0;
    const first = createAsset('first');
    const second = createAsset('second');
    const registry = new BroadcastAssetRegistry({
      maxBytes: first.byteLength + second.byteLength,
      retentionMs: 100,
      now: () => now,
    });
    registry.prepareSnapshot(createSnapshot(first, 1), token);
    now = 50;
    registry.prepareSnapshot(createSnapshot(second, 2), token);
    expect(registry.getStats().count).toBe(2);
    now = 151;
    registry.prepareSnapshot(createSnapshot(second, 3), token);
    expect(registry.getStats()).toMatchObject({ count: 1, totalBytes: second.byteLength });
  });
});
`,
);

const protocolTestPath = 'packages/obs-protocol/test/protocol-v4.test.ts';
await replaceOnce(
  protocolTestPath,
`import {
  parseBroadcastAsset,
  parseBroadcastSnapshot,
  type BroadcastSnapshot,
} from '../src/protocol-v4.js';`,
`import {
  getBroadcastAssetSource,
  parseBroadcastAsset,
  parseBroadcastSnapshot,
  type BroadcastSnapshot,
} from '../src/protocol-v4.js';`,
);
await appendBefore(
  protocolTestPath,
`  it('旧Text・Image・Shapeには安全な既定値を補完する', () => {`,
`  it('認証付きloopback HTTP Assetを受け入れ、外部URLとhash不一致を拒否する', () => {
    const token = 'b'.repeat(64);
    const httpAsset = parseBroadcastAsset({
      ...asset,
      dataUrl: undefined,
      delivery: 'http',
      url: \`/asset/\${token}/\${asset.sha256}\`,
    });
    expect(getBroadcastAssetSource(httpAsset)).toBe(
      \`/asset/\${token}/\${asset.sha256}\`,
    );
    expect(getBroadcastAssetSource(parseBroadcastAsset(asset))).toBe(asset.dataUrl);
    expect(() => parseBroadcastAsset({
      ...asset,
      dataUrl: undefined,
      delivery: 'http',
      url: 'https://example.com/asset.png',
    })).toThrow('OBS_PROTOCOL_INVALID_ASSET');
    expect(() => parseBroadcastAsset({
      ...asset,
      dataUrl: undefined,
      delivery: 'http',
      url: \`/asset/\${token}/\${'0'.repeat(64)}\`,
    })).toThrow('OBS_PROTOCOL_INVALID_ASSET');
  });

`,
);

const bridgeTestPath = 'packages/obs-bridge/test/obs-bridge.test.ts';
await replaceOnce(
  bridgeTestPath,
`import { once } from 'node:events';`,
`import { createHash } from 'node:crypto';
import { once } from 'node:events';`,
);
await appendBefore(
  bridgeTestPath,
`afterEach(async () => {`,
`const httpAssetBytes = Buffer.from('live-board-http-asset');
const httpAssetHash = createHash('sha256').update(httpAssetBytes).digest('hex');
const httpAssetSnapshot: BroadcastSnapshot = {
  ...snapshot,
  assets: [
    {
      id: 'asset:http',
      sha256: httpAssetHash,
      mime: 'image/png',
      width: 1,
      height: 1,
      byteLength: httpAssetBytes.length,
      dataUrl: \`data:image/png;base64,\${httpAssetBytes.toString('base64')}\`,
      animated: false,
      sanitized: false,
    },
  ],
  layers: [
    {
      id: 'image-http',
      parentId: null,
      name: 'HTTP画像',
      type: 'image',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      color: null,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      content: {
        assetId: 'asset:http',
        width: 1,
        height: 1,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        flipX: false,
        flipY: false,
      },
    },
  ],
};

`,
);
await appendBefore(
  bridgeTestPath,
`  it('不正tokenと外部OriginをUpgrade前に拒否する', async () => {`,
`  it('画像data URLをWebSocketへ送らず、認証付きhash URLから配信する', async () => {
    activeBridge = await startObsBridge({ initialSnapshot: httpAssetSnapshot });
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const webSocket = new WebSocket(activeBridge.info.webSocketUrl, { origin });
    const messagePromise = once(webSocket, 'message');
    await once(webSocket, 'open');
    const [rawMessage] = await messagePromise;
    const message = JSON.parse(rawMessage.toString());

    expect(JSON.stringify(message)).not.toContain('data:image');
    expect(message.snapshot.assets).toHaveLength(1);
    const deliveredAsset = message.snapshot.assets[0];
    expect(deliveredAsset).toMatchObject({
      sha256: httpAssetHash,
      delivery: 'http',
    });
    expect(deliveredAsset.url).toMatch(
      new RegExp(\`^/asset/[0-9a-f]{64}/\${httpAssetHash}$\`),
    );

    const response = await fetch(\`\${origin}\${deliveredAsset.url}\`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const etag = response.headers.get('etag');
    expect(etag).toBe(\`"\${httpAssetHash}"\`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(httpAssetBytes);

    const cached = await fetch(\`\${origin}\${deliveredAsset.url}\`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(cached.status).toBe(304);
    const head = await fetch(\`\${origin}\${deliveredAsset.url}\`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const pathParts = deliveredAsset.url.split('/');
    pathParts[2] = pathParts[2].startsWith('0')
      ? \`1\${pathParts[2].slice(1)}\`
      : \`0\${pathParts[2].slice(1)}\`;
    expect((await fetch(\`\${origin}\${pathParts.join('/')}\`)).status).toBe(401);
    expect((await fetch(
      \`\${origin}/asset/\${pathParts[2]}/\${'0'.repeat(64)}\`,
    )).status).toBe(404);
    expect(activeBridge.getAssetStats()).toMatchObject({
      count: 1,
      totalBytes: httpAssetBytes.length,
    });

    webSocket.close();
    await once(webSocket, 'close');
  });

`,
);

await unlink('scripts/ivr-247-apply.mjs');
await unlink('.github/workflows/ivr-247-apply.yml');
await unlink('.github/ivr-247-apply.trigger');
