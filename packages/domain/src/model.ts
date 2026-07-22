export type WorkspaceId = string;
export type ProjectId = string;
export type PageId = string;

export const WORKSPACE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_PAGE_WIDTH = 1920;
export const DEFAULT_PAGE_HEIGHT = 1080;
export const DEFAULT_PAGE_DPI = 72;

export type DomainErrorCode =
  | 'INVALID_ID'
  | 'INVALID_NAME'
  | 'INVALID_PAGE_SIZE'
  | 'DUPLICATE_PROJECT_ID'
  | 'DUPLICATE_PAGE_ID'
  | 'WORKSPACE_PROJECT_REQUIRED'
  | 'PROJECT_PAGE_REQUIRED'
  | 'PROJECT_NOT_FOUND'
  | 'PAGE_NOT_FOUND'
  | 'PAGE_PROJECT_MISMATCH'
  | 'INVALID_PAGE_INDEX'
  | 'LAST_PAGE_DELETE_FORBIDDEN';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export interface Page {
  id: PageId;
  projectId: ProjectId;
  name: string;
  width: number;
  height: number;
  dpi: number;
  transparent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  pages: Page[];
  activeEditPageId: PageId;
  activeBroadcastPageId: PageId;
  broadcastPageLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: WorkspaceId;
  name: string;
  projects: Project[];
  activeProjectId: ProjectId;
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePageInput {
  id: PageId;
  projectId: ProjectId;
  name: string;
  width?: number;
  height?: number;
  dpi?: number;
  transparent?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProjectInput {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  pages: Page[];
  activeEditPageId?: PageId;
  activeBroadcastPageId?: PageId;
  broadcastPageLocked?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateWorkspaceInput {
  id: WorkspaceId;
  name: string;
  projects: Project[];
  activeProjectId?: ProjectId;
  createdAt?: string;
  updatedAt?: string;
}

export function createPage(input: CreatePageInput): Page {
  assertEntityId(input.id);
  assertEntityId(input.projectId);
  assertEntityName(input.name);

  const width = input.width ?? DEFAULT_PAGE_WIDTH;
  const height = input.height ?? DEFAULT_PAGE_HEIGHT;
  const dpi = input.dpi ?? DEFAULT_PAGE_DPI;
  assertPageSize(width, height, dpi);

  const createdAt = input.createdAt ?? currentTimestamp();
  const updatedAt = input.updatedAt ?? createdAt;

  return {
    id: input.id,
    projectId: input.projectId,
    name: input.name,
    width,
    height,
    dpi,
    transparent: input.transparent ?? true,
    createdAt,
    updatedAt,
  };
}

export function createProject(input: CreateProjectInput): Project {
  assertEntityId(input.id);
  assertEntityId(input.workspaceId);
  assertEntityName(input.name);

  if (input.pages.length === 0) {
    throw new DomainError(
      'PROJECT_PAGE_REQUIRED',
      'Project must contain at least one page',
    );
  }

  assertUniquePageIds(input.pages);

  for (const page of input.pages) {
    if (page.projectId !== input.id) {
      throw new DomainError(
        'PAGE_PROJECT_MISMATCH',
        `Page ${page.id} does not belong to project ${input.id}`,
      );
    }
  }

  const activeEditPageId = input.activeEditPageId ?? input.pages[0]!.id;
  const activeBroadcastPageId =
    input.activeBroadcastPageId ?? activeEditPageId;
  assertPageExists(input.pages, activeEditPageId);
  assertPageExists(input.pages, activeBroadcastPageId);

  const createdAt = input.createdAt ?? currentTimestamp();
  const updatedAt = input.updatedAt ?? createdAt;

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    name: input.name,
    pages: input.pages.map(clonePage),
    activeEditPageId,
    activeBroadcastPageId,
    broadcastPageLocked: input.broadcastPageLocked ?? false,
    createdAt,
    updatedAt,
  };
}

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  assertEntityId(input.id);
  assertEntityName(input.name);

  if (input.projects.length === 0) {
    throw new DomainError(
      'WORKSPACE_PROJECT_REQUIRED',
      'Workspace must contain at least one project',
    );
  }

  assertUniqueProjectIds(input.projects);

  for (const project of input.projects) {
    if (project.workspaceId !== input.id) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        `Project ${project.id} does not belong to workspace ${input.id}`,
      );
    }
  }

  const activeProjectId = input.activeProjectId ?? input.projects[0]!.id;
  if (!input.projects.some((project) => project.id === activeProjectId)) {
    throw new DomainError(
      'PROJECT_NOT_FOUND',
      `Project not found: ${activeProjectId}`,
    );
  }

  const createdAt = input.createdAt ?? currentTimestamp();
  const updatedAt = input.updatedAt ?? createdAt;
  const workspace: Workspace = {
    id: input.id,
    name: input.name,
    projects: input.projects.map(cloneProject),
    activeProjectId,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    createdAt,
    updatedAt,
  };

  assertWorkspaceIntegrity(workspace);
  return workspace;
}

export function createEmptyWorkspace(workspaceId: WorkspaceId): Workspace {
  const timestamp = currentTimestamp();
  const projectId = `${workspaceId}:project:1`;
  const pageId = `${workspaceId}:page:1`;
  const page = createPage({
    id: pageId,
    projectId,
    name: 'ページ 1',
    createdAt: timestamp,
  });
  const project = createProject({
    id: projectId,
    workspaceId,
    name: '新しいプロジェクト',
    pages: [page],
    createdAt: timestamp,
  });

  return createWorkspace({
    id: workspaceId,
    name: '新しいワークスペース',
    projects: [project],
    createdAt: timestamp,
  });
}

