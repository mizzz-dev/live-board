import { describe, expect, it } from 'vitest';
import {
  MAX_IPC_ARCHIVE_BYTES,
  parseRecoveryCandidateRequest,
  parseRecoveryDiscardRequest,
  parseWorkspaceAutosaveRequest,
  parseWorkspaceSaveRequest,
  parseWorkspaceSetFavoriteRequest,
} from '../electron/contracts.js';

const archive = new Uint8Array(22).fill(1);

describe('persistence IPC contracts', () => {
  it('保存・自動保存入力をコピーして検証する', () => {
    const save = parseWorkspaceSaveRequest({
      requestId: 'request-1',
      workspaceId: 'workspace-1',
      revision: 3,
      archive,
      saveAs: false,
      documentId: 'a'.repeat(64),
    });
    expect(save).toMatchObject({
      requestId: 'request-1',
      workspaceId: 'workspace-1',
      revision: 3,
      saveAs: false,
      documentId: 'a'.repeat(64),
    });
    expect(save.archive).not.toBe(archive);
    expect(save.archive).toEqual(archive);

    const autosave = parseWorkspaceAutosaveRequest({
      requestId: 'request-2',
      workspaceId: 'workspace-1',
      revision: 4,
      archive,
    });
    expect(autosave.archive).toEqual(archive);
  });

  it('任意パス・不正ID・不正revisionを受理しない', () => {
    expect(() =>
      parseWorkspaceSaveRequest({
        requestId: 'request-1',
        workspaceId: 'workspace-1',
        revision: 1,
        archive,
        saveAs: true,
        path: '/tmp/evil.liveboard',
      }),
    ).not.toThrow();
    expect(() =>
      parseWorkspaceSaveRequest({
        requestId: 'request-1',
        workspaceId: '../workspace',
        revision: 1,
        archive,
        saveAs: true,
      }),
    ).toThrow('WORKSPACE_ID');
    expect(() =>
      parseWorkspaceSaveRequest({
        requestId: 'request-1',
        workspaceId: 'workspace-1',
        revision: -1,
        archive,
        saveAs: true,
      }),
    ).toThrow('REVISION');
    expect(() =>
      parseRecoveryCandidateRequest({
        requestId: 'request-1',
        candidateId: 'not-an-id',
      }),
    ).toThrow('CANDIDATE_ID');
  });

  it('archive型とサイズ上限を検証する', () => {
    expect(() =>
      parseWorkspaceAutosaveRequest({
        requestId: 'request-1',
        workspaceId: 'workspace-1',
        revision: 1,
        archive: Array.from(archive),
      }),
    ).toThrow('ARCHIVE');
    expect(() =>
      parseWorkspaceAutosaveRequest({
        requestId: 'request-1',
        workspaceId: 'workspace-1',
        revision: 1,
        archive: new Uint8Array(21),
      }),
    ).toThrow('ARCHIVE');
    expect(MAX_IPC_ARCHIVE_BYTES).toBe(512 * 1024 * 1024);
  });

  it('お気に入り・復元破棄入力を検証する', () => {
    expect(
      parseWorkspaceSetFavoriteRequest({
        requestId: 'request-1',
        documentId: 'b'.repeat(64),
        favorite: true,
      }),
    ).toMatchObject({ favorite: true });
    expect(
      parseRecoveryDiscardRequest({
        requestId: 'request-2',
        candidateId: 'c'.repeat(64),
        revision: 8,
      }),
    ).toMatchObject({ revision: 8 });
    expect(() =>
      parseWorkspaceSetFavoriteRequest({
        requestId: 'request-1',
        documentId: 'b'.repeat(64),
        favorite: 'yes',
      }),
    ).toThrow('FAVORITE');
  });
});
