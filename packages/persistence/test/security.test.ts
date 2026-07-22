import {
  createEmptyWorkspace,
  createProjectAssetLibrary,
  importProjectAsset,
  type ProjectAssetLibrary,
} from '@live-board/domain';
import { describe, expect, it } from 'vitest';
import {
  createLiveboardArchive,
  createStoredZip,
  loadLiveboardArchive,
  readStoredZip,
} from '../src/index.js';

const savedAt = '2026-07-23T00:00:00.000Z';

describe('archive security boundary', () => {
  it('Zip Slipパスを生成時と読込時の両方で拒否する', () => {
    expect(() =>
      createStoredZip([{ path: '../evil.txt', bytes: new Uint8Array([1]) }]),
    ).toThrow('安全でないZIPパス');

    const safe = createStoredZip([
      { path: 'safe/path.txt', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const tampered = replaceAscii(safe, 'safe/path.txt', '../evilly.txt');
    expect(() => readStoredZip(tampered)).toThrow('安全でないZIPパス');
  });

  it('symlinkエントリを拒否する', () => {
    const archive = createStoredZip([
      { path: 'safe.txt', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const central = findSignature(archive, [0x50, 0x4b, 0x01, 0x02]);
    const tampered = new Uint8Array(archive);
    writeU32le(tampered, central + 38, (0o120777 << 16) >>> 0);
    expect(() => readStoredZip(tampered)).toThrow('symlink');
  });

  it('圧縮・暗号化・data descriptor付きZIPを拒否する', () => {
    const archive = createStoredZip([
      { path: 'safe.txt', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const local = findSignature(archive, [0x50, 0x4b, 0x03, 0x04]);
    const central = findSignature(archive, [0x50, 0x4b, 0x01, 0x02]);

    const compressed = new Uint8Array(archive);
    writeU16le(compressed, local + 8, 8);
    writeU16le(compressed, central + 10, 8);
    expect(() => readStoredZip(compressed)).toThrow('非圧縮ZIP');

    const encrypted = new Uint8Array(archive);
    writeU16le(encrypted, local + 6, 0x0801);
    writeU16le(encrypted, central + 8, 0x0801);
    expect(() => readStoredZip(encrypted)).toThrow('暗号化ZIP');

    const descriptor = new Uint8Array(archive);
    writeU16le(descriptor, local + 6, 0x0808);
    writeU16le(descriptor, central + 8, 0x0808);
    expect(() => readStoredZip(descriptor)).toThrow('data descriptor');
  });

  it('CRC改ざんと過剰エントリを拒否する', () => {
    const archive = createStoredZip([
      { path: 'one.txt', bytes: new Uint8Array([1, 2, 3]) },
      { path: 'two.txt', bytes: new Uint8Array([4, 5, 6]) },
    ]);
    const local = findSignature(archive, [0x50, 0x4b, 0x03, 0x04]);
    const nameLength = readU16le(archive, local + 26);
    const extraLength = readU16le(archive, local + 28);
    const tampered = new Uint8Array(archive);
    tampered[local + 30 + nameLength + extraLength] ^= 0xff;
    expect(() => readStoredZip(tampered)).toThrow('CRC');

    expect(() =>
      readStoredZip(archive, {
        maxArchiveBytes: 1024 * 1024,
        maxEntries: 1,
        maxEntryBytes: 1024,
        maxTotalUncompressedBytes: 1024,
        maxCompressionRatio: 2,
      }),
    ).toThrow('エントリ数');
  });

  it('Asset改ざんと未参照エントリを正式データへ反映しない', () => {
    const workspace = createEmptyWorkspace('workspace-security');
    const project = workspace.projects[0]!;
    const imported = importProjectAsset(createProjectAssetLibrary(), {
      fileName: 'asset.svg',
      declaredMime: 'image/svg+xml',
      createdAt: savedAt,
      bytes: new TextEncoder().encode(
        '<svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>',
      ),
    });
    const libraries: Record<string, ProjectAssetLibrary> = {
      [project.id]: imported.library,
    };
    const archive = createLiveboardArchive({
      workspace,
      assetLibraries: libraries,
      savedAt,
    });
    const entries = readStoredZip(archive);
    const assetPath = [...entries.keys()].find((path) => path.startsWith('assets/'))!;
    const changedAsset = new Uint8Array(entries.get(assetPath)!);
    changedAsset[changedAsset.length - 2] ^= 1;
    const hashMismatch = createStoredZip([
      { path: 'manifest.json', bytes: entries.get('manifest.json')! },
      { path: assetPath, bytes: changedAsset },
    ]);
    expect(() => loadLiveboardArchive(hashMismatch)).toThrow('SHA-256');

    const orphan = createStoredZip([
      ...[...entries].map(([path, bytes]) => ({ path, bytes })),
      { path: 'assets/orphan.bin', bytes: new Uint8Array([1]) },
    ]);
    expect(() => loadLiveboardArchive(orphan)).toThrow('未参照エントリ');
  });
});

function replaceAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  expect(to.length).toBe(from.length);
  const result = new Uint8Array(bytes);
  const fromBytes = new TextEncoder().encode(from);
  const toBytes = new TextEncoder().encode(to);
  let replacements = 0;
  for (let offset = 0; offset <= result.length - fromBytes.length; offset += 1) {
    if (fromBytes.every((byte, index) => result[offset + index] === byte)) {
      result.set(toBytes, offset);
      replacements += 1;
    }
  }
  expect(replacements).toBe(2);
  return result;
}

function findSignature(bytes: Uint8Array, signature: readonly number[]): number {
  for (let offset = 0; offset <= bytes.length - signature.length; offset += 1) {
    if (signature.every((byte, index) => bytes[offset + index] === byte)) return offset;
  }
  throw new Error('signature not found');
}

function readU16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function writeU16le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
}

function writeU32le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
  bytes[offset + 3] = value >>> 24;
}
