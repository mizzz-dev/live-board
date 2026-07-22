import {
  createRecoveryJournalEntry,
  parseRecoveryJournal,
  readStoredZip,
  selectRecoveryCandidate,
  serializeRecoveryJournalEntry,
  sha256Hex,
  verifyRecoverySnapshot,
  type RecoveryCandidate,
  type RecoveryJournalEntry,
  type RecoveryJournalKind,
} from '@live-board/persistence/node';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_RECENT_DOCUMENTS = 20;
const RECENT_SCHEMA_VERSION = 1 as const;
const RECOVERY_SNAPSHOT_RETENTION = 3;
const JOURNAL_FILE_NAME = 'journal.ndjson';
const RECOVERY_METADATA_FILE_NAME = 'metadata.json';
const RECENT_FILE_NAME = 'recent.json';

export interface PublicDocumentRecord {
  documentId: string;
  displayName: string;
  favorite: boolean;
  lastOpenedAt: string;
  lastSavedAt: string | null;
}

interface StoredDocumentRecord extends PublicDocumentRecord {
  path: string;
}

interface RecentDocumentStore {
  schemaVersion: typeof RECENT_SCHEMA_VERSION;
  documents: StoredDocumentRecord[];
}

interface RecoveryMetadata {
  schemaVersion: 1;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicRecoveryCandidate {
  candidateId: string;
  workspaceId: string;
  revision: number;
  savedAt: string;
  operationCountAfterSnapshot: number;
}

export interface SaveDocumentInput {
  workspaceId: string;
  revision: number;
  archive: Uint8Array;
  documentId?: string | undefined;
  targetPath?: string | undefined;
  savedAt?: string;
}

export interface SaveDocumentResult {
  document: PublicDocumentRecord;
  archiveSha256: string;
}

export interface OpenDocumentResult {
  document: PublicDocumentRecord;
  archive: Uint8Array;
}

export interface WorkspacePersistenceService {
  initialize(): Promise<void>;
  saveDocument(input: SaveDocumentInput): Promise<SaveDocumentResult>;
  openDocumentPath(path: string): Promise<OpenDocumentResult>;
  openRecentDocument(documentId: string): Promise<OpenDocumentResult>;
  listRecentDocuments(): Promise<PublicDocumentRecord[]>;
  setFavorite(documentId: string, favorite: boolean): Promise<PublicDocumentRecord>;
  appendOperation(workspaceId: string, revision: number): Promise<void>;
  saveRecoverySnapshot(
    workspaceId: string,
    revision: number,
    archive: Uint8Array,
  ): Promise<PublicRecoveryCandidate>;
  listRecoveryCandidates(): Promise<PublicRecoveryCandidate[]>;
  loadRecoveryCandidate(candidateId: string): Promise<Uint8Array>;
  discardRecoveryCandidate(candidateId: string, revision: number): Promise<void>;
}

export function createWorkspacePersistenceService(
  rootDirectory: string,
): WorkspacePersistenceService {
  assertAbsoluteLikePath(rootDirectory);
  const recentPath = join(rootDirectory, RECENT_FILE_NAME);
  const recoveryRoot = join(rootDirectory, 'recovery');

  return {
    async initialize(): Promise<void> {
      await mkdir(rootDirectory, { recursive: true });
      await mkdir(recoveryRoot, { recursive: true });
      const store = await readRecentStore(recentPath);
      for (const document of store.documents) {
        await recoverAtomicTarget(document.path).catch(() => undefined);
      }
      await writeRecentStore(recentPath, store);
    },

    async saveDocument(input: SaveDocumentInput): Promise<SaveDocumentResult> {
      assertWorkspaceId(input.workspaceId);
      assertRevision(input.revision);
      assertArchiveBytes(input.archive);
      validateArchiveContainer(input.archive);
      const store = await readRecentStore(recentPath);
      const existing = input.documentId === undefined
        ? undefined
        : findStoredDocument(store, input.documentId);
      const targetPath = input.targetPath ?? existing?.path;
      if (targetPath === undefined) {
        throw new Error('PERSISTENCE_SAVE_TARGET_REQUIRED');
      }
      assertLiveboardPath(targetPath);
      const savedAt = normalizeTimestamp(input.savedAt ?? new Date().toISOString());
      await recoverAtomicTarget(targetPath);
      await atomicWriteFile(targetPath, input.archive);
      const document = upsertRecentDocument(store, {
        path: targetPath,
        favorite: existing?.favorite ?? false,
        lastOpenedAt: savedAt,
        lastSavedAt: savedAt,
      });
      await writeRecentStore(recentPath, store);
      await appendSnapshotJournal(
        recoveryRoot,
        input.workspaceId,
        input.revision,
        'explicit-save',
        input.archive,
        savedAt,
      );
      return {
        document: toPublicDocument(document),
        archiveSha256: sha256Hex(input.archive),
      };
    },

    async openDocumentPath(path: string): Promise<OpenDocumentResult> {
      assertLiveboardPath(path);
      await recoverAtomicTarget(path);
      const archive = await readArchiveFile(path);
      const openedAt = new Date().toISOString();
      const store = await readRecentStore(recentPath);
      const current = store.documents.find((document) => document.path === path);
      const document = upsertRecentDocument(store, {
        path,
        favorite: current?.favorite ?? false,
        lastOpenedAt: openedAt,
        lastSavedAt: current?.lastSavedAt ?? null,
      });
      await writeRecentStore(recentPath, store);
      return { document: toPublicDocument(document), archive };
    },

    async openRecentDocument(documentId: string): Promise<OpenDocumentResult> {
      assertOpaqueId(documentId, 'documentId');
      const store = await readRecentStore(recentPath);
      const document = findStoredDocument(store, documentId);
      return this.openDocumentPath(document.path);
    },

    async listRecentDocuments(): Promise<PublicDocumentRecord[]> {
      const store = await readRecentStore(recentPath);
      return store.documents.map(toPublicDocument);
    },

    async setFavorite(
      documentId: string,
      favorite: boolean,
    ): Promise<PublicDocumentRecord> {
      assertOpaqueId(documentId, 'documentId');
      if (typeof favorite !== 'boolean') throw new Error('PERSISTENCE_FAVORITE_INVALID');
      const store = await readRecentStore(recentPath);
      const document = findStoredDocument(store, documentId);
      document.favorite = favorite;
      sortRecentDocuments(store.documents);
      await writeRecentStore(recentPath, store);
      return toPublicDocument(document);
    },

    async appendOperation(workspaceId: string, revision: number): Promise<void> {
      assertWorkspaceId(workspaceId);
      assertRevision(revision);
      await appendJournalEntry(recoveryRoot, workspaceId, revision, 'operation');
    },

    async saveRecoverySnapshot(
      workspaceId: string,
      revision: number,
      archive: Uint8Array,
    ): Promise<PublicRecoveryCandidate> {
      assertWorkspaceId(workspaceId);
      assertRevision(revision);
      assertArchiveBytes(archive);
      validateArchiveContainer(archive);
      const entry = await appendSnapshotJournal(
        recoveryRoot,
        workspaceId,
        revision,
        'snapshot',
        archive,
      );
      const entries = await readJournalEntries(recoveryDirectory(recoveryRoot, workspaceId));
      const candidate = selectRecoveryCandidate(entries);
      if (candidate === null || candidate.snapshotSequence !== entry.sequence) {
        throw new Error('PERSISTENCE_RECOVERY_CANDIDATE_NOT_CREATED');
      }
      return toPublicRecoveryCandidate(candidate);
    },

    async listRecoveryCandidates(): Promise<PublicRecoveryCandidate[]> {
      const directoryEntries = await readdir(recoveryRoot, { withFileTypes: true });
      const candidates: PublicRecoveryCandidate[] = [];
      for (const directoryEntry of directoryEntries) {
        if (!directoryEntry.isDirectory() || !/^[a-f0-9]{64}$/.test(directoryEntry.name)) {
          continue;
        }
        const directory = join(recoveryRoot, directoryEntry.name);
        try {
          const metadata = await readRecoveryMetadata(directory);
          if (candidateIdForWorkspace(metadata.workspaceId) !== directoryEntry.name) continue;
          const entries = await readJournalEntries(directory);
          const candidate = selectRecoveryCandidate(entries);
          if (candidate === null) continue;
          const snapshot = await readRecoverySnapshot(directory, candidate);
          validateArchiveContainer(snapshot);
          candidates.push(toPublicRecoveryCandidate(candidate));
        } catch {
          continue;
        }
      }
      return candidates.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    },

    async loadRecoveryCandidate(candidateId: string): Promise<Uint8Array> {
      assertOpaqueId(candidateId, 'candidateId');
      const directory = join(recoveryRoot, candidateId);
      const metadata = await readRecoveryMetadata(directory);
      if (candidateIdForWorkspace(metadata.workspaceId) !== candidateId) {
        throw new Error('PERSISTENCE_RECOVERY_ID_MISMATCH');
      }
      const entries = await readJournalEntries(directory);
      const candidate = selectRecoveryCandidate(entries);
      if (candidate === null) throw new Error('PERSISTENCE_RECOVERY_NOT_FOUND');
      const snapshot = await readRecoverySnapshot(directory, candidate);
      validateArchiveContainer(snapshot);
      return snapshot;
    },

    async discardRecoveryCandidate(candidateId: string, revision: number): Promise<void> {
      assertOpaqueId(candidateId, 'candidateId');
      assertRevision(revision);
      const directory = join(recoveryRoot, candidateId);
      const metadata = await readRecoveryMetadata(directory);
      if (candidateIdForWorkspace(metadata.workspaceId) !== candidateId) {
        throw new Error('PERSISTENCE_RECOVERY_ID_MISMATCH');
      }
      await appendJournalEntry(
        recoveryRoot,
        metadata.workspaceId,
        revision,
        'discard',
      );
    },
  };
}

async function appendSnapshotJournal(
  recoveryRoot: string,
  workspaceId: string,
  revision: number,
  kind: Extract<RecoveryJournalKind, 'snapshot' | 'explicit-save'>,
  archive: Uint8Array,
  occurredAt = new Date().toISOString(),
): Promise<RecoveryJournalEntry> {
  const directory = await ensureRecoveryDirectory(recoveryRoot, workspaceId, occurredAt);
  const entries = await readJournalEntries(directory);
  const sequence = nextSequence(entries);
  const snapshotPath = join(directory, snapshotFileName(sequence));
  await atomicWriteFile(snapshotPath, archive);
  const entry = createRecoveryJournalEntry({
    sequence,
    workspaceId,
    revision,
    kind,
    occurredAt,
    snapshot: archive,
  });
  await appendFile(join(directory, JOURNAL_FILE_NAME), serializeRecoveryJournalEntry(entry), {
    encoding: 'utf8',
    flag: 'a',
  });
  await updateRecoveryMetadata(directory, workspaceId, occurredAt);
  await pruneRecoverySnapshots(directory, entries.concat(entry));
  return entry;
}

async function appendJournalEntry(
  recoveryRoot: string,
  workspaceId: string,
  revision: number,
  kind: Extract<RecoveryJournalKind, 'operation' | 'discard'>,
  occurredAt = new Date().toISOString(),
): Promise<RecoveryJournalEntry> {
  const directory = await ensureRecoveryDirectory(recoveryRoot, workspaceId, occurredAt);
  const entries = await readJournalEntries(directory);
  const entry = createRecoveryJournalEntry({
    sequence: nextSequence(entries),
    workspaceId,
    revision,
    kind,
    occurredAt,
  });
  await appendFile(join(directory, JOURNAL_FILE_NAME), serializeRecoveryJournalEntry(entry), {
    encoding: 'utf8',
    flag: 'a',
  });
  await updateRecoveryMetadata(directory, workspaceId, occurredAt);
  return entry;
}

async function ensureRecoveryDirectory(
  recoveryRoot: string,
  workspaceId: string,
  timestamp: string,
): Promise<string> {
  const directory = recoveryDirectory(recoveryRoot, workspaceId);
  await mkdir(directory, { recursive: true });
  const metadataPath = join(directory, RECOVERY_METADATA_FILE_NAME);
  try {
    await readRecoveryMetadata(directory);
  } catch {
    const metadata: RecoveryMetadata = {
      schemaVersion: 1,
      workspaceId,
      createdAt: normalizeTimestamp(timestamp),
      updatedAt: normalizeTimestamp(timestamp),
    };
    await atomicWriteFile(metadataPath, encodeJson(metadata));
  }
  return directory;
}

async function updateRecoveryMetadata(
  directory: string,
  workspaceId: string,
  timestamp: string,
): Promise<void> {
  let createdAt = timestamp;
  try {
    createdAt = (await readRecoveryMetadata(directory)).createdAt;
  } catch {
    // A new metadata file is created below.
  }
  const metadata: RecoveryMetadata = {
    schemaVersion: 1,
    workspaceId,
    createdAt,
    updatedAt: normalizeTimestamp(timestamp),
  };
  await atomicWriteFile(join(directory, RECOVERY_METADATA_FILE_NAME), encodeJson(metadata));
}

async function readRecoveryMetadata(directory: string): Promise<RecoveryMetadata> {
  const raw = await readJsonFile(join(directory, RECOVERY_METADATA_FILE_NAME));
  if (!isRecord(raw) || raw.schemaVersion !== 1) {
    throw new Error('PERSISTENCE_RECOVERY_METADATA_INVALID');
  }
  assertWorkspaceId(raw.workspaceId);
  return {
    schemaVersion: 1,
    workspaceId: raw.workspaceId,
    createdAt: normalizeTimestamp(raw.createdAt),
    updatedAt: normalizeTimestamp(raw.updatedAt),
  };
}

async function readRecoverySnapshot(
  directory: string,
  candidate: RecoveryCandidate,
): Promise<Uint8Array> {
  const snapshot = new Uint8Array(
    await readFile(join(directory, snapshotFileName(candidate.snapshotSequence))),
  );
  verifyRecoverySnapshot(candidate, snapshot);
  return snapshot;
}

async function pruneRecoverySnapshots(
  directory: string,
  entries: readonly RecoveryJournalEntry[],
): Promise<void> {
  const retainedSequences = entries
    .filter((entry) => entry.snapshotSha256 !== null)
    .map((entry) => entry.sequence)
    .slice(-RECOVERY_SNAPSHOT_RETENTION);
  const retained = new Set(retainedSequences.map(snapshotFileName));
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /^snapshot-[1-9][0-9]*\.liveboard$/.test(entry.name) &&
      !retained.has(entry.name)
    ) {
      await unlink(join(directory, entry.name)).catch(() => undefined);
    }
  }
}

