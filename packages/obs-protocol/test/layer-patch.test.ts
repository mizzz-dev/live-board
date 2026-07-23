import { describe, expect, it } from 'vitest';
import {
  applyBroadcastLayerPatch,
  createBroadcastLayerPatch,
  parseBroadcastLayerPatch,
  parseObsBridgeServerMessage,
  type BroadcastLayer,
  type BroadcastSnapshot,
} from '../src/protocol-v4.js';

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
  overrides: Partial<BroadcastSnapshot> = {},
): BroadcastSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision,
    generatedAt: `2026-07-23T00:00:0${Math.min(revision, 9)}.000Z`,
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

describe('BroadcastLayerPatch', () => {
  it('変更Layerだけをupsertし、未変更Layerをpayloadへ含めない', () => {
    const previous = snapshot(1, [textLayer('a', 'A'), textLayer('b', 'B')]);
    const next = snapshot(2, [textLayer('a', 'A2'), textLayer('b', 'B')]);
    const patch = createBroadcastLayerPatch(previous, next);

    expect(patch).not.toBeNull();
    expect(patch?.baseRevision).toBe(1);
    expect(patch?.revision).toBe(2);
    expect(patch?.upsertedLayers.map((layer) => layer.id)).toEqual(['a']);
    expect(patch?.removedLayerIds).toEqual([]);
    expect(patch?.layerOrder).toEqual(['a', 'b']);
    expect(applyBroadcastLayerPatch(previous, patch!)).toEqual(next);
  });

  it('Layer追加・削除・並び替えを適用する', () => {
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
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(patch.upsertedLayers.map((layer) => layer.id)).toEqual(['d']);
    expect(patch.removedLayerIds).toEqual(['b']);
    expect(patch.layerOrder).toEqual(['c', 'a', 'd']);
    expect(applyBroadcastLayerPatch(previous, patch)).toEqual(next);
  });

  it('Folder親子関係変更を完成Snapshotとして再検証する', () => {
    const child = textLayer('child', 'Child');
    const folder: BroadcastLayer = {
      id: 'folder',
      parentId: null,
      name: 'Folder',
      type: 'folder',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      color: null,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      childLayerIds: [],
    };
    const nextChild = { ...child, parentId: 'folder' };
    const nextFolder = { ...folder, childLayerIds: ['child'] };
    const previous = snapshot(1, [folder, child]);
    const next = snapshot(2, [nextFolder, nextChild]);

    expect(applyBroadcastLayerPatch(
      previous,
      createBroadcastLayerPatch(previous, next)!,
    )).toEqual(next);
  });

  it('Canvas・Overlay・Page metadata変更ではpatchを生成しない', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const changedLayer = textLayer('a', 'A2');
    expect(createBroadcastLayerPatch(previous, snapshot(2, [changedLayer], {
      pageName: '変更後',
    }))).toBeNull();
    expect(createBroadcastLayerPatch(previous, snapshot(2, [changedLayer], {
      canvas: { ...previous.canvas, width: 1280 },
    }))).toBeNull();
    expect(createBroadcastLayerPatch(previous, snapshot(2, [changedLayer], {
      overlay: { ...previous.overlay, theme: 'blackboard' },
    }))).toBeNull();
  });

  it('base revision・Page・Layer order不一致を拒否する', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const next = snapshot(2, [textLayer('a', 'A2')]);
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(() => applyBroadcastLayerPatch(snapshot(9, previous.layers), patch)).toThrow(
      'OBS_PROTOCOL_LAYER_PATCH_BASE_REVISION_MISMATCH',
    );
    expect(() => applyBroadcastLayerPatch(previous, {
      ...patch,
      pageId: 'page-2',
    })).toThrow('OBS_PROTOCOL_LAYER_PATCH_PAGE_MISMATCH');
    expect(() => applyBroadcastLayerPatch(previous, {
      ...patch,
      layerOrder: ['missing'],
    })).toThrow('OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH');
  });

  it('重複ID・upsertとremove重複・不正timestampをparserで拒否する', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const next = snapshot(2, [textLayer('a', 'A2')]);
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(() => parseBroadcastLayerPatch({
      ...patch,
      layerOrder: ['a', 'a'],
    })).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH');
    expect(() => parseBroadcastLayerPatch({
      ...patch,
      removedLayerIds: ['a'],
    })).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH');
    expect(() => parseBroadcastLayerPatch({
      ...patch,
      generatedAt: 'invalid',
    })).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH');
  });

  it('旧layer.updatedと新layer.patchの両方を受信できる', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const next = snapshot(2, [textLayer('a', 'A2')]);
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(parseObsBridgeServerMessage({
      type: 'layer.updated',
      snapshot: next,
    })).toEqual({ type: 'layer.updated', snapshot: next });
    expect(parseObsBridgeServerMessage({
      type: 'layer.patch',
      patch,
    })).toEqual({ type: 'layer.patch', patch });
  });
});
