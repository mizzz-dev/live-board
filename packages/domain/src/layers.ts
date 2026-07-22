import {
  DomainError,
  type DomainErrorCode,
  type Page,
  type PageId,
} from './model.js';

export type LayerId = string;
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay';
export type LayerType =
  | 'raster'
  | 'text'
  | 'image'
  | 'shape'
  | 'background'
  | 'folder';

export type LayerErrorCode =
  | 'LAYER_PAGE_MISMATCH'
  | 'DUPLICATE_LAYER_ID'
  | 'LAYER_NOT_FOUND'
  | 'LAYER_PARENT_INVALID'
  | 'LAYER_CYCLE'
  | 'LAYER_LOCKED'
  | 'LAYER_MERGE_INVALID'
  | 'INVALID_LAYER_OPACITY'
  | 'INVALID_BLEND_MODE'
  | 'INVALID_LAYER_COLOR';

export class LayerDomainError extends DomainError {
  readonly layerCode: LayerErrorCode;

  constructor(code: LayerErrorCode, message: string) {
    super(code as DomainErrorCode, message);
    this.name = 'LayerDomainError';
    this.layerCode = code;
  }
}

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
  content: { assetId: string | null; sourceLayerIds: LayerId[] };
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
  content: { assetId: string | null; width: number; height: number };
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
  content: { color: string };
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
  return { layers: [], rootLayerIds: [], activeLayerId: null };
}

export function getLayerDocument(page: Page): LayerDocument {
  return cloneLayerDocument(page.layerDocument ?? createEmptyLayerDocument());
}

