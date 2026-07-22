import {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  type BroadcastLayer,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';
import {
  findPage,
  findProject,
  type ProjectId,
  type Workspace,
} from './model.js';
import {
  getLayerDocument,
  listLayersInPaintOrder,
  type Layer,
  type LayerDocument,
} from './layers.js';

export function createBroadcastSnapshot(
  workspace: Workspace,
  projectId: ProjectId,
  revision: number,
  generatedAt = new Date().toISOString(),
): BroadcastSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid broadcast revision: ${revision}`);
  }

  const project = findProject(workspace, projectId);
  const page = findPage(project, project.activeBroadcastPageId);
  const layerDocument = getLayerDocument(page);

  return {
    schemaVersion: BROADCAST_SNAPSHOT_SCHEMA_VERSION,
    projectId: project.id,
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
    layers: createBroadcastLayers(layerDocument),
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

function isEffectivelyVisible(
  layer: Layer,
  layerMap: ReadonlyMap<string, Layer>,
): boolean {
  if (!layer.visible) {
    return false;
  }

  let parentId = layer.parentId;
  let depth = 0;
  while (parentId !== null) {
    if (depth > 128) {
      return false;
    }
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
      },
    };
  }

  return {
    ...base,
    type: layer.type,
    content: { ...layer.content },
  } as BroadcastLayer;
}
