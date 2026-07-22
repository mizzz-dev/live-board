import {
  WORKSPACE_SCHEMA_VERSION,
  assertLayerDocumentIntegrity,
  assertWorkspaceIntegrity,
  createProjectAssetLibrary,
  getLayerDocument,
  getLayerTransform,
  getRasterDrawing,
  getRichImageContent,
  getRichShapeContent,
  getRichTextContent,
  type Layer,
  type ProjectAsset,
  type ProjectAssetLibrary,
  type ProjectAssetMime,
  type Workspace,
} from '@live-board/domain';
import { sha256Hex } from './hash.js';
import {
  ArchiveValidationError,
  assertSafeArchivePath,
  createStoredZip,
  readStoredZip,
} from './zip.js';

export const LIVEBOARD_ARCHIVE_FORMAT = 'liveboard' as const;
export const LIVEBOARD_ARCHIVE_SCHEMA_VERSION = 1 as const;
export const LIVEBOARD_MANIFEST_PATH = 'manifest.json' as const;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_ASSET_LIBRARIES = 1_024;
export const MAX_ARCHIVE_ASSETS = 4_000;

export interface PersistedProjectAsset {
  id: string;
  sha256: string;
  mime: ProjectAssetMime;
  width: number;
  height: number;
  byteLength: number;
  archivePath: string;
  fileNames: string[];
  animated: false;
  sanitized: boolean;
  createdAt: string;
}

export interface PersistedProjectAssetLibrary {
  assets: PersistedProjectAsset[];
  totalBytes: number;
}

export interface LiveboardManifestV1 {
  format: typeof LIVEBOARD_ARCHIVE_FORMAT;
  schemaVersion: typeof LIVEBOARD_ARCHIVE_SCHEMA_VERSION;
  workspaceSchemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  appVersion: string;
  createdAt: string;
  savedAt: string;
  workspace: Workspace;
  assetLibraries: Record<string, PersistedProjectAssetLibrary>;
}

export interface LiveboardBundle {
  workspace: Workspace;
  assetLibraries: Record<string, ProjectAssetLibrary>;
}

export interface CreateLiveboardArchiveOptions extends LiveboardBundle {
  appVersion?: string;
  savedAt?: string;
}

export interface LoadLiveboardArchiveOptions {
  existingWorkspaceIds?: ReadonlySet<string>;
  collisionWorkspaceId?: string;
  duplicatedAt?: string;
}

export interface LoadLiveboardArchiveResult extends LiveboardBundle {
  manifest: LiveboardManifestV1;
  archiveSha256: string;
  migratedFromVersion: number | null;
  duplicatedBecauseOfCollision: boolean;
}

export type PersistenceErrorCode =
  | 'MANIFEST_MISSING'
  | 'MANIFEST_TOO_LARGE'
  | 'MANIFEST_INVALID_JSON'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_UNKNOWN_SCHEMA'
  | 'MANIFEST_PROJECT_LIBRARY_LIMIT'
  | 'MANIFEST_ASSET_LIMIT'
  | 'ASSET_ENTRY_MISSING'
  | 'ASSET_ENTRY_UNEXPECTED'
  | 'ASSET_SIZE_MISMATCH'
  | 'ASSET_HASH_MISMATCH'
  | 'ASSET_DATA_URL_INVALID'
  | 'ASSET_REFERENCE_INVALID'
  | 'WORKSPACE_ID_COLLISION'
  | 'DUPLICATE_WORKSPACE_ID_INVALID';

export class PersistenceValidationError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = 'PersistenceValidationError';
    this.code = code;
  }
}

