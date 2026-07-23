import { describe, expect, it } from 'vitest';
import {
  parseBroadcastAssetDescriptor,
  parseBroadcastAssetRegistration,
  parseBroadcastSnapshotDescriptor,
  toBroadcastSnapshotDescriptor,
  type BroadcastSnapshot,
} from '../src/index-v4.js';

const bytes = new TextEncoder().encode('asset-bytes');
const descriptor = {
  id: 'asset:ipc',
  sha256: 'a'.repeat(64),
  mime: 'image/png' as const,
  width: 640,
  height: 360,
  byteLength: bytes.byteLength,
  animated: false as const,
  sanitized: false,
};

const inlineSnapshot: BroadcastSnapshot = {
  schemaVersion: 1,
  projectId: 'project-1',
  pageId: 'page-1',
  pageName: 'ページ 1',
  revision: 1,
  generatedAt: '2026-07-24T00:00:00.000Z',
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
  assets: [
    {
      ...descriptor,
      dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
    },
  ],
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
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      content: {
        assetId: descriptor.id,
        width: 640,
        height: 360,
        crop: { x: 0, y: 0, width: 640, height: 360 },
        flipX: false,
        flipY: false,
      },
    },
  ],
};

describe('IPC Asset DTO', () => {
  it('inline Snapshotからsourceなしdescriptor Snapshotを生成する', () => {
    const result = toBroadcastSnapshotDescriptor(inlineSnapshot);

    expect(result.assets).toEqual([descriptor]);
    expect(JSON.stringify(result)).not.toContain('data:image');
    expect(parseBroadcastSnapshotDescriptor(result)).toEqual(result);
  });

  it('Uint8Array登録DTOを複製して受け入れる', () => {
    const result = parseBroadcastAssetRegistration({ ...descriptor, bytes });

    expect(result).toEqual({ ...descriptor, bytes });
    expect(result.bytes).not.toBe(bytes);
  });

  it('descriptorへdataUrl・URL・deliveryを混入できない', () => {
    expect(() => parseBroadcastAssetDescriptor({
      ...descriptor,
      dataUrl: 'data:image/png;base64,AAAA',
    })).toThrow('OBS_PROTOCOL_INVALID_ASSET_DESCRIPTOR');
    expect(() => parseBroadcastAssetDescriptor({
      ...descriptor,
      delivery: 'http',
      url: `/asset/${'0'.repeat(64)}/${descriptor.sha256}`,
    })).toThrow('OBS_PROTOCOL_INVALID_ASSET_DESCRIPTOR');
  });

  it('byteLength不一致と不正bytesを拒否する', () => {
    expect(() => parseBroadcastAssetRegistration({
      ...descriptor,
      bytes: new Uint8Array(bytes.byteLength - 1),
    })).toThrow('OBS_PROTOCOL_INVALID_ASSET_REGISTRATION');
    expect(() => parseBroadcastAssetRegistration({
      ...descriptor,
      bytes: Array.from(bytes),
    })).toThrow('OBS_PROTOCOL_INVALID_ASSET_REGISTRATION');
  });

  it('存在しないAsset参照をdescriptor Snapshotでも拒否する', () => {
    const descriptorSnapshot = toBroadcastSnapshotDescriptor(inlineSnapshot);
    expect(() => parseBroadcastSnapshotDescriptor({
      ...descriptorSnapshot,
      assets: [],
    })).toThrow('OBS_PROTOCOL_INVALID_SNAPSHOT_DESCRIPTOR');
  });
});
