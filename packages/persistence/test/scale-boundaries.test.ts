import {
  createEmptyWorkspace,
  createPage,
} from '@live-board/domain';
import { describe, expect, it } from 'vitest';
import {
  createLiveboardArchive,
  createStoredZip,
  loadLiveboardArchive,
  readStoredZip,
} from '../src/index.js';

describe('persistence scale boundaries', () => {
  it('100 PageのWorkspaceを保存・再読込できる', () => {
    const workspace = createEmptyWorkspace('workspace-100-pages');
    const project = workspace.projects[0]!;
    const timestamp = '2026-07-23T00:00:00.000Z';

    for (let index = 2; index <= 100; index += 1) {
      project.pages.push(
        createPage({
          id: `page-${index}`,
          projectId: project.id,
          name: `ページ ${index}`,
          createdAt: timestamp,
        }),
      );
    }
    workspace.updatedAt = timestamp;
    project.updatedAt = timestamp;

    const archive = createLiveboardArchive({
      workspace,
      assetLibraries: {},
      savedAt: timestamp,
    });
    const loaded = loadLiveboardArchive(archive);

    expect(loaded.workspace.projects[0]!.pages).toHaveLength(100);
    expect(loaded.workspace).toEqual(workspace);
  });

  it('約500MBを宣言する単一エントリを実データ確保前に拒否する', () => {
    const archive = createStoredZip([
      {
        path: 'manifest.json',
        bytes: new TextEncoder().encode('{}'),
      },
    ]);
    const tampered = new Uint8Array(archive);
    const centralOffset = findSignature(tampered, [0x50, 0x4b, 0x01, 0x02]);
    const declaredBytes = 500 * 1024 * 1024;
    writeU32le(tampered, centralOffset + 20, declaredBytes);
    writeU32le(tampered, centralOffset + 24, declaredBytes);

    expect(() => readStoredZip(tampered)).toThrow('ZIPエントリが大きすぎます');
  });
});

function findSignature(bytes: Uint8Array, signature: readonly number[]): number {
  for (let offset = 0; offset <= bytes.length - signature.length; offset += 1) {
    if (signature.every((byte, index) => bytes[offset + index] === byte)) {
      return offset;
    }
  }
  throw new Error('ZIP signature not found');
}

function writeU32le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
  bytes[offset + 3] = value >>> 24;
}
