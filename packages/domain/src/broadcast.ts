import {
  BROADCAST_SNAPSHOT_SCHEMA_VERSION,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';
import {
  findPage,
  findProject,
  type ProjectId,
  type Workspace,
} from './model.js';

export function createBroadcastSnapshot(
  workspace: Workspace,
  projectId: ProjectId,
  revision: number,
  generatedAt = new Date().toISOString(),
): BroadcastSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid broadcast revision: ${revision}`);
  }

  const project = findProject(workspace, projectId);
  const page = findPage(project, project.activeBroadcastPageId);

  return {
    schemaVersion: BROADCAST_SNAPSHOT_SCHEMA_VERSION,
    projectId: project.id,
    pageId: page.id,
    pageName: page.name,
    revision,
    generatedAt,
    canvas: {
      width: page.width,
      height: page.height,
      dpi: page.dpi,
      background: page.transparent
        ? { type: 'transparent' }
        : { type: 'color', value: '#FFFFFF' },
    },
    layers: [],
  };
}
