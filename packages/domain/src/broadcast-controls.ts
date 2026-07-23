import {
  applyBroadcastPreset,
  parseBroadcastOverlaySettings,
  type BroadcastOverlaySettings,
  type BroadcastOverlayTheme,
  type BroadcastPreset,
} from '@live-board/obs-protocol';
import {
  findPage,
  findProject,
  replaceProject,
  type PageId,
  type Project,
  type ProjectId,
  type Workspace,
} from './model.js';

declare module './model.js' {
  interface Project {
    broadcastSettings?: BroadcastOverlaySettings;
  }

  interface CreateProjectInput {
    broadcastSettings?: BroadcastOverlaySettings;
  }
}

export type BroadcastNavigationAction =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'number'; pageNumber: number };

export type BroadcastShortcutAction =
  | BroadcastNavigationAction
  | { type: 'toggle-lock' };

export interface BroadcastShortcutInput {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type BroadcastNavigationReason =
  | 'changed'
  | 'locked'
  | 'already-selected'
  | 'page-out-of-range';

export interface BroadcastNavigationResult {
  workspace: Workspace;
  changed: boolean;
  reason: BroadcastNavigationReason;
  selectedPageId: PageId;
}

export function getBroadcastOverlaySettings(
  project: Project,
): BroadcastOverlaySettings {
  return parseBroadcastOverlaySettings(project.broadcastSettings);
}

export function updateBroadcastOverlaySettings(
  workspace: Workspace,
  projectId: ProjectId,
  patch: Partial<BroadcastOverlaySettings>,
  updatedAt = new Date().toISOString(),
): Workspace {
  const project = findProject(workspace, projectId);
  const current = getBroadcastOverlaySettings(project);
  const settings = parseBroadcastOverlaySettings({
    ...current,
    ...patch,
    transition: patch.transition ?? current.transition,
  });
  return replaceProject(
    workspace,
    {
      ...project,
      broadcastSettings: settings,
      updatedAt,
    },
    updatedAt,
  );
}

export function applyBroadcastPresetToWorkspace(
  workspace: Workspace,
  projectId: ProjectId,
  preset: BroadcastPreset,
  updatedAt = new Date().toISOString(),
): Workspace {
  const project = findProject(workspace, projectId);
  return replaceProject(
    workspace,
    {
      ...project,
      broadcastSettings: applyBroadcastPreset(preset),
      updatedAt,
    },
    updatedAt,
  );
}

export function setBroadcastTheme(
  workspace: Workspace,
  projectId: ProjectId,
  theme: BroadcastOverlayTheme,
  updatedAt = new Date().toISOString(),
): Workspace {
  return updateBroadcastOverlaySettings(workspace, projectId, { theme }, updatedAt);
}

export function setBroadcastPageLocked(
  workspace: Workspace,
  projectId: ProjectId,
  locked: boolean,
  updatedAt = new Date().toISOString(),
): Workspace {
  const project = findProject(workspace, projectId);
  if (project.broadcastPageLocked === locked) return workspace;
  return replaceProject(
    workspace,
    {
      ...project,
      broadcastPageLocked: locked,
      updatedAt,
    },
    updatedAt,
  );
}

export function selectBroadcastPageSafely(
  workspace: Workspace,
  projectId: ProjectId,
  pageId: PageId,
  updatedAt = new Date().toISOString(),
): BroadcastNavigationResult {
  const project = findProject(workspace, projectId);
  findPage(project, pageId);
  if (project.broadcastPageLocked) {
    return {
      workspace,
      changed: false,
      reason: 'locked',
      selectedPageId: project.activeBroadcastPageId,
    };
  }
  if (project.activeBroadcastPageId === pageId) {
    return {
      workspace,
      changed: false,
      reason: 'already-selected',
      selectedPageId: pageId,
    };
  }
  return {
    workspace: replaceProject(
      workspace,
      {
        ...project,
        activeBroadcastPageId: pageId,
        updatedAt,
      },
      updatedAt,
    ),
    changed: true,
    reason: 'changed',
    selectedPageId: pageId,
  };
}

export function navigateBroadcastPage(
  workspace: Workspace,
  projectId: ProjectId,
  action: BroadcastNavigationAction,
  updatedAt = new Date().toISOString(),
): BroadcastNavigationResult {
  const project = findProject(workspace, projectId);
  if (project.broadcastPageLocked) {
    return {
      workspace,
      changed: false,
      reason: 'locked',
      selectedPageId: project.activeBroadcastPageId,
    };
  }

  const currentIndex = project.pages.findIndex(
    (page) => page.id === project.activeBroadcastPageId,
  );
  let nextIndex: number;
  if (action.type === 'number') {
    nextIndex = action.pageNumber - 1;
    if (nextIndex < 0 || nextIndex >= project.pages.length) {
      return {
        workspace,
        changed: false,
        reason: 'page-out-of-range',
        selectedPageId: project.activeBroadcastPageId,
      };
    }
  } else if (action.type === 'next') {
    nextIndex = (currentIndex + 1) % project.pages.length;
  } else {
    nextIndex = (currentIndex - 1 + project.pages.length) % project.pages.length;
  }
  return selectBroadcastPageSafely(
    workspace,
    projectId,
    project.pages[nextIndex]!.id,
    updatedAt,
  );
}

export function resolveBroadcastShortcut(
  input: BroadcastShortcutInput,
): BroadcastShortcutAction | null {
  if (!input.altKey || input.ctrlKey || input.metaKey || input.shiftKey) return null;
  if (input.code === 'ArrowRight' || input.code === 'PageDown') {
    return { type: 'next' };
  }
  if (input.code === 'ArrowLeft' || input.code === 'PageUp') {
    return { type: 'previous' };
  }
  if (input.code === 'KeyL') return { type: 'toggle-lock' };
  const match = /^Digit([0-9])$/.exec(input.code);
  if (match === null) return null;
  const digit = Number(match[1]);
  return { type: 'number', pageNumber: digit === 0 ? 10 : digit };
}
