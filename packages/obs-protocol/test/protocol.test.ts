import { describe, expect, it } from 'vitest';
import {
  parseBroadcastSnapshot,
  parseObsBridgeClientMessage,
  parseObsBridgeServerMessage,
  parsePageTransition,
  parseRasterDrawing,
  type BroadcastSnapshot,
} from '../src/protocol-v3.js';

const identityTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
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
  layers: [
    {
      id: 'folder-1',
      parentId: null,
      name: 'フォルダー',
      type: 'folder',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      color: null,
      transform: identityTransform,
      childLayerIds: ['raster-1', 'text-1'],
    },
    {
      id: 'raster-1',
      parentId: 'folder-1',
      name: '描画',
      type: 'raster',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      color: null,
      transform: { ...identityTransform, x: 20, rotation: 5 },
      content: {
        assetId: null,
        sourceLayerIds: [],
        drawing: {
          revision: 2,
          strokes: [
            {
              id: 'stroke-1',
              sequence: 1,
              tool: 'pen',
              pointerType: 'pen',
              color: '#FF3366',
              size: 24,
              opacity: 0.8,
              hardness: 0.7,
              spacing: 0.2,
              smoothing: 0.4,
              taperStart: 0.1,
              taperEnd: 0.2,
              pressureSize: true,
              pressureOpacity: true,
              points: [
                {
                  x: 10,
                  y: 20,
                  pressure: 0,
                  tiltX: -30,
                  tiltY: 15,
                  timestamp: 1,
                },
                {
                  x: 30,
                  y: 40,
                  pressure: 1,
                  tiltX: 30,
                  tiltY: -15,
                  timestamp: 2,
                },
              ],
            },
          ],
          fills: [
            {
              id: 'fill-1',
              sequence: 2,
              x: 100,
              y: 200,
              color: '#00AAFFFF',
              opacity: 0.5,
              tolerance: 32,
            },
          ],
        },
      },
    },
    {
      id: 'text-1',
      parentId: 'folder-1',
      name: 'テキスト',
      type: 'text',
      visible: true,
      opacity: 0.8,
      blendMode: 'overlay',
      color: '#FF00FF',
      transform: identityTransform,
      content: {
        text: 'Live Board',
        fontFamily: 'sans-serif',
        fontSize: 32,
        color: '#FFFFFF',
      },
    },
  ],
};

describe('OBS protocol', () => {
  it('描画Layer treeを含むBroadcastSnapshotを検証する', () => {
    expect(parseBroadcastSnapshot(snapshot)).toEqual(snapshot);
  });

  it('pressure・tilt・Fill tolerance・操作順序の境界を検証する', () => {
    const raster = snapshot.layers[1];
    expect(raster?.type).toBe('raster');
    if (raster?.type !== 'raster') throw new Error('Raster fixture missing');
    expect(parseRasterDrawing(raster.content.drawing)).toEqual(
      raster.content.drawing,
    );
    const invalidPressure = structuredClone(raster.content.drawing);
    invalidPressure.strokes[0]!.points[0]!.pressure = 1.1;
    expect(() => parseRasterDrawing(invalidPressure)).toThrow(
      'OBS_PROTOCOL_INVALID_RASTER_POINT',
    );
    const invalidTolerance = structuredClone(raster.content.drawing);
    invalidTolerance.fills[0]!.tolerance = 256;
    expect(() => parseRasterDrawing(invalidTolerance)).toThrow(
      'OBS_PROTOCOL_INVALID_RASTER_FILL',
    );
    const invalidSequence = structuredClone(raster.content.drawing);
    invalidSequence.strokes[0]!.sequence = 0;
    expect(() => parseRasterDrawing(invalidSequence)).toThrow(
      'OBS_PROTOCOL_INVALID_RASTER_SEQUENCE',
    );
  });

  it('旧Layer snapshotへtransformと空のdrawingを補完する', () => {
    const legacy = {
      ...snapshot,
      layers: [
        {
          id: 'raster-legacy',
          parentId: null,
          name: '旧ラスター',
          type: 'raster',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          color: null,
          content: { assetId: null, sourceLayerIds: [] },
        },
      ],
    };
    expect(parseBroadcastSnapshot(legacy).layers[0]).toMatchObject({
      transform: identityTransform,
      content: { drawing: { revision: 0, strokes: [], fills: [] } },
    });
  });

  it('不正revision・未知Layer・壊れた親子関係を拒否する', () => {
    expect(() =>
      parseBroadcastSnapshot({ ...snapshot, revision: -1 }),
    ).toThrow('OBS_PROTOCOL_INVALID_SNAPSHOT');
    expect(() =>
      parseBroadcastSnapshot({ ...snapshot, layers: [{ type: 'unknown' }] }),
    ).toThrow(/OBS_PROTOCOL_INVALID_LAYER/);
    expect(() =>
      parseBroadcastSnapshot({
        ...snapshot,
        layers: [
          snapshot.layers[0],
          { ...snapshot.layers[1], parentId: null },
          snapshot.layers[2],
        ],
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER_TREE');
  });

  it('opacity・blend mode・色の境界を拒否する', () => {
    const textLayer = snapshot.layers[2]!;
    expect(() =>
      parseBroadcastSnapshot({
        ...snapshot,
        layers: [
          snapshot.layers[0],
          snapshot.layers[1],
          { ...textLayer, opacity: 1.1 },
        ],
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER');
    expect(() =>
      parseBroadcastSnapshot({
        ...snapshot,
        layers: [
          snapshot.layers[0],
          snapshot.layers[1],
          { ...textLayer, blendMode: 'unsupported' },
        ],
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER');
  });

  it('即時・フェード遷移を検証する', () => {
    expect(parsePageTransition({ type: 'none', durationMs: 0 })).toEqual({
      type: 'none',
      durationMs: 0,
    });
    expect(parsePageTransition({ type: 'fade', durationMs: 150 })).toEqual({
      type: 'fade',
      durationMs: 150,
    });
    expect(() =>
      parsePageTransition({ type: 'fade', durationMs: 10 }),
    ).toThrow('OBS_PROTOCOL_INVALID_PAGE_TRANSITION');
  });

  it('pingとsnapshot要求を検証する', () => {
    expect(
      parseObsBridgeClientMessage({ type: 'ping', timestamp: 10 }),
    ).toEqual({ type: 'ping', timestamp: 10 });
    expect(
      parseObsBridgeClientMessage({
        type: 'snapshot.request',
        lastRevision: 3,
      }),
    ).toEqual({ type: 'snapshot.request', lastRevision: 3 });
  });

  it('snapshot・page.changed・layer.updatedを検証する', () => {
    expect(
      parseObsBridgeServerMessage({ type: 'snapshot', snapshot }),
    ).toEqual({ type: 'snapshot', snapshot });
    expect(
      parseObsBridgeServerMessage({
        type: 'page.changed',
        snapshot,
        transition: { type: 'fade', durationMs: 150 },
      }),
    ).toEqual({
      type: 'page.changed',
      snapshot,
      transition: { type: 'fade', durationMs: 150 },
    });
    expect(
      parseObsBridgeServerMessage({ type: 'layer.updated', snapshot }),
    ).toEqual({ type: 'layer.updated', snapshot });
  });
});
