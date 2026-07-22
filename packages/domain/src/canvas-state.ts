import {
  createEmptyRasterDrawing,
  parseRasterDrawing,
  type RasterDrawing,
  type RasterFill,
  type RasterStroke,
} from '@live-board/obs-protocol';
import {
  dispatchProjectCommandWithLayerHistory,
  redoProjectCommandWithLayerHistory,
  undoProjectCommandWithLayerHistory,
  createLayerWorkspaceCommandState,
  type LayerWorkspaceCommandState,
} from './layer-history.js';
import {
  cloneLayer,
  findLayer,
  getLayerDocument,
  type Layer,
  type LayerBase,
  type LayerDocument,
  type LayerId,
  type RasterLayer,
} from './layers.js';
import { type LayerCommand } from './layer-commands.js';
import { dispatchLayerCommand } from './layer-history.js';
import { type ProjectCommand } from './commands.js';
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

export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export const IDENTITY_LAYER_TRANSFORM: LayerTransform = Object.freeze({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
});

export interface CanvasCommandMetadata {
  commandId: string;
  createdAt: string;
}

interface CanvasCommandBase extends CanvasCommandMetadata {
  projectId: ProjectId;
  pageId: PageId;
  layerId: LayerId;
}

export interface AddRasterStrokeCommand extends CanvasCommandBase {
  type: 'canvas.stroke.add';
  stroke: RasterStroke;
}

export interface AddRasterFillCommand extends CanvasCommandBase {
  type: 'canvas.fill.add';
  fill: RasterFill;
}

export interface ClearRasterCommand extends CanvasCommandBase {
  type: 'canvas.raster.clear';
}

export interface TransformLayerCommand extends CanvasCommandBase {
  type: 'canvas.layer.transform';
  transform: LayerTransform;
}

export type CanvasCommand =
  | AddRasterStrokeCommand
  | AddRasterFillCommand
  | ClearRasterCommand
  | TransformLayerCommand;

export interface CanvasHistoryEntry {
  historyId: string;
  command: CanvasCommand;
  beforePage: Page;
  afterPage: Page;
  estimatedBytes: number;
}

export interface CanvasHistoryStack {
  past: CanvasHistoryEntry[];
  future: CanvasHistoryEntry[];
}

export interface CanvasWorkspaceCommandState extends LayerWorkspaceCommandState {
  canvasHistories: Record<PageId, CanvasHistoryStack>;
  canvasHistoryMemoryLimitBytes: number;
}

declare module './layers.js' {
  interface LayerBase {
    transform?: LayerTransform;
  }
  interface RasterLayer {
    drawing?: RasterDrawing;
  }
}

export function createCanvasWorkspaceCommandState(
  workspace: Workspace,
  historyLimit = 100,
  canvasHistoryMemoryLimitBytes = 64 * 1024 * 1024,
): CanvasWorkspaceCommandState {
  if (
    !Number.isSafeInteger(canvasHistoryMemoryLimitBytes) ||
    canvasHistoryMemoryLimitBytes < 1024 ||
    canvasHistoryMemoryLimitBytes > 1024 * 1024 * 1024
  ) {
    throw new Error(`Invalid canvas history memory limit: ${canvasHistoryMemoryLimitBytes}`);
  }
  return {
    ...createLayerWorkspaceCommandState(workspace, historyLimit),
    canvasHistories: {},
    canvasHistoryMemoryLimitBytes,
  };
}

export function dispatchProjectCommandWithCanvasHistory(
  state: CanvasWorkspaceCommandState,
  command: ProjectCommand,
): CanvasWorkspaceCommandState {
  const result = dispatchProjectCommandWithLayerHistory(state, command);
  return retainExistingCanvasHistories({
    ...result,
    canvasHistories: state.canvasHistories,
    canvasHistoryMemoryLimitBytes: state.canvasHistoryMemoryLimitBytes,
  });
}