async function readJournalEntries(directory: string): Promise<RecoveryJournalEntry[]> {
  try {
    const source = await readFile(join(directory, JOURNAL_FILE_NAME), 'utf8');
    return parseRecoveryJournal(source);
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return [];
    throw error;
  }
}

function nextSequence(entries: readonly RecoveryJournalEntry[]): number {
  return (entries.at(-1)?.sequence ?? 0) + 1;
}

function recoveryDirectory(recoveryRoot: string, workspaceId: string): string {
  return join(recoveryRoot, candidateIdForWorkspace(workspaceId));
}

function candidateIdForWorkspace(workspaceId: string): string {
  return sha256Hex(new TextEncoder().encode(workspaceId));
}

function snapshotFileName(sequence: number): string {
  return `snapshot-${sequence}.liveboard`;
}

async function readArchiveFile(path: string): Promise<Uint8Array> {
  const fileStat = await stat(path);
  if (!fileStat.isFile() || fileStat.size < 22 || fileStat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('PERSISTENCE_ARCHIVE_SIZE_INVALID');
  }
  const archive = new Uint8Array(await readFile(path));
  validateArchiveContainer(archive);
  return archive;
}

function validateArchiveContainer(archive: Uint8Array): void {
  const entries = readStoredZip(archive);
  if (!entries.has('manifest.json')) {
    throw new Error('PERSISTENCE_MANIFEST_MISSING');
  }
}

