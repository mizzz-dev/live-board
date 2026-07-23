import {
  isInlineBroadcastAsset,
  type BroadcastAssetMime,
  type BroadcastSnapshot,
  type HttpBroadcastAsset,
  type InlineBroadcastAsset,
} from '@live-board/obs-protocol';
import { createHash } from 'node:crypto';

export const DEFAULT_ASSET_RETENTION_MS = 60_000;
export const DEFAULT_MAX_ASSET_BYTES = 256 * 1024 * 1024;

export interface StoredBroadcastAsset {
  sha256: string;
  mime: BroadcastAssetMime;
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

export class BroadcastAssetRegistry {
  private readonly entries = new Map<string, StoredBroadcastAsset>();
  private readonly maxBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
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

  prepareSnapshot(snapshot: BroadcastSnapshot, token: string): BroadcastSnapshot {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      throw new Error('OBS_BRIDGE_INVALID_ASSET_TOKEN');
    }
    const now = this.now();
    const prepared = (snapshot.assets ?? []).map((asset) => {
      if (!isInlineBroadcastAsset(asset)) {
        throw new Error('OBS_BRIDGE_HTTP_ASSET_INPUT_NOT_ALLOWED');
      }
      return { asset, bytes: decodeAndVerifyAsset(asset) };
    });
    const currentBytes = prepared.reduce((total, item) => total + item.bytes.length, 0);
    if (currentBytes > this.maxBytes) {
      throw new Error('OBS_BRIDGE_ASSET_REGISTRY_LIMIT');
    }

    const currentHashes = new Set<string>();
    for (const item of prepared) {
      currentHashes.add(item.asset.sha256);
      this.upsert(item.asset, item.bytes, now);
    }
    this.prune(currentHashes, now);

    if (snapshot.assets === undefined) return snapshot;
    const assets: HttpBroadcastAsset[] = prepared.map(({ asset }) => ({
      id: asset.id,
      sha256: asset.sha256,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      byteLength: asset.byteLength,
      animated: false,
      sanitized: asset.sanitized,
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
    this.totalBytes = 0;
  }

  private upsert(asset: InlineBroadcastAsset, bytes: Buffer, now: number): void {
    const existing = this.entries.get(asset.sha256);
    if (existing !== undefined) {
      if (
        existing.mime !== asset.mime ||
        existing.byteLength !== asset.byteLength ||
        existing.sanitized !== asset.sanitized
      ) {
        throw new Error('OBS_BRIDGE_ASSET_HASH_METADATA_MISMATCH');
      }
      existing.lastReferencedAt = now;
      return;
    }
    this.entries.set(asset.sha256, {
      sha256: asset.sha256,
      mime: asset.mime,
      byteLength: asset.byteLength,
      bytes,
      sanitized: asset.sanitized,
      lastReferencedAt: now,
    });
    this.totalBytes += bytes.length;
  }

  private prune(currentHashes: ReadonlySet<string>, now: number): void {
    for (const [sha256, entry] of this.entries) {
      if (
        !currentHashes.has(sha256) &&
        now - entry.lastReferencedAt > this.retentionMs
      ) {
        this.delete(sha256);
      }
    }
    if (this.totalBytes <= this.maxBytes) return;

    const removable = [...this.entries.values()]
      .filter((entry) => !currentHashes.has(entry.sha256))
      .sort((a, b) => a.lastReferencedAt - b.lastReferencedAt);
    for (const entry of removable) {
      this.delete(entry.sha256);
      if (this.totalBytes <= this.maxBytes) return;
    }
    if (this.totalBytes > this.maxBytes) {
      throw new Error('OBS_BRIDGE_ASSET_REGISTRY_LIMIT');
    }
  }

  private delete(sha256: string): void {
    const entry = this.entries.get(sha256);
    if (entry === undefined) return;
    this.entries.delete(sha256);
    this.totalBytes -= entry.byteLength;
  }
}

function decodeAndVerifyAsset(asset: InlineBroadcastAsset): Buffer {
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
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) {
    throw new Error('OBS_BRIDGE_ASSET_HASH_MISMATCH');
  }
  return bytes;
}
