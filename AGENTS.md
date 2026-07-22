# AGENTS.md

## 1. プロジェクト目的

Live Boardは、配信者向けのローカル完結型リアルタイムペイントワークスペースである。編集画面の状態をOBS Browser Sourceへ低遅延で表示し、複数ワークスペース・プロジェクト・ページ・レイヤーを安全に保存・復元できることを目的とする。

## 2. 最優先事項

判断に迷う場合は以下の順で優先する。

1. データを破損しないこと
2. Electron・画像・アーカイブ入力の安全性
3. EditorとOBSの表示整合性
4. 描画遅延と長時間安定性
5. 既存設計との整合性
6. 保守性とテスト容易性
7. 実装速度

## 3. MVP対象

- Workspace / Project / Page / Layer
- 編集ページと配信ページの分離
- ラスター、テキスト、画像、図形、背景、フォルダー
- ペン、消しゴム、バケツ、スポイト、文字入力
- 基本選択・変形
- PNG、JPEG、WebP、GIF静止画、SVG
- OBSローカルOverlay
- 自動保存、クラッシュ復元、インポート・エクスポート
- 黒板、ホワイトボード、透過テーマ、カスタムCSS

## 4. MVP対象外

- CLIP STUDIO PAINTとの完全同等・互換
- PSDのレイヤー構造入出力
- 高度な定規、メッシュ変形、液状化
- アニメーションレイヤー
- LAN・外部サーバー共同編集
- 別ウィンドウへのタブ分離

対象外機能を先回りして実装しない。将来拡張に必要な境界だけを設計する。

## 5. 変更方針

- 無関係なリファクタ、リネーム、整形を混ぜない
- 1PRを1責務または1縦スライスへ限定する
- UI状態、ドメイン状態、ランタイム状態を混在させない
- ドメイン変更はCommand経由とし、Undo・保存・OBS同期へ接続可能にする
- 永続化DTOをUI Storeとして直接利用しない
- ローカルファイルパスやElectron APIをRendererへ直接露出しない
- 性能最適化は計測結果を添えて行う

## 6. 言語・文書

- コード識別子は英語
- PRタイトル、PR本文、レビュー向け説明、運用文書は日本語
- コメントは「なぜ必要か」がコードから読み取れない場合だけ記載
- README、docs、ADRを実装と同じPRで更新する

## 7. アーキテクチャ境界

- `domain`: UI・Electron・Canvas APIへ依存させない
- `canvas-engine`: 描画・合成・選択・変形・ツール
- `persistence`: 保存DTO、migration、自動保存、archive
- `obs-bridge`: loopback HTTP/WebSocketと同期プロトコル
- `asset-pipeline`: 画像検証、SVGサニタイズ、サムネイル
- `desktop`: Electron main / preload / editor UI
- `overlay`: OBS表示専用。編集UIを含めない

循環依存を導入しない。上位UIから下位ドメインへ一方向に依存する。

## 8. Electronセキュリティ

必須:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- Preload APIを最小化
- IPC入力をスキーマ検証
- 外部遷移・新規ウィンドウを拒否
- CSPを設定
- OBSサーバーは`127.0.0.1` / `::1`だけへbind

安全設定を無効化する変更は禁止。必要な場合は脅威、代替案、テストをPRへ明記する。

## 9. 画像・SVG・アーカイブ

- 入力を信頼しない
- 拡張子だけで形式判定しない
- MIME、シグネチャ、サイズ、寸法、総ピクセル数を検証
- SVGは許可リスト方式でサニタイズ
- 外部参照、イベント属性、script、foreignObjectを拒否
- アーカイブは一時領域へ展開し、Zip Slip、圧縮爆弾、過剰エントリを防止
- 検証前データを正式ワークスペースへ反映しない

## 10. OBS同期

- `activeEditPageId`と`activeBroadcastPageId`を混同しない
- Overlayへ編集選択枠、ガイド、非表示レイヤー、内部パスを送信しない
- メッセージへ`revision`を持たせる
- 欠番時にsnapshot再同期できるようにする
- EditorとOverlayのプロトコル変更を別々にマージしない
- 再接続時の収束テストを追加する

## 11. Undo・保存

- 破壊的操作はUndo可能にする
- 保存処理を描画スレッドで長時間ブロックしない
- 自動保存と明示保存を区別
- 一時ファイルまたはtransactionを使い、不完全データを正式保存しない
- migration前の原本を保持
- 履歴は件数と推定メモリ量で上限管理

## 12. テスト必須観点

実装変更には該当するテストを追加する。

- 正常系
- 異常系
- 境界値
- Undo / Redo
- 保存・再読込
- Editor / OBS表示一致
- OBS切断・再接続
- 権限・IPC境界
- 不正画像・SVG・archive
- 長時間操作とメモリ増加
- 既存機能への回帰

## 13. 完了条件

「画面で動いた」だけで完了としない。

- lint、typecheck、unit test、integration test、buildが成功
- 主要なE2E操作が成功
- 保存後の再起動で状態が一致
- OBS再接続で現在の配信ページへ復帰
- 追加した機能の異常系を確認
- READMEまたはdocsを更新
- PR本文に目的、変更内容、影響範囲、テスト、懸念点を記載

## 14. 禁止事項

- `any`や型アサーションで設計上の不整合を隠す
- Rendererから任意Node APIを呼び出す
- 大量Base64をmanifest JSONへ保存する
- EditorのStoreをそのままOBSへ送る
- テストなしで保存形式・migration・同期protocolを変更する
- 性能計測なしに複雑なWebGL・CRDTを導入する
- 将来要件を理由にMVP差分を不必要に巨大化する