export function createLiveboardArchive(
  options: CreateLiveboardArchiveOptions,
): Uint8Array {
  const savedAt = options.savedAt ?? new Date().toISOString();
  const workspace = cloneJson(options.workspace);
  validateWorkspace(workspace);
  const assetEntries = new Map<string, Uint8Array>();
  const persistedLibraries: Record<string, PersistedProjectAssetLibrary> = {};
  let totalAssets = 0;

  for (const project of workspace.projects) {
    const library = options.assetLibraries[project.id] ?? createProjectAssetLibrary();
    const persistedAssets: PersistedProjectAsset[] = [];
    let totalBytes = 0;

    for (const asset of library.assets) {
      const bytes = decodeAssetDataUrl(asset);
      assertAssetBinary(asset, bytes);
      const archivePath = assetArchivePath(asset);
      const existing = assetEntries.get(archivePath);
      if (existing !== undefined && !bytesEqual(existing, bytes)) {
        throw persistenceError(
          'ASSET_HASH_MISMATCH',
          `同じAssetパスに異なる内容があります: ${archivePath}`,
        );
      }
      assetEntries.set(archivePath, bytes);
      persistedAssets.push(toPersistedAsset(asset, archivePath));
      totalBytes += bytes.byteLength;
      totalAssets += 1;
    }

    if (totalBytes !== library.totalBytes) {
      throw persistenceError(
        'ASSET_SIZE_MISMATCH',
        `Asset合計サイズが一致しません: ${project.id}`,
      );
    }
    persistedLibraries[project.id] = {
      assets: persistedAssets,
      totalBytes,
    };
  }

  if (workspace.projects.length > MAX_PROJECT_ASSET_LIBRARIES) {
    throw persistenceError(
      'MANIFEST_PROJECT_LIBRARY_LIMIT',
      'Project Asset Library数が上限を超えています',
    );
  }
  if (totalAssets > MAX_ARCHIVE_ASSETS) {
    throw persistenceError('MANIFEST_ASSET_LIMIT', 'Asset数が上限を超えています');
  }
  validateAssetReferences(workspace, options.assetLibraries);

  const manifest: LiveboardManifestV1 = {
    format: LIVEBOARD_ARCHIVE_FORMAT,
    schemaVersion: LIVEBOARD_ARCHIVE_SCHEMA_VERSION,
    workspaceSchemaVersion: WORKSPACE_SCHEMA_VERSION,
    appVersion: normalizeAppVersion(options.appVersion ?? '0.1.0'),
    createdAt: workspace.createdAt,
    savedAt: normalizeTimestamp(savedAt, 'savedAt'),
    workspace,
    assetLibraries: persistedLibraries,
  };
  const manifestBytes = encodeUtf8(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw persistenceError('MANIFEST_TOO_LARGE', 'manifest.jsonが16MBを超えています');
  }

  const entries = [
    { path: LIVEBOARD_MANIFEST_PATH, bytes: manifestBytes },
    ...[...assetEntries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => ({ path, bytes })),
  ];
  return createStoredZip(entries, new Date(manifest.savedAt));
}

export function loadLiveboardArchive(
  archive: Uint8Array,
  options: LoadLiveboardArchiveOptions = {},
): LoadLiveboardArchiveResult {
  const entries = readStoredZip(archive);
  const manifestBytes = entries.get(LIVEBOARD_MANIFEST_PATH);
  if (manifestBytes === undefined) {
    throw persistenceError('MANIFEST_MISSING', 'manifest.jsonがありません');
  }
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw persistenceError('MANIFEST_TOO_LARGE', 'manifest.jsonが16MBを超えています');
  }

  const rawManifest = parseJson(manifestBytes);
  const migration = migrateManifest(rawManifest);
  const manifest = parseManifestV1(migration.manifest);
  const assetLibraries = restoreAssetLibraries(manifest, entries);
  validateWorkspace(manifest.workspace);
  validateAssetReferences(manifest.workspace, assetLibraries);

  const expectedPaths = new Set<string>([LIVEBOARD_MANIFEST_PATH]);
  for (const library of Object.values(manifest.assetLibraries)) {
    for (const asset of library.assets) expectedPaths.add(asset.archivePath);
  }
  for (const path of entries.keys()) {
    if (!expectedPaths.has(path)) {
      throw persistenceError('ASSET_ENTRY_UNEXPECTED', `未参照エントリがあります: ${path}`);
    }
  }

  const bundle: LiveboardBundle = {
    workspace: cloneJson(manifest.workspace),
    assetLibraries,
  };
  const collides = options.existingWorkspaceIds?.has(bundle.workspace.id) ?? false;
  let loadedBundle = bundle;
  if (collides) {
    if (options.collisionWorkspaceId === undefined) {
      throw persistenceError(
        'WORKSPACE_ID_COLLISION',
        `Workspace IDが既存データと重複しています: ${bundle.workspace.id}`,
      );
    }
    loadedBundle = duplicateLiveboardBundle(
      bundle,
      options.collisionWorkspaceId,
      options.duplicatedAt,
    );
  }

  return {
    ...loadedBundle,
    manifest,
    archiveSha256: sha256Hex(archive),
    migratedFromVersion: migration.migratedFromVersion,
    duplicatedBecauseOfCollision: collides,
  };
}

