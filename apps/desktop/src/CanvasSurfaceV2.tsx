import {
  RichCanvasRenderer,
  createCanvasSelection,
  createDefaultToolRegistry,
  normalizePointerSample,
  panViewport,
  screenToCanvas,
  snapCanvasPoint,
  updateDragSelection,
  viewportTransformCss,
  zoomViewportAt,
  type BrushSettings,
  type CanvasSelection,
  type CanvasToolContext,
  type CanvasToolId,
  type CanvasToolResult,
  type CanvasToolSession,
  type CanvasViewport,
  type RenderMetrics,
  type SelectionMode,
  type SnapSettings,
  type ToolPointerSample,
} from '@live-board/canvas-engine';
import type { BroadcastSnapshot } from '@live-board/obs-protocol';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import './canvas-surface.css';
import './selection-overlay.css';

interface CanvasSurfaceV2Props {
  snapshot: BroadcastSnapshot;
  toolId: CanvasToolId;
  brush: BrushSettings;
  viewport: CanvasViewport;
  snap: SnapSettings;
  guidesVisible: boolean;
  gridVisible: boolean;
  selectionMode: SelectionMode | null;
  selection: CanvasSelection | null;
  onSelectionChange(selection: CanvasSelection | null): void;
  onViewportChange(viewport: CanvasViewport): void;
  onToolResult(result: Exclude<CanvasToolResult, null>): void;
  onRenderMetrics(metrics: RenderMetrics): void;
}

interface ActivePointer {
  pointerId: number;
  session: CanvasToolSession;
  lastCanvasSample: ToolPointerSample;
}

interface SelectionDraft {
  pointerId: number;
  mode: SelectionMode;
  start: ToolPointerSample;
  points: ToolPointerSample[];
}

const toolRegistry = createDefaultToolRegistry();

