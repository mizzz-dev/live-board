# Renderer–Main Layer差分転送設計

## 1. 目的

Desktop RendererからElectron Mainへ配信状態を同期する際、同一ページ内のLayer変更だけを送信し、100Layer構成で毎revision全Layerをstructured cloneする負荷を削減します。

画像Asset bytesは別の`broadcast:register-assets` IPCでSHA-256単位に登録済みであり、本設計はsourceなしAsset descriptorとLayer DTOの転送量を対象にします。

## 2. 前提

- Domainは従来どおり完全な`BroadcastSnapshot`を生成します。
- Rendererは画像Assetを登録した後、sourceなし`BroadcastSnapshotDescriptor`へ変換します。
- OBS BridgeからOverlayへの`layer.patch`は既に実装済みです。
- Electron Mainは最後に公開成功したsourceなしSnapshotを1件だけ保持します。
- Mainの保持状態は永続化しません。Main再起動後はフルSnapshotから再開します。

## 3. IPC

### 3.1 フルSnapshot

```text
broadcast:publish-snapshot
```

Page、Canvas、Overlay設定が変わった場合、基準Snapshotがない場合、またはpatchがフルSnapshot以上になる場合に使用します。

### 3.2 Layer patch

```text
broadcast:publish-layer-patch
```

```ts
interface BroadcastLayerPatchDescriptor {
  projectId: string;
  pageId: string;
  baseRevision: number;
  revision: number;
  generatedAt: string;
  upsertedLayers: BroadcastLayer[];
  removedLayerIds: string[];
  layerOrder: string[];
  assets?: BroadcastAssetDescriptor[];
}
```

Asset descriptorには`dataUrl`、HTTP `url`、`delivery`、ファイル名、ローカルパスを含めません。

## 4. Rendererの送信選択

Rendererは、同じ登録済みSHA-256集合を使う配信セッションごとに、最後に公開成功したsourceなしSnapshotを保持します。

送信手順:

1. Domain Snapshotを実行時検証する
2. 未登録Asset bytesをMainへ登録する
3. 前回成功SnapshotがあればLayer patchを生成する
4. patchとフルSnapshotをJSON byteLengthで比較する
5. patchが小さい場合だけ`broadcast:publish-layer-patch`を使用する
6. 公開成功後にだけ前回成功Snapshotを更新する

次の場合はフルSnapshotを使用します。

- 初回公開
- Page ID変更
- Page名変更
- Canvas設定変更
- Overlay設定変更
- Project変更
- Layer変更がない
- patchがフルSnapshot以上
- Preload APIが旧版でpatch methodを持たない

## 5. Mainの状態管理

`BroadcastDescriptorPublisher`が次の責務を持ちます。

- フルSnapshotの実行時検証
- Layer patchの実行時検証
- base revision・Page・Layer orderの照合
- patch適用後の完成Snapshot再検証
- OBS Bridgeへの公開
- 最後に公開成功したSnapshot 1件の保持

状態更新は次の順序です。

```text
入力検証
  ↓
patch適用・完成Snapshot検証
  ↓
OBS Bridge公開
  ↓ 成功時のみ
Main保持Snapshot更新
```

Bridge公開が失敗した場合、Mainの保持SnapshotとBridge latest revisionは更新しません。

## 6. 復旧

### 6.1 Main再起動・基準Snapshotなし

Mainは`IPC_BROADCAST_SNAPSHOT_REQUIRED`を返します。Rendererは同じrevisionのフルSnapshotを1回だけ送信します。

### 6.2 base revision不一致

Mainの保持revisionとpatchの`baseRevision`が一致しない場合、Rendererは同じrevisionのフルSnapshotへ1回だけフォールバックします。

### 6.3 Asset registry解放

MainのAsset registryから参照Assetが解放されていた場合、Rendererは現在SnapshotのAssetを全件再登録します。その後、元のpatchまたはフルSnapshot送信を再試行します。

1回の同期処理で使用する復旧回数は次のとおりです。

- Asset再登録: 最大1回
- patch→フルSnapshot: 最大1回

それでも失敗した場合は、既存のOBS revision再同期処理へエラーを返します。

## 7. セキュリティ境界

- trusted main frame以外のIPCを拒否します。
- request IDを検証します。
- Layer、revision、timestamp、Layer orderをProtocol parserで検証します。
- Asset descriptorへの`dataUrl`、URL、delivery情報の混入を拒否します。
- patch適用後にLayer treeとImage LayerのAsset参照を完成Snapshotとして再検証します。
- Rendererから送られたpatchをMainが無条件に信頼しません。

## 8. テスト

- 1Layer更新
- Layer追加・削除・並び替え
- Page・Canvas・Overlay設定変更時のフルSnapshot
- base revision不一致
- Main再起動相当の基準Snapshotなし
- 不正Layer order
- Asset source混入
- Bridge公開失敗時のMain状態不変
- 100Layer中1Layer更新のpayload比率
- Asset一回登録・再登録との回帰
- OBS Bridge→Overlay `layer.patch`との回帰

## 9. 性能基準

100Layer中1Layerだけを更新するfixtureで、Renderer→Main patch payloadがフルSnapshot payloadの10%未満であることをCIの退行防止条件とします。

この比較はUTF-8 JSON byteLengthです。Electron structured cloneの実時間、GC、Windows実機CPU、メモリコピー回数は直接測定していません。

## 10. 制約・対象外

- patchには最終Layer ID順序と現在のAsset descriptorを含むため、完全なO(変更数)ではありません。
- Layer比較とpayload比較でJSON serializationを行います。
- Raster stroke／fill内部はLayer単位の更新として送信します。
- Transferable `ArrayBuffer`、SharedArrayBufferは使用しません。
- Mainの基準Snapshotはメモリ上の1件のみで、永続化しません。
- Windows Electron＋OBS実機8時間試験は別タスクです。
