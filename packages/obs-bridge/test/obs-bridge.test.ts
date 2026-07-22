import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  parseClientMessage,
  startObsBridge,
  type ObsBridge,
} from '../src/index.js';

let activeBridge: ObsBridge | undefined;

afterEach(async () => {
  if (activeBridge !== undefined) {
    await activeBridge.close();
    activeBridge = undefined;
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

  it('正しいOriginとtokenのWebSocket接続だけを許可する', async () => {
    activeBridge = await startObsBridge();
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const webSocket = await openWebSocket(activeBridge.info.webSocketUrl, origin);

    webSocket.send(JSON.stringify({ type: 'ping', timestamp: 123 }));
    const [rawMessage] = await once(webSocket, 'message');
    expect(JSON.parse(rawMessage.toString())).toEqual({
      type: 'pong',
      timestamp: 123,
    });

    webSocket.close();
    await once(webSocket, 'close');
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
    const webSocket = await openWebSocket(activeBridge.info.webSocketUrl, origin);

    webSocket.send(JSON.stringify({ type: 'unknown' }));
    const [closeCode] = await once(webSocket, 'close');

    expect(closeCode).toBe(1008);
  });
});

describe('parseClientMessage', () => {
  it('pingだけを受け付ける', () => {
    expect(
      parseClientMessage(Buffer.from('{"type":"ping","timestamp":1}')),
    ).toEqual({ type: 'ping', timestamp: 1 });
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
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, { origin });

    webSocket.once('open', () => resolve(webSocket));
    webSocket.once('error', reject);
  });
}

function expectRejectedHandshake(
  url: string,
  origin: string,
  expectedStatusCode: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, { origin });

    webSocket.once('unexpected-response', (_request, response) => {
      response.resume();

      try {
        expect(response.statusCode).toBe(expectedStatusCode);
        resolve();
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