async function atomicWriteFile(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await recoverAtomicTarget(path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const backupPath = `${path}.bak`;
  let targetMovedToBackup = false;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await writeFile(handle, bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    try {
      await rename(path, backupPath);
      targetMovedToBackup = true;
    } catch (error: unknown) {
      if (!isNodeError(error, 'ENOENT')) throw error;
    }
    await rename(temporaryPath, path);
    await syncDirectory(dirname(path));
    if (targetMovedToBackup) await unlink(backupPath).catch(() => undefined);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    if (targetMovedToBackup) {
      await rename(backupPath, path).catch(() => undefined);
    }
    throw error;
  }
}

async function recoverAtomicTarget(path: string): Promise<void> {
  const backupPath = `${path}.bak`;
  const targetExists = await pathExists(path);
  const backupExists = await pathExists(backupPath);
  if (!targetExists && backupExists) {
    await rename(backupPath, path);
    return;
  }
  if (targetExists && backupExists) {
    await unlink(backupPath).catch(() => undefined);
  }
  const directory = dirname(path);
  const prefix = `${basename(path)}.`;
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.tmp')) {
        await unlink(join(directory, entry.name)).catch(() => undefined);
      }
    }
  } catch (error: unknown) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windowsなどディレクトリfsyncを利用できない環境ではファイルfsyncを採用する。
  }
}

