import { describe, expect, it } from 'vitest';

import {
  createEmptyWorkspace,
  selectBroadcastPage,
  selectEditPage,
  type Project,
} from '../src/index.js';

describe('workspace domain', () => {
  it('初期ワークスペースに編集・配信用ページを設定する', () => {
    const workspace = createEmptyWorkspace('workspace-1');
    const project = workspace.projects[0];

    expect(project).toBeDefined();
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

  it('存在しないページへの変更を拒否する', () => {
    const project = createProjectFixture();

    expect(() => selectBroadcastPage(project, 'missing-page')).toThrow(
      'Page not found: missing-page',
    );
  });
});

function createProjectFixture(): Project {
  return {
    id: 'project-1',
    name: 'Project',
    activeEditPageId: 'page-1',
    activeBroadcastPageId: 'page-1',
    pages: [
      {
        id: 'page-1',
        name: 'Page 1',
        width: 1920,
        height: 1080,
        transparent: true,
      },
      {
        id: 'page-2',
        name: 'Page 2',
        width: 1920,
        height: 1080,
        transparent: true,
      },
    ],
  };
}
