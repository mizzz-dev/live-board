import type {
  RasterFill,
  RasterPoint,
  RasterStroke,
} from '@live-board/obs-protocol';
import type { Point } from './geometry.js';

export type CanvasToolId = 'pen' | 'eraser' | 'bucket' | 'eyedropper' | 'pan';
export type PointerKind = 'mouse' | 'pen' | 'touch';

export interface BrushSettings {
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  spacing: number;
  smoothing: number;
  taperStart: number;
  taperEnd: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  fillTolerance: number;
}

export interface ToolPointerSample extends Point {
  pressure: number;
  tiltX: number;
  tiltY: number;
  timestamp: number;
  pointerType: PointerKind;
}

export type CanvasToolResult =
  | { type: 'stroke'; stroke: RasterStroke }
  | { type: 'fill'; fill: RasterFill }
  | { type: 'color'; color: string }
  | { type: 'pan'; deltaX: number; deltaY: number }
  | null;

export interface CanvasToolSession {
  toolId: CanvasToolId;
  startedAt: ToolPointerSample;
  samples: ToolPointerSample[];
  lastScreenPoint?: Point;
}

export interface CanvasToolContext {
  settings: BrushSettings;
  createId(prefix: string): string;
  sampleColor(point: Point): string | null;
}

export interface CanvasTool {
  readonly id: CanvasToolId;
  readonly cursor: string;
  begin(sample: ToolPointerSample, context: CanvasToolContext): CanvasToolSession;
  move(
    session: CanvasToolSession,
    sample: ToolPointerSample,
    context: CanvasToolContext,
  ): CanvasToolResult;
  end(
    session: CanvasToolSession,
    sample: ToolPointerSample,
    context: CanvasToolContext,
  ): CanvasToolResult;
  cancel(session: CanvasToolSession): void;
}

export class CanvasToolRegistry {
  private readonly tools = new Map<CanvasToolId, CanvasTool>();

