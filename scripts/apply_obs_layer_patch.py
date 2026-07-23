from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    file_path = Path(path)
    current = file_path.read_text(encoding="utf-8")
    if before not in current:
        raise RuntimeError(f"replacement target not found: {path}: {before[:100]!r}")
    next_content = current.replace(before, after, 1)
    if next_content == current:
        raise RuntimeError(f"replacement did not change: {path}")
    file_path.write_text(next_content, encoding="utf-8")


protocol_path = "packages/obs-protocol/src/protocol-v4.ts"
replace_once(
    protocol_path,
    """export type ObsBridgeServerMessage =
  | { type: 'pong'; timestamp: number }
  | { type: 'snapshot'; snapshot: BroadcastSnapshot }
  | {
      type: 'page.changed';
      snapshot: BroadcastSnapshot;
      transition: import('./protocol-v3.js').PageTransition;
    }
  | { type: 'layer.updated'; snapshot: BroadcastSnapshot };""",
    """export interface BroadcastLayerPatch {
  projectId: string;
  pageId: string;
  baseRevision: number;
  revision: number;
  generatedAt: string;
  upsertedLayers: BroadcastLayer[];
  removedLayerIds: string[];
  layerOrder: string[];
  assets?: BroadcastAsset[];
}

export type ObsBridgeServerMessage =
  | { type: 'pong'; timestamp: number }
  | { type: 'snapshot'; snapshot: BroadcastSnapshot }
  | {
      type: 'page.changed';
      snapshot: BroadcastSnapshot;
      transition: import('./protocol-v3.js').PageTransition;
    }
  | { type: 'layer.updated'; snapshot: BroadcastSnapshot }
  | { type: 'layer.patch'; patch: BroadcastLayerPatch };""",
)

