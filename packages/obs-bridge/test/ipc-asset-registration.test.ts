import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startObsBridge,
  type ObsBridge,
} from '../src/index.js';
import type {
  BroadcastAssetRegistration,
  BroadcastSnapshotDescriptor,
} from '@live-board/obs-protocol';

let activeBridge: ObsBridge | undefined;

afterEach(async () => {
  if (activeBridge !== undefined) {
    await activeBridge.close();
    activeBridge = undefined;
  }
});

function registration(content: string): BroadcastAssetRegistration {
  const bytes = Buffer.from(content);
  return {
    id: `asset:${content}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mime: 'image/png',
    width: 1,
    height: 1,
    byteLength: bytes.length,
    animated: false,
    sanitized: false,
    bytes,
  };
}

function snapshot(
  revision: number,
  asset?: BroadcastAssetRegistration,
): BroadcastSnapshotDescriptor {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision,
    generatedAt: `2026-07-24T00:00:0${revision}.000Z`,
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
    ...(asset === undefined
      ? { layers: [] }
      : {
          assets: [
            {
              id: asset.id,
              sha256: asset.sha256,
              mime: asset.mime,
              width: asset.width,
              height: asset.height,
              byteLength: asset.byteLength,
              animated: false,
              sanitized: asset.sanitized,
            },
          ],
          layers: [
            {
              id: 'image-1',
              parentId: null,
              name: '画像',
              type: 'image',
              visible: true,
              opacity: 1,
              blendMode: 'normal',
              color: null,
              transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
              content: {
                assetId: asset.id,
                width: 1,
                height: 1,
                crop: { x: 0, y: 0, width: 1, height: 1 },
                flipX: false,
                flipY: false,
              },
            },
          ],
        }),
  };
}

describe('OBS Bridge IPC Asset registration', () => {
  it('Assetを一度登録し、複数revisionをdescriptorだけで公開する', async () => {
    const asset = registration('registered-once');
    activeBridge = await startObsBridge();

    expect(activeBridge.registerAssets([asset])).toEqual([asset.sha256]);
    expect(activeBridge.publishSnapshotDescriptor(snapshot(1, asset))).toBe(1);
    expect(activeBridge.registerAssets([asset])).toEqual([asset.sha256]);
    expect(activeBridge.publishSnapshotDescriptor(snapshot(2, asset))).toBe(2);
    expect(activeBridge.getAssetStats()).toMatchObject({
      count: 1,
      totalBytes: asset.byteLength,
    });
  });

  it('未登録Asset descriptorを拒否しlatest revisionを更新しない', async () => {
    const asset = registration('missing');
    activeBridge = await startObsBridge();

    expect(() => activeBridge?.publishSnapshotDescriptor(snapshot(1, asset))).toThrow(
      'OBS_BRIDGE_ASSET_NOT_REGISTERED',
    );
    expect(activeBridge.getLatestRevision()).toBeNull();
    expect(activeBridge.getAssetStats()).toMatchObject({ count: 0, totalBytes: 0 });
  });

  it('SHA-256改ざんと同一hashのmetadata不一致を原子的に拒否する', async () => {
    const asset = registration('verified');
    activeBridge = await startObsBridge();

    expect(() => activeBridge?.registerAssets([
      { ...asset, sha256: '0'.repeat(64) },
    ])).toThrow('OBS_BRIDGE_ASSET_HASH_MISMATCH');
    expect(activeBridge.getAssetStats()).toMatchObject({ count: 0, totalBytes: 0 });

    activeBridge.registerAssets([asset]);
    expect(() => activeBridge?.registerAssets([
      { ...asset, width: 2 },
    ])).toThrow('OBS_BRIDGE_ASSET_HASH_METADATA_MISMATCH');
    expect(activeBridge.getAssetStats()).toMatchObject({
      count: 1,
      totalBytes: asset.byteLength,
    });
  });

  it('保持猶予後に解放されたAssetはdescriptor公開時に再登録を要求する', async () => {
    let now = 1_000;
    const asset = registration('released');
    activeBridge = await startObsBridge({
      assetRetentionMs: 0,
      now: () => now,
    });
    activeBridge.registerAssets([asset]);
    activeBridge.publishSnapshotDescriptor(snapshot(1, asset));

    now += 1;
    activeBridge.publishSnapshotDescriptor(snapshot(2));
    expect(activeBridge.getAssetStats()).toMatchObject({ count: 0, totalBytes: 0 });
    expect(() => activeBridge?.publishSnapshotDescriptor(snapshot(3, asset))).toThrow(
      'OBS_BRIDGE_ASSET_NOT_REGISTERED',
    );
    expect(activeBridge.getLatestRevision()).toBe(2);
  });
});
