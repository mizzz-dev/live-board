export type WorkspaceId = string;
export type ProjectId = string;
export type PageId = string;

export interface Page {
  id: PageId;
  name: string;
  width: number;
  height: number;
  transparent: boolean;
}

export interface Project {
  id: ProjectId;
  name: string;
  pages: Page[];
  activeEditPageId: PageId;
  activeBroadcastPageId: PageId;
}

export interface Workspace {
  id: WorkspaceId;
  name: string;
  projects: Project[];
  activeProjectId: ProjectId;
  revision: number;
  schemaVersion: 1;
}

export type WorkspaceCommand =
  | { type: 'workspace.rename'; name: string }
  | { type: 'project.add'; project: Project }
  | { type: 'project.rename'; projectId: ProjectId; name: string }
  | { type: 'project.select'; projectId: ProjectId }
  | { type: 'page.add'; projectId: ProjectId; page: Page }
  | { type: 'page.rename'; projectId: ProjectId; pageId: PageId; name: string }
  | { type: 'page.delete'; projectId: ProjectId; pageId: PageId }
  | { type: 'page.selectEdit'; projectId: ProjectId; pageId: PageId }
  | { type: 'page.selectBroadcast'; projectId: ProjectId; pageId: PageId };

export interface HistoryEntry {
  command: WorkspaceCommand;
  workspace: Workspace;
}

export interface WorkspaceHistory {
  present: Workspace;
  past: HistoryEntry[];
  future: HistoryEntry[];
  limit: number;
}

const DEFAULT_PAGE_WIDTH = 1920;
const DEFAULT_PAGE_HEIGHT = 1080;
const DEFAULT_HISTORY_LIMIT = 100;

export function createEmptyWorkspace(workspaceId: WorkspaceId): Workspace {
  const pageId = `${workspaceId}:page:1`;
  const projectId = `${workspaceId}:project:1`;

  return {
    id: workspaceId,
    name: '新しいワークスペース',
    schemaVersion: 1,
    revision: 0,
    activeProjectId: projectId,
    projects: [
      {
        id: projectId,
        name: '新しいプロジェクト',
        activeEditPageId: pageId,
        activeBroadcastPageId: pageId,
        pages: [
          {
            id: pageId,
            name: 'ページ 1',
            width: DEFAULT_PAGE_WIDTH,
            height: DEFAULT_PAGE_HEIGHT,
            transparent: true,
          },
        ],
      },
    ],
  };
}

export function createWorkspaceHistory(
  workspace: Workspace,
  limit = DEFAULT_HISTORY_LIMIT,
): WorkspaceHistory {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('History limit must be a positive integer');
  }
  assertWorkspaceValid(workspace);
  return { present: workspace, past: [], future: [], limit };
}

export function dispatchWorkspaceCommand(
  history: WorkspaceHistory,
  command: WorkspaceCommand,
): WorkspaceHistory {
  const next = executeWorkspaceCommand(history.present, command);
  if (next === history.present) return history;

  const past = [
    ...history.past,
    { command, workspace: history.present },
  ].slice(-history.limit);

  return { ...history, present: next, past, future: [] };
}

export function undoWorkspaceCommand(history: WorkspaceHistory): WorkspaceHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;

  return {
    ...history,
    present: previous.workspace,
    past: history.past.slice(0, -1),
    future: [{ command: previous.command, workspace: history.present }, ...history.future],
  };
}

export function redoWorkspaceCommand(history: WorkspaceHistory): WorkspaceHistory {
  const next = history.future[0];
  if (!next) return history;

  return {
    ...history,
    present: next.workspace,
    past: [...history.past, { command: next.command, workspace: history.present }].slice(
      -history.limit,
    ),
    future: history.future.slice(1),
  };
}

