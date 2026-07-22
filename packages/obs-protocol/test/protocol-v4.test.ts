import { describe, expect, it } from 'vitest';
import {
  parseBroadcastAsset,
  parseBroadcastSnapshot,
  type BroadcastSnapshot,
} from '../src/protocol-v4.js';

const asset = {
  id: 'asset:abc',
  sha256: 'a'.repeat(64),
  mime: 'image/png' as const,
  width: 640,
  height: 360,
  byteLength: 4,
  dataUrl: 'data:image/png;base64,iVBORw==',
  animated: false as const,
  sanitized: false,
};

const snapshot: BroadcastSnapshot = {
  schemaVersion: 1,
  projectId: 'project-1',
  pageId: 'page-1',
  pageName: 'ページ 1',
  revision: 1,
  generatedAt: '2026-07-22T00:00:00.000Z',
  canvas: {
    width: 1920,
    height: 1080,
    dpi: 72,
    background: { type: 'transparent' },
  },
  assets: [asset],
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
      transform: { x: 100, y: 120, scaleX: 1, scaleY: 1, rotation: 15 },
      content: {
        assetId: asset.id,
        width: 640,
        height: 360,
        crop: { x: 10, y: 20, width: 600, height: 300 },
        flipX: true,
        flipY: false,
      },
    },
    {
      id: 'text-1',
      parentId: null,
      name: '文字',
      type: 'text',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      color: null,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      content: {
        text: 'Live Board',
        fontFamily: 'sans-serif',
        fontSize: 48,
        color: '#FFFFFF',
        fontWeight: 700,
        fontStyle: 'italic',
        align: 'center',
        lineHeight: 1.2,
        strokeColor: '#000000',
        strokeWidth: 2,
        shadowColor: '#00000080',
        shadowBlur: 8,
        shadowOffsetX: 4,
        shadowOffsetY: 4,
        maxWidth: 500,
      },
    },
    {
      id: 'shape-1',
      parentId: null,
      name: '図形',
      type: 'shape',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      color: null,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      content: {
        shape: 'rectangle',
        fill: '#336699',
        stroke: '#FFFFFF',
        strokeWidth: 4,
        width: 320,
        height: 180,
        cornerRadius: 24,
      },
    },
  ],
};

describe('OBS protocol v4', () => {
  it('参照Assetと詳細な画像・文字・図形を検証する', () => {
    expect(parseBroadcastSnapshot(snapshot)).toEqual(snapshot);
  });

  it('存在しないAsset参照を拒否する', () => {
    expect(() => parseBroadcastSnapshot({
      ...snapshot,
      assets: [],
    })).toThrow('OBS_PROTOCOL_IMAGE_ASSET_NOT_FOUND');
  });

  it('crop境界外を拒否する', () => {
    const image = snapshot.layers[0]!;
    expect(() => parseBroadcastSnapshot({
      ...snapshot,
      layers: [
        {
          ...image,
          content: {
            ...image.content,
            crop: { x: 600, y: 0, width: 100, height: 100 },
          },
        },
      ],
    })).toThrow(/CROP|LAYER/);
  });

  it('SVG Assetはサニタイズ済みのみ受け入れる', () => {
    expect(() => parseBroadcastAsset({
      ...asset,
      mime: 'image/svg+xml',
      dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      sanitized: false,
    })).toThrow('OBS_PROTOCOL_INVALID_ASSET');
  });

  it('旧Text・Image・Shapeには安全な既定値を補完する', () => {
    const legacy = {
      ...snapshot,
      assets: [asset],
      layers: snapshot.layers.map((layer) => {
        if (layer.type === 'text') {
          const { fontWeight: _fontWeight, fontStyle: _fontStyle, align: _align, lineHeight: _lineHeight, strokeColor: _strokeColor, strokeWidth: _strokeWidth, shadowColor: _shadowColor, shadowBlur: _shadowBlur, shadowOffsetX: _shadowOffsetX, shadowOffsetY: _shadowOffsetY, maxWidth: _maxWidth, ...content } = layer.content;
          return { ...layer, content };
        }
        if (layer.type === 'image') {
          const { crop: _crop, flipX: _flipX, flipY: _flipY, ...content } = layer.content;
          return { ...layer, content };
        }
        if (layer.type === 'shape') {
          const { width: _width, height: _height, cornerRadius: _cornerRadius, ...content } = layer.content;
          return { ...layer, content };
        }
        return layer;
      }),
    };
    const parsed = parseBroadcastSnapshot(legacy);
    expect(parsed.layers.find((layer) => layer.type === 'text')?.content).toMatchObject({
      fontWeight: 400,
      fontStyle: 'normal',
      align: 'left',
    });
    expect(parsed.layers.find((layer) => layer.type === 'image')?.content).toMatchObject({
      crop: { x: 0, y: 0, width: 640, height: 360 },
      flipX: false,
      flipY: false,
    });
  });
});
