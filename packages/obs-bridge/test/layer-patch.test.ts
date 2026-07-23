import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { BroadcastLayer, BroadcastSnapshot } from '@live-board/obs-protocol';
import {
  createSnapshotMessage,
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
  layers: BroadcastLayer[],
  overrides: Partial<BroadcastSnapshot> = {},
): BroadcastSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    pageId: 'page-1',
    pageName: 'ページ 1',
    revision,
    generatedAt: `2026-07-23T00:00:0${Math.min(revision, 9)}.000Z`,
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
    layers,
    ...overrides,
  };
}

describe('OBS Bridge layer.patch', () => {
  it('100Layer中1Layer更新をfull Snapshotより小さいpatchで送る', () => {
    const previous = snapshot(
      1,
      Array.from({ length: 100 }, (_, index) => textLayer(`layer-${index}`, `Text ${index}`)),
    );
    const next = snapshot(
      2,
      previous.layers.map((layer, index) =>
        index === 40 ? textLayer(layer.id, 'Updated') : layer,
      ),
    );
    const message = createSnapshotMessage(previous, next, {
      type: 'fade',
      durationMs: 150,
    });

    expect(message.type).toBe('layer.patch');
    if (message.type !== 'layer.patch') throw new Error('expected layer.patch');
    expect(message.patch.upsertedLayers.map((layer) => layer.id)).toEqual(['layer-40']);
    expect(JSON.stringify(message)).not.toContain('Text 99');
    expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThan(
      Buffer.byteLength(JSON.stringify({ type: 'snapshot', snapshot: next })),
    );
  });

  it('Canvas・Overlay設定変更と小さすぎる差分はfull Snapshotへfallbackする', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const changedLayer = textLayer('a', 'A2');
    expect(createSnapshotMessage(previous, snapshot(2, [changedLayer], {
      canvas: { ...previous.canvas, width: 1280 },
    }), { type: 'fade', durationMs: 150 }).type).toBe('snapshot');
    expect(createSnapshotMessage(previous, snapshot(2, [changedLayer], {
      overlay: { ...previous.overlay, theme: 'blackboard' },
    }), { type: 'fade', durationMs: 150 }).type).toBe('snapshot');
    expect(createSnapshotMessage(previous, snapshot(2, [changedLayer]), {
      type: 'fade',
      durationMs: 150,
    }).type).toBe('snapshot');
  });

  it('Page変更は従来どおりpage.changedを送る', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const next = snapshot(2, [textLayer('a', 'A2')], {
      pageId: 'page-2',
    });
    expect(createSnapshotMessage(previous, next, {
      type: 'fade',
      durationMs: 150,
    })).toMatchObject({ type: 'page.changed', snapshot: next });
  });

  it('接続時はfull Snapshot、更新時はpatch、snapshot.request時はfull Snapshotを返す', async () => {
    const previous = snapshot(
      1,
      Array.from({ length: 100 }, (_, index) => textLayer(`layer-${index}`, `Text ${index}`)),
    );
    activeBridge = await startObsBridge({ initialSnapshot: previous });
    const origin = new URL(activeBridge.info.overlayUrl).origin;
    const socket = new WebSocket(activeBridge.info.webSocketUrl, { origin });
    const initialPromise = once(socket, 'message');
    await once(socket, 'open');
    const [initialRaw] = await initialPromise;
    expect(JSON.parse(initialRaw.toString())).toMatchObject({
      type: 'snapshot',
      snapshot: { revision: 1 },
    });

    const next = snapshot(
      2,
      previous.layers.map((layer, index) =>
        index === 50 ? textLayer(layer.id, 'Updated') : layer,
      ),
    );
    const patchPromise = once(socket, 'message');
    activeBridge.publishSnapshot(next);
    const [patchRaw] = await patchPromise;
    const patchMessage = JSON.parse(patchRaw.toString());
    expect(patchMessage).toMatchObject({
      type: 'layer.patch',
      patch: { baseRevision: 1, revision: 2 },
    });

    const recoveryPromise = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'snapshot.request', lastRevision: 1 }));
    const [recoveryRaw] = await recoveryPromise;
    expect(JSON.parse(recoveryRaw.toString())).toMatchObject({
      type: 'snapshot',
      snapshot: { revision: 2 },
    });

    socket.close();
    await once(socket, 'close');
  });
});
