export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function floodFillPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  replacement: RgbaColor,
  tolerance: number,
): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height * 4 ||
    !Number.isInteger(tolerance) ||
    tolerance < 0 ||
    tolerance > 255
  ) {
    throw new Error('CANVAS_INVALID_FLOOD_FILL_INPUT');
  }
  const x = Math.floor(startX);
  const y = Math.floor(startY);
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const startIndex = (y * width + x) * 4;
  const target: RgbaColor = {
    r: pixels[startIndex]!,
    g: pixels[startIndex + 1]!,
    b: pixels[startIndex + 2]!,
    a: pixels[startIndex + 3]!,
  };
  if (matches(target, replacement, 0)) return 0;

  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let stackLength = 0;
  stack[stackLength++] = y * width + x;
  let changed = 0;

  while (stackLength > 0) {
    const pixelIndex = stack[--stackLength]!;
    if (visited[pixelIndex] === 1) continue;
    visited[pixelIndex] = 1;
    const offset = pixelIndex * 4;
    const current: RgbaColor = {
      r: pixels[offset]!,
      g: pixels[offset + 1]!,
      b: pixels[offset + 2]!,
      a: pixels[offset + 3]!,
    };
    if (!matches(current, target, tolerance)) continue;

    pixels[offset] = replacement.r;
    pixels[offset + 1] = replacement.g;
    pixels[offset + 2] = replacement.b;
    pixels[offset + 3] = replacement.a;
    changed += 1;

    const px = pixelIndex % width;
    const py = Math.floor(pixelIndex / width);
    if (px > 0) stack[stackLength++] = pixelIndex - 1;
    if (px + 1 < width) stack[stackLength++] = pixelIndex + 1;
    if (py > 0) stack[stackLength++] = pixelIndex - width;
    if (py + 1 < height) stack[stackLength++] = pixelIndex + width;
  }

  return changed;
}

export function parseHexColor(color: string, opacity = 1): RgbaColor {
  if (!/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(color)) {
    throw new Error(`CANVAS_INVALID_COLOR: ${color}`);
  }
  const alpha = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1;
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
    a: Math.round(255 * Math.min(1, Math.max(0, opacity)) * alpha),
  };
}

export function rgbaToHex(color: RgbaColor): string {
  const values = [color.r, color.g, color.b, color.a].map((value) =>
    Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0'),
  );
  return `#${values.join('').toUpperCase()}`;
}

function matches(left: RgbaColor, right: RgbaColor, tolerance: number): boolean {
  return (
    Math.abs(left.r - right.r) <= tolerance &&
    Math.abs(left.g - right.g) <= tolerance &&
    Math.abs(left.b - right.b) <= tolerance &&
    Math.abs(left.a - right.a) <= tolerance
  );
}
