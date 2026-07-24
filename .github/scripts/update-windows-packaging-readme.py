from pathlib import Path

path = Path('README.md')
text = path.read_text(encoding='utf-8')

replacements = {
    'M3「保存・復旧・性能・配信操作性」に加え、画像Asset分離配信とRenderer–Main／OBS OverlayのLayer差分転送まで実装しています。':
    'M3「保存・復旧・性能・配信操作性」に加え、画像Asset分離配信、Renderer–Main／OBS OverlayのLayer差分転送、Windows向け未署名RCパッケージ生成まで実装しています。',
    '- lint、型検査、Unit Test、production build、E2E\n':
    '- lint、型検査、Unit Test、production build、E2E\n- Windows x64向けNSISインストーラーとportable版の生成\n- パッケージ済みexeによる永続化・loopback Bridge・Overlay HTTP smoke test\n- Windows成果物のSHA-256一覧とソースhead SHA付きmanifest\n',
    'RendererからNode.js APIへ直接アクセスできない構成です。\n\n### 描画操作':
    '''RendererからNode.js APIへ直接アクセスできない構成です。

### Windows配布パッケージ

Windows 11上で未署名の検証用Release Candidateを生成できます。

```powershell
pnpm install --frozen-lockfile
pnpm package:win
```

出力先は`apps/desktop/release/`です。

- `Live-Board-Setup-<version>-x64.exe`: NSISインストーラー
- `Live-Board-Portable-<version>-x64.exe`: ポータブル版
- GitHub ActionsではSHA-256一覧と`package-manifest.json`を同梱したartifactを14日保持
- コード署名は未対応のため、SmartScreenやウイルス対策ソフトの警告が表示される可能性があります
- GitHub Releaseへの自動公開と自動更新は行いません

パッケージ済みexeは内部smoke testで、Renderer／Overlayの配置、永続化初期化、loopback OBS Bridge、token付きOverlay HTTP 200を確認します。詳細は[Windows配布パッケージ設計](docs/windows-packaging.md)を参照してください。

### 描画操作''',
    '- 28,800回試験は8時間相当の高速状態遷移シミュレーションで、ElectronとOBSを実時間8時間稼働した試験ではありません。\n':
    '- 28,800回試験は8時間相当の高速状態遷移シミュレーションで、ElectronとOBSを実時間8時間稼働した試験ではありません。\n- Windowsパッケージはコード未署名で、SmartScreen reputationを持ちません。正式配布には署名・リリース手順・ロールバック方針が必要です。\n- Windows Package CIのpackaged smoke testは永続化とloopback Overlay経路を確認しますが、実OBS、GPU、スリープ復帰、長時間操作の代替ではありません。\n- CI artifactはソースhead SHAへ紐付けて14日保持し、GitHub Releaseへ自動公開しません。\n',
    'pnpm test:e2e\n```':
    'pnpm test:e2e\npnpm package:win  # Windowsのみ\n```',
    'ElectronプロセスとOBS実機を組み合わせた自動試験は配布設定と合わせて後続で追加します。':
    'Windows Package CIはパッケージ済みElectron Main、永続化初期化、loopback Bridge、Overlay HTTP取得を自動確認します。実OBS Browser Source、GPU、スリープ復帰、8時間連続試験は後続で実施します。',
    '- [配信性能・長時間安定性試験](docs/performance.md)\n':
    '- [配信性能・長時間安定性試験](docs/performance.md)\n- [Windows配布パッケージ](docs/windows-packaging.md)\n',
}

for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:80]}')
    text = text.replace(old, new)

path.write_text(text, encoding='utf-8')
