import { describe, expect, it } from 'vitest';
import {
  applyBroadcastLayerPatchDescriptor,
  createBroadcastLayerPatchDescriptor,
  parseBroadcastLayerPatchDescriptor,
  type BroadcastLayer,
  type BroadcastSnapshotDescriptor,
} from '../src/index-v4.js';

function textLayer(id: string, text: string): BroadcastLayer {
  return {
    id,
    parentId: null,
    name: id,
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

function snapshot(
  revision: number,
  layers: BroadcastLayer[],
  overrides: Partial<BroadcastSnapshotDescriptor> = {},
): BroadcastSnapshotDescriptor {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision,
    generatedAt: `2026-07-24T00:00:0${Math.min(revision, 9)}.000Z`,
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

describe('IPC Layer Patch Descriptor', () => {
  it('変更Layerだけをsourceなしpatchへ変換して適用する', () => {
    const previous = snapshot(1, [textLayer('a', 'A'), textLayer('b', 'B')]);
    const next = snapshot(2, [textLayer('a', 'A2'), textLayer('b', 'B')]);
    const patch = createBroadcastLayerPatchDescriptor(previous, next);

    expect(patch).not.toBeNull();
    expect(patch?.upsertedLayers.map((layer) => layer.id)).toEqual(['a']);
    expect(patch?.removedLayerIds).toEqual([]);
    expect(applyBroadcastLayerPatchDescriptor(previous, patch!)).toEqual(next);
  });

  it('Layer追加・削除・並び替えを完成Snapshotへ復元する', () => {
    const previous = snapshot(1, [
      textLayer('a', 'A'),
      textLayer('b', 'B'),
      textLayer('c', 'C'),
    ]);
    const next = snapshot(2, [
      textLayer('c', 'C'),
      textLayer('a', 'A'),
      textLayer('d', 'D'),
    ]);
    const patch = createBroadcastLayerPatchDescriptor(previous, next)!;

    expect(patch.upsertedLayers.map((layer) => layer.id)).toEqual(['d']);
    expect(patch.removedLayerIds).toEqual(['b']);
    expect(patch.layerOrder).toEqual(['c', 'a', 'd']);
    expect(applyBroadcastLayerPatchDescriptor(previous, patch)).toEqual(next);
  });

  it('Page・Canvas・Overlay設定変更ではpatchを生成しない', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const changed = textLayer('a', 'A2');

    expect(createBroadcastLayerPatchDescriptor(previous, snapshot(2, [changed], {
      pageId: 'page-2',
    }))).toBeNull();
    expect(createBroadcastLayerPatchDescriptor(previous, snapshot(2, [changed], {
      canvas: { ...previous.canvas, width: 1280 },
    }))).toBeNull();
    expect(createBroadcastLayerPatchDescriptor(previous, snapshot(2, [changed], {
      overlay: { ...previous.overlay, theme: 'blackboard' },
    }))).toBeNull();
  });

  it('Asset descriptorへsourceを混入できない', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const patch = createBroadcastLayerPatchDescriptor(
      previous,
      snapshot(2, [textLayer('a', 'A2')]),
    )!;

    expect(() => parseBroadcastLayerPatchDescriptor({
      ...patch,
      assets: [{
        id: 'asset:bad',
        sha256: 'a'.repeat(64),
        mime: 'image/png',
        width: 1,
        height: 1,
        byteLength: 1,
        animated: false,
        sanitized: false,
        dataUrl: 'data:image/png;base64,AA==',
      }],
    })).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH_DESCRIPTOR');
  });

  it('base revisionとLayer order不一致を拒否する', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const patch = createBroadcastLayerPatchDescriptor(
      previous,
      snapshot(2, [textLayer('a', 'A2')]),
    )!;

    expect(() => applyBroadcastLayerPatchDescriptor(snapshot(9, previous.layers), patch))
      .toThrow('OBS_PROTOCOL_LAYER_PATCH_BASE_REVISION_MISMATCH');
    expect(() => applyBroadcastLayerPatchDescriptor(previous, {
      ...patch,
      layerOrder: ['missing'],
    })).toThrow('OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH');
  });
});
