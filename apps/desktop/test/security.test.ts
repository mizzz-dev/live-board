import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parsePublishBroadcastSnapshotRequest,
  parseRegisterBroadcastAssetsRequest,
  parseSecurityStatusRequest,
} from '../electron/contracts.js';
import {
  assertTrustedIpcSender,
  createRendererContentSecurityPolicy,
  isTrustedRendererUrl,
  mergeSecurityHeaders,
  type RendererTrustConfig,
} from '../electron/security.js';

const trustConfig: RendererTrustConfig = {
  developmentServerUrl: 'http://127.0.0.1:5173',
  packagedRendererUrl: 'file:///opt/live-board/dist/index.html',
};

const snapshot = {
  schemaVersion: 1,
  projectId: 'project-1',
  pageId: 'page-1',
  pageName: 'ページ 1',
  revision: 1,
  generatedAt: '2026-07-22T00:00:00.000Z',
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

const assetBytes = Buffer.from('ipc-contract-asset');
const asset = {
  id: 'asset:ipc-contract',
  sha256: createHash('sha256').update(assetBytes).digest('hex'),
  mime: 'image/png' as const,
  width: 1,
  height: 1,
  byteLength: assetBytes.byteLength,
  animated: false as const,
  sanitized: false,
};

describe('Electron security boundary', () => {
  it('CSPへ外部script・object・formの禁止を含める', () => {
    const policy = createRendererContentSecurityPolicy();

    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain('ws://127.0.0.1:*');
  });

  it('既存headerを維持しながらセキュリティheaderを上書きする', () => {
    const headers = mergeSecurityHeaders(
      { 'Cache-Control': ['no-store'] },
      "default-src 'self'",
    );

    expect(headers['Cache-Control']).toEqual(['no-store']);
    expect(headers['Content-Security-Policy']).toEqual([
      "default-src 'self'",
    ]);
    expect(headers['X-Content-Type-Options']).toEqual(['nosniff']);
  });

  it('完全一致する開発originとpackaged fileだけを信頼する', () => {
    expect(
      isTrustedRendererUrl('http://127.0.0.1:5173/', trustConfig),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(
        'http://127.0.0.1:5173/settings?panel=obs',
        trustConfig,
      ),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(
        'file:///opt/live-board/dist/index.html#workspace',
        trustConfig,
      ),
    ).toBe(true);
  });

  it('prefix偽装・外部URL・別fileを拒否する', () => {
    expect(
      isTrustedRendererUrl('http://127.0.0.1:5173.evil.example/', trustConfig),
    ).toBe(false);
    expect(
      isTrustedRendererUrl('https://attacker.example/', trustConfig),
    ).toBe(false);
    expect(
      isTrustedRendererUrl('file:///opt/live-board/secrets.txt', trustConfig),
    ).toBe(false);
  });

  it('main frame以外または不正URLのIPC senderを拒否する', () => {
    expect(() =>
      assertTrustedIpcSender(
        {
          senderUrl: 'http://127.0.0.1:5173/',
          isMainFrame: true,
        },
        trustConfig,
      ),
    ).not.toThrow();

    expect(() =>
      assertTrustedIpcSender(
        {
          senderUrl: 'http://127.0.0.1:5173/',
          isMainFrame: false,
        },
        trustConfig,
      ),
    ).toThrow('IPC_UNTRUSTED_SENDER');

    expect(() =>
      assertTrustedIpcSender(
        {
          senderUrl: 'https://attacker.example/',
          isMainFrame: true,
        },
        trustConfig,
      ),
    ).toThrow('IPC_UNTRUSTED_SENDER');
  });
});

describe('IPC request parser', () => {
  it('安全なrequestIdを受け付ける', () => {
    expect(parseSecurityStatusRequest({ requestId: 'request_123-abc' })).toEqual({
      requestId: 'request_123-abc',
    });
  });

  it('sourceなしBroadcastSnapshot descriptorを実行時検証する', () => {
    expect(
      parsePublishBroadcastSnapshotRequest({
        requestId: 'publish_1',
        snapshot,
      }),
    ).toEqual({ requestId: 'publish_1', snapshot });

    expect(() =>
      parsePublishBroadcastSnapshotRequest({
        requestId: 'publish_1',
        snapshot: { ...snapshot, revision: -1 },
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_SNAPSHOT_DESCRIPTOR');
  });

  it('Asset bytes登録要求を複製して検証する', () => {
    const result = parseRegisterBroadcastAssetsRequest({
      requestId: 'register_1',
      assets: [{ ...asset, bytes: assetBytes }],
    });

    expect(result.requestId).toBe('register_1');
    expect(result.assets).toEqual([{ ...asset, bytes: assetBytes }]);
    expect(result.assets[0]!.bytes).not.toBe(assetBytes);
  });

  it('publish descriptorへのsource混入と登録byteLength不一致を拒否する', () => {
    expect(() =>
      parsePublishBroadcastSnapshotRequest({
        requestId: 'publish_1',
        snapshot: {
          ...snapshot,
          assets: [{
            ...asset,
            dataUrl: 'data:image/png;base64,AAAA',
          }],
        },
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_SNAPSHOT_DESCRIPTOR');
    expect(() =>
      parseRegisterBroadcastAssetsRequest({
        requestId: 'register_1',
        assets: [{ ...asset, bytes: new Uint8Array(1) }],
      }),
    ).toThrow('OBS_PROTOCOL_INVALID_ASSET_REGISTRATION');
  });

  it('空文字・過長・記号・非objectを拒否する', () => {
    expect(() => parseSecurityStatusRequest({ requestId: '' })).toThrow(
      'IPC_INVALID_REQUEST_ID',
    );
    expect(() =>
      parseSecurityStatusRequest({ requestId: 'x'.repeat(65) }),
    ).toThrow('IPC_INVALID_REQUEST_ID');
    expect(() =>
      parseSecurityStatusRequest({ requestId: '../secret' }),
    ).toThrow('IPC_INVALID_REQUEST_ID');
    expect(() => parseSecurityStatusRequest(null)).toThrow(
      'IPC_INVALID_REQUEST',
    );
  });
});