async function readRecentStore(path: string): Promise<RecentDocumentStore> {
  try {
    const raw = await readJsonFile(path);
    return parseRecentStore(raw);
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return emptyRecentStore();
    const corruptedPath = `${path}.corrupt-${Date.now()}`;
    await rename(path, corruptedPath).catch(() => undefined);
    return emptyRecentStore();
  }
}

async function writeRecentStore(
  path: string,
  store: RecentDocumentStore,
): Promise<void> {
  sortRecentDocuments(store.documents);
  store.documents = store.documents.slice(0, MAX_RECENT_DOCUMENTS);
  await atomicWriteFile(path, encodeJson(store));
}

function parseRecentStore(input: unknown): RecentDocumentStore {
  if (!isRecord(input) || input.schemaVersion !== RECENT_SCHEMA_VERSION || !Array.isArray(input.documents)) {
    throw new Error('PERSISTENCE_RECENT_STORE_INVALID');
  }
  const documents = input.documents.slice(0, MAX_RECENT_DOCUMENTS).map(parseStoredDocument);
  if (new Set(documents.map((document) => document.documentId)).size !== documents.length) {
    throw new Error('PERSISTENCE_RECENT_DUPLICATE_ID');
  }
  return { schemaVersion: RECENT_SCHEMA_VERSION, documents };
}

