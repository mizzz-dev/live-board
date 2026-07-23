# Renderer–Main Asset一回登録設計

## 1. 目的

Desktop RendererからElectron Mainへ配信状態を同期するたびに、同じ画像のBase64 data URLを繰り返しstructured cloneしないようにします。

画像AssetはPR #15でOBS BridgeからOverlayへの経路をloopback HTTP配信へ分離しています。しかし、RendererからMainへ渡す`broadcast:publish-snapshot`にはinline data URLが残っていたため、Image Layerを1件移動するだけでも参照中画像のBase64文字列が毎revision複製されていました。

本変更では、画像バイナリをSHA-256単位で一度登録し、通常のSnapshot更新ではsourceを持たないdescriptorだけを送ります。

## 2. IPCの責務分離

### Asset登録

```text
broadcast:register-assets
```

登録要求には次を含めます。

- Asset ID
- SHA-256
- MIME
- 幅・高さ
- byteLength
- sanitized状態
- `Uint8Array`の画像bytes

Rendererは現在プロセスで登録済みと認識しているSHA-256を保持し、未登録のAssetだけを送信します。

### Snapshot公開

```text
broadcast:publish-snapshot
```

公開要求には次を含めません。

- data URL
- HTTP URL
- ファイル名
- ローカルパス
- Asset bytes

Snapshot内には、Layerが参照する現在のAsset descriptorだけを含めます。

## 3. データフロー

```text
ProjectAssetLibrary
  ↓ createBroadcastSnapshot（既存inline DTO）
Renderer IPC helper
  ├─ 未登録SHA-256 → Uint8Array登録要求
  └─ sourceなしSnapshot descriptor
        ↓
Electron Main
  ├─ trusted sender検証
  ├─ IPC runtime validation
  └─ OBS Bridge Asset registry
        ├─ SHA-256・byteLength・metadata再検証
        ├─ SHA-256単位でbytes保持
        └─ HTTP Asset URL付きSnapshotへ変換
              ↓
        Layer patch / full Snapshot選択
              ↓
        OBS Overlay
```

DomainのSnapshot生成とEditor描画は変更せず、RendererのIPC境界でのみ登録要求とdescriptorへ分離します。

## 4. 検証境界

### Renderer

- Domainが生成したSnapshotをProtocol parserで再検証
- inline data URLのMIME prefixを照合
- Base64を`Uint8Array`へ変換
- decoded byteLengthを照合
- publish payloadからsourceを除去

Renderer側の検証は早期エラー表示のためであり、信頼境界ではありません。

### Electron Main IPC

- main frameかつ許可済みRenderer URLだけを受理
- request ID形式
- 登録件数最大256件
- 1 Asset最大25MiB
- 1登録要求の合計最大256MiB
- `Uint8Array`以外を拒否
- byteLength不一致を拒否
- 同一要求内のSHA-256重複を拒否
- Snapshot descriptorへの`dataUrl`、`url`、`delivery`混入を拒否
- Layer treeとAsset参照を完成Snapshotとして検証

### OBS Bridge Asset registry

- bytesからSHA-256を再計算
- descriptorのSHA-256と一致しない場合は拒否
- 同一SHA-256に異なるMIME・幅・高さ・容量・sanitized状態を割り当てない
- 複数Assetをすべて検証し、必要容量を確保できる場合だけ一括反映
- 登録失敗時に部分登録しない
- descriptor公開時に未登録SHA-256を拒否
- 公開失敗時にlatest revisionを更新しない

## 5. Registryと再登録

OBS Bridge registryは既存仕様を維持します。

| 項目 | 値 |
|---|---:|
| 既定最大容量 | 256MiB |
| 設定可能な最大容量 | 512MiB |
| 未参照保持猶予 | 60秒 |
| Asset単体上限 | 25MiB |

現在Snapshotが参照するAssetは容量確保時の削除対象にしません。未参照Assetは保持猶予経過後、または新規登録の容量確保時に古いものから解放します。

Rendererの登録済みSHA-256集合とMain registryは別プロセスの状態であり、Main側の解放をRendererへ常時通知しません。そのため、descriptor公開で`OBS_BRIDGE_ASSET_NOT_REGISTERED`が返った場合だけ次を行います。

1. 現在Snapshotが参照するAssetを全件再登録
2. Renderer側の登録済みSHA-256集合を再構築
3. 同じrevisionのdescriptor Snapshotを再送

再試行は1回だけです。別エラーや再試行失敗は既存のOBS再同期処理へ渡します。

## 6. 後方互換

OBS Bridgeの既存`publishSnapshot`は残し、inline Assetを受け取るUnit Test・内部利用との互換性を維持します。

Electronの通常配信経路だけを次へ変更します。

```text
旧: inline BroadcastSnapshot → publishSnapshot
新: registerAssets + BroadcastSnapshotDescriptor → publishSnapshotDescriptor
```

Main以降では従来どおりHTTP Asset URL付き`BroadcastSnapshot`へ変換されるため、次は変更しません。

- `layer.patch`生成・適用
- Page変更transition
- Overlay再接続
- HTTP Asset endpoint
- ETag / 304
- Canvas renderer
- `.liveboard`保存形式

## 7. 失敗時挙動

| 失敗 | 挙動 |
|---|---|
| Asset登録のruntime validation失敗 | 登録せずpublishしない |
| SHA-256不一致 | registryを変更せず拒否 |
| metadata不一致 | registryを変更せず拒否 |
| registry容量不足 | 既存active Assetを維持して拒否 |
| descriptorが未登録Assetを参照 | latest revisionを変更せず拒否 |
| 未登録エラーの初回発生 | 現在Assetを再登録して同revisionを1回再試行 |
| stale revision | Asset再登録対象にせず既存再同期へ移行 |
| Renderer破棄 | Main registryはBridge終了まで維持 |
| Bridge終了 | registryをclearする |

## 8. 性能特性

初回または再登録時には画像bytesをIPCで送ります。通常のLayer更新・Page再選択では、登録済みAssetのbytesを送りません。

512KiB fixtureでは、inline Snapshot JSONとsourceなしdescriptor JSONのbyteLengthをCIで比較し、繰り返しpublish payloadがinline payloadの1%未満になることを退行防止条件としています。

この計測はJSON表現の比較です。Electronのstructured clone実時間、メモリコピー回数、Windows実機でのGC・CPU使用率を直接測るものではありません。

## 9. 対象外

- `.liveboard`保存・読込のAsset streaming
- RendererからMainへのTransferable所有権移譲
- SharedArrayBuffer
- ディスクバックドAsset cache
- 画像タイル化・Range Request
- Raster stroke／Fill単位IPC差分
- WebSocket圧縮
- Windows Electron＋OBSの実時間8時間試験

## 10. 将来の改善基準

次の場合は追加最適化を検討します。

- 初回複数4K画像登録でRenderer停止が50msを継続超過する
- structured clone中のピークメモリが運用上問題になる
- 256MiB registryで頻繁な再登録が発生する
- 保存・OBS配信・Editor描画が同一Assetの複数コピーを保持する

候補はTransferable `ArrayBuffer`、Main主導のAsset要求、ディスクバックドcontent-addressed cacheです。実測なしに責務を拡大しません。
