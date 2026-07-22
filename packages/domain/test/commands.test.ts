import { describe, expect, it } from 'vitest';

import {
  canRedo,
  canUndo,
  createCommandHistory,
  createEmptyWorkspace,
  createPage,
  executeCommand,
  redo,
  undo,
} from '../src/index.js';

describe('workspace command history', () => {
  it('ページ追加・名称変更・並び替えをCommandとして適用する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const projectId = workspace.projects[0]?.id;
    expect(projectId).toBeDefined();

    let history = createCommandHistory(workspace);
    history = executeCommand(history, {
      type: 'page.add',
      projectId: projectId!,
      page: createPage({ id: 'page-2', name: '下書き' }),
    });
    history = executeCommand(history, {
      type: 'page.rename',
      projectId: projectId!,
      pageId: 'page-2',
      name: '配信用ページ',
    });
    history = executeCommand(history, {
      type: 'page.reorder',
      projectId: projectId!,
      pageId: 'page-2',
      targetIndex: 0,
    });

    const project = history.present.projects[0];
    expect(project?.pages.map((page) => page.id)).toEqual([
      'page-2',
      'workspace-1:page:1',
    ]);
    expect(project?.pages[0]?.name).toBe('配信用ページ');
    expect(history.past).toHaveLength(3);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);
  });

  it('UndoとRedoで状態を往復し、新規CommandでRedo履歴を破棄する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const projectId = workspace.projects[0]!.id;
    let history = createCommandHistory(workspace);

    history = executeCommand(history, {
      type: 'project.rename',
      projectId,
      name: '作品A',
    });
    history = undo(history);

    expect(history.present.projects[0]?.name).toBe('新しいプロジェクト');
    expect(canRedo(history)).toBe(true);

    history = redo(history);
    expect(history.present.projects[0]?.name).toBe('作品A');

    history = undo(history);
    history = executeCommand(history, {
      type: 'project.rename',
      projectId,
      name: '作品B',
    });
    expect(history.present.projects[0]?.name).toBe('作品B');
    expect(canRedo(history)).toBe(false);
  });

  it('配信中ページを削除した場合に編集・配信参照を安全なページへ移す', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const projectId = workspace.projects[0]!.id;
    const firstPageId = workspace.projects[0]!.pages[0]!.id;
    let history = createCommandHistory(workspace);

    history = executeCommand(history, {
      type: 'page.add',
      projectId,
      page: createPage({ id: 'page-2' }),
    });
    history = executeCommand(history, {
      type: 'page.selectEdit',
      projectId,
      pageId: 'page-2',
    });
    history = executeCommand(history, {
      type: 'page.selectBroadcast',
      projectId,
      pageId: 'page-2',
    });
    history = executeCommand(history, {
      type: 'page.remove',
      projectId,
      pageId: 'page-2',
    });

    const project = history.present.projects[0];
    expect(project?.activeEditPageId).toBe(firstPageId);
    expect(project?.activeBroadcastPageId).toBe(firstPageId);
    expect(project?.pages).toHaveLength(1);
  });

  it('最後のページ削除、重複ID、不正サイズ、不正履歴上限を拒否する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const project = workspace.projects[0]!;
    const history = createCommandHistory(workspace);

    expect(() =>
      executeCommand(history, {
        type: 'page.remove',
        projectId: project.id,
        pageId: project.pages[0]!.id,
      }),
    ).toThrow('A project must contain at least one page');

    expect(() =>
      executeCommand(history, {
        type: 'page.add',
        projectId: project.id,
        page: createPage({ id: project.pages[0]!.id }),
      }),
    ).toThrow(`Page already exists: ${project.pages[0]!.id}`);

    expect(() =>
      executeCommand(history, {
        type: 'page.add',
        projectId: project.id,
        page: createPage({ id: 'large', width: 40_000 }),
      }),
    ).toThrow('Page width must be an integer between 1 and 32768');

    expect(() => createCommandHistory(workspace, 0)).toThrow(
      'History limit must be an integer between 1 and 1000',
    );
  });

  it('履歴上限を超えた古い状態を破棄する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const projectId = workspace.projects[0]!.id;
    let history = createCommandHistory(workspace, 2);

    for (const name of ['A', 'B', 'C']) {
      history = executeCommand(history, {
        type: 'project.rename',
        projectId,
        name,
      });
    }

    expect(history.past).toHaveLength(2);
    history = undo(undo(history));
    expect(history.present.projects[0]?.name).toBe('A');
    expect(undo(history)).toBe(history);
  });
});