export function createLayer(input: CreateLayerInput): Layer {
  assertId(input.id);
  assertName(input.name);
  const createdAt = input.createdAt ?? new Date().toISOString();
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
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
  assertProperties(base);

  switch (input.type) {
    case 'raster':
      return {
        ...base,
        type: 'raster',
        content: {
          assetId: nullableString(input.content?.assetId),
          sourceLayerIds: stringArray(input.content?.sourceLayerIds),
        },
      };
    case 'text':
      return {
        ...base,
        type: 'text',
        content: {
          text: stringValue(input.content?.text, ''),
          fontFamily: stringValue(input.content?.fontFamily, 'sans-serif'),
          fontSize: positiveNumber(input.content?.fontSize, 32),
          color: colorValue(input.content?.color, '#FFFFFF'),
        },
      };
    case 'image':
      return {
        ...base,
        type: 'image',
        content: {
          assetId: nullableString(input.content?.assetId),
          width: positiveNumber(input.content?.width, 1),
          height: positiveNumber(input.content?.height, 1),
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
          fill: nullableColor(input.content?.fill),
          stroke: colorValue(input.content?.stroke, '#FFFFFF'),
          strokeWidth: positiveNumber(input.content?.strokeWidth, 2),
        },
      };
    }
    case 'background':
      return {
        ...base,
        type: 'background',
        content: { color: colorValue(input.content?.color, '#00000000') },
      };
    case 'folder':
      return { ...base, type: 'folder', childLayerIds: [] };
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
  const map = new Map<LayerId, Layer>();
  for (const layer of document.layers) {
    assertId(layer.id);
    assertName(layer.name);
    assertProperties(layer);
    if (layer.pageId !== pageId) {
      throw layerError(
        'LAYER_PAGE_MISMATCH',
        `Layer ${layer.id} does not belong to page ${pageId}`,
      );
    }
    if (map.has(layer.id)) {
      throw layerError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${layer.id}`);
    }
    map.set(layer.id, layer);
  }

  if (document.activeLayerId !== null && !map.has(document.activeLayerId)) {
    throw layerError(
      'LAYER_NOT_FOUND',
      `Active layer not found: ${document.activeLayerId}`,
    );
  }

  const referenced = new Set<LayerId>();
  assertSiblings(document.rootLayerIds, null, map, referenced);
  for (const layer of document.layers) {
    if (layer.type === 'folder') {
      assertSiblings(layer.childLayerIds, layer.id, map, referenced);
    }
  }

  if (referenced.size !== document.layers.length) {
    const orphan = document.layers.find((layer) => !referenced.has(layer.id));
    throw layerError(
      'LAYER_PARENT_INVALID',
      `Layer is not referenced by its parent: ${orphan?.id ?? 'unknown'}`,
    );
  }

  for (const rootId of document.rootLayerIds) {
    assertNoCycle(rootId, map, new Set(), 0);
  }
}

export function listLayersInPaintOrder(document: LayerDocument): Layer[] {
  assertWithoutPage(document);
  const map = layerMap(document);
  const result: Layer[] = [];
  const visit = (ids: readonly LayerId[]): void => {
    for (const id of ids) {
      const layer = map.get(id)!;
      result.push(cloneLayer(layer));
      if (layer.type === 'folder') visit(layer.childLayerIds);
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
    throw layerError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${layer.id}`);
  }
  const siblings = mutableSiblings(next, parentId);
  assertIndex(index, siblings.length);
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
    throw layerError('LAYER_LOCKED', `Layer is locked: ${layerId}`);
  }
  const deleted = subtreeIds(next, layerId);
  const siblings = mutableSiblings(next, layer.parentId);
  siblings.splice(siblings.indexOf(layerId), 1);
  next.layers = next.layers.filter((candidate) => !deleted.has(candidate.id));
  if (next.activeLayerId !== null && deleted.has(next.activeLayerId)) {
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
  assertName(name);
  return updateById(document, pageId, layerId, (layer) => {
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
  return updateById(document, pageId, layerId, (layer) => {
    const onlyControlProperties = Object.keys(properties).every((key) =>
      ['visible', 'editLocked', 'movementLocked', 'alphaLocked'].includes(key),
    );
    if (layer.editLocked && properties.editLocked !== false && !onlyControlProperties) {
      throw layerError('LAYER_LOCKED', `Layer is locked: ${layerId}`);
    }
    const updated = { ...layer, ...properties, updatedAt } as Layer;
    assertProperties(updated);
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
    throw layerError('LAYER_LOCKED', `Layer cannot be moved: ${layerId}`);
  }
  if (parentId === layerId) {
    throw layerError('LAYER_CYCLE', 'A layer cannot contain itself');
  }
  if (parentId !== null) {
    const parent = findLayer(next, parentId);
    if (parent.type !== 'folder') {
      throw layerError('LAYER_PARENT_INVALID', `Parent is not a folder: ${parentId}`);
    }
    if (subtreeIds(next, layerId).has(parentId)) {
      throw layerError(
        'LAYER_CYCLE',
        `Layer ${layerId} cannot be moved into its descendant ${parentId}`,
      );
    }
  }

  const source = mutableSiblings(next, layer.parentId);
  const sourceIndex = source.indexOf(layerId);
  source.splice(sourceIndex, 1);
  const target = mutableSiblings(next, parentId);
  const adjusted = source === target && sourceIndex < index ? index - 1 : index;
  assertIndex(adjusted, target.length);
  target.splice(adjusted, 0, layerId);
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
  const ids = [...subtreeIds(next, sourceLayerId)];
  const idMap = new Map<LayerId, LayerId>();
  for (const sourceId of ids) {
    const id = createId(sourceId);
    assertId(id);
    if (next.layers.some((layer) => layer.id === id) || [...idMap.values()].includes(id)) {
      throw layerError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${id}`);
    }
    idMap.set(sourceId, id);
  }

  const copies = ids.map((sourceId) => {
    const original = findLayer(next, sourceId);
    const copy = cloneLayer({
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
    if (copy.type === 'folder') {
      copy.childLayerIds = copy.childLayerIds.map((id) => idMap.get(id)!);
    }
    return copy;
  });

  next.layers.push(...copies);
  const siblings = mutableSiblings(next, source.parentId);
  siblings.splice(siblings.indexOf(sourceLayerId) + 1, 0, idMap.get(sourceLayerId)!);
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
  const ids = [...new Set(sourceLayerIds)];
  if (ids.length < 2 || ids.length !== sourceLayerIds.length) {
    throw layerError('LAYER_MERGE_INVALID', 'At least two unique layers are required');
  }
  const next = cloneLayerDocument(document);
  const sources = ids.map((id) => findLayer(next, id));
  if (sources.some((layer) => layer.type === 'folder')) {
    throw layerError('LAYER_MERGE_INVALID', 'Folders cannot be merged directly');
  }
  if (sources.some((layer) => layer.editLocked)) {
    throw layerError('LAYER_LOCKED', 'Locked layers cannot be merged');
  }
  const parentId = sources[0]!.parentId;
  if (sources.some((layer) => layer.parentId !== parentId)) {
    throw layerError('LAYER_MERGE_INVALID', 'Merge sources must be siblings');
  }
  if (mergedLayer.pageId !== pageId || mergedLayer.parentId !== parentId) {
    throw layerError('LAYER_PAGE_MISMATCH', 'Merged layer scope mismatch');
  }
  if (next.layers.some((layer) => layer.id === mergedLayer.id)) {
    throw layerError('DUPLICATE_LAYER_ID', `Duplicate layer id: ${mergedLayer.id}`);
  }

  const siblings = mutableSiblings(next, parentId);
  const indexes = ids.map((id) => siblings.indexOf(id));
  if (indexes.some((index) => index < 0)) {
    throw layerError('LAYER_MERGE_INVALID', 'Merge source order is invalid');
  }
  const insertIndex = Math.min(...indexes);
  const sourceSet = new Set(ids);
  const retained = siblings.filter((id) => !sourceSet.has(id));
  retained.splice(insertIndex, 0, mergedLayer.id);
  siblings.splice(0, siblings.length, ...retained);
  next.layers = next.layers.filter((layer) => !sourceSet.has(layer.id));
  next.layers.push(
    cloneLayer({
      ...mergedLayer,
      content: { ...mergedLayer.content, sourceLayerIds: ids },
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
  const siblings = siblingIds(document, layer.parentId);
  const below = siblings[siblings.indexOf(layerId) - 1];
  if (below === undefined) {
    throw layerError('LAYER_MERGE_INVALID', 'There is no layer below');
  }
  return [below, layerId];
}

export function getVisibleMergeSourceIds(document: LayerDocument): LayerId[] {
  return listLayersInPaintOrder(document)
    .filter((layer) => layer.type !== 'folder' && layer.visible)
    .map((layer) => layer.id);
}

export function findLayer(document: LayerDocument, layerId: LayerId): Layer {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined) {
    throw layerError('LAYER_NOT_FOUND', `Layer not found: ${layerId}`);
  }
  return layer;
}

function updateById(
  document: LayerDocument,
  pageId: PageId,
  layerId: LayerId,
  update: (layer: Layer) => Layer,
): LayerDocument {
  const next = cloneLayerDocument(document);
  let found = false;
  next.layers = next.layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    found = true;
    return cloneLayer(update(layer));
  });
  if (!found) throw layerError('LAYER_NOT_FOUND', `Layer not found: ${layerId}`);
  assertLayerDocumentIntegrity(pageId, next);
  return next;
}

function siblingIds(document: LayerDocument, parentId: LayerId | null): LayerId[] {
  if (parentId === null) return document.rootLayerIds;
  const parent = findLayer(document, parentId);
  if (parent.type !== 'folder') {
    throw layerError('LAYER_PARENT_INVALID', `Parent is not a folder: ${parentId}`);
  }
  return parent.childLayerIds;
}

function mutableSiblings(document: LayerDocument, parentId: LayerId | null): LayerId[] {
  return siblingIds(document, parentId);
}

function subtreeIds(document: LayerDocument, layerId: LayerId): Set<LayerId> {
  const result = new Set<LayerId>();
  const visit = (id: LayerId): void => {
    if (result.has(id)) return;
    const layer = findLayer(document, id);
    result.add(id);
    if (layer.type === 'folder') layer.childLayerIds.forEach(visit);
  };
  visit(layerId);
  return result;
}

function assertSiblings(
  ids: readonly LayerId[],
  expectedParentId: LayerId | null,
  map: ReadonlyMap<LayerId, Layer>,
  referenced: Set<LayerId>,
): void {
  const local = new Set<LayerId>();
  for (const id of ids) {
    if (local.has(id) || referenced.has(id)) {
      throw layerError('DUPLICATE_LAYER_ID', `Layer referenced twice: ${id}`);
    }
    const layer = map.get(id);
    if (layer === undefined) {
      throw layerError('LAYER_NOT_FOUND', `Layer not found: ${id}`);
    }
    if (layer.parentId !== expectedParentId) {
      throw layerError('LAYER_PARENT_INVALID', `Layer ${id} has invalid parent`);
    }
    local.add(id);
    referenced.add(id);
  }
}

function assertNoCycle(
  layerId: LayerId,
  map: ReadonlyMap<LayerId, Layer>,
  ancestors: Set<LayerId>,
  depth: number,
): void {
  if (depth > 128) {
    throw layerError('LAYER_CYCLE', 'Layer folder depth exceeds 128');
  }
  if (ancestors.has(layerId)) {
    throw layerError('LAYER_CYCLE', `Layer cycle detected: ${layerId}`);
  }
  const layer = map.get(layerId)!;
  if (layer.type !== 'folder') return;
  const next = new Set(ancestors);
  next.add(layerId);
  for (const childId of layer.childLayerIds) {
    assertNoCycle(childId, map, next, depth + 1);
  }
}

function assertWithoutPage(document: LayerDocument): void {
  if (document.layers.length === 0 && document.rootLayerIds.length === 0) return;
  const pageId = document.layers[0]?.pageId;
  if (pageId === undefined) {
    throw layerError('LAYER_PARENT_INVALID', 'Layer document is invalid');
  }
  assertLayerDocumentIntegrity(pageId, document);
}

function layerMap(document: LayerDocument): Map<LayerId, Layer> {
  return new Map(document.layers.map((layer) => [layer.id, layer]));
}

function layerError(code: LayerErrorCode, message: string): LayerDomainError {
  return new LayerDomainError(code, message);
}

function assertId(value: string): void {
  if (
    value.length < 1 ||
    value.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value)
  ) {
    throw new DomainError('INVALID_ID', `Invalid layer id: ${value}`);
  }
}

function assertName(value: string): void {
  if (value.trim().length < 1 || value.length > 120) {
    throw new DomainError('INVALID_NAME', 'Layer name must be 1 to 120 characters');
  }
}

function assertProperties(layer: LayerBase): void {
  if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
    throw layerError(
      'INVALID_LAYER_OPACITY',
      `Layer opacity must be between 0 and 1: ${layer.opacity}`,
    );
  }
  if (!['normal', 'multiply', 'screen', 'add', 'overlay'].includes(layer.blendMode)) {
    throw layerError('INVALID_BLEND_MODE', `Invalid blend mode: ${layer.blendMode}`);
  }
  if (layer.color !== null && !isColor(layer.color)) {
    throw layerError('INVALID_LAYER_COLOR', `Invalid layer color: ${layer.color}`);
  }
}

function assertEditable(layer: Layer): void {
  if (layer.editLocked) {
    throw layerError('LAYER_LOCKED', `Layer is locked: ${layer.id}`);
  }
}

function assertIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new DomainError('INVALID_PAGE_INDEX', `Invalid layer index: ${index}`);
  }
}

function isColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? [...value]
    : [];
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function colorValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && isColor(value) ? value : fallback;
}

function nullableColor(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' && isColor(value) ? value : null;
}