replace_once(
    protocol_path,
    """export function getBroadcastAssetSource(asset: BroadcastAsset): string {
  return isInlineBroadcastAsset(asset) ? asset.dataUrl : asset.url;
}

function isHttpAssetUrl""",
    """export function getBroadcastAssetSource(asset: BroadcastAsset): string {
  return isInlineBroadcastAsset(asset) ? asset.dataUrl : asset.url;
}

export function createBroadcastLayerPatch(
  previousInput: BroadcastSnapshot,
  nextInput: BroadcastSnapshot,
): BroadcastLayerPatch | null {
  const previous = parseBroadcastSnapshot(previousInput);
  const next = parseBroadcastSnapshot(nextInput);
  if (
    previous.projectId !== next.projectId ||
    previous.pageId !== next.pageId ||
    !hasEqualPatchMetadata(previous, next)
  ) {
    return null;
  }

  const previousById = new Map(previous.layers.map((layer) => [layer.id, layer]));
  const nextIds = new Set(next.layers.map((layer) => layer.id));
  const upsertedLayers = next.layers.filter((layer) => {
    const previousLayer = previousById.get(layer.id);
    return previousLayer === undefined ||
      JSON.stringify(previousLayer) !== JSON.stringify(layer);
  });
  const removedLayerIds = previous.layers
    .filter((layer) => !nextIds.has(layer.id))
    .map((layer) => layer.id);

  if (upsertedLayers.length === 0 && removedLayerIds.length === 0) {
    return null;
  }

  return {
    projectId: next.projectId,
    pageId: next.pageId,
    baseRevision: previous.revision,
    revision: next.revision,
    generatedAt: next.generatedAt,
    upsertedLayers,
    removedLayerIds,
    layerOrder: next.layers.map((layer) => layer.id),
    ...(next.assets === undefined ? {} : { assets: next.assets }),
  };
}

export function parseBroadcastLayerPatch(input: unknown): BroadcastLayerPatch {
  if (
    !isRecord(input) ||
    !isEntityId(input.projectId) ||
    !isEntityId(input.pageId) ||
    !isPatchRevision(input.baseRevision) ||
    !isPatchRevision(input.revision) ||
    input.revision <= input.baseRevision ||
    !isPatchTimestamp(input.generatedAt) ||
    !Array.isArray(input.upsertedLayers) ||
    input.upsertedLayers.length > 1_000 ||
    !Array.isArray(input.removedLayerIds) ||
    input.removedLayerIds.length > 1_000 ||
    !input.removedLayerIds.every(isEntityId) ||
    !Array.isArray(input.layerOrder) ||
    input.layerOrder.length > 1_000 ||
    !input.layerOrder.every(isEntityId)
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER_PATCH');
  }

  const upsertedLayers = input.upsertedLayers.map(parseBroadcastLayer);
  const upsertedIds = new Set<string>();
  for (const layer of upsertedLayers) {
    if (upsertedIds.has(layer.id)) {
      throw new Error('OBS_PROTOCOL_INVALID_LAYER_PATCH');
    }
    upsertedIds.add(layer.id);
  }
  const removedLayerIds = [...input.removedLayerIds];
  if (
    new Set(removedLayerIds).size !== removedLayerIds.length ||
    removedLayerIds.some((id) => upsertedIds.has(id)) ||
    new Set(input.layerOrder).size !== input.layerOrder.length
  ) {
    throw new Error('OBS_PROTOCOL_INVALID_LAYER_PATCH');
  }

  const assets =
    input.assets === undefined ? undefined : parseAssetList(input.assets);
  return {
    projectId: input.projectId,
    pageId: input.pageId,
    baseRevision: input.baseRevision,
    revision: input.revision,
    generatedAt: input.generatedAt,
    upsertedLayers,
    removedLayerIds,
    layerOrder: [...input.layerOrder],
    ...(assets === undefined ? {} : { assets }),
  };
}

export function applyBroadcastLayerPatch(
  currentInput: BroadcastSnapshot,
  patchInput: BroadcastLayerPatch,
): BroadcastSnapshot {
  const current = parseBroadcastSnapshot(currentInput);
  const patch = parseBroadcastLayerPatch(patchInput);
  if (
    patch.projectId !== current.projectId ||
    patch.pageId !== current.pageId
  ) {
    throw new Error('OBS_PROTOCOL_LAYER_PATCH_PAGE_MISMATCH');
  }
  if (patch.baseRevision !== current.revision) {
    throw new Error('OBS_PROTOCOL_LAYER_PATCH_BASE_REVISION_MISMATCH');
  }

  const layerById = new Map(current.layers.map((layer) => [layer.id, layer]));
  for (const removedLayerId of patch.removedLayerIds) {
    if (!layerById.delete(removedLayerId)) {
      throw new Error('OBS_PROTOCOL_LAYER_PATCH_REMOVE_NOT_FOUND');
    }
  }
  for (const layer of patch.upsertedLayers) {
    layerById.set(layer.id, layer);
  }
  if (layerById.size !== patch.layerOrder.length) {
    throw new Error('OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH');
  }
  const layers = patch.layerOrder.map((layerId) => {
    const layer = layerById.get(layerId);
    if (layer === undefined) {
      throw new Error('OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH');
    }
    return layer;
  });

  const { assets: _currentAssets, ...currentWithoutAssets } = current;
  return parseBroadcastSnapshot({
    ...currentWithoutAssets,
    revision: patch.revision,
    generatedAt: patch.generatedAt,
    layers,
    ...(patch.assets === undefined ? {} : { assets: patch.assets }),
  });
}

function hasEqualPatchMetadata(
  previous: BroadcastSnapshot,
  next: BroadcastSnapshot,
): boolean {
  return JSON.stringify({
    schemaVersion: previous.schemaVersion,
    projectId: previous.projectId,
    pageId: previous.pageId,
    pageName: previous.pageName,
    canvas: previous.canvas,
    overlay: previous.overlay,
  }) === JSON.stringify({
    schemaVersion: next.schemaVersion,
    projectId: next.projectId,
    pageId: next.pageId,
    pageName: next.pageName,
    canvas: next.canvas,
    overlay: next.overlay,
  });
}

function isPatchRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function isPatchTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isHttpAssetUrl""",
)