export function duplicateLiveboardBundle(
  bundle: LiveboardBundle,
  newWorkspaceId: string,
  duplicatedAt = new Date().toISOString(),
): LiveboardBundle {
  assertEntityId(newWorkspaceId, 'Workspace ID');
  if (newWorkspaceId === bundle.workspace.id) {
    throw persistenceError(
      'DUPLICATE_WORKSPACE_ID_INVALID',
      '複製後のWorkspace IDは元のIDと異なる必要があります',
    );
  }
  const timestamp = normalizeTimestamp(duplicatedAt, 'duplicatedAt');
  const workspace = cloneJson(bundle.workspace);
  const projectIdMap = new Map<string, string>();
  const pageIdMap = new Map<string, string>();
  const layerIdMap = new Map<string, string>();
  let pageSequence = 1;
  let layerSequence = 1;

  workspace.projects.forEach((project, projectIndex) => {
    projectIdMap.set(project.id, `${newWorkspaceId}:project:${projectIndex + 1}`);
    for (const page of project.pages) {
      pageIdMap.set(page.id, `${newWorkspaceId}:page:${pageSequence}`);
      pageSequence += 1;
      for (const layer of getLayerDocument(page).layers) {
        layerIdMap.set(layer.id, `${newWorkspaceId}:layer:${layerSequence}`);
        layerSequence += 1;
      }
    }
  });

  workspace.id = newWorkspaceId;
  workspace.name = `${workspace.name} のコピー`.slice(0, 120);
  workspace.activeProjectId = projectIdMap.get(workspace.activeProjectId)!;
  workspace.createdAt = timestamp;
  workspace.updatedAt = timestamp;
  workspace.projects = workspace.projects.map((project) => {
    const oldProjectId = project.id;
    const projectId = projectIdMap.get(oldProjectId)!;
    return {
      ...project,
      id: projectId,
      workspaceId: newWorkspaceId,
      activeEditPageId: pageIdMap.get(project.activeEditPageId)!,
      activeBroadcastPageId: pageIdMap.get(project.activeBroadcastPageId)!,
      createdAt: timestamp,
      updatedAt: timestamp,
      pages: project.pages.map((page) => {
        const pageId = pageIdMap.get(page.id)!;
        const document = getLayerDocument(page);
        return {
          ...page,
          id: pageId,
          projectId,
          createdAt: timestamp,
          updatedAt: timestamp,
          layerDocument: {
            rootLayerIds: document.rootLayerIds.map((id) => layerIdMap.get(id)!),
            activeLayerId:
              document.activeLayerId === null
                ? null
                : layerIdMap.get(document.activeLayerId)!,
            layers: document.layers.map((layer) =>
              rekeyLayer(layer, pageId, layerIdMap, timestamp),
            ),
          },
        };
      }),
    };
  });

  const assetLibraries: Record<string, ProjectAssetLibrary> = {};
  for (const [oldProjectId, library] of Object.entries(bundle.assetLibraries)) {
    const projectId = projectIdMap.get(oldProjectId);
    if (projectId !== undefined) {
      assetLibraries[projectId] = cloneAssetLibrary(library);
    }
  }
  for (const project of workspace.projects) {
    assetLibraries[project.id] ??= createProjectAssetLibrary();
  }
  validateWorkspace(workspace);
  validateAssetReferences(workspace, assetLibraries);
  return { workspace, assetLibraries };
}

