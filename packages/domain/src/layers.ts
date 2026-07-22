import { DomainError, type Page, type PageId } from './model.js';

export type LayerId = string;
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay';
export type LayerType =
  | 'raster'
  | 'text'
  | 'image'
  | 'shape'
  | 'background'
  | 'folder';

export interface LayerBase {
  id: LayerId;
  pageId: PageId;
  parentId: LayerId | null;
  name: string;
  type: LayerType;
  visible: boolean;
  editLocked: boolean;
  movementLocked: boolean;
  alphaLocked: boolean;
  opacity: number;
  blendMode: BlendMode;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RasterLayer extends LayerBase {
  type: 'raster';
  content: {
    assetId: string | null;
    sourceLayerIds: LayerId[];
  };
}

export interface TextLayer extends LayerBase {
  type: 'text';
  content: {
    text: string;
    fontFamily: string;
    fontSize: number;
    color: string;
  };
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  content: {
    assetId: string | null;
    width: number;
    height: number;
  };
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  content: {
    shape: 'rectangle' | 'ellipse' | 'line';
    fill: string | null;
    stroke: string;
    strokeWidth: number;
  };
}

export interface BackgroundLayer extends LayerBase {
  type: 'background';
  content: {
    color: string;
  };
}

export interface FolderLayer extends LayerBase {
  type: 'folder';
  childLayerIds: LayerId[];
}

export type Layer =
  | RasterLayer
  | TextLayer
  | ImageLayer
  | ShapeLayer
  | BackgroundLayer
  | FolderLayer;

export interface LayerDocument {
  layers: Layer[];
  rootLayerIds: LayerId[];
  activeLayerId: LayerId | null;
}

export interface CreateLayerInput {
  id: LayerId;
  pageId: PageId;
  parentId?: LayerId | null;
  name: string;
  type: LayerType;
  visible?: boolean;
  editLocked?: boolean;
  movementLocked?: boolean;
  alphaLocked?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  color?: string | null;
  createdAt?: string;
  updatedAt?: string;
  content?: Record<string, unknown>;
}

export interface UpdateLayerProperties {
  visible?: boolean;
  editLocked?: boolean;
  movementLocked?: boolean;
  alphaLocked?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  color?: string | null;
}

declare module './model.js' {
  interface Page {
    layerDocument?: LayerDocument;
  }

