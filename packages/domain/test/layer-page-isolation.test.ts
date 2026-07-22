import { describe, expect, it } from 'vitest';
import {
  createAddLayerCommand,
  createLayer,
  createLayerWorkspaceCommandState,
  createPage,
  createProject,
  createWorkspace,
  dispatchLayerCommand,
  getLayerDocument,
  getLayerHistory,
} from '../src/index.js';

const timestamp = '2026-07-22T00:00:00.000Z';

describe('PageごとのLayer tree', () => {
  it('一方のPage操作が別Pageのtreeと履歴へ影響しない', () => {
    const workspaceId = 'workspace-isolation';
    const projectId = 'project-isolation';
    const firstPage = createPage({
      id: 'page-first',
      projectId,
      name: 'ページ 1',
      createdAt: timestamp,
    });
    const secondPage = createPage({
      id: 'page-second',
      projectId,
      name: 'ページ 2',
      createdAt: timestamp,
    });
    const project = createProject({
      id: projectId,
      workspaceId,
      name: 'プロジェクト',
      pages: [firstPage, secondPage],
      activeEditPageId: firstPage.id,
      activeBroadcastPageId: secondPage.id,
      createdAt: timestamp,
    });
    const workspace = createWorkspace({
      id: workspaceId,
      name: 'ワークスペース',
      projects: [project],
      createdAt: timestamp,
    });
    let state = createLayerWorkspaceCommandState(workspace);

    state = dispatchLayerCommand(
      state,
      createAddLayerCommand(
        projectId,
        firstPage.id,
        createLayer({
          id: 'layer-first-page',
          pageId: firstPage.id,
          name: 'ページ1だけのLayer',
          type: 'raster',
          createdAt: timestamp,
        }),
        null,
        0,
        { commandId: 'command-add-first', createdAt: timestamp },
      ),
    );

    const updatedProject = state.workspace.projects[0]!;
    expect(getLayerDocument(updatedProject.pages[0]!).layers).toHaveLength(1);
    expect(getLayerDocument(updatedProject.pages[1]!).layers).toHaveLength(0);
    expect(getLayerHistory(state, firstPage.id).past).toHaveLength(1);
    expect(getLayerHistory(state, secondPage.id).past).toHaveLength(0);
    expect(updatedProject.activeBroadcastPageId).toBe(secondPage.id);
  });
});