export function migrateManifest(input: unknown): {
  manifest: unknown;
  migratedFromVersion: number | null;
} {
  if (!isRecord(input)) {
    throw persistenceError('MANIFEST_INVALID', 'manifestのルートがオブジェクトではありません');
  }
  const version = input.schemaVersion;
  if (version === LIVEBOARD_ARCHIVE_SCHEMA_VERSION) {
    return { manifest: input, migratedFromVersion: null };
  }
  if (version === 0) {
    const workspace = input.workspace;
    const createdAt = isRecord(workspace) && typeof workspace.createdAt === 'string'
      ? workspace.createdAt
      : new Date(0).toISOString();
    return {
      manifest: {
        format: LIVEBOARD_ARCHIVE_FORMAT,
        schemaVersion: LIVEBOARD_ARCHIVE_SCHEMA_VERSION,
        workspaceSchemaVersion: WORKSPACE_SCHEMA_VERSION,
        appVersion: typeof input.appVersion === 'string' ? input.appVersion : '0.0.0',
        createdAt,
        savedAt: typeof input.savedAt === 'string' ? input.savedAt : createdAt,
        workspace,
        assetLibraries: input.assetLibraries ?? {},
      },
      migratedFromVersion: 0,
    };
  }
  throw persistenceError(
    'MANIFEST_UNKNOWN_SCHEMA',
    `未対応のmanifest schemaVersionです: ${String(version)}`,
  );
}

function parseManifestV1(input: unknown): LiveboardManifestV1 {
  if (!isRecord(input)) throw persistenceError('MANIFEST_INVALID', 'manifestが不正です');
  if (input.format !== LIVEBOARD_ARCHIVE_FORMAT) {
    throw persistenceError('MANIFEST_INVALID', 'manifest formatが不正です');
  }
  if (input.schemaVersion !== LIVEBOARD_ARCHIVE_SCHEMA_VERSION) {
    throw persistenceError('MANIFEST_UNKNOWN_SCHEMA', 'manifest schemaVersionが不正です');
  }
  if (input.workspaceSchemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw persistenceError(
      'MANIFEST_UNKNOWN_SCHEMA',
      `未対応のWorkspace schemaVersionです: ${String(input.workspaceSchemaVersion)}`,
    );
  }
  const appVersion = normalizeAppVersion(input.appVersion);
  const createdAt = normalizeTimestamp(input.createdAt, 'createdAt');
  const savedAt = normalizeTimestamp(input.savedAt, 'savedAt');
  const workspace = cloneJson(input.workspace as Workspace);
  const assetLibraries = parsePersistedLibraries(input.assetLibraries);
  return {
    format: LIVEBOARD_ARCHIVE_FORMAT,
    schemaVersion: LIVEBOARD_ARCHIVE_SCHEMA_VERSION,
    workspaceSchemaVersion: WORKSPACE_SCHEMA_VERSION,
    appVersion,
    createdAt,
    savedAt,
    workspace,
    assetLibraries,
  };
}

