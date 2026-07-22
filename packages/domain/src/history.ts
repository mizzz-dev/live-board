import {
  cloneProject,
  findProject,
  replaceProject,
  type PageId,
  type Project,
  type ProjectId,
  type Workspace,
} from './model.js';
import {
  applyProjectCommand,
  type ProjectCommand,
} from './commands.js';

export interface HistoryEntry {
  historyId: string;
  command: ProjectCommand;
  beforeProject: Project;
  afterProject: Project;
  estimatedBytes: number;
}

export interface HistoryStack {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export interface CommandHistories {
  project: Record<ProjectId, HistoryStack>;
  page: Record<PageId, HistoryStack>;
}

export interface WorkspaceCommandState {
  workspace: Workspace;
  histories: CommandHistories;
  historyLimit: number;
}

export function createWorkspaceCommandState(
  workspace: Workspace,
  historyLimit = 100,
): WorkspaceCommandState {
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 1000) {
    throw new Error(`Invalid history limit: ${historyLimit}`);
  }

  return {
    workspace,
    histories: {
      project: {},
      page: {},
    },
    historyLimit,
  };
}

export function dispatchProjectCommand(
  state: WorkspaceCommandState,
  command: ProjectCommand,
): WorkspaceCommandState {
  const beforeProject = cloneProject(findProject(state.workspace, command.targetId));
  const result = applyProjectCommand(state.workspace, command);

  if (!result.changed) {
    return state;
  }

  const afterProject = cloneProject(findProject(result.workspace, command.targetId));
  const entry: HistoryEntry = {
    historyId: `history:${command.commandId}`,
    command,
    beforeProject,
    afterProject,
    estimatedBytes: estimateHistoryBytes(beforeProject, afterProject, command),
  };
  const currentStack = getProjectHistory(state, command.targetId);
  const past = [...currentStack.past, entry].slice(-state.historyLimit);

  return {
    ...state,
    workspace: result.workspace,
    histories: {
      project: {
        ...state.histories.project,
        [command.targetId]: {
          past,
          future: [],
        },
      },
      page: state.histories.page,
    },
  };
}

export function undoProjectCommand(
  state: WorkspaceCommandState,
  projectId: ProjectId,
): WorkspaceCommandState {
  const currentStack = getProjectHistory(state, projectId);
  const entry = currentStack.past.at(-1);

  if (entry === undefined) {
    return state;
  }

  const workspace = replaceProject(
    state.workspace,
    entry.beforeProject,
    new Date().toISOString(),
  );

  return {
    ...state,
    workspace,
    histories: {
      project: {
        ...state.histories.project,
        [projectId]: {
          past: currentStack.past.slice(0, -1),
          future: [...currentStack.future, entry],
        },
      },
      page: state.histories.page,
    },
  };
}

export function redoProjectCommand(
  state: WorkspaceCommandState,
  projectId: ProjectId,
): WorkspaceCommandState {
  const currentStack = getProjectHistory(state, projectId);
  const entry = currentStack.future.at(-1);

  if (entry === undefined) {
    return state;
  }

  const workspace = replaceProject(
    state.workspace,
    entry.afterProject,
    new Date().toISOString(),
  );

  return {
    ...state,
    workspace,
    histories: {
      project: {
        ...state.histories.project,
        [projectId]: {
          past: [...currentStack.past, entry].slice(-state.historyLimit),
          future: currentStack.future.slice(0, -1),
        },
      },
      page: state.histories.page,
    },
  };
}

export function getProjectHistory(
  state: WorkspaceCommandState,
  projectId: ProjectId,
): HistoryStack {
  return state.histories.project[projectId] ?? EMPTY_HISTORY;
}

export function getPageHistory(
  state: WorkspaceCommandState,
  pageId: PageId,
): HistoryStack {
  return state.histories.page[pageId] ?? EMPTY_HISTORY;
}

export function canUndoProject(
  state: WorkspaceCommandState,
  projectId: ProjectId,
): boolean {
  return getProjectHistory(state, projectId).past.length > 0;
}

export function canRedoProject(
  state: WorkspaceCommandState,
  projectId: ProjectId,
): boolean {
  return getProjectHistory(state, projectId).future.length > 0;
}

export function clearProjectHistory(
  state: WorkspaceCommandState,
  projectId: ProjectId,
): WorkspaceCommandState {
  if (state.histories.project[projectId] === undefined) {
    return state;
  }

  const projectHistories = { ...state.histories.project };
  delete projectHistories[projectId];

  return {
    ...state,
    histories: {
      project: projectHistories,
      page: state.histories.page,
    },
  };
}

const EMPTY_HISTORY: HistoryStack = Object.freeze({
  past: Object.freeze([]) as unknown as HistoryEntry[],
  future: Object.freeze([]) as unknown as HistoryEntry[],
});

function estimateHistoryBytes(
  beforeProject: Project,
  afterProject: Project,
  command: ProjectCommand,
): number {
  return new TextEncoder().encode(
    JSON.stringify({ beforeProject, afterProject, command }),
  ).byteLength;
}
