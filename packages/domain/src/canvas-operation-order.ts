import {
  dispatchCanvasCommand,
  getRasterDrawing,
  type CanvasCommand,
  type CanvasHistoryEntry,
  type CanvasWorkspaceCommandState,
} from './canvas-state.js';
import {
  cloneLayer,
  getLayerDocument,
  type Layer,
  type RasterLayer,
} from './layers.js';
import type { Page } from './model.js';

export function dispatchCanvasCommandWithOperationOrder(
  state: CanvasWorkspaceCommandState,
  command: CanvasCommand,
): CanvasWorkspaceCommandState {
  const result = dispatchCanvasCommand(state, command);
  if (
    result === state ||
    (command.type !== 'canvas.stroke.add' && command.type !== 'canvas.fill.add')
  ) {
    return result;
  }

  const project = result.workspace.projects.find(
    (candidate) => candidate.id === command.projectId,
  );
  const page = project?.pages.find((candidate) => candidate.id === command.pageId);
  if (project === undefined || page === undefined) {
    throw new Error('CANVAS_OPERATION_ORDER_TARGET_NOT_FOUND');
  }
  const document = getLayerDocument(page);
  const layer = document.layers.find((candidate) => candidate.id === command.layerId);
  if (layer?.type !== 'raster') {
    throw new Error('CANVAS_OPERATION_ORDER_RASTER_NOT_FOUND');
  }
  const sequence = getRasterDrawing(layer).revision;
  const nextPage = assignOperationSequence(page, command, sequence);
  const nextWorkspace = {
    ...result.workspace,
    projects: result.workspace.projects.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            pages: candidate.pages.map((candidatePage) =>
              candidatePage.id === nextPage.id ? nextPage : candidatePage,
            ),
          }
        : candidate,
    ),
  };
  const stack = result.canvasHistories[command.pageId];
  if (stack === undefined || stack.past.length === 0) {
    throw new Error('CANVAS_OPERATION_ORDER_HISTORY_NOT_FOUND');
  }
  const latest = stack.past.at(-1)!;
  const nextEntry: CanvasHistoryEntry = {
    ...latest,
    afterPage: assignOperationSequence(latest.afterPage, command, sequence),
  };

  return {
    ...result,
    workspace: nextWorkspace,
    canvasHistories: {
      ...result.canvasHistories,
      [command.pageId]: {
        past: [...stack.past.slice(0, -1), nextEntry],
        future: stack.future,
      },
    },
  };
}

function assignOperationSequence(
  page: Page,
  command: Extract<
    CanvasCommand,
    { type: 'canvas.stroke.add' | 'canvas.fill.add' }
  >,
  sequence: number,
): Page {
  const document = getLayerDocument(page);
  return {
    ...page,
    layerDocument: {
      ...document,
      layers: document.layers.map((layer) =>
        layer.id === command.layerId
          ? assignLayerOperationSequence(layer, command, sequence)
          : cloneLayer(layer),
      ),
    },
  };
}

function assignLayerOperationSequence(
  layer: Layer,
  command: Extract<
    CanvasCommand,
    { type: 'canvas.stroke.add' | 'canvas.fill.add' }
  >,
  sequence: number,
): Layer {
  if (layer.type !== 'raster') {
    throw new Error('CANVAS_OPERATION_ORDER_LAYER_NOT_RASTER');
  }
  const drawing = getRasterDrawing(layer);
  const nextLayer: RasterLayer = {
    ...layer,
    drawing:
      command.type === 'canvas.stroke.add'
        ? {
            ...drawing,
            strokes: drawing.strokes.map((stroke) =>
              stroke.id === command.stroke.id
                ? { ...stroke, sequence }
                : { ...stroke },
            ),
          }
        : {
            ...drawing,
            fills: drawing.fills.map((fill) =>
              fill.id === command.fill.id ? { ...fill, sequence } : { ...fill },
            ),
          },
  };
  return nextLayer;
}
