import { describe, expect, it } from 'vitest';

import {
  createEmptyWorkspace,
  createWorkspaceHistory,
  dispatchWorkspaceCommand,
  executeWorkspaceCommand,
  redoWorkspaceCommand,
  selectBroadcastPage,
  selectEditPage,
  undoWorkspaceCommand,
  type Page,
  type Project,
  type Workspace,
} from '../src/index.js';

describe('workspace domain', () => {
  it('初期ワークスペースに編集・配信用ページを設定する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const project = workspace.projects[0];

    expect(project).toBeDefined();
    expect(workspace.activeProjectId).toBe(project?.id);
    expect(workspace.revision).toBe(0);
    expect(project?.pages).toHaveLength(1);
    expect(project?.activeEditPageId).toBe(project?.pages[0]?.id);
    expect(project?.activeBroadcastPageId).toBe(project?.pages[0]?.id);
  });

  it('編集ページの変更で配信ページを変更しない', () => {
    const project = createProjectFixture();
    const updated = selectEditPage(project, 'page-2');

    expect(updated.activeEditPageId).toBe('page-2');
    expect(updated.activeBroadcastPageId).toBe('page-1');
  });

  it('Command実行ごとにrevisionを増やす', () => {
    const workspace = createWorkspaceFixture();
    const renamed = executeWorkspaceCommand(workspace, {
      type: 'page.rename',
      projectId: 'project-1',
      pageId: 'page-1',
      name: '配信待機画面',
    });

    expect(renamed.revision).toBe(1);
    expect(renamed.projects[0]?.pages[0]?.name).toBe('配信待機画面');
  });

  it('同じ値への変更はrevisionと履歴を増やさない', () => {
    const workspace = createWorkspaceFixture();
    const history = createWorkspaceHistory(workspace);
    const updated = dispatchWorkspaceCommand(history, {
      type: 'page.selectEdit',
      projectId: 'project-1',
      pageId: 'page-1',
    });

    expect(updated).toBe(history);
    expect(updated.past).toHaveLength(0);
  });

  it('CommandをUndo・Redoできる', () => {
    const history = createWorkspaceHistory(createWorkspaceFixture());
    const changed = dispatchWorkspaceCommand(history, {
      type: 'page.selectEdit',
      projectId: 'project-1',
      pageId: 'page-2',
    });
    const undone = undoWorkspaceCommand(changed);
    const redone = redoWorkspaceCommand(undone);

    expect(changed.present.projects[0]?.activeEditPageId).toBe('page-2');
    expect(undone.present.projects[0]?.activeEditPageId).toBe('page-1');
    expect(redone.present.projects[0]?.activeEditPageId).toBe('page-2');
    expect(redone.future).toHaveLength(0);
  });

  it('Undo後の新しいCommandでRedo履歴を破棄する', () => {
    const initial = createWorkspaceHistory(createWorkspaceFixture());
    const changed = dispatchWorkspaceCommand(initial, {
      type: 'page.rename',
      projectId: 'project-1',
      pageId: 'page-1',
      name: '変更前',
    });
    const undone = undoWorkspaceCommand(changed);
    const branched = dispatchWorkspaceCommand(undone, {
      type: 'workspace.rename',
      name: '別の変更',
    });

    expect(branched.future).toHaveLength(0);
    expect(redoWorkspaceCommand(branched)).toBe(branched);
  });

  it('履歴件数を上限以内に保つ', () => {
    let history = createWorkspaceHistory(createWorkspaceFixture(), 2);
    for (const name of ['A', 'B', 'C']) {
      history = dispatchWorkspaceCommand(history, { type: 'workspace.rename', name });
    }

    expect(history.past).toHaveLength(2);
    expect(undoWorkspaceCommand(undoWorkspaceCommand(history)).present.name).toBe('A');
  });

  it('配信中ページを削除した場合は残存ページへ安全に切り替える', () => {
    const workspace = createWorkspaceFixture();
    const updated = executeWorkspaceCommand(workspace, {
      type: 'page.delete',
      projectId: 'project-1',
      pageId: 'page-1',
    });
    const project = updated.projects[0];

    expect(project?.pages.map((page) => page.id)).toEqual(['page-2']);
    expect(project?.activeEditPageId).toBe('page-2');
    expect(project?.activeBroadcastPageId).toBe('page-2');
  });

  it('最後のページ削除を拒否する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const project = workspace.projects[0]!;

    expect(() =>
      executeWorkspaceCommand(workspace, {
        type: 'page.delete',
        projectId: project.id,
        pageId: project.pages[0]!.id,
      }),
    ).toThrow('Project must contain at least one page');
  });

  it('重複ID・不正サイズ・空名称を拒否する', () => {
    const workspace = createWorkspaceFixture();

    expect(() =>
      executeWorkspaceCommand(workspace, {
        type: 'page.add',
        projectId: 'project-1',
        page: createPage('page-1'),
      }),
    ).toThrow('Page already exists: page-1');

    expect(() =>
      executeWorkspaceCommand(workspace, {
        type: 'page.add',
        projectId: 'project-1',
        page: { ...createPage('page-3'), width: 0 },
      }),
    ).toThrow('Page width must be a positive integer');

    expect(() =>
      executeWorkspaceCommand(workspace, { type: 'workspace.rename', name: '  ' }),
    ).toThrow('Workspace name must not be empty');
  });

  it('存在しないページ・プロジェクトへの変更を拒否する', () => {
    const project = createProjectFixture();
    const workspace = createWorkspaceFixture();

    expect(() => selectBroadcastPage(project, 'missing-page')).toThrow(
      'Page not found: missing-page',
    );
    expect(() =>
      executeWorkspaceCommand(workspace, {
        type: 'project.select',
        projectId: 'missing-project',
      }),
    ).toThrow('Project not found: missing-project');
  });
});

function createWorkspaceFixture(): Workspace {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    schemaVersion: 1,
    revision: 0,
    activeProjectId: 'project-1',
    projects: [createProjectFixture()],
  };
}

function createProjectFixture(): Project {
  return {
    id: 'project-1',
    name: 'Project',
    activeEditPageId: 'page-1',
    activeBroadcastPageId: 'page-1',
    pages: [createPage('page-1'), createPage('page-2')],
  };
}

function createPage(id: string): Page {
  return {
    id,
    name: id === 'page-1' ? 'Page 1' : 'Page 2',
    width: 1920,
    height: 1080,
    transparent: true,
  };
}
