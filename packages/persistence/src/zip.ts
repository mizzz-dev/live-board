import { crc32 } from './hash.js';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const ZIP_VERSION = 20;
const UNIX_REGULAR_FILE_MODE = 0o100644;

export const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 4_096,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 20,
});

export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
}

export interface ZipEntryInput {
  path: string;
  bytes: Uint8Array;
}

export type ZipEntries = ReadonlyMap<string, Uint8Array>;

export type ArchiveErrorCode =
  | 'ARCHIVE_TOO_LARGE'
  | 'ARCHIVE_INVALID_ZIP'
  | 'ARCHIVE_MULTI_DISK_UNSUPPORTED'
  | 'ARCHIVE_ENTRY_LIMIT_EXCEEDED'
  | 'ARCHIVE_ENTRY_TOO_LARGE'
  | 'ARCHIVE_TOTAL_SIZE_EXCEEDED'
  | 'ARCHIVE_COMPRESSION_UNSUPPORTED'
  | 'ARCHIVE_COMPRESSION_RATIO_EXCEEDED'
  | 'ARCHIVE_ENCRYPTION_UNSUPPORTED'
  | 'ARCHIVE_DATA_DESCRIPTOR_UNSUPPORTED'
  | 'ARCHIVE_PATH_INVALID'
  | 'ARCHIVE_DUPLICATE_PATH'
  | 'ARCHIVE_SYMLINK_FORBIDDEN'
  | 'ARCHIVE_DIRECTORY_FORBIDDEN'
  | 'ARCHIVE_CRC_MISMATCH';

export class ArchiveValidationError extends Error {
  readonly code: ArchiveErrorCode;

  constructor(code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = 'ArchiveValidationError';
    this.code = code;
  }
}

export function createStoredZip(
  inputs: readonly ZipEntryInput[],
  timestamp = new Date(),
): Uint8Array {
  const limits = DEFAULT_ARCHIVE_LIMITS;
  if (inputs.length < 1 || inputs.length > Math.min(0xffff, limits.maxEntries)) {
    throw archiveError(
      'ARCHIVE_ENTRY_LIMIT_EXCEEDED',
      `ZIPエントリ数が上限を超えています: ${inputs.length}`,
    );
  }

  const seen = new Set<string>();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const centralRecords: Array<{
    pathBytes: Uint8Array;
    crc: number;
    size: number;
    localOffset: number;
  }> = [];
  const dos = toDosDateTime(timestamp);
  let localOffset = 0;
  let totalUncompressed = 0;

  for (const input of inputs) {
    assertSafeArchivePath(input.path);
    if (seen.has(input.path)) {
      throw archiveError('ARCHIVE_DUPLICATE_PATH', `ZIP内のパスが重複しています: ${input.path}`);
    }
    seen.add(input.path);
    if (input.bytes.byteLength > limits.maxEntryBytes || input.bytes.byteLength > 0xffff_ffff) {
      throw archiveError('ARCHIVE_ENTRY_TOO_LARGE', `ZIPエントリが大きすぎます: ${input.path}`);
    }
    totalUncompressed += input.bytes.byteLength;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      throw archiveError('ARCHIVE_TOTAL_SIZE_EXCEEDED', 'ZIP展開後サイズが上限を超えています');
    }

    const pathBytes = encodeUtf8(input.path);
    if (pathBytes.byteLength > 0xffff) {
      throw archiveError('ARCHIVE_PATH_INVALID', `ZIPパスが長すぎます: ${input.path}`);
    }
    const crc = crc32(input.bytes);
    const header = new Uint8Array(30 + pathBytes.byteLength);
    writeU32le(header, 0, LOCAL_FILE_HEADER_SIGNATURE);
    writeU16le(header, 4, ZIP_VERSION);
    writeU16le(header, 6, UTF8_FLAG);
    writeU16le(header, 8, STORE_METHOD);
    writeU16le(header, 10, dos.time);
    writeU16le(header, 12, dos.date);
    writeU32le(header, 14, crc);
    writeU32le(header, 18, input.bytes.byteLength);
    writeU32le(header, 22, input.bytes.byteLength);
    writeU16le(header, 26, pathBytes.byteLength);
    writeU16le(header, 28, 0);
    header.set(pathBytes, 30);

    centralRecords.push({
      pathBytes,
      crc,
      size: input.bytes.byteLength,
      localOffset,
    });
    localChunks.push(header, new Uint8Array(input.bytes));
    localOffset += header.byteLength + input.bytes.byteLength;
  }

  const centralOffset = localOffset;
  let centralSize = 0;
  for (const record of centralRecords) {
    const header = new Uint8Array(46 + record.pathBytes.byteLength);
    writeU32le(header, 0, CENTRAL_DIRECTORY_SIGNATURE);
    writeU16le(header, 4, 0x0314);
    writeU16le(header, 6, ZIP_VERSION);
    writeU16le(header, 8, UTF8_FLAG);
    writeU16le(header, 10, STORE_METHOD);
    writeU16le(header, 12, dos.time);
    writeU16le(header, 14, dos.date);
    writeU32le(header, 16, record.crc);
    writeU32le(header, 20, record.size);
    writeU32le(header, 24, record.size);
    writeU16le(header, 28, record.pathBytes.byteLength);
    writeU16le(header, 30, 0);
    writeU16le(header, 32, 0);
    writeU16le(header, 34, 0);
    writeU16le(header, 36, 0);
    writeU32le(header, 38, (UNIX_REGULAR_FILE_MODE << 16) >>> 0);
    writeU32le(header, 42, record.localOffset);
    header.set(record.pathBytes, 46);
    centralChunks.push(header);
    centralSize += header.byteLength;
  }

  const eocd = new Uint8Array(22);
  writeU32le(eocd, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeU16le(eocd, 4, 0);
  writeU16le(eocd, 6, 0);
  writeU16le(eocd, 8, centralRecords.length);
  writeU16le(eocd, 10, centralRecords.length);
  writeU32le(eocd, 12, centralSize);
  writeU32le(eocd, 16, centralOffset);
  writeU16le(eocd, 20, 0);

  const archive = concatBytes([...localChunks, ...centralChunks, eocd]);
  if (archive.byteLength > limits.maxArchiveBytes) {
    throw archiveError('ARCHIVE_TOO_LARGE', '生成したアーカイブが上限を超えています');
  }
  return archive;
}

