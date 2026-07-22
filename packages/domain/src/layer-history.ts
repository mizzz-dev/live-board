import { type ProjectCommand } from './commands.js';
import {
  createWorkspaceCommandState,
  dispatchProjectCommand,
  redoProjectCommand,
  undoProjectCommand,
  type WorkspaceCommandState,
} from './history.js';
import {
  cloneLayerDocument,
  type LayerDocument,
} from './layers.js';
import {
  applyLayerCommand,
  type LayerCommand,
} from './layer-commands.js';
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

export interface LayerHistoryEntry {
  historyId: string;
  command: LayerCommand;
  beforePage: Page;
  afterPage: Page;
  estimatedBytes: number;
}

export interface LayerHistoryStack {
  past: LayerHistoryEntry[];
  future: LayerHistoryEntry[];
}

export interface LayerWorkspaceCommandState extends WorkspaceCommandState {
  layerHistories: Record<PageId, LayerHistoryStack>;
}

export function createLayerWorkspaceCommandState(
  workspace: Workspace,
  historyLimit = 100,
): LayerWorkspaceCommandState {
  return {
    ...createWorkspaceCommandState(workspace, historyLimit),
    layerHistories: {},
  };
}

export function dispatchProjectCommandWithLayerHistory(
  state: LayerWorkspaceCommandState,
  command: ProjectCommand,
): LayerWorkspaceCommandState {
  const result = dispatchProjectCommand(state, command);
  return retainExistingPageHistories({
    ...result,
    layerHistories: state.layerHistories,
  });
}

export function undoProjectCommandWithLayerHistory(
  state: LayerWorkspaceCommandState,
  projectId: ProjectId,
): LayerWorkspaceCommandState {
  const result = undoProjectCommand(state, projectId);
  return retainExistingPageHistories({
    ...result,
    layerHistories: state.layerHistories,
  });
}

export function redoProjectCommandWithLayerHistory(
  state: LayerWorkspaceCommandState,
  projectId: ProjectId,
): LayerWorkspaceCommandState {
  const result = redoProjectCommand(state, projectId);
  return retainExistingPageHistories({
    ...result,
    layerHistories: state.layerHistories,
  });
}

export function dispatchLayerCommand(
  state: LayerWorkspaceCommandState,
  command: LayerCommand,
): LayerWorkspaceCommandState {
  const beforePage = clonePageForLayerHistory(
    findPage(findProject(state.workspace, command.projectId), command.pageId),
  );
  const result = applyLayerCommand(state.workspace, command);
  if (!result.changed) {
    return state;
  }

  const afterPage = clonePageForLayerHistory(
    findPage(findProject(result.workspace, command.projectId), command.pageId),
  );
  const entry: LayerHistoryEntry = {
    historyId: `layer-history:${command.commandId}`,
    command,
    beforePage,
    afterPage,
    estimatedBytes: utf8ByteLength(
      JSON.stringify({
        command,
        beforeLayerDocument: beforePage.layerDocument,
        afterLayerDocument: afterPage.layerDocument,
      }),
    ),
  };
  const currentStack = getLayerHistory(state, command.pageId);

  return {
    ...state,
    workspace: result.workspace,
    layerHistories: {
      ...state.layerHistories,
      [command.pageId]: {
        past: [...currentStack.past, entry].slice(-state.historyLimit),
        future: [],
      },
    },
  };
}

export function undoLayerCommand(
  state: LayerWorkspaceCommandState,
  projectId: ProjectId,
  pageId: PageId,
): LayerWorkspaceCommandState {
  const stack = getLayerHistory(state, pageId);
  const entry = stack.past.at(-1);
  if (entry === undefined) {
    return state;
  }

  return {
    ...state,
    workspace: replacePageInWorkspace(
      state.workspace,
      projectId,
      entry.beforePage,
    ),
    layerHistories: {
      ...state.layerHistories,
      [pageId]: {
        past: stack.past.slice(0, -1),
        future: [...stack.future, entry],
      },
    },
  };
}

export function redoLayerCommand(
  state: LayerWorkspaceCommandState,
  projectId: ProjectId,
  pageId: PageId,
): LayerWorkspaceCommandState {
  const stack = getLayerHistory(state, pageId);
  const entry = stack.future.at(-1);
  if (entry === undefined) {
    return state;
  }

  return {
    ...state,
    workspace: replacePageInWorkspace(
      state.workspace,
      projectId,
      entry.afterPage,
    ),
    layerHistories: {
      ...state.layerHistories,
      [pageId]: {
        past: [...stack.past, entry].slice(-state.historyLimit),
        future: stack.future.slice(0, -1),
      },
    },
  };
}

export function getLayerHistory(
  state: LayerWorkspaceCommandState,
  pageId: PageId,
): LayerHistoryStack {
  return state.layerHistories[pageId] ?? EMPTY_LAYER_HISTORY;
}

export function canUndoLayer(
  state: LayerWorkspaceCommandState,
  pageId: PageId,
): boolean {
  return getLayerHistory(state, pageId).past.length > 0;
}

export function canRedoLayer(
  state: LayerWorkspaceCommandState,
  pageId: PageId,
): boolean {
  return getLayerHistory(state, pageId).future.length > 0;
}

export function clearLayerHistory(
  state: LayerWorkspaceCommandState,
  pageId: PageId,
): LayerWorkspaceCommandState {
  if (state.layerHistories[pageId] === undefined) {
    return state;
  }
  const layerHistories = { ...state.layerHistories };
  delete layerHistories[pageId];
  return { ...state, layerHistories };
}

function retainExistingPageHistories(
  state: LayerWorkspaceCommandState,
): LayerWorkspaceCommandState {
  const pageIds = new Set(
    state.workspace.projects.flatMap((project) =>
      project.pages.map((page) => page.id),
    ),
  );
  const layerHistories = Object.fromEntries(
    Object.entries(state.layerHistories).filter(([pageId]) => pageIds.has(pageId)),
  );
  return { ...state, layerHistories };
}

function replacePageInWorkspace(
  workspace: Workspace,
  projectId: ProjectId,
  page: Page,
): Workspace {
  const project = findProject(workspace, projectId);
  const index = project.pages.findIndex((candidate) => candidate.id === page.id);
  if (index < 0) {
    throw new Error(`Page not found: ${page.id}`);
  }
  const updatedAt = new Date().toISOString();
  const nextProject: Project = {
    ...project,
    pages: project.pages.map((candidate, candidateIndex) =>
      candidateIndex === index ? clonePageForLayerHistory(page) : candidate,
    ),
    updatedAt,
  };
  return replaceProject(workspace, nextProject, updatedAt);
}

function clonePageForLayerHistory(page: Page): Page {
  const layerDocument: LayerDocument | undefined =
    page.layerDocument === undefined
      ? undefined
      : cloneLayerDocument(page.layerDocument);
  return {
    ...page,
    ...(layerDocument === undefined ? {} : { layerDocument }),
  };
}

const EMPTY_LAYER_HISTORY: LayerHistoryStack = Object.freeze({
  past: Object.freeze([]) as unknown as LayerHistoryEntry[],
  future: Object.freeze([]) as unknown as LayerHistoryEntry[],
});

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}
