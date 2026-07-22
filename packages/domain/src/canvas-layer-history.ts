import type { LayerCommand } from './layer-commands.js';
import {
  dispatchLayerCommand as dispatchBaseLayerCommand,
  redoLayerCommand as redoBaseLayerCommand,
  undoLayerCommand as undoBaseLayerCommand,
  type LayerWorkspaceCommandState,
} from './layer-history.js';
import {
  dispatchLayerCommandWithCanvasHistory,
  type CanvasWorkspaceCommandState,
} from './canvas-state.js';
import { getLayerDocument } from './layers.js';
import type { PageId, ProjectId } from './model.js';

export function dispatchLayerCommand(
  state: LayerWorkspaceCommandState,
  command: LayerCommand,
): LayerWorkspaceCommandState {
  if (!isCanvasState(state)) {
    return dispatchBaseLayerCommand(state, command);
  }
  return dispatchLayerCommandWithCanvasHistory(state, command);
}

export function undoLayerCommand(
  state: LayerWorkspaceCommandState,
  projectId: ProjectId,
  pageId: PageId,
): LayerWorkspaceCommandState {
  const result = undoBaseLayerCommand(state, projectId, pageId);
  return isCanvasState(result) ? pruneCanvasHistories(result) : result;
}

export function redoLayerCommand(
  state: LayerWorkspaceCommandState,
  projectId: ProjectId,
  pageId: PageId,
): LayerWorkspaceCommandState {
  const result = redoBaseLayerCommand(state, projectId, pageId);
  return isCanvasState(result) ? pruneCanvasHistories(result) : result;
}

function isCanvasState(
  state: LayerWorkspaceCommandState,
): state is CanvasWorkspaceCommandState {
  return (
    'canvasHistories' in state &&
    'canvasHistoryMemoryLimitBytes' in state
  );
}

function pruneCanvasHistories(
  state: CanvasWorkspaceCommandState,
): CanvasWorkspaceCommandState {
  const pageIds = new Set<string>();
  const layerIdsByPage = new Map<string, Set<string>>();
  for (const project of state.workspace.projects) {
    for (const page of project.pages) {
      pageIds.add(page.id);
      layerIdsByPage.set(
        page.id,
        new Set(
          getLayerDocument(page).layers.map((layer) => layer.id),
        ),
      );
    }
  }

  const canvasHistories = Object.fromEntries(
    Object.entries(state.canvasHistories)
      .filter(([pageId]) => pageIds.has(pageId))
      .map(([pageId, stack]) => {
        const layerIds = layerIdsByPage.get(pageId) ?? new Set<string>();
        return [
          pageId,
          {
            past: stack.past.filter((entry) =>
              layerIds.has(entry.command.layerId),
            ),
            future: stack.future.filter((entry) =>
              layerIds.has(entry.command.layerId),
            ),
          },
        ];
      }),
  );

  return { ...state, canvasHistories };
}
