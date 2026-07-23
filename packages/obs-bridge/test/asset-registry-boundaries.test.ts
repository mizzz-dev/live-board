import { createHash } from 'node:crypto';
import type {
  BroadcastSnapshot,
  InlineBroadcastAsset,
} from '@live-board/obs-protocol';
import { describe, expect, it } from 'vitest';
import { BroadcastAssetRegistry } from '../src/asset-registry.js';

const validToken = 'a'.repeat(64);

function createAsset(
  content: string,
  options: {
    id?: string;
    mime?: 'image/png' | 'image/jpeg';
  } = {},
): InlineBroadcastAsset {
  const bytes = Buffer.from(content);
  const mime = options.mime ?? 'image/png';
  return {
    id: options.id ?? 'asset:boundary',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mime,
    width: 1,
    height: 1,
    byteLength: bytes.length,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    animated: false,
    sanitized: false,
  };
}

function createSnapshot(asset: InlineBroadcastAsset): BroadcastSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision: 1,
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

describe('BroadcastAssetRegistry境界', () => {
  it('不正tokenを受け付けない', () => {
    const registry = new BroadcastAssetRegistry();

    expect(() =>
      registry.prepareSnapshot(createSnapshot(createAsset('token')), 'x'.repeat(64)),
    ).toThrow('OBS_BRIDGE_INVALID_ASSET_TOKEN');
  });

  it('現在Snapshotだけでbyte上限を超える場合は公開しない', () => {
    const registry = new BroadcastAssetRegistry({ maxBytes: 4 });

    expect(() =>
      registry.prepareSnapshot(createSnapshot(createAsset('12345')), validToken),
    ).toThrow('OBS_BRIDGE_ASSET_REGISTRY_LIMIT');
    expect(registry.getStats()).toMatchObject({ count: 0, totalBytes: 0 });
  });

  it('同一SHA-256に異なるMIME metadataを割り当てない', () => {
    const registry = new BroadcastAssetRegistry();
    const png = createAsset('same-content', { mime: 'image/png' });
    const jpeg = createAsset('same-content', {
      id: 'asset:jpeg-alias',
      mime: 'image/jpeg',
    });

    registry.prepareSnapshot(createSnapshot(png), validToken);
    expect(() => registry.prepareSnapshot(createSnapshot(jpeg), validToken)).toThrow(
      'OBS_BRIDGE_ASSET_HASH_METADATA_MISMATCH',
    );
    expect(registry.getStats()).toMatchObject({
      count: 1,
      totalBytes: png.byteLength,
    });
  });

  it('registry設定値の異常を起動時に拒否する', () => {
    expect(() => new BroadcastAssetRegistry({ maxBytes: 0 })).toThrow(
      'OBS_BRIDGE_INVALID_ASSET_BYTE_LIMIT',
    );
    expect(() => new BroadcastAssetRegistry({ retentionMs: -1 })).toThrow(
      'OBS_BRIDGE_INVALID_ASSET_RETENTION',
    );
  });
});
