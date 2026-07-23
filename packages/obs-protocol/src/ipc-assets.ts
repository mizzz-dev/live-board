import {
  parseBroadcastAsset,
  parseBroadcastSnapshot,
  type BroadcastSnapshot,
  type HttpBroadcastAsset,
  type InlineBroadcastAsset,
} from './protocol-v4.js';

const SYNTHETIC_TOKEN = '0'.repeat(64);
const MAX_SINGLE_ASSET_BYTES = 25 * 1024 * 1024;

export type BroadcastAssetDescriptor = Omit<
  InlineBroadcastAsset,
  'delivery' | 'dataUrl' | 'url'
>;

export interface BroadcastSnapshotDescriptor
  extends Omit<BroadcastSnapshot, 'assets'> {
  assets?: BroadcastAssetDescriptor[];
}

export interface BroadcastAssetRegistration extends BroadcastAssetDescriptor {
  bytes: Uint8Array;
}

export function parseBroadcastAssetDescriptor(
  input: unknown,
): BroadcastAssetDescriptor {
  if (
    !isRecord(input) ||
    input.delivery !== undefined ||
    input.dataUrl !== undefined ||
    input.url !== undefined
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET_DESCRIPTOR');
  }

  const sha256 = typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : '';
  let parsed: HttpBroadcastAsset;
  try {
    parsed = parseBroadcastAsset({
      ...input,
      delivery: 'http',
      url: `/asset/${SYNTHETIC_TOKEN}/${sha256}`,
    }) as HttpBroadcastAsset;
  } catch {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET_DESCRIPTOR');
  }

  return stripAssetSource(parsed);
}

export function parseBroadcastSnapshotDescriptor(
  input: unknown,
): BroadcastSnapshotDescriptor {
  if (!isRecord(input)) {
    throw new Error('OBS_PROTOCOL_INVALID_SNAPSHOT_DESCRIPTOR');
  }

  let descriptors: BroadcastAssetDescriptor[] | undefined;
  if (input.assets !== undefined) {
    if (!Array.isArray(input.assets)) {
      throw new Error('OBS_PROTOCOL_INVALID_SNAPSHOT_DESCRIPTOR');
    }
    descriptors = input.assets.map(parseBroadcastAssetDescriptor);
  }

  try {
    const parsed = parseBroadcastSnapshot({
      ...input,
      ...(descriptors === undefined
        ? {}
        : {
            assets: descriptors.map(toSyntheticHttpAsset),
          }),
    });
    const { assets: _assets, ...snapshotWithoutAssets } = parsed;
    return {
      ...snapshotWithoutAssets,
      ...(descriptors === undefined ? {} : { assets: descriptors }),
    };
  } catch {
    throw new Error('OBS_PROTOCOL_INVALID_SNAPSHOT_DESCRIPTOR');
  }
}

export function parseBroadcastAssetRegistration(
  input: unknown,
): BroadcastAssetRegistration {
  if (!isRecord(input)) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET_REGISTRATION');
  }
  const descriptor = parseBroadcastAssetDescriptor(input);
  if (
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > MAX_SINGLE_ASSET_BYTES ||
    input.bytes.byteLength !== descriptor.byteLength
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_ASSET_REGISTRATION');
  }
  return { ...descriptor, bytes: new Uint8Array(input.bytes) };
}

export function toBroadcastSnapshotDescriptor(
  input: BroadcastSnapshot,
): BroadcastSnapshotDescriptor {
  const snapshot = parseBroadcastSnapshot(input);
  const { assets, ...snapshotWithoutAssets } = snapshot;
  return {
    ...snapshotWithoutAssets,
    ...(assets === undefined
      ? {}
      : { assets: assets.map(stripAssetSource) }),
  };
}

function stripAssetSource(
  asset: InlineBroadcastAsset | HttpBroadcastAsset,
): BroadcastAssetDescriptor {
  return {
    id: asset.id,
    sha256: asset.sha256,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byteLength,
    animated: false,
    sanitized: asset.sanitized,
  };
}

function toSyntheticHttpAsset(
  asset: BroadcastAssetDescriptor,
): HttpBroadcastAsset {
  return {
    ...asset,
    delivery: 'http',
    url: `/asset/${SYNTHETIC_TOKEN}/${asset.sha256}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
