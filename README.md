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

MVP実装前の要件・アーキテクチャ確定フェーズです。
初期PRでは、実装を安全に分割するためのプロダクト要件、技術設計、セキュリティ境界、ロードマップを追加します。

## ドキュメント

- [プロダクト要件](docs/product-requirements.md)
- [アーキテクチャ](docs/architecture.md)
- [データモデル](docs/data-model.md)
- [セキュリティ](docs/security.md)
- [ロードマップ](docs/roadmap.md)
- [AIエージェント向け実装規約](AGENTS.md)

## 推奨技術構成

- Desktop shell: Electron
- UI: React + TypeScript + Vite
- State: Zustand（UI状態）+ Command/Event層（履歴・永続化対象）
- Local storage: SQLite または IndexedDB、アセットはファイル分離
- OBS bridge: `127.0.0.1` 限定 HTTP + WebSocket
- Rendering: MVPは Canvas 2D、負荷計測後に OffscreenCanvas / WebGL を段階導入
- Testing: Vitest + React Testing Library + Playwright

## MVPの主要機能

- ワークスペース、プロジェクト、ページ、レイヤー管理
- 編集ページと配信ページの分離
- ラスター・テキスト・画像・図形レイヤー
- ペン、消しゴム、バケツ、スポイト、文字入力
- PNG / JPEG / WebP / SVG インポート
- ズーム、パン、回転、グリッド、ガイド
- Undo / Redo、自動保存、クラッシュ復元
- OBSリアルタイム表示、透過テーマ、カスタムCSS
- ワークスペースのインポート・エクスポート

## 非目標

初期MVPでは、PSD入出力、高度な定規、液状化、メッシュ変形、外部サーバー共同編集、CLIP STUDIO PAINTとの完全互換を対象外とします。