function parsePersistedLibraries(input: unknown): Record<string, PersistedProjectAssetLibrary> {
  if (!isRecord(input)) {
    throw persistenceError('MANIFEST_INVALID', 'assetLibrariesが不正です');
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_PROJECT_ASSET_LIBRARIES) {
    throw persistenceError(
      'MANIFEST_PROJECT_LIBRARY_LIMIT',
      'Project Asset Library数が上限を超えています',
    );
  }
  let assetCount = 0;
  const result: Record<string, PersistedProjectAssetLibrary> = {};
  for (const [projectId, rawLibrary] of entries) {
    assertEntityId(projectId, 'Project ID');
    if (!isRecord(rawLibrary) || !Array.isArray(rawLibrary.assets)) {
      throw persistenceError('MANIFEST_INVALID', `Asset Libraryが不正です: ${projectId}`);
    }
    const assets = rawLibrary.assets.map((asset) => parsePersistedAsset(asset));
    assetCount += assets.length;
    if (assetCount > MAX_ARCHIVE_ASSETS) {
      throw persistenceError('MANIFEST_ASSET_LIMIT', 'Asset数が上限を超えています');
    }
    const totalBytes = parseSafeInteger(rawLibrary.totalBytes, 0, 256 * 1024 * 1024);
    if (assets.reduce((total, asset) => total + asset.byteLength, 0) !== totalBytes) {
      throw persistenceError('ASSET_SIZE_MISMATCH', `Asset合計サイズが一致しません: ${projectId}`);
    }
    result[projectId] = { assets, totalBytes };
  }
  return result;
}

function parsePersistedAsset(input: unknown): PersistedProjectAsset {
  if (!isRecord(input)) throw persistenceError('MANIFEST_INVALID', 'Asset定義が不正です');
  const sha256 = parseSha256(input.sha256);
  const id = parseString(input.id, 1, 166);
  if (id !== `asset:${sha256}`) {
    throw persistenceError('ASSET_HASH_MISMATCH', `Asset IDとSHA-256が一致しません: ${id}`);
  }
  const mime = parseMime(input.mime);
  const archivePath = parseString(input.archivePath, 1, 240);
  assertSafeArchivePath(archivePath);
  if (archivePath !== `assets/${sha256}.${extensionForMime(mime)}`) {
    throw persistenceError('MANIFEST_INVALID', `Assetパスが規約と一致しません: ${archivePath}`);
  }
  const fileNames = parseFileNames(input.fileNames);
  const sanitized = parseBoolean(input.sanitized);
  if (mime === 'image/svg+xml' && !sanitized) {
    throw persistenceError('MANIFEST_INVALID', 'SVG Assetはサニタイズ済みである必要があります');
  }
  return {
    id,
    sha256,
    mime,
    width: parseFiniteNumber(input.width, 1, 16_384),
    height: parseFiniteNumber(input.height, 1, 16_384),
    byteLength: parseSafeInteger(input.byteLength, 1, 25 * 1024 * 1024),
    archivePath,
    fileNames,
    animated: parseFalse(input.animated),
    sanitized,
    createdAt: normalizeTimestamp(input.createdAt, 'Asset createdAt'),
  };
}

function restoreAssetLibraries(
  manifest: LiveboardManifestV1,
  entries: ReadonlyMap<string, Uint8Array>,
): Record<string, ProjectAssetLibrary> {
  const result: Record<string, ProjectAssetLibrary> = {};
  for (const project of manifest.workspace.projects) {
    const persisted = manifest.assetLibraries[project.id] ?? { assets: [], totalBytes: 0 };
    const assets = persisted.assets.map((asset) => {
      const bytes = entries.get(asset.archivePath);
      if (bytes === undefined) {
        throw persistenceError('ASSET_ENTRY_MISSING', `Assetファイルがありません: ${asset.archivePath}`);
      }
      if (bytes.byteLength !== asset.byteLength) {
        throw persistenceError('ASSET_SIZE_MISMATCH', `Assetサイズが一致しません: ${asset.id}`);
      }
      if (sha256Hex(bytes) !== asset.sha256) {
        throw persistenceError('ASSET_HASH_MISMATCH', `Asset SHA-256が一致しません: ${asset.id}`);
      }
      const { archivePath: _archivePath, ...metadata } = asset;
      return {
        ...metadata,
        dataUrl: `data:${asset.mime};base64,${bytesToBase64(bytes)}`,
        fileNames: [...asset.fileNames],
      } satisfies ProjectAsset;
    });
    result[project.id] = {
      assets,
      totalBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
    };
  }
  return result;
}

