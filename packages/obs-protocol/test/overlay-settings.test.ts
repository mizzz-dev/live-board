import { describe, expect, it } from 'vitest';
import {
  applyBroadcastPreset,
  parseBroadcastSnapshot,
  sanitizeOverlayCustomCss,
} from '../src/index-v4.js';

function baseSnapshot() {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision: 1,
    generatedAt: '2026-07-23T00:00:00.000Z',
    canvas: {
      width: 1920,
      height: 1080,
      dpi: 72,
      background: { type: 'transparent' },
    },
    layers: [],
  };
}

describe('Overlay設定', () => {
  it('設定がない旧Snapshotを透過テーマへフォールバックする', () => {
    const parsed = parseBroadcastSnapshot(baseSnapshot());

    expect(parsed.overlay).toEqual({
      preset: 'simple',
      theme: 'transparent',
      transition: { type: 'fade', durationMs: 120 },
      performanceMode: 'balanced',
      customCss: '',
      customCssEnabled: false,
      customCssFallback: false,
    });
  });

  it('外部URLを含むCSSを無効化してSnapshot自体は復旧する', () => {
    const parsed = parseBroadcastSnapshot({
      ...baseSnapshot(),
      overlay: {
        ...applyBroadcastPreset('illustration'),
        customCss: '.broadcast-output { background-image: url(https://example.com/a.png); }',
        customCssEnabled: true,
      },
    });

    expect(parsed.overlay.customCss).toBe('');
    expect(parsed.overlay.customCssEnabled).toBe(false);
    expect(parsed.overlay.customCssFallback).toBe(true);
    expect(parsed.overlay.theme).toBe('transparent');
  });

  it.each([
    '@import "https://example.com/theme.css";',
    '.x { background: url(data:image/png;base64,aaaa); }',
    '.x { behavior: url(test.htc); }',
    '.x { color: red;',
  ])('危険または壊れたCSSを拒否する: %s', (css) => {
    expect(sanitizeOverlayCustomCss(css).accepted).toBe(false);
  });

  it('ネットワーク参照を含まない基本CSSを許可する', () => {
    const result = sanitizeOverlayCustomCss(
      '.broadcast-canvas { filter: contrast(1.05); opacity: 0.98; }',
    );

    expect(result).toEqual({
      accepted: true,
      css: '.broadcast-canvas { filter: contrast(1.05); opacity: 0.98; }',
      reason: null,
    });
  });

  it('OBS優先プリセットではアニメーションとCSSを無効化する', () => {
    expect(applyBroadcastPreset('obs-priority')).toMatchObject({
      preset: 'obs-priority',
      theme: 'transparent',
      transition: { type: 'none', durationMs: 0 },
      performanceMode: 'obs-priority',
      customCssEnabled: false,
    });
  });
});
