import { describe, expect, it } from 'vitest';
import {
  AssetValidationError,
  createProjectAssetLibrary,
  importProjectAsset,
  sanitizeSvg,
} from '../src/index.js';

const safeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#336699" />
</svg>`;

describe('ProjectAsset', () => {
  it('同一ハッシュ・別名ファイルを1件のバイナリとして保持する', () => {
    const bytes = utf8(safeSvg);
    const first = importProjectAsset(createProjectAssetLibrary(), {
      fileName: 'cover.svg',
      declaredMime: 'image/svg+xml',
      bytes,
      createdAt: '2026-07-22T00:00:00.000Z',
    });
    const second = importProjectAsset(first.library, {
      fileName: 'same-image.svg',
      declaredMime: 'image/svg+xml',
      bytes,
      createdAt: '2026-07-22T00:00:01.000Z',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.library.assets).toHaveLength(1);
    expect(second.library.totalBytes).toBe(first.library.totalBytes);
    expect(second.asset.fileNames).toEqual(['cover.svg', 'same-image.svg']);
  });

  it('SVGのscript・event属性・foreignObject・外部URLを除去する', () => {
    const source = `
      <svg viewBox="0 0 100 100" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://example.com" /></foreignObject>
        <image href="https://example.com/x.png" width="10" height="10" />
        <rect width="100" height="100" fill="url(https://example.com/a.svg#x)" onclick="x()" />
      </svg>`;
    const sanitized = sanitizeSvg(source);
    expect(sanitized).not.toMatch(/script|foreignObject|iframe|onload|onclick/i);
    expect(sanitized).not.toContain('https://');
    expect(sanitized).toContain('<rect');
  });

  it('DOCTYPE・ENTITYを含むSVGを拒否する', () => {
    expect(() => sanitizeSvg(`<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 1 1"><text>&xxe;</text></svg>`))
      .toThrowError(AssetValidationError);
  });

  it('拡張子・MIME・シグネチャの偽装を拒否する', () => {
    expect(() => importProjectAsset(createProjectAssetLibrary(), {
      fileName: 'fake.png',
      declaredMime: 'image/png',
      bytes: utf8(safeSvg),
    })).toThrowError(/MIME|拡張子/);
  });

  it('破損PNGと超高総ピクセル画像を拒否する', () => {
    expect(() => importProjectAsset(createProjectAssetLibrary(), {
      fileName: 'broken.png',
      declaredMime: 'image/png',
      bytes: pngBytes(1920, 1080, false),
    })).toThrowError(/PNG/);

    expect(() => importProjectAsset(createProjectAssetLibrary(), {
      fileName: 'huge.png',
      declaredMime: 'image/png',
      bytes: pngBytes(16_384, 16_384, true),
    })).toThrowError(/ピクセル/);
  });

  it('透明4K PNGを寸法付きAssetとして登録できる', () => {
    const result = importProjectAsset(createProjectAssetLibrary(), {
      fileName: 'transparent-4k.png',
      declaredMime: 'image/png',
      bytes: pngBytes(3840, 2160, true),
    });
    expect(result.asset.mime).toBe('image/png');
    expect(result.asset.width).toBe(3840);
    expect(result.asset.height).toBe(2160);
    expect(result.asset.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

function pngBytes(width: number, height: number, complete: boolean): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set(utf8('IHDR'), 12);
  writeU32(bytes, 16, width);
  writeU32(bytes, 20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  if (complete) bytes.set(utf8('IEND'), 37);
  return complete ? bytes : bytes.slice(0, 33);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
