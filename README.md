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

M0「リポジトリ・デスクトップ基盤」の初期実装です。
Electron Editor、OBS Overlay、共有Domain、共有設定、CI、E2E Smoke Testの土台を追加しています。

描画、OBS WebSocket同期、永続化、画像処理は後続Issueで実装します。

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

Vite Renderer、Electron Main/PreloadのTypeScript監視、Electronを同時起動します。
RendererからNode.js APIへ直接アクセスできない構成です。

### OBS Overlay単体

```bash
pnpm dev:overlay
```

開発用URLは`http://127.0.0.1:5174`です。
現時点では接続待機画面のみで、ローカルOBSブリッジは`IVR-238`と`IVR-240`で実装します。

## 品質確認

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e`はDesktop RendererとOverlayのproduction buildをVite Previewで起動し、初期画面を確認します。
Electronプロセス自体の自動起動試験は配布設定と合わせて後続で追加します。

## モノレポ構成

```text
apps/
  desktop/          Electron Main / Preload / React Editor
  overlay/          OBS Browser Source向けReactアプリ
packages/
  config/           共有TypeScript設定
  domain/           UI・Electronへ依存しないDomain Model
```

将来追加するパッケージは、[アーキテクチャ](docs/architecture.md)の責務境界に従います。

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
- Testing: Vitest + Playwright

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