function parseStoredDocument(input: unknown): StoredDocumentRecord {
  if (!isRecord(input)) throw new Error('PERSISTENCE_RECENT_DOCUMENT_INVALID');
  const path = parseString(input.path, 1, 4_096);
  assertLiveboardPath(path);
  const expectedId = documentIdForPath(path);
  if (input.documentId !== expectedId) throw new Error('PERSISTENCE_DOCUMENT_ID_INVALID');
  return {
    documentId: expectedId,
    path,
    displayName: parseString(input.displayName, 1, 255),
    favorite: parseBoolean(input.favorite),
    lastOpenedAt: normalizeTimestamp(input.lastOpenedAt),
    lastSavedAt: input.lastSavedAt === null ? null : normalizeTimestamp(input.lastSavedAt),
  };
}

function upsertRecentDocument(
  store: RecentDocumentStore,
  input: {
    path: string;
    favorite: boolean;
    lastOpenedAt: string;
    lastSavedAt: string | null;
  },
): StoredDocumentRecord {
  const documentId = documentIdForPath(input.path);
  const existing = store.documents.find((document) => document.documentId === documentId);
  const document: StoredDocumentRecord = {
    documentId,
    path: input.path,
    displayName: basename(input.path),
    favorite: input.favorite,
    lastOpenedAt: normalizeTimestamp(input.lastOpenedAt),
    lastSavedAt: input.lastSavedAt === null ? null : normalizeTimestamp(input.lastSavedAt),
  };
  if (existing === undefined) store.documents.push(document);
  else Object.assign(existing, document);
  sortRecentDocuments(store.documents);
  return existing ?? document;
}

