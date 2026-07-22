import { describe, expect, it } from 'vitest';
import {
  canRedoCanvas,
  canUndoCanvas,
  createAddLayerCommand,
  createAddPageCommand,
  createAddRasterFillCommand,
  createAddRasterStrokeCommand,
  createCanvasWorkspaceCommandState,
  createEmptyWorkspace,
  createLayer,
  createPage,
  createTransformLayerCommand,
  dispatchCanvasCommand,
  dispatchLayerCommandWithCanvasHistory,
  dispatchProjectCommandWithCanvasHistory,
  getCanvasHistory,
  getCanvasHistoryBytes,
  getLayerDocument,
  getLayerTransform,
  getRasterDrawing,
  redoCanvasCommand,
  undoCanvasCommand,
} from '../src/index.js';

const timestamp = '2026-07-22T08:00:00.000Z';

function metadata(id: string) {
  return { commandId: id, createdAt: timestamp };
}

function createState(memoryLimit = 64 * 1024 * 1024) {
  const workspace = createEmptyWorkspace('canvas-test');
  const project = workspace.projects[0]!;
  const page = project.pages[0]!;
  let state = createCanvasWorkspaceCommandState(workspace, 100, memoryLimit);
  const layer = createLayer({
    id: 'raster-main',
    pageId: page.id,
    name: '描画',
    type: 'raster',
    createdAt: timestamp,
  });
  state = dispatchLayerCommandWithCanvasHistory(
    state,
    createAddLayerCommand(
      project.id,
      page.id,
      layer,
      null,
      0,
      metadata('layer-add'),
    ),
  );
  return { state, projectId: project.id, pageId: page.id, layerId: layer.id };
}

function stroke(id: string, pointCount = 2) {
  return {
    id,
    tool: 'pen' as const,
    pointerType: 'pen' as const,
    color: '#FF3366',
    size: 24,
    opacity: 0.8,
    hardness: 0.7,
    spacing: 0.2,
    smoothing: 0.4,
    taperStart: 0.1,
    taperEnd: 0.2,
    pressureSize: true,
    pressureOpacity: true,
    points: Array.from({ length: pointCount }, (_, index) => ({
      x: index * 10,
      y: index * 5,
      pressure: index % 2,
      tiltX: 0,
      tiltY: 0,
      timestamp: index,
    })),
  };
}

describe('Canvas command history', () => {
  it('Stroke追加をPage単位でUndo・Redoできる', () => {
    const context = createState();
    let state = dispatchCanvasCommand(
      context.state,
      createAddRasterStrokeCommand(
        context.projectId,
        context.pageId,
        context.layerId,
        stroke('stroke-1'),
        metadata('stroke-add'),
      ),
    );

    const drawing = getRasterDrawing(
      getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0] as never,
    );
    expect(drawing.strokes).toHaveLength(1);
    expect(drawing.strokes[0]?.points.map((point) => point.pressure)).toEqual([0, 1]);
    expect(canUndoCanvas(state, context.pageId)).toBe(true);

    state = undoCanvasCommand(state, context.projectId, context.pageId);
    expect(
      getRasterDrawing(
        getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0] as never,
      ).strokes,
    ).toHaveLength(0);
    expect(canRedoCanvas(state, context.pageId)).toBe(true);

    state = redoCanvasCommand(state, context.projectId, context.pageId);
    expect(
      getRasterDrawing(
        getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0] as never,
      ).strokes,
    ).toHaveLength(1);
  });

  it('FillとStrokeを別の履歴項目として保持する', () => {
    const context = createState();
    let state = dispatchCanvasCommand(
      context.state,
      createAddRasterStrokeCommand(
        context.projectId,
        context.pageId,
        context.layerId,
        stroke('stroke-1'),
        metadata('stroke-add'),
      ),
    );
    state = dispatchCanvasCommand(
      state,
      createAddRasterFillCommand(
        context.projectId,
        context.pageId,
        context.layerId,
        {
          id: 'fill-1',
          x: 100,
          y: 200,
          color: '#00AAFFFF',
          opacity: 0.5,
          tolerance: 32,
        },
        metadata('fill-add'),
      ),
    );
    const drawing = getRasterDrawing(
      getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0] as never,
    );
    expect(drawing.strokes).toHaveLength(1);
    expect(drawing.fills).toHaveLength(1);
    expect(getCanvasHistory(state, context.pageId).past).toHaveLength(2);
  });

  it('描画履歴をPage間で分離する', () => {
    const context = createState();
    const project = context.state.workspace.projects[0]!;
    const page2 = createPage({
      id: 'page-second',
      projectId: project.id,
      name: 'ページ 2',
      createdAt: timestamp,
    });
    let state = dispatchProjectCommandWithCanvasHistory(
      context.state,
      createAddPageCommand(project.id, page2, metadata('page-add')),
    );
    state = dispatchCanvasCommand(
      state,
      createAddRasterStrokeCommand(
        project.id,
        context.pageId,
        context.layerId,
        stroke('stroke-page-1'),
        metadata('stroke-page-1'),
      ),
    );
    expect(getCanvasHistory(state, context.pageId).past).toHaveLength(1);
    expect(getCanvasHistory(state, page2.id).past).toHaveLength(0);
  });

  it('履歴バイト上限を超える古い項目を破棄する', () => {
    const context = createState(4_096);
    let state = context.state;
    for (let index = 0; index < 8; index += 1) {
      state = dispatchCanvasCommand(
        state,
        createAddRasterStrokeCommand(
          context.projectId,
          context.pageId,
          context.layerId,
          stroke(`stroke-${index}`, 30),
          metadata(`stroke-${index}`),
        ),
      );
    }
    expect(getCanvasHistory(state, context.pageId).past.length).toBeLessThan(8);
    expect(getCanvasHistoryBytes(state, context.pageId)).toBeGreaterThan(0);
  });
});

describe('Layer transform', () => {
  it('移動・拡大縮小・回転を保持しUndoできる', () => {
    const context = createState();
    let state = dispatchCanvasCommand(
      context.state,
      createTransformLayerCommand(
        context.projectId,
        context.pageId,
        context.layerId,
        { x: 120, y: -30, scaleX: -1.5, scaleY: 0.75, rotation: 45 },
        metadata('transform'),
      ),
    );
    const layer = getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0]!;
    expect(getLayerTransform(layer)).toEqual({
      x: 120,
      y: -30,
      scaleX: -1.5,
      scaleY: 0.75,
      rotation: 45,
    });
    state = undoCanvasCommand(state, context.projectId, context.pageId);
    expect(
      getLayerTransform(
        getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0]!,
      ),
    ).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it('移動ロック中のtransformを拒否する', () => {
    const workspace = createEmptyWorkspace('locked-transform');
    const project = workspace.projects[0]!;
    const page = project.pages[0]!;
    let state = createCanvasWorkspaceCommandState(workspace);
    const layer = createLayer({
      id: 'locked-raster',
      pageId: page.id,
      name: 'ロック',
      type: 'raster',
      movementLocked: true,
      createdAt: timestamp,
    });
    state = dispatchLayerCommandWithCanvasHistory(
      state,
      createAddLayerCommand(
        project.id,
        page.id,
        layer,
        null,
        0,
        metadata('locked-add'),
      ),
    );
    expect(() =>
      dispatchCanvasCommand(
        state,
        createTransformLayerCommand(
          project.id,
          page.id,
          layer.id,
          { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          metadata('locked-transform'),
        ),
      ),
    ).toThrow(/cannot be transformed/);
  });
});
