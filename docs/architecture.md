# Live Board アーキテクチャ

## 1. 推奨構成

MVPは、Electron上で動作するReact + TypeScriptアプリとし、Electron Main Process内にOBS向けのローカルHTTP/WebSocketブリッジを持つ。

```text
┌─────────────────────────────────────────────────────────────┐
│ Electron Desktop App                                        │
│                                                             │
│  ┌──────────────────────┐   IPC   ┌──────────────────────┐ │
│  │ Renderer             │◀───────▶│ Main Process         │ │
│  │ React / TypeScript   │         │ File / DB / Recovery │ │
│  │ Editor UI            │         │ Local HTTP / WS      │ │
│  │ Canvas Renderer      │         │ Import / Export      │ │
│  └──────────────────────┘         └──────────┬───────────┘ │
└──────────────────────────────────────────────┼─────────────┘
                                               │ 127.0.0.1 only
                                      HTTP + WebSocket
                                               │
                                  ┌────────────▼────────────┐
                                  │ OBS Browser Source      │
                                  │ Overlay Renderer        │
                                  │ No editor chrome        │
                                  └─────────────────────────┘
```

## 2. 技術選定

### Electron

採用理由:

- OBS Browser Sourceと同じChromium系レンダリングを前提にしやすい
- ローカルファイル、SQLite、クラッシュ復元、アーカイブ処理をNode側へ隔離できる
- React/TypeScript中心で実装できる
- Web Worker、OffscreenCanvas、Pointer EventsなどWeb技術を活用できる

制約:

- バイナリサイズとメモリ使用量が大きい
- Main/Renderer境界を誤ると権限過多になる
- `nodeIntegration: false`、`contextIsolation: true`、sandbox有効化を必須とする

### 代替案: Tauri

軽量性と権限分離を最優先する場合は有力。ただしRust側実装、WebView差異、ローカル配信ブリッジの開発コストが上がるため、MVPの実装速度とチームのTypeScript学習軸を優先してElectronを推奨する。

## 3. モジュール境界

```text
apps/
├── desktop/            Electron main / preload / editor renderer
└── overlay/            OBS Browser Source用の表示専用アプリ
packages/
├── domain/             Workspace / Project / Page / Layer / Command
├── canvas-engine/      描画、合成、選択、変形、ツール実行
├── persistence/        保存、復元、スキーマ移行、アーカイブ
├── obs-bridge/         HTTP、WebSocket、認証、同期プロトコル
├── asset-pipeline/     画像検証、SVGサニタイズ、サムネイル
├── ui/                 共通UIコンポーネント
└── config/             TypeScript / ESLint / Vitest設定
```

### `domain`

- UI、Electron、Canvas APIへ依存しない
- 識別子、エンティティ、値オブジェクト、Command/Eventを定義
- `activeEditPageId` と `activeBroadcastPageId` を明確に分離
- Undo対象と非Undo対象を区別

### `canvas-engine`

- 入力イベントを描画Commandへ変換
- レイヤー合成と表示用スナップショットを生成
- 編集用オーバーレイと配信用出力を分離
- ツールごとの巨大な条件分岐を避け、`CanvasTool`インターフェースを採用

```ts
interface CanvasTool {
  readonly id: string;
  onPointerDown(context: ToolContext, event: NormalizedPointerEvent): ToolResult;
  onPointerMove(context: ToolContext, event: NormalizedPointerEvent): ToolResult;
  onPointerUp(context: ToolContext, event: NormalizedPointerEvent): ToolResult;
  cancel(context: ToolContext): void;
}
```

### `persistence`

- ドメイン状態を保存DTOへ変換
- 自動保存と明示保存を分離
- 一時ファイルへ書き込み後、原子的に差し替える
- `schemaVersion`ごとのmigrationを管理
- 大きなバイナリをmanifestへ直接埋め込まない

### `obs-bridge`

- `127.0.0.1`へだけbind
- Overlay用HTTP静的配信
- WebSocketでページ変更・差分・接続状態を通知
- 接続時に完全スナップショット、その後は差分イベントを送信
- OBS再接続時に現在の配信ページへ収束させる

