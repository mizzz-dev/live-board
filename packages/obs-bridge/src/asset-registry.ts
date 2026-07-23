import {
  isInlineBroadcastAsset,
  parseBroadcastAssetRegistration,
  parseBroadcastSnapshotDescriptor,
  toBroadcastSnapshotDescriptor,
  type BroadcastAssetDescriptor,
  type BroadcastAssetMime,
  type BroadcastAssetRegistration,
  type BroadcastSnapshot,
  type BroadcastSnapshotDescriptor,
  type HttpBroadcastAsset,
  type InlineBroadcastAsset,
} from '@live-board/obs-protocol';
import { createHash } from 'node:crypto';

export const DEFAULT_ASSET_RETENTION_MS = 60_000;
export const DEFAULT_MAX_ASSET_BYTES = 256 * 1024 * 1024;

export interface StoredBroadcastAsset {
  sha256: string;
  mime: BroadcastAssetMime;
  width: number;
  height: number;
  byteLength: number;
  bytes: Buffer;
  sanitized: boolean;
  lastReferencedAt: number;
}

export interface BroadcastAssetRegistryStats {
  count: number;
  totalBytes: number;
  maxBytes: number;
  retentionMs: number;
}

export interface BroadcastAssetRegistryOptions {
  maxBytes?: number | undefined;
  retentionMs?: number | undefined;
  now?: (() => number) | undefined;
}

interface PreparedRegistration {
  descriptor: BroadcastAssetDescriptor;
  bytes: Buffer;
}

export class BroadcastAssetRegistry {
  private readonly entries = new Map<string, StoredBroadcastAsset>();
  private readonly maxBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private activeHashes = new Set<string>();
  private totalBytes = 0;

  constructor(options: BroadcastAssetRegistryOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_ASSET_BYTES;
    this.retentionMs = options.retentionMs ?? DEFAULT_ASSET_RETENTION_MS;
    this.now = options.now ?? Date.now;
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1 ||
      this.maxBytes > 512 * 1024 * 1024
    ) {
      throw new Error('OBS_BRIDGE_INVALID_ASSET_BYTE_LIMIT');
    }
    if (
      !Number.isSafeInteger(this.retentionMs) ||
      this.retentionMs < 0 ||
      this.retentionMs > 24 * 60 * 60 * 1000
    ) {
      throw new Error('OBS_BRIDGE_INVALID_ASSET_RETENTION');
    }
  }

  registerAssets(input: readonly BroadcastAssetRegistration[]): string[] {
    const now = this.now();
    const prepared = input.map((asset) => {
      const parsed = parseBroadcastAssetRegistration(asset);
      return verifyRegistration(parsed);
    });
    const requestHashes = new Set<string>();
    for (const item of prepared) {
      if (requestHashes.has(item.descriptor.sha256)) {
        throw new Error('OBS_BRIDGE_DUPLICATE_ASSET_REGISTRATION');
      }
      requestHashes.add(item.descriptor.sha256);
      this.assertCompatibleMetadata(item.descriptor);
    }

    const additionalBytes = prepared.reduce(
      (total, item) =>
        total + (this.entries.has(item.descriptor.sha256) ? 0 : item.bytes.length),
      0,
    );
    const protectedHashes = new Set([...this.activeHashes, ...requestHashes]);
    const evictionHashes = this.planEvictions(additionalBytes, protectedHashes, now);

    for (const sha256 of evictionHashes) this.delete(sha256);
    for (const item of prepared) {
      this.upsert(item.descriptor, item.bytes, now);
    }
    return [...requestHashes];
  }

  prepareSnapshot(snapshot: BroadcastSnapshot, token: string): BroadcastSnapshot {
    const registrations = (snapshot.assets ?? []).map((asset) => {
      if (!isInlineBroadcastAsset(asset)) {
        throw new Error('OBS_BRIDGE_HTTP_ASSET_INPUT_NOT_ALLOWED');
      }
      return decodeInlineRegistration(asset);
    });
    this.registerAssets(registrations);
    return this.prepareSnapshotDescriptor(
      toBroadcastSnapshotDescriptor(snapshot),
      token,
    );
  }

  prepareSnapshotDescriptor(
    input: BroadcastSnapshotDescriptor,
    token: string,
  ): BroadcastSnapshot {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      throw new Error('OBS_BRIDGE_INVALID_ASSET_TOKEN');
    }
    const snapshot = parseBroadcastSnapshotDescriptor(input);
    const now = this.now();
    const descriptors = snapshot.assets ?? [];
    const currentHashes = new Set<string>();

    for (const descriptor of descriptors) {
      const entry = this.entries.get(descriptor.sha256);
      if (entry === undefined) {
        throw new Error('OBS_BRIDGE_ASSET_NOT_REGISTERED');
      }
      this.assertEntryMetadata(entry, descriptor);
      currentHashes.add(descriptor.sha256);
    }

    for (const sha256 of currentHashes) {
      this.entries.get(sha256)!.lastReferencedAt = now;
    }
    this.activeHashes = currentHashes;
    this.pruneExpired(currentHashes, now);

    if (snapshot.assets === undefined) return snapshot;
    const assets: HttpBroadcastAsset[] = descriptors.map((asset) => ({
      ...asset,
      delivery: 'http',
      url: `/asset/${token}/${asset.sha256}`,
    }));
    return { ...snapshot, assets };
  }

  get(sha256: string): StoredBroadcastAsset | undefined {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return undefined;
    const entry = this.entries.get(sha256);
    if (entry !== undefined) entry.lastReferencedAt = this.now();
    return entry;
  }

  getStats(): BroadcastAssetRegistryStats {
    return {
      count: this.entries.size,
      totalBytes: this.totalBytes,
      maxBytes: this.maxBytes,
      retentionMs: this.retentionMs,
    };
  }

  clear(): void {
    this.entries.clear();
    this.activeHashes.clear();
    this.totalBytes = 0;
  }

  private assertCompatibleMetadata(asset: BroadcastAssetDescriptor): void {
    const existing = this.entries.get(asset.sha256);
    if (existing !== undefined) this.assertEntryMetadata(existing, asset);
  }

  private assertEntryMetadata(
    existing: StoredBroadcastAsset,
    asset: BroadcastAssetDescriptor,
  ): void {
    if (
      existing.mime !== asset.mime ||
      existing.width !== asset.width ||
      existing.height !== asset.height ||
      existing.byteLength !== asset.byteLength ||
      existing.sanitized !== asset.sanitized
    ) {
      throw new Error('OBS_BRIDGE_ASSET_HASH_METADATA_MISMATCH');
    }
  }

  private upsert(
    asset: BroadcastAssetDescriptor,
    bytes: Buffer,
    now: number,
  ): void {
    const existing = this.entries.get(asset.sha256);
    if (existing !== undefined) {
      existing.lastReferencedAt = now;
      return;
    }
    this.entries.set(asset.sha256, {
      sha256: asset.sha256,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      byteLength: asset.byteLength,
      bytes,
      sanitized: asset.sanitized,
      lastReferencedAt: now,
    });
    this.totalBytes += bytes.length;
  }

  private planEvictions(
    additionalBytes: number,
    protectedHashes: ReadonlySet<string>,
    now: number,
  ): string[] {
    let projectedBytes = this.totalBytes + additionalBytes;
    if (projectedBytes <= this.maxBytes) return [];

    const candidates = [...this.entries.values()]
      .filter((entry) => !protectedHashes.has(entry.sha256))
      .sort((a, b) => {
        const aExpired = now - a.lastReferencedAt > this.retentionMs ? 0 : 1;
        const bExpired = now - b.lastReferencedAt > this.retentionMs ? 0 : 1;
        return aExpired - bExpired || a.lastReferencedAt - b.lastReferencedAt;
      });
    const evictions: string[] = [];
    for (const entry of candidates) {
      evictions.push(entry.sha256);
      projectedBytes -= entry.byteLength;
      if (projectedBytes <= this.maxBytes) return evictions;
    }
    throw new Error('OBS_BRIDGE_ASSET_REGISTRY_LIMIT');
  }

  private pruneExpired(currentHashes: ReadonlySet<string>, now: number): void {
    for (const [sha256, entry] of this.entries) {
      if (
        !currentHashes.has(sha256) &&
        now - entry.lastReferencedAt > this.retentionMs
      ) {
        this.delete(sha256);
      }
    }
  }

  private delete(sha256: string): void {
    const entry = this.entries.get(sha256);
    if (entry === undefined) return;
    this.entries.delete(sha256);
    this.activeHashes.delete(sha256);
    this.totalBytes -= entry.byteLength;
  }
}

function decodeInlineRegistration(
  asset: InlineBroadcastAsset,
): BroadcastAssetRegistration {
  const prefix = `data:${asset.mime};base64,`;
  if (!asset.dataUrl.startsWith(prefix)) {
    throw new Error('OBS_BRIDGE_INVALID_ASSET_DATA_URL');
  }
  const base64 = asset.dataUrl.slice(prefix.length);
  if (
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new Error('OBS_BRIDGE_INVALID_ASSET_DATA_URL');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (
    bytes.length !== asset.byteLength ||
    bytes.toString('base64') !== base64
  ) {
    throw new Error('OBS_BRIDGE_INVALID_ASSET_DATA_URL');
  }
  return {
    id: asset.id,
    sha256: asset.sha256,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byteLength,
    animated: false,
    sanitized: asset.sanitized,
    bytes,
  };
}

function verifyRegistration(
  registration: BroadcastAssetRegistration,
): PreparedRegistration {
  const bytes = Buffer.from(registration.bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== registration.sha256) {
    throw new Error('OBS_BRIDGE_ASSET_HASH_MISMATCH');
  }
  const { bytes: _bytes, ...descriptor } = registration;
  return { descriptor, bytes };
}
