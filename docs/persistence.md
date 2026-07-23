# Live Board 永続化・自動保存・クラッシュ復元設計

## 1. 目的

Workspace / Project / Page / Layer / Assetを`.liveboard`として安全に保存し、保存途中のクラッシュ、破損アーカイブ、schema変更、ID衝突が発生しても既存データを失わないことを目的とします。

## 2. 責務分離

### Renderer

- Domain状態から`.liveboard`アーカイブを生成する
- manifestとAsset参照の整合性を検証する
- 読込後にschema migrationとDomain検証を実行する
- 保存・読込・復元のUI状態を管理する
- 実ファイルパスを保持しない

### Electron Main Process

- 保存・読込ダイアログを表示する
- 実ファイルパスを保持する
- temp / fsync / backup / renameによる原子的保存を実行する
- 最近使用したファイルとお気に入りを管理する
- 操作ジャーナルと復元snapshotをユーザーデータ領域へ保存する
- Rendererへは不透明な`documentId`と表示名だけを返す

### `packages/persistence`

- `.liveboard`のmanifestとAsset分離
- ZIP32生成・検証
- SHA-256 / CRC32整合性検証
- schema migration
- Workspace ID衝突時の複製
- 復元ジャーナルの解析と候補判定

## 3. `.liveboard`構造

`.liveboard`はZIP32コンテナです。MVPではLive Board自身が生成した非圧縮エントリだけを受け入れます。

```text
workspace.liveboard
├── manifest.json
└── assets/
    ├── <sha256>.png
    ├── <sha256>.jpg
    ├── <sha256>.webp
    ├── <sha256>.gif
    └── <sha256>.svg
```

### `manifest.json`

主な項目:

- `format`: `liveboard`
- `schemaVersion`: アーカイブschema
- `workspaceSchemaVersion`: Domain Workspace schema
- `appVersion`
- `createdAt`
- `savedAt`
- `workspace`
- `assetLibraries`

AssetのBase64データはmanifestへ含めません。manifestにはAsset ID、SHA-256、MIME、寸法、容量、アーカイブ内パス、元ファイル名、サニタイズ状態だけを保存します。

## 4. 保存処理

1. RendererでWorkspace / Layer / Asset参照を検証する
2. Asset data URLをバイト列へ戻す
3. Asset ID、SHA-256、容量を再検証する
4. manifestとAssetファイルを分離したZIPを生成する
5. RendererからMain ProcessへArchiveバイト列を送る
6. Main ProcessでZIPコンテナと`manifest.json`の存在を再検証する
7. 同一ディレクトリへ一意なtempファイルを作成する
8. tempへ書き込み、ファイルを`fsync`する
9. 既存正式ファイルを`.bak`へ移動する
10. tempを正式ファイル名へrenameする
11. ディレクトリを同期できる環境ではディレクトリ`fsync`を行う
12. 成功後に`.bak`を削除する

失敗時はtempを削除し、正式ファイルを`.bak`から戻します。

起動時または保存前に、正式ファイルがなく`.bak`だけがある場合は`.bak`を正式ファイルへ戻します。古いtempファイルは削除します。

## 5. 自動保存・操作ジャーナル

Workspace内容が変更されるたびに、Main Processへ操作revisionを記録します。

変更が2秒間落ち着いた時点で`.liveboard` snapshotを生成し、自動保存領域へ保存します。

ジャーナルの種類:

- `operation`: Workspace操作
- `snapshot`: 自動保存snapshot
- `explicit-save`: ユーザーの明示保存
- `discard`: 復元候補の破棄

snapshotは`workspaceId`をSHA-256化した専用ディレクトリへ、sequence付きファイル名で保存します。

```text
<persistence>/recovery/<workspace-id-sha256>/
├── metadata.json
├── journal.ndjson
├── snapshot-10.liveboard
├── snapshot-18.liveboard
└── snapshot-24.liveboard
```

最新3世代を保持します。

## 6. クラッシュ復元

起動後、次の条件を満たす最新snapshotを復元候補として表示します。

- snapshot後に同revision以上の明示保存がない
- snapshot後に破棄記録がない
- snapshotファイルの容量とSHA-256がジャーナルと一致する
- `.liveboard` ZIPコンテナを安全に解析できる

復元時は、Archive全体をRenderer側で再度検証し、正常な場合だけ現在のWorkspace状態へ反映します。

復元後は未保存Workspaceとして扱い、元ファイルへ自動上書きしません。

## 7. 最近使用・お気に入り

Main Processは最大20件を`recent.json`へ保存します。

Rendererへ公開する項目:

- `documentId`
- 表示名
- お気に入り状態
- 最終利用日時
- 最終保存日時

実ファイルパスはRendererへ返しません。`documentId`はMain Processがパスから生成するSHA-256です。

## 8. インポート・複製

### 開く

Archive内のWorkspace IDを維持し、現在のWorkspaceを置き換えます。

### インポート

新しいWorkspace ID、Project ID、Page ID、Layer IDを生成して別Workspaceとして読み込みます。Asset IDは内容アドレスなので維持します。

### 複製

現在開いているWorkspaceを新しいID群へ複製し、未保存状態にします。

## 9. migration

現在のアーカイブschemaは`1`です。

- schema `0`は純粋関数で`1`へ変換する
- 未知schemaは拒否する
- migration前の入力Archiveは変更しない
- migration成功後もDomain検証とAsset整合性検証を実行する
- migration失敗時は既存Workspaceと原本ファイルを変更しない

## 10. ZIP安全境界

MVPで受理するもの:

- ZIP32
- 単一ディスク
- UTF-8パス
- 非圧縮`STORE`エントリ
- 通常ファイル

拒否するもの:

- `../`、絶対パス、Windowsドライブパス、バックスラッシュ
- 空・重複・過剰長パス
- symlink、ディレクトリ、特殊ファイル
- 暗号化ZIP
- data descriptor
- 圧縮エントリ
- 分割ZIP
- 過剰エントリ
- 1件・合計・Archive容量上限超過
- CRC32不一致
- ローカルヘッダーと中央ディレクトリの不一致
- 未参照ファイル
- Asset SHA-256・容量不一致

一般的なZIP作成ツールで再圧縮した`.liveboard`は読み込めません。Archive内部を編集する運用は対象外です。

## 11. 上限

- Archive: 512MB
- ZIPエントリ: 4,096件
- 1エントリ: 256MB
- 展開後合計: 512MB
- manifest: 16MB
- Asset: 4,000件
- Project Asset Library: 1,024件
- 画像1件: 25MB
- 操作ジャーナル: 10,000行 / 8MB
- 最近使用: 20件
- 自動保存snapshot: 3世代

## 12. エラー時の挙動

- 保存失敗: 既存正式ファイルを維持し、UIへ失敗を表示する
- 読込失敗: 現在のWorkspaceを維持する
- migration失敗: 入力Archiveと現在のWorkspaceを維持する
- Asset改ざん: Workspaceへ反映しない
- 最近使用データ破損: 破損ファイルを退避し、空一覧から再開する
- 復元候補破損: 一覧へ表示せず、他の候補処理を継続する

## 13. 後続課題

- 大容量Workspaceのストリーム保存・読込
- Archive圧縮を導入する場合の安全な解凍ライブラリ選定
- 複数Workspaceを同時管理するホーム画面
- migrationの実データfixture蓄積
- Windowsでの電源断・ディスク不足・ウイルス対策ソフト介入試験
- Electron実機での500MB級Archive性能計測
