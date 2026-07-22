import { describe, expect, it } from 'vitest';
import {
  clampSelectionToCanvas,
  createCanvasSelection,
  hitTestSelection,
  moveSelection,
  rotateSelection,
  scaleSelection,
  selectionTransformDelta,
} from '../src/index.js';

describe('Canvas selection', () => {
  it('矩形・楕円・投げ縄の内外判定ができる', () => {
    const rectangle = createCanvasSelection('rectangle', [
      { x: 10, y: 20 },
      { x: 110, y: 80 },
    ]);
    const ellipse = createCanvasSelection('ellipse', [
      { x: 10, y: 20 },
      { x: 110, y: 80 },
    ]);
    const lasso = createCanvasSelection('lasso', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ]);

    expect(hitTestSelection(rectangle, { x: 100, y: 70 })).toBe(true);
    expect(hitTestSelection(ellipse, { x: 10, y: 20 })).toBe(false);
    expect(hitTestSelection(lasso, { x: 50, y: 40 })).toBe(true);
    expect(hitTestSelection(lasso, { x: 95, y: 90 })).toBe(false);
  });

  it('移動・拡大縮小・回転の差分を計算できる', () => {
    const initial = createCanvasSelection('rectangle', [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const moved = moveSelection(initial, 20, 30);
    const scaled = scaleSelection(moved, 2, 2);
    const rotated = rotateSelection(scaled, 90);
    const delta = selectionTransformDelta(initial, moved);

    expect(moved.bounds).toEqual({ x: 20, y: 30, width: 100, height: 50 });
    expect(scaled.bounds.width).toBeCloseTo(200);
    expect(rotated.bounds.width).toBeCloseTo(100);
    expect(rotated.bounds.height).toBeCloseTo(200);
    expect(delta.translateX).toBe(20);
    expect(delta.translateY).toBe(30);
  });

  it('0px選択を拒否し、キャンバス外選択を内側へ戻す', () => {
    expect(() => createCanvasSelection('rectangle', [
      { x: 10, y: 10 },
      { x: 10, y: 30 },
    ])).toThrow('SELECTION_ZERO_AREA');

    const outside = createCanvasSelection('rectangle', [
      { x: 90, y: 90 },
      { x: 140, y: 130 },
    ]);
    const clamped = clampSelectionToCanvas(outside, 100, 100);
    expect(clamped.bounds.x + clamped.bounds.width).toBeLessThanOrEqual(100);
    expect(clamped.bounds.y + clamped.bounds.height).toBeLessThanOrEqual(100);
  });

  it('不正な倍率・座標を拒否する', () => {
    const selection = createCanvasSelection('rectangle', [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(() => scaleSelection(selection, 0, 1)).toThrow('SELECTION_INVALID_SCALE');
    expect(() => moveSelection(selection, Number.POSITIVE_INFINITY, 0)).toThrow(
      'SELECTION_INVALID_TRANSLATE',
    );
  });
});
