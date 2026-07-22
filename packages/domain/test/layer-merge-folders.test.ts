import { describe, expect, it } from 'vitest';
import {
  addLayer,
  createEmptyLayerDocument,
  createLayer,
  mergeLayerSelection,
  type RasterLayer,
} from '../src/index.js';

const pageId = 'page-merge-folders';
const timestamp = '2026-07-22T00:00:00.000Z';

describe('mergeLayerSelection', () => {
  it('異なるフォルダーのLayerをルートへ結合する', () => {
    let document = createEmptyLayerDocument();
    for (const folderId of ['folder-a', 'folder-b']) {
      document = addLayer(
        document,
        createLayer({
          id: folderId,
          pageId,
          name: folderId,
          type: 'folder',
          createdAt: timestamp,
        }),
        null,
        document.rootLayerIds.length,
      );
    }
    document = addLayer(
      document,
      createLayer({
        id: 'layer-a',
        pageId,
        name: 'A',
        type: 'raster',
        createdAt: timestamp,
      }),
      'folder-a',
      0,
    );
    document = addLayer(
      document,
      createLayer({
        id: 'layer-b',
        pageId,
        name: 'B',
        type: 'text',
        createdAt: timestamp,
      }),
      'folder-b',
      0,
    );

    const mergedLayer = createLayer({
      id: 'merged-root',
      pageId,
      parentId: null,
      name: '表示レイヤーを結合',
      type: 'raster',
      createdAt: timestamp,
    }) as RasterLayer;
    const merged = mergeLayerSelection(
      document,
      pageId,
      ['layer-a', 'layer-b'],
      mergedLayer,
    );

    expect(merged.rootLayerIds).toEqual([
      'folder-a',
      'folder-b',
      'merged-root',
    ]);
    expect(
      merged.layers.find((layer) => layer.id === 'folder-a'),
    ).toMatchObject({ childLayerIds: [] });
    expect(
      merged.layers.find((layer) => layer.id === 'folder-b'),
    ).toMatchObject({ childLayerIds: [] });
    expect(merged.layers.find((layer) => layer.id === 'merged-root')).toMatchObject({
      parentId: null,
      content: { sourceLayerIds: ['layer-a', 'layer-b'] },
    });
  });
});
