export type ProjectAssetMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/svg+xml';

export interface ProjectAsset {
  id: string;
  sha256: string;
  mime: ProjectAssetMime;
  width: number;
  height: number;
  byteLength: number;
  dataUrl: string;
  fileNames: string[];
  animated: false;
  sanitized: boolean;
  createdAt: string;
}

export interface ProjectAssetLibrary {
  assets: ProjectAsset[];
  totalBytes: number;
}

export interface AssetImportInput {
  fileName: string;
  declaredMime?: string;
  bytes: Uint8Array;
  createdAt?: string;
}

export interface AssetImportResult {
  library: ProjectAssetLibrary;
  asset: ProjectAsset;
  duplicate: boolean;
}

export type AssetErrorCode =
  | 'ASSET_EMPTY'
  | 'ASSET_TOO_LARGE'
  | 'ASSET_FORMAT_UNSUPPORTED'
  | 'ASSET_MIME_MISMATCH'
  | 'ASSET_EXTENSION_MISMATCH'
  | 'ASSET_CORRUPT'
  | 'ASSET_DIMENSIONS_INVALID'
  | 'ASSET_PIXEL_LIMIT_EXCEEDED'
  | 'ASSET_LIBRARY_LIMIT_EXCEEDED'
  | 'SVG_UNSAFE_DOCUMENT'
  | 'SVG_ROOT_REQUIRED'
  | 'SVG_DIMENSIONS_REQUIRED';

export class AssetValidationError extends Error {
  readonly code: AssetErrorCode;

  constructor(code: AssetErrorCode, message: string) {
    super(message);
    this.name = 'AssetValidationError';
    this.code = code;
  }
}

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_ASSET_DIMENSION = 16_384;
export const MAX_ASSET_PIXELS = 64 * 1024 * 1024;
export const MAX_ASSET_LIBRARY_BYTES = 256 * 1024 * 1024;
export const MAX_SVG_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, ProjectAssetMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const ALLOWED_SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'lineargradient',
  'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'image', 'title',
  'desc',
]);

const DROP_SVG_ELEMENTS = [
  'script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video',
  'canvas', 'style', 'link', 'meta',
];

const ALLOWED_SVG_ATTRIBUTES = new Set([
  'id', 'xmlns', 'xmlns:xlink', 'viewbox', 'preserveaspectratio', 'x', 'y',
  'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'd', 'points', 'transform', 'opacity', 'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'font-family',
  'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
  'gradienttransform', 'patternunits', 'patterntransform', 'clip-path', 'mask',
  'href', 'xlink:href',
]);

export function createProjectAssetLibrary(): ProjectAssetLibrary {
  return { assets: [], totalBytes: 0 };
}

export function cloneProjectAssetLibrary(
  library: ProjectAssetLibrary,
): ProjectAssetLibrary {
  return {
    assets: library.assets.map((asset) => ({
      ...asset,
      fileNames: [...asset.fileNames],
    })),
    totalBytes: library.totalBytes,
  };
}

