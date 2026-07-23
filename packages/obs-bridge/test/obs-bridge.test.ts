import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  parseClientMessage,
  startObsBridge,
  type BroadcastSnapshot,
  type ObsBridge,
} from '../src/index.js';

let activeBridge: ObsBridge | undefined;
let temporaryDirectory: string | undefined;

const snapshot: BroadcastSnapshot = {
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

afterEach(async () => {
  if (activeBridge !== undefined) {
    await activeBridge.close();
    activeBridge = undefined;
  }

  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe('OBS bridge', () => {
  it('loopbackへbindし、token付きOverlayだけを許可する', async () => {
    activeBridge = await startObsBridge();

    expect(activeBridge.info.host).toBe('127.0.0.1');
    expect(activeBridge.info.port).toBeGreaterThan(0);

    const healthResponse = await fetch(
      `http://127.0.0.1:${activeBridge.info.port}/health`,
    );
    expect(healthResponse.status).toBe(204);

    const overlayResponse = await fetch(activeBridge.info.overlayUrl);
    expect(overlayResponse.status).toBe(200);
    expect(overlayResponse.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );

    const invalidOverlayUrl = new URL(activeBridge.info.overlayUrl);
    invalidOverlayUrl.pathname = '/overlay/invalid-token';
    const invalidResponse = await fetch(invalidOverlayUrl);
    expect(invalidResponse.status).toBe(401);
  });

  it('ビルド済みOverlay静的ファイルを安全に配信する', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'live-board-overlay-'));
    await mkdir(join(temporaryDirectory, 'assets'));
    await writeFile(
      join(temporaryDirectory, 'index.html'),
      '<!doctype html><script type="module" src="/assets/app.js"></script>',
    );
    await writeFile(join(temporaryDirectory, 'assets/app.js'), 'export {};');

    activeBridge = await startObsBridge({ overlayRoot: temporaryDirectory });

    const overlayResponse = await fetch(activeBridge.info.overlayUrl);
    expect(await overlayResponse.text()).toContain('/assets/app.js');

    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const assetResponse = await fetch(`${origin}/assets/app.js`);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('content-type')).toContain(
      'text/javascript',
    );

    const traversalResponse = await fetch(
      `${origin}/assets/%2e%2e/index.html`,
    );
    expect(traversalResponse.status).not.toBe(200);
  });

  it('正しいOriginとtokenのWebSocket接続だけを許可する', async () => {
    activeBridge = await startObsBridge();
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const webSocket = await openWebSocket(
      activeBridge.info.webSocketUrl,
      origin,
    );

    webSocket.send(JSON.stringify({ type: 'ping', timestamp: 123 }));
    const [rawMessage] = await once(webSocket, 'message');
    expect(JSON.parse(rawMessage.toString())).toEqual({
      type: 'pong',
      timestamp: 123,
    });

    webSocket.close();
    await once(webSocket, 'close');
  });

  it('接続時に最新snapshotを送り、ページ変更をフェード付きでpushする', async () => {
    activeBridge = await startObsBridge({ initialSnapshot: snapshot });
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const webSocket = new WebSocket(activeBridge.info.webSocketUrl, { origin });
    const initialMessagePromise = once(webSocket, 'message');

    await once(webSocket, 'open');
    const [initialRawMessage] = await initialMessagePromise;
    expect(JSON.parse(initialRawMessage.toString())).toEqual({
      type: 'snapshot',
      snapshot,
    });

    const updatedSnapshot = {
      ...snapshot,
      pageId: 'page-2',
      pageName: 'ページ 2',
      revision: 2,
    } satisfies BroadcastSnapshot;
    const updateMessagePromise = once(webSocket, 'message');

    expect(activeBridge.publishSnapshot(updatedSnapshot)).toBe(2);
    const [updatedRawMessage] = await updateMessagePromise;
    expect(JSON.parse(updatedRawMessage.toString())).toEqual({
      type: 'page.changed',
      snapshot: updatedSnapshot,
      transition: { type: 'fade', durationMs: 150 },
    });
    expect(activeBridge.getLatestRevision()).toBe(2);

    expect(() => activeBridge?.publishSnapshot(snapshot)).toThrow(
      'OBS_BRIDGE_STALE_REVISION',
    );

    webSocket.close();
    await once(webSocket, 'close');
  });

  it('同じページの内容更新はsnapshotとしてpushする', async () => {
    activeBridge = await startObsBridge({ initialSnapshot: snapshot });
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const webSocket = new WebSocket(activeBridge.info.webSocketUrl, { origin });
    const initialMessagePromise = once(webSocket, 'message');

    await once(webSocket, 'open');
    await initialMessagePromise;

    const updatedSnapshot = {
      ...snapshot,
      pageName: 'ページ名更新',
      revision: 2,
    } satisfies BroadcastSnapshot;
    const updateMessagePromise = once(webSocket, 'message');
    activeBridge.publishSnapshot(updatedSnapshot);
    const [updatedRawMessage] = await updateMessagePromise;

    expect(JSON.parse(updatedRawMessage.toString())).toEqual({
      type: 'snapshot',
      snapshot: updatedSnapshot,
    });

    webSocket.close();
    await once(webSocket, 'close');
  });

  it('切断中の更新を再接続時の最新snapshotで収束させる', async () => {
    activeBridge = await startObsBridge({ initialSnapshot: snapshot });
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const firstConnection = new WebSocket(activeBridge.info.webSocketUrl, {
      origin,
    });
    const firstSnapshotPromise = once(firstConnection, 'message');

    await once(firstConnection, 'open');
    await firstSnapshotPromise;
    firstConnection.close();
    await once(firstConnection, 'close');

    const latestSnapshot = {
      ...snapshot,
      pageId: 'page-3',
      pageName: 'ページ 3',
      revision: 3,
    } satisfies BroadcastSnapshot;
    activeBridge.publishSnapshot(latestSnapshot);

    const reconnected = new WebSocket(activeBridge.info.webSocketUrl, {
      origin,
    });
    const latestMessagePromise = once(reconnected, 'message');
    await once(reconnected, 'open');
    const [latestRawMessage] = await latestMessagePromise;

    expect(JSON.parse(latestRawMessage.toString())).toEqual({
      type: 'snapshot',
      snapshot: latestSnapshot,
    });

    reconnected.close();
    await once(reconnected, 'close');
  });

  it('不正tokenと外部OriginをUpgrade前に拒否する', async () => {
    activeBridge = await startObsBridge();
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const invalidTokenUrl = new URL(activeBridge.info.webSocketUrl);
    invalidTokenUrl.searchParams.set('token', 'invalid-token');

    await expectRejectedHandshake(invalidTokenUrl.toString(), origin, 401);
    await expectRejectedHandshake(
      activeBridge.info.webSocketUrl,
      'https://attacker.example',
      403,
    );
  });

  it('接続数上限を超えたWebSocketを拒否する', async () => {
    activeBridge = await startObsBridge({ maxConnections: 1 });
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const firstConnection = await openWebSocket(
      activeBridge.info.webSocketUrl,
      origin,
    );

    await expectRejectedHandshake(activeBridge.info.webSocketUrl, origin, 503);

    firstConnection.close();
    await once(firstConnection, 'close');
  });

  it('未知message typeをpolicy violationとして切断する', async () => {
    activeBridge = await startObsBridge();
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const webSocket = await openWebSocket(
      activeBridge.info.webSocketUrl,
      origin,
    );

    webSocket.send(JSON.stringify({ type: 'unknown' }));
    const [closeCode] = await once(webSocket, 'close');

    expect(closeCode).toBe(1008);
  });
});

