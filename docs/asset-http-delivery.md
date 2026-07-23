# 画像Assetのloopback HTTP配信設計

## 1. 目的

OBS向け`BroadcastSnapshot`へ画像のdata URLを毎回埋め込まず、ページ切り替え・再接続・Layer更新時のWebSocket payloadを画像バイナリ容量から分離します。

この変更は配信transportだけを対象とし、Editorの描画、DomainのSnapshot生成、`.liveboard`保存形式では従来のinline Assetを維持します。

## 2. 責務境界

### Domain・Persistence・Desktop Editor

- `ProjectAsset`と`BroadcastAsset`のinline data URLを生成・保持する
- 画像形式、寸法、容量、SVGサニタイズを従来どおり検証する
- `.liveboard`ではmanifestとAssetバイナリを分離する

### OBS Bridge

- Rendererから受け取ったinline Assetを実行時に再検証する
- data URLを厳密にBase64 decodeする
- decoded byteLengthと宣言値を照合する
- SHA-256を再計算し宣言hashと照合する
- 検証済みバイナリをSHA-256単位でregistryへ保持する
- Overlayへ送信するSnapshotだけをHTTP deliveryへ変換する

### OBS Overlay・Canvas Engine

- inline AssetとHTTP Assetのsource解決を共通化する
- HTTP AssetはOverlayと同一originの相対URLだけを受理する
- 画像decode完了後に既存のinvalidate経路で再描画する

## 3. HTTP Asset URL

```text
/asset/<overlay-token>/<sha256>
```

制約:

- tokenは起動ごとに生成する64文字の16進文字列
- SHA-256は64文字の小文字16進文字列
- query stringを許可しない
- 絶対URL、外部origin、protocol-relative URLをProtocol境界で拒否する
- URL末尾のSHA-256とAsset metadataのSHA-256が一致しなければ拒否する

Asset URLはOverlay URLと同じ起動単位tokenを使用します。起動を跨いだURLの再利用はできません。

## 4. Asset registry

既定値:

| 項目 | 値 |
|---|---:|
| 最大保持バイト数 | 256MiB |
| 未参照Asset保持猶予 | 60秒 |
| 1Asset上限 | Protocol既存値の25MiB |

動作:

- registry keyはSHA-256
- 同一SHA-256は1件だけ保持する
- 同一SHA-256でMIME、byteLength、sanitized状態が異なる場合は拒否する
- 現在Snapshotが参照するAssetは削除しない
- 未参照Assetは猶予期間経過後に削除する
- byte上限超過時は古い未参照Assetから削除する
- 現在SnapshotのAssetだけで上限を超える場合はSnapshot公開を拒否する
- Bridge終了時にregistryを明示的にclearする

ページ高速切り替え中に直前ページの画像取得が完了する前に削除されないよう、未参照Assetを即時削除しません。

## 5. HTTP Response

対応method:

- `GET`
- `HEAD`

主なResponse header:

```text
Content-Type: <検証済みAsset MIME>
Content-Length: <検証済みbyteLength>
Cache-Control: private, max-age=31536000, immutable
ETag: "<sha256>"
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: no-referrer
```

`If-None-Match`が一致する場合は`304 Not Modified`を返します。

SVGには追加で次を設定します。

```text
Content-Security-Policy: default-src 'none'; sandbox
```

SVG自体はAsset取り込み時の許可リストサニタイズ済みであることをProtocol境界でも必須とします。

## 6. 失敗時の挙動

| 条件 | 挙動 |
|---|---|
| loopback以外からのHTTP接続 | 403 |
| token不一致 | 401 |
| path形式不正・query付き | 404 |
| 未登録SHA-256 | 404 |
| data URL破損 | Snapshot公開を拒否 |
| byteLength不一致 | Snapshot公開を拒否 |
| SHA-256不一致 | Snapshot公開を拒否 |
| registry上限超過 | Snapshot公開を拒否 |
| HTTP AssetをBridge入力へ再投入 | Snapshot公開を拒否 |
| Overlay画像decode失敗 | 既存の画像placeholderを維持 |

不正Assetを正式なlatest Snapshotへ反映する前に検証を完了します。revision検証後、Asset登録とHTTP変換に成功した場合だけWebSocketへ送信します。

## 7. 後方互換

- `delivery`未指定で`dataUrl`を持つ旧Assetはinline Assetとして扱う
- Desktop Editorの共通Rendererは従来のinline data URLを引き続き描画する
- Overlay Rendererはinline／HTTPの両方を描画する
- `.liveboard`manifest、Assetファイル配置、migration schemaは変更しない

## 8. 対象外

- Desktop RendererからElectron MainへのAsset IPC分離
- `layer.updated`の差分DTO化
- Assetのタイル分割・部分取得
- LAN・外部サーバー配信
- 動画・アニメーションAsset
- ディスクバックドHTTP cache

## 9. テスト観点

- inline／HTTP Protocol parsing
- 外部URL、hash不一致、data URLとURLの同時指定拒否
- Base64、byteLength、SHA-256再検証
- 同一hash重複排除
- 未参照Assetの猶予付き解放
- registry byte上限
- token正常・異常・欠落
- GET／HEAD／ETag／304
- MIME、nosniff、same-origin、SVG CSP
- WebSocket JSONへ`data:image`が含まれないこと
- 旧inline SnapshotのEditor・Overlay描画回帰
- ページ切り替え・再接続時のAsset取得
