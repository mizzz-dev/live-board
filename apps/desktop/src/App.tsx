import {
  DEFAULT_CANVAS_VIEWPORT,
  type BrushSettings,
  type CanvasToolId,
  type CanvasToolResult,
  type CanvasViewport,
  type RenderMetrics,
  type SnapSettings,
} from '@live-board/canvas-engine';
import {
  DomainError,
  canRedoCanvas,
  canRedoProject,
  canUndoCanvas,
  canUndoProject,
  cloneLayer,
  createAddLayerCommand,
  createAddPageCommand,
  createAddRasterFillCommand,
  createAddRasterStrokeCommand,
  createBroadcastSnapshot,
  createCanvasWorkspaceCommandState,
  createClearRasterCommand,
  createDeletePageCommand,
  createDuplicatePageCommand,
  createEmptyWorkspace,
  createLayer,
  createMovePageCommand,
  createPage,
  createPageRenderSnapshot,
  createSelectBroadcastPageCommand,
  createSelectEditPageCommand,
  dispatchCanvasCommand,
  dispatchLayerCommandWithCanvasHistory,
  dispatchProjectCommandWithCanvasHistory,
  getCanvasHistory,
  getCanvasHistoryBytes,
  getLayerDocument,
  getProjectHistory,
  redoCanvasCommand,
  redoProjectCommandWithCanvasHistory,
  undoCanvasCommand,
  undoProjectCommandWithCanvasHistory,
  type CanvasWorkspaceCommandState,
  type Layer,
  type LayerDocument,
  type LayerWorkspaceCommandState,
  type Page,
  type ProjectCommand,
} from '@live-board/domain';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { CanvasSurface } from './CanvasSurface';
import { LayerPanel } from './LayerPanel';
import './canvas-controls.css';
import './page-controls.css';

const initialCommandState = createCanvasWorkspaceCommandState(
  createEmptyWorkspace('local-workspace'),
);

const DEFAULT_BRUSH: BrushSettings = {
  color: '#FF3366',
  size: 24,
  opacity: 1,
  hardness: 0.9,
  spacing: 0.15,
  smoothing: 0.35,
  taperStart: 0,
  taperEnd: 0,
  pressureSize: true,
  pressureOpacity: false,
  fillTolerance: 24,
};

const DEFAULT_SNAP: SnapSettings = {
  enabled: false,
  gridSize: 50,
  guideX: [960],
  guideY: [540],
  threshold: 8,
};