export function undoProjectCommandWithCanvasHistory(
  state: CanvasWorkspaceCommandState,
  projectId: ProjectId,
): CanvasWorkspaceCommandState {
  const result = undoProjectCommandWithLayerHistory(state, projectId);
  return retainExistingCanvasHistories({
    ...result,
    canvasHistories: state.canvasHistories,
    canvasHistoryMemoryLimitBytes: state.canvasHistoryMemoryLimitBytes,
  });
}

export function redoProjectCommandWithCanvasHistory(
  state: CanvasWorkspaceCommandState,
  projectId: ProjectId,
): CanvasWorkspaceCommandState {
  const result = redoProjectCommandWithLayerHistory(state, projectId);
  return retainExistingCanvasHistories({
    ...result,
    canvasHistories: state.canvasHistories,
    canvasHistoryMemoryLimitBytes: state.canvasHistoryMemoryLimitBytes,
  });
}

export function dispatchLayerCommandWithCanvasHistory(
  state: CanvasWorkspaceCommandState,
  command: LayerCommand,
): CanvasWorkspaceCommandState {
  const result = dispatchLayerCommand(state, command) as CanvasWorkspaceCommandState;
  return retainExistingCanvasHistories({
    ...result,
    canvasHistories: state.canvasHistories,
    canvasHistoryMemoryLimitBytes: state.canvasHistoryMemoryLimitBytes,
  });
}

export function createAddRasterStrokeCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  stroke: RasterStroke,
  metadata: CanvasCommandMetadata,
): AddRasterStrokeCommand {
  return {
    type: 'canvas.stroke.add',
    projectId,
    pageId,
    layerId,
    stroke: parseRasterDrawing({ revision: 1, strokes: [stroke], fills: [] }).strokes[0]!,
    ...metadata,
  };
}

export function createAddRasterFillCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  fill: RasterFill,
  metadata: CanvasCommandMetadata,
): AddRasterFillCommand {
  return {
    type: 'canvas.fill.add',
    projectId,
    pageId,
    layerId,
    fill: parseRasterDrawing({ revision: 1, strokes: [], fills: [fill] }).fills[0]!,
    ...metadata,
  };
}

export function createClearRasterCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  metadata: CanvasCommandMetadata,
): ClearRasterCommand {
  return { type: 'canvas.raster.clear', projectId, pageId, layerId, ...metadata };
}

export function createTransformLayerCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  transform: LayerTransform,
  metadata: CanvasCommandMetadata,
): TransformLayerCommand {
  assertLayerTransform(transform);
  return {
    type: 'canvas.layer.transform',
    projectId,
    pageId,
    layerId,
    transform: { ...transform },
    ...metadata,
  };
}

export function dispatchCanvasCommand(
  state: CanvasWorkspaceCommandState,
  command: CanvasCommand,
): CanvasWorkspaceCommandState {
  const project = findProject(state.workspace, command.projectId);
  const page = findPage(project, command.pageId);
  const beforePage = clonePage(page);
  const afterPage = applyCanvasCommandToPage(page, command);
  if (JSON.stringify(beforePage) === JSON.stringify(afterPage)) return state;
  const workspace = replacePage(state.workspace, project, afterPage, command.createdAt);
  const entry: CanvasHistoryEntry = {
    historyId: `canvas-history:${command.commandId}`,
    command,
    beforePage,
    afterPage: clonePage(afterPage),
    estimatedBytes: utf8ByteLength(
      JSON.stringify({ command, before: beforePage.layerDocument, after: afterPage.layerDocument }),
    ),
  };
  const stack = getCanvasHistory(state, command.pageId);
  const past = trimHistoryByMemory(
    [...stack.past, entry].slice(-state.historyLimit),
    state.canvasHistoryMemoryLimitBytes,
  );
  return {
    ...state,
    workspace,
    canvasHistories: {
      ...state.canvasHistories,
      [command.pageId]: { past, future: [] },
    },
  };
}

