# Live Board データモデル

## 1. 設計原則

- 永続化形式と画面状態を分離する
- すべての主要エンティティは不変のIDを持つ
- 表示順は配列順または明示的な`orderKey`で管理する
- バイナリデータはアセットとして分離し、レイヤーから参照する
- 編集ページと配信ページは別フィールドで管理する
- 保存データは必ず`schemaVersion`を持つ
- 将来の共同編集に備え、イベントには`revision`と`actorId`を追加可能にする

## 2. Workspace

```ts
interface Workspace {
  schemaVersion: number;
  workspaceId: string;
  name: string;
  projectIds: string[];
  favorite: boolean;
  layoutPresetId: string | null;
  activeProjectTabIds: string[];
  pinnedProjectTabIds: string[];
  recentlyClosedTabs: ClosedTabEntry[];
  createdAt: string;
  updatedAt: string;
}
```

## 3. Project

```ts
interface Project {
  projectId: string;
  workspaceId: string;
  name: string;
  pageIds: string[];
  activeEditPageId: string | null;
  activeBroadcastPageId: string | null;
  broadcastPageLocked: boolean;
  assetIds: string[];
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}
```

`activeEditPageId`と`activeBroadcastPageId`は同一である必要がない。OBS表示切り替えは、明示的なBroadcast Commandを経由して`activeBroadcastPageId`だけを変更する。

## 4. Page

```ts
interface Page {
  pageId: string;
  projectId: string;
  name: string;
  layerIds: string[];
  visible: boolean;
  locked: boolean;
  settings: PageSettings;
  thumbnailRevision: number;
  createdAt: string;
  updatedAt: string;
}

interface PageSettings {
  width: number;
  height: number;
  dpi: number;
  background: { type: 'transparent' } | { type: 'color'; value: string };
  grid: GridSettings;
  guides: Guide[];
  safeArea: Insets;
  outputRect: Rect | null;
  transition: { type: 'none' | 'fade'; durationMs: number };
}
```

## 5. Layer

```ts
type Layer =
  | RasterLayer
  | TextLayer
  | ImageLayer
  | ShapeLayer
  | BackgroundLayer
  | LayerFolder;

interface LayerBase {
  layerId: string;
  pageId: string;
  parentFolderId: string | null;
  name: string;
  visible: boolean;
  editLocked: boolean;
  movementLocked: boolean;
  alphaLocked: boolean;
  opacity: number;
  blendMode: 'normal' | 'multiply' | 'screen' | 'add' | 'overlay';
  layerColor: string | null;
  transform: Transform2D;
  createdAt: string;
  updatedAt: string;
}
```

### RasterLayer

```ts
interface RasterLayer extends LayerBase {
  type: 'raster';
  rasterStorageRef: string;
  contentRevision: number;
}
```

### TextLayer

```ts
interface TextLayer extends LayerBase {
  type: 'text';
  object: TextObject;
}

interface TextObject {
  objectId: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  lineHeight: number;
  letterSpacing: number;
  color: string;
  alignment: 'left' | 'center' | 'right';
  outline: StrokeStyle | null;
  shadow: ShadowStyle | null;
}
```

### ImageLayer

```ts
interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: string;
  cropRect: Rect | null;
  filters: ImageFilter[];
}
```

### ShapeLayer

```ts
interface ShapeLayer extends LayerBase {
  type: 'shape';
  objects: ShapeObject[];
}
```

### LayerFolder

```ts
interface LayerFolder extends LayerBase {
  type: 'folder';
  childLayerIds: string[];
  collapsed: boolean;
}
```

フォルダー階層は循環参照を禁止する。移動時に祖先チェックを行い、最大階層数を設定可能にする。

## 6. ProjectAsset

```ts
interface ProjectAsset {
  assetId: string;
  projectId: string;
  originalFileName: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  storagePath: string;
  sanitized: boolean;
  createdAt: string;
}
```

利用ページ・利用レイヤーは別インデックスで管理する。

```ts
interface AssetUsageIndex {
  assetId: string;
  pageIds: string[];
  layerIds: string[];
}
```

## 7. Commandと履歴

```ts
interface Command<TPayload = unknown> {
  commandId: string;
  type: string;
  scope: 'workspace' | 'project' | 'page';
  targetId: string;
  payload: TPayload;
  createdAt: string;
}

interface HistoryEntry {
  historyId: string;
  command: Command;
  inverseCommand: Command | null;
  estimatedBytes: number;
}
```

破壊的操作は原則として`inverseCommand`または復元用snapshotを持つ。画像結合や大量ラスターデータ操作では、履歴メモリ上限を超える前にユーザーへ警告する。

## 8. BroadcastSnapshot

OBSへは永続化モデルを直接送信しない。表示に必要なデータだけを投影したDTOを使用する。

```ts
interface BroadcastSnapshot {
  projectId: string;
  pageId: string;
  revision: number;
  canvas: {
    width: number;
    height: number;
    background: PageSettings['background'];
    outputRect: Rect | null;
  };
  layers: BroadcastLayer[];
  theme: BroadcastTheme;
}
```

編集選択枠、ガイド、履歴、非表示レイヤー、ローカルファイルパス等は含めない。

## 9. Workspaceアーカイブ

`manifest.json`は参照関係とメタデータだけを持つ。

```json
{
  "schemaVersion": 1,
  "workspaceId": "...",
  "exportedAt": "2026-07-22T00:00:00.000Z",
  "projects": ["projects/project-id.json"],
  "assets": [
    {
      "assetId": "...",
      "path": "assets/asset-id.png",
      "sha256": "...",
      "byteSize": 12345
    }
  ]
}
```

インポート時は以下の順で処理する。

1. アーカイブサイズとエントリ数を検証
2. パストラバーサルを拒否
3. 一時領域へ展開
4. manifestのスキーマ検証
5. アセットのサイズ・ハッシュ・形式を検証
6. スキーマ移行
7. 新しいID衝突を解決
8. 正式領域へ反映

## 10. マイグレーション

```ts
interface WorkspaceMigration {
  fromVersion: number;
  toVersion: number;
  migrate(input: unknown): unknown;
}
```

- 1段階ずつ順番に適用する
- 移行前の原本を保持する
- 失敗時に中間状態を正式保存しない
- downgradeは原則サポートせず、旧バージョン用コピーを残す
