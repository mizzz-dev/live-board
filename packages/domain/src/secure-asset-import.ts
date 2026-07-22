import {
  AssetValidationError,
  importProjectAsset as importValidatedProjectAsset,
  type AssetImportInput,
  type AssetImportResult,
  type ProjectAssetLibrary,
} from './assets.js';

export function importProjectAsset(
  library: ProjectAssetLibrary,
  input: AssetImportInput,
): AssetImportResult {
  if (isDeclaredSvg(input)) {
    const header = asciiPreview(input.bytes, 16 * 1024);
    if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(header)) {
      throw new AssetValidationError(
        'SVG_UNSAFE_DOCUMENT',
        'DOCTYPE・ENTITY・外部スタイルは使用できません',
      );
    }
  }
  return importValidatedProjectAsset(library, input);
}

function isDeclaredSvg(input: AssetImportInput): boolean {
  const mime = input.declaredMime?.trim().toLowerCase();
  return mime === 'image/svg+xml' || /\.svg$/i.test(input.fileName.trim());
}

function asciiPreview(bytes: Uint8Array, maxBytes: number): string {
  const length = Math.min(bytes.length, maxBytes);
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += String.fromCharCode(bytes[index]!);
  }
  return output;
}
