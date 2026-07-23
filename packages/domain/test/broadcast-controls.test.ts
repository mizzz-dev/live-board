import { describe, expect, it } from 'vitest';
import {
  applyBroadcastPresetToWorkspace,
  createPage,
  createProject,
  createWorkspace,
  getBroadcastOverlaySettings,
  navigateBroadcastPage,
  resolveBroadcastShortcut,
  selectBroadcastPageSafely,
  setBroadcastPageLocked,
} from '../src/index.js';

function workspaceWithPages(pageCount = 3) {
  const workspaceId = 'workspace-1';
  const projectId = 'project-1';
  const pages = Array.from({ length: pageCount }, (_, index) =>
    createPage({
      id: `page-${index + 1}`,
      projectId,
      name: `ページ ${index + 1}`,
      createdAt: '2026-07-23T00:00:00.000Z',
    }),
  );
  return createWorkspace({
    id: workspaceId,
    name: 'テスト',
    projects: [
      createProject({
        id: projectId,
        workspaceId,
        name: '配信テスト',
        pages,
        activeEditPageId: pages[0]!.id,
        activeBroadcastPageId: pages[0]!.id,
        createdAt: '2026-07-23T00:00:00.000Z',
      }),
    ],
    createdAt: '2026-07-23T00:00:00.000Z',
  });
}

describe('配信ページ操作', () => {
  it('次・前を循環して切り替える', () => {
    const initial = workspaceWithPages();
    const previous = navigateBroadcastPage(initial, 'project-1', { type: 'previous' });
    expect(previous.selectedPageId).toBe('page-3');

    const next = navigateBroadcastPage(previous.workspace, 'project-1', { type: 'next' });
    expect(next.selectedPageId).toBe('page-1');
  });

  it('番号指定で配信ページを切り替える', () => {
    const result = navigateBroadcastPage(
      workspaceWithPages(),
      'project-1',
      { type: 'number', pageNumber: 2 },
    );

    expect(result.changed).toBe(true);
    expect(result.selectedPageId).toBe('page-2');
  });

  it('存在しない番号では状態を変更しない', () => {
    const initial = workspaceWithPages();
    const result = navigateBroadcastPage(
      initial,
      'project-1',
      { type: 'number', pageNumber: 9 },
    );

    expect(result.reason).toBe('page-out-of-range');
    expect(result.workspace).toBe(initial);
  });

  it('固定中はショートカットと直接選択の両方を拒否する', () => {
    const locked = setBroadcastPageLocked(workspaceWithPages(), 'project-1', true);
    const byShortcut = navigateBroadcastPage(locked, 'project-1', { type: 'next' });
    const byButton = selectBroadcastPageSafely(locked, 'project-1', 'page-2');

    expect(byShortcut.reason).toBe('locked');
    expect(byButton.reason).toBe('locked');
    expect(byShortcut.workspace).toBe(locked);
    expect(byButton.workspace).toBe(locked);
  });
});

describe('配信ショートカット判定', () => {
  const base = {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  it('Alt＋左右と番号、固定切替を解決する', () => {
    expect(resolveBroadcastShortcut({ ...base, code: 'ArrowRight' })).toEqual({ type: 'next' });
    expect(resolveBroadcastShortcut({ ...base, code: 'ArrowLeft' })).toEqual({ type: 'previous' });
    expect(resolveBroadcastShortcut({ ...base, code: 'Digit3' })).toEqual({
      type: 'number',
      pageNumber: 3,
    });
    expect(resolveBroadcastShortcut({ ...base, code: 'Digit0' })).toEqual({
      type: 'number',
      pageNumber: 10,
    });
    expect(resolveBroadcastShortcut({ ...base, code: 'KeyL' })).toEqual({ type: 'toggle-lock' });
  });

  it('Ctrl・Meta・Shift併用やAltなしを無視する', () => {
    expect(resolveBroadcastShortcut({ ...base, code: 'ArrowRight', altKey: false })).toBeNull();
    expect(resolveBroadcastShortcut({ ...base, code: 'ArrowRight', ctrlKey: true })).toBeNull();
    expect(resolveBroadcastShortcut({ ...base, code: 'ArrowRight', metaKey: true })).toBeNull();
    expect(resolveBroadcastShortcut({ ...base, code: 'ArrowRight', shiftKey: true })).toBeNull();
  });
});

describe('配信プリセット', () => {
  it('OBS優先プリセットをProjectへ保存する', () => {
    const updated = applyBroadcastPresetToWorkspace(
      workspaceWithPages(),
      'project-1',
      'obs-priority',
    );
    const project = updated.projects[0]!;

    expect(getBroadcastOverlaySettings(project)).toMatchObject({
      preset: 'obs-priority',
      transition: { type: 'none', durationMs: 0 },
      performanceMode: 'obs-priority',
      customCssEnabled: false,
    });
  });
});