export function undoCanvasCommand(
  state: CanvasWorkspaceCommandState,
  projectId: ProjectId,
  pageId: PageId,
): CanvasWorkspaceCommandState {
  const stack = getCanvasHistory(state, pageId);
  const entry = stack.past.at(-1);
  if (entry === undefined) return state;
  const project = findProject(state.workspace, projectId);
  return {
    ...state,
    workspace: replacePage(state.workspace, project, entry.beforePage, new Date().toISOString()),
    canvasHistories: {
      ...state.canvasHistories,
      [pageId]: {
        past: stack.past.slice(0, -1),
        future: [...stack.future, entry],
      },
    },
  };
}

export function redoCanvasCommand(
  state: CanvasWorkspaceCommandState,
  projectId: ProjectId,
  pageId: PageId,
): CanvasWorkspaceCommandState {
  const stack = getCanvasHistory(state, pageId);
  const entry = stack.future.at(-1);
  if (entry === undefined) return state;
  const project = findProject(state.workspace, projectId);
  const past = trimHistoryByMemory(
    [...stack.past, entry].slice(-state.historyLimit),
    state.canvasHistoryMemoryLimitBytes,
  );
  return {
    ...state,
    workspace: replacePage(state.workspace, project, entry.afterPage, new Date().toISOString()),
    canvasHistories: {
      ...state.canvasHistories,
      [pageId]: { past, future: stack.future.slice(0, -1) },
    },
  };
}

export function getCanvasHistory(
  state: CanvasWorkspaceCommandState,
  pageId: PageId,
): CanvasHistoryStack {
  return state.canvasHistories[pageId] ?? EMPTY_CANVAS_HISTORY;
}

export function getCanvasHistoryBytes(
  state: CanvasWorkspaceCommandState,
  pageId: PageId,
): number {
  const stack = getCanvasHistory(state, pageId);
  return [...stack.past, ...stack.future].reduce((sum, entry) => sum + entry.estimatedBytes, 0);
}

export function canUndoCanvas(state: CanvasWorkspaceCommandState, pageId: PageId): boolean {
  return getCanvasHistory(state, pageId).past.length > 0;
}

export function canRedoCanvas(state: CanvasWorkspaceCommandState, pageId: PageId): boolean {
  return getCanvasHistory(state, pageId).future.length > 0;
}

export function getRasterDrawing(layer: RasterLayer): RasterDrawing {
  return cloneRasterDrawing(layer.drawing ?? createEmptyRasterDrawing());
}

export function getLayerTransform(layer: LayerBase): LayerTransform {
  return { ...(layer.transform ?? IDENTITY_LAYER_TRANSFORM) };
}

export function cloneRasterDrawing(drawing: RasterDrawing): RasterDrawing {
  return {
    revision: drawing.revision,
    strokes: drawing.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
    fills: drawing.fills.map((fill) => ({ ...fill })),
  };
}

export function assertLayerTransform(transform: LayerTransform): void {
  if (
    !Number.isFinite(transform.x) ||
    !Number.isFinite(transform.y) ||
    !Number.isFinite(transform.scaleX) ||
    !Number.isFinite(transform.scaleY) ||
    transform.scaleX === 0 ||
    transform.scaleY === 0 ||
    Math.abs(transform.scaleX) > 1000 ||
    Math.abs(transform.scaleY) > 1000 ||
    !Number.isFinite(transform.rotation) ||
    Math.abs(transform.rotation) > 360_000
  ) {
    throw new Error('INVALID_LAYER_TRANSFORM');
  }
}

function applyCanvasCommandToPage(page: Page, command: CanvasCommand): Page {
  const document = getLayerDocument(page);
  const layer = findLayer(document, command.layerId);
  if (layer.editLocked) throw new Error(`Layer is locked: ${layer.id}`);
  const nextLayer = applyCanvasCommandToLayer(layer, command);
  const nextDocument: LayerDocument = {
    ...document,
    layers: document.layers.map((candidate) =>
      candidate.id === nextLayer.id ? cloneLayer(nextLayer) : candidate,
    ),
  };
  return { ...page, layerDocument: nextDocument, updatedAt: command.createdAt };
}