  register(tool: CanvasTool): this {
    if (this.tools.has(tool.id)) {
      throw new Error(`Canvas tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
    return this;
  }

  get(toolId: CanvasToolId): CanvasTool {
    const tool = this.tools.get(toolId);
    if (tool === undefined) throw new Error(`Canvas tool not found: ${toolId}`);
    return tool;
  }

  list(): CanvasTool[] {
    return [...this.tools.values()];
  }
}

export function createDefaultToolRegistry(): CanvasToolRegistry {
  return new CanvasToolRegistry()
    .register(createStrokeTool('pen'))
    .register(createStrokeTool('eraser'))
    .register(createBucketTool())
    .register(createEyedropperTool())
    .register(createPanTool());
}

export function normalizePointerSample(input: {
  x: number;
  y: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  timestamp?: number;
  pointerType?: string;
}): ToolPointerSample {
  return {
    x: finite(input.x),
    y: finite(input.y),
    pressure: normalizePressure(input.pressure, input.pointerType),
    tiltX: clamp(finite(input.tiltX ?? 0), -90, 90),
    tiltY: clamp(finite(input.tiltY ?? 0), -90, 90),
    timestamp: Math.max(0, finite(input.timestamp ?? Date.now())),
    pointerType: normalizePointerType(input.pointerType),
  };
}

export function normalizePressure(
  pressure: number | undefined,
  pointerType: string | undefined,
): number {
  if (pointerType !== 'pen') {
    return pressure === undefined || pressure === 0 ? 0.5 : clamp(pressure, 0, 1);
  }
  return pressure === undefined || !Number.isFinite(pressure)
    ? 0.5
    : clamp(pressure, 0, 1);
}

export function pressureFactor(pressure: number): number {
  return Math.max(0.05, clamp(pressure, 0, 1));
}

export function smoothPointerSamples(
  samples: readonly ToolPointerSample[],
  smoothing: number,
): ToolPointerSample[] {
  const radius = Math.round(clamp(smoothing, 0, 1) * 8);
  if (radius === 0 || samples.length < 3) return samples.map((sample) => ({ ...sample }));
  return samples.map((sample, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(samples.length - 1, index + radius);
    const window = samples.slice(start, end + 1);
    const count = window.length;
    return {
      ...sample,
      x: window.reduce((sum, value) => sum + value.x, 0) / count,
      y: window.reduce((sum, value) => sum + value.y, 0) / count,
      pressure: window.reduce((sum, value) => sum + value.pressure, 0) / count,
    };
  });
}

function createStrokeTool(id: 'pen' | 'eraser'): CanvasTool {
  return {
    id,
    cursor: 'crosshair',
    begin(sample) {
      return { toolId: id, startedAt: sample, samples: [sample] };
    },
    move(session, sample) {
      session.samples.push(sample);
      return null;
    },
    end(session, sample, context) {
      if (session.samples.at(-1)?.timestamp !== sample.timestamp) {
        session.samples.push(sample);
      }
      const settings = context.settings;
      const points = smoothPointerSamples(session.samples, settings.smoothing).map(toRasterPoint);
      return {
        type: 'stroke',
        stroke: {
          id: context.createId('stroke'),
          tool: id,
          pointerType: session.startedAt.pointerType,
          color: settings.color,
          size: settings.size,
          opacity: settings.opacity,
          hardness: settings.hardness,
          spacing: settings.spacing,
          smoothing: settings.smoothing,
          taperStart: settings.taperStart,
          taperEnd: settings.taperEnd,
          pressureSize: settings.pressureSize,
          pressureOpacity: settings.pressureOpacity,
          points,
        },
      };
    },
    cancel(session) {
      session.samples.splice(0);
    },
  };
}

function createBucketTool(): CanvasTool {
  return {
    id: 'bucket',
    cursor: 'cell',
    begin(sample) {
      return { toolId: 'bucket', startedAt: sample, samples: [sample] };
    },
    move() {
      return null;
    },
    end(session, _sample, context) {
      return {
        type: 'fill',
        fill: {
          id: context.createId('fill'),
          x: session.startedAt.x,
          y: session.startedAt.y,
          color: context.settings.color,
          opacity: context.settings.opacity,
          tolerance: context.settings.fillTolerance,
        },
      };
    },
    cancel() {},
  };
}

function createEyedropperTool(): CanvasTool {
  return {
    id: 'eyedropper',
    cursor: 'copy',
    begin(sample) {
      return { toolId: 'eyedropper', startedAt: sample, samples: [sample] };
    },
    move() {
      return null;
    },
    end(session, _sample, context) {
      const color = context.sampleColor(session.startedAt);
      return color === null ? null : { type: 'color', color };
    },
    cancel() {},
  };
}

function createPanTool(): CanvasTool {
  return {
    id: 'pan',
    cursor: 'grab',
    begin(sample) {
      return {
        toolId: 'pan',
        startedAt: sample,
        samples: [sample],
        lastScreenPoint: { x: sample.x, y: sample.y },
      };
    },
    move(session, sample) {
      const previous = session.lastScreenPoint ?? session.startedAt;
      session.lastScreenPoint = { x: sample.x, y: sample.y };
      return {
        type: 'pan',
        deltaX: sample.x - previous.x,
        deltaY: sample.y - previous.y,
      };
    },
    end() {
      return null;
    },
    cancel() {},
  };
}

function toRasterPoint(sample: ToolPointerSample): RasterPoint {
  return {
    x: sample.x,
    y: sample.y,
    pressure: sample.pressure,
    tiltX: sample.tiltX,
    tiltY: sample.tiltY,
    timestamp: sample.timestamp,
  };
}

function normalizePointerType(pointerType: string | undefined): PointerKind {
  return pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse';
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('CANVAS_INVALID_POINTER_SAMPLE');
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
