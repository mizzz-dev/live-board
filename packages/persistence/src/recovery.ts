import { sha256Hex } from './hash.js';

export const RECOVERY_JOURNAL_SCHEMA_VERSION = 1 as const;
export const MAX_RECOVERY_JOURNAL_ENTRIES = 10_000;
export const MAX_RECOVERY_JOURNAL_BYTES = 8 * 1024 * 1024;

export type RecoveryJournalKind =
  | 'operation'
  | 'snapshot'
  | 'explicit-save'
  | 'discard';

export interface RecoveryJournalEntry {
  schemaVersion: typeof RECOVERY_JOURNAL_SCHEMA_VERSION;
  sequence: number;
  workspaceId: string;
  revision: number;
  kind: RecoveryJournalKind;
  occurredAt: string;
  snapshotSha256: string | null;
  snapshotByteLength: number | null;
}

export interface RecoveryCandidate {
  workspaceId: string;
  revision: number;
  savedAt: string;
  snapshotSha256: string;
  snapshotByteLength: number;
  operationCountAfterSnapshot: number;
}

export function createRecoveryJournalEntry(input: {
  sequence: number;
  workspaceId: string;
  revision: number;
  kind: RecoveryJournalKind;
  occurredAt?: string;
  snapshot?: Uint8Array;
}): RecoveryJournalEntry {
  assertSequence(input.sequence);
  assertWorkspaceId(input.workspaceId);
  assertRevision(input.revision);
  const occurredAt = normalizeTimestamp(input.occurredAt ?? new Date().toISOString());
  const snapshotSha256 = input.snapshot === undefined ? null : sha256Hex(input.snapshot);
  const snapshotByteLength = input.snapshot?.byteLength ?? null;
  if (
    (input.kind === 'snapshot' || input.kind === 'explicit-save') &&
    input.snapshot === undefined
  ) {
    throw new Error(`${input.kind} journal entry requires snapshot bytes`);
  }
  if (
    (input.kind === 'operation' || input.kind === 'discard') &&
    input.snapshot !== undefined
  ) {
    throw new Error(`${input.kind} journal entry cannot include snapshot bytes`);
  }
  return {
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    sequence: input.sequence,
    workspaceId: input.workspaceId,
    revision: input.revision,
    kind: input.kind,
    occurredAt,
    snapshotSha256,
    snapshotByteLength,
  };
}

export function serializeRecoveryJournalEntry(entry: RecoveryJournalEntry): string {
  return `${JSON.stringify(parseRecoveryJournalEntry(entry))}\n`;
}

export function parseRecoveryJournal(source: string): RecoveryJournalEntry[] {
  if (new TextEncoder().encode(source).byteLength > MAX_RECOVERY_JOURNAL_BYTES) {
    throw new Error('RECOVERY_JOURNAL_TOO_LARGE');
  }
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_RECOVERY_JOURNAL_ENTRIES) {
    throw new Error('RECOVERY_JOURNAL_ENTRY_LIMIT');
  }
  const result = lines.map((line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error('RECOVERY_JOURNAL_INVALID_JSON');
    }
    return parseRecoveryJournalEntry(parsed);
  });
  for (let index = 1; index < result.length; index += 1) {
    if (result[index]!.sequence <= result[index - 1]!.sequence) {
      throw new Error('RECOVERY_JOURNAL_SEQUENCE_INVALID');
    }
    if (result[index]!.workspaceId !== result[0]!.workspaceId) {
      throw new Error('RECOVERY_JOURNAL_WORKSPACE_MISMATCH');
    }
  }
  return result;
}

