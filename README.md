# Live Board

Live Board は、配信者向けのローカル完結型リアルタイムペイントワークスペースです。
編集画面で描画・文字入力・画像配置・ページ切り替えを行い、OBS Browser Source へ現在の配信ページをリアルタイム表示します。

## プロダクト方針

- 単一ホワイトボードではなく、Workspace / Project / Page / Layer を持つ制作環境
- 編集中ページとOBS表示ページを分離
- 外部サーバーを必要としないローカル動作
- 背景透過オーバーレイ、配信用テーマ、カスタムCSSに対応
- 作業データはローカル保存し、アーカイブ形式で入出力
- CLIP STUDIO PAINTの全機能再現ではなく、配信で使用頻度の高い機能から段階実装
- 将来のLAN・外部サーバー共同編集に拡張できるイベントモデルを採用

## 現在の状態

M3「保存・復旧・性能・配信操作性」に加え、画像Assetの認証付きloopback HTTP分離配信まで実装しています。

実装済み:

- Electron Editor / OBS Overlay / pnpm workspace
- Electron CSP・IPC送信元検証・権限制限
- `127.0.0.1` / `::1`限定OBSローカルブリッジの安全境界
- Workspace / Project / Pageモデル
- ページ追加・複製・削除・並び替えCommand
- 編集ページと配信ページの独立切り替え
- Project単位のPage Undo / Redo履歴
- Raster / Text / Image / Shape / Background / Folder Layer
- Layer treeの親子関係・並び順・循環参照防止
- 表示、編集ロック、移動ロック、透明ピクセルロック
- opacity、レイヤーカラー、通常・乗算・スクリーン・加算・オーバーレイ
- Layer追加・削除・複製・名前変更・移動・結合
- Page単位のLayer Undo / Redo履歴
- Canvas 2D共通レンダラーとLayer単位キャッシュ
- ペン、消しゴム、バケツ、スポイト、手のひらツール
- Pointer Events、筆圧、傾き、マウス／ペン／タッチ入力
- サイズ、不透明度、硬さ、間隔、手ぶれ補正、入り抜き設定
- ズーム、パン、回転、左右反転
- グリッド、ガイド、スナップ
- Page単位の描画Undo / Redoと履歴メモリ上限
- Stroke・Fillの操作順序を保持するRaster DTO
- PNG / JPEG / WebP / GIF静止画 / SVG取り込み
- ファイル選択、ドラッグ＆ドロップ、クリップボード貼り付け
- MIME・シグネチャ・拡張子・寸法・総ピクセル・容量検証
- SVG許可リストサニタイズと外部参照・スクリプト除去
- SHA-256による画像バイナリ重複排除
- Image Layerのcrop・上下左右反転・移動・拡大縮小・回転
- Text Layerのフォント、太さ、斜体、揃え、縁取り、影
- Shape Layerの矩形、楕円、線、寸法、角丸、塗り、線
- 矩形・楕円・投げ縄選択
- 選択対象の移動・拡大縮小・回転
- EditorとOBS Overlayで共通の描画経路
- 表示専用`BroadcastSnapshot` / `BroadcastLayer` / `BroadcastAsset` DTO
- `snapshot`、`page.changed`、`layer.updated`のWebSocket配信
- 接続直後の最新snapshot送信
- Overlayの自動再接続と最後の正常フレーム保持
- token付きOBS Browser Source URLの安全なコピー
- ビルド済みOverlayのloopback静的配信
- SHA-256と起動tokenを使う画像Assetのloopback HTTP配信
- ETag / 304、immutable cache、同一hash重複排除、猶予付きAsset解放
- WebSocket Snapshotから画像data URLを除外
- 描画時間、Layer cache hit、OBS受信遅延の計測
- manifestとAssetを分離した`.liveboard`保存・読込
- temp / fsync / backup / renameによる原子的保存
- 操作ジャーナル、2秒debounce自動保存、3世代snapshot
- クラッシュ復元候補の検証・復元・破棄
- schemaVersion 0→1 migrationと未知schema拒否
- Zip Slip・symlink・暗号化・CRC／SHA改ざん拒否
- 最近使用、お気に入り、複製、インポート
- Alt＋左右・番号指定による配信ページ切り替え
- 配信ページ固定と入力欄フォーカス中のショートカット抑止
- シンプル・イラスト・ホワイトボード・黒板・OBS優先プリセット
- 透過・ホワイトボード・黒板Overlayテーマ
- 外部URL・@ルール・壊れた構文を拒否するOverlay専用カスタムCSS
- 画面内ページだけをidle時間に生成する非同期サムネイル
- 100ページ・100Layer・4K画像・28,800回切り替えの性能試験
- lint、型検査、Unit Test、production build、E2E

