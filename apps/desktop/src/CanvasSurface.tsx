import {
  CanvasRenderer,
  createDefaultToolRegistry,
  normalizePointerSample,
  panViewport,
  screenToCanvas,
  snapCanvasPoint,
  viewportTransformCss,
  zoomViewportAt,
  type BrushSettings,
  type CanvasToolContext,
  type CanvasToolId,
  type CanvasToolResult,
  type CanvasToolSession,
  type CanvasViewport,
  type RenderMetrics,
  type SnapSettings,
  type ToolPointerSample,
} from '@live-board/canvas-engine';
import type { BroadcastSnapshot } from '@live-board/obs-protocol';
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import './canvas-surface.css';

interface CanvasSurfaceProps {
  snapshot: BroadcastSnapshot;
  toolId: CanvasToolId;
  brush: BrushSettings;
  viewport: CanvasViewport;
  snap: SnapSettings;
  guidesVisible: boolean;
  gridVisible: boolean;
  onViewportChange(viewport: CanvasViewport): void;
  onToolResult(result: Exclude<CanvasToolResult, null>): void;
  onRenderMetrics(metrics: RenderMetrics): void;
}

interface ActivePointer {
  pointerId: number;
  session: CanvasToolSession;
  lastCanvasSample: ToolPointerSample;
}

const toolRegistry = createDefaultToolRegistry();

export function CanvasSurface({
  snapshot,
  toolId,
  brush,
  viewport,
  snap,
  guidesVisible,
  gridVisible,
  onViewportChange,
  onToolResult,
  onRenderMetrics,
}: CanvasSurfaceProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef(new CanvasRenderer());
  const activePointerRef = useRef<ActivePointer | null>(null);
  const tool = useMemo(() => toolRegistry.get(toolId), [toolId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    onRenderMetrics(rendererRef.current.render(canvas, snapshot));
  }, [snapshot, onRenderMetrics]);

  const canvasStyle = {
    width: `${snapshot.canvas.width}px`,
    height: `${snapshot.canvas.height}px`,
    transform: viewportTransformCss(viewport, snapshot.canvas),
    cursor: tool.cursor,
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
          : rendererRef.current.sampleColor(canvas, point.x, point.y);
      },
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activePointerRef.current !== null || event.button !== 0) return;
    const stage = stageRef.current;
    if (stage === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvasSample = sampleFromPointer(event, stage, snapshot, viewport, snap);
    const toolSample = toolId === 'pan'
      ? normalizePointerSample({
          x: event.clientX,
          y: event.clientY,
          pressure: event.pressure,
          tiltX: event.tiltX,
          tiltY: event.tiltY,
          timestamp: event.timeStamp,
          pointerType: event.pointerType,
        })
      : canvasSample;
    activePointerRef.current = {
      pointerId: event.pointerId,
      session: tool.begin(toolSample, createToolContext()),
      lastCanvasSample: canvasSample,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const active = activePointerRef.current;
    const stage = stageRef.current;
    if (active === null || active.pointerId !== event.pointerId || stage === null) return;
    const canvasSample = sampleFromPointer(event, stage, snapshot, viewport, snap);
    const toolSample = toolId === 'pan'
      ? normalizePointerSample({
          x: event.clientX,
          y: event.clientY,
          pressure: event.pressure,
          tiltX: event.tiltX,
          tiltY: event.tiltY,
          timestamp: event.timeStamp,
          pointerType: event.pointerType,
        })
      : canvasSample;
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
    const active = activePointerRef.current;
    const stage = stageRef.current;
    if (active === null || active.pointerId !== event.pointerId || stage === null) return;
    const canvasSample = sampleFromPointer(event, stage, snapshot, viewport, snap);
    const toolSample = toolId === 'pan'
      ? normalizePointerSample({
          x: event.clientX,
          y: event.clientY,
          pressure: event.pressure,
          tiltX: event.tiltX,
          tiltY: event.tiltY,
          timestamp: event.timeStamp,
          pointerType: event.pointerType,
        })
      : canvasSample;
    const result = tool.end(active.session, toolSample, createToolContext());
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (result !== null) onToolResult(result);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    const active = activePointerRef.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    tool.cancel(active.session);
    activePointerRef.current = null;
    const canvas = canvasRef.current;
    if (canvas !== null) onRenderMetrics(rendererRef.current.render(canvas, snapshot));
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
              <span
                key={`x-${x}`}
                className="canvas-guide vertical"
                style={{ left: `${x}px` }}
                aria-hidden="true"
              />
            ))
          : null}
        {guidesVisible
          ? snap.guideY.map((y) => (
              <span
                key={`y-${y}`}
                className="canvas-guide horizontal"
                style={{ top: `${y}px` }}
                aria-hidden="true"
              />
            ))
          : null}
      </div>
    </div>
  );
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
  context.globalCompositeOperation =
    toolId === 'eraser' ? 'destination-out' : 'source-over';
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
