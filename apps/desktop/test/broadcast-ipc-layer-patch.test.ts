import {
  toBroadcastSnapshotDescriptor,
  type BroadcastLayer,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  createBroadcastIpcUpdate,
  publishBroadcastSnapshotWithAssets,
  type BroadcastIpcApi,
} from '../src/broadcast-ipc';

function textLayer(index: number, text = `Layer ${index}`): BroadcastLayer {
  return {
    id: `layer-${index}`,
    parentId: null,
    name: `レイヤー ${index}`,
    type: 'text',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    color: null,
    transform: { x: index, y: index, scaleX: 1, scaleY: 1, rotation: 0 },
    content: {
      text,
      fontFamily: 'sans-serif',
      fontSize: 48,
      color: '#FFFFFF',
      fontWeight: 400,
      fontStyle: 'normal',
      align: 'left',
      lineHeight: 1.2,
      strokeColor: null,
      strokeWidth: 0,
      shadowColor: null,
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      maxWidth: null,
    },
  };
}

function snapshot(
  revision: number,
  layers: BroadcastLayer[],
  overrides: Partial<BroadcastSnapshot> = {},
): BroadcastSnapshot {
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
    layers,
    ...overrides,
  };
}

function createApi(options: {
  patchError?: Error;
} = {}): BroadcastIpcApi & {
  publishBroadcastSnapshot: ReturnType<typeof vi.fn>;
  publishBroadcastLayerPatch: ReturnType<typeof vi.fn>;
} {
  return {
    registerBroadcastAssets: vi.fn(async (requestId, assets) => ({
      requestId,
      registeredSha256: assets.map((asset) => asset.sha256),
    })),
    publishBroadcastSnapshot: vi.fn(async (requestId, value) => ({
      requestId,
      acceptedRevision: value.revision,
    })),
    publishBroadcastLayerPatch: vi.fn(async (requestId, value) => {
      if (options.patchError !== undefined) throw options.patchError;
      return { requestId, acceptedRevision: value.revision };
    }),
  };
}

describe('Renderer→Main Layer patch', () => {
  it('初回はfull、同一ページの1Layer更新はpatchを送る', async () => {
    const api = createApi();
    const session = new Set<string>();
    const firstLayers = Array.from({ length: 100 }, (_, index) => textLayer(index));
    const secondLayers = firstLayers.map((layer, index) =>
      index === 42 ? textLayer(index, '変更後') : layer,
    );

    await publishBroadcastSnapshotWithAssets(
      api,
      'request_1',
      snapshot(1, firstLayers),
      session,
    );
    await publishBroadcastSnapshotWithAssets(
      api,
      'request_2',
      snapshot(2, secondLayers),
      session,
    );

    expect(api.publishBroadcastSnapshot).toHaveBeenCalledTimes(1);
    expect(api.publishBroadcastLayerPatch).toHaveBeenCalledTimes(1);
    const patch = api.publishBroadcastLayerPatch.mock.calls[0]![1];
    expect(patch.upsertedLayers.map((layer: BroadcastLayer) => layer.id)).toEqual([
      'layer-42',
    ]);
    expect(patch.baseRevision).toBe(1);
    expect(patch.revision).toBe(2);
  });

  it('Mainに基準Snapshotがない場合は同revisionのfullへ1回だけ戻す', async () => {
    const api = createApi({
      patchError: new Error('IPC_BROADCAST_SNAPSHOT_REQUIRED'),
    });
    const session = new Set<string>();
    const first = snapshot(1, [textLayer(1, 'A')]);
    const second = snapshot(2, [textLayer(1, 'B')]);

    await publishBroadcastSnapshotWithAssets(api, 'request_1', first, session);
    const result = await publishBroadcastSnapshotWithAssets(
      api,
      'request_2',
      second,
      session,
    );

    expect(result.acceptedRevision).toBe(2);
    expect(api.publishBroadcastLayerPatch).toHaveBeenCalledTimes(1);
    expect(api.publishBroadcastSnapshot).toHaveBeenCalledTimes(2);
    expect(api.publishBroadcastSnapshot.mock.calls[1]![1].revision).toBe(2);
  });

  it('Page・Canvas・Overlay設定変更ではfull Snapshotを送る', async () => {
    const api = createApi();
    const session = new Set<string>();
    const first = snapshot(1, [textLayer(1, 'A')]);
    const second = snapshot(2, [textLayer(1, 'B')], {
      overlay: { ...first.overlay, theme: 'blackboard' },
    });

    await publishBroadcastSnapshotWithAssets(api, 'request_1', first, session);
    await publishBroadcastSnapshotWithAssets(api, 'request_2', second, session);

    expect(api.publishBroadcastLayerPatch).not.toHaveBeenCalled();
    expect(api.publishBroadcastSnapshot).toHaveBeenCalledTimes(2);
  });

  it('100Layer中1Layer更新のpatch payloadをfullの10%未満に保つ', () => {
    const firstLayers = Array.from({ length: 100 }, (_, index) => textLayer(index));
    const secondLayers = firstLayers.map((layer, index) =>
      index === 50 ? textLayer(index, '更新') : layer,
    );
    const previous = toBroadcastSnapshotDescriptor(snapshot(1, firstLayers));
    const next = toBroadcastSnapshotDescriptor(snapshot(2, secondLayers));
    const update = createBroadcastIpcUpdate(previous, next);

    expect(update.type).toBe('layer.patch');
    const patchBytes = new TextEncoder().encode(JSON.stringify(update)).byteLength;
    const fullBytes = new TextEncoder().encode(
      JSON.stringify({ type: 'snapshot', snapshot: next }),
    ).byteLength;
    console.info('IPC layer patch payload metric', {
      fullBytes,
      patchBytes,
      ratio: patchBytes / fullBytes,
    });
    expect(patchBytes).toBeLessThan(fullBytes * 0.1);
  });
});