OBS差分転送、画像タイル化、実機8時間連続試験は後続工程で実施します。

## 必要環境

- Node.js 22.12以降
- pnpm 11.15.1
- Windows 11を主要な開発・配布対象とする

## セットアップ

```bash
corepack enable
corepack prepare pnpm@11.15.1 --activate
pnpm install
```

## ローカル起動

### Desktop Editor

```bash
pnpm dev:desktop
```

Editor、OBS Protocol、Canvas Engine、OBS Bridge、ビルド済みOverlay、Electron Main / Preloadを起動します。
RendererからNode.js APIへ直接アクセスできない構成です。

### 描画操作

- Page内のRaster LayerへPointer Eventsで描画します。
- 選択中の編集可能なRaster Layerがない場合は、最初のStrokeまたはFill時に自動作成します。
- 描画中はCanvasへ即時プレビューし、Pointer終了時にDomain Commandとして確定します。
- Page操作、Layer操作、描画操作は別々のUndo / Redo履歴へ記録します。
- 描画履歴は件数上限とバイト上限の両方で制限します。
- StrokeとFillには単調増加する操作順序を付与し、EditorとOBSで同じ順番に再生します。
- ズーム、パン、回転、左右反転は表示状態として扱い、描画データを変更しません。

### 画像取り込み

画像アセット欄から、次の方法で追加できます。

- 「画像を追加」からファイル選択
- 画像ファイルのドラッグ＆ドロップ
- クリップボードから画像貼り付け

対応形式:

- PNG
- JPEG
- WebP
- GIF（アニメーションは再生せず静止画として扱う）
- SVG

安全境界:

- 1ファイル25MBまで
- 1辺16,384pxまで
- 総ピクセル数64Mまで
- Project内の画像バイナリ合計256MBまで
- MIME、拡張子、ファイルシグネチャ、寸法を照合
- 破損・途中切れ・偽装ファイルを拒否
- SVGは2MBまで
- SVGのDOCTYPE、ENTITY、script、event属性、foreignObject、外部URL、外部styleを拒否または除去
- 同じ内容の画像はSHA-256で判定し、別名でもバイナリを1件だけ保持

取り込み後はImage Layerが作成され、Canvas中央へ収まる初期サイズで配置されます。

### 文字・図形・選択変形

- Text Layerでは文字、フォント名、サイズ、太さ、斜体、揃え、色、縁取り、影を編集できます。
- 指定フォントがOSに存在しない場合はブラウザのフォントフォールバックを利用します。
- Shape Layerでは矩形、楕円、線、幅、高さ、角丸、塗り、線色、線幅を編集できます。
- Image Layerではcrop範囲と上下左右反転を編集できます。
- 矩形選択、楕円選択、投げ縄選択を利用できます。
- 「Layerを選択」で対象Layerのローカル境界を選択表示できます。
- 選択対象を10px単位で移動、10%単位で拡大縮小、15度単位で回転できます。
- Layer内容編集はLayer履歴、位置・拡大縮小・回転は描画履歴へ記録します。

### Layer操作

- Pageごとに独立したLayer treeを保持します。
- フォルダーを子孫へ移動する操作や、ロック済みLayerの破壊操作はDomain境界で拒否します。
- 表示Layerの種類・順序・opacity・blend mode・transform・描画内容はOBS向けDTOへ投影します。
- OBS snapshotへは表示中Layerが参照する画像Assetだけを含めます。
- ファイル名、別名、選択状態、編集ロック、移動ロック、ローカルパスはOBSへ送信しません。

### 保存・復元