export function clonePage(page: Page): Page {
  return { ...page };
}

export function cloneProject(project: Project): Project {
  return {
    ...project,
    pages: project.pages.map(clonePage),
  };
}

export function cloneWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    projects: workspace.projects.map(cloneProject),
  };
}

export function findProject(
  workspace: Workspace,
  projectId: ProjectId,
): Project {
  const project = workspace.projects.find((candidate) => candidate.id === projectId);

  if (project === undefined) {
    throw new DomainError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
  }

  return project;
}

export function findPage(project: Project, pageId: PageId): Page {
  const page = project.pages.find((candidate) => candidate.id === pageId);

  if (page === undefined) {
    throw new DomainError('PAGE_NOT_FOUND', `Page not found: ${pageId}`);
  }

  return page;
}

export function replaceProject(
  workspace: Workspace,
  project: Project,
  updatedAt = currentTimestamp(),
): Workspace {
  const projectIndex = workspace.projects.findIndex(
    (candidate) => candidate.id === project.id,
  );

  if (projectIndex < 0) {
    throw new DomainError('PROJECT_NOT_FOUND', `Project not found: ${project.id}`);
  }

  const projects = workspace.projects.map((candidate, index) =>
    index === projectIndex ? cloneProject(project) : candidate,
  );

  const updatedWorkspace: Workspace = {
    ...workspace,
    projects,
    updatedAt,
  };
  assertWorkspaceIntegrity(updatedWorkspace);
  return updatedWorkspace;
}

export function assertWorkspaceIntegrity(workspace: Workspace): void {
  if (workspace.projects.length === 0) {
    throw new DomainError(
      'WORKSPACE_PROJECT_REQUIRED',
      'Workspace must contain at least one project',
    );
  }

  assertUniqueProjectIds(workspace.projects);

  if (!workspace.projects.some((project) => project.id === workspace.activeProjectId)) {
    throw new DomainError(
      'PROJECT_NOT_FOUND',
      `Project not found: ${workspace.activeProjectId}`,
    );
  }

  const pageIds = new Set<PageId>();

  for (const project of workspace.projects) {
    if (project.workspaceId !== workspace.id) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        `Project ${project.id} does not belong to workspace ${workspace.id}`,
      );
    }

    if (project.pages.length === 0) {
      throw new DomainError(
        'PROJECT_PAGE_REQUIRED',
        `Project ${project.id} must contain at least one page`,
      );
    }

    assertUniquePageIds(project.pages);
    assertPageExists(project.pages, project.activeEditPageId);
    assertPageExists(project.pages, project.activeBroadcastPageId);

    for (const page of project.pages) {
      if (page.projectId !== project.id) {
        throw new DomainError(
          'PAGE_PROJECT_MISMATCH',
          `Page ${page.id} does not belong to project ${project.id}`,
        );
      }

      if (pageIds.has(page.id)) {
        throw new DomainError(
          'DUPLICATE_PAGE_ID',
          `Duplicate page id: ${page.id}`,
        );
      }
      pageIds.add(page.id);
    }
  }
}

export function assertInsertIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new DomainError('INVALID_PAGE_INDEX', `Invalid page index: ${index}`);
  }
}

export function assertMoveIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new DomainError('INVALID_PAGE_INDEX', `Invalid page index: ${index}`);
  }
}

function assertEntityId(value: string): void {
  if (
    value.length < 1 ||
    value.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value)
  ) {
    throw new DomainError('INVALID_ID', `Invalid entity id: ${value}`);
  }
}

function assertEntityName(value: string): void {
  if (value.trim().length < 1 || value.length > 120) {
    throw new DomainError('INVALID_NAME', 'Entity name must be 1 to 120 characters');
  }
}

function assertPageSize(width: number, height: number, dpi: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isFinite(dpi) ||
    width < 1 ||
    height < 1 ||
    width > 32768 ||
    height > 32768 ||
    dpi < 1 ||
    dpi > 2400
  ) {
    throw new DomainError(
      'INVALID_PAGE_SIZE',
      `Invalid page size: ${width}x${height}@${dpi}`,
    );
  }
}

function assertUniqueProjectIds(projects: Project[]): void {
  const ids = new Set<ProjectId>();

  for (const project of projects) {
    if (ids.has(project.id)) {
      throw new DomainError(
        'DUPLICATE_PROJECT_ID',
        `Duplicate project id: ${project.id}`,
      );
    }
    ids.add(project.id);
  }
}

function assertUniquePageIds(pages: Page[]): void {
  const ids = new Set<PageId>();

  for (const page of pages) {
    if (ids.has(page.id)) {
      throw new DomainError('DUPLICATE_PAGE_ID', `Duplicate page id: ${page.id}`);
    }
    ids.add(page.id);
  }
}

function assertPageExists(pages: Page[], pageId: PageId): void {
  if (!pages.some((page) => page.id === pageId)) {
    throw new DomainError('PAGE_NOT_FOUND', `Page not found: ${pageId}`);
  }
}

function currentTimestamp(): string {
  return new Date().toISOString();
}
