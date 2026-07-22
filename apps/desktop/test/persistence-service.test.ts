import { createStoredZip } from '@live-board/persistence/node';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspacePersistenceService } from '../electron/persistence-service.js';

const roots: string[] = [];
const manifestBytes = new TextEncoder().encode(
  JSON.stringify({ format: 'liveboard', schemaVersion: 1 }),
);
const archiveOne = createStoredZip([
  { path: 'manifest.json', bytes: manifestBytes },
  { path: 'assets/one.bin', bytes: new Uint8Array([1, 2, 3]) },
]);
const archiveTwo = createStoredZip([
  { path: 'manifest.json', bytes: manifestBytes },
  { path: 'assets/two.bin', bytes: new Uint8Array([4, 5, 6, 7]) },
]);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createService() {
  const root = await mkdtemp(join(tmpdir(), 'live-board-persistence-'));
  roots.push(root);
  const service = createWorkspacePersistenceService(root);
  await service.initialize();
  return { root, service };
}

describe('WorkspacePersistenceService', () => {
  it('明示保存を原子的に行い実パスをRenderer向け結果へ含めない', async () => {
    const { root, service } = await createService();
    const target = join(root, 'documents', 'workspace.liveboard');
    const saved = await service.saveDocument({
      workspaceId: 'workspace-1',
      revision: 1,
      archive: archiveOne,
      targetPath: target,
      savedAt: '2026-07-23T00:00:00.000Z',
    });
    expect(new Uint8Array(await readFile(target))).toEqual(archiveOne);
    expect(saved.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.document.displayName).toBe('workspace.liveboard');
    expect(JSON.stringify(saved.document)).not.toContain(target);

    const recent = await service.listRecentDocuments();
    expect(recent).toEqual([saved.document]);
  });

  it('documentIdで上書き保存しお気に入り順を保持する', async () => {
    const { root, service } = await createService();
    const first = await service.saveDocument({
      workspaceId: 'workspace-1',
      revision: 1,
      archive: archiveOne,
      targetPath: join(root, 'first.liveboard'),
    });
    const second = await service.saveDocument({
      workspaceId: 'workspace-2',
      revision: 1,
      archive: archiveOne,
      targetPath: join(root, 'second.liveboard'),
    });
    await service.setFavorite(first.document.documentId, true);
    const overwritten = await service.saveDocument({
      workspaceId: 'workspace-1',
      revision: 2,
      archive: archiveTwo,
      documentId: first.document.documentId,
    });
    expect(overwritten.document.documentId).toBe(first.document.documentId);
    expect(new Uint8Array(await readFile(join(root, 'first.liveboard')))).toEqual(archiveTwo);
    expect((await service.listRecentDocuments()).map((item) => item.documentId)).toEqual([
      first.document.documentId,
      second.document.documentId,
    ]);
  });

  it('保存途中を模したbackupだけの状態から正常ファイルを復元する', async () => {
    const { root, service } = await createService();
    const target = join(root, 'workspace.liveboard');
    await service.saveDocument({
      workspaceId: 'workspace-1',
      revision: 1,
      archive: archiveOne,
      targetPath: target,
    });
    await rename(target, `${target}.bak`);
    const restarted = createWorkspacePersistenceService(root);
    await restarted.initialize();
    expect(new Uint8Array(await readFile(target))).toEqual(archiveOne);
    await expect(stat(`${target}.bak`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('保存先エラー時に既存ファイルを失わない', async () => {
    const { root, service } = await createService();
    const target = join(root, 'workspace.liveboard');
    await service.saveDocument({
      workspaceId: 'workspace-1',
      revision: 1,
      archive: archiveOne,
      targetPath: target,
    });
    await expect(
      service.saveDocument({
        workspaceId: 'workspace-1',
        revision: 2,
        archive: archiveTwo,
        targetPath: join(target, 'child.liveboard'),
      }),
    ).rejects.toBeDefined();
    expect(new Uint8Array(await readFile(target))).toEqual(archiveOne);
  });

  it('操作・snapshotから復元候補を作成し破棄できる', async () => {
    const { service } = await createService();
    await service.appendOperation('workspace-1', 1);
    const created = await service.saveRecoverySnapshot('workspace-1', 1, archiveOne);
    await service.appendOperation('workspace-1', 2);
    const candidates = await service.listRecoveryCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      candidateId: created.candidateId,
      workspaceId: 'workspace-1',
      revision: 1,
      operationCountAfterSnapshot: 1,
    });
    expect(await service.loadRecoveryCandidate(created.candidateId)).toEqual(archiveOne);
    await service.discardRecoveryCandidate(created.candidateId, 2);
    expect(await service.listRecoveryCandidates()).toEqual([]);
  });

  it('明示保存済みrevisionを復元候補にしない', async () => {
    const { root, service } = await createService();
    await service.saveRecoverySnapshot('workspace-1', 1, archiveOne);
    await service.saveDocument({
      workspaceId: 'workspace-1',
      revision: 1,
      archive: archiveOne,
      targetPath: join(root, 'workspace.liveboard'),
    });
    expect(await service.listRecoveryCandidates()).toEqual([]);
  });

  it('不正ZIPを正式保存・復元領域へ反映しない', async () => {
    const { root, service } = await createService();
    const target = join(root, 'invalid.liveboard');
    const invalid = new Uint8Array(32);
    await expect(
      service.saveDocument({
        workspaceId: 'workspace-1',
        revision: 1,
        archive: invalid,
        targetPath: target,
      }),
    ).rejects.toBeDefined();
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await service.listRecoveryCandidates()).toEqual([]);
  });

  it('初期化時に必要ディレクトリを作成する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-board-empty-parent-'));
    roots.push(root);
    const nested = join(root, 'nested', 'persistence');
    await mkdir(join(root, 'nested'), { recursive: true });
    const service = createWorkspacePersistenceService(nested);
    await service.initialize();
    expect((await stat(join(nested, 'recovery'))).isDirectory()).toBe(true);
  });
});
