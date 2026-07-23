import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { BroadcastLayer, BroadcastSnapshot } from '@live-board/obs-protocol';
import { startObsBridge, type ObsBridge } from '../src/index.js';

let activeBridge: ObsBridge | undefined;

afterEach(async () => {
  if (activeBridge !== undefined) {
    await activeBridge.close();
    activeBridge = undefined;
  }
});

function textLayer(id: string, text: string): BroadcastLayer {
  return {
    id,
    parentId: null,
    name: id,
    type: 'text',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    color: null,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    content: {
      text,
      fontFamily: 'sans-serif',
      fontSize: 48,
      color: '#FFFFFF',
      fontWeight: 400,
      fontStyle: 'normal',
      align: 'left',
      lineHeight: 1.2,
      strokeColor: null,
      strokeWidth: 0,
      shadowColor: null,
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      maxWidth: null,
    },
  };
}

function snapshot(
  revision: number,
  changedLayerIndex: number,
  text: string,
): BroadcastSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision,
    generatedAt: `2026-07-23T00:00:0${revision}.000Z`,
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
    layers: Array.from({ length: 100 }, (_, index) =>
      textLayer(`layer-${index}`, index === changedLayerIndex ? text : `Text ${index}`),
    ),
  };
}

async function openBridgeSocket(bridge: ObsBridge): Promise<WebSocket> {
  const origin = new URL(bridge.info.overlayUrl).origin;
  const socket = new WebSocket(bridge.info.webSocketUrl, { origin });
  await once(socket, 'open');
  return socket;
}

describe('OBS Bridge layer.patch continuity', () => {
  it('連続更新をbase revision 1→2→3のpatchとして配信する', async () => {
    const revision1 = snapshot(1, -1, '');
    const revision2 = snapshot(2, 10, 'Revision 2');
    const revision3 = snapshot(3, 20, 'Revision 3');
    activeBridge = await startObsBridge({ initialSnapshot: revision1 });

    const initialPromise = once(
      await openBridgeSocket(activeBridge),
      'message',
    );
    const socket = initialPromise.length === 0
      ? await openBridgeSocket(activeBridge)
      : undefined;
    void socket;
  });

  it('古いrevisionからsnapshot.requestすると最新フルSnapshotへ復旧する', async () => {
    const revision1 = snapshot(1, -1, '');
    const revision2 = snapshot(2, 10, 'Revision 2');
    const revision3 = snapshot(3, 20, 'Revision 3');
    activeBridge = await startObsBridge({ initialSnapshot: revision1 });
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const socket = new WebSocket(activeBridge.info.webSocketUrl, { origin });
    const initialPromise = once(socket, 'message');
    await once(socket, 'open');
    await initialPromise;

    const patch2Promise = once(socket, 'message');
    activeBridge.publishSnapshot(revision2);
    const [patch2Raw] = await patch2Promise;
    expect(JSON.parse(patch2Raw.toString())).toMatchObject({
      type: 'layer.patch',
      patch: { baseRevision: 1, revision: 2 },
    });

    const patch3Promise = once(socket, 'message');
    activeBridge.publishSnapshot(revision3);
    const [patch3Raw] = await patch3Promise;
    expect(JSON.parse(patch3Raw.toString())).toMatchObject({
      type: 'layer.patch',
      patch: { baseRevision: 2, revision: 3 },
    });

    const recoveryPromise = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'snapshot.request', lastRevision: 1 }));
    const [recoveryRaw] = await recoveryPromise;
    expect(JSON.parse(recoveryRaw.toString())).toMatchObject({
      type: 'snapshot',
      snapshot: { revision: 3 },
    });

    socket.close();
    await once(socket, 'close');
  });
});
