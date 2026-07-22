import { describe, expect, it } from 'vitest';
import {
  createBroadcastSnapshot,
  createEmptyWorkspace,
  createPage,
  createProject,
  createWorkspace,
} from '../src/index.js';

describe('BroadcastSnapshot', () => {
  it('編集ページではなく配信ページを投影する', () => {
    const workspaceId = 'workspace-1';
    const projectId = 'project-1';
    const page1 = createPage({
      id: 'page-1',
      projectId,
      name: '編集ページ',
    });
    const page2 = createPage({
      id: 'page-2',
      projectId,
      name: '配信ページ',
      width: 1280,
      height: 720,
    });
    const project = createProject({
      id: projectId,
      workspaceId,
      name: 'Project',
      pages: [page1, page2],
      activeEditPageId: page1.id,
      activeBroadcastPageId: page2.id,
    });
    const workspace = createWorkspace({
      id: workspaceId,
      name: 'Workspace',
      projects: [project],
    });

    expect(
      createBroadcastSnapshot(
        workspace,
        projectId,
        7,
        '2026-07-22T00:00:00.000Z',
      ),
    ).toEqual({
      schemaVersion: 1,
      projectId,
      pageId: page2.id,
      pageName: '配信ページ',
      revision: 7,
      generatedAt: '2026-07-22T00:00:00.000Z',
      canvas: {
        width: 1280,
        height: 720,
        dpi: 72,
        background: { type: 'transparent' },
      },
      layers: [],
    });
  });

  it('不正revisionを拒否する', () => {
    const workspace = createEmptyWorkspace('workspace-1');

    expect(() =>
      createBroadcastSnapshot(workspace, workspace.activeProjectId, -1),
    ).toThrow('Invalid broadcast revision: -1');
  });
});
