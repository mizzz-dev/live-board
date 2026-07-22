import { createEmptyWorkspace } from '@live-board/domain';
import { describe, expect, it } from 'vitest';
import {
  createRecoveryJournalEntry,
  createStoredZip,
  loadLiveboardArchive,
  parseRecoveryJournal,
  selectRecoveryCandidate,
  serializeRecoveryJournalEntry,
  verifyRecoverySnapshot,
} from '../src/index.js';

const timestamp = '2026-07-23T00:00:00.000Z';

describe('manifest migration', () => {
  it('schemaVersion 0を段階migrationして読み込む', () => {
    const workspace = createEmptyWorkspace('workspace-v0');
    const legacy = {
      schemaVersion: 0,
      appVersion: '0.0.9',
      savedAt: timestamp,
      workspace,
      assetLibraries: {},
    };
    const archive = createStoredZip([
      {
        path: 'manifest.json',
        bytes: new TextEncoder().encode(JSON.stringify(legacy)),
      },
    ]);
    const loaded = loadLiveboardArchive(archive);
    expect(loaded.migratedFromVersion).toBe(0);
    expect(loaded.workspace).toEqual(workspace);
  });

  it('未知schemaを拒否し入力バイト列を変更しない', () => {
    const source = createStoredZip([
      {
        path: 'manifest.json',
        bytes: new TextEncoder().encode(
          JSON.stringify({ schemaVersion: 999, workspace: {} }),
        ),
      },
    ]);
    const before = new Uint8Array(source);
    expect(() => loadLiveboardArchive(source)).toThrow('未対応');
    expect(source).toEqual(before);
  });
});

describe('recovery journal', () => {
  it('操作後の最新snapshotを復元候補として選択できる', () => {
    const snapshot = new Uint8Array([1, 2, 3, 4]);
    const entries = [
      createRecoveryJournalEntry({
        sequence: 1,
        workspaceId: 'workspace-1',
        revision: 1,
        kind: 'operation',
        occurredAt: timestamp,
      }),
      createRecoveryJournalEntry({
        sequence: 2,
        workspaceId: 'workspace-1',
        revision: 1,
        kind: 'snapshot',
        occurredAt: '2026-07-23T00:00:10.000Z',
        snapshot,
      }),
      createRecoveryJournalEntry({
        sequence: 3,
        workspaceId: 'workspace-1',
        revision: 2,
        kind: 'operation',
        occurredAt: '2026-07-23T00:00:11.000Z',
      }),
    ];
    const serialized = entries.map(serializeRecoveryJournalEntry).join('');
    const parsed = parseRecoveryJournal(serialized);
    const candidate = selectRecoveryCandidate(parsed);
    expect(candidate).toMatchObject({
      workspaceId: 'workspace-1',
      revision: 1,
      operationCountAfterSnapshot: 1,
    });
    expect(() => verifyRecoverySnapshot(candidate!, snapshot)).not.toThrow();
  });

  it('明示保存済みまたは破棄済みのsnapshotを復元候補にしない', () => {
    const snapshot = new Uint8Array([5, 6, 7]);
    const base = createRecoveryJournalEntry({
      sequence: 1,
      workspaceId: 'workspace-1',
      revision: 3,
      kind: 'snapshot',
      occurredAt: timestamp,
      snapshot,
    });
    const explicit = createRecoveryJournalEntry({
      sequence: 2,
      workspaceId: 'workspace-1',
      revision: 3,
      kind: 'explicit-save',
      occurredAt: '2026-07-23T00:01:00.000Z',
      snapshot,
    });
    expect(selectRecoveryCandidate([base, explicit])).toBeNull();

    const discard = createRecoveryJournalEntry({
      sequence: 3,
      workspaceId: 'workspace-1',
      revision: 4,
      kind: 'discard',
      occurredAt: '2026-07-23T00:02:00.000Z',
    });
    expect(selectRecoveryCandidate([base, discard])).toBeNull();
  });

  it('復元snapshotのサイズ・SHA改ざんを拒否する', () => {
    const snapshot = new Uint8Array([1, 2, 3]);
    const entry = createRecoveryJournalEntry({
      sequence: 1,
      workspaceId: 'workspace-1',
      revision: 1,
      kind: 'snapshot',
      occurredAt: timestamp,
      snapshot,
    });
    const candidate = selectRecoveryCandidate([entry])!;
    expect(() => verifyRecoverySnapshot(candidate, new Uint8Array([1, 2, 4]))).toThrow('HASH');
    expect(() => verifyRecoverySnapshot(candidate, new Uint8Array([1, 2]))).toThrow('SIZE');
  });
});