replace_once(
    protocol_path,
    """  if (input.type === 'snapshot' || input.type === 'layer.updated') {
    return { type: input.type, snapshot: parseBroadcastSnapshot(input.snapshot) };
  }
  if (input.type === 'page.changed') {""",
    """  if (input.type === 'snapshot' || input.type === 'layer.updated') {
    return { type: input.type, snapshot: parseBroadcastSnapshot(input.snapshot) };
  }
  if (input.type === 'layer.patch') {
    return { type: 'layer.patch', patch: parseBroadcastLayerPatch(input.patch) };
  }
  if (input.type === 'page.changed') {""",
)

bridge_path = "packages/obs-bridge/src/index.ts"
replace_once(
    bridge_path,
    """import {
  parseBroadcastSnapshot,""",
    """import {
  createBroadcastLayerPatch,
  parseBroadcastSnapshot,""",
)
replace_once(
    bridge_path,
    """  if (
    previousSnapshot !== undefined &&
    JSON.stringify(previousSnapshot.layers) !== JSON.stringify(snapshot.layers)
  ) {
    return { type: 'layer.updated', snapshot };
  }

  return { type: 'snapshot', snapshot };""",
    """  if (previousSnapshot !== undefined) {
    const patch = createBroadcastLayerPatch(previousSnapshot, snapshot);
    if (patch !== null) {
      const patchMessage = { type: 'layer.patch', patch } as const;
      const fullMessage = { type: 'snapshot', snapshot } as const;
      if (
        Buffer.byteLength(JSON.stringify(patchMessage), 'utf8') <
        Buffer.byteLength(JSON.stringify(fullMessage), 'utf8')
      ) {
        return patchMessage;
      }
    }
  }

  return { type: 'snapshot', snapshot };""",
)

