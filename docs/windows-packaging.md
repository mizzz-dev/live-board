# Windows配布パッケージ設計

## 1. 目的

Live BoardのMVPをWindows 11環境へ配布し、OBS Browser Sourceを含む実機試験を再現可能に開始できる状態を作ります。

本設計の成果物はコード署名前のRelease Candidateです。一般公開用の正式リリースではありません。

## 2. 成果物

Windows x64向けに次を生成します。

| 成果物 | 用途 |
|---|---|
| `Live-Board-Setup-<version>-x64.exe` | ユーザー単位で導入するNSISインストーラー |
| `Live-Board-Portable-<version>-x64.exe` | インストールせず検証するポータブル版 |
| `SHA256SUMS.txt` | 2つのexeの改ざん・転送破損確認 |
| `package-manifest.json` | version、ソースhead SHA、architecture、署名状態、workflow run IDの記録 |

GitHub Actionsのartifact名は`live-board-windows-unsigned-<source head SHA>`です。Pull Requestでは一時的なmerge refではなく、変更元branchのhead SHAを使用します。保持期間は14日です。

## 3. パッケージ構成

```text
resources/
  app.asar/
    dist/                 Desktop Renderer
    dist-electron/        Electron Main / Preload
    node_modules/         production依存関係
  overlay/
    dist/                 OBS Browser Source
```

Desktop RendererとElectron Main / PreloadはASARへ格納します。

OBS Overlayはloopback HTTPサーバーが通常ファイルとして配信するため、`extraResources/overlay/dist`へ配置します。パッケージ時は`process.resourcesPath`を起点に解決し、開発時は従来どおり`apps/overlay/dist`を使用します。

## 4. ローカル生成

Windows上で実行します。

```powershell
corepack enable
corepack prepare pnpm@11.15.1 --activate
pnpm install --frozen-lockfile
pnpm package:win
```

ディレクトリ形式だけを確認する場合:

```powershell
pnpm package:win:dir
```

出力先:

```text
apps/desktop/release/
```

生成物はGit管理対象外です。

## 5. packaged smoke test

パッケージ済みexeは次の内部確認モードを持ちます。

```powershell
LiveBoard.exe --smoke-test --smoke-output=C:\temp\live-board-smoke.json
```

確認内容:

1. Rendererの`index.html`がASAR内に存在する
2. Overlayの`index.html`が`resources/overlay/dist`に存在する
3. 一時ディレクトリで永続化サービスを初期化できる
4. loopback限定OBS Bridgeを起動できる
5. token付きOverlay URLをHTTP取得できる
6. HTMLにReact rootが存在する
7. Bridgeを閉じ、一時データを削除できる

成功時は終了コード0と次のJSONを出力します。

```json
{
  "ok": true,
  "version": "0.1.0",
  "host": "127.0.0.1",
  "port": 49152,
  "overlayStatus": 200,
  "rendererIndex": "...",
  "overlayRoot": "..."
}
```

接続tokenやユーザーのファイルパスは結果へ含めません。

## 6. GitHub Actions

`.github/workflows/windows-package.yml`は次で実行します。

- 関連ファイルを変更するPull Request
- 関連ファイルが`main`へ反映されたとき
- `workflow_dispatch`による手動実行

処理:

1. frozen lockfileで依存関係を復元
2. Renderer、Overlay、Main / Preload、共有packageをproduction build
3. NSISとportableを生成
4. `win-unpacked/LiveBoard.exe`でpackaged smoke test
5. 成果物の件数・命名を検証
6. SHA-256とmanifestを生成
7. 未署名artifactとして保存

GitHub Releaseへの自動公開は行いません。artifactを実機検証し、配布判断を行った後に別タスクで公開します。

## 7. セキュリティと配布上の注意

### 未署名

現在のexeにはWindowsコード署名がありません。別端末ではSmartScreenやウイルス対策ソフトの警告が表示される可能性があります。

検証者へ渡す場合は次をセットで共有します。

- 対象commit SHA
- `SHA256SUMS.txt`
- `package-manifest.json`
- 未署名RCであること
- 検証目的と削除手順

警告回避のためにセキュリティ機能を恒久的に無効化する手順は案内しません。

### トークン

OBS URLには起動ごとのtokenが含まれます。パッケージ、manifest、smoke result、CIログへtokenを出力しません。

### ユーザーデータ

NSISアンインストールではユーザーデータを自動削除しません。誤操作によるWorkspace消失を避けるためです。完全削除手順は正式配布前に別途整備します。

## 8. 実機受け入れ手順

1. `SHA256SUMS.txt`でexeを検証する
2. portable版で起動・保存・OBS接続を確認する
3. NSIS版でインストール先変更、起動、アンインストールを確認する
4. `.liveboard`保存・再読込を確認する
5. OBS Browser Sourceへtoken付きURLを追加する
6. Page切り替え、Layer更新、画像配置を確認する
7. スリープ復帰とOBS再接続を確認する
8. 4K画像複数配置と長時間試験を実施する

## 9. 対象外

- コード署名証明書と秘密鍵管理
- SmartScreen reputation
- GitHub Release自動作成
- 自動更新
- `.liveboard`ファイル関連付け
- macOS / Linuxパッケージ
- 8時間実機試験の実施結果

正式公開前に、署名・バージョニング・リリースノート・脆弱性対応・ロールバック手順を別タスクで決定します。
