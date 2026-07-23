import { describe, expect, it } from 'vitest';
import {
  applyBroadcastLayerPatch,
  createBroadcastLayerPatch,
  type BroadcastAsset,
  type BroadcastLayer,
  type BroadcastSnapshot,
} from '../src/protocol-v4.js';

const token = 'b'.repeat(64);
const assetHash = 'a'.repeat(64);
const httpAsset: BroadcastAsset = {
  id: 'asset:image',
  sha256: assetHash,
  mime: 'image/png',
  width: 640,
  height: 360,
  byteLength: 4,
  delivery: 'http',
  url: `/asset/${token}/${assetHash}`,
  animated: false,
  sanitized: false,
};

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

function imageLayer(): BroadcastLayer {
  return {
    id: 'image-1',
    parentId: null,
    name: '画像',
    type: 'image',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    color: null,
    transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 },
    content: {
      assetId: httpAsset.id,
      width: 640,
      height: 360,
      crop: { x: 0, y: 0, width: 640, height: 360 },
      flipX: false,
      flipY: false,
    },
  };
}

function snapshot(
  revision: number,
  layers: BroadcastLayer[],
  assets?: BroadcastAsset[],
): BroadcastSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision,
    generatedAt: `2026-07-23T00:00:0${revision}.000Z`,
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
    ...(assets === undefined ? {} : { assets }),
  };
}

describe('BroadcastLayerPatch Asset参照', () => {
  it('Image Layer追加時にHTTP Asset descriptorを含めて適用する', () => {
    const previous = snapshot(1, []);
    const next = snapshot(2, [imageLayer()], [httpAsset]);
    const patch = createBroadcastLayerPatch(previous, next);

    expect(patch).not.toBeNull();
    expect(patch?.assets).toEqual([httpAsset]);
    expect(patch?.upsertedLayers.map((layer) => layer.id)).toEqual(['image-1']);
    expect(applyBroadcastLayerPatch(previous, patch!)).toEqual(next);
  });

  it('Image Layer削除時にAsset descriptorも完成Snapshotから除去する', () => {
    const previous = snapshot(1, [imageLayer()], [httpAsset]);
    const next = snapshot(2, []);
    const patch = createBroadcastLayerPatch(previous, next);

    expect(patch).not.toBeNull();
    expect(patch?.assets).toBeUndefined();
    expect(patch?.removedLayerIds).toEqual(['image-1']);
    expect(applyBroadcastLayerPatch(previous, patch!)).toEqual(next);
  });

  it('Image Layerの参照Asset descriptorが欠けたpatchを拒否する', () => {
    const previous = snapshot(1, []);
    const next = snapshot(2, [imageLayer()], [httpAsset]);
    const patch = createBroadcastLayerPatch(previous, next)!;
    const { assets: _assets, ...patchWithoutAssets } = patch;

    expect(() => applyBroadcastLayerPatch(previous, patchWithoutAssets)).toThrow(
      'OBS_PROTOCOL_IMAGE_ASSET_NOT_FOUND',
    );
  });

  it('連続patchをbase revision順に適用して最新Snapshotへ収束する', () => {
    const revision1 = snapshot(1, [textLayer('text-1', 'A')]);
    const revision2 = snapshot(2, [textLayer('text-1', 'B')]);
    const revision3 = snapshot(3, [
      textLayer('text-1', 'C'),
      textLayer('text-2', '追加'),
    ]);

    const patch12 = createBroadcastLayerPatch(revision1, revision2)!;
    const patch23 = createBroadcastLayerPatch(revision2, revision3)!;
    const afterRevision2 = applyBroadcastLayerPatch(revision1, patch12);

    expect(afterRevision2).toEqual(revision2);
    expect(patch23.baseRevision).toBe(2);
    expect(applyBroadcastLayerPatch(afterRevision2, patch23)).toEqual(revision3);
  });

  it('revisionを飛ばすpatchはProtocolで再構築できるがbase revisionを保持する', () => {
    const revision1 = snapshot(1, [textLayer('text-1', 'A')]);
    const revision3 = snapshot(3, [textLayer('text-1', 'C')]);
    const patch = createBroadcastLayerPatch(revision1, revision3)!;

    expect(patch).toMatchObject({ baseRevision: 1, revision: 3 });
    expect(applyBroadcastLayerPatch(revision1, patch)).toEqual(revision3);
  });
});