function applyCanvasCommandToLayer(layer: Layer, command: CanvasCommand): Layer {
  if (command.type === 'canvas.layer.transform') {
    assertLayerTransform(command.transform);
    if (layer.movementLocked) throw new Error(`Layer cannot be transformed: ${layer.id}`);
    return { ...layer, transform: { ...command.transform }, updatedAt: command.createdAt } as Layer;
  }
  if (layer.type !== 'raster') throw new Error(`Layer is not raster: ${layer.id}`);
  const drawing = getRasterDrawing(layer);
  if (command.type === 'canvas.stroke.add') {
    return {
      ...layer,
      drawing: {
        revision: drawing.revision + 1,
        strokes: [...drawing.strokes, command.stroke],
        fills: drawing.fills,
      },
      updatedAt: command.createdAt,
    };
  }
  if (command.type === 'canvas.fill.add') {
    return {
      ...layer,
      drawing: {
        revision: drawing.revision + 1,
        strokes: drawing.strokes,
        fills: [...drawing.fills, command.fill],
      },
      updatedAt: command.createdAt,
    };
  }
  return {
    ...layer,
    drawing: { revision: drawing.revision + 1, strokes: [], fills: [] },
    updatedAt: command.createdAt,
  };
}

function replacePage(
  workspace: Workspace,
  project: Project,
  page: Page,
  updatedAt: string,
): Workspace {
  const pageIndex = project.pages.findIndex((candidate) => candidate.id === page.id);
  if (pageIndex < 0) throw new Error(`Page not found: ${page.id}`);
  const nextProject: Project = {
    ...project,
    pages: project.pages.map((candidate, index) =>
      index === pageIndex ? clonePage(page) : candidate,
    ),
    updatedAt,
  };
  return replaceProject(workspace, nextProject, updatedAt);
}

function clonePage(page: Page): Page {
  const document = getLayerDocument(page);
  const layers = document.layers.map((layer) => {
    const cloned = cloneLayer(layer);
    if (cloned.type === 'raster') {
      cloned.drawing = getRasterDrawing(cloned);
    }
    if (cloned.transform !== undefined) cloned.transform = { ...cloned.transform };
    return cloned;
  });
  return {
    ...page,
    layerDocument: {
      layers,
      rootLayerIds: [...document.rootLayerIds],
      activeLayerId: document.activeLayerId,
    },
  };
}

function trimHistoryByMemory(
  entries: CanvasHistoryEntry[],
  limitBytes: number,
): CanvasHistoryEntry[] {
  const next = [...entries];
  let total = next.reduce((sum, entry) => sum + entry.estimatedBytes, 0);
  while (next.length > 1 && total > limitBytes) {
    total -= next.shift()!.estimatedBytes;
  }
  return next;
}

function retainExistingCanvasHistories(
  state: CanvasWorkspaceCommandState,
): CanvasWorkspaceCommandState {
  const pageIds = new Set(
    state.workspace.projects.flatMap((project) => project.pages.map((page) => page.id)),
  );
  const layerIds = new Set(
    state.workspace.projects.flatMap((project) =>
      project.pages.flatMap((page) => getLayerDocument(page).layers.map((layer) => layer.id)),
    ),
  );
  const canvasHistories = Object.fromEntries(
    Object.entries(state.canvasHistories)
      .filter(([pageId]) => pageIds.has(pageId))
      .map(([pageId, stack]) => [
        pageId,
        {
          past: stack.past.filter((entry) => layerIds.has(entry.command.layerId)),
          future: stack.future.filter((entry) => layerIds.has(entry.command.layerId)),
        },
      ]),
  );
  return { ...state, canvasHistories };
}

const EMPTY_CANVAS_HISTORY: CanvasHistoryStack = Object.freeze({
  past: Object.freeze([]) as unknown as CanvasHistoryEntry[],
  future: Object.freeze([]) as unknown as CanvasHistoryEntry[],
});

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
