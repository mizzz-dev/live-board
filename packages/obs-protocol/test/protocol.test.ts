import { describe, expect, it } from 'vitest';
import {
  parseBroadcastSnapshot,
  parseObsBridgeClientMessage,
  parseObsBridgeServerMessage,
  parsePageTransition,
  type BroadcastSnapshot,
} from '../src/index.js';

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
      childLayerIds: ['text-1'],
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
  it('有効なLayer treeを含むBroadcastSnapshotを検証する', () => {
    expect(parseBroadcastSnapshot(snapshot)).toEqual(snapshot);
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
        ],
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER_TREE');
  });

  it('opacity・blend mode・色の境界を拒否する', () => {
    const textLayer = snapshot.layers[1]!;
    expect(() =>
      parseBroadcastSnapshot({
        ...snapshot,
        layers: [snapshot.layers[0], { ...textLayer, opacity: 1.1 }],
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER');
    expect(() =>
      parseBroadcastSnapshot({
        ...snapshot,
        layers: [
          snapshot.layers[0],
          { ...textLayer, blendMode: 'unsupported' },
        ],
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER');
    expect(() =>
      parseBroadcastSnapshot({
        ...snapshot,
        layers: [snapshot.layers[0], { ...textLayer, color: 'red' }],
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