describe('parseClientMessage', () => {
  it('pingとsnapshot要求だけを受け付ける', () => {
    expect(
      parseClientMessage(Buffer.from('{"type":"ping","timestamp":1}')),
    ).toEqual({ type: 'ping', timestamp: 1 });
    expect(
      parseClientMessage(
        Buffer.from('{"type":"snapshot.request","lastRevision":1}'),
      ),
    ).toEqual({ type: 'snapshot.request', lastRevision: 1 });
  });

  it('過大・不正JSON・未知typeを拒否する', () => {
    expect(() => parseClientMessage(Buffer.from('not-json'))).toThrow(
      'OBS_BRIDGE_INVALID_JSON',
    );
    expect(() =>
      parseClientMessage(Buffer.from('{"type":"unknown"}')),
    ).toThrow('OBS_BRIDGE_UNKNOWN_MESSAGE');
    expect(() =>
      parseClientMessage(Buffer.from('x'.repeat(2048)), 1024),
    ).toThrow('OBS_BRIDGE_MESSAGE_TOO_LARGE');
  });
});

function openWebSocket(url: string, origin: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const webSocket = new WebSocket(url, { origin });

    webSocket.once('open', () => resolvePromise(webSocket));
    webSocket.once('error', reject);
  });
}

function expectRejectedHandshake(
  url: string,
  origin: string,
  expectedStatusCode: number,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const webSocket = new WebSocket(url, { origin });

    webSocket.once('unexpected-response', (_request, response) => {
      response.resume();

      try {
        expect(response.statusCode).toBe(expectedStatusCode);
        resolvePromise();
      } catch (error) {
        reject(error);
      }
    });
    webSocket.once('open', () => {
      webSocket.terminate();
      reject(new Error('Expected the handshake to be rejected'));
    });
    webSocket.once('error', () => {
      // unexpected-response後に発生するerrorは検証結果へ影響させない。
    });
  });
}
