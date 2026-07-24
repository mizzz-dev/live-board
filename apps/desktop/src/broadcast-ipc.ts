import {
  createBroadcastLayerPatchDescriptor,
  isInlineBroadcastAsset,
  parseBroadcastSnapshot,
  toBroadcastSnapshotDescriptor,
  type BroadcastAsset,
  type BroadcastAssetRegistration,
  type BroadcastLayerPatchDescriptor,
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
  publishBroadcastLayerPatch?(
    requestId: string,
    patch: BroadcastLayerPatchDescriptor,
  ): Promise<BroadcastPublishResponse>;
}

export interface BroadcastIpcPayload {
  snapshot: BroadcastSnapshotDescriptor;
  registrations: BroadcastAssetRegistration[];
}

export type BroadcastIpcUpdate =
  | { type: 'snapshot'; snapshot: BroadcastSnapshotDescriptor }
  | { type: 'layer.patch'; patch: BroadcastLayerPatchDescriptor };

const lastPublishedSnapshots = new WeakMap<
  Set<string>,
  BroadcastSnapshotDescriptor
>();

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

export function createBroadcastIpcUpdate(
  previous: BroadcastSnapshotDescriptor | undefined,
  next: BroadcastSnapshotDescriptor,
  patchSupported = true,
): BroadcastIpcUpdate {
  if (!patchSupported || previous === undefined) {
    return { type: 'snapshot', snapshot: next };
  }

  const patch = createBroadcastLayerPatchDescriptor(previous, next);
  if (patch === null) return { type: 'snapshot', snapshot: next };

  const patchBytes = serializedBytes({ type: 'layer.patch', patch });
  const snapshotBytes = serializedBytes({ type: 'snapshot', snapshot: next });
  return patchBytes < snapshotBytes
    ? { type: 'layer.patch', patch }
    : { type: 'snapshot', snapshot: next };
}

export async function publishBroadcastSnapshotWithAssets(
  api: BroadcastIpcApi,
  requestId: string,
  input: BroadcastSnapshot,
  registeredSha256: Set<string>,
): Promise<BroadcastPublishResponse> {
  const payload = createBroadcastIpcPayload(input, registeredSha256);
  await registerAssetsIfNeeded(
    api,
    `${requestId}_assets`,
    payload.registrations,
    registeredSha256,
  );

  let update = createBroadcastIpcUpdate(
    lastPublishedSnapshots.get(registeredSha256),
    payload.snapshot,
    api.publishBroadcastLayerPatch !== undefined,
  );
  let assetRetryUsed = false;
  let fullSnapshotFallbackUsed = update.type === 'snapshot';

  while (true) {
    try {
      const response = await publishUpdate(api, requestId, update);
      lastPublishedSnapshots.set(registeredSha256, payload.snapshot);
      return response;
    } catch (error: unknown) {
      if (
        !assetRetryUsed &&
        isMissingRegisteredAssetError(error) &&
        (input.assets?.length ?? 0) > 0
      ) {
        const retryRegistrations = (
          parseBroadcastSnapshot(input).assets ?? []
        ).map(createRegistration);
        registeredSha256.clear();
        await registerAssetsIfNeeded(
          api,
          `${requestId}_retry`,
          retryRegistrations,
          registeredSha256,
        );
        assetRetryUsed = true;
        continue;
      }

      if (
        update.type === 'layer.patch' &&
        !fullSnapshotFallbackUsed &&
        isPatchFallbackError(error)
      ) {
        update = { type: 'snapshot', snapshot: payload.snapshot };
        fullSnapshotFallbackUsed = true;
        continue;
      }

      throw error;
    }
  }
}

async function registerAssetsIfNeeded(
  api: BroadcastIpcApi,
  requestId: string,
  registrations: BroadcastAssetRegistration[],
  registeredSha256: Set<string>,
): Promise<void> {
  if (registrations.length === 0) return;
  const response = await api.registerBroadcastAssets(requestId, registrations);
  for (const sha256 of response.registeredSha256) {
    registeredSha256.add(sha256);
  }
}

function publishUpdate(
  api: BroadcastIpcApi,
  requestId: string,
  update: BroadcastIpcUpdate,
): Promise<BroadcastPublishResponse> {
  if (update.type === 'layer.patch') {
    const publishPatch = api.publishBroadcastLayerPatch;
    if (publishPatch === undefined) {
      throw new Error('BROADCAST_IPC_LAYER_PATCH_UNAVAILABLE');
    }
    return publishPatch(requestId, update.patch);
  }
  return api.publishBroadcastSnapshot(requestId, update.snapshot);
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

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isMissingRegisteredAssetError(error: unknown): boolean {
  return errorMessageIncludes(error, 'OBS_BRIDGE_ASSET_NOT_REGISTERED');
}

function isPatchFallbackError(error: unknown): boolean {
  return [
    'IPC_BROADCAST_SNAPSHOT_REQUIRED',
    'OBS_PROTOCOL_LAYER_PATCH_BASE_REVISION_MISMATCH',
    'OBS_PROTOCOL_LAYER_PATCH_PAGE_MISMATCH',
    'OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH',
  ].some((message) => errorMessageIncludes(error, message));
}

function errorMessageIncludes(error: unknown, expected: string): boolean {
  return error instanceof Error && error.message.includes(expected);
}
