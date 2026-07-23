import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createBroadcastIpcPayload,
  publishBroadcastSnapshotWithAssets,
  type BroadcastIpcApi,
} from '../src/broadcast-ipc';
import type { BroadcastSnapshot } from '@live-board/obs-protocol';

const bytes = Buffer.from('ipc-asset');
const sha256 = createHash('sha256').update(bytes).digest('hex');

function snapshot(revision = 1): BroadcastSnapshot {
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
    assets: [
      {
        id: 'asset:ipc',
        sha256,
        mime: 'image/png',
        width: 1,
        height: 1,
        byteLength: bytes.byteLength,
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        animated: false,
        sanitized: false,
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
          assetId: 'asset:ipc',
          width: 1,
          height: 1,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          flipX: false,
          flipY: false,
        },
      },
    ],
  };
}

describe('broadcast IPC helper', () => {
  it('未登録AssetだけをUint8Array登録へ変換しpublish payloadからsourceを除く', () => {
    const payload = createBroadcastIpcPayload(snapshot(), new Set());

    expect(payload.registrations).toHaveLength(1);
    expect(Buffer.from(payload.registrations[0]!.bytes)).toEqual(bytes);
    expect(payload.snapshot.assets).toEqual([
      expect.objectContaining({ id: 'asset:ipc', sha256 }),
    ]);
    expect(JSON.stringify(payload.snapshot)).not.toContain('data:image');
    expect(JSON.stringify(payload.snapshot)).not.toContain('/asset/');
  });

  it('登録済みSHA-256は次revisionでbytesを再送しない', () => {
    const payload = createBroadcastIpcPayload(snapshot(2), new Set([sha256]));

    expect(payload.registrations).toEqual([]);
    expect(payload.snapshot.revision).toBe(2);
  });

  it('初回はAsset登録後にdescriptor Snapshotを公開する', async () => {
    const calls: string[] = [];
    const api: BroadcastIpcApi = {
      registerBroadcastAssets: vi.fn(async (requestId, assets) => {
        calls.push(`register:${assets.length}`);
        return { requestId, registeredSha256: assets.map((asset) => asset.sha256) };
      }),
      publishBroadcastSnapshot: vi.fn(async (requestId, value) => {
        calls.push(`publish:${value.revision}`);
        return { requestId, acceptedRevision: value.revision };
      }),
    };
    const registered = new Set<string>();

    const result = await publishBroadcastSnapshotWithAssets(
      api,
      'request_1',
      snapshot(),
      registered,
    );

    expect(calls).toEqual(['register:1', 'publish:1']);
    expect(result.acceptedRevision).toBe(1);
    expect(registered).toEqual(new Set([sha256]));
  });

  it('Main側でAsset解放済みの場合は全Assetを再登録して同revisionを再試行する', async () => {
    let publishCount = 0;
    const api: BroadcastIpcApi = {
      registerBroadcastAssets: vi.fn(async (requestId, assets) => ({
        requestId,
        registeredSha256: assets.map((asset) => asset.sha256),
      })),
      publishBroadcastSnapshot: vi.fn(async (requestId, value) => {
        publishCount += 1;
        if (publishCount === 1) {
          throw new Error('OBS_BRIDGE_ASSET_NOT_REGISTERED');
        }
        return { requestId, acceptedRevision: value.revision };
      }),
    };
    const registered = new Set([sha256]);

    const result = await publishBroadcastSnapshotWithAssets(
      api,
      'request_2',
      snapshot(2),
      registered,
    );

    expect(api.registerBroadcastAssets).toHaveBeenCalledTimes(1);
    expect(api.publishBroadcastSnapshot).toHaveBeenCalledTimes(2);
    expect(result.acceptedRevision).toBe(2);
  });
});