  interface CreatePageInput {
    layerDocument?: LayerDocument;
  }
}

export function createEmptyLayerDocument(): LayerDocument {
  return {
    layers: [],
    rootLayerIds: [],
    activeLayerId: null,
  };
}

export function getLayerDocument(page: Page): LayerDocument {
  return cloneLayerDocument(page.layerDocument ?? createEmptyLayerDocument());
}

export function createLayer(input: CreateLayerInput): Layer {
  assertLayerId(input.id);
  assertLayerName(input.name);
  const timestamp = input.createdAt ?? new Date().toISOString();
  const base: LayerBase = {
    id: input.id,
    pageId: input.pageId,
    parentId: input.parentId ?? null,
    name: input.name.trim(),
    type: input.type,
    visible: input.visible ?? true,
    editLocked: input.editLocked ?? false,
    movementLocked: input.movementLocked ?? false,
    alphaLocked: input.alphaLocked ?? false,
    opacity: input.opacity ?? 1,
    blendMode: input.blendMode ?? 'normal',
    color: input.color ?? null,
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
  assertLayerProperties(base);

  switch (input.type) {
    case 'raster':
      return {
        ...base,
        type: 'raster',
        content: {
          assetId: readNullableString(input.content?.assetId),
          sourceLayerIds: readStringArray(input.content?.sourceLayerIds),
        },
      };
    case 'text':
      return {
        ...base,
        type: 'text',
        content: {
          text: readString(input.content?.text, ''),
          fontFamily: readString(input.content?.fontFamily, 'sans-serif'),
          fontSize: readPositiveNumber(input.content?.fontSize, 32),
          color: readColor(input.content?.color, '#FFFFFF'),
        },
      };
    case 'image':
      return {
        ...base,
        type: 'image',
        content: {
          assetId: readNullableString(input.content?.assetId),
          width: readPositiveNumber(input.content?.width, 1),
          height: readPositiveNumber(input.content?.height, 1),
        },
      };
    case 'shape': {
      const shape = input.content?.shape;
      return {
        ...base,
        type: 'shape',
        content: {
          shape:
            shape === 'ellipse' || shape === 'line' || shape === 'rectangle'
              ? shape
              : 'rectangle',
          fill: readNullableColor(input.content?.fill),
          stroke: readColor(input.content?.stroke, '#FFFFFF'),
          strokeWidth: readPositiveNumber(input.content?.strokeWidth, 2),
        },
      };
    }
    case 'background':
      return {
        ...base,
        type: 'background',
        content: {
          color: readColor(input.content?.color, '#00000000'),
        },
      };
    case 'folder':
      return {
        ...base,
        type: 'folder',
        childLayerIds: [],
      };
  }
}

export function cloneLayer(layer: Layer): Layer {
  if (layer.type === 'folder') {
    return { ...layer, childLayerIds: [...layer.childLayerIds] };
  }

  if (layer.type === 'raster') {
    return {
      ...layer,
      content: {
        ...layer.content,
        sourceLayerIds: [...layer.content.sourceLayerIds],
      },
    };
  }

  return { ...layer, content: { ...layer.content } } as Layer;
}

export function cloneLayerDocument(document: LayerDocument): LayerDocument {
  return {
    layers: document.layers.map(cloneLayer),
    rootLayerIds: [...document.rootLayerIds],
    activeLayerId: document.activeLayerId,
  };
}

export function assertLayerDocumentIntegrity(
  pageId: PageId,
  document: LayerDocument,
): void {
  const layerMap = new Map<LayerId, Layer>();

  for (const layer of document.layers) {
    assertLayerId(layer.id);
    assertLayerName(layer.name);
    assertLayerProperties(layer);

    if (layer.pageId !== pageId) {
      throw new DomainError(
        'LAYER_PAGE_MISMATCH',
        `Layer ${layer.id} does not belong to page ${pageId}`,
      );
    }
    if (layerMap.has(layer.id)) {
      throw new DomainError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${layer.id}`);
    }
    layerMap.set(layer.id, layer);
  }

  if (
    document.activeLayerId !== null &&
    !layerMap.has(document.activeLayerId)
  ) {
    throw new DomainError(
      'LAYER_NOT_FOUND',
      `Active layer not found: ${document.activeLayerId}`,
    );
  }

  const referencedIds = new Set<LayerId>();
  assertSiblingList(document.rootLayerIds, null, layerMap, referencedIds);

  for (const layer of document.layers) {
    if (layer.type === 'folder') {
      assertSiblingList(layer.childLayerIds, layer.id, layerMap, referencedIds);
    }
  }

  if (referencedIds.size !== document.layers.length) {
    const orphan = document.layers.find((layer) => !referencedIds.has(layer.id));
    throw new DomainError(
      'LAYER_PARENT_INVALID',
      `Layer is not referenced by its parent: ${orphan?.id ?? 'unknown'}`,
    );
  }

  for (const rootId of document.rootLayerIds) {
    assertNoCycle(rootId, layerMap, new Set(), 0);
  }
}

export function listLayersInPaintOrder(document: LayerDocument): Layer[] {
  assertDocumentWithoutPageConstraint(document);
  const layerMap = toLayerMap(document);
  const result: Layer[] = [];

  const visit = (ids: readonly LayerId[]): void => {
    for (const id of ids) {
      const layer = layerMap.get(id)!;
      result.push(cloneLayer(layer));
      if (layer.type === 'folder') {
        visit(layer.childLayerIds);
      }
    }
  };

  visit(document.rootLayerIds);
  return result;
}

export function addLayer(
  document: LayerDocument,
  layer: Layer,
  parentId: LayerId | null,
  index: number,
): LayerDocument {
  const next = cloneLayerDocument(document);
  if (next.layers.some((candidate) => candidate.id === layer.id)) {
    throw new DomainError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${layer.id}`);
  }

  const siblings = getMutableSiblingIds(next, parentId);
  assertInsertIndex(index, siblings.length);
  const inserted = cloneLayer({ ...layer, parentId } as Layer);
  next.layers.push(inserted);
  siblings.splice(index, 0, inserted.id);
  next.activeLayerId = inserted.id;
  assertLayerDocumentIntegrity(inserted.pageId, next);
  return next;
}

export function deleteLayer(
  document: LayerDocument,
  pageId: PageId,
  layerId: LayerId,
): LayerDocument {
  const next = cloneLayerDocument(document);
  const layer = findLayer(next, layerId);
  if (layer.editLocked) {
    throw new DomainError('LAYER_LOCKED', `Layer is locked: ${layerId}`);
  }

  const deletedIds = collectSubtreeIds(next, layerId);
  const siblings = getMutableSiblingIds(next, layer.parentId);
  siblings.splice(siblings.indexOf(layerId), 1);
  next.layers = next.layers.filter((candidate) => !deletedIds.has(candidate.id));

  if (next.activeLayerId !== null && deletedIds.has(next.activeLayerId)) {
    next.activeLayerId = siblings.at(-1) ?? next.rootLayerIds.at(-1) ?? null;
  }

  assertLayerDocumentIntegrity(pageId, next);
  return next;
}

export function renameLayer(
  document: LayerDocument,
  pageId: PageId,
  layerId: LayerId,
  name: string,
  updatedAt: string,
): LayerDocument {
  assertLayerName(name);
  return updateLayerById(document, pageId, layerId, (layer) => {
    assertEditable(layer);
    return { ...layer, name: name.trim(), updatedAt } as Layer;
  });
}

export function updateLayerProperties(
  document: LayerDocument,
  pageId: PageId,
  layerId: LayerId,
  properties: UpdateLayerProperties,
  updatedAt: string,
): LayerDocument {
  return updateLayerById(document, pageId, layerId, (layer) => {
    if (layer.editLocked && properties.editLocked !== false) {
      throw new DomainError('LAYER_LOCKED', `Layer is locked: ${layerId}`);
    }

    const updated = {
      ...layer,
      ...properties,
      updatedAt,
    } as Layer;
    assertLayerProperties(updated);
    return updated;
  });
}

export function moveLayer(
  document: LayerDocument,
  pageId: PageId,
  layerId: LayerId,
  parentId: LayerId | null,
  index: number,
  updatedAt: string,
): LayerDocument {
  const next = cloneLayerDocument(document);
  const layer = findLayer(next, layerId);
  if (layer.movementLocked || layer.editLocked) {
    throw new DomainError('LAYER_LOCKED', `Layer cannot be moved: ${layerId}`);
  }
  if (parentId === layerId) {
    throw new DomainError('LAYER_CYCLE', 'A layer cannot contain itself');
  }
  if (parentId !== null) {
    const parent = findLayer(next, parentId);
    if (parent.type !== 'folder') {
      throw new DomainError('LAYER_PARENT_INVALID', `Parent is not a folder: ${parentId}`);
    }
    if (collectSubtreeIds(next, layerId).has(parentId)) {
      throw new DomainError(
        'LAYER_CYCLE',
        `Layer ${layerId} cannot be moved into its descendant ${parentId}`,
      );
    }
  }

  const sourceSiblings = getMutableSiblingIds(next, layer.parentId);
  const sourceIndex = sourceSiblings.indexOf(layerId);
  sourceSiblings.splice(sourceIndex, 1);
  const targetSiblings = getMutableSiblingIds(next, parentId);
  const adjustedIndex =
    sourceSiblings === targetSiblings && sourceIndex < index ? index - 1 : index;
  assertInsertIndex(adjustedIndex, targetSiblings.length);
  targetSiblings.splice(adjustedIndex, 0, layerId);
  next.layers = next.layers.map((candidate) =>
    candidate.id === layerId
      ? ({ ...candidate, parentId, updatedAt } as Layer)
      : candidate,
  );
  assertLayerDocumentIntegrity(pageId, next);
  return next;
}

export function duplicateLayerTree(
  document: LayerDocument,
  pageId: PageId,
  sourceLayerId: LayerId,
  createId: (sourceId: LayerId) => LayerId,
  createdAt: string,
): LayerDocument {
  const next = cloneLayerDocument(document);
  const source = findLayer(next, sourceLayerId);
  const idMap = new Map<LayerId, LayerId>();
  const sourceIds = collectSubtreeIds(next, sourceLayerId);

  for (const sourceId of sourceIds) {
    const generatedId = createId(sourceId);
    assertLayerId(generatedId);
    if (next.layers.some((layer) => layer.id === generatedId) || idMapHasValue(idMap, generatedId)) {
      throw new DomainError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${generatedId}`);
    }
    idMap.set(sourceId, generatedId);
  }

  const duplicatedLayers = [...sourceIds].map((sourceId) => {
    const original = findLayer(next, sourceId);
    const duplicated = cloneLayer({
      ...original,
      id: idMap.get(sourceId)!,
      parentId:
        original.parentId === null
          ? null
          : idMap.get(original.parentId) ?? original.parentId,
      name: sourceId === sourceLayerId ? `${original.name} のコピー` : original.name,
      createdAt,
      updatedAt: createdAt,
    } as Layer);
    if (duplicated.type === 'folder') {
      duplicated.childLayerIds = duplicated.childLayerIds.map((id) => idMap.get(id)!);
    }
    return duplicated;
  });

  next.layers.push(...duplicatedLayers);
  const siblings = getMutableSiblingIds(next, source.parentId);
  const sourceIndex = siblings.indexOf(sourceLayerId);
  siblings.splice(sourceIndex + 1, 0, idMap.get(sourceLayerId)!);
  next.activeLayerId = idMap.get(sourceLayerId)!;
  assertLayerDocumentIntegrity(pageId, next);
  return next;
}

export function mergeLayers(
  document: LayerDocument,
  pageId: PageId,
  sourceLayerIds: readonly LayerId[],
  mergedLayer: RasterLayer,
): LayerDocument {
  if (sourceLayerIds.length < 2) {
    throw new DomainError('LAYER_MERGE_INVALID', 'At least two layers are required');
  }
  const next = cloneLayerDocument(document);
  const uniqueIds = [...new Set(sourceLayerIds)];
  if (uniqueIds.length !== sourceLayerIds.length) {
    throw new DomainError('LAYER_MERGE_INVALID', 'Duplicate merge source layer');
  }

  const sourceLayers = uniqueIds.map((id) => findLayer(next, id));
  if (sourceLayers.some((layer) => layer.type === 'folder')) {
    throw new DomainError('LAYER_MERGE_INVALID', 'Folders cannot be merged directly');
  }
  if (sourceLayers.some((layer) => layer.editLocked)) {
    throw new DomainError('LAYER_LOCKED', 'Locked layers cannot be merged');
  }
  const parentId = sourceLayers[0]!.parentId;
  if (sourceLayers.some((layer) => layer.parentId !== parentId)) {
    throw new DomainError('LAYER_MERGE_INVALID', 'Merge sources must be siblings');
  }
  if (mergedLayer.pageId !== pageId || mergedLayer.parentId !== parentId) {
    throw new DomainError('LAYER_PAGE_MISMATCH', 'Merged layer scope mismatch');
  }
  if (next.layers.some((layer) => layer.id === mergedLayer.id)) {
    throw new DomainError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${mergedLayer.id}`);
  }

  const siblings = getMutableSiblingIds(next, parentId);
  const sourceIndexes = uniqueIds.map((id) => siblings.indexOf(id));
  if (sourceIndexes.some((index) => index < 0)) {
    throw new DomainError('LAYER_MERGE_INVALID', 'Merge source order is invalid');
  }
  const insertIndex = Math.min(...sourceIndexes);
  const sourceSet = new Set(uniqueIds);
  const retained = siblings.filter((id) => !sourceSet.has(id));
  retained.splice(insertIndex, 0, mergedLayer.id);
  siblings.splice(0, siblings.length, ...retained);
  next.layers = next.layers.filter((layer) => !sourceSet.has(layer.id));
  next.layers.push(
    cloneLayer({
      ...mergedLayer,
      content: {
        ...mergedLayer.content,
        sourceLayerIds: uniqueIds,
      },
    }),
  );
  next.activeLayerId = mergedLayer.id;
  assertLayerDocumentIntegrity(pageId, next);
  return next;
}

export function getMergeDownSourceIds(
  document: LayerDocument,
  layerId: LayerId,
): [LayerId, LayerId] {
  const layer = findLayer(document, layerId);
  const siblings = getSiblingIds(document, layer.parentId);
  const index = siblings.indexOf(layerId);
  const belowId = siblings[index - 1];
  if (belowId === undefined) {
    throw new DomainError('LAYER_MERGE_INVALID', 'There is no layer below');
  }
  return [belowId, layerId];
}

export function getVisibleMergeSourceIds(document: LayerDocument): LayerId[] {
  return listLayersInPaintOrder(document)
    .filter((layer) => layer.type !== 'folder' && layer.visible)
    .map((layer) => layer.id);
}

export function findLayer(document: LayerDocument, layerId: LayerId): Layer {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined) {
    throw new DomainError('LAYER_NOT_FOUND', `Layer not found: ${layerId}`);
  }
  return layer;
}

function updateLayerById(
  document: LayerDocument,
  pageId: PageId,
  layerId: LayerId,
  update: (layer: Layer) => Layer,
): LayerDocument {
  const next = cloneLayerDocument(document);
  let found = false;
  next.layers = next.layers.map((layer) => {
    if (layer.id !== layerId) {
      return layer;
    }
    found = true;
    return cloneLayer(update(layer));
  });
  if (!found) {
    throw new DomainError('LAYER_NOT_FOUND', `Layer not found: ${layerId}`);
  }
  assertLayerDocumentIntegrity(pageId, next);
  return next;
}

function getSiblingIds(document: LayerDocument, parentId: LayerId | null): LayerId[] {
  if (parentId === null) {
    return document.rootLayerIds;
  }
  const parent = findLayer(document, parentId);
  if (parent.type !== 'folder') {
    throw new DomainError('LAYER_PARENT_INVALID', `Parent is not a folder: ${parentId}`);
  }
  return parent.childLayerIds;
}

function getMutableSiblingIds(
  document: LayerDocument,
  parentId: LayerId | null,
): LayerId[] {
  return getSiblingIds(document, parentId);
}

function collectSubtreeIds(document: LayerDocument, layerId: LayerId): Set<LayerId> {
  const result = new Set<LayerId>();
  const visit = (id: LayerId): void => {
    if (result.has(id)) {
      return;
    }
    const layer = findLayer(document, id);
    result.add(id);
    if (layer.type === 'folder') {
      for (const childId of layer.childLayerIds) {
        visit(childId);
      }
    }
  };
  visit(layerId);
  return result;
}

function assertSiblingList(
  ids: readonly LayerId[],
  expectedParentId: LayerId | null,
  layerMap: ReadonlyMap<LayerId, Layer>,
  referencedIds: Set<LayerId>,
): void {
  const localIds = new Set<LayerId>();
  for (const id of ids) {
    if (localIds.has(id) || referencedIds.has(id)) {
      throw new DomainError('DUPLICATE_LAYER_ID', `Layer referenced twice: ${id}`);
    }
    const layer = layerMap.get(id);
    if (layer === undefined) {
      throw new DomainError('LAYER_NOT_FOUND', `Layer not found: ${id}`);
    }
    if (layer.parentId !== expectedParentId) {
      throw new DomainError(
        'LAYER_PARENT_INVALID',
        `Layer ${id} has invalid parent ${layer.parentId ?? 'root'}`,
      );
    }
    localIds.add(id);
    referencedIds.add(id);
  }
}

function assertNoCycle(
  layerId: LayerId,
  layerMap: ReadonlyMap<LayerId, Layer>,
  ancestors: Set<LayerId>,
  depth: number,
): void {
  if (depth > 128) {
    throw new DomainError('LAYER_CYCLE', 'Layer folder depth exceeds 128');
  }
  if (ancestors.has(layerId)) {
    throw new DomainError('LAYER_CYCLE', `Layer cycle detected: ${layerId}`);
  }
  const layer = layerMap.get(layerId)!;
  if (layer.type !== 'folder') {
    return;
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(layerId);
  for (const childId of layer.childLayerIds) {
    assertNoCycle(childId, layerMap, nextAncestors, depth + 1);
  }
}

function assertDocumentWithoutPageConstraint(document: LayerDocument): void {
  if (document.layers.length === 0 && document.rootLayerIds.length === 0) {
    return;
  }
  const pageId = document.layers[0]?.pageId;
  if (pageId === undefined) {
    throw new DomainError('LAYER_PARENT_INVALID', 'Layer document is invalid');
  }
  assertLayerDocumentIntegrity(pageId, document);
}

function toLayerMap(document: LayerDocument): Map<LayerId, Layer> {
  return new Map(document.layers.map((layer) => [layer.id, layer]));
}

function assertLayerId(value: string): void {
  if (
    value.length < 1 ||
    value.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value)
  ) {
    throw new DomainError('INVALID_ID', `Invalid layer id: ${value}`);
  }
}

function assertLayerName(value: string): void {
  if (value.trim().length < 1 || value.length > 120) {
    throw new DomainError('INVALID_NAME', 'Layer name must be 1 to 120 characters');
  }
}

function assertLayerProperties(layer: LayerBase): void {
  if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
    throw new DomainError(
      'INVALID_LAYER_OPACITY',
      `Layer opacity must be between 0 and 1: ${layer.opacity}`,
    );
  }
  if (!['normal', 'multiply', 'screen', 'add', 'overlay'].includes(layer.blendMode)) {
    throw new DomainError('INVALID_BLEND_MODE', `Invalid blend mode: ${layer.blendMode}`);
  }
  if (layer.color !== null && !isColor(layer.color)) {
    throw new DomainError('INVALID_LAYER_COLOR', `Invalid layer color: ${layer.color}`);
  }
}

function assertEditable(layer: Layer): void {
  if (layer.editLocked) {
    throw new DomainError('LAYER_LOCKED', `Layer is locked: ${layer.id}`);
  }
}

function assertInsertIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new DomainError('INVALID_PAGE_INDEX', `Invalid layer index: ${index}`);
  }
}

function isColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? [...value]
    : [];
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function readColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && isColor(value) ? value : fallback;
}

function readNullableColor(value: unknown): string | null {
  return value === null ? null : readColor(value, '#FFFFFF');
}

function idMapHasValue(map: ReadonlyMap<LayerId, LayerId>, value: LayerId): boolean {
  for (const candidate of map.values()) {
    if (candidate === value) {
      return true;
    }
  }
  return false;
}
