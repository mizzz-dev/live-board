import {
  assertInsertIndex,
  assertMoveIndex,
  clonePage,
  type Page,
  type PageId,
  type Project,
  type ProjectId,
  type Workspace,
  findPage,
  findProject,
  replaceProject,
  DomainError,
} from './model.js';

export type ProjectCommandType =
  | 'page.add'
  | 'page.duplicate'
  | 'page.delete'
  | 'page.move'
  | 'page.select-edit'
  | 'page.select-broadcast';

interface ProjectCommandBase<TType extends ProjectCommandType, TPayload> {
  commandId: string;
  type: TType;
  scope: 'project';
  targetId: ProjectId;
  payload: TPayload;
  createdAt: string;
}

export type AddPageCommand = ProjectCommandBase<
  'page.add',
  { page: Page; index?: number }
>;
export type DuplicatePageCommand = ProjectCommandBase<
  'page.duplicate',
  { sourcePageId: PageId; page: Page }
>;
export type DeletePageCommand = ProjectCommandBase<
  'page.delete',
  { pageId: PageId }
>;
export type MovePageCommand = ProjectCommandBase<
  'page.move',
  { pageId: PageId; toIndex: number }
>;
export type SelectEditPageCommand = ProjectCommandBase<
  'page.select-edit',
  { pageId: PageId }
>;
export type SelectBroadcastPageCommand = ProjectCommandBase<
  'page.select-broadcast',
  { pageId: PageId }
>;

export type ProjectCommand =
  | AddPageCommand
  | DuplicatePageCommand
  | DeletePageCommand
  | MovePageCommand
  | SelectEditPageCommand
  | SelectBroadcastPageCommand;

export interface ApplyCommandResult {
  workspace: Workspace;
  changed: boolean;
}

export interface CommandMetadata {
  commandId: string;
  createdAt?: string;
}

export function createAddPageCommand(
  projectId: ProjectId,
  page: Page,
  metadata: CommandMetadata,
  index?: number,
): AddPageCommand {
  return {
    ...createCommandBase('page.add', projectId, metadata),
    payload: index === undefined ? { page } : { page, index },
  };
}

export function createDuplicatePageCommand(
  projectId: ProjectId,
  sourcePageId: PageId,
  page: Page,
  metadata: CommandMetadata,
): DuplicatePageCommand {
  return {
    ...createCommandBase('page.duplicate', projectId, metadata),
    payload: { sourcePageId, page },
  };
}

export function createDeletePageCommand(
  projectId: ProjectId,
  pageId: PageId,
  metadata: CommandMetadata,
): DeletePageCommand {
  return {
    ...createCommandBase('page.delete', projectId, metadata),
    payload: { pageId },
  };
}

export function createMovePageCommand(
  projectId: ProjectId,
  pageId: PageId,
  toIndex: number,
  metadata: CommandMetadata,
): MovePageCommand {
  return {
    ...createCommandBase('page.move', projectId, metadata),
    payload: { pageId, toIndex },
  };
}

export function createSelectEditPageCommand(
  projectId: ProjectId,
  pageId: PageId,
  metadata: CommandMetadata,
): SelectEditPageCommand {
  return {
    ...createCommandBase('page.select-edit', projectId, metadata),
    payload: { pageId },
  };
}

export function createSelectBroadcastPageCommand(
  projectId: ProjectId,
  pageId: PageId,
  metadata: CommandMetadata,
): SelectBroadcastPageCommand {
  return {
    ...createCommandBase('page.select-broadcast', projectId, metadata),
    payload: { pageId },
  };
}

export function applyProjectCommand(
  workspace: Workspace,
  command: ProjectCommand,
): ApplyCommandResult {
  const project = findProject(workspace, command.targetId);
  const nextProject = applyCommandToProject(project, command);

  if (nextProject === project) {
    return { workspace, changed: false };
  }

  return {
    workspace: replaceProject(workspace, nextProject, command.createdAt),
    changed: true,
  };
}

export function selectEditPage(project: Project, pageId: PageId): Project {
  findPage(project, pageId);

  if (project.activeEditPageId === pageId) {
    return project;
  }

  return {
    ...project,
    activeEditPageId: pageId,
  };
}

export function selectBroadcastPage(project: Project, pageId: PageId): Project {
  findPage(project, pageId);

  if (project.activeBroadcastPageId === pageId) {
    return project;
  }

  return {
    ...project,
    activeBroadcastPageId: pageId,
  };
}

