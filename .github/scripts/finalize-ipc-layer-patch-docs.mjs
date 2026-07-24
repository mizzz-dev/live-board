import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, before, after) {
  const current = await readFile(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`置換対象が見つかりません: ${path}`);
  }
  await writeFile(path, current.replace(before, after));
}

await replaceExact(
  'README.md',
  'M3「保存・復旧・性能・配信操作性」に加え、画像Assetの認証付きloopback HTTP分離配信まで実装しています。',
  'M3「保存・復旧・性能・配信操作性」に加え、画像Asset分離配信とRenderer–Main／OBS OverlayのLayer差分転送まで実装しています。',
);
await replaceExact(
  'README.md',
  `- RendererからMainへの画像bytes一回登録とsourceなしSnapshot descriptor\n- registry解放時のAsset再登録と同revision再試行\n- base revision付きLayer差分転送と欠番時のフルSnapshot再同期`,
  `- RendererからMainへの画像bytes一回登録とsourceなしSnapshot descriptor\n- registry解放時のAsset再登録と同revision再試行\n- RendererからMainへのbase revision付きLayer差分転送\n- Main再起動・base revision不一致時の同revisionフルSnapshot復旧\n- base revision付きOBS Layer差分転送と欠番時のフルSnapshot再同期`,
);
await replaceExact(
  'README.md',
  `- 詳細は[Renderer–Main Asset一回登録設計](docs/ipc-asset-registration.md)を参照してください。\n\n### OBS向けLayer差分転送`,
  `- 詳細は[Renderer–Main Asset一回登録設計](docs/ipc-asset-registration.md)を参照してください。\n\n### Renderer–Main間のLayer差分転送\n\n- 同一ページ内のLayer追加・更新・削除・並び替えは\`broadcast:publish-layer-patch\`で送信します。\n- Rendererは前回成功Snapshotからpatchを生成し、フルSnapshotより小さい場合だけ差分送信します。\n- Mainは最後に公開成功したsourceなしSnapshotを1件だけ保持し、patch適用後の完成Snapshotを再検証します。\n- Page、Canvas、Overlay設定変更、初回接続、patchがフル以上の場合はフルSnapshotを送ります。\n- Main再起動またはbase revision不一致時は、同revisionのフルSnapshotへ1回だけフォールバックします。\n- Bridge公開失敗時はMainの保持Snapshotとlatest revisionを更新しません。\n- 詳細は[Renderer–Main Layer差分転送設計](docs/ipc-layer-patch.md)を参照してください。\n\n### OBS向けLayer差分転送`,
);
await replaceExact(
  'README.md',
  `- OBSのLayer DTO差分転送は実装済みです。Raster stroke／Fill、画像タイル、Asset binaryの差分は後続対象です。`,
  `- Renderer→MainとOBS Bridge→OverlayのLayer DTO差分転送は実装済みです。Raster stroke／Fill内部、画像タイル、Asset binaryの差分は後続対象です。`,
);
await replaceExact(
  'README.md',
  `- [Renderer–Main Asset一回登録](docs/ipc-asset-registration.md)\n- [OBS Layer差分転送](docs/obs-layer-patch.md)`,
  `- [Renderer–Main Asset一回登録](docs/ipc-asset-registration.md)\n- [Renderer–Main Layer差分転送](docs/ipc-layer-patch.md)\n- [OBS Layer差分転送](docs/obs-layer-patch.md)`,
);

await replaceExact(
  'apps/desktop/test/broadcast-ipc-layer-patch.test.ts',
  `    expect(patchBytes).toBeLessThan(fullBytes * 0.1);`,
  `    console.info('IPC layer patch payload metric', {\n      fullBytes,\n      patchBytes,\n      ratio: patchBytes / fullBytes,\n    });\n    expect(patchBytes).toBeLessThan(fullBytes * 0.1);`,
);
