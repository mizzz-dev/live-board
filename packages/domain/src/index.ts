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
  schemaVersion: 1;
}

export interface CreatePageInput {
  id: PageId;
  name?: string;
  width?: number;
  height?: number;
  transparent?: boolean;
}

const DEFAULT_PAGE_WIDTH = 1920;
const DEFAULT_PAGE_HEIGHT = 1080;

export function createPage(input: CreatePageInput): Page {
  return {
    id: input.id,
    name: input.name?.trim() || '新しいページ',
    width: input.width ?? DEFAULT_PAGE_WIDTH,
    height: input.height ?? DEFAULT_PAGE_HEIGHT,
    transparent: input.transparent ?? true,
  };
}

export function createEmptyWorkspace(workspaceId: WorkspaceId): Workspace {
  const pageId = `${workspaceId}:page:1`;
  const projectId = `${workspaceId}:project:1`;

  return {
    id: workspaceId,
    name: '新しいワークスペース',
    schemaVersion: 1,
    projects: [
      {
        id: projectId,
        name: '新しいプロジェクト',
        activeEditPageId: pageId,
        activeBroadcastPageId: pageId,
        pages: [
          createPage({
            id: pageId,
            name: 'ページ 1',
          }),
        ],
      },
    ],
  };
}

export function selectEditPage(project: Project, pageId: PageId): Project {
  assertPageExists(project, pageId);

  return {
    ...project,
    activeEditPageId: pageId,
  };
}

export function selectBroadcastPage(project: Project, pageId: PageId): Project {
  assertPageExists(project, pageId);

  return {
    ...project,
    activeBroadcastPageId: pageId,
  };
}

function assertPageExists(project: Project, pageId: PageId): void {
  if (!project.pages.some((page) => page.id === pageId)) {
    throw new Error(`Page not found: ${pageId}`);
  }
}

export * from './commands.js';
