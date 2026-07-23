import { createHash } from 'node:crypto';
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
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
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
      url: `/asset/${token}/${asset.sha256}`,
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
