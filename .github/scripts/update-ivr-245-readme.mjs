import { readFile, writeFile } from 'node:fs/promises';

const path = 'README.md';
let source = await readFile(path, 'utf8');

source = replaceOnce(
  source,
  'M3「永続化・復元」の`.liveboard`保存、自動保存、クラッシュ復元基盤まで実装しています。',
  'M3「保存・復旧・性能・配信操作性」の`.liveboard`永続化、配信ショートカット、Overlayテーマ、安全なカスタムCSS、性能試験基盤まで実装しています。',
);
source = replaceOnce(
  source,
  '- 最近使用、お気に入り、複製、インポート\n- lint、型検査、Unit Test、production build、E2E',
  `- 最近使用、お気に入り、複製、インポート
- Alt＋左右・番号指定による配信ページ切り替え
- 配信ページ固定と入力欄フォーカス中のショートカット抑止
- シンプル・イラスト・ホワイトボード・黒板・OBS優先プリセット
- 透過・ホワイトボード・黒板Overlayテーマ
- 外部URL・@ルール・壊れた構文を拒否するOverlay専用カスタムCSS
- 画面内ページだけをidle時間に生成する非同期サムネイル
- 100ページ・100Layer・4K画像・28,800回切り替えの性能試験
- lint、型検査、Unit Test、production build、E2E`,
);
source = replaceOnce(
  source,
  '画像AssetのHTTP分離配信、OBS差分転送、タイル化は後続Issueで実装します。',
  '画像AssetのHTTP分離配信、OBS差分転送、タイル化、実機8時間連続試験は後続工程で実施します。',
);
source = replaceOnce(
  source,
  '### OBSへの追加\n',
  `### 配信操作・Overlayテーマ

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
`,
);
source = replaceOnce(
  source,
  `- EditorとOverlayは描画時間、Layer cache hit / miss、snapshot受信遅延を計測します。
- CIでは1920×1080・10 Raster Layerの描画時間を取得し、250ms未満を退行防止基準とします。
- 60fpsの16.7msフレーム予算とOBS反映100ms以内は製品目標です。
- Windows上のElectron、実際のペンタブレット、OBS Browser Sourceを組み合わせた測定は配布・実機統合工程で行います。`,
  `- EditorとOverlayは描画時間、Layer cache hit / miss、snapshot受信遅延を計測します。
- CIでは1920×1080・10 Raster Layerの描画時間を取得し、250ms未満を退行防止基準とします。
- 100ページ切り替え判定0.716ms、100Layer投影1.599msをGitHub Actions上で計測しました。
- 4K画像4枚の理論RGBAメモリは約126.56MiBです。
- 28,800回の8時間相当切り替えはrevision欠番0件、保持Workspace 1件でした。
- これらはUbuntu / Node.js / Vitest上の状態遷移計測で、Windows Electron・OBS・GPUの実機値ではありません。
- 現時点ではCanvas 2Dを維持し、Worker / WebGLは性能予算の継続超過時だけ導入します。
- 詳細は[配信性能・長時間安定性試験](docs/performance.md)を参照してください。`,
);
source = replaceOnce(
  source,
  '- Archive上限は512MBで、500MB級データのWindows／電源断／ディスク不足実機試験は後続です。',
  `- Archive上限は512MBで、500MB級データのWindows／電源断／ディスク不足実機試験は後続です。
- カスタムCSSは任意CSS互換ではなく、外部通信と危険構文を拒否する制限付きサブセットです。
- 4K画像の126.56MiBはRGBA理論値で、実画像デコード・GPUコピー・Canvasキャッシュを含む実測値ではありません。
- 28,800回試験は8時間相当の高速状態遷移シミュレーションで、ElectronとOBSを実時間8時間稼働した試験ではありません。`,
);
source = replaceOnce(
  source,
  '`pnpm test:e2e`はDesktop RendererとOverlayのproduction buildをVite Previewで起動し、Page操作、Layer操作、Pointer描画、画像取り込み、SVG拒否、Asset重複排除、選択変形、描画Undo / Redo、Viewport操作、性能計測、Preview状態を確認します。',
  '`pnpm test:e2e`はDesktop RendererとOverlayのproduction buildをVite Previewで起動し、Page操作、Layer操作、Pointer描画、画像取り込み、SVG拒否、Asset重複排除、選択変形、描画Undo / Redo、Viewport操作、配信ショートカット、配信固定、危険CSS拒否、100ページ一覧、性能計測、Preview状態を確認します。',
);
source = replaceOnce(
  source,
  '- [永続化・自動保存・クラッシュ復元](docs/persistence.md)\n- [ロードマップ](docs/roadmap.md)',
  '- [永続化・自動保存・クラッシュ復元](docs/persistence.md)\n- [配信性能・長時間安定性試験](docs/performance.md)\n- [ロードマップ](docs/roadmap.md)',
);

await writeFile(path, source);

function replaceOnce(value, search, replacement) {
  const first = value.indexOf(search);
  if (first < 0) {
    if (value.includes(replacement)) return value;
    throw new Error(`README target not found: ${search.slice(0, 100)}`);
  }
  if (value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`README target is ambiguous: ${search.slice(0, 100)}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}
