import { readFile, writeFile, unlink } from 'node:fs/promises';

const path = 'README.md';
let content = await readFile(path, 'utf8');

function replaceOnce(before, after) {
  if (!content.includes(before)) {
    throw new Error(`README更新対象が見つかりません: ${before.slice(0, 80)}`);
  }
  content = content.replace(before, after);
}

replaceOnce(
  'M3「保存・復旧・性能・配信操作性」の`.liveboard`永続化、配信ショートカット、Overlayテーマ、安全なカスタムCSS、性能試験基盤まで実装しています。',
  'M3「保存・復旧・性能・配信操作性」に加え、画像Assetの認証付きloopback HTTP分離配信まで実装しています。',
);

replaceOnce(
  '- ビルド済みOverlayのloopback静的配信\n- 描画時間、Layer cache hit、OBS受信遅延の計測',
  '- ビルド済みOverlayのloopback静的配信\n- SHA-256と起動tokenを使う画像Assetのloopback HTTP配信\n- ETag / 304、immutable cache、同一hash重複排除、猶予付きAsset解放\n- WebSocket Snapshotから画像data URLを除外\n- 描画時間、Layer cache hit、OBS受信遅延の計測',
);

replaceOnce(
  '画像AssetのHTTP分離配信、OBS差分転送、タイル化、実機8時間連続試験は後続工程で実施します。',
  'OBS差分転送、画像タイル化、実機8時間連続試験は後続工程で実施します。',
);

replaceOnce(
  'Overlay URLには起動ごとに生成される接続tokenが含まれます。URLを画面やログへ表示せず、Electron Main Processから直接クリップボードへ書き込みます。',
  `Overlay URLには起動ごとに生成される接続tokenが含まれます。URLを画面やログへ表示せず、Electron Main Processから直接クリップボードへ書き込みます。

### OBS向け画像Asset配信

- Editor・保存処理では従来のinline Assetを維持します。
- OBS Bridgeは公開前にBase64、byteLength、SHA-256を再検証します。
- Overlayへ送るSnapshotでは画像data URLを認証付き相対URLへ変換します。
- Asset URLは\`/asset/<起動token>/<sha256>\`形式です。
- HTTP endpointはloopback接続、正常token、登録済みSHA-256だけを受け付けます。
- GET / HEAD、ETag / 304、immutable cacheに対応します。
- 同一SHA-256はregistryへ1件だけ保持し、未参照Assetは既定60秒の猶予後に解放します。
- registryの既定上限は256MiBです。
- 詳細は[画像Assetのloopback HTTP配信設計](docs/asset-http-delivery.md)を参照してください。`,
);

replaceOnce(
  '- OBS snapshotへ参照Assetのdata URLを含めるため、大容量画像ではsnapshotサイズが増えます。\n- 画像AssetのHTTP分離配信、差分転送、タイル化は後続の性能改善対象です。',
  '- Desktop RendererからElectron MainへSnapshotを渡すIPCでは、参照Assetのinline data URLを引き続き使用します。\n- OBS BridgeからOverlayへ送るWebSocket Snapshotには画像data URLを含めず、loopback HTTP Asset URLへ変換します。\n- Asset registryはメモリ上に保持し、既定256MiB・未参照60秒の上限と猶予を持ちます。\n- OBSのLayer差分転送、画像タイル化、ディスクバックドHTTP cacheは後続の性能改善対象です。',
);

replaceOnce(
  '- [永続化・自動保存・クラッシュ復元](docs/persistence.md)\n- [配信性能・長時間安定性試験](docs/performance.md)\n- [ロードマップ](docs/roadmap.md)',
  '- [永続化・自動保存・クラッシュ復元](docs/persistence.md)\n- [画像Assetのloopback HTTP配信](docs/asset-http-delivery.md)\n- [配信性能・長時間安定性試験](docs/performance.md)\n- [ロードマップ](docs/roadmap.md)',
);

await writeFile(path, content);
for (const removable of [
  'scripts/update-readme-asset-http.mjs',
  '.github/workflows/ivr-247-readme.yml',
  '.github/ivr-247-readme.trigger',
]) {
  await unlink(removable).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