const TOOL_BUTTONS: Array<{ id: CanvasToolId; label: string }> = [
  { id: 'pen', label: 'ペン' },
  { id: 'eraser', label: '消しゴム' },
  { id: 'bucket', label: 'バケツ' },
  { id: 'eyedropper', label: 'スポイト' },
  { id: 'pan', label: '手のひら' },
];

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
  const [toolId, setToolId] = useState<CanvasToolId>('pen');
  const [brush, setBrush] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [viewport, setViewport] = useState<CanvasViewport>(DEFAULT_CANVAS_VIEWPORT);
  const [snap, setSnap] = useState<SnapSettings>(DEFAULT_SNAP);
  const [gridVisible, setGridVisible] = useState(false);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics | null>(null);
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
  const canvasHistory = getCanvasHistory(commandState, editPage.id);
  const editLayerSignature = JSON.stringify(getLayerDocument(editPage));
  const broadcastLayerSignature = JSON.stringify(getLayerDocument(broadcastPage));
  const editSnapshot = useMemo(
    () => createPageRenderSnapshot(editPage, project.id),
    [
      editPage.id,
      editPage.name,
      editPage.width,
      editPage.height,
      editPage.dpi,
      editPage.transparent,
      editLayerSignature,
      project.id,
    ],
  );

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
    const snapshot = createBroadcastSnapshot(workspace, project.id, revision);
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

  const onRenderMetrics = useCallback((metrics: RenderMetrics) => {
    setRenderMetrics(metrics);
  }, []);

  const handleToolResult = useCallback(
    (result: Exclude<CanvasToolResult, null>) => {
      if (result.type === 'color') {
        setBrush((current) => ({ ...current, color: result.color }));
        return;
      }
      if (result.type === 'pan') return;
      try {
        setCommandState((current) =>
          applyDrawingResult(current, project.id, editPage.id, result),
        );
        setDomainError(null);
      } catch (error: unknown) {
        setDomainError(
          error instanceof Error ? error.message : '描画操作に失敗しました',
        );
      }
    },
    [project.id, editPage.id],
  );

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
        dispatchProjectCommandWithCanvasHistory(currentState, command),
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

  function clearRaster(): void {
    const activeLayerId = getLayerDocument(editPage).activeLayerId;
    if (activeLayerId === null) {
      setDomainError('消去するラスターLayerを選択してください');
      return;
    }
    try {
      setCommandState((current) =>
        dispatchCanvasCommand(
          current,
          createClearRasterCommand(
            project.id,
            editPage.id,
            activeLayerId,
            createCommandMetadata('raster-clear'),
          ),
        ),
      );
      setDomainError(null);
    } catch (error: unknown) {
      setDomainError(error instanceof Error ? error.message : '全消去に失敗しました');
    }
  }

  const layerPanelSetter = setCommandState as unknown as Dispatch<
    SetStateAction<LayerWorkspaceCommandState>
  >;

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

      <aside className="tool-rail" aria-label="描画ツール">
        {TOOL_BUTTONS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={toolId === tool.id ? 'active' : undefined}
            aria-pressed={toolId === tool.id}
            onClick={() => setToolId(tool.id)}
          >
            {tool.label}
          </button>
        ))}
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

        <div className="canvas-toolbar" aria-label="描画設定">
          <label>
            色
            <input
              aria-label="ブラシ色"
              type="color"
              value={brush.color.slice(0, 7)}
              onChange={(event) =>
                setBrush((current) => ({ ...current, color: event.currentTarget.value }))
              }
            />
          </label>
          <label>
            サイズ {brush.size}px
            <input
              aria-label="ブラシサイズ"
              type="range"
              min="1"
              max="200"
              value={brush.size}
              onChange={(event) =>
                setBrush((current) => ({
                  ...current,
                  size: Number(event.currentTarget.value),
                }))
              }
            />
          </label>
          <label>
            不透明度 {Math.round(brush.opacity * 100)}%
            <input
              aria-label="ブラシ不透明度"
              type="range"
              min="1"
              max="100"
              value={Math.round(brush.opacity * 100)}
              onChange={(event) =>
                setBrush((current) => ({
                  ...current,
                  opacity: Number(event.currentTarget.value) / 100,
                }))
              }
            />
          </label>
          <label>
            硬さ {Math.round(brush.hardness * 100)}%
            <input
              aria-label="ブラシ硬さ"
              type="range"
              min="0"
              max="100"
              value={Math.round(brush.hardness * 100)}
              onChange={(event) =>
                setBrush((current) => ({
                  ...current,
                  hardness: Number(event.currentTarget.value) / 100,
                }))
              }
            />
          </label>
          <label>
            手ぶれ補正 {Math.round(brush.smoothing * 100)}%
            <input
              aria-label="手ぶれ補正"
              type="range"
              min="0"
              max="100"
              value={Math.round(brush.smoothing * 100)}
              onChange={(event) =>
                setBrush((current) => ({
                  ...current,
                  smoothing: Number(event.currentTarget.value) / 100,
                }))
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={brush.pressureSize}
              onChange={(event) =>
                setBrush((current) => ({
                  ...current,
                  pressureSize: event.currentTarget.checked,
                }))
              }
            />
            筆圧でサイズ
          </label>
          <label>
            <input
              type="checkbox"
              checked={brush.pressureOpacity}
              onChange={(event) =>
                setBrush((current) => ({
                  ...current,
                  pressureOpacity: event.currentTarget.checked,
                }))
              }
            />
            筆圧で濃度
          </label>
          <button type="button" onClick={clearRaster}>Layer全消去</button>
        </div>

        <div className="viewport-toolbar" aria-label="キャンバス表示設定">
          <button
            type="button"
            onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.05, current.zoom / 1.25) }))}
          >
            縮小
          </button>
          <strong>{Math.round(viewport.zoom * 100)}%</strong>
          <button
            type="button"
            onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(32, current.zoom * 1.25) }))}
          >
            拡大
          </button>
          <button
            type="button"
            onClick={() => setViewport((current) => ({ ...current, rotation: current.rotation - 15 }))}
          >
            左回転
          </button>
          <button
            type="button"
            onClick={() => setViewport((current) => ({ ...current, rotation: current.rotation + 15 }))}
          >
            右回転
          </button>
          <button
            type="button"
            aria-pressed={viewport.flipX}
            onClick={() => setViewport((current) => ({ ...current, flipX: !current.flipX }))}
          >
            左右反転
          </button>
          <button
            type="button"
            onClick={() => setViewport(DEFAULT_CANVAS_VIEWPORT)}
          >
            表示リセット
          </button>
          <label>
            <input
              type="checkbox"
              checked={gridVisible}
              onChange={(event) => setGridVisible(event.currentTarget.checked)}
            />
            グリッド
          </label>
          <label>
            <input
              type="checkbox"
              checked={guidesVisible}
              onChange={(event) => setGuidesVisible(event.currentTarget.checked)}
            />
            ガイド
          </label>
          <label>
            <input
              type="checkbox"
              checked={snap.enabled}
              onChange={(event) =>
                setSnap((current) => ({ ...current, enabled: event.currentTarget.checked }))
              }
            />
            スナップ
          </label>
        </div>

        <section className="canvas-stage" aria-label="キャンバス">
          <CanvasSurface
            snapshot={editSnapshot}
            toolId={toolId}
            brush={brush}
            viewport={viewport}
            snap={snap}
            guidesVisible={guidesVisible}
            gridVisible={gridVisible}
            onViewportChange={setViewport}
            onToolResult={handleToolResult}
            onRenderMetrics={onRenderMetrics}
          />
        </section>

        <footer className="statusbar">
          <span>ズーム {Math.round(viewport.zoom * 100)}%</span>
          <span>編集: {editPage.name}</span>
          <span>配信: {broadcastPage.name}</span>
          <span>Page履歴: {projectHistory.past.length} / Redo {projectHistory.future.length}</span>
          <span>描画履歴: {canvasHistory.past.length} / Redo {canvasHistory.future.length}</span>
          <span>履歴メモリ: {formatBytes(getCanvasHistoryBytes(commandState, editPage.id))}</span>
          <span>
            描画: {renderMetrics === null ? '待機中' : `${renderMetrics.durationMs.toFixed(1)}ms / cache ${renderMetrics.cacheHits}:${renderMetrics.cacheMisses}`}
          </span>
          <span>{broadcastSyncLabel}</span>
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
            <button type="button" aria-label="ページを追加" onClick={addPage}>＋</button>
          </div>
          <div className="history-actions" aria-label="ページ操作履歴">
            <button
              type="button"
              disabled={!canUndoProject(commandState, project.id)}
              onClick={() => {
                setCommandState((current) =>
                  undoProjectCommandWithCanvasHistory(current, project.id),
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
                setCommandState((current) =>
                  redoProjectCommandWithCanvasHistory(current, project.id),
                );
                setDomainError(null);
              }}
            >
              Pageをやり直す
            </button>
          </div>
          <div className="history-actions" aria-label="描画操作履歴">
            <button
              type="button"
              disabled={!canUndoCanvas(commandState, editPage.id)}
              onClick={() =>
                setCommandState((current) =>
                  undoCanvasCommand(current, project.id, editPage.id),
                )
              }
            >
              描画を元に戻す
            </button>
            <button
              type="button"
              disabled={!canRedoCanvas(commandState, editPage.id)}
              onClick={() =>
                setCommandState((current) =>
                  redoCanvasCommand(current, project.id, editPage.id),
                )
              }
            >
              描画をやり直す
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
                      ].filter(Boolean).join('・') || '待機中'}
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
          setState={layerPanelSetter}
          onError={setDomainError}
        />

        <p className="domain-message" role="status" aria-live="polite">
          {domainError ?? 'Page・Layer・描画操作は別々の履歴へ記録されます'}
        </p>
      </aside>
    </div>
  );
}

