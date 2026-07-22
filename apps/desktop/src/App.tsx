import {
  DomainError,
  canRedoProject,
  canUndoProject,
  cloneLayer,
  createAddPageCommand,
  createBroadcastSnapshot,
  createDeletePageCommand,
  createDuplicatePageCommand,
  createEmptyWorkspace,
  createLayerWorkspaceCommandState,
  createMovePageCommand,
  createPage,
  createSelectBroadcastPageCommand,
  createSelectEditPageCommand,
  dispatchProjectCommandWithLayerHistory,
  getLayerDocument,
  getProjectHistory,
  redoProjectCommandWithLayerHistory,
  undoProjectCommandWithLayerHistory,
  type Layer,
  type LayerDocument,
  type Page,
  type ProjectCommand,
} from '@live-board/domain';
import { useEffect, useRef, useState } from 'react';
import { LayerPanel } from './LayerPanel';
import './page-controls.css';

const initialCommandState = createLayerWorkspaceCommandState(
  createEmptyWorkspace('local-workspace'),
);

type CopyStatus = 'idle' | 'copied' | 'error';

export function App() {
  const runtime = window.liveBoard?.getRuntimeInfo();
  const [commandState, setCommandState] = useState(initialCommandState);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [securityStatusError, setSecurityStatusError] = useState(false);
  const [broadcastRevision, setBroadcastRevision] = useState<number | null>(null);
  const [broadcastSyncError, setBroadcastSyncError] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const nextBroadcastRevisionRef = useRef(1);

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
  const broadcastLayerSignature = JSON.stringify(getLayerDocument(broadcastPage));

  useEffect(() => {
    const liveBoardApi = window.liveBoard;
    if (liveBoardApi === undefined) return;

    let active = true;
    const requestId = globalThis.crypto.randomUUID();
    void liveBoardApi
      .getSecurityStatus(requestId)
      .then((status) => {
        if (active && status.requestId === requestId) {
          nextBroadcastRevisionRef.current =
            (status.obsBridge.latestRevision ?? 0) + 1;
          setSecurityStatus(status);
        }
      })
      .catch(() => {
        if (active) setSecurityStatusError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const liveBoardApi = window.liveBoard;
    if (liveBoardApi === undefined || securityStatus === null) return;

    let active = true;
    const revision = nextBroadcastRevisionRef.current;
    nextBroadcastRevisionRef.current += 1;
    const requestId = globalThis.crypto.randomUUID();
    const snapshot = createBroadcastSnapshot(
      workspace,
      project.id,
      revision,
    );

    void liveBoardApi
      .publishBroadcastSnapshot(requestId, snapshot)
      .then((response) => {
        if (active && response.requestId === requestId) {
          setBroadcastRevision(response.acceptedRevision);
          setBroadcastSyncError(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setBroadcastSyncError(true);
        const refreshRequestId = globalThis.crypto.randomUUID();
        void liveBoardApi
          .getSecurityStatus(refreshRequestId)
          .then((status) => {
            if (active && status.requestId === refreshRequestId) {
              nextBroadcastRevisionRef.current =
                (status.obsBridge.latestRevision ?? 0) + 1;
              setSecurityStatus(status);
            }
          })
          .catch(() => {
            if (active) setSecurityStatusError(true);
          });
      });

    return () => {
      active = false;
    };
  }, [
    securityStatus,
    project.id,
    broadcastPage.id,
    broadcastPage.name,
    broadcastPage.width,
    broadcastPage.height,
    broadcastPage.dpi,
    broadcastPage.transparent,
    broadcastLayerSignature,
  ]);

  const obsBridgeLabel = securityStatusError
    ? 'OBSブリッジ: 起動確認失敗'
    : securityStatus === null
      ? runtime === undefined
        ? 'OBSブリッジ: Browser Preview'
        : 'OBSブリッジ: 起動確認中'
      : `OBSブリッジ: ${securityStatus.obsBridge.host}:${securityStatus.obsBridge.port}`;

  const broadcastSyncLabel = broadcastSyncError
    ? 'OBS同期: 再同期中'
    : broadcastRevision === null
      ? runtime === undefined
        ? 'OBS同期: Browser Preview'
        : 'OBS同期: 初期化中'
      : `OBS同期: revision ${broadcastRevision}`;

  function executeCommand(command: ProjectCommand): void {
    try {
      setCommandState((currentState) =>
        dispatchProjectCommandWithLayerHistory(currentState, command),
      );
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
    const pageId = createEntityId('page');
    const duplicatedPage: Page = {
      ...createPage({
        ...editPage,
        id: pageId,
        name: `${editPage.name} のコピー`,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      layerDocument: duplicateLayerDocument(editPage, pageId, timestamp),
    };

    executeCommand(
      createDuplicatePageCommand(
        project.id,
        editPage.id,
        duplicatedPage,
        createCommandMetadata('page-duplicate'),
      ),
    );
  }

  function copyObsSourceUrl(): void {
    const liveBoardApi = window.liveBoard;
    if (liveBoardApi === undefined) return;

    const requestId = globalThis.crypto.randomUUID();
    setCopyStatus('idle');
    void liveBoardApi
      .copyObsSourceUrl(requestId)
      .then((response) => {
        setCopyStatus(
          response.requestId === requestId && response.copied ? 'copied' : 'error',
        );
      })
      .catch(() => setCopyStatus('error'));
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
          <span>{broadcastSyncLabel}</span>
          <button
            type="button"
            disabled={window.liveBoard === undefined}
            onClick={copyObsSourceUrl}
          >
            {copyStatus === 'copied'
              ? 'OBS URLコピー済み'
              : copyStatus === 'error'
                ? 'OBS URLコピー失敗'
                : 'OBS URLをコピー'}
          </button>
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
            Page履歴: {projectHistory.past.length} / Redo {projectHistory.future.length}
          </span>
          <span>{broadcastSyncLabel}</span>
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
                setCommandState((currentState) =>
                  undoProjectCommandWithLayerHistory(currentState, project.id),
                );
                setDomainError(null);
              }}
            >
              Pageを元に戻す
            </button>
            <button
              type="button"
              disabled={!canRedoProject(commandState, project.id)}
              onClick={() => {
                setCommandState((currentState) =>
                  redoProjectCommandWithLayerHistory(currentState, project.id),
                );
                setDomainError(null);
              }}
            >
              Pageをやり直す
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
            <button type="button" onClick={duplicateEditPage}>複製</button>
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
        </section>

        <LayerPanel
          state={commandState}
          project={project}
          page={editPage}
          setState={setCommandState}
          onError={setDomainError}
        />

        <p className="domain-message" role="status" aria-live="polite">
          {domainError ?? 'Page操作とLayer操作は別々の履歴へ記録されます'}
        </p>
      </aside>
    </div>
  );
}

function duplicateLayerDocument(
  sourcePage: Page,
  targetPageId: string,
  timestamp: string,
): LayerDocument {
  const source = getLayerDocument(sourcePage);
  const idMap = new Map(
    source.layers.map((layer) => [layer.id, createEntityId('layer')]),
  );
  const layers = source.layers.map((layer) => {
    const copy = cloneLayer({
      ...layer,
      id: idMap.get(layer.id)!,
      pageId: targetPageId,
      parentId: layer.parentId === null ? null : idMap.get(layer.parentId)!,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as Layer);
    if (copy.type === 'folder') {
      copy.childLayerIds = copy.childLayerIds.map((id) => idMap.get(id)!);
    }
    return copy;
  });
  return {
    layers,
    rootLayerIds: source.rootLayerIds.map((id) => idMap.get(id)!),
    activeLayerId:
      source.activeLayerId === null ? null : idMap.get(source.activeLayerId)!,
  };
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
