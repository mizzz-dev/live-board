import {
  assertLayerDocumentIntegrity,
  cloneLayer,
  cloneLayerDocument,
  findLayer,
  LayerDomainError,
  type LayerDocument,
  type LayerId,
  type RasterLayer,
} from './layers.js';
import type { PageId } from './model.js';

export function mergeLayerSelection(
  document: LayerDocument,
  pageId: PageId,
  sourceLayerIds: readonly LayerId[],
  mergedLayer: RasterLayer,
): LayerDocument {
  const ids = [...new Set(sourceLayerIds)];
  if (ids.length < 2 || ids.length !== sourceLayerIds.length) {
    throw new LayerDomainError(
      'LAYER_MERGE_INVALID',
      'At least two unique layers are required',
    );
  }

  const next = cloneLayerDocument(document);
  const sources = ids.map((id) => findLayer(next, id));
  if (sources.some((layer) => layer.type === 'folder')) {
    throw new LayerDomainError(
      'LAYER_MERGE_INVALID',
      'Folders cannot be merged directly',
    );
  }
  if (sources.some((layer) => layer.editLocked)) {
    throw new LayerDomainError('LAYER_LOCKED', 'Locked layers cannot be merged');
  }

  const firstParentId = sources[0]!.parentId;
  const commonParentId = sources.every(
    (layer) => layer.parentId === firstParentId,
  )
    ? firstParentId
    : null;
  if (mergedLayer.pageId !== pageId || mergedLayer.parentId !== commonParentId) {
    throw new LayerDomainError(
      'LAYER_PAGE_MISMATCH',
      'Merged layer scope mismatch',
    );
  }
  if (next.layers.some((layer) => layer.id === mergedLayer.id)) {
    throw new LayerDomainError(
      'DUPLICATE_LAYER_ID',
      `Duplicate layer id: ${mergedLayer.id}`,
    );
  }

  const sourceSet = new Set(ids);
  const originalCommonSiblings = getSiblingIds(next, commonParentId);
  const commonIndexes = ids.map((id) => originalCommonSiblings.indexOf(id));
  const insertIndex =
    commonParentId !== null || commonIndexes.every((index) => index >= 0)
      ? Math.min(...commonIndexes.filter((index) => index >= 0))
      : next.rootLayerIds.length;

  next.rootLayerIds = next.rootLayerIds.filter((id) => !sourceSet.has(id));
  next.layers = next.layers
    .filter((layer) => !sourceSet.has(layer.id))
    .map((layer) =>
      layer.type === 'folder'
        ? {
            ...layer,
            childLayerIds: layer.childLayerIds.filter(
              (id) => !sourceSet.has(id),
            ),
          }
        : layer,
    );

  const targetSiblings = getSiblingIds(next, commonParentId);
  const safeIndex = Math.max(0, Math.min(insertIndex, targetSiblings.length));
  targetSiblings.splice(safeIndex, 0, mergedLayer.id);
  next.layers.push(
    cloneLayer({
      ...mergedLayer,
      parentId: commonParentId,
      content: {
        ...mergedLayer.content,
        sourceLayerIds: ids,
      },
    }),
  );
  next.activeLayerId = mergedLayer.id;
  assertLayerDocumentIntegrity(pageId, next);
  return next;
}

function getSiblingIds(
  document: LayerDocument,
  parentId: LayerId | null,
): LayerId[] {
  if (parentId === null) {
    return document.rootLayerIds;
  }
  const parent = findLayer(document, parentId);
  if (parent.type !== 'folder') {
    throw new LayerDomainError(
      'LAYER_PARENT_INVALID',
      `Parent is not a folder: ${parentId}`,
    );
  }
  return parent.childLayerIds;
}