export function importProjectAsset(
  library: ProjectAssetLibrary,
  input: AssetImportInput,
): AssetImportResult {
  if (input.bytes.byteLength < 1) {
    throw assetError('ASSET_EMPTY', '画像ファイルが空です');
  }
  if (input.bytes.byteLength > MAX_ASSET_BYTES) {
    throw assetError('ASSET_TOO_LARGE', '画像ファイルが25MBを超えています');
  }

  const detected = detectAsset(input.bytes);
  assertDeclaredMime(input.declaredMime, detected.mime);
  assertFileExtension(input.fileName, detected.mime);

  const storedBytes = detected.mime === 'image/svg+xml'
    ? utf8ToBytes(sanitizeSvg(bytesToUtf8(input.bytes)))
    : new Uint8Array(input.bytes);
  const dimensions = detected.mime === 'image/svg+xml'
    ? readSvgDimensions(bytesToUtf8(storedBytes))
    : detected;
  assertDimensions(dimensions.width, dimensions.height);

  const sha256 = sha256Hex(storedBytes);
  const next = cloneProjectAssetLibrary(library);
  const existing = next.assets.find((asset) => asset.sha256 === sha256);
  const normalizedName = normalizeFileName(input.fileName);
  if (existing !== undefined) {
    if (!existing.fileNames.includes(normalizedName)) {
      existing.fileNames.push(normalizedName);
    }
    return { library: next, asset: { ...existing, fileNames: [...existing.fileNames] }, duplicate: true };
  }

  if (next.totalBytes + storedBytes.byteLength > MAX_ASSET_LIBRARY_BYTES) {
    throw assetError(
      'ASSET_LIBRARY_LIMIT_EXCEEDED',
      'プロジェクトの画像アセット合計が256MBを超えます',
    );
  }

  const asset: ProjectAsset = {
    id: `asset:${sha256}`,
    sha256,
    mime: detected.mime,
    width: dimensions.width,
    height: dimensions.height,
    byteLength: storedBytes.byteLength,
    dataUrl: `data:${detected.mime};base64,${bytesToBase64(storedBytes)}`,
    fileNames: [normalizedName],
    animated: false,
    sanitized: detected.mime === 'image/svg+xml',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  next.assets.push(asset);
  next.totalBytes += asset.byteLength;
  return { library: next, asset: { ...asset, fileNames: [...asset.fileNames] }, duplicate: false };
}

export function findProjectAsset(
  library: ProjectAssetLibrary,
  assetId: string,
): ProjectAsset | null {
  const asset = library.assets.find((candidate) => candidate.id === assetId);
  return asset === undefined ? null : { ...asset, fileNames: [...asset.fileNames] };
}

export function listReferencedProjectAssets(
  library: ProjectAssetLibrary,
  assetIds: ReadonlySet<string>,
): ProjectAsset[] {
  return library.assets
    .filter((asset) => assetIds.has(asset.id))
    .map((asset) => ({ ...asset, fileNames: [...asset.fileNames] }));
}

export function sanitizeSvg(source: string): string {
  if (utf8ToBytes(source).byteLength > MAX_SVG_BYTES) {
    throw assetError('ASSET_TOO_LARGE', 'SVGが2MBを超えています');
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) {
    throw assetError('SVG_UNSAFE_DOCUMENT', 'DOCTYPE・ENTITY・外部スタイルは使用できません');
  }

  let sanitized = source.replace(/<!--[\s\S]*?-->/g, '');
  for (const element of DROP_SVG_ELEMENTS) {
    const paired = new RegExp(`<${element}\\b[\\s\\S]*?<\\/${element}\\s*>`, 'gi');
    const standalone = new RegExp(`<${element}\\b[^>]*\\/?\\s*>`, 'gi');
    sanitized = sanitized.replace(paired, '').replace(standalone, '');
  }

  const output: string[] = [];
  const tagPattern = /<\/?([A-Za-z][\w:.-]*)([^>]*)>/g;
  let cursor = 0;
  let rootSeen = false;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(sanitized)) !== null) {
    const text = sanitized.slice(cursor, match.index);
    output.push(escapeUnsafeText(text));
    cursor = tagPattern.lastIndex;

    const original = match[0];
    const closing = /^<\//.test(original);
    const selfClosing = /\/\s*>$/.test(original);
    const tagName = match[1]!.toLowerCase();
    if (!ALLOWED_SVG_ELEMENTS.has(tagName)) continue;
    if (!rootSeen) {
      if (tagName !== 'svg' || closing) {
        throw assetError('SVG_ROOT_REQUIRED', 'SVGルート要素が必要です');
      }
      rootSeen = true;
    }
    if (closing) {
      output.push(`</${canonicalSvgTagName(tagName)}>`);
      continue;
    }

    const attributes = sanitizeSvgAttributes(match[2] ?? '', tagName);
    output.push(
      `<${canonicalSvgTagName(tagName)}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}${selfClosing ? ' /' : ''}>`,
    );
  }
  output.push(escapeUnsafeText(sanitized.slice(cursor)));
  const result = output.join('').trim();
  if (!rootSeen || !/^<svg\b/i.test(result)) {
    throw assetError('SVG_ROOT_REQUIRED', 'SVGルート要素が必要です');
  }
  readSvgDimensions(result);
  return result;
}

function sanitizeSvgAttributes(source: string, tagName: string): string[] {
  const result: string[] = [];
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const rawName = match[1]!;
    const name = rawName.toLowerCase();
    const value = (match[2] ?? match[3] ?? '').trim();
    if (name.startsWith('on') || name === 'style') continue;
    if (!ALLOWED_SVG_ATTRIBUTES.has(name)) continue;
    if (!isSafeSvgAttributeValue(name, value, tagName)) continue;
    result.push(`${canonicalSvgAttributeName(name)}="${escapeAttribute(value)}"`);
  }
  return result;
}

