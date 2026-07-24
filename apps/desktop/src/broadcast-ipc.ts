import {
  isInlineBroadcastAsset,
  parseBroadcastSnapshot,
  toBroadcastSnapshotDescriptor,
  type BroadcastAsset,
  type BroadcastAssetRegistration,
  type BroadcastSnapshot,
  type BroadcastSnapshotDescriptor,
  type InlineBroadcastAsset,
} from '@live-board/obs-protocol';

export interface BroadcastAssetRegistrationResponse {
  requestId: string;
  registeredSha256: string[];
}

export interface BroadcastPublishResponse {
  requestId: string;
  acceptedRevision: number;
}

export interface BroadcastIpcApi {
  registerBroadcastAssets(
    requestId: string,
    assets: BroadcastAssetRegistration[],
  ): Promise<BroadcastAssetRegistrationResponse>;
  publishBroadcastSnapshot(
    requestId: string,
    snapshot: BroadcastSnapshotDescriptor,
  ): Promise<BroadcastPublishResponse>;
}

export interface BroadcastIpcPayload {
  snapshot: BroadcastSnapshotDescriptor;
  registrations: BroadcastAssetRegistration[];
}

export function createBroadcastIpcPayload(
  input: BroadcastSnapshot,
  registeredSha256: ReadonlySet<string>,
): BroadcastIpcPayload {
  const snapshot = parseBroadcastSnapshot(input);
  const registrations = (snapshot.assets ?? [])
    .filter((asset) => !registeredSha256.has(asset.sha256))
    .map(createRegistration);
  return {
    snapshot: toBroadcastSnapshotDescriptor(snapshot),
    registrations,
  };
}

export async function publishBroadcastSnapshotWithAssets(
  api: BroadcastIpcApi,
  requestId: string,
  input: BroadcastSnapshot,
  registeredSha256: Set<string>,
): Promise<BroadcastPublishResponse> {
  const payload = createBroadcastIpcPayload(input, registeredSha256);
  if (payload.registrations.length > 0) {
    const registrationResponse = await api.registerBroadcastAssets(
      `${requestId}_assets`,
      payload.registrations,
    );
    for (const sha256 of registrationResponse.registeredSha256) {
      registeredSha256.add(sha256);
    }
  }

  try {
    return await api.publishBroadcastSnapshot(requestId, payload.snapshot);
  } catch (error: unknown) {
    if (!isMissingRegisteredAssetError(error) || (input.assets?.length ?? 0) === 0) {
      throw error;
    }
    const retryRegistrations = (parseBroadcastSnapshot(input).assets ?? []).map(
      createRegistration,
    );
    const registrationResponse = await api.registerBroadcastAssets(
      `${requestId}_retry`,
      retryRegistrations,
    );
    registeredSha256.clear();
    for (const sha256 of registrationResponse.registeredSha256) {
      registeredSha256.add(sha256);
    }
    return api.publishBroadcastSnapshot(requestId, payload.snapshot);
  }
}

function createRegistration(asset: BroadcastAsset): BroadcastAssetRegistration {
  if (!isInlineBroadcastAsset(asset)) {
    throw new Error('BROADCAST_IPC_ASSET_SOURCE_UNAVAILABLE');
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
    bytes: decodeInlineAsset(asset),
  };
}

function decodeInlineAsset(asset: InlineBroadcastAsset): Uint8Array {
  const prefix = `data:${asset.mime};base64,`;
  if (!asset.dataUrl.startsWith(prefix)) {
    throw new Error('BROADCAST_IPC_INVALID_ASSET_DATA_URL');
  }
  const binary = globalThis.atob(asset.dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength !== asset.byteLength) {
    throw new Error('BROADCAST_IPC_INVALID_ASSET_DATA_URL');
  }
  return bytes;
}

function isMissingRegisteredAssetError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('OBS_BRIDGE_ASSET_NOT_REGISTERED')
  );
}
