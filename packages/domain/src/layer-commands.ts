import {
  findPage,
  findProject,
  replaceProject,
  type Page,
  type PageId,
  type Project,
  type ProjectId,
  type Workspace,
} from './model.js';
import {
  addLayer,
  cloneLayer,
  deleteLayer,
  duplicateLayerTree,
  findLayer,
  getLayerDocument,
  mergeLayers,
  moveLayer,
  renameLayer,
  updateLayerProperties,
  type Layer,
  type LayerId,
  type RasterLayer,
  type UpdateLayerProperties,
} from './layers.js';

export interface LayerCommandMetadata {
  commandId: string;
  createdAt: string;
}

interface LayerCommandBase extends LayerCommandMetadata {
  projectId: ProjectId;
  pageId: PageId;
}

export interface AddLayerCommand extends LayerCommandBase {
  type: 'layer.add';
  layer: Layer;
  parentId: LayerId | null;
  index: number;
}

export interface DeleteLayerCommand extends LayerCommandBase {
  type: 'layer.delete';
  layerId: LayerId;
}

export interface DuplicateLayerCommand extends LayerCommandBase {
  type: 'layer.duplicate';
  sourceLayerId: LayerId;
  idMap: Record<LayerId, LayerId>;
}

export interface RenameLayerCommand extends LayerCommandBase {
  type: 'layer.rename';
  layerId: LayerId;
  name: string;
}

export interface MoveLayerCommand extends LayerCommandBase {
  type: 'layer.move';
  layerId: LayerId;
  parentId: LayerId | null;
  index: number;
}

export interface UpdateLayerCommand extends LayerCommandBase {
  type: 'layer.update';
  layerId: LayerId;
  properties: UpdateLayerProperties;
}

export interface SelectLayerCommand extends LayerCommandBase {
  type: 'layer.select';
  layerId: LayerId | null;
}

export interface MergeLayersCommand extends LayerCommandBase {
  type: 'layer.merge';
  sourceLayerIds: LayerId[];
  mergedLayer: RasterLayer;
}

export type LayerCommand =
  | AddLayerCommand
  | DeleteLayerCommand
  | DuplicateLayerCommand
  | RenameLayerCommand
  | MoveLayerCommand
  | UpdateLayerCommand
  | SelectLayerCommand
  | MergeLayersCommand;

export interface LayerCommandResult {
  workspace: Workspace;
  changed: boolean;
}

export function createAddLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  layer: Layer,
  parentId: LayerId | null,
  index: number,
  metadata: LayerCommandMetadata,
): AddLayerCommand {
  return {
    type: 'layer.add',
    projectId,
    pageId,
    layer: cloneLayer(layer),
    parentId,
    index,
    ...metadata,
  };
}

export function createDeleteLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  metadata: LayerCommandMetadata,
): DeleteLayerCommand {
  return { type: 'layer.delete', projectId, pageId, layerId, ...metadata };
}

export function createDuplicateLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  sourceLayerId: LayerId,
  idMap: Record<LayerId, LayerId>,
  metadata: LayerCommandMetadata,
): DuplicateLayerCommand {
  return {
    type: 'layer.duplicate',
    projectId,
    pageId,
    sourceLayerId,
    idMap: { ...idMap },
    ...metadata,
  };
}

export function createRenameLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  name: string,
  metadata: LayerCommandMetadata,
): RenameLayerCommand {
  return { type: 'layer.rename', projectId, pageId, layerId, name, ...metadata };
}

export function createMoveLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  parentId: LayerId | null,
  index: number,
  metadata: LayerCommandMetadata,
): MoveLayerCommand {
  return {
    type: 'layer.move',
    projectId,
    pageId,
    layerId,
    parentId,
    index,
    ...metadata,
  };
}

export function createUpdateLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  properties: UpdateLayerProperties,
  metadata: LayerCommandMetadata,
): UpdateLayerCommand {
  return {
    type: 'layer.update',
    projectId,
    pageId,
    layerId,
    properties: { ...properties },
    ...metadata,
  };
}

export function createSelectLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId | null,
  metadata: LayerCommandMetadata,
): SelectLayerCommand {
  return { type: 'layer.select', projectId, pageId, layerId, ...metadata };
}

export function createMergeLayersCommand(
  projectId: ProjectId,
  pageId: PageId,
  sourceLayerIds: LayerId[],
  mergedLayer: RasterLayer,
  metadata: LayerCommandMetadata,
): MergeLayersCommand {
  return {
    type: 'layer.merge',
    projectId,
    pageId,
    sourceLayerIds: [...sourceLayerIds],
    mergedLayer: cloneLayer(mergedLayer) as RasterLayer,
    ...metadata,
  };
}

export function applyLayerCommand(
  workspace: Workspace,
  command: LayerCommand,
): LayerCommandResult {
  const project = findProject(workspace, command.projectId);
  const page = findPage(project, command.pageId);
  const currentDocument = getLayerDocument(page);
  let nextDocument = currentDocument;

  switch (command.type) {
    case 'layer.add':
      nextDocument = addLayer(
        currentDocument,
        command.layer,
        command.parentId,
        command.index,
      );
      break;
    case 'layer.delete':
      nextDocument = deleteLayer(currentDocument, page.id, command.layerId);
      break;
    case 'layer.duplicate':
      nextDocument = duplicateLayerTree(
        currentDocument,
        page.id,
        command.sourceLayerId,
        (sourceId) => {
          const mappedId = command.idMap[sourceId];
          if (mappedId === undefined) {
            throw new Error(`Missing duplicate layer id mapping: ${sourceId}`);
          }
          return mappedId;
        },
        command.createdAt,
      );
      break;
    case 'layer.rename':
      nextDocument = renameLayer(
        currentDocument,
        page.id,
        command.layerId,
        command.name,
        command.createdAt,
      );
      break;
    case 'layer.move':
      nextDocument = moveLayer(
        currentDocument,
        page.id,
        command.layerId,
        command.parentId,
        command.index,
        command.createdAt,
      );
      break;
    case 'layer.update':
      nextDocument = updateLayerProperties(
        currentDocument,
        page.id,
        command.layerId,
        command.properties,
        command.createdAt,
      );
      break;
    case 'layer.select':
      if (command.layerId !== null) {
        findLayer(currentDocument, command.layerId);
      }
      nextDocument = {
        ...currentDocument,
        activeLayerId: command.layerId,
      };
      break;
    case 'layer.merge':
      nextDocument = mergeLayers(
        currentDocument,
        page.id,
        command.sourceLayerIds,
        command.mergedLayer,
      );
      break;
  }

  if (JSON.stringify(nextDocument) === JSON.stringify(currentDocument)) {
    return { workspace, changed: false };
  }

  const nextPage: Page = {
    ...page,
    layerDocument: nextDocument,
    updatedAt: command.createdAt,
  };
  const nextProject = replacePageInProject(project, nextPage, command.createdAt);
  return {
    workspace: replaceProject(workspace, nextProject, command.createdAt),
    changed: true,
  };
}

function replacePageInProject(
  project: Project,
  page: Page,
  updatedAt: string,
): Project {
  const pageIndex = project.pages.findIndex((candidate) => candidate.id === page.id);
  if (pageIndex < 0) {
    throw new Error(`Page not found: ${page.id}`);
  }

  return {
    ...project,
    pages: project.pages.map((candidate, index) =>
      index === pageIndex ? page : candidate,
    ),
    updatedAt,
  };
}