function validateWorkspace(workspace: Workspace): void {
  if (workspace.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw persistenceError(
      'MANIFEST_UNKNOWN_SCHEMA',
      `未対応のWorkspace schemaVersionです: ${String(workspace.schemaVersion)}`,
    );
  }
  assertWorkspaceIntegrity(workspace);
  for (const project of workspace.projects) {
    for (const page of project.pages) {
      const document = getLayerDocument(page);
      assertLayerDocumentIntegrity(page.id, document);
      for (const layer of document.layers) validateLayer(layer);
    }
  }
}

function validateLayer(layer: Layer): void {
  if (layer.type !== 'folder') getLayerTransform(layer);
  if (layer.type === 'raster') getRasterDrawing(layer);
  if (layer.type === 'text') getRichTextContent(layer);
  if (layer.type === 'image') getRichImageContent(layer);
  if (layer.type === 'shape') getRichShapeContent(layer);
}

function validateAssetReferences(
  workspace: Workspace,
  libraries: Record<string, ProjectAssetLibrary>,
): void {
  for (const project of workspace.projects) {
    const assetIds = new Set((libraries[project.id]?.assets ?? []).map((asset) => asset.id));
    for (const page of project.pages) {
      for (const layer of getLayerDocument(page).layers) {
        const assetId = layer.type === 'image'
          ? getRichImageContent(layer).assetId
          : layer.type === 'raster'
            ? layer.content.assetId
            : null;
        if (assetId !== null && !assetIds.has(assetId)) {
          throw persistenceError(
            'ASSET_REFERENCE_INVALID',
            `Layerが存在しないAssetを参照しています: ${layer.id} -> ${assetId}`,
          );
        }
      }
    }
  }
}

function decodeAssetDataUrl(asset: ProjectAsset): Uint8Array {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.dataUrl);
  if (match === null || match[1] !== asset.mime) {
    throw persistenceError('ASSET_DATA_URL_INVALID', `Asset data URLが不正です: ${asset.id}`);
  }
  try {
    return base64ToBytes(match[2]!);
  } catch {
    throw persistenceError('ASSET_DATA_URL_INVALID', `Asset Base64が不正です: ${asset.id}`);
  }
}

function assertAssetBinary(asset: ProjectAsset, bytes: Uint8Array): void {
  const sha256 = sha256Hex(bytes);
  if (sha256 !== asset.sha256 || asset.id !== `asset:${sha256}`) {
    throw persistenceError('ASSET_HASH_MISMATCH', `Asset SHA-256が一致しません: ${asset.id}`);
  }
  if (bytes.byteLength !== asset.byteLength) {
    throw persistenceError('ASSET_SIZE_MISMATCH', `Assetサイズが一致しません: ${asset.id}`);
  }
  if (asset.fileNames.length < 1 || asset.fileNames.length > 100) {
    throw persistenceError('MANIFEST_INVALID', `Assetファイル名一覧が不正です: ${asset.id}`);
  }
}

function toPersistedAsset(asset: ProjectAsset, archivePath: string): PersistedProjectAsset {
  return {
    id: asset.id,
    sha256: asset.sha256,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byteLength,
    archivePath,
    fileNames: [...asset.fileNames],
    animated: false,
    sanitized: asset.sanitized,
    createdAt: asset.createdAt,
  };
}

function assetArchivePath(asset: ProjectAsset): string {
  return `assets/${asset.sha256}.${extensionForMime(asset.mime)}`;
}

function extensionForMime(mime: ProjectAssetMime): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/svg+xml': return 'svg';
  }
}

