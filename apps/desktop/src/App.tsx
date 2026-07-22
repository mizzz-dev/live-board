import {
  DomainError,
  canRedoProject,
  canUndoProject,
  createAddPageCommand,
  createDeletePageCommand,
  createDuplicatePageCommand,
  createEmptyWorkspace,
  createMovePageCommand,
  createPage,
  createSelectBroadcastPageCommand,
  createSelectEditPageCommand,
  createWorkspaceCommandState,
  dispatchProjectCommand,
  getProjectHistory,
  redoProjectCommand,
  undoProjectCommand,
  type ProjectCommand,
} from '@live-board/domain';
import { useEffect, useState } from 'react';
import './page-controls.css';

const initialCommandState = createWorkspaceCommandState(
  createEmptyWorkspace('local-workspace'),
);

export function App() {
  const runtime = window.liveBoard?.getRuntimeInfo();
  const [commandState, setCommandState] = useState(initialCommandState);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(
    null,
  );
  const [securityStatusError, setSecurityStatusError] = useState(false);

  const workspace = commandState.workspace;
  const project =
    workspace.projects.find(
      (candidate) => candidate.id === workspace.activeProjectId,
    ) ?? workspace.projects[0]!;
  const editPage =
    project.pages.find((candidate) => candidate.id === project.activeEditPageId) ??
    project.pages[0]!;
  const broadcastPage =
    project.pages.find(
      (candidate) => candidate.id === project.activeBroadcastPageId,
    ) ?? project.pages[0]!;
  const editPageIndex = project.pages.findIndex((page) => page.id === editPage.id);
  const projectHistory = getProjectHistory(commandState, project.id);

  useEffect(() => {
    const liveBoardApi = window.liveBoard;

    if (liveBoardApi === undefined) {
      return;
    }

    let active = true;
    const requestId = globalThis.crypto.randomUUID();

    void liveBoardApi
      .getSecurityStatus(requestId)
      .then((status) => {
        if (active && status.requestId === requestId) {
          setSecurityStatus(status);
        }
      })
      .catch(() => {
        if (active) {
          setSecurityStatusError(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const obsBridgeLabel = securityStatusError
    ? 'OBSブリッジ: 起動確認失敗'
    : securityStatus === null
      ? runtime === undefined
        ? 'OBSブリッジ: Browser Preview'
        : 'OBSブリッジ: 起動確認中'
      : `OBSブリッジ: ${securityStatus.obsBridge.host}:${securityStatus.obsBridge.port}`;

  function executeCommand(command: ProjectCommand): void {
    try {
      setCommandState(dispatchProjectCommand(commandState, command));
      setDomainError(null);
    } catch (error: unknown) {
      setDomainError(
        error instanceof DomainError ? error.message : 'ページ操作に失敗しました',
      );
    }
  }

  function addPage(): void {
    const pageNumber = project.pages.length + 1;
    const page = createPage({
      id: createEntityId('page'),
      projectId: project.id,
      name: `ページ ${pageNumber}`,
    });

    executeCommand(
      createAddPageCommand(
        project.id,
        page,
        createCommandMetadata('page-add'),
      ),
    );
  }

  function duplicateEditPage(): void {
    const timestamp = new Date().toISOString();
    const duplicatedPage = createPage({
      ...editPage,
      id: createEntityId('page'),
      name: `${editPage.name} のコピー`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    executeCommand(
      createDuplicatePageCommand(
        project.id,
        editPage.id,
        duplicatedPage,
        createCommandMetadata('page-duplicate'),
      ),
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Live Board</h1>
          <p>{workspace.name}</p>
        </div>
        <div className="topbar-actions">
          <span className="status-dot" aria-hidden="true" />
          <span>{obsBridgeLabel}</span>
          <button
            type="button"
            disabled={editPage.id === broadcastPage.id}
            onClick={() =>
              executeCommand(
                createSelectBroadcastPageCommand(
                  project.id,
                  editPage.id,
                  createCommandMetadata('page-broadcast'),
                ),
              )
            }
          >
            配信ページに設定
          </button>
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
          {workspace.projects.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === project.id}
            >
              {candidate.name}
            </button>
          ))}
        </div>

        <section className="canvas-stage" aria-label="キャンバス">
          <div className="canvas-placeholder">
            <span>{editPage.name}</span>
            <strong>
              {editPage.width} × {editPage.height}
            </strong>
            <small>キャンバス準備完了 / 描画エンジンはIVR-242で実装します</small>
          </div>
        </section>

        <footer className="statusbar">
          <span>ズーム 100%</span>
          <span>編集: {editPage.name}</span>
          <span>配信: {broadcastPage.name}</span>
          <span>
            履歴: {projectHistory.past.length} / Redo {projectHistory.future.length}
          </span>
          <span>
            {runtime
              ? `${runtime.platform} / Electron ${runtime.versions.electron}`
              : 'Browser Preview'}
          </span>
          <span>
            {securityStatus === null
              ? 'Security: 確認中'
              : `Security: sandbox / 接続 ${securityStatus.obsBridge.connectionCount}`}
          </span>
        </footer>
      </main>

      <aside className="inspector" aria-label="ページとレイヤー">
        <section>
          <div className="panel-heading">
            <h2>ページ</h2>
            <button type="button" aria-label="ページを追加" onClick={addPage}>
              ＋
            </button>
          </div>

          <div className="history-actions" aria-label="ページ操作履歴">
            <button
              type="button"
              disabled={!canUndoProject(commandState, project.id)}
              onClick={() => {
                setCommandState(undoProjectCommand(commandState, project.id));
                setDomainError(null);
              }}
            >
              元に戻す
            </button>
            <button
              type="button"
              disabled={!canRedoProject(commandState, project.id)}
              onClick={() => {
                setCommandState(redoProjectCommand(commandState, project.id));
                setDomainError(null);
              }}
            >
              やり直す
            </button>
          </div>

          <div className="page-list">
            {project.pages.map((page) => {
              const isEditPage = page.id === project.activeEditPageId;
              const isBroadcastPage = page.id === project.activeBroadcastPageId;

              return (
                <button
                  key={page.id}
                  type="button"
                  className={`page-row${isEditPage ? ' active' : ''}`}
                  aria-pressed={isEditPage}
                  onClick={() =>
                    executeCommand(
                      createSelectEditPageCommand(
                        project.id,
                        page.id,
                        createCommandMetadata('page-select'),
                      ),
                    )
                  }
                >
                  <span className="page-thumbnail" aria-hidden="true" />
                  <span>
                    <strong>{page.name}</strong>
                    <small>
                      {[
                        isEditPage ? '編集中' : null,
                        isBroadcastPage ? '配信中' : null,
                      ]
                        .filter(Boolean)
                        .join('・') || '待機中'}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="page-actions" aria-label="選択ページの操作">
            <button type="button" onClick={duplicateEditPage}>
              複製
            </button>
            <button
              type="button"
              disabled={editPageIndex <= 0}
              onClick={() =>
                executeCommand(
                  createMovePageCommand(
                    project.id,
                    editPage.id,
                    editPageIndex - 1,
                    createCommandMetadata('page-move-up'),
                  ),
                )
              }
            >
              上へ
            </button>
            <button
              type="button"
              disabled={editPageIndex >= project.pages.length - 1}
              onClick={() =>
                executeCommand(
                  createMovePageCommand(
                    project.id,
                    editPage.id,
                    editPageIndex + 1,
                    createCommandMetadata('page-move-down'),
                  ),
                )
              }
            >
              下へ
            </button>
            <button
              type="button"
              disabled={project.pages.length === 1}
              onClick={() =>
                executeCommand(
                  createDeletePageCommand(
                    project.id,
                    editPage.id,
                    createCommandMetadata('page-delete'),
                  ),
                )
              }
            >
              削除
            </button>
          </div>

          <p className="domain-message" role="status" aria-live="polite">
            {domainError ?? 'ページ操作はCommand履歴へ記録されます'}
          </p>
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

function createEntityId(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function createCommandMetadata(prefix: string) {
  return {
    commandId: `${prefix}:${globalThis.crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
}
