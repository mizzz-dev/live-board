import { readFile, writeFile, unlink } from 'node:fs/promises';

const path = 'README.md';
let content = await readFile(path, 'utf8');

function replaceOnce(before, after) {
  if (!content.includes(before)) {
    throw new Error(`README更新対象が見つかりません: ${before.slice(0, 100)}`);
  }
  content = content.replace(before, after);
}

replaceOnce(
  '- WebSocket Snapshotから画像data URLを除外\n- base revision付きLayer差分転送と欠番時のフルSnapshot再同期',
  '- WebSocket Snapshotから画像data URLを除外\n- RendererからMainへの画像bytes一回登録とsourceなしSnapshot descriptor\n- registry解放時のAsset再登録と同revision再試行\n- base revision付きLayer差分転送と欠番時のフルSnapshot再同期',
);

replaceOnce(
  '- 詳細は[画像Assetのloopback HTTP配信設計](docs/asset-http-delivery.md)を参照してください。\n\n### OBS向けLayer差分転送',
  `- 詳細は[画像Assetのloopback HTTP配信設計](docs/asset-http-delivery.md)を参照してください。

### Renderer–Main間の画像Asset登録

- 画像bytesは\`broadcast:register-assets\`でSHA-256単位に登録します。
- 通常の\`broadcast:publish-snapshot\`にはdata URL、HTTP URL、ファイル名、ローカルパスを含めません。
- publish IPCはLayer DTOと現在のAsset descriptorだけを送信します。
- MainはUint8Array、byteLength、SHA-256、MIME、寸法、sanitized状態を再検証します。
- 同じ画像を参照する次revisionではbytesを再送しません。
- registryから解放済みの場合は現在Assetを再登録し、同revisionのpublishを1回だけ再試行します。
- 詳細は[Renderer–Main Asset一回登録設計](docs/ipc-asset-registration.md)を参照してください。

### OBS向けLayer差分転送`,
);

replaceOnce(
  '- Desktop RendererからElectron MainへSnapshotを渡すIPCでは、参照Assetのinline data URLを引き続き使用します。\n- OBS BridgeからOverlayへ送るWebSocket Snapshotには画像data URLを含めず、loopback HTTP Asset URLへ変換します。',
  '- Desktop RendererからElectron Mainへの通常publish IPCはsourceなしAsset descriptorを使用します。画像bytesはSHA-256単位の初回登録または解放後の再登録時だけ送信します。\n- RendererはProjectAssetLibrary内のinline data URLを登録時にUint8Arrayへ変換するため、初回登録時のBase64 decodeとstructured cloneは残ります。\n- RendererとMainの登録済み状態は常時同期せず、未登録エラー時の1回再登録で収束させます。\n- OBS BridgeからOverlayへ送るWebSocket Snapshotには画像data URLを含めず、loopback HTTP Asset URLへ変換します。',
);

replaceOnce(
  '`pnpm test:e2e`はDesktop RendererとOverlayのproduction buildをVite Previewで起動し、Page操作、Layer操作、Pointer描画、画像取り込み、SVG拒否、Asset重複排除、選択変形、描画Undo / Redo、Viewport操作、配信ショートカット、配信固定、危険CSS拒否、100ページ一覧、性能計測、Preview状態を確認します。\nOBS Bridgeのtoken認証、snapshot push、`layer.updated`、再接続収束、静的ファイル配信はVitestで確認します。',
  '`pnpm test:e2e`はDesktop RendererとOverlayのproduction buildをVite Previewで起動し、Page操作、Layer操作、Pointer描画、画像取り込み、SVG拒否、Asset重複排除、選択変形、描画Undo / Redo、Viewport操作、配信ショートカット、配信固定、危険CSS拒否、100ページ一覧、性能計測、Preview状態を確認します。\nOBS Bridgeのtoken認証、Asset一回登録、sourceなしdescriptor公開、`layer.patch`、再接続収束、静的ファイル配信はVitestで確認します。',
);

replaceOnce(
  '- [画像Assetのloopback HTTP配信](docs/asset-http-delivery.md)\n- [OBS Layer差分転送](docs/obs-layer-patch.md)',
  '- [画像Assetのloopback HTTP配信](docs/asset-http-delivery.md)\n- [Renderer–Main Asset一回登録](docs/ipc-asset-registration.md)\n- [OBS Layer差分転送](docs/obs-layer-patch.md)',
);

await writeFile(path, content);
for (const removable of [
  'scripts/update-readme-ipc-assets.mjs',
  '.github/workflows/update-readme-ipc-assets.yml',
]) {
  await unlink(removable).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