overlay_path = "apps/overlay/src/App.tsx"
replace_once(
    overlay_path,
    """import {
  DEFAULT_BROADCAST_OVERLAY_SETTINGS,
  parseObsBridgeServerMessage,""",
    """import {
  applyBroadcastLayerPatch,
  DEFAULT_BROADCAST_OVERLAY_SETTINGS,
  parseObsBridgeServerMessage,""",
)
replace_once(
    overlay_path,
    """  const latestRevisionRef = useRef<number | null>(null);
  const canvasRef""",
    """  const latestRevisionRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<BroadcastSnapshot | null>(null);
  const canvasRef""",
)
replace_once(
    overlay_path,
    """      webSocket.addEventListener('message', (event) => {
        try {
          const message = parseObsBridgeServerMessage(
            JSON.parse(String(event.data)),
          );
          if (message.type === 'pong') return;

          const incomingSnapshot = message.snapshot;
          const currentRevision = latestRevisionRef.current;
          if (
            currentRevision !== null &&
            incomingSnapshot.revision > currentRevision + 1
          ) {
            setRevisionGapCount((count) => count + 1);
            requestLatestSnapshot(currentRevision);
          }
          if (
            currentRevision !== null &&
            incomingSnapshot.revision <= currentRevision
          ) {
            return;
          }

          latestRevisionRef.current = incomingSnapshot.revision;
          setLastLatencyMs(
            Math.max(
              0,
              Date.now() - Date.parse(incomingSnapshot.generatedAt),
            ),
          );
          setTransition(
            message.type === 'page.changed'
              ? (incomingSnapshot.overlay ?? DEFAULT_BROADCAST_OVERLAY_SETTINGS).transition
              : NO_TRANSITION,
          );
          setSnapshot(incomingSnapshot);
        } catch {
          webSocket?.close(1008, 'Invalid server message');
        }
      });""",
    """      webSocket.addEventListener('message', (event) => {
        let rawMessage: unknown;
        try {
          rawMessage = JSON.parse(String(event.data));
        } catch {
          webSocket?.close(1008, 'Invalid server message');
          return;
        }

        let message: ReturnType<typeof parseObsBridgeServerMessage>;
        try {
          message = parseObsBridgeServerMessage(rawMessage);
        } catch {
          if (
            typeof rawMessage === 'object' &&
            rawMessage !== null &&
            'type' in rawMessage &&
            rawMessage.type === 'layer.patch'
          ) {
            setRevisionGapCount((count) => count + 1);
            requestLatestSnapshot(latestRevisionRef.current);
            return;
          }
          webSocket?.close(1008, 'Invalid server message');
          return;
        }
        if (message.type === 'pong') return;

        const currentRevision = latestRevisionRef.current;
        let incomingSnapshot: BroadcastSnapshot;
        if (message.type === 'layer.patch') {
          const currentSnapshot = latestSnapshotRef.current;
          if (currentSnapshot === null) {
            setRevisionGapCount((count) => count + 1);
            requestLatestSnapshot(currentRevision);
            return;
          }
          try {
            incomingSnapshot = applyBroadcastLayerPatch(
              currentSnapshot,
              message.patch,
            );
          } catch {
            setRevisionGapCount((count) => count + 1);
            requestLatestSnapshot(currentRevision);
            return;
          }
        } else {
          incomingSnapshot = message.snapshot;
        }

        if (
          currentRevision !== null &&
          incomingSnapshot.revision > currentRevision + 1 &&
          message.type === 'layer.patch'
        ) {
          setRevisionGapCount((count) => count + 1);
          requestLatestSnapshot(currentRevision);
          return;
        }
        if (
          currentRevision !== null &&
          incomingSnapshot.revision <= currentRevision
        ) {
          return;
        }

        latestRevisionRef.current = incomingSnapshot.revision;
        latestSnapshotRef.current = incomingSnapshot;
        setLastLatencyMs(
          Math.max(
            0,
            Date.now() - Date.parse(incomingSnapshot.generatedAt),
          ),
        );
        setTransition(
          message.type === 'page.changed'
            ? (incomingSnapshot.overlay ?? DEFAULT_BROADCAST_OVERLAY_SETTINGS).transition
            : NO_TRANSITION,
        );
        setSnapshot(incomingSnapshot);
      });""",
)