function sortRecentDocuments(documents: StoredDocumentRecord[]): void {
  documents.sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
  });
}

function findStoredDocument(
  store: RecentDocumentStore,
  documentId: string,
): StoredDocumentRecord {
  assertOpaqueId(documentId, 'documentId');
  const document = store.documents.find((candidate) => candidate.documentId === documentId);
  if (document === undefined) throw new Error('PERSISTENCE_DOCUMENT_NOT_FOUND');
  return document;
}

function toPublicDocument(document: StoredDocumentRecord): PublicDocumentRecord {
  return {
    documentId: document.documentId,
    displayName: document.displayName,
    favorite: document.favorite,
    lastOpenedAt: document.lastOpenedAt,
    lastSavedAt: document.lastSavedAt,
  };
}

function toPublicRecoveryCandidate(
  candidate: RecoveryCandidate,
): PublicRecoveryCandidate {
  return {
    candidateId: candidateIdForWorkspace(candidate.workspaceId),
    workspaceId: candidate.workspaceId,
    revision: candidate.revision,
    savedAt: candidate.savedAt,
    operationCountAfterSnapshot: candidate.operationCountAfterSnapshot,
  };
}

function emptyRecentStore(): RecentDocumentStore {
  return { schemaVersion: RECENT_SCHEMA_VERSION, documents: [] };
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function documentIdForPath(path: string): string {
  return sha256Hex(new TextEncoder().encode(path));
}

function assertArchiveBytes(archive: Uint8Array): void {
  if (!(archive instanceof Uint8Array) || archive.byteLength < 22 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('PERSISTENCE_ARCHIVE_SIZE_INVALID');
  }
}

function assertWorkspaceId(input: unknown): asserts input is string {
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(input)
  ) {
    throw new Error('PERSISTENCE_WORKSPACE_ID_INVALID');
  }
}

function assertRevision(input: unknown): asserts input is number {
  if (!Number.isSafeInteger(input) || input < 0) {
    throw new Error('PERSISTENCE_REVISION_INVALID');
  }
}

function assertOpaqueId(input: unknown, label: string): asserts input is string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) {
    throw new Error(`PERSISTENCE_${label.toUpperCase()}_INVALID`);
  }
}

function assertLiveboardPath(path: string): void {
  assertAbsoluteLikePath(path);
  if (extname(path).toLowerCase() !== '.liveboard') {
    throw new Error('PERSISTENCE_FILE_EXTENSION_INVALID');
  }
}

function assertAbsoluteLikePath(path: string): void {
  if (
    typeof path !== 'string' ||
    path.length < 1 ||
    path.length > 4_096 ||
    (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) ||
    path.includes('\0')
  ) {
    throw new Error('PERSISTENCE_PATH_INVALID');
  }
}

function normalizeTimestamp(input: unknown): string {
  if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) {
    throw new Error('PERSISTENCE_TIMESTAMP_INVALID');
  }
  return input;
}

function parseString(input: unknown, min: number, max: number): string {
  if (typeof input !== 'string' || input.length < min || input.length > max) {
    throw new Error('PERSISTENCE_STRING_INVALID');
  }
  return input;
}

function parseBoolean(input: unknown): boolean {
  if (typeof input !== 'boolean') throw new Error('PERSISTENCE_BOOLEAN_INVALID');
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return false;
    throw error;
  }
}

export async function removePersistenceRootForTest(rootDirectory: string): Promise<void> {
  await rm(rootDirectory, { recursive: true, force: true });
}
