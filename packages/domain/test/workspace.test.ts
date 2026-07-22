import { describe, expect, it } from 'vitest';

import {
  DomainError,
  canRedoProject,
  canUndoProject,
  createAddPageCommand,
  createDeletePageCommand,
  createDuplicatePageCommand,
  createEmptyWorkspace,
  createMovePageCommand,
  createPage,
  createProject,
  createSelectBroadcastPageCommand,
  createSelectEditPageCommand,
  createWorkspace,
  createWorkspaceCommandState,
  dispatchProjectCommand,
  getPageHistory,
  getProjectHistory,
  redoProjectCommand,
  undoProjectCommand,
  type Page,
  type Project,
} from '../src/index.js';

const PROJECT_ID = 'workspace-1:project:1';

function metadata(id: string) {
  return { commandId: id, createdAt: '2026-07-22T00:00:00.000Z' };
}

describe('workspace domain', () => {
  it('初期ワークスペースに編集・配信用ページを設定する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const project = workspace.projects[0];

    expect(project).toBeDefined();
    expect(project?.pages).toHaveLength(1);
    expect(project?.activeEditPageId).toBe(project?.pages[0]?.id);
    expect(project?.activeBroadcastPageId).toBe(project?.pages[0]?.id);
  });

  it('1Workspaceに複数Projectを保持できる', () => {
    const project1 = createProjectFixture('project-1', 'workspace-1', ['page-1']);
    const project2 = createProjectFixture('project-2', 'workspace-1', ['page-2']);
    const workspace = createWorkspace({
      id: 'workspace-1',
      name: 'Workspace',
      projects: [project1, project2],
      activeProjectId: 'project-2',
      createdAt: '2026-07-22T00:00:00.000Z',
    });

    expect(workspace.projects).toHaveLength(2);
    expect(workspace.activeProjectId).toBe('project-2');
  });

  it('編集ページの変更で配信ページを変更しない', () => {
    let state = createStateWithPages(['page-1', 'page-2']);

    state = dispatchProjectCommand(
      state,
      createSelectEditPageCommand(PROJECT_ID, 'page-2', metadata('select-edit')),
    );

    const project = state.workspace.projects[0]!;
    expect(project.activeEditPageId).toBe('page-2');
    expect(project.activeBroadcastPageId).toBe('page-1');
  });

  it('ページ追加・複製・並び替えを実行できる', () => {
    let state = createStateWithPages(['page-1']);
    const page2 = createPageFixture('page-2', PROJECT_ID, 'Page 2');

    state = dispatchProjectCommand(
      state,
      createAddPageCommand(PROJECT_ID, page2, metadata('add-page')),
    );

    const page3 = createPageFixture('page-3', PROJECT_ID, 'Page 2 のコピー');
    state = dispatchProjectCommand(
      state,
      createDuplicatePageCommand(
        PROJECT_ID,
        'page-2',
        page3,
        metadata('duplicate-page'),
      ),
    );
    state = dispatchProjectCommand(
      state,
      createMovePageCommand(PROJECT_ID, 'page-3', 0, metadata('move-page')),
    );

    const project = state.workspace.projects[0]!;
    expect(project.pages.map((page) => page.id)).toEqual([
      'page-3',
      'page-1',
      'page-2',
    ]);
    expect(project.activeEditPageId).toBe('page-3');
  });

  it('削除対象が編集・配信ページの場合は隣接ページへ切り替える', () => {
    let state = createStateWithPages(['page-1', 'page-2', 'page-3']);
    state = dispatchProjectCommand(
      state,
      createSelectEditPageCommand(PROJECT_ID, 'page-2', metadata('edit-page-2')),
    );
    state = dispatchProjectCommand(
      state,
      createSelectBroadcastPageCommand(
        PROJECT_ID,
        'page-2',
        metadata('broadcast-page-2'),
      ),
    );
    state = dispatchProjectCommand(
      state,
      createDeletePageCommand(PROJECT_ID, 'page-2', metadata('delete-page-2')),
    );

    const project = state.workspace.projects[0]!;
    expect(project.pages.map((page) => page.id)).toEqual(['page-1', 'page-3']);
    expect(project.activeEditPageId).toBe('page-3');
    expect(project.activeBroadcastPageId).toBe('page-3');
  });

  it('ページ操作を連続してUndo・Redoできる', () => {
    let state = createStateWithPages(['page-1']);
    state = dispatchProjectCommand(
      state,
      createAddPageCommand(
        PROJECT_ID,
        createPageFixture('page-2', PROJECT_ID, 'Page 2'),
        metadata('add-page-2'),
      ),
    );
    state = dispatchProjectCommand(
      state,
      createAddPageCommand(
        PROJECT_ID,
        createPageFixture('page-3', PROJECT_ID, 'Page 3'),
        metadata('add-page-3'),
      ),
    );

    expect(canUndoProject(state, PROJECT_ID)).toBe(true);
    state = undoProjectCommand(state, PROJECT_ID);
    expect(state.workspace.projects[0]?.pages).toHaveLength(2);
    state = undoProjectCommand(state, PROJECT_ID);
    expect(state.workspace.projects[0]?.pages).toHaveLength(1);
    expect(canRedoProject(state, PROJECT_ID)).toBe(true);

    state = redoProjectCommand(state, PROJECT_ID);
    state = redoProjectCommand(state, PROJECT_ID);
    expect(state.workspace.projects[0]?.pages).toHaveLength(3);
  });

  it('Undo後の新規CommandでRedo履歴を破棄する', () => {
    let state = createStateWithPages(['page-1']);
    state = dispatchProjectCommand(
      state,
      createAddPageCommand(
        PROJECT_ID,
        createPageFixture('page-2', PROJECT_ID, 'Page 2'),
        metadata('add-page-2'),
      ),
    );
    state = undoProjectCommand(state, PROJECT_ID);
    expect(canRedoProject(state, PROJECT_ID)).toBe(true);

    state = dispatchProjectCommand(
      state,
      createAddPageCommand(
        PROJECT_ID,
        createPageFixture('page-3', PROJECT_ID, 'Page 3'),
        metadata('add-page-3'),
      ),
    );

    expect(canRedoProject(state, PROJECT_ID)).toBe(false);
  });

  it('最後の1ページは削除できない', () => {
    const state = createStateWithPages(['page-1']);

    expect(() =>
      dispatchProjectCommand(
        state,
        createDeletePageCommand(PROJECT_ID, 'page-1', metadata('delete-last')),
      ),
    ).toThrowError(DomainError);
  });

  it('不正な並び替え位置と重複Page IDを拒否する', () => {
    const state = createStateWithPages(['page-1', 'page-2']);

    expect(() =>
      dispatchProjectCommand(
        state,
        createMovePageCommand(PROJECT_ID, 'page-1', 2, metadata('invalid-move')),
      ),
    ).toThrow('Invalid page index: 2');

    expect(() =>
      dispatchProjectCommand(
        state,
        createAddPageCommand(
          PROJECT_ID,
          createPageFixture('page-1', PROJECT_ID, 'Duplicate'),
          metadata('duplicate-id'),
        ),
      ),
    ).toThrow('Duplicate page id: page-1');
  });

  it('履歴上限を超えた古いProject履歴を破棄する', () => {
    let state = createStateWithPages(['page-1'], 2);

    for (const pageNumber of [2, 3, 4]) {
      state = dispatchProjectCommand(
        state,
        createAddPageCommand(
          PROJECT_ID,
          createPageFixture(`page-${pageNumber}`, PROJECT_ID, `Page ${pageNumber}`),
          metadata(`add-page-${pageNumber}`),
        ),
      );
    }

    expect(getProjectHistory(state, PROJECT_ID).past).toHaveLength(2);
    state = undoProjectCommand(state, PROJECT_ID);
    state = undoProjectCommand(state, PROJECT_ID);
    state = undoProjectCommand(state, PROJECT_ID);
    expect(state.workspace.projects[0]?.pages).toHaveLength(2);
  });

  it('Project履歴とPage履歴を別領域で管理する', () => {
    let state = createStateWithPages(['page-1']);
    state = dispatchProjectCommand(
      state,
      createAddPageCommand(
        PROJECT_ID,
        createPageFixture('page-2', PROJECT_ID, 'Page 2'),
        metadata('add-page-2'),
      ),
    );

    expect(getProjectHistory(state, PROJECT_ID).past).toHaveLength(1);
    expect(getPageHistory(state, 'page-1').past).toHaveLength(0);
  });
});

function createStateWithPages(pageIds: string[], historyLimit = 100) {
  const project = createProjectFixture(PROJECT_ID, 'workspace-1', pageIds);
  const workspace = createWorkspace({
    id: 'workspace-1',
    name: 'Workspace',
    projects: [project],
    createdAt: '2026-07-22T00:00:00.000Z',
  });

  return createWorkspaceCommandState(workspace, historyLimit);
}

function createProjectFixture(
  projectId: string,
  workspaceId: string,
  pageIds: string[],
): Project {
  const pages = pageIds.map((pageId, index) =>
    createPageFixture(pageId, projectId, `Page ${index + 1}`),
  );

  return createProject({
    id: projectId,
    workspaceId,
    name: 'Project',
    pages,
    createdAt: '2026-07-22T00:00:00.000Z',
  });
}

function createPageFixture(
  pageId: string,
  projectId: string,
  name: string,
): Page {
  return createPage({
    id: pageId,
    projectId,
    name,
    createdAt: '2026-07-22T00:00:00.000Z',
  });
}