- 「保存」「名前を付けて保存」でWorkspace全体を`.liveboard`へ保存します。
- manifestにはWorkspaceとAssetメタデータを保存し、画像バイナリは`assets/<sha256>.<ext>`へ分離します。
- Workspace変更後2秒で自動保存snapshotを生成します。
- 明示保存済みでない正常なsnapshotは、起動後にクラッシュ復元候補として表示します。
- 「開く」はArchiveのWorkspace IDを維持して現在状態を置き換えます。
- 「インポート」「複製」はWorkspace / Project / Page / Layer IDを再生成し、未保存の別Workspaceとして開きます。
- 最近使用したファイルとお気に入りはMain Processが管理し、実ファイルパスはRendererへ公開しません。
- 詳細は[永続化・自動保存・クラッシュ復元設計](docs/persistence.md)を参照してください。

### 配信操作・Overlayテーマ

- Alt＋← / →で前後の配信ページへ切り替えます。
- Alt＋1〜9、Alt＋0で1〜10番目の配信ページへ直接切り替えます。
- Alt＋Lで配信ページ固定を切り替えます。
- 入力欄、テキストエリア、セレクト、編集可能要素へフォーカス中はショートカットを無視します。
- 配信ページ固定中は、ショートカットと「配信ページに設定」の両方を拒否します。
- プリセットはシンプル、イラスト、ホワイトボード、黒板、OBS優先を選択できます。
- OBS優先プリセットはページ遷移と装飾効果を無効化します。
- Overlay専用カスタムCSSは20,000文字までです。url()、外部scheme、@import、@font-face、styleタグ断片、壊れた括弧を拒否します。
- 不正CSSを含む旧Snapshotを受信した場合はカスタムCSSを無効化し、選択中テーマで表示を継続します。

### OBSへの追加

1. Desktop Editor上部の「OBS URLをコピー」を押す
2. OBSで「ソース」から「ブラウザ」を追加する
3. コピーしたURLをURL欄へ貼り付ける
4. 幅と高さを配信キャンバスに合わせる
5. 「配信ページに設定」でOBSへ出すページを明示的に切り替える

Overlay URLには起動ごとに生成される接続tokenが含まれます。URLを画面やログへ表示せず、Electron Main Processから直接クリップボードへ書き込みます。

### OBS向け画像Asset配信

- Editor・保存処理では従来のinline Assetを維持します。
- OBS Bridgeは公開前にBase64、byteLength、SHA-256を再検証します。
- Overlayへ送るSnapshotでは画像data URLを認証付き相対URLへ変換します。
- Asset URLは`/asset/<起動token>/<sha256>`形式です。
- HTTP endpointはloopback接続、正常token、登録済みSHA-256だけを受け付けます。
- GET / HEAD、ETag / 304、immutable cacheに対応します。
- 同一SHA-256はregistryへ1件だけ保持し、未参照Assetは既定60秒の猶予後に解放します。
- registryの既定上限は256MiBです。
- 詳細は[画像Assetのloopback HTTP配信設計](docs/asset-http-delivery.md)を参照してください。

### OBS Overlay単体

```bash
pnpm dev:overlay
```

開発用URLは`http://127.0.0.1:5174`です。
単体起動ではBrowser Previewを表示します。実際のsnapshot同期はDesktop Editorが起動するloopbackブリッジ経由で行います。

## 性能計測

- EditorとOverlayは描画時間、Layer cache hit / miss、snapshot受信遅延を計測します。
- CIでは1920×1080・10 Raster Layerの描画時間を取得し、250ms未満を退行防止基準とします。
- 100ページ切り替え判定0.716ms、100Layer投影1.599msをGitHub Actions上で計測しました。
- 4K画像4枚の理論RGBAメモリは約126.56MiBです。
- 28,800回の8時間相当切り替えはrevision欠番0件、保持Workspace 1件でした。
- これらはUbuntu / Node.js / Vitest上の状態遷移計測で、Windows Electron・OBS・GPUの実機値ではありません。
- 現時点ではCanvas 2Dを維持し、Worker / WebGLは性能予算の継続超過時だけ導入します。
- 詳細は[配信性能・長時間安定性試験](docs/performance.md)を参照してください。

## 現在の制約