Path("packages/obs-protocol/test/layer-patch.test.ts").write_text(r"""import { describe, expect, it } from 'vitest';
import {
  applyBroadcastLayerPatch,
  createBroadcastLayerPatch,
  parseBroadcastLayerPatch,
  parseObsBridgeServerMessage,
  type BroadcastLayer,
  type BroadcastSnapshot,
} from '../src/protocol-v4.js';

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

describe('BroadcastLayerPatch', () => {
  it('変更Layerだけをupsertし、未変更Layerをpayloadへ含めない', () => {
    const previous = snapshot(1, [textLayer('a', 'A'), textLayer('b', 'B')]);
    const next = snapshot(2, [textLayer('a', 'A2'), textLayer('b', 'B')]);
    const patch = createBroadcastLayerPatch(previous, next);

    expect(patch).not.toBeNull();
    expect(patch?.baseRevision).toBe(1);
    expect(patch?.revision).toBe(2);
    expect(patch?.upsertedLayers.map((layer) => layer.id)).toEqual(['a']);
    expect(patch?.removedLayerIds).toEqual([]);
    expect(patch?.layerOrder).toEqual(['a', 'b']);
    expect(applyBroadcastLayerPatch(previous, patch!)).toEqual(next);
  });

  it('Layer追加・削除・並び替えを適用する', () => {
    const previous = snapshot(1, [
      textLayer('a', 'A'),
      textLayer('b', 'B'),
      textLayer('c', 'C'),
    ]);
    const next = snapshot(2, [
      textLayer('c', 'C'),
      textLayer('a', 'A'),
      textLayer('d', 'D'),
    ]);
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(patch.upsertedLayers.map((layer) => layer.id)).toEqual(['d']);
    expect(patch.removedLayerIds).toEqual(['b']);
    expect(patch.layerOrder).toEqual(['c', 'a', 'd']);
    expect(applyBroadcastLayerPatch(previous, patch)).toEqual(next);
  });

  it('Folder親子関係変更を完成Snapshotとして再検証する', () => {
    const child = textLayer('child', 'Child');
    const folder: BroadcastLayer = {
      id: 'folder',
      parentId: null,
      name: 'Folder',
      type: 'folder',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      color: null,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      childLayerIds: [],
    };
    const nextChild = { ...child, parentId: 'folder' };
    const nextFolder = { ...folder, childLayerIds: ['child'] };
    const previous = snapshot(1, [folder, child]);
    const next = snapshot(2, [nextFolder, nextChild]);

    expect(applyBroadcastLayerPatch(
      previous,
      createBroadcastLayerPatch(previous, next)!,
    )).toEqual(next);
  });

  it('Canvas・Overlay・Page metadata変更ではpatchを生成しない', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const changedLayer = textLayer('a', 'A2');
    expect(createBroadcastLayerPatch(previous, snapshot(2, [changedLayer], {
      pageName: '変更後',
    }))).toBeNull();
    expect(createBroadcastLayerPatch(previous, snapshot(2, [changedLayer], {
      canvas: { ...previous.canvas, width: 1280 },
    }))).toBeNull();
    expect(createBroadcastLayerPatch(previous, snapshot(2, [changedLayer], {
      overlay: { ...previous.overlay, theme: 'blackboard' },
    }))).toBeNull();
  });

  it('base revision・Page・Layer order不一致を拒否する', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const next = snapshot(2, [textLayer('a', 'A2')]);
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(() => applyBroadcastLayerPatch(snapshot(9, previous.layers), patch)).toThrow(
      'OBS_PROTOCOL_LAYER_PATCH_BASE_REVISION_MISMATCH',
    );
    expect(() => applyBroadcastLayerPatch(previous, {
      ...patch,
      pageId: 'page-2',
    })).toThrow('OBS_PROTOCOL_LAYER_PATCH_PAGE_MISMATCH');
    expect(() => applyBroadcastLayerPatch(previous, {
      ...patch,
      layerOrder: ['missing'],
    })).toThrow('OBS_PROTOCOL_LAYER_PATCH_ORDER_MISMATCH');
  });

  it('重複ID・upsertとremove重複・不正timestampをparserで拒否する', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const next = snapshot(2, [textLayer('a', 'A2')]);
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(() => parseBroadcastLayerPatch({
      ...patch,
      layerOrder: ['a', 'a'],
    })).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH');
    expect(() => parseBroadcastLayerPatch({
      ...patch,
      removedLayerIds: ['a'],
    })).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH');
    expect(() => parseBroadcastLayerPatch({
      ...patch,
      generatedAt: 'invalid',
    })).toThrow('OBS_PROTOCOL_INVALID_LAYER_PATCH');
  });

  it('旧layer.updatedと新layer.patchの両方を受信できる', () => {
    const previous = snapshot(1, [textLayer('a', 'A')]);
    const next = snapshot(2, [textLayer('a', 'A2')]);
    const patch = createBroadcastLayerPatch(previous, next)!;

    expect(parseObsBridgeServerMessage({
      type: 'layer.updated',
      snapshot: next,
    })).toEqual({ type: 'layer.updated', snapshot: next });
    expect(parseObsBridgeServerMessage({
      type: 'layer.patch',
      patch,
    })).toEqual({ type: 'layer.patch', patch });
  });
});
""", encoding="utf-8")

Path("packages/obs-bridge/test/layer-patch.test.ts").write_text(r"""import { once } from 'node:events';
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
""", encoding="utf-8")

for removable in [
    "scripts/apply_obs_layer_patch.py",
    ".github/workflows/apply-obs-layer-patch.yml",
    ".github/apply-obs-layer-patch.trigger",
]:
    target = Path(removable)
    if target.exists():
        target.unlink()