function rekeyLayer(
  layer: Layer,
  pageId: string,
  idMap: ReadonlyMap<string, string>,
  timestamp: string,
): Layer {
  const id = idMap.get(layer.id)!;
  const parentId = layer.parentId === null ? null : idMap.get(layer.parentId)!;
  const common = {
    ...cloneJson(layer),
    id,
    pageId,
    parentId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (layer.type === 'folder') {
    return {
      ...common,
      type: 'folder',
      childLayerIds: layer.childLayerIds.map((childId) => idMap.get(childId)!),
    };
  }
  if (layer.type === 'raster') {
    return {
      ...common,
      type: 'raster',
      content: {
        ...cloneJson(layer.content),
        sourceLayerIds: layer.content.sourceLayerIds.map((sourceId) => idMap.get(sourceId) ?? sourceId),
      },
    };
  }
  return common as Layer;
}

function cloneAssetLibrary(library: ProjectAssetLibrary): ProjectAssetLibrary {
  return {
    assets: library.assets.map((asset) => ({
      ...asset,
      fileNames: [...asset.fileNames],
    })),
    totalBytes: library.totalBytes,
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw persistenceError('MANIFEST_INVALID_JSON', 'manifest.jsonを解析できません');
  }
}

function parseMime(input: unknown): ProjectAssetMime {
  if (
    input === 'image/png' ||
    input === 'image/jpeg' ||
    input === 'image/webp' ||
    input === 'image/gif' ||
    input === 'image/svg+xml'
  ) return input;
  throw persistenceError('MANIFEST_INVALID', `未対応のAsset MIMEです: ${String(input)}`);
}

function parseFileNames(input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw persistenceError('MANIFEST_INVALID', 'Assetファイル名一覧が不正です');
  }
  const names = input.map((name) => parseString(name, 1, 255));
  if (new Set(names).size !== names.length) {
    throw persistenceError('MANIFEST_INVALID', 'Assetファイル名が重複しています');
  }
  return names;
}

function parseSha256(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) {
    throw persistenceError('MANIFEST_INVALID', 'SHA-256が不正です');
  }
  return input;
}

function parseString(input: unknown, min: number, max: number): string {
  if (typeof input !== 'string' || input.length < min || input.length > max) {
    throw persistenceError('MANIFEST_INVALID', '文字列項目が不正です');
  }
  return input;
}

function parseBoolean(input: unknown): boolean {
  if (typeof input !== 'boolean') {
    throw persistenceError('MANIFEST_INVALID', 'boolean項目が不正です');
  }
  return input;
}

function parseFalse(input: unknown): false {
  if (input !== false) {
    throw persistenceError('MANIFEST_INVALID', 'animatedはfalseである必要があります');
  }
  return false;
}

function parseSafeInteger(input: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < min || (input as number) > max) {
    throw persistenceError('MANIFEST_INVALID', '整数項目が不正です');
  }
  return input as number;
}

function parseFiniteNumber(input: unknown, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) {
    throw persistenceError('MANIFEST_INVALID', '数値項目が不正です');
  }
  return input;
}

function normalizeTimestamp(input: unknown, field: string): string {
  if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) {
    throw persistenceError('MANIFEST_INVALID', `${field}が不正です`);
  }
  return input;
}

function normalizeAppVersion(input: unknown): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 40 || !/^[0-9A-Za-z.+_-]+$/.test(input)) {
    throw persistenceError('MANIFEST_INVALID', 'appVersionが不正です');
  }
  return input;
}

function assertEntityId(input: string, label: string): void {
  if (input.length < 1 || input.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(input)) {
    throw persistenceError('DUPLICATE_WORKSPACE_ID_INVALID', `${label}が不正です: ${input}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function base64ToBytes(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Invalid base64');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const chars = value.slice(index, index + 4);
    const a = alphabet.indexOf(chars[0]!);
    const b = alphabet.indexOf(chars[1]!);
    const c = chars[2] === '=' ? 0 : alphabet.indexOf(chars[2]!);
    const d = chars[3] === '=' ? 0 : alphabet.indexOf(chars[3]!);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid base64');
    output.push((a << 2) | (b >> 4));
    if (chars[2] !== '=') output.push(((b & 15) << 4) | (c >> 2));
    if (chars[3] !== '=') output.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(output);
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? '=' : alphabet[c & 63];
  }
  return output;
}

function persistenceError(
  code: PersistenceErrorCode,
  message: string,
): PersistenceValidationError {
  return new PersistenceValidationError(code, message);
}

export { ArchiveValidationError };
