import {
  applyBroadcastPresetToWorkspace,
  createEmptyWorkspace,
  getBroadcastOverlaySettings,
  updateBroadcastOverlaySettings,
} from '@live-board/domain';
import { describe, expect, it } from 'vitest';
import {
  createLiveboardArchive,
  loadLiveboardArchive,
} from '../src/index.js';

const savedAt = '2026-07-23T04:00:00.000Z';

describe('配信設定の永続化境界', () => {
  it('安全なテーマとカスタムCSSを保存・再読込できる', () => {
    const initial = createEmptyWorkspace('broadcast-settings-workspace');
    const projectId = initial.activeProjectId;
    const presetApplied = applyBroadcastPresetToWorkspace(
      initial,
      projectId,
      'blackboard',
      savedAt,
    );
    const configured = updateBroadcastOverlaySettings(
      presetApplied,
      projectId,
      {
        customCss: '.broadcast-canvas { filter: contrast(1.05); }',
        customCssEnabled: true,
      },
      savedAt,
    );

    const loaded = loadLiveboardArchive(
      createLiveboardArchive({
        workspace: configured,
        assetLibraries: {},
        savedAt,
      }),
    );
    const settings = getBroadcastOverlaySettings(loaded.workspace.projects[0]!);

    expect(settings).toMatchObject({
      preset: 'blackboard',
      theme: 'blackboard',
      transition: { type: 'fade', durationMs: 100 },
      performanceMode: 'balanced',
      customCss: '.broadcast-canvas { filter: contrast(1.05); }',
      customCssEnabled: true,
      customCssFallback: false,
    });
  });

  it('危険CSSをArchiveへ残さず安全なテーマ状態へ正規化する', () => {
    const workspace = createEmptyWorkspace('unsafe-css-workspace');
    const project = workspace.projects[0]!;
    project.broadcastSettings = {
      preset: 'illustration',
      theme: 'transparent',
      transition: { type: 'fade', durationMs: 180 },
      performanceMode: 'balanced',
      customCss: '.broadcast-output { background: url(https://example.com/a.png); }',
      customCssEnabled: true,
      customCssFallback: false,
    };

    const loaded = loadLiveboardArchive(
      createLiveboardArchive({ workspace, assetLibraries: {}, savedAt }),
    );
    const settings = getBroadcastOverlaySettings(loaded.workspace.projects[0]!);

    expect(settings.customCss).toBe('');
    expect(settings.customCssEnabled).toBe(false);
    expect(settings.customCssFallback).toBe(false);
    expect(settings.theme).toBe('transparent');
  });

  it('配信設定を持たない旧Workspaceへ不要なプロパティを追加しない', () => {
    const workspace = createEmptyWorkspace('legacy-workspace');
    expect(workspace.projects[0]!.broadcastSettings).toBeUndefined();

    const loaded = loadLiveboardArchive(
      createLiveboardArchive({ workspace, assetLibraries: {}, savedAt }),
    );

    expect(loaded.workspace.projects[0]!.broadcastSettings).toBeUndefined();
  });
});