function isSafeSvgAttributeValue(name: string, value: string, tagName: string): boolean {
  const lowered = value.replace(/\s+/g, '').toLowerCase();
  if (
    lowered.includes('javascript:') ||
    lowered.includes('vbscript:') ||
    lowered.includes('file:') ||
    lowered.includes('@import') ||
    lowered.includes('expression(') ||
    lowered.includes('http:') ||
    lowered.includes('https:') ||
    lowered.startsWith('//')
  ) return false;

  for (const match of value.matchAll(/url\(([^)]+)\)/gi)) {
    const target = match[1]!.trim().replace(/^['"]|['"]$/g, '');
    if (!/^#[A-Za-z_][\w:.-]*$/.test(target)) return false;
  }

  if (name === 'href' || name === 'xlink:href') {
    if (/^#[A-Za-z_][\w:.-]*$/.test(value)) return true;
    return tagName === 'image' && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value);
  }
  return true;
}

function readSvgDimensions(source: string): { width: number; height: number } {
  const root = /^<svg\b([^>]*)>/i.exec(source);
  if (root === null) throw assetError('SVG_ROOT_REQUIRED', 'SVGルート要素が必要です');
  const attributes = new Map<string, string>();
  for (const match of root[1]!.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? '');
  }
  const width = parseSvgLength(attributes.get('width'));
  const height = parseSvgLength(attributes.get('height'));
  if (width !== null && height !== null) return { width, height };
  const viewBox = attributes.get('viewbox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: Math.abs(viewBox[2]!), height: Math.abs(viewBox[3]!) };
  }
  throw assetError('SVG_DIMENSIONS_REQUIRED', 'SVGにはwidth/heightまたはviewBoxが必要です');
}

function detectAsset(bytes: Uint8Array): { mime: ProjectAssetMime; width: number; height: number } {
  if (isPng(bytes)) return readPng(bytes);
  if (isJpeg(bytes)) return readJpeg(bytes);
  if (isWebp(bytes)) return readWebp(bytes);
  if (isGif(bytes)) return readGif(bytes);
  const text = bytesToUtf8(bytes).replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text)) {
    const dimensions = readSvgDimensions(sanitizeSvg(text));
    return { mime: 'image/svg+xml', ...dimensions };
  }
  throw assetError('ASSET_FORMAT_UNSUPPORTED', '対応していない画像形式です');
}

