import { describe, expect, it } from 'vitest';
import { listRasterOperations } from '../src/index.js';
import type { BroadcastRasterLayer } from '@live-board/obs-protocol';

const baseLayer: BroadcastRasterLayer = {
  id: 'raster-order',
  parentId: null,
  name: '操作順序',
  type: 'raster',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  color: null,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  content: {
    assetId: null,
    sourceLayerIds: [],
    drawing: {
      revision: 3,
      strokes: [
        {
          id: 'stroke-1',
          sequence: 1,
          tool: 'pen',
          pointerType: 'mouse',
          color: '#FF0000',
          size: 10,
          opacity: 1,
          hardness: 1,
          spacing: 0.1,
          smoothing: 0,
          taperStart: 0,
          taperEnd: 0,
          pressureSize: false,
          pressureOpacity: false,
          points: [
            {
              x: 0,
              y: 0,
              pressure: 0.5,
              tiltX: 0,
              tiltY: 0,
              timestamp: 1,
            },
          ],
        },
        {
          id: 'stroke-2',
          sequence: 3,
          tool: 'eraser',
          pointerType: 'pen',
          color: '#000000',
          size: 5,
          opacity: 1,
          hardness: 1,
          spacing: 0.1,
          smoothing: 0,
          taperStart: 0,
          taperEnd: 0,
          pressureSize: true,
          pressureOpacity: false,
          points: [
            {
              x: 1,
              y: 1,
              pressure: 1,
              tiltX: 0,
              tiltY: 0,
              timestamp: 3,
            },
          ],
        },
      ],
      fills: [
        {
          id: 'fill-1',
          sequence: 2,
          x: 10,
          y: 10,
          color: '#00FF00',
          opacity: 1,
          tolerance: 0,
        },
      ],
    },
  },
};

describe('Raster operation order', () => {
  it('sequenceに従ってStroke・Fillを混在順で返す', () => {
    expect(
      listRasterOperations(baseLayer).map((operation) => operation.value.id),
    ).toEqual(['stroke-1', 'fill-1', 'stroke-2']);
  });

  it('旧データはStroke群の後にFill群を再生する', () => {
    const legacy = structuredClone(baseLayer);
    for (const stroke of legacy.content.drawing.strokes) {
      delete stroke.sequence;
    }
    for (const fill of legacy.content.drawing.fills) {
      delete fill.sequence;
    }
    expect(
      listRasterOperations(legacy).map((operation) => operation.value.id),
    ).toEqual(['stroke-1', 'stroke-2', 'fill-1']);
  });
});