export function CanvasSurfaceV2({
  snapshot,
  toolId,
  brush,
  viewport,
  snap,
  guidesVisible,
  gridVisible,
  selectionMode,
  selection,
  onSelectionChange,
  onViewportChange,
  onToolResult,
  onRenderMetrics,
}: CanvasSurfaceV2Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const rendererRef = useRef<RichCanvasRenderer | null>(null);
  if (rendererRef.current === null) {
    rendererRef.current = new RichCanvasRenderer(() => setAssetRevision((value) => value + 1));
  }
  const activePointerRef = useRef<ActivePointer | null>(null);
  const selectionDraftRef = useRef<SelectionDraft | null>(null);
  const tool = useMemo(() => toolRegistry.get(toolId), [toolId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    onRenderMetrics(rendererRef.current!.render(canvas, snapshot));
  }, [snapshot, assetRevision, onRenderMetrics]);

  const canvasStyle = {
    width: `${snapshot.canvas.width}px`,
    height: `${snapshot.canvas.height}px`,
    transform: viewportTransformCss(viewport, snapshot.canvas),
    cursor: selectionMode === null ? tool.cursor : 'crosshair',
    '--grid-size': `${snap.gridSize}px`,
  } as CSSProperties;

  function createToolContext(): CanvasToolContext {
    return {
      settings: brush,
      createId: (prefix) => `${prefix}:${globalThis.crypto.randomUUID()}`,
      sampleColor: (point) => {
        const canvas = canvasRef.current;
        return canvas === null
          ? null
          : rendererRef.current!.sampleColor(canvas, point.x, point.y);
      },
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || activePointerRef.current !== null || selectionDraftRef.current !== null) return;
    const stage = stageRef.current;
    if (stage === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvasSample = sampleFromPointer(event, stage, snapshot, viewport, snap);
    if (selectionMode !== null) {
      selectionDraftRef.current = {
        pointerId: event.pointerId,
        mode: selectionMode,
        start: canvasSample,
        points: [canvasSample],
      };
      onSelectionChange(null);
      return;
    }
    const toolSample = toolId === 'pan'
      ? screenPointerSample(event)
      : canvasSample;
    activePointerRef.current = {
      pointerId: event.pointerId,
      session: tool.begin(toolSample, createToolContext()),
      lastCanvasSample: canvasSample,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const stage = stageRef.current;
    if (stage === null) return;
    const draft = selectionDraftRef.current;
    if (draft !== null && draft.pointerId === event.pointerId) {
      const point = sampleFromPointer(event, stage, snapshot, viewport, snap);
      updateSelectionDraft(draft, point, onSelectionChange);
      return;
    }

    const active = activePointerRef.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const canvasSample = sampleFromPointer(event, stage, snapshot, viewport, snap);
    const toolSample = toolId === 'pan' ? screenPointerSample(event) : canvasSample;
    const result = tool.move(active.session, toolSample, createToolContext());
    if (toolId === 'pen' || toolId === 'eraser') {
      drawImmediatePreview(
        canvasRef.current,
        active.lastCanvasSample,
        canvasSample,
        brush,
        toolId,
      );
    }
    active.lastCanvasSample = canvasSample;
    if (result?.type === 'pan') {
      onViewportChange(panViewport(viewport, result.deltaX, result.deltaY));
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    const stage = stageRef.current;
    if (stage === null) return;
    const draft = selectionDraftRef.current;
    if (draft !== null && draft.pointerId === event.pointerId) {
      const point = sampleFromPointer(event, stage, snapshot, viewport, snap);
      updateSelectionDraft(draft, point, onSelectionChange);
      selectionDraftRef.current = null;
      releasePointer(event);
      return;
    }

    const active = activePointerRef.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const canvasSample = sampleFromPointer(event, stage, snapshot, viewport, snap);
    const toolSample = toolId === 'pan' ? screenPointerSample(event) : canvasSample;
    const result = tool.end(active.session, toolSample, createToolContext());
    activePointerRef.current = null;
    releasePointer(event);
    if (result !== null) onToolResult(result);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    const draft = selectionDraftRef.current;
    if (draft !== null && draft.pointerId === event.pointerId) {
      selectionDraftRef.current = null;
      onSelectionChange(null);
      return;
    }
    const active = activePointerRef.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    tool.cancel(active.session);
    activePointerRef.current = null;
    const canvas = canvasRef.current;
    if (canvas !== null) onRenderMetrics(rendererRef.current!.render(canvas, snapshot));
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const stage = stageRef.current;
    if (stage === null) return;
    const rect = stage.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const factor = Math.exp(-event.deltaY * 0.002);
    onViewportChange(
      zoomViewportAt(
        viewport,
        point,
        viewport.zoom * factor,
        { width: rect.width, height: rect.height },
        snapshot.canvas,
      ),
    );
  }

  return (
    <div
      ref={stageRef}
      className="canvas-surface"
      data-testid="canvas-surface"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onWheel={handleWheel}
    >
      <div className="canvas-transform" style={canvasStyle}>
        <canvas
          ref={canvasRef}
          className="document-canvas"
          width={snapshot.canvas.width}
          height={snapshot.canvas.height}
          aria-label={`${snapshot.pageName}の描画キャンバス`}
        />
        {gridVisible ? <div className="canvas-grid" aria-hidden="true" /> : null}
        {guidesVisible
          ? snap.guideX.map((x) => (
              <span key={`x-${x}`} className="canvas-guide vertical" style={{ left: `${x}px` }} aria-hidden="true" />
            ))
          : null}
        {guidesVisible
          ? snap.guideY.map((y) => (
              <span key={`y-${y}`} className="canvas-guide horizontal" style={{ top: `${y}px` }} aria-hidden="true" />
            ))
          : null}
        {selection === null ? null : <SelectionOverlay selection={selection} />}
      </div>
    </div>
  );
}

function SelectionOverlay({ selection }: { selection: CanvasSelection }) {
  const bounds = selection.bounds;
  return (
    <svg className="selection-overlay" viewBox={`0 0 ${Math.max(1, bounds.x + bounds.width + 1)} ${Math.max(1, bounds.y + bounds.height + 1)}`} aria-label={`${selection.mode}選択範囲`}>
      {selection.mode === 'rectangle' ? (
        <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} />
      ) : selection.mode === 'ellipse' ? (
        <ellipse cx={bounds.x + bounds.width / 2} cy={bounds.y + bounds.height / 2} rx={bounds.width / 2} ry={bounds.height / 2} />
      ) : (
        <polygon points={selection.points.map((point) => `${point.x},${point.y}`).join(' ')} />
      )}
      {[
        [bounds.x, bounds.y],
        [bounds.x + bounds.width, bounds.y],
        [bounds.x, bounds.y + bounds.height],
        [bounds.x + bounds.width, bounds.y + bounds.height],
      ].map(([x, y], index) => <circle key={index} cx={x} cy={y} r={6} />)}
    </svg>
  );
}

function updateSelectionDraft(
  draft: SelectionDraft,
  point: ToolPointerSample,
  onSelectionChange: (selection: CanvasSelection | null) => void,
): void {
  try {
    if (draft.mode === 'lasso') {
      const last = draft.points.at(-1)!;
      if (Math.hypot(point.x - last.x, point.y - last.y) >= 2) draft.points.push(point);
      if (draft.points.length >= 3) {
        onSelectionChange(createCanvasSelection('lasso', draft.points));
      }
      return;
    }
    onSelectionChange(updateDragSelection(draft.mode, draft.start, point));
  } catch {
    onSelectionChange(null);
  }
}

function sampleFromPointer(
  event: ReactPointerEvent<HTMLDivElement>,
  stage: HTMLDivElement,
  snapshot: BroadcastSnapshot,
  viewport: CanvasViewport,
  snap: SnapSettings,
): ToolPointerSample {
  const rect = stage.getBoundingClientRect();
  const canvasPoint = screenToCanvas(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    viewport,
    { width: rect.width, height: rect.height },
    snapshot.canvas,
  );
  const point = snapCanvasPoint(canvasPoint, snap);
  return normalizePointerSample({
    ...point,
    pressure: event.pressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    timestamp: event.timeStamp,
    pointerType: event.pointerType,
  });
}

function screenPointerSample(event: ReactPointerEvent<HTMLDivElement>): ToolPointerSample {
  return normalizePointerSample({
    x: event.clientX,
    y: event.clientY,
    pressure: event.pressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    timestamp: event.timeStamp,
    pointerType: event.pointerType,
  });
}

function releasePointer(event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function drawImmediatePreview(
  canvas: HTMLCanvasElement | null,
  from: ToolPointerSample,
  to: ToolPointerSample,
  brush: BrushSettings,
  toolId: 'pen' | 'eraser',
): void {
  if (canvas === null) return;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.save();
  context.globalCompositeOperation = toolId === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = brush.color;
  context.globalAlpha = brush.opacity * (brush.pressureOpacity ? Math.max(0.05, to.pressure) : 1);
  context.lineWidth = brush.size * (brush.pressureSize ? Math.max(0.05, to.pressure) : 1);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}