export function readStoredZip(
  archive: Uint8Array,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): ZipEntries {
  assertLimits(limits);
  if (archive.byteLength < 22) {
    throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIP終端レコードがありません');
  }
  if (archive.byteLength > limits.maxArchiveBytes) {
    throw archiveError('ARCHIVE_TOO_LARGE', 'アーカイブが512MBを超えています');
  }

  const eocdOffset = findEndOfCentralDirectory(archive);
  const disk = readU16le(archive, eocdOffset + 4);
  const centralDisk = readU16le(archive, eocdOffset + 6);
  const diskEntries = readU16le(archive, eocdOffset + 8);
  const totalEntries = readU16le(archive, eocdOffset + 10);
  const centralSize = readU32le(archive, eocdOffset + 12);
  const centralOffset = readU32le(archive, eocdOffset + 16);
  const commentLength = readU16le(archive, eocdOffset + 20);

  if (eocdOffset + 22 + commentLength !== archive.byteLength) {
    throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIP終端コメント長が不正です');
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw archiveError('ARCHIVE_MULTI_DISK_UNSUPPORTED', '分割ZIPは読み込めません');
  }
  if (totalEntries < 1 || totalEntries > limits.maxEntries) {
    throw archiveError('ARCHIVE_ENTRY_LIMIT_EXCEEDED', 'ZIPエントリ数が上限を超えています');
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIP中央ディレクトリ位置が不正です');
  }

  const result = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(archive, cursor, 46);
    if (readU32le(archive, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIP中央ディレクトリが不正です');
    }
    const flags = readU16le(archive, cursor + 8);
    const method = readU16le(archive, cursor + 10);
    const expectedCrc = readU32le(archive, cursor + 16);
    const compressedSize = readU32le(archive, cursor + 20);
    const uncompressedSize = readU32le(archive, cursor + 24);
    const nameLength = readU16le(archive, cursor + 28);
    const extraLength = readU16le(archive, cursor + 30);
    const entryCommentLength = readU16le(archive, cursor + 32);
    const diskStart = readU16le(archive, cursor + 34);
    const externalAttributes = readU32le(archive, cursor + 38);
    const localOffset = readU32le(archive, cursor + 42);
    const recordLength = 46 + nameLength + extraLength + entryCommentLength;
    requireRange(archive, cursor, recordLength);

    assertEntryFlags(flags);
    if (diskStart !== 0) {
      throw archiveError('ARCHIVE_MULTI_DISK_UNSUPPORTED', '分割ZIPエントリは読み込めません');
    }
    if (method !== STORE_METHOD || compressedSize !== uncompressedSize) {
      throw archiveError(
        'ARCHIVE_COMPRESSION_UNSUPPORTED',
        'この`.liveboard`では非圧縮ZIPエントリだけを許可します',
      );
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw archiveError('ARCHIVE_ENTRY_TOO_LARGE', 'ZIPエントリが大きすぎます');
    }
    const ratio = compressedSize === 0
      ? uncompressedSize === 0 ? 1 : Number.POSITIVE_INFINITY
      : uncompressedSize / compressedSize;
    if (ratio > limits.maxCompressionRatio) {
      throw archiveError('ARCHIVE_COMPRESSION_RATIO_EXCEEDED', 'ZIP圧縮率が上限を超えています');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      throw archiveError('ARCHIVE_TOTAL_SIZE_EXCEEDED', 'ZIP展開後サイズが上限を超えています');
    }

    const path = decodeUtf8(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    assertSafeArchivePath(path);
    if (result.has(path)) {
      throw archiveError('ARCHIVE_DUPLICATE_PATH', `ZIP内のパスが重複しています: ${path}`);
    }
    assertRegularFile(externalAttributes, path);

    requireRange(archive, localOffset, 30);
    if (readU32le(archive, localOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw archiveError('ARCHIVE_INVALID_ZIP', `ローカルヘッダーが不正です: ${path}`);
    }
    const localFlags = readU16le(archive, localOffset + 6);
    const localMethod = readU16le(archive, localOffset + 8);
    const localCrc = readU32le(archive, localOffset + 14);
    const localCompressedSize = readU32le(archive, localOffset + 18);
    const localUncompressedSize = readU32le(archive, localOffset + 22);
    const localNameLength = readU16le(archive, localOffset + 26);
    const localExtraLength = readU16le(archive, localOffset + 28);
    const localHeaderLength = 30 + localNameLength + localExtraLength;
    requireRange(archive, localOffset, localHeaderLength + compressedSize);
    const localPath = decodeUtf8(
      archive.subarray(localOffset + 30, localOffset + 30 + localNameLength),
    );
    if (
      localPath !== path ||
      localFlags !== flags ||
      localMethod !== method ||
      localCrc !== expectedCrc ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw archiveError('ARCHIVE_INVALID_ZIP', `ZIPヘッダーの整合性がありません: ${path}`);
    }

    const dataStart = localOffset + localHeaderLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) {
      throw archiveError('ARCHIVE_INVALID_ZIP', `ZIPエントリが中央ディレクトリと重複しています: ${path}`);
    }
    const data = new Uint8Array(archive.subarray(dataStart, dataEnd));
    if (crc32(data) !== expectedCrc) {
      throw archiveError('ARCHIVE_CRC_MISMATCH', `ZIP CRCが一致しません: ${path}`);
    }
    result.set(path, data);
    cursor += recordLength;
  }

  if (cursor !== centralOffset + centralSize) {
    throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIP中央ディレクトリ末尾が不正です');
  }
  return result;
}

export function assertSafeArchivePath(path: string): void {
  if (
    path.length < 1 ||
    path.length > 240 ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw archiveError('ARCHIVE_PATH_INVALID', `安全でないZIPパスです: ${path}`);
  }
  const segments = path.split('/');
  if (
    segments.some(
      (segment) =>
        segment.length < 1 ||
        segment === '.' ||
        segment === '..' ||
        segment.length > 120,
    )
  ) {
    throw archiveError('ARCHIVE_PATH_INVALID', `安全でないZIPパスです: ${path}`);
  }
}

function assertEntryFlags(flags: number): void {
  if ((flags & 0x0001) !== 0) {
    throw archiveError('ARCHIVE_ENCRYPTION_UNSUPPORTED', '暗号化ZIPは読み込めません');
  }
  if ((flags & 0x0008) !== 0) {
    throw archiveError(
      'ARCHIVE_DATA_DESCRIPTOR_UNSUPPORTED',
      'data descriptor付きZIPは読み込めません',
    );
  }
  if ((flags & UTF8_FLAG) === 0) {
    throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIPパスはUTF-8である必要があります');
  }
}

function assertRegularFile(externalAttributes: number, path: string): void {
  const mode = externalAttributes >>> 16;
  const fileType = mode & 0o170000;
  if (fileType === 0o120000) {
    throw archiveError('ARCHIVE_SYMLINK_FORBIDDEN', `symlinkは使用できません: ${path}`);
  }
  if (fileType === 0o040000) {
    throw archiveError('ARCHIVE_DIRECTORY_FORBIDDEN', `ディレクトリエントリは使用できません: ${path}`);
  }
  if (fileType !== 0 && fileType !== 0o100000) {
    throw archiveError('ARCHIVE_INVALID_ZIP', `通常ファイル以外は使用できません: ${path}`);
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readU32le(bytes, offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIP終端レコードが見つかりません');
}

function toDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw archiveError('ARCHIVE_PATH_INVALID', 'ZIPパスが不正なUTF-8です');
  }
}

function assertLimits(limits: ArchiveLimits): void {
  const values = Object.values(limits);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error('Invalid archive limits');
  }
}

function requireRange(bytes: Uint8Array, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.byteLength
  ) {
    throw archiveError('ARCHIVE_INVALID_ZIP', 'ZIPエントリが途中で切れています');
  }
}

function readU16le(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 2);
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32le(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4);
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
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

function archiveError(code: ArchiveErrorCode, message: string): ArchiveValidationError {
  return new ArchiveValidationError(code, message);
}
