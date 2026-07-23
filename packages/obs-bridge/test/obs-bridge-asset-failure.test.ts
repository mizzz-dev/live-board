import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startObsBridge,
  type BroadcastSnapshot,
  type ObsBridge,
} from '../src/index.js';

let activeBridge: ObsBridge | undefined;

const baseSnapshot: BroadcastSnapshot = {
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
  overlay: {
    preset: 'simple',
    theme: 'transparent',
    transition: { type: 'fade', durationMs: 120 },
    performanceMode: 'balanced',
    customCss: '',
    customCssEnabled: false,
    customCssFallback: false,
  },
  layers: [],
};

afterEach(async () => {
  if (activeBridge !== undefined) {
    await activeBridge.close();
    activeBridge = undefined;
  }
});

describe('OBS Bridge Asset失敗境界', () => {
  it('Asset検証失敗時にlatest Snapshotとregistryを更新しない', async () => {
    activeBridge = await startObsBridge({ initialSnapshot: baseSnapshot });
    const bytes = Buffer.from('tampered-asset');
    const invalidSnapshot: BroadcastSnapshot = {
      ...baseSnapshot,
      revision: 2,
      assets: [
        {
          id: 'asset:tampered',
          sha256: '0'.repeat(64),
          mime: 'image/png',
          width: 1,
          height: 1,
          byteLength: bytes.length,
          dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
          animated: false,
          sanitized: false,
        },
      ],
    };

    expect(() => activeBridge?.publishSnapshot(invalidSnapshot)).toThrow(
      'OBS_BRIDGE_ASSET_HASH_MISMATCH',
    );
    expect(activeBridge.getLatestRevision()).toBe(1);
    expect(activeBridge.getAssetStats()).toMatchObject({
      count: 0,
      totalBytes: 0,
    });
  });

  it('sanitized SVGを固定MIMEとsandbox CSPで配信する', async () => {
    const bytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" /></svg>',
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    activeBridge = await startObsBridge({
      initialSnapshot: {
        ...baseSnapshot,
        assets: [
          {
            id: 'asset:sanitized-svg',
            sha256,
            mime: 'image/svg+xml',
            width: 1,
            height: 1,
            byteLength: bytes.length,
            dataUrl: `data:image/svg+xml;base64,${bytes.toString('base64')}`,
            animated: false,
            sanitized: true,
          },
        ],
      },
    });

    const overlayUrl = new URL(activeBridge.info.overlayUrl);
    const token = overlayUrl.pathname.split('/')[2]!;
    const response = await fetch(
      `${overlayUrl.origin}/asset/${token}/${sha256}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    );
    expect(await response.text()).toBe(bytes.toString());
  });
});