function applyDrawingResult(
  state: CanvasWorkspaceCommandState,
  projectId: string,
  pageId: string,
  result: Extract<Exclude<CanvasToolResult, null>, { type: 'stroke' | 'fill' }>,
): CanvasWorkspaceCommandState {
  const project = state.workspace.projects.find((candidate) => candidate.id === projectId);
  const page = project?.pages.find((candidate) => candidate.id === pageId);
  if (project === undefined || page === undefined) throw new Error('描画ページが見つかりません');
  const document = getLayerDocument(page);
  const activeLayer = document.activeLayerId === null
    ? null
    : document.layers.find((layer) => layer.id === document.activeLayerId) ?? null;
  let nextState = state;
  let layerId = activeLayer?.type === 'raster' && !activeLayer.editLocked
    ? activeLayer.id
    : null;
  if (layerId === null) {
    layerId = createEntityId('layer-raster');
    const layer = createLayer({
      id: layerId,
      pageId,
      name: `描画 ${document.layers.length + 1}`,
      type: 'raster',
    });
    nextState = dispatchLayerCommandWithCanvasHistory(
      nextState,
      createAddLayerCommand(
        projectId,
        pageId,
        layer,
        null,
        document.rootLayerIds.length,
        createCommandMetadata('auto-raster-add'),
      ),
    );
  }
  const command = result.type === 'stroke'
    ? createAddRasterStrokeCommand(
        projectId,
        pageId,
        layerId,
        result.stroke,
        createCommandMetadata('stroke-add'),
      )
    : createAddRasterFillCommand(
        projectId,
        pageId,
        layerId,
        result.fill,
        createCommandMetadata('fill-add'),
      );
  return dispatchCanvasCommand(nextState, command);
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
