import { createEmptyWorkspace } from '@live-board/domain';

const workspace = createEmptyWorkspace('local-workspace');
const project = workspace.projects[0];
const page = project?.pages[0];

export function App() {
  const runtime = window.liveBoard?.getRuntimeInfo();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Live Board</h1>
          <p>{workspace.name}</p>
        </div>
        <div className="topbar-actions">
          <span className="status-dot" aria-hidden="true" />
          <span>OBS: 未接続</span>
          <button type="button">配信ページを固定</button>
        </div>
      </header>

      <aside className="tool-rail" aria-label="ツール">
        {['ペン', '消しゴム', 'バケツ', 'スポイト', '文字', '図形'].map(
          (tool, index) => (
            <button
              key={tool}
              type="button"
              className={index === 0 ? 'active' : undefined}
            >
              {tool}
            </button>
          ),
        )}
      </aside>

      <main className="workspace">
        <div className="document-tabs" role="tablist" aria-label="プロジェクト">
          <button type="button" role="tab" aria-selected="true">
            {project?.name ?? 'プロジェクト'}
          </button>
        </div>

        <section className="canvas-stage" aria-label="キャンバス">
          <div className="canvas-placeholder">
            <span>キャンバス準備完了</span>
            <strong>
              {page?.width ?? 1920} × {page?.height ?? 1080}
            </strong>
            <small>描画エンジンはIVR-242で実装します</small>
          </div>
        </section>

        <footer className="statusbar">
          <span>ズーム 100%</span>
          <span>編集: {page?.name ?? 'ページ 1'}</span>
          <span>配信: {page?.name ?? 'ページ 1'}</span>
          <span>
            {runtime
              ? `${runtime.platform} / Electron ${runtime.versions.electron}`
              : 'Browser Preview'}
          </span>
        </footer>
      </main>

      <aside className="inspector" aria-label="ページとレイヤー">
        <section>
          <div className="panel-heading">
            <h2>ページ</h2>
            <button type="button" aria-label="ページを追加">
              ＋
            </button>
          </div>
          <button type="button" className="page-row active">
            <span className="page-thumbnail" aria-hidden="true" />
            <span>
              <strong>{page?.name ?? 'ページ 1'}</strong>
              <small>編集・配信中</small>
            </span>
          </button>
        </section>

        <section>
          <div className="panel-heading">
            <h2>レイヤー</h2>
            <button type="button" aria-label="レイヤーを追加">
              ＋
            </button>
          </div>
          <div className="empty-panel">レイヤー基盤はIVR-241で実装します</div>
        </section>
      </aside>
    </div>
  );
}