function readPng(bytes: Uint8Array) {
  if (bytes.length < 33 || ascii(bytes, 12, 16) !== 'IHDR' || !containsAscii(bytes, 'IEND')) {
    throw assetError('ASSET_CORRUPT', 'PNGヘッダーまたはIENDが不正です');
  }
  return { mime: 'image/png' as const, width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function readGif(bytes: Uint8Array) {
  if (bytes.length < 14 || bytes.at(-1) !== 0x3b) {
    throw assetError('ASSET_CORRUPT', 'GIFが途中で切れています');
  }
  return { mime: 'image/gif' as const, width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function readJpeg(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw assetError('ASSET_CORRUPT', 'JPEGが途中で切れています');
  }
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { mime: 'image/jpeg' as const, height: u16be(bytes, offset + 3), width: u16be(bytes, offset + 5) };
    }
    offset += length;
  }
  throw assetError('ASSET_CORRUPT', 'JPEGの寸法情報を取得できません');
}

function readWebp(bytes: Uint8Array) {
  const declaredLength = u32le(bytes, 4) + 8;
  if (bytes.length < 30 || declaredLength > bytes.length) {
    throw assetError('ASSET_CORRUPT', 'WebP RIFFサイズが不正です');
  }
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8X') {
    return { mime: 'image/webp' as const, width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = u32le(bytes, 21);
    return { mime: 'image/webp' as const, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { mime: 'image/webp' as const, width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  throw assetError('ASSET_CORRUPT', 'WebPの寸法情報を取得できません');
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_ASSET_DIMENSION || height > MAX_ASSET_DIMENSION) {
    throw assetError('ASSET_DIMENSIONS_INVALID', `画像寸法が不正です: ${width}x${height}`);
  }
  if (width * height > MAX_ASSET_PIXELS) {
    throw assetError('ASSET_PIXEL_LIMIT_EXCEEDED', `総ピクセル数が上限を超えています: ${width * height}`);
  }
}

function assertDeclaredMime(declaredMime: string | undefined, detected: ProjectAssetMime): void {
  if (declaredMime === undefined || declaredMime === '' || declaredMime === 'application/octet-stream') return;
  const normalized = declaredMime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : declaredMime.toLowerCase();
  if (normalized !== detected) throw assetError('ASSET_MIME_MISMATCH', `MIMEが内容と一致しません: ${declaredMime}`);
}

function assertFileExtension(fileName: string, detected: ProjectAssetMime): void {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (extension === undefined) return;
  const expected = MIME_BY_EXTENSION[extension];
  if (expected !== undefined && expected !== detected) {
    throw assetError('ASSET_EXTENSION_MISMATCH', `拡張子が画像内容と一致しません: .${extension}`);
  }
}

function isPng(bytes: Uint8Array): boolean { return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value); }
function isJpeg(bytes: Uint8Array): boolean { return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; }
function isGif(bytes: Uint8Array): boolean { const header = ascii(bytes, 0, 6); return header === 'GIF87a' || header === 'GIF89a'; }
function isWebp(bytes: Uint8Array): boolean { return bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'; }
function u16be(bytes: Uint8Array, offset: number): number { return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0); }
function u16le(bytes: Uint8Array, offset: number): number { return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8); }
function u24le(bytes: Uint8Array, offset: number): number { return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16); }
function u32be(bytes: Uint8Array, offset: number): number { return (((bytes[offset] ?? 0) * 0x1000000) + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0)) >>> 0; }
function u32le(bytes: Uint8Array, offset: number): number { return (((bytes[offset + 3] ?? 0) * 0x1000000) + ((bytes[offset + 2] ?? 0) << 16) + ((bytes[offset + 1] ?? 0) << 8) + (bytes[offset] ?? 0)) >>> 0; }
function ascii(bytes: Uint8Array, start: number, end: number): string { let output = ''; for (let index = start; index < end && index < bytes.length; index += 1) output += String.fromCharCode(bytes[index]!); return output; }
function containsAscii(bytes: Uint8Array, value: string): boolean { const target = [...value].map((character) => character.charCodeAt(0)); outer: for (let index = 0; index <= bytes.length - target.length; index += 1) { for (let inner = 0; inner < target.length; inner += 1) if (bytes[index + inner] !== target[inner]) continue outer; return true; } return false; }
function parseSvgLength(value: string | undefined): number | null { if (value === undefined) return null; const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value); return match === null ? null : Number(match[1]); }
function normalizeFileName(value: string): string { const trimmed = value.trim().replace(/[\\/\0]/g, '_'); return (trimmed || 'clipboard-image').slice(0, 240); }
function canonicalSvgTagName(value: string): string { const map: Record<string,string> = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath' }; return map[value] ?? value; }
function canonicalSvgAttributeName(value: string): string { const map: Record<string,string> = { viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', patternunits: 'patternUnits', patterntransform: 'patternTransform' }; return map[value] ?? value; }
function escapeAttribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeUnsafeText(value: string): string { return value.replace(/<(?!!--)/g, '&lt;'); }
function assetError(code: AssetErrorCode, message: string): AssetValidationError { return new AssetValidationError(code, message); }

function bytesToUtf8(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]!;
    if (first < 0x80) { output += String.fromCharCode(first); continue; }
    const count = first < 0xe0 ? 1 : first < 0xf0 ? 2 : 3;
    let codePoint = first & (0x7f >> count);
    for (let continuation = 0; continuation < count; continuation += 1) {
      const next = bytes[index++];
      if (next === undefined || (next & 0xc0) !== 0x80) throw assetError('ASSET_CORRUPT', 'UTF-8が不正です');
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    output += codePoint <= 0xffff
      ? String.fromCharCode(codePoint)
      : String.fromCharCode(0xd800 + ((codePoint - 0x10000) >> 10), 0xdc00 + ((codePoint - 0x10000) & 0x3ff));
  }
  return output;
}

function utf8ToBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  return new Uint8Array(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? '=' : alphabet[c & 63];
  }
  return output;
}

function sha256Hex(bytes: Uint8Array): string {
  const constants = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  padded[paddedLength - 8] = high >>> 24;
  padded[paddedLength - 7] = high >>> 16;
  padded[paddedLength - 6] = high >>> 8;
  padded[paddedLength - 5] = high;
  padded[paddedLength - 4] = low >>> 24;
  padded[paddedLength - 3] = low >>> 16;
  padded[paddedLength - 2] = low >>> 8;
  padded[paddedLength - 1] = low;
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = u32be(padded, offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + s1 + choose + constants[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0; hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0; hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0; hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0; hash[7] = (hash[7]! + h!) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value: number, shift: number): number { return (value >>> shift) | (value << (32 - shift)); }
