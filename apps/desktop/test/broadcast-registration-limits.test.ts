import { describe, expect, it } from 'vitest';
import { parseRegisterBroadcastAssetsRequest } from '../electron/contracts.js';

function descriptor(index: number, bytes: Uint8Array) {
  return {
    id: `asset:limit-${index}`,
    sha256: index.toString(16).padStart(64, '0'),
    mime: 'image/png' as const,
    width: 1,
    height: 1,
    byteLength: bytes.byteLength,
    animated: false as const,
    sanitized: false,
    bytes,
  };
}

describe('Broadcast Asset登録IPC上限', () => {
  it('合計256MiB超過をAsset複製前の事前検証で拒否する', () => {
    const sharedBytes = new Uint8Array(25 * 1024 * 1024);
    const assets = Array.from({ length: 11 }, (_, index) =>
      descriptor(index + 1, sharedBytes),
    );

    expect(() =>
      parseRegisterBroadcastAssetsRequest({
        requestId: 'register_over_limit',
        assets,
      }),
    ).toThrow('IPC_BROADCAST_ASSET_TOTAL_LIMIT');
  });

  it('登録件数256件超過を拒否する', () => {
    const bytes = new Uint8Array([1]);
    const assets = Array.from({ length: 257 }, (_, index) =>
      descriptor(index + 1, bytes),
    );

    expect(() =>
      parseRegisterBroadcastAssetsRequest({
        requestId: 'register_count_limit',
        assets,
      }),
    ).toThrow('IPC_INVALID_BROADCAST_ASSETS');
  });

  it('Uint8Array以外を個別parserによる複製前に拒否する', () => {
    expect(() =>
      parseRegisterBroadcastAssetsRequest({
        requestId: 'register_invalid_bytes',
        assets: [
          {
            ...descriptor(1, new Uint8Array([1])),
            bytes: [1],
          },
        ],
      }),
    ).toThrow('IPC_INVALID_BROADCAST_ASSETS');
  });
});
