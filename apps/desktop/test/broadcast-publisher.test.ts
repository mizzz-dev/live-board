import {
  createBroadcastLayerPatchDescriptor,
  type BroadcastLayer,
  type BroadcastSnapshotDescriptor,
} from '@live-board/obs-protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  BroadcastDescriptorPublisher,
  type BroadcastDescriptorBridge,
} from '../electron/broadcast-publisher.js';

function textLayer(text: string): BroadcastLayer {
  return {
    id: 'layer-1',
    parentId: null,
    name: 'テキスト',
    type: 'text',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    color: null,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
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

function snapshot(revision: number, text: string): BroadcastSnapshotDescriptor {
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
    layers: [textLayer(text)],
  };
}

describe('BroadcastDescriptorPublisher', () => {
  it('初回Snapshot公開後にLayer patchを適用する', () => {
    const publishSnapshotDescriptor = vi.fn(
      (value: BroadcastSnapshotDescriptor) => value.revision,
    );
    const bridge: BroadcastDescriptorBridge = { publishSnapshotDescriptor };
    const publisher = new BroadcastDescriptorPublisher(bridge);
    const first = snapshot(1, 'A');
    const second = snapshot(2, 'B');

    expect(publisher.publishSnapshot(first)).toBe(1);
    expect(
      publisher.publishLayerPatch(
        createBroadcastLayerPatchDescriptor(first, second)!,
      ),
    ).toBe(2);
    expect(publisher.getLatestSnapshot()).toEqual(second);
    expect(publishSnapshotDescriptor).toHaveBeenLastCalledWith(second);
  });

  it('基準Snapshotがないpatchを拒否する', () => {
    const bridge: BroadcastDescriptorBridge = {
      publishSnapshotDescriptor: vi.fn(),
    };
    const publisher = new BroadcastDescriptorPublisher(bridge);
    const first = snapshot(1, 'A');
    const second = snapshot(2, 'B');

    expect(() =>
      publisher.publishLayerPatch(
        createBroadcastLayerPatchDescriptor(first, second)!,
      ),
    ).toThrow('IPC_BROADCAST_SNAPSHOT_REQUIRED');
    expect(bridge.publishSnapshotDescriptor).not.toHaveBeenCalled();
  });

  it('Bridge公開失敗時に保持Snapshotを更新しない', () => {
    const first = snapshot(1, 'A');
    const second = snapshot(2, 'B');
    const publishSnapshotDescriptor = vi
      .fn<(value: BroadcastSnapshotDescriptor) => number>()
      .mockReturnValueOnce(1)
      .mockImplementationOnce(() => {
        throw new Error('OBS_BRIDGE_PUBLISH_FAILED');
      });
    const publisher = new BroadcastDescriptorPublisher({
      publishSnapshotDescriptor,
    });

    publisher.publishSnapshot(first);
    expect(() =>
      publisher.publishLayerPatch(
        createBroadcastLayerPatchDescriptor(first, second)!,
      ),
    ).toThrow('OBS_BRIDGE_PUBLISH_FAILED');
    expect(publisher.getLatestSnapshot()).toEqual(first);
  });

  it('base revision不一致時にBridgeへ渡さない', () => {
    const first = snapshot(1, 'A');
    const second = snapshot(2, 'B');
    const bridge: BroadcastDescriptorBridge = {
      publishSnapshotDescriptor: vi.fn((value) => value.revision),
    };
    const publisher = new BroadcastDescriptorPublisher(bridge);
    publisher.publishSnapshot(snapshot(9, 'current'));

    expect(() =>
      publisher.publishLayerPatch(
        createBroadcastLayerPatchDescriptor(first, second)!,
      ),
    ).toThrow('OBS_PROTOCOL_LAYER_PATCH_BASE_REVISION_MISMATCH');
    expect(bridge.publishSnapshotDescriptor).toHaveBeenCalledTimes(1);
  });
});
