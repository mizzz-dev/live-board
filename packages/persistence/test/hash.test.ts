import { describe, expect, it } from 'vitest';
import { crc32, sha256Hex } from '../src/index.js';

const encoder = new TextEncoder();

describe('persistence hash', () => {
  it('SHA-256標準既知ベクトルと一致する', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(encoder.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('ZIPで利用するCRC32標準既知ベクトルと一致する', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });
});