## 4. 状態管理

状態は3種類へ分ける。

1. **Domain state**: 保存・Undo・同期対象
2. **UI state**: 選択中ツール、開閉パネル、ズーム表示など
3. **Runtime state**: OBS接続、Worker進捗、メモリ統計など

Zustand等のStoreへ全状態を一括格納せず、Domain stateの変更はCommand経由に限定する。

```text
UI Action
  ↓
Command Dispatcher
  ↓
Domain Reducer / Handler
  ├── New Domain State
  ├── Undo Entry
  ├── Persistence Event
  └── Broadcast Event
```

## 5. Undo / Redo

- ページ内描画操作はページ単位の履歴
- ページ追加・削除・並び替え等はプロジェクト履歴
- 大きなラスターデータは毎回完全コピーせず、差分タイルまたは操作ログを検討
- 初期実装は正確性を優先し、上限付きスナップショット + Command方式から開始
- 履歴上限は件数と推定メモリ量の両方で制御

## 6. OBS同期プロトコル

### 接続

```text
GET /overlay/:sessionToken
WS  /ws?token=:sessionToken
```

### 主要イベント

```ts
type BroadcastMessage =
  | { type: 'snapshot'; revision: number; payload: BroadcastSnapshot }
  | { type: 'page.changed'; revision: number; pageId: string; transition: 'none' | 'fade' }
  | { type: 'layer.updated'; revision: number; pageId: string; layerId: string; patch: unknown }
  | { type: 'asset.updated'; revision: number; assetId: string; url: string }
  | { type: 'theme.updated'; revision: number; css: string }
  | { type: 'ping'; timestamp: number };
```

- `revision`で順序を保証する
- 欠番検出時はoverlayがsnapshot再取得を要求する
- 編集専用情報はbroadcast DTOへ含めない
- カスタムCSSは専用スコープへ制限し、アプリ本体へ適用しない

## 7. レンダリング戦略

### MVP

- Canvas 2Dを基盤とする
- 各レイヤーをオフスクリーンCanvasへキャッシュ
- 変更されたレイヤーと領域だけ再描画
- 表示合成結果をoverlayへ送る方式と、overlay側で再合成する方式を計測比較する

推奨初期方式:

- ラスター・高頻度ストロークは差分画像または更新タイル
- テキスト・図形・画像は構造化オブジェクト
- ページ切り替え時は完全スナップショット

### 拡張判断

以下が計測で問題になった時点で段階導入する。

- バケツ・画像処理: Web Worker
- メインスレッド描画負荷: OffscreenCanvas
- レイヤー合成・多数オブジェクト: WebGL
- 4K・巨大キャンバス: タイルレンダリング

## 8. アセット管理

```ts
interface ProjectAsset {
  assetId: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  createdAt: string;
  storagePath: string;
}
```

- ハッシュで同一アセットを重複排除
- レイヤーは`assetId`を参照
- 利用ページ・利用レイヤーは逆引きインデックスで管理
- サムネイルは派生データとして再生成可能にする

## 9. 自動保存・クラッシュ復元

- 操作をジャーナルへ追記
- 一定操作数または一定時間でスナップショット保存
- 保存中に次の編集をブロックしない
- 起動時に通常保存と復旧ジャーナルを比較
- 復旧候補をユーザーが選択できる
- 復旧成功後も元ジャーナルを即時削除しない

## 10. 将来の共同編集

MVPでは共同編集を実装しないが、Command/Eventへactor情報を付与できる構造にする。

```ts
interface DomainEvent<T> {
  eventId: string;
  workspaceId: string;
  actorId: string;
  revision: number;
  occurredAt: string;
  type: string;
  payload: T;
}
```

Phase 3でLAN共同編集を追加する場合、競合解決対象を以下に限定して段階導入する。

- ページ・レイヤー構造: 操作イベント
- テキスト・図形: オブジェクト単位
- ラスター描画: ストローク単位またはタイル単位

最初から汎用CRDTを全面採用せず、実際の競合パターンを計測して導入範囲を決める。
