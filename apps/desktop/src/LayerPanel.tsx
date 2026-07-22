import {
  canRedoLayer,
  canUndoLayer,
  createAddLayerCommand,
  createDeleteLayerCommand,
  createDuplicateLayerCommand,
  createLayer,
  createMergeLayersCommand,
  createMoveLayerCommand,
  createRenameLayerCommand,
  createSelectLayerCommand,
  createUpdateLayerCommand,
  dispatchLayerCommand,
  findLayer,
  getLayerDocument,
  getLayerHistory,
  getMergeDownSourceIds,
  getVisibleMergeSourceIds,
  listLayersInPaintOrder,
  redoLayerCommand,
  undoLayerCommand,
  type BlendMode,
  type Layer,
  type LayerCommand,
  type LayerId,
  type LayerType,
  type LayerWorkspaceCommandState,
  type Page,
  type Project,
  type RasterLayer,
} from '@live-board/domain';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import './layer-panel.css';

interface LayerPanelProps {
  state: LayerWorkspaceCommandState;
  project: Project;
  page: Page;
  setState: Dispatch<SetStateAction<LayerWorkspaceCommandState>>;
  onError: (message: string | null) => void;
}

const LAYER_TYPES: Array<{ type: LayerType; label: string }> = [
  { type: 'raster', label: 'ラスター' },
  { type: 'text', label: 'テキスト' },
  { type: 'image', label: '画像' },
  { type: 'shape', label: '図形' },
  { type: 'background', label: '背景' },
  { type: 'folder', label: 'フォルダー' },
];

const BLEND_MODES: Array<{ value: BlendMode; label: string }> = [
  { value: 'normal', label: '通常' },
  { value: 'multiply', label: '乗算' },
  { value: 'screen', label: 'スクリーン' },
  { value: 'add', label: '加算' },
  { value: 'overlay', label: 'オーバーレイ' },
];

