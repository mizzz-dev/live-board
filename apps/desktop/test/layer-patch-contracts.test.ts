import { describe, expect, it } from 'vitest';
import { parsePublishBroadcastLayerPatchRequest } from '../electron/contracts.js';

const patch = {
  projectId: 'project-1',
  pageId: 'page-1',
  baseRevision: 1,
  revision: 2,
  generatedAt: '2026-07-24T00:00:02.000Z',
  upsertedLayers: [
    {
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
        text: '更新',
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
    },
  ],
  removedLayerIds: [],
  layerOrder: ['layer-1'],
};

describe('Layer patch IPC contract', () => {
  it('sourceなしLayer patch要求を検証する', () => {
    expect(
      parsePublishBroadcastLayerPatchRequest({
        requestId: 'patch_1',
        patch,
      }),
    ).toEqual({ requestId: 'patch_1', patch });
  });

  it('Asset descriptorへのdata URL混入を拒否する', () => {
    expect(() =>
      parsePublishBroadcastLayerPatchRequest({
        requestId: 'patch_1',
        patch: {
          ...patch,
          assets: [
            {
              id: 'asset:bad',
              sha256: 'a'.repeat(64),
              mime: 'image/png',
              width: 1,
              height: 1,
              byteLength: 1,
              animated: false,
              sanitized: false,
              dataUrl: 'data:image/png;base64,AA==',
            },
          ],
        },
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH_DESCRIPTOR');
  });

  it('不正request IDとrevision逆転を拒否する', () => {
    expect(() =>
      parsePublishBroadcastLayerPatchRequest({
        requestId: '../patch',
        patch,
      }),
    ).toThrow('IPC_INVALID_REQUEST_ID');
    expect(() =>
      parsePublishBroadcastLayerPatchRequest({
        requestId: 'patch_1',
        patch: { ...patch, revision: 1 },
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH_DESCRIPTOR');
  });
});
