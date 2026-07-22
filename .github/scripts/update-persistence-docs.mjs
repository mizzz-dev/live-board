import { readFile, writeFile } from 'node:fs/promises';

await patch('README.md', [
  [
    'M2「レイヤー・描画・画像編集」の画像・文字・図形・選択変形基盤まで実装しています。',
    'M3「永続化・復元」の`.liveboard`保存、自動保存、クラッシュ復元基盤まで実装しています。',
  ],
  [
    '- 描画時間、Layer cache hit、OBS受信遅延の計測\n- lint、型検査、Unit Test、production build、E2E',
    '- 描画時間、Layer cache hit、OBS受信遅延の計測\n- manifestとAssetを分離した`.liveboard`保存・読込\n- temp / fsync / backup / renameによる原子的保存\n- 操作ジャーナル、2秒debounce自動保存、3世代snapshot\n- クラッシュ復元候補の検証・復元・破棄\n- schemaVersion 0→1 migrationと未知schema拒否\n- Zip Slip・symlink・暗号化・CRC／SHA改ざん拒否\n- 最近使用、お気に入り、複製、インポート\n- lint、型検査、Unit Test、production build、E2E',
  ],
  [
    '永続化、自動保存、クラッシュ復元、画像Assetのファイル分離、差分転送は後続Issueで実装します。',
    '画像AssetのHTTP分離配信、OBS差分転送、タイル化は後続Issueで実装します。',
  ],
  [
    '### OBSへの追加\n',
    `### 保存・復元\n\n- 「保存」「名前を付けて保存」でWorkspace全体を\`.liveboard\`へ保存します。\n- manifestにはWorkspaceとAssetメタデータを保存し、画像バイナリは\`assets/<sha256>.<ext>\`へ分離します。\n- Workspace変更後2秒で自動保存snapshotを生成します。\n- 明示保存済みでない正常なsnapshotは、起動後にクラッシュ復元候補として表示します。\n- 「開く」はArchiveのWorkspace IDを維持して現在状態を置き換えます。\n- 「インポート」「複製」はWorkspace / Project / Page / Layer IDを再生成し、未保存の別Workspaceとして開きます。\n- 最近使用したファイルとお気に入りはMain Processが管理し、実ファイルパスはRendererへ公開しません。\n- 詳細は[永続化・自動保存・クラッシュ復元設計](docs/persistence.md)を参照してください。\n\n### OBSへの追加\n`,
  ],
  [
    '- AssetバイナリはProject単位のReactメモリ状態に保持し、永続化は未実装です。',
    '- 実行中のAssetバイナリはProject単位のReactメモリ状態に保持し、保存時に`.liveboard`内のAssetファイルへ分離します。',
  ],
  [
    '- 永続化、自動保存、クラッシュ復元は未実装です。',
    '- `.liveboard`はMVPでは非圧縮ZIP32だけを受理し、一般ZIPツールで再圧縮したArchiveは読み込めません。\n- Archive上限は512MBで、500MB級データのWindows／電源断／ディスク不足実機試験は後続です。',
  ],
  [
    '  obs-bridge/       loopback限定HTTP / WebSocket・Overlay静的配信\n',
    '  obs-bridge/       loopback限定HTTP / WebSocket・Overlay静的配信\n  persistence/      `.liveboard`・ZIP検証・migration・復元ジャーナル\n',
  ],
  [
    '- [セキュリティ](docs/security.md)\n',
    '- [セキュリティ](docs/security.md)\n- [永続化・自動保存・クラッシュ復元](docs/persistence.md)\n',
  ],
]);

await patch('docs/security.md', [
  [
    '### 後続Issueで実装する範囲\n\n- IVR-244: `.liveboard`アーカイブ、Assetファイル分離、Zip Slip・圧縮爆弾対策、自動保存、migration',
    `### IVR-244で実装済み\n\n- manifestとAssetファイルを分離した\`.liveboard\` ZIP32\n- Archive・エントリ数・1件容量・展開後合計・manifest容量の上限\n- Zip Slip、絶対パス、Windowsドライブパス、重複パスの拒否\n- symlink、ディレクトリ、特殊ファイル、暗号化、data descriptor、分割ZIPの拒否\n- CRC32、SHA-256、ローカルヘッダー、中央ディレクトリ、Asset参照の整合性検証\n- temp / fsync / backup / renameと失敗時ロールバック\n- 操作ジャーナル、自動保存snapshot、明示保存、破棄記録\n- 復元snapshotの容量・SHA・ZIP再検証\n- schemaVersion 0→1 migration、未知schema拒否、入力原本不変\n- Rendererへ実パスを返さないdocumentId境界\n\n### 後続Issueで実装する範囲\n\n- IVR-245: カスタムCSSの構文検証、外部参照制限、復旧フォールバック`,
  ],
]);

async function patch(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [search, replacement] of replacements) {
    const count = source.split(search).length - 1;
    if (count !== 1) throw new Error(`${path}: expected one match, got ${count}: ${search.slice(0, 80)}`);
    source = source.replace(search, replacement);
  }
  await writeFile(path, source);
}