export function LayerPanel({
  state,
  project,
  page,
  setState,
  onError,
}: LayerPanelProps) {
  const document = getLayerDocument(page);
  const orderedLayers = listLayersInPaintOrder(document);
  const activeLayer =
    document.activeLayerId === null
      ? null
      : document.layers.find((layer) => layer.id === document.activeLayerId) ?? null;
  const [selectedLayerIds, setSelectedLayerIds] = useState<LayerId[]>([]);

  useEffect(() => {
    setSelectedLayerIds([]);
  }, [page.id]);

  const folderOptions = useMemo(
    () => orderedLayers.filter((layer) => layer.type === 'folder'),
    [orderedLayers],
  );
  const history = getLayerHistory(state, page.id);

  function execute(command: LayerCommand): void {
    try {
      setState((current) => dispatchLayerCommand(current, command));
      onError(null);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : 'レイヤー操作に失敗しました');
    }
  }

  function add(type: LayerType): void {
    const parentId = activeLayer?.type === 'folder' ? activeLayer.id : null;
    const siblings = siblingIds(document, parentId);
    const id = createEntityId(`layer-${type}`);
    execute(
      createAddLayerCommand(
        project.id,
        page.id,
        createLayer({
          id,
          pageId: page.id,
          parentId,
          name: defaultLayerName(type, document.layers.length + 1),
          type,
          content: defaultContent(type),
        }),
        parentId,
        siblings.length,
        metadata('layer-add'),
      ),
    );
  }

  function duplicateActive(): void {
    if (activeLayer === null) {
      return;
    }
    const sourceIds = collectSubtreeIds(document.layers, activeLayer.id);
    const idMap = Object.fromEntries(
      sourceIds.map((sourceId) => [sourceId, createEntityId('layer-copy')]),
    );
    execute(
      createDuplicateLayerCommand(
        project.id,
        page.id,
        activeLayer.id,
        idMap,
        metadata('layer-duplicate'),
      ),
    );
  }

  function moveActive(direction: -1 | 1): void {
    if (activeLayer === null) {
      return;
    }
    const siblings = siblingIds(document, activeLayer.parentId);
    const index = siblings.indexOf(activeLayer.id);
    const targetIndex = direction < 0 ? index - 1 : index + 2;
    execute(
      createMoveLayerCommand(
        project.id,
        page.id,
        activeLayer.id,
        activeLayer.parentId,
        targetIndex,
        metadata(direction < 0 ? 'layer-up' : 'layer-down'),
      ),
    );
  }

  function merge(sourceIds: LayerId[], label: string): void {
    if (sourceIds.length < 2) {
      onError('結合するレイヤーを2件以上選択してください');
      return;
    }
    const sources = sourceIds.map((id) => findLayer(document, id));
    const commonParentId = sources.every(
      (layer) => layer.parentId === sources[0]?.parentId,
    )
      ? sources[0]?.parentId ?? null
      : null;
    const merged = createLayer({
      id: createEntityId('layer-merged'),
      pageId: page.id,
      parentId: commonParentId,
      name: label,
      type: 'raster',
      content: { sourceLayerIds: sourceIds },
    }) as RasterLayer;
    execute(
      createMergeLayersCommand(
        project.id,
        page.id,
        sourceIds,
        merged,
        metadata('layer-merge'),
      ),
    );
    setSelectedLayerIds([]);
  }

  return (
    <section className="layer-panel">
      <div className="panel-heading">
        <h2>レイヤー</h2>
        <span>{document.layers.length}件</span>
      </div>

      <div className="layer-type-actions" aria-label="レイヤー追加">
        {LAYER_TYPES.map(({ type, label }) => (
          <button key={type} type="button" onClick={() => add(type)}>
            {label}
          </button>
        ))}
      </div>

      <div className="history-actions" aria-label="レイヤー操作履歴">
        <button
          type="button"
          disabled={!canUndoLayer(state, page.id)}
          onClick={() => setState((current) => undoLayerCommand(current, project.id, page.id))}
        >
          Layerを元に戻す
        </button>
        <button
          type="button"
          disabled={!canRedoLayer(state, page.id)}
          onClick={() => setState((current) => redoLayerCommand(current, project.id, page.id))}
        >
          Layerをやり直す
        </button>
      </div>

      <div className="layer-list" role="tree" aria-label="レイヤーツリー">
        {orderedLayers.length === 0 ? (
          <div className="empty-panel">レイヤーはありません</div>
        ) : (
          orderedLayers.map((layer) => {
            const active = layer.id === document.activeLayerId;
            const selected = selectedLayerIds.includes(layer.id);
            return (
              <div
                key={layer.id}
                className={`layer-row${active ? ' active' : ''}`}
                role="treeitem"
                aria-selected={active}
                style={{ '--layer-depth': depthOf(layer, document.layers) } as React.CSSProperties}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  aria-label={`${layer.name}を結合対象に選択`}
                  onChange={() =>
                    setSelectedLayerIds((ids) =>
                      ids.includes(layer.id)
                        ? ids.filter((id) => id !== layer.id)
                        : [...ids, layer.id],
                    )
                  }
                />
                <button
                  type="button"
                  className="layer-select"
                  onClick={() =>
                    execute(
                      createSelectLayerCommand(
                        project.id,
                        page.id,
                        layer.id,
                        metadata('layer-select'),
                      ),
                    )
                  }
                >
                  <span>{layerTypeLabel(layer.type)}</span>
                  <strong>{layer.name}</strong>
                </button>
                <button
                  type="button"
                  aria-label={`${layer.name}の表示を切り替え`}
                  onClick={() =>
                    execute(
                      createUpdateLayerCommand(
                        project.id,
                        page.id,
                        layer.id,
                        { visible: !layer.visible },
                        metadata('layer-visible'),
                      ),
                    )
                  }
                >
                  {layer.visible ? '表示' : '非表示'}
                </button>
              </div>
            );
          })
        )}
      </div>

      {activeLayer !== null && (
        <div className="layer-properties">
          <label>
            名前
            <input
              key={`${activeLayer.id}:${activeLayer.name}`}
              defaultValue={activeLayer.name}
              onBlur={(event) => {
                const name = event.currentTarget.value.trim();
                if (name !== activeLayer.name && name.length > 0) {
                  execute(
                    createRenameLayerCommand(
                      project.id,
                      page.id,
                      activeLayer.id,
                      name,
                      metadata('layer-rename'),
                    ),
                  );
                }
              }}
            />
          </label>
          <label>
            不透明度 {Math.round(activeLayer.opacity * 100)}%
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(activeLayer.opacity * 100)}
              onChange={(event) =>
                execute(
                  createUpdateLayerCommand(
                    project.id,
                    page.id,
                    activeLayer.id,
                    { opacity: Number(event.currentTarget.value) / 100 },
                    metadata('layer-opacity'),
                  ),
                )
              }
            />
          </label>
          <label>
            合成モード
            <select
              value={activeLayer.blendMode}
              onChange={(event) =>
                execute(
                  createUpdateLayerCommand(
                    project.id,
                    page.id,
                    activeLayer.id,
                    { blendMode: event.currentTarget.value as BlendMode },
                    metadata('layer-blend'),
                  ),
                )
              }
            >
              {BLEND_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            親フォルダー
            <select
              value={activeLayer.parentId ?? ''}
              disabled={activeLayer.movementLocked || activeLayer.editLocked}
              onChange={(event) => {
                const parentId = event.currentTarget.value || null;
                execute(
                  createMoveLayerCommand(
                    project.id,
                    page.id,
                    activeLayer.id,
                    parentId,
                    siblingIds(document, parentId).length,
                    metadata('layer-parent'),
                  ),
                );
              }}
            >
              <option value="">ルート</option>
              {folderOptions
                .filter((folder) => folder.id !== activeLayer.id)
                .map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="layer-locks">
            {([
              ['editLocked', '編集ロック'],
              ['movementLocked', '移動ロック'],
              ['alphaLocked', '透明ピクセルロック'],
            ] as const).map(([property, label]) => (
              <label key={property}>
                <input
                  type="checkbox"
                  checked={activeLayer[property]}
                  onChange={(event) =>
                    execute(
                      createUpdateLayerCommand(
                        project.id,
                        page.id,
                        activeLayer.id,
                        { [property]: event.currentTarget.checked },
                        metadata(`layer-${property}`),
                      ),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            レイヤーカラー
            <input
              type="color"
              value={activeLayer.color ?? '#64748b'}
              onChange={(event) =>
                execute(
                  createUpdateLayerCommand(
                    project.id,
                    page.id,
                    activeLayer.id,
                    { color: event.currentTarget.value },
                    metadata('layer-color'),
                  ),
                )
              }
            />
          </label>
        </div>
      )}

      <div className="page-actions" aria-label="選択レイヤー操作">
        <button type="button" disabled={activeLayer === null} onClick={duplicateActive}>
          複製
        </button>
        <button
          type="button"
          disabled={activeLayer === null || !canMove(activeLayer, document, -1)}
          onClick={() => moveActive(-1)}
        >
          上へ
        </button>
        <button
          type="button"
          disabled={activeLayer === null || !canMove(activeLayer, document, 1)}
          onClick={() => moveActive(1)}
        >
          下へ
        </button>
        <button
          type="button"
          disabled={activeLayer === null}
          onClick={() =>
            activeLayer &&
            execute(
              createDeleteLayerCommand(
                project.id,
                page.id,
                activeLayer.id,
                metadata('layer-delete'),
              ),
            )
          }
        >
          削除
        </button>
        <button
          type="button"
          disabled={activeLayer === null}
          onClick={() => {
            if (activeLayer === null) return;
            try {
              merge(getMergeDownSourceIds(document, activeLayer.id), '下のレイヤーと結合');
            } catch (error: unknown) {
              onError(error instanceof Error ? error.message : '結合に失敗しました');
            }
          }}
        >
          下と結合
        </button>
        <button
          type="button"
          disabled={selectedLayerIds.length < 2}
          onClick={() => merge(selectedLayerIds, '選択レイヤーを結合')}
        >
          選択を結合
        </button>
        <button
          type="button"
          disabled={getVisibleMergeSourceIds(document).length < 2}
          onClick={() => merge(getVisibleMergeSourceIds(document), '表示レイヤーを結合')}
        >
          表示を結合
        </button>
      </div>

      <p className="domain-message" role="status" aria-live="polite">
        Layer履歴 {history.past.length} / Redo {history.future.length}
      </p>
    </section>
  );
}

function siblingIds(
  document: ReturnType<typeof getLayerDocument>,
  parentId: LayerId | null,
): LayerId[] {
  if (parentId === null) return document.rootLayerIds;
  const parent = findLayer(document, parentId);
  return parent.type === 'folder' ? parent.childLayerIds : [];
}

function collectSubtreeIds(layers: Layer[], rootId: LayerId): LayerId[] {
  const map = new Map(layers.map((layer) => [layer.id, layer]));
  const result: LayerId[] = [];
  const visit = (id: LayerId) => {
    const layer = map.get(id);
    if (layer === undefined) return;
    result.push(id);
    if (layer.type === 'folder') layer.childLayerIds.forEach(visit);
  };
  visit(rootId);
  return result;
}

function depthOf(layer: Layer, layers: Layer[]): number {
  const map = new Map(layers.map((candidate) => [candidate.id, candidate]));
  let depth = 0;
  let parentId = layer.parentId;
  while (parentId !== null && depth < 128) {
    depth += 1;
    parentId = map.get(parentId)?.parentId ?? null;
  }
  return depth;
}

function canMove(
  layer: Layer,
  document: ReturnType<typeof getLayerDocument>,
  direction: -1 | 1,
): boolean {
  if (layer.movementLocked || layer.editLocked) return false;
  const siblings = siblingIds(document, layer.parentId);
  const index = siblings.indexOf(layer.id);
  return direction < 0 ? index > 0 : index >= 0 && index < siblings.length - 1;
}

function defaultLayerName(type: LayerType, number: number): string {
  return `${layerTypeLabel(type)} ${number}`;
}

function layerTypeLabel(type: LayerType): string {
  return LAYER_TYPES.find((candidate) => candidate.type === type)?.label ?? type;
}

function defaultContent(type: LayerType): Record<string, unknown> {
  switch (type) {
    case 'text':
      return { text: 'テキスト', fontSize: 48, color: '#FFFFFF' };
    case 'shape':
      return { shape: 'rectangle', fill: '#FFFFFF', stroke: '#FFFFFF' };
    case 'background':
      return { color: '#00000000' };
    case 'image':
      return { assetId: null, width: 1920, height: 1080 };
    case 'raster':
      return { assetId: null, sourceLayerIds: [] };
    case 'folder':
      return {};
  }
}

function createEntityId(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function metadata(prefix: string) {
  return {
    commandId: `${prefix}:${globalThis.crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
}