export function selectRecoveryCandidate(
  entries: readonly RecoveryJournalEntry[],
): RecoveryCandidate | null {
  if (entries.length === 0) return null;
  const latestDiscard = findLast(entries, (entry) => entry.kind === 'discard');
  const latestExplicitSave = findLast(
    entries,
    (entry) => entry.kind === 'explicit-save',
  );
  const latestSnapshot = findLast(entries, (entry) => entry.kind === 'snapshot');
  if (latestSnapshot === null) return null;
  if (latestDiscard !== null && latestDiscard.sequence > latestSnapshot.sequence) {
    return null;
  }
  if (
    latestExplicitSave !== null &&
    latestExplicitSave.revision >= latestSnapshot.revision
  ) {
    return null;
  }
  if (
    latestSnapshot.snapshotSha256 === null ||
    latestSnapshot.snapshotByteLength === null
  ) {
    throw new Error('RECOVERY_SNAPSHOT_METADATA_MISSING');
  }
  return {
    workspaceId: latestSnapshot.workspaceId,
    revision: latestSnapshot.revision,
    savedAt: latestSnapshot.occurredAt,
    snapshotSha256: latestSnapshot.snapshotSha256,
    snapshotByteLength: latestSnapshot.snapshotByteLength,
    operationCountAfterSnapshot: entries.filter(
      (entry) =>
        entry.kind === 'operation' && entry.sequence > latestSnapshot.sequence,
    ).length,
  };
}

export function verifyRecoverySnapshot(
  candidate: RecoveryCandidate,
  snapshot: Uint8Array,
): void {
  if (snapshot.byteLength !== candidate.snapshotByteLength) {
    throw new Error('RECOVERY_SNAPSHOT_SIZE_MISMATCH');
  }
  if (sha256Hex(snapshot) !== candidate.snapshotSha256) {
    throw new Error('RECOVERY_SNAPSHOT_HASH_MISMATCH');
  }
}

function parseRecoveryJournalEntry(input: unknown): RecoveryJournalEntry {
  if (!isRecord(input) || input.schemaVersion !== RECOVERY_JOURNAL_SCHEMA_VERSION) {
    throw new Error('RECOVERY_JOURNAL_SCHEMA_INVALID');
  }
  const sequence = input.sequence;
  const workspaceId = input.workspaceId;
  const revision = input.revision;
  const kind = input.kind;
  const occurredAt = input.occurredAt;
  const snapshotSha256 = input.snapshotSha256;
  const snapshotByteLength = input.snapshotByteLength;
  assertSequence(sequence);
  assertWorkspaceId(workspaceId);
  assertRevision(revision);
  if (
    kind !== 'operation' &&
    kind !== 'snapshot' &&
    kind !== 'explicit-save' &&
    kind !== 'discard'
  ) {
    throw new Error('RECOVERY_JOURNAL_KIND_INVALID');
  }
  const normalizedOccurredAt = normalizeTimestamp(occurredAt);
  if (
    snapshotSha256 !== null &&
    (typeof snapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotSha256))
  ) {
    throw new Error('RECOVERY_SNAPSHOT_HASH_INVALID');
  }
  if (
    snapshotByteLength !== null &&
    (!Number.isSafeInteger(snapshotByteLength) || snapshotByteLength < 1)
  ) {
    throw new Error('RECOVERY_SNAPSHOT_SIZE_INVALID');
  }
  const requiresSnapshot = kind === 'snapshot' || kind === 'explicit-save';
  if (
    requiresSnapshot !==
    (snapshotSha256 !== null && snapshotByteLength !== null)
  ) {
    throw new Error('RECOVERY_SNAPSHOT_METADATA_INVALID');
  }
  return {
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    sequence,
    workspaceId,
    revision,
    kind,
    occurredAt: normalizedOccurredAt,
    snapshotSha256,
    snapshotByteLength,
  };
}

function findLast(
  entries: readonly RecoveryJournalEntry[],
  predicate: (entry: RecoveryJournalEntry) => boolean,
): RecoveryJournalEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (predicate(entries[index]!)) return entries[index]!;
  }
  return null;
}

function assertSequence(input: unknown): asserts input is number {
  if (!Number.isSafeInteger(input) || input < 1) {
    throw new Error('RECOVERY_JOURNAL_SEQUENCE_INVALID');
  }
}

function assertRevision(input: unknown): asserts input is number {
  if (!Number.isSafeInteger(input) || input < 0) {
    throw new Error('RECOVERY_REVISION_INVALID');
  }
}

function assertWorkspaceId(input: unknown): asserts input is string {
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(input)
  ) {
    throw new Error('RECOVERY_WORKSPACE_ID_INVALID');
  }
}

function normalizeTimestamp(input: unknown): string {
  if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) {
    throw new Error('RECOVERY_TIMESTAMP_INVALID');
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
