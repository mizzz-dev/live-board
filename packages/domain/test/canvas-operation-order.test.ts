import { describe, expect, it } from 'vitest';
import {
  createAddLayerCommand,
  createAddRasterFillCommand,
  createAddRasterStrokeCommand,
  createCanvasWorkspaceCommandState,
  createEmptyWorkspace,
  createLayer,
  dispatchCanvasCommand,
  dispatchLayerCommandWithCanvasHistory,
  getLayerDocument,
  getRasterDrawing,
  redoCanvasCommand,
  undoCanvasCommand,
} from '../src/index.js';

const timestamp = '2026-07-22T09:00:00.000Z';
const metadata = (id: string) => ({ commandId: id, createdAt: timestamp });

function stroke(id: string) {
  return {
    id,
    tool: 'pen' as const,
    pointerType: 'mouse' as const,
    color: '#FF0000',
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
        x: 10,
        y: 10,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        timestamp: 1,
      },
    ],
  };
}

describe('Canvas operation order', () => {
  it('Stroke・Fill・Strokeへ単調増加するsequenceを付与する', () => {
    const workspace = createEmptyWorkspace('operation-order');
    const project = workspace.projects[0]!;
    const page = project.pages[0]!;
    const layer = createLayer({
      id: 'raster-order',
      pageId: page.id,
      name: '操作順序',
      type: 'raster',
      createdAt: timestamp,
    });
    let state = createCanvasWorkspaceCommandState(workspace);
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
    state = dispatchCanvasCommand(
      state,
      createAddRasterStrokeCommand(
        project.id,
        page.id,
        layer.id,
        stroke('stroke-1'),
        metadata('stroke-1'),
      ),
    );
    state = dispatchCanvasCommand(
      state,
      createAddRasterFillCommand(
        project.id,
        page.id,
        layer.id,
        {
          id: 'fill-1',
          x: 20,
          y: 20,
          color: '#00FF00',
          opacity: 1,
          tolerance: 0,
        },
        metadata('fill-1'),
      ),
    );
    state = dispatchCanvasCommand(
      state,
      createAddRasterStrokeCommand(
        project.id,
        page.id,
        layer.id,
        stroke('stroke-2'),
        metadata('stroke-2'),
      ),
    );

    const drawing = getRasterDrawing(
      getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0] as never,
    );
    expect(drawing.strokes.map((item) => item.sequence)).toEqual([1, 3]);
    expect(drawing.fills.map((item) => item.sequence)).toEqual([2]);

    state = undoCanvasCommand(state, project.id, page.id);
    state = redoCanvasCommand(state, project.id, page.id);
    const redone = getRasterDrawing(
      getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers[0] as never,
    );
    expect(redone.strokes.map((item) => item.sequence)).toEqual([1, 3]);
    expect(redone.fills.map((item) => item.sequence)).toEqual([2]);
  });
});
