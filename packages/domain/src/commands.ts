import type { Page, PageId, Project, ProjectId, Workspace } from './index.js';

export type WorkspaceCommand =
  | { type: 'project.rename'; projectId: ProjectId; name: string }
  | { type: 'page.add'; projectId: ProjectId; page: Page; afterPageId?: PageId }
  | { type: 'page.rename'; projectId: ProjectId; pageId: PageId; name: string }
  | { type: 'page.remove'; projectId: ProjectId; pageId: PageId }
  | { type: 'page.selectEdit'; projectId: ProjectId; pageId: PageId }
  | { type: 'page.selectBroadcast'; projectId: ProjectId; pageId: PageId }
  | { type: 'page.reorder'; projectId: ProjectId; pageId: PageId; targetIndex: number };

export interface CommandHistory {
  readonly present: Workspace;
  readonly past: readonly Workspace[];
  readonly future: readonly Workspace[];
  readonly limit: number;
}

const DEFAULT_HISTORY_LIMIT = 100;

export function createCommandHistory(
  workspace: Workspace,
  limit = DEFAULT_HISTORY_LIMIT,
): CommandHistory {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('History limit must be an integer between 1 and 1000');
  }

  return { present: workspace, past: [], future: [], limit };
}

export function executeCommand(
  history: CommandHistory,
  command: WorkspaceCommand,
): CommandHistory {
  const next = applyWorkspaceCommand(history.present, command);

  if (next === history.present) {
    return history;
  }

  return {
    ...history,
    present: next,
    past: [...history.past, history.present].slice(-history.limit),
    future: [],
  };
}

export function undo(history: CommandHistory): CommandHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;

  return {
    ...history,
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
  };
}

export function redo(history: CommandHistory): CommandHistory {
  const next = history.future[0];
  if (next === undefined) return history;

  return {
    ...history,
    present: next,
    past: [...history.past, history.present].slice(-history.limit),
    future: history.future.slice(1),
  };
}

export function canUndo(history: CommandHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: CommandHistory): boolean {
  return history.future.length > 0;
}

export function applyWorkspaceCommand(
  workspace: Workspace,
  command: WorkspaceCommand,
): Workspace {
  return updateProject(workspace, command.projectId, (project) => {
    switch (command.type) {
      case 'project.rename':
        return { ...project, name: normalizeName(command.name, 'Project name') };
      case 'page.add':
        return addPage(project, command.page, command.afterPageId);
      case 'page.rename':
        return updatePage(project, command.pageId, (page) => ({
          ...page,
          name: normalizeName(command.name, 'Page name'),
        }));
      case 'page.remove':
        return removePage(project, command.pageId);
      case 'page.selectEdit':
        assertPageExists(project, command.pageId);
        return { ...project, activeEditPageId: command.pageId };
      case 'page.selectBroadcast':
        assertPageExists(project, command.pageId);
        return { ...project, activeBroadcastPageId: command.pageId };
      case 'page.reorder':
        return reorderPage(project, command.pageId, command.targetIndex);
    }
  });
}

function updateProject(
  workspace: Workspace,
  projectId: ProjectId,
  updater: (project: Project) => Project,
): Workspace {
  const index = workspace.projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new Error(`Project not found: ${projectId}`);

  const current = workspace.projects[index];
  if (current === undefined) throw new Error(`Project not found: ${projectId}`);
  const updated = updater(current);
  if (updated === current) return workspace;

  const projects = [...workspace.projects];
  projects[index] = updated;
  return { ...workspace, projects };
}

function addPage(project: Project, page: Page, afterPageId?: PageId): Project {
  validatePage(page);
  if (project.pages.some((item) => item.id === page.id)) {
    throw new Error(`Page already exists: ${page.id}`);
  }

  let insertionIndex = project.pages.length;
  if (afterPageId !== undefined) {
    const index = project.pages.findIndex((item) => item.id === afterPageId);
    if (index < 0) throw new Error(`Page not found: ${afterPageId}`);
    insertionIndex = index + 1;
  }

  const pages = [...project.pages];
  pages.splice(insertionIndex, 0, { ...page, name: normalizeName(page.name, 'Page name') });
  return { ...project, pages };
}

function removePage(project: Project, pageId: PageId): Project {
  assertPageExists(project, pageId);
  if (project.pages.length === 1) {
    throw new Error('A project must contain at least one page');
  }

  const index = project.pages.findIndex((page) => page.id === pageId);
  const pages = project.pages.filter((page) => page.id !== pageId);
  const fallback = pages[Math.min(index, pages.length - 1)];
  if (fallback === undefined) throw new Error('A project must contain at least one page');

  return {
    ...project,
    pages,
    activeEditPageId:
      project.activeEditPageId === pageId ? fallback.id : project.activeEditPageId,
    activeBroadcastPageId:
      project.activeBroadcastPageId === pageId
        ? fallback.id
        : project.activeBroadcastPageId,
  };
}

function reorderPage(project: Project, pageId: PageId, targetIndex: number): Project {
  assertPageExists(project, pageId);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= project.pages.length) {
    throw new Error(`Invalid page index: ${targetIndex}`);
  }

  const sourceIndex = project.pages.findIndex((page) => page.id === pageId);
  if (sourceIndex === targetIndex) return project;

  const pages = [...project.pages];
  const [page] = pages.splice(sourceIndex, 1);
  if (page === undefined) throw new Error(`Page not found: ${pageId}`);
  pages.splice(targetIndex, 0, page);
  return { ...project, pages };
}

function updatePage(
  project: Project,
  pageId: PageId,
  updater: (page: Page) => Page,
): Project {
  const index = project.pages.findIndex((page) => page.id === pageId);
  if (index < 0) throw new Error(`Page not found: ${pageId}`);
  const page = project.pages[index];
  if (page === undefined) throw new Error(`Page not found: ${pageId}`);

  const pages = [...project.pages];
  pages[index] = updater(page);
  return { ...project, pages };
}

function validatePage(page: Page): void {
  if (page.id.trim().length === 0) throw new Error('Page id is required');
  normalizeName(page.name, 'Page name');
  if (!Number.isInteger(page.width) || page.width < 1 || page.width > 32_768) {
    throw new Error('Page width must be an integer between 1 and 32768');
  }
  if (!Number.isInteger(page.height) || page.height < 1 || page.height > 32_768) {
    throw new Error('Page height must be an integer between 1 and 32768');
  }
}

function normalizeName(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new Error(`${label} must contain between 1 and 100 characters`);
  }
  return normalized;
}

function assertPageExists(project: Project, pageId: PageId): void {
  if (!project.pages.some((page) => page.id === pageId)) {
    throw new Error(`Page not found: ${pageId}`);
  }
}
