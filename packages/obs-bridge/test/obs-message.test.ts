import { describe, expect, it } from 'vitest';
import {
  createSnapshotMessage,
  type BroadcastSnapshot,
} from '../src/index.js';

const baseSnapshot: BroadcastSnapshot = {
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

const transition = { type: 'fade', durationMs: 150 } as const;

describe('createSnapshotMessage', () => {
  it('初回とLayer以外の更新をsnapshotとして送る', () => {
    expect(createSnapshotMessage(undefined, baseSnapshot, transition)).toEqual({
      type: 'snapshot',
      snapshot: baseSnapshot,
    });

    const renamed = { ...baseSnapshot, pageName: '名称変更', revision: 2 };
    expect(createSnapshotMessage(baseSnapshot, renamed, transition)).toEqual({
      type: 'snapshot',
      snapshot: renamed,
    });
  });

  it('ページ変更をpage.changedとして送る', () => {
    const changed = {
      ...baseSnapshot,
      pageId: 'page-2',
      pageName: 'ページ 2',
      revision: 2,
    };
    expect(createSnapshotMessage(baseSnapshot, changed, transition)).toEqual({
      type: 'page.changed',
      snapshot: changed,
      transition,
    });
  });

  it('同一ページのLayer変更をlayer.updatedとして送る', () => {
    const updated = {
      ...baseSnapshot,
      revision: 2,
      layers: [
        {
          id: 'text-1',
          parentId: null,
          name: 'テキスト',
          type: 'text',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          color: null,
          content: {
            text: 'Live Board',
            fontFamily: 'sans-serif',
            fontSize: 32,
            color: '#FFFFFF',
          },
        },
      ],
    } satisfies BroadcastSnapshot;

    expect(createSnapshotMessage(baseSnapshot, updated, transition)).toEqual({
      type: 'layer.updated',
      snapshot: updated,
    });
  });
});
