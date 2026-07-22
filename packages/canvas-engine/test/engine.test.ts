import { describe, expect, it } from 'vitest';
import {
  CanvasToolRegistry,
  canvasToScreen,
  createDefaultToolRegistry,
  floodFillPixels,
  normalizePointerSample,
  normalizePressure,
  pressureFactor,
  screenToCanvas,
  snapCanvasPoint,
  zoomViewportAt,
  type CanvasTool,
  type CanvasViewport,
} from '../src/index.js';

const viewport: CanvasViewport = {
  zoom: 1.5,
  panX: 40,
  panY: -20,
  rotation: 30,
  flipX: false,
};

const viewportSize = { width: 1280, height: 720 };
const canvasSize = { width: 1920, height: 1080 };

describe('Canvas geometry', () => {
  it('ズーム・回転・パン中も座標を往復できる', () => {
    const canvasPoint = { x: 512.25, y: 333.75 };
    const screenPoint = canvasToScreen(canvasPoint, viewport, viewportSize, canvasSize);
    const restored = screenToCanvas(screenPoint, viewport, viewportSize, canvasSize);
    expect(restored.x).toBeCloseTo(canvasPoint.x, 6);
    expect(restored.y).toBeCloseTo(canvasPoint.y, 6);
  });

  it('カーソル位置を維持してズームできる', () => {
    const cursor = { x: 320, y: 240 };
    const before = screenToCanvas(cursor, viewport, viewportSize, canvasSize);
    const zoomed = zoomViewportAt(viewport, cursor, 3, viewportSize, canvasSize);
    const after = screenToCanvas(cursor, zoomed, viewportSize, canvasSize);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('グリッドとガイドへスナップできる', () => {
    expect(
      snapCanvasPoint(
        { x: 98, y: 203 },
        {
          enabled: true,
          gridSize: 50,
          guideX: [100],
          guideY: [200],
          threshold: 4,
        },
      ),
    ).toEqual({ x: 100, y: 200 });
  });
});

describe('Pointer pressure', () => {
  it('penのpressure 0・1を保持する', () => {
    expect(normalizePressure(0, 'pen')).toBe(0);
    expect(normalizePressure(1, 'pen')).toBe(1);
    expect(pressureFactor(0)).toBe(0.05);
    expect(pressureFactor(1)).toBe(1);
  });

  it('pressure未提供のマウスは安全な既定値を使う', () => {
    expect(normalizePressure(undefined, 'mouse')).toBe(0.5);
    expect(
      normalizePointerSample({ x: 10, y: 20, pointerType: 'mouse' }).pressure,
    ).toBe(0.5);
  });
});

describe('Flood fill', () => {
  it('境界の内側だけを塗りつぶす', () => {
    const width = 5;
    const height = 5;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels[index * 4 + 3] = 255;
    }
    for (let x = 0; x < width; x += 1) {
      const top = x * 4;
      const bottom = ((height - 1) * width + x) * 4;
      pixels[top] = pixels[top + 1] = pixels[top + 2] = 255;
      pixels[bottom] = pixels[bottom + 1] = pixels[bottom + 2] = 255;
    }
    for (let y = 0; y < height; y += 1) {
      for (const x of [0, width - 1]) {
        const offset = (y * width + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
      }
    }
    const changed = floodFillPixels(
      pixels,
      width,
      height,
      2,
      2,
      { r: 255, g: 0, b: 0, a: 255 },
      0,
    );
    expect(changed).toBe(9);
    expect(pixels[(2 * width + 2) * 4]).toBe(255);
    expect(pixels[0]).toBe(255);
  });
});

describe('CanvasTool registry', () => {
  it('基本ツールを条件分岐なしで解決できる', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.list().map((tool) => tool.id)).toEqual([
      'pen',
      'eraser',
      'bucket',
      'eyedropper',
      'pan',
    ]);
    expect(registry.get('pen').cursor).toBe('crosshair');
  });

  it('重複ツール登録を拒否する', () => {
    const tool: CanvasTool = {
      id: 'pen',
      cursor: 'crosshair',
      begin(sample) {
        return { toolId: 'pen', startedAt: sample, samples: [sample] };
      },
      move() { return null; },
      end() { return null; },
      cancel() {},
    };
    const registry = new CanvasToolRegistry().register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });
});
