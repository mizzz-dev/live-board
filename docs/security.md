# Live Board セキュリティ設計

## 1. 基本方針

「セキュリティリスクが一切ない」状態は保証できない。Live Boardでは、外部公開面を持たないローカル完結構成、最小権限、入力検証、プロセス分離、復旧可能な保存処理により、現実的にリスクを最小化する。

## 2. 脅威モデル

主な脅威:

- 不正画像・巨大画像・破損画像によるクラッシュやメモリ枯渇
- SVG内スクリプト、イベント属性、外部参照、XML外部実体
- アーカイブ展開時のパストラバーサル、圧縮爆弾、ファイル上書き
- Electron RendererからのNode API悪用
- OBS向けローカルHTTP/WebSocketへの他プロセスからの接続
- カスタムCSSによる表示破壊、外部通信、情報参照
- 自動保存・スキーマ移行失敗によるデータ破損
- ローカルファイルパスや内部状態のOBS出力への混入

## 3. Electron境界

必須設定:

```ts
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    preload: PRELOAD_PATH,
  },
});
```

- Rendererから`fs`、`child_process`、任意IPCへ直接アクセスさせない
- Preloadは用途別の狭いAPIだけを`contextBridge`で公開
- IPCはチャンネル名だけでなく入力スキーマと呼び出し元を検証
- 外部URL遷移、新規ウィンドウ、任意プロトコルを拒否
- Content Security Policyで`script-src`、`connect-src`、`img-src`を制限
- 本番ビルドでDevToolsを常時有効にしない

## 4. OBSローカルブリッジ

- `0.0.0.0`へbindせず、`127.0.0.1`と`::1`だけを許可
- 起動ごとまたはワークスペースごとに十分長いランダムトークンを発行
- Overlay URLへトークンを含める
- WebSocket upgrade時にトークンとOriginを検証
- トークンをログへ平文出力しない
- 接続数とクライアントメッセージサイズを制限
- 不正なrevisionや未知のmessage typeを拒否
- 外部ネットワークへのプロキシ機能を持たせない

固定ポートを利用する場合は、利用可能ポート検査とプロセス所有確認を行う。ポート競合時に既存プロセスへ無条件接続しない。

## 5. 画像入力検証

画像はすべて信頼できない入力として扱う。

現在の入力経路:

- ファイル選択
- ドラッグ＆ドロップ
- クリップボード貼り付け

検証項目:

- 許可形式: PNG / JPEG / WebP / GIF / SVG
- ブラウザ提供MIMEタイプ
- ファイル拡張子
- ファイルシグネチャ
- 画像ヘッダーと終端・コンテナ長
- 最大ファイルサイズ: 25MB
- 最大幅・高さ: 16,384px
- 最大総ピクセル数: 64M
- Project内の画像バイナリ合計: 256MB
- SVG最大サイズ: 2MB

拡張子とブラウザ提供MIMEタイプだけでは判定しない。MIME・拡張子・実シグネチャが矛盾する入力、破損・途中切れ、寸法上限超過、総ピクセル上限超過を拒否する。

同一内容の画像はサニタイズ後バイナリのSHA-256で識別する。別名ファイルを複数回取り込んでもバイナリは1件だけ保持し、Layerから同じAsset IDを参照する。

現段階では画像デコーダ完了前またはデコード失敗時にプレースホルダーを描画する。実デコード可否、メタデータ除去、処理タイムアウト、画像プロキシ生成は永続化・ファイル分離工程で強化する。

## 6. SVG

SVGはHTML相当の攻撃面を持つため、許可リスト方式で処理する。

拒否・除去対象:

- `script`、`foreignObject`、`iframe`、`object`、`embed`
- `audio`、`video`、`canvas`、`style`、`link`、`meta`
- `onload`等のイベント属性
- `style`属性
- `javascript:`、`vbscript:`、`file:` URL
- 外部HTTP/HTTPS参照、プロトコル相対URL
- XML外部実体、DOCTYPE、外部xml-stylesheet
- CSS `@import`、外部`url()`
- 許可リスト外の要素・属性

`href` / `xlink:href`は文書内fragment参照を基本とし、`image`要素だけPNG / JPEG / WebP / GIFのbase64 data URLを許可する。SVGを再帰的に埋め込むdata URLは許可しない。

サニタイズ後のSVGだけをAssetとして保存・表示し、原本を直接DOMへ挿入しない。Rendererではサニタイズ済みdata URLをブラウザImageとしてデコードし、EditorとOBS Overlayの共通Canvasへ描画する。

## 7. OBS向けAsset投影

- OBS snapshotへは表示中Layerが参照するAssetだけを含める
- 未使用Assetを送信しない
- ファイル名、別名、ローカル絶対パス、選択状態、編集ロックを送信しない
- Asset ID、SHA-256、形式、寸法、バイト長、サニタイズ状態をProtocol境界で検証する
- 存在しないAsset IDを参照するImage Layerを拒否する
- Asset件数、1件サイズ、合計サイズ、data URL長を制限する
- SVG Assetは`sanitized: true`だけを受け入れる

