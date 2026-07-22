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
- 接続数とメッセージサイズを制限
- 不正なrevisionや未知のmessage typeを拒否
- 外部ネットワークへのプロキシ機能を持たせない

固定ポートを利用する場合は、利用可能ポート検査とプロセス所有確認を行う。ポート競合時に既存プロセスへ無条件接続しない。

## 5. 画像入力検証

画像はすべて信頼できない入力として扱う。

検証項目:

- 許可拡張子
- 実MIMEタイプ
- ファイルシグネチャ
- 最大ファイルサイズ
- 最大幅・高さ
- 最大総ピクセル数
- デコード可否
- アニメーションフレーム数
- メタデータサイズ
- 処理タイムアウト

拡張子とブラウザ提供MIMEタイプだけで判定しない。デコード後の寸法を検証し、巨大画像は原本を保持したまま編集用プロキシ画像を生成できる構造にする。

## 6. SVG

SVGはHTML相当の攻撃面を持つため、許可リスト方式で処理する。

拒否対象例:

- `script`、`foreignObject`、`iframe`、`object`、`embed`
- `onload`等のイベント属性
- `javascript:` URL
- 外部HTTP/HTTPS参照
- `file:`、`data:`の無制限利用
- XML外部実体、DOCTYPE
- CSS `@import`、外部`url()`
- 不明な名前空間

サニタイズ後のSVGだけを保存・表示し、原本は直接DOMへ挿入しない。可能であれば安全なラスタライズ結果を編集・OBS表示へ使用する。

## 7. カスタムCSS

- OBS Overlay専用の閉じたコンテナへ適用
- Editor UIへ適用しない
- `@import`を禁止
- 外部URL参照を禁止または明示許可制にする
- `position: fixed`等でホストUIへ干渉できない構造にする
- CSSサイズ上限と構文検証を設ける
- 無効CSSでもOverlay全体が白画面にならないフォールバックを持つ

## 8. アーカイブのインポート・エクスポート

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

## 9. 保存・復旧

- 自動保存は世代管理する
- 書き込み中のデータを正式版として扱わない
- DB transactionまたは原子的renameを利用
- クラッシュ復旧ジャーナルは通常保存と分離
- マイグレーション前に原本をバックアップ
- ディスク容量不足を検出し、成功扱いにしない
- 保存失敗をユーザーへ明確に通知

## 10. ログ

ログへ出してはいけないもの:

- Overlay接続トークン
- ローカル絶対パスの全文
- クリップボード内容
- 画像・ワークスペースのバイナリ
- カスタムCSS全文（明示的な診断出力を除く）

ログにはイベント名、処理時間、対象ID、エラーコード、リビジョン等の診断情報を残す。

## 11. 更新と配布

- 配布物へコード署名を適用する方針を持つ
- 自動更新を導入する場合は署名検証を必須とする
- 任意URLから更新バイナリを取得しない
- 依存関係監査とロックファイル更新をCIで確認
- Electron、画像デコーダ、アーカイブライブラリの脆弱性を優先的に追従

## 12. セキュリティテスト

- 拡張子偽装画像
- 壊れた画像
- 超高解像度・巨大ピクセル画像
- SVGスクリプト・外部参照・イベント属性
- Zip Slip、圧縮爆弾、過剰エントリ
- 不正WebSocketトークン
- 異常に大きいWebSocketメッセージ
- Rendererから未許可IPC呼び出し
- カスタムCSSの外部通信・UI破壊
- ディスク容量不足・保存中クラッシュ
- マイグレーション途中失敗

## 13. 実装状況

### IVR-238で実装済み

- Electronの`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`
- RendererとOverlayのContent Security Policy
- 新規ウィンドウ、外部navigation、`webview`生成、権限要求の拒否
- IPCのmain frame・送信元URL・入力値検証
- Preloadで用途別APIだけを公開し、生の`ipcRenderer`を非公開
- `127.0.0.1` / `::1`限定のHTTP・WebSocketブリッジ
- 256bit接続トークン、Origin検証、接続数上限、64KiBメッセージ上限
- WebSocket圧縮無効化、binary・不正JSON・未知message typeの拒否
- トークンをRendererの状態DTOとログへ含めない境界

### 後続Issueで実装する範囲

- IVR-240: Overlayアプリの静的配信、snapshot / revision同期、再接続時の収束
- IVR-243: 画像形式・SVGサニタイズ・巨大画像の検証
- IVR-244: `.liveboard`アーカイブ、Zip Slip・圧縮爆弾対策、保存・migration
- IVR-245: カスタムCSSの構文検証、外部参照制限、復旧フォールバック