function applyCommandToProject(
  project: Project,
  command: ProjectCommand,
): Project {
  switch (command.type) {
    case 'page.add':
      return addPage(project, command.payload.page, command.payload.index, command.createdAt);
    case 'page.duplicate':
      return duplicatePage(
        project,
        command.payload.sourcePageId,
        command.payload.page,
        command.createdAt,
      );
    case 'page.delete':
      return deletePage(project, command.payload.pageId, command.createdAt);
    case 'page.move':
      return movePage(
        project,
        command.payload.pageId,
        command.payload.toIndex,
        command.createdAt,
      );
    case 'page.select-edit': {
      const selected = selectEditPage(project, command.payload.pageId);
      return selected === project
        ? project
        : { ...selected, updatedAt: command.createdAt };
    }
    case 'page.select-broadcast': {
      const selected = selectBroadcastPage(project, command.payload.pageId);
      return selected === project
        ? project
        : { ...selected, updatedAt: command.createdAt };
    }
  }
}

function addPage(
  project: Project,
  page: Page,
  index: number | undefined,
  updatedAt: string,
): Project {
  assertPageCanBeInserted(project, page);
  const insertIndex = index ?? project.pages.length;
  assertInsertIndex(insertIndex, project.pages.length);

  const pages = [...project.pages];
  pages.splice(insertIndex, 0, clonePage(page));

  return {
    ...project,
    pages,
    activeEditPageId: page.id,
    updatedAt,
  };
}

function duplicatePage(
  project: Project,
  sourcePageId: PageId,
  page: Page,
  updatedAt: string,
): Project {
  const sourceIndex = project.pages.findIndex(
    (candidate) => candidate.id === sourcePageId,
  );

  if (sourceIndex < 0) {
    throw new DomainError('PAGE_NOT_FOUND', `Page not found: ${sourcePageId}`);
  }

  assertPageCanBeInserted(project, page);
  const pages = [...project.pages];
  pages.splice(sourceIndex + 1, 0, clonePage(page));

  return {
    ...project,
    pages,
    activeEditPageId: page.id,
    updatedAt,
  };
}

function deletePage(
  project: Project,
  pageId: PageId,
  updatedAt: string,
): Project {
  const pageIndex = project.pages.findIndex((page) => page.id === pageId);

  if (pageIndex < 0) {
    throw new DomainError('PAGE_NOT_FOUND', `Page not found: ${pageId}`);
  }

  if (project.pages.length === 1) {
    throw new DomainError(
      'LAST_PAGE_DELETE_FORBIDDEN',
      'The last page in a project cannot be deleted',
    );
  }

  const pages = project.pages.filter((page) => page.id !== pageId);
  const fallbackPage = pages[Math.min(pageIndex, pages.length - 1)]!;

  return {
    ...project,
    pages,
    activeEditPageId:
      project.activeEditPageId === pageId
        ? fallbackPage.id
        : project.activeEditPageId,
    activeBroadcastPageId:
      project.activeBroadcastPageId === pageId
        ? fallbackPage.id
        : project.activeBroadcastPageId,
    updatedAt,
  };
}

function movePage(
  project: Project,
  pageId: PageId,
  toIndex: number,
  updatedAt: string,
): Project {
  const fromIndex = project.pages.findIndex((page) => page.id === pageId);

  if (fromIndex < 0) {
    throw new DomainError('PAGE_NOT_FOUND', `Page not found: ${pageId}`);
  }

  assertMoveIndex(toIndex, project.pages.length);

  if (fromIndex === toIndex) {
    return project;
  }

  const pages = [...project.pages];
  const [page] = pages.splice(fromIndex, 1);
  pages.splice(toIndex, 0, page!);

  return {
    ...project,
    pages,
    updatedAt,
  };
}

function assertPageCanBeInserted(project: Project, page: Page): void {
  if (page.projectId !== project.id) {
    throw new DomainError(
      'PAGE_PROJECT_MISMATCH',
      `Page ${page.id} does not belong to project ${project.id}`,
    );
  }

  if (project.pages.some((candidate) => candidate.id === page.id)) {
    throw new DomainError('DUPLICATE_PAGE_ID', `Duplicate page id: ${page.id}`);
  }
}

function createCommandBase<TType extends ProjectCommandType>(
  type: TType,
  projectId: ProjectId,
  metadata: CommandMetadata,
): Omit<ProjectCommandBase<TType, never>, 'payload'> {
  if (
    metadata.commandId.length < 1 ||
    metadata.commandId.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(metadata.commandId)
  ) {
    throw new DomainError('INVALID_ID', `Invalid command id: ${metadata.commandId}`);
  }

  return {
    commandId: metadata.commandId,
    type,
    scope: 'project',
    targetId: projectId,
    createdAt: metadata.createdAt ?? new Date().toISOString(),
  };
}