- Raster内容はStroke / Fill DTOを再生する初期実装で、タイル分割されたファイルバックドピクセルストレージではありません。
- 実行中のAssetバイナリはProject単位のReactメモリ状態に保持し、保存時に`.liveboard`内のAssetファイルへ分離します。
- Desktop RendererからElectron MainへSnapshotを渡すIPCでは、参照Assetのinline data URLを引き続き使用します。
- OBS BridgeからOverlayへ送るWebSocket Snapshotには画像data URLを含めず、loopback HTTP Asset URLへ変換します。
- Asset registryはメモリ上に保持し、既定256MiB・未参照60秒の上限と猶予を持ちます。
- OBSのLayer差分転送、画像タイル化、ディスクバックドHTTP cacheは後続の性能改善対象です。
- バケツはLayerキャッシュ生成時にCanvas全体のImageDataを処理します。
- GIFはブラウザImageで静止フレームとして描画し、アニメーション編集・再生は対象外です。
- SVGサニタイズは安全側の許可リスト方式で、一部の高度なSVG機能は除去されます。
- `.liveboard`はMVPでは非圧縮ZIP32だけを受理し、一般ZIPツールで再圧縮したArchiveは読み込めません。
- Archive上限は512MBで、500MB級データのWindows／電源断／ディスク不足実機試験は後続です。
- カスタムCSSは任意CSS互換ではなく、外部通信と危険構文を拒否する制限付きサブセットです。
- 4K画像の126.56MiBはRGBA理論値で、実画像デコード・GPUコピー・Canvasキャッシュを含む実測値ではありません。
- 28,800回試験は8時間相当の高速状態遷移シミュレーションで、ElectronとOBSを実時間8時間稼働した試験ではありません。

## 品質確認

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e`はDesktop RendererとOverlayのproduction buildをVite Previewで起動し、Page操作、Layer操作、Pointer描画、画像取り込み、SVG拒否、Asset重複排除、選択変形、描画Undo / Redo、Viewport操作、配信ショートカット、配信固定、危険CSS拒否、100ページ一覧、性能計測、Preview状態を確認します。
OBS Bridgeのtoken認証、snapshot push、`layer.updated`、再接続収束、静的ファイル配信はVitestで確認します。
ElectronプロセスとOBS実機を組み合わせた自動試験は配布設定と合わせて後続で追加します。

## モノレポ構成

```text
apps/
  desktop/          Electron Main / Preload / React Editor
  overlay/          OBS Browser Source向けReactアプリ
packages/
  canvas-engine/    Canvas 2D描画・座標変換・Tool・選択・Layer cache
  config/           共有TypeScript設定
  domain/           Workspace / Project / Page / Layer / Asset / Command履歴・snapshot投影
  obs-protocol/     Editor・Bridge・Overlay間のDTOとメッセージ検証
  obs-bridge/       loopback限定HTTP / WebSocket・Overlay静的配信
  persistence/      `.liveboard`・ZIP検証・migration・復元ジャーナル
```

将来追加するパッケージは、[アーキテクチャ](docs/architecture.md)の責務境界に従います。

## ドキュメント

- [プロダクト要件](docs/product-requirements.md)
- [アーキテクチャ](docs/architecture.md)
- [データモデル](docs/data-model.md)
- [セキュリティ](docs/security.md)
- [永続化・自動保存・クラッシュ復元](docs/persistence.md)
- [画像Assetのloopback HTTP配信](docs/asset-http-delivery.md)
- [配信性能・長時間安定性試験](docs/performance.md)
- [ロードマップ](docs/roadmap.md)
- [AIエージェント向け実装規約](AGENTS.md)

## 推奨技術構成

- Desktop shell: Electron
- UI: React + TypeScript + Vite
- State: React UI状態 + Domain Command/Event層（履歴・永続化対象）
- Local storage: SQLite または IndexedDB、アセットはファイル分離
- OBS bridge: `127.0.0.1` / `::1`限定 HTTP + WebSocket
- Rendering: MVPは Canvas 2D、負荷計測後に OffscreenCanvas / WebGL を段階導入
- Testing: Vitest + Playwright

## MVPの主要機能

- ワークスペース、プロジェクト、ページ、レイヤー管理
- 編集ページと配信ページの分離
- ラスター・テキスト・画像・図形レイヤー
- ペン、消しゴム、バケツ、スポイト、文字入力
- PNG / JPEG / WebP / GIF静止画 / SVGインポート
- ズーム、パン、回転、グリッド、ガイド
- Undo / Redo、自動保存、クラッシュ復元
- OBSリアルタイム表示、透過テーマ、カスタムCSS
- ワークスペースのインポート・エクスポート

## 非目標

初期MVPでは、PSD入出力、高度な定規、液状化、メッシュ変形、外部サーバー共同編集、CLIP STUDIO PAINTとの完全互換を対象外とします。
