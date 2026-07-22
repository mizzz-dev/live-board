import {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  type BroadcastAsset,
  type BroadcastLayer,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';
import {
  findPage,
  findProject,
  type Page,
  type ProjectId,
  type Workspace,
} from './model.js';
import {
  getLayerDocument,
  listLayersInPaintOrder,
  type Layer,
  type LayerDocument,
} from './layers.js';
import {
  getLayerTransform,
  getRasterDrawing,
} from './canvas-state.js';
import {
  getRichImageContent,
  getRichShapeContent,
  getRichTextContent,
} from './rich-layers.js';
import {
  listReferencedProjectAssets,
  type ProjectAssetLibrary,
} from './assets.js';

export function createBroadcastSnapshot(
  workspace: Workspace,
  projectId: ProjectId,
  revision: number,
  generatedAt = new Date().toISOString(),
  assetLibrary?: ProjectAssetLibrary,
): BroadcastSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid broadcast revision: ${revision}`);
  }
  const project = findProject(workspace, projectId);
  const page = findPage(project, project.activeBroadcastPageId);
  return createPageRenderSnapshot(page, project.id, revision, generatedAt, assetLibrary);
}

export function createPageRenderSnapshot(
  page: Page,
  projectId: ProjectId,
  revision = 0,
  generatedAt = new Date().toISOString(),
  assetLibrary?: ProjectAssetLibrary,
): BroadcastSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid render revision: ${revision}`);
  }
  const document = getLayerDocument(page);
  const layers = createBroadcastLayers(document);
  const assets = assetLibrary === undefined
    ? undefined
    : createBroadcastAssets(layers, assetLibrary);
  return {
    schemaVersion: BROADCAST_SNAPSHOT_SCHEMA_VERSION,
    projectId,
    pageId: page.id,
    pageName: page.name,
    revision,
    generatedAt,
    canvas: {
      width: page.width,
      height: page.height,
      dpi: page.dpi,
      background: page.transparent
        ? { type: 'transparent' }
        : { type: 'color', value: '#FFFFFF' },
    },
    layers,
    ...(assets === undefined ? {} : { assets }),
  };
}

export function createBroadcastLayers(
  document: LayerDocument,
): BroadcastLayer[] {
  const layerMap = new Map(document.layers.map((layer) => [layer.id, layer]));
  const visibleIds = new Set(
    listLayersInPaintOrder(document)
      .filter((layer) => isEffectivelyVisible(layer, layerMap))
      .map((layer) => layer.id),
  );
  return listLayersInPaintOrder(document)
    .filter((layer) => visibleIds.has(layer.id))
    .map((layer) => toBroadcastLayer(layer, visibleIds));
}

export function createBroadcastAssets(
  layers: readonly BroadcastLayer[],
  library: ProjectAssetLibrary,
): BroadcastAsset[] {
  const assetIds = new Set<string>();
  for (const layer of layers) {
    if ((layer.type === 'image' || layer.type === 'raster') && layer.content.assetId !== null) {
      assetIds.add(layer.content.assetId);
    }
  }
  return listReferencedProjectAssets(library, assetIds).map((asset) => ({
    id: asset.id,
    sha256: asset.sha256,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byteLength,
    dataUrl: asset.dataUrl,
    animated: false,
    sanitized: asset.sanitized,
  }));
}

function isEffectivelyVisible(
  layer: Layer,
  layerMap: ReadonlyMap<string, Layer>,
): boolean {
  if (!layer.visible) return false;
  let parentId = layer.parentId;
  let depth = 0;
  while (parentId !== null) {
    if (depth > 128) return false;
    const parent = layerMap.get(parentId);
    if (parent === undefined || parent.type !== 'folder' || !parent.visible) {
      return false;
    }
    parentId = parent.parentId;
    depth += 1;
  }
  return true;
}

function toBroadcastLayer(
  layer: Layer,
  visibleIds: ReadonlySet<string>,
): BroadcastLayer {
  const base = {
    id: layer.id,
    parentId: layer.parentId,
    name: layer.name,
    visible: true as const,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    color: layer.color,
    transform: getLayerTransform(layer),
  };
  if (layer.type === 'folder') {
    return {
      ...base,
      type: 'folder',
      childLayerIds: layer.childLayerIds.filter((id) => visibleIds.has(id)),
    };
  }
  if (layer.type === 'raster') {
    return {
      ...base,
      type: 'raster',
      content: {
        assetId: layer.content.assetId,
        sourceLayerIds: [...layer.content.sourceLayerIds],
        drawing: getRasterDrawing(layer),
      },
    };
  }
  if (layer.type === 'text') {
    return { ...base, type: 'text', content: getRichTextContent(layer) };
  }
  if (layer.type === 'image') {
    return { ...base, type: 'image', content: getRichImageContent(layer) };
  }
  if (layer.type === 'shape') {
    return { ...base, type: 'shape', content: getRichShapeContent(layer) };
  }
  return {
    ...base,
    type: 'background',
    content: { ...layer.content },
  };
}