現段階では参照Assetのdata URLをsnapshotへ含めるため、大容量画像ではsnapshotサイズが増える。Assetのloopback HTTP分離配信、キャッシュ識別子だけの差分通知は後続の性能改善対象とする。

## 8. カスタムCSS

- OBS Overlay専用の閉じたコンテナへ適用
- Editor UIへ適用しない
- `@import`を禁止
- 外部URL参照を禁止または明示許可制にする
- `position: fixed`等でホストUIへ干渉できない構造にする
- CSSサイズ上限と構文検証を設ける
- 無効CSSでもOverlay全体が白画面にならないフォールバックを持つ

## 9. アーカイブのインポート・エクスポート

インポート:

- エントリ数、展開後合計サイズ、圧縮率を制限
- `../`、絶対パス、シンボリックリンクを拒否
- 同名ファイル上書きを禁止
- 一時領域へ展開後に検証
- manifestのJSON Schema検証
- アセットのSHA-256照合
- 既存ワークスペースへ直接上書きせず、別IDで取り込み可能にする

エクスポート:

- 一時ファイルへ生成し、完了後にrename
- 保存先以外の任意パスへ書き込まない
- エラー時に不完全ファイルを明示する
- 個人情報やローカル絶対パスをmanifestへ含めない

## 10. 保存・復旧

- 自動保存は世代管理する
- 書き込み中のデータを正式版として扱わない
- DB transactionまたは原子的renameを利用
- クラッシュ復旧ジャーナルは通常保存と分離
- マイグレーション前に原本をバックアップ
- ディスク容量不足を検出し、成功扱いにしない
- 保存失敗をユーザーへ明確に通知

## 11. ログ

ログへ出してはいけないもの:

- Overlay接続トークン
- ローカル絶対パスの全文
- クリップボード内容
- 画像・ワークスペースのバイナリとdata URL
- カスタムCSS全文（明示的な診断出力を除く）

ログにはイベント名、処理時間、対象ID、エラーコード、リビジョン等の診断情報を残す。

## 12. 更新と配布

- 配布物へコード署名を適用する方針を持つ
- 自動更新を導入する場合は署名検証を必須とする
- 任意URLから更新バイナリを取得しない
- 依存関係監査とロックファイル更新をCIで確認
- Electron、画像デコーダ、アーカイブライブラリの脆弱性を優先的に追従

## 13. セキュリティテスト

- 拡張子・MIME偽装画像
- 壊れたPNG / JPEG / WebP / GIF
- 透明4K画像
- 超高解像度・巨大総ピクセル画像
- 同一ハッシュ・別名画像
- SVG script・event属性・foreignObject・外部参照
- SVG DOCTYPE・ENTITY・xml-stylesheet
- SVG内外部`url()`と危険scheme
- 不正crop、存在しないAsset参照、重複Asset ID / SHA
- OBS snapshotへのファイル名・未使用Asset混入
- Zip Slip、圧縮爆弾、過剰エントリ
- 不正WebSocketトークン
- 異常に大きいWebSocketクライアントメッセージ
- Rendererから未許可IPC呼び出し
- カスタムCSSの外部通信・UI破壊
- ディスク容量不足・保存中クラッシュ
- マイグレーション途中失敗

## 14. 実装状況

### IVR-238で実装済み

- Electronの`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`
- RendererとOverlayのContent Security Policy
- 新規ウィンドウ、外部navigation、`webview`生成、権限要求の拒否
- IPCのmain frame・送信元URL・入力値検証
- Preloadで用途別APIだけを公開し、生の`ipcRenderer`を非公開
- `127.0.0.1` / `::1`限定のHTTP・WebSocketブリッジ
- 256bit接続トークン、Origin検証、接続数上限、64KiBクライアントメッセージ上限
- WebSocket圧縮無効化、binary・不正JSON・未知message typeの拒否
- トークンをRendererの状態DTOとログへ含めない境界

### IVR-240で実装済み

- Overlay静的配信
- snapshot / revision同期
- revision欠番検出
- 再接続時の最新snapshot収束

### IVR-243で実装済み

- PNG / JPEG / WebP / GIF / SVGの入力検証
- ファイルサイズ・寸法・総ピクセル・Project合計容量制限
- SVG許可リストサニタイズ
- DOCTYPE・ENTITY・script・外部参照の拒否
- SHA-256によるAsset重複排除
- 参照AssetだけをOBS snapshotへ投影する境界
- ファイル名・ローカルパス・編集状態をOBSへ含めない境界
- Protocol上のAsset件数・サイズ・参照整合性検証

### 後続Issueで実装する範囲

- IVR-244: `.liveboard`アーカイブ、Assetファイル分離、Zip Slip・圧縮爆弾対策、自動保存、migration
- IVR-245: カスタムCSSの構文検証、外部参照制限、復旧フォールバック
- 性能改善: Assetのloopback HTTP分離配信、差分転送、画像プロキシ、タイル化
