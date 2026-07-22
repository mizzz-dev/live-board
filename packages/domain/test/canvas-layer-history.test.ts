import { describe, expect, it } from 'vitest';
import {
  createAddLayerCommand,
  createAddRasterStrokeCommand,
  createCanvasWorkspaceCommandState,
  createDeleteLayerCommand,
  createEmptyWorkspace,
  createLayer,
  dispatchCanvasCommand,
  dispatchLayerCommand,
  getCanvasHistory,
  getLayerDocument,
  undoCanvasCommand,
  undoLayerCommand,
} from '../src/index.js';

const timestamp = '2026-07-22T10:00:00.000Z';
const metadata = (id: string) => ({ commandId: id, createdAt: timestamp });

describe('Canvas-aware layer history', () => {
  it('Layer削除時に対象の描画履歴を破棄して復活を防止する', () => {
    const workspace = createEmptyWorkspace('canvas-layer-history');
    const project = workspace.projects[0]!;
    const page = project.pages[0]!;
    const layer = createLayer({
      id: 'raster-delete',
      pageId: page.id,
      name: '削除対象',
      type: 'raster',
      createdAt: timestamp,
    });
    let state = createCanvasWorkspaceCommandState(workspace);
    state = dispatchLayerCommand(
      state,
      createAddLayerCommand(
        project.id,
        page.id,
        layer,
        null,
        0,
        metadata('layer-add'),
      ),
    ) as typeof state;
    state = dispatchCanvasCommand(
      state,
      createAddRasterStrokeCommand(
        project.id,
        page.id,
        layer.id,
        {
          id: 'stroke-delete',
          tool: 'pen',
          pointerType: 'mouse',
          color: '#FFFFFF',
          size: 10,
          opacity: 1,
          hardness: 1,
          spacing: 0.1,
          smoothing: 0,
          taperStart: 0,
          taperEnd: 0,
          pressureSize: false,
          pressureOpacity: false,
          points: [
            {
              x: 1,
              y: 1,
              pressure: 0.5,
              tiltX: 0,
              tiltY: 0,
              timestamp: 1,
            },
          ],
        },
        metadata('stroke-add'),
      ),
    );
    expect(getCanvasHistory(state, page.id).past).toHaveLength(1);

    state = dispatchLayerCommand(
      state,
      createDeleteLayerCommand(
        project.id,
        page.id,
        layer.id,
        metadata('layer-delete'),
      ),
    ) as typeof state;
    expect(getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers).toHaveLength(0);
    expect(getCanvasHistory(state, page.id).past).toHaveLength(0);

    const afterCanvasUndo = undoCanvasCommand(state, project.id, page.id);
    expect(afterCanvasUndo).toBe(state);
    expect(getLayerDocument(afterCanvasUndo.workspace.projects[0]!.pages[0]!).layers).toHaveLength(0);

    state = undoLayerCommand(state, project.id, page.id) as typeof state;
    expect(getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers).toHaveLength(1);
    expect(getCanvasHistory(state, page.id).past).toHaveLength(0);
  });
});