export function executeWorkspaceCommand(
  workspace: Workspace,
  command: WorkspaceCommand,
): Workspace {
  assertWorkspaceValid(workspace);
  let next: Workspace;

  switch (command.type) {
    case 'workspace.rename':
      next = { ...workspace, name: requireName(command.name, 'Workspace') };
      break;
    case 'project.add':
      assertProjectValid(command.project);
      if (workspace.projects.some((project) => project.id === command.project.id)) {
        throw new Error(`Project already exists: ${command.project.id}`);
      }
      next = { ...workspace, projects: [...workspace.projects, command.project] };
      break;
    case 'project.rename':
      next = updateProject(workspace, command.projectId, (project) => ({
        ...project,
        name: requireName(command.name, 'Project'),
      }));
      break;
    case 'project.select':
      assertProjectExists(workspace, command.projectId);
      next = { ...workspace, activeProjectId: command.projectId };
      break;
    case 'page.add':
      next = updateProject(workspace, command.projectId, (project) => {
        assertPageValid(command.page);
        if (project.pages.some((page) => page.id === command.page.id)) {
          throw new Error(`Page already exists: ${command.page.id}`);
        }
        return { ...project, pages: [...project.pages, command.page] };
      });
      break;
    case 'page.rename':
      next = updateProject(workspace, command.projectId, (project) => ({
        ...project,
        pages: project.pages.map((page) =>
          page.id === command.pageId
            ? { ...page, name: requireName(command.name, 'Page') }
            : page,
        ),
      }), command.pageId);
      break;
    case 'page.delete':
      next = updateProject(workspace, command.projectId, (project) => {
        assertPageExists(project, command.pageId);
        if (project.pages.length === 1) throw new Error('Project must contain at least one page');
        const pages = project.pages.filter((page) => page.id !== command.pageId);
        const fallbackId = pages[0]!.id;
        return {
          ...project,
          pages,
          activeEditPageId:
            project.activeEditPageId === command.pageId ? fallbackId : project.activeEditPageId,
          activeBroadcastPageId:
            project.activeBroadcastPageId === command.pageId
              ? fallbackId
              : project.activeBroadcastPageId,
        };
      });
      break;
    case 'page.selectEdit':
      next = updateProject(workspace, command.projectId, (project) =>
        selectEditPage(project, command.pageId),
      );
      break;
    case 'page.selectBroadcast':
      next = updateProject(workspace, command.projectId, (project) =>
        selectBroadcastPage(project, command.pageId),
      );
      break;
  }

  if (isWorkspaceEquivalent(workspace, next)) return workspace;
  const revised = { ...next, revision: workspace.revision + 1 };
  assertWorkspaceValid(revised);
  return revised;
}

export function selectEditPage(project: Project, pageId: PageId): Project {
  assertPageExists(project, pageId);
  return project.activeEditPageId === pageId ? project : { ...project, activeEditPageId: pageId };
}

export function selectBroadcastPage(project: Project, pageId: PageId): Project {
  assertPageExists(project, pageId);
  return project.activeBroadcastPageId === pageId
    ? project
    : { ...project, activeBroadcastPageId: pageId };
}

export function assertWorkspaceValid(workspace: Workspace): void {
  requireId(workspace.id, 'Workspace');
  requireName(workspace.name, 'Workspace');
  if (workspace.projects.length === 0) throw new Error('Workspace must contain at least one project');
  assertUniqueIds(workspace.projects.map((project) => project.id), 'Project');
  workspace.projects.forEach(assertProjectValid);
  assertProjectExists(workspace, workspace.activeProjectId);
  if (!Number.isInteger(workspace.revision) || workspace.revision < 0) {
    throw new Error('Workspace revision must be a non-negative integer');
  }
}

function assertProjectValid(project: Project): void {
  requireId(project.id, 'Project');
  requireName(project.name, 'Project');
  if (project.pages.length === 0) throw new Error('Project must contain at least one page');
  assertUniqueIds(project.pages.map((page) => page.id), 'Page');
  project.pages.forEach(assertPageValid);
  assertPageExists(project, project.activeEditPageId);
  assertPageExists(project, project.activeBroadcastPageId);
}

function assertPageValid(page: Page): void {
  requireId(page.id, 'Page');
  requireName(page.name, 'Page');
  if (!Number.isInteger(page.width) || page.width < 1) throw new Error('Page width must be a positive integer');
  if (!Number.isInteger(page.height) || page.height < 1) throw new Error('Page height must be a positive integer');
}

function updateProject(
  workspace: Workspace,
  projectId: ProjectId,
  updater: (project: Project) => Project,
  pageId?: PageId,
): Workspace {
  assertProjectExists(workspace, projectId);
  const project = workspace.projects.find((item) => item.id === projectId)!;
  if (pageId) assertPageExists(project, pageId);
  const updated = updater(project);
  if (updated === project) return workspace;
  return {
    ...workspace,
    projects: workspace.projects.map((item) => (item.id === projectId ? updated : item)),
  };
}

function assertProjectExists(workspace: Workspace, projectId: ProjectId): void {
  if (!workspace.projects.some((project) => project.id === projectId)) {
    throw new Error(`Project not found: ${projectId}`);
  }
}

function assertPageExists(project: Project, pageId: PageId): void {
  if (!project.pages.some((page) => page.id === pageId)) {
    throw new Error(`Page not found: ${pageId}`);
  }
}

function requireId(value: string, target: string): string {
  if (value.trim().length === 0) throw new Error(`${target} id must not be empty`);
  return value;
}

function requireName(value: string, target: string): string {
  const name = value.trim();
  if (name.length === 0) throw new Error(`${target} name must not be empty`);
  if (name.length > 120) throw new Error(`${target} name must be 120 characters or fewer`);
  return name;
}

function assertUniqueIds(ids: string[], target: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${target} ids must be unique`);
}

function isWorkspaceEquivalent(left: Workspace, right: Workspace): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
