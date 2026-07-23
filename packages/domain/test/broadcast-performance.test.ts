import { describe, expect, it } from 'vitest';
import {
  addLayer,
  createBroadcastLayers,
  createEmptyLayerDocument,
  createLayer,
  createPage,
  createProject,
  createWorkspace,
  estimateDecodedImageBytes,
  evaluateBroadcastPerformance,
  navigateBroadcastPage,
  simulateBroadcastSession,
  type LayerDocument,
} from '../src/index.js';

const timestamp = '2026-07-23T00:00:00.000Z';

function createScaleWorkspace(pageCount: number) {
  const workspaceId = 'workspace-scale';
  const projectId = 'project-scale';
  const pages = Array.from({ length: pageCount }, (_, index) =>
    createPage({
      id: `page-${index + 1}`,
      projectId,
      name: `ページ ${index + 1}`,
      createdAt: timestamp,
    }),
  );
  return createWorkspace({
    id: workspaceId,
    name: '性能試験',
    projects: [
      createProject({
        id: projectId,
        workspaceId,
        name: '性能試験Project',
        pages,
        createdAt: timestamp,
      }),
    ],
    createdAt: timestamp,
  });
}

function createLayerDocument(layerCount: number): LayerDocument {
  let document = createEmptyLayerDocument();
  for (let index = 0; index < layerCount; index += 1) {
    document = addLayer(
      document,
      createLayer({
        id: `layer-${index + 1}`,
        pageId: 'page-scale',
        name: `Layer ${index + 1}`,
        type: index % 3 === 0 ? 'shape' : 'raster',
        visible: index % 2 === 0,
        createdAt: timestamp,
      }),
      null,
      document.rootLayerIds.length,
    );
  }
  return document;
}

describe('配信性能スケール試験', () => {
  it('100ページの切り替え操作を性能予算内で処理する', () => {
    const workspace = createScaleWorkspace(100);
    const startedAt = performance.now();
    const result = navigateBroadcastPage(workspace, 'project-scale', { type: 'next' });
    const durationMs = performance.now() - startedAt;
    const evaluation = evaluateBroadcastPerformance('pageListOperationMs', durationMs);

    console.info('IVR-245 page-list-metric', {
      pages: 100,
      durationMs: Number(durationMs.toFixed(3)),
      budgetMs: evaluation.budgetMs,
    });
    expect(result.selectedPageId).toBe('page-2');
    expect(evaluation.exceeded).toBe(false);
  });

  it('100Layerから非表示Layerを投影対象外にする', () => {
    const document = createLayerDocument(100);
    const startedAt = performance.now();
    const layers = createBroadcastLayers(document);
    const durationMs = performance.now() - startedAt;
    const evaluation = evaluateBroadcastPerformance('layerProjectionMs', durationMs);

    console.info('IVR-245 layer-projection-metric', {
      sourceLayers: 100,
      broadcastLayers: layers.length,
      durationMs: Number(durationMs.toFixed(3)),
      budgetMs: evaluation.budgetMs,
    });
    expect(layers).toHaveLength(50);
    expect(layers.every((layer) => layer.visible)).toBe(true);
    expect(evaluation.exceeded).toBe(false);
  });

  it('4K画像複数配置のデコード後メモリ制約を記録する', () => {
    const decodedBytes = estimateDecodedImageBytes(3840, 2160, 4);

    console.info('IVR-245 4k-image-memory', {
      imageCount: 4,
      decodedBytes,
      decodedMiB: Number((decodedBytes / 1024 / 1024).toFixed(2)),
    });
    expect(decodedBytes).toBe(132_710_400);
    expect(decodedBytes / 1024 / 1024).toBeCloseTo(126.56, 2);
  });

  it('8時間相当の28,800回切り替えでrevision欠番と同期停止を発生させない', () => {
    const workspace = createScaleWorkspace(10);
    const startedAt = performance.now();
    const result = simulateBroadcastSession(workspace, 'project-scale', 28_800, 1);
    const durationMs = performance.now() - startedAt;

    console.info('IVR-245 eight-hour-equivalent', {
      iterations: result.iterations,
      successfulSwitches: result.successfulSwitches,
      revisionGapCount: result.revisionGapCount,
      retainedWorkspaceCount: result.retainedWorkspaceCount,
      maxSerializedWorkspaceBytes: result.maxSerializedWorkspaceBytes,
      durationMs: Number(durationMs.toFixed(3)),
    });
    expect(result.successfulSwitches).toBe(28_800);
    expect(result.revisionEnd).toBe(28_800);
    expect(result.revisionGapCount).toBe(0);
    expect(result.retainedWorkspaceCount).toBe(1);
  });

  it('性能予算超過時に警告を生成する', () => {
    expect(evaluateBroadcastPerformance('overlayRenderMs', 100.1)).toMatchObject({
      exceeded: true,
      budgetMs: 100,
    });
    expect(
      evaluateBroadcastPerformance('overlayRenderMs', 100.1).warning,
    ).toContain('性能予算を超過');
  });
});
