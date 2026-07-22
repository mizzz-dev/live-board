import { describe, expect, it } from 'vitest';
import {
  parseBroadcastSnapshot,
  parseObsBridgeClientMessage,
  parseObsBridgeServerMessage,
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
  layers: [],
};

describe('OBS protocol', () => {
  it('有効なBroadcastSnapshotを検証する', () => {
    expect(parseBroadcastSnapshot(snapshot)).toEqual(snapshot);
  });

  it('不正revisionと未定義Layerを拒否する', () => {
    expect(() =>
      parseBroadcastSnapshot({ ...snapshot, revision: -1 }),
    ).toThrow('OBS_PROTOCOL_INVALID_SNAPSHOT');
    expect(() =>
      parseBroadcastSnapshot({ ...snapshot, layers: [{ type: 'unknown' }] }),
    ).toThrow('OBS_PROTOCOL_INVALID_SNAPSHOT');
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

  it('snapshotメッセージを検証する', () => {
    expect(
      parseObsBridgeServerMessage({ type: 'snapshot', snapshot }),
    ).toEqual({ type: 'snapshot', snapshot });
  });
});
