import { expect, it } from 'vitest';
import {
  createProjectAssetLibrary,
  importProjectAsset,
} from '../src/index.js';

it('Asset IDに標準SHA-256値を使用する', () => {
  const source = '<svg viewBox="0 0 1 1"></svg>';
  const result = importProjectAsset(createProjectAssetLibrary(), {
    fileName: 'one.svg',
    declaredMime: 'image/svg+xml',
    bytes: new TextEncoder().encode(source),
  });
  expect(result.asset.sha256).toBe(
    'c52d3e2a08f806f17070bd9643aba1d05a9e1beba839cbeb7038fb5985d2813b',
  );
  expect(result.asset.id).toBe(`asset:${result.asset.sha256}`);
});
