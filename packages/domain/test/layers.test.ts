import { describe, expect, it } from 'vitest';
import {
  addLayer,
  assertLayerDocumentIntegrity,
  canRedoLayer,
  canUndoLayer,
  createAddLayerCommand,
  createBroadcastLayers,
  createEmptyLayerDocument,
  createEmptyWorkspace,
  createLayer,
  createLayerWorkspaceCommandState,
  createMergeLayersCommand,
  createMoveLayerCommand,
  createUpdateLayerCommand,
  dispatchLayerCommand,
  duplicateLayerTree,
  getLayerDocument,
  getLayerHistory,
  mergeLayers,
  moveLayer,
  redoLayerCommand,
  undoLayerCommand,
  updateLayerProperties,
  type BlendMode,
  type LayerDocument,
  type RasterLayer,
} from '../src/index.js';

const timestamp = '2026-07-22T00:00:00.000Z';

function createContext() {
  const workspace = createEmptyWorkspace('workspace-layer-test');
  const project = workspace.projects[0]!;
  const page = project.pages[0]!;
  return { workspace, project, page };
}

function metadata(id: string) {
  return { commandId: id, createdAt: timestamp };
}

describe('Layer tree', () => {
  it('0・1・100レイヤーを保持できる', () => {
    const { page } = createContext();
    let document = createEmptyLayerDocument();
    assertLayerDocumentIntegrity(page.id, document);

    for (let index = 0; index < 100; index += 1) {
      const layer = createLayer({
        id: `layer-${index}`,
        pageId: page.id,
        name: `レイヤー ${index}`,
        type: 'raster',
        createdAt: timestamp,
      });
      document = addLayer(document, layer, null, document.rootLayerIds.length);
    }

    expect(document.layers).toHaveLength(100);
    expect(document.rootLayerIds).toHaveLength(100);
    expect(document.activeLayerId).toBe('layer-99');
    expect(() => assertLayerDocumentIntegrity(page.id, document)).not.toThrow();
  });

  it('深いフォルダーへ移動でき、循環移動を拒否する', () => {
    const { page } = createContext();
    let document = createEmptyLayerDocument();
    const folderA = createLayer({
      id: 'folder-a',
      pageId: page.id,
      name: 'フォルダーA',
      type: 'folder',
      createdAt: timestamp,
    });
    const folderB = createLayer({
      id: 'folder-b',
      pageId: page.id,
      name: 'フォルダーB',
      type: 'folder',
      createdAt: timestamp,
    });
    const raster = createLayer({
      id: 'raster-1',
      pageId: page.id,
      name: '線画',
      type: 'raster',
      createdAt: timestamp,
    });

    document = addLayer(document, folderA, null, 0);
    document = addLayer(document, folderB, 'folder-a', 0);
    document = addLayer(document, raster, 'folder-b', 0);

    expect(document.layers.find((layer) => layer.id === 'raster-1')?.parentId).toBe(
      'folder-b',
    );
    expect(() =>
      moveLayer(document, page.id, 'folder-a', 'folder-b', 0, timestamp),
    ).toThrow(/cycle|descendant|循環/i);
  });

  it('移動ロック・編集ロックとopacity境界を適用する', () => {
    const { page } = createContext();
    const layer = createLayer({
      id: 'locked-layer',
      pageId: page.id,
      name: 'ロック',
      type: 'raster',
      movementLocked: true,
      createdAt: timestamp,
    });
    const document = addLayer(createEmptyLayerDocument(), layer, null, 0);

    expect(() =>
      moveLayer(document, page.id, layer.id, null, 0, timestamp),
    ).toThrow(/locked/i);
    expect(() =>
      updateLayerProperties(
        document,
        page.id,
        layer.id,
        { opacity: 1.01 },
        timestamp,
      ),
    ).toThrow(/opacity/i);

    const hidden = updateLayerProperties(
      document,
      page.id,
      layer.id,
      { visible: false, movementLocked: false, opacity: 0 },
      timestamp,
    );
    expect(hidden.layers[0]).toMatchObject({ visible: false, opacity: 0 });
  });

  it.each<BlendMode>(['normal', 'multiply', 'screen', 'add', 'overlay'])(
    '%s合成モードを保持する',
    (blendMode) => {
      const { page } = createContext();
      const layer = createLayer({
        id: `layer-${blendMode}`,
        pageId: page.id,
        name: blendMode,
        type: 'shape',
        blendMode,
        createdAt: timestamp,
      });
      const document = addLayer(createEmptyLayerDocument(), layer, null, 0);
      expect(document.layers[0]?.blendMode).toBe(blendMode);
    },
  );

  it('フォルダーを子孫ごと複製する', () => {
    const { page } = createContext();
    let document = createEmptyLayerDocument();
    document = addLayer(
      document,
      createLayer({
        id: 'folder-original',
        pageId: page.id,
        name: '人物',
        type: 'folder',
        createdAt: timestamp,
      }),
      null,
      0,
    );
    document = addLayer(
      document,
      createLayer({
        id: 'child-original',
        pageId: page.id,
        name: '線画',
        type: 'raster',
        createdAt: timestamp,
      }),
      'folder-original',
      0,
    );

    const duplicated = duplicateLayerTree(
      document,
      page.id,
      'folder-original',
      (sourceId) => `${sourceId}-copy`,
      timestamp,
    );

    expect(duplicated.rootLayerIds).toEqual([
      'folder-original',
      'folder-original-copy',
    ]);
    expect(
      duplicated.layers.find((layer) => layer.id === 'child-original-copy')
        ?.parentId,
    ).toBe('folder-original-copy');
  });
});

describe('Layer command history', () => {
  it('Page単位でUndo・Redoし、別Pageへ影響しない', () => {
    const { workspace, project, page } = createContext();
    let state = createLayerWorkspaceCommandState(workspace);
    const layer = createLayer({
      id: 'page-one-layer',
      pageId: page.id,
      name: 'ページ1レイヤー',
      type: 'text',
      content: { text: 'Live Board' },
      createdAt: timestamp,
    });

    state = dispatchLayerCommand(
      state,
      createAddLayerCommand(
        project.id,
        page.id,
        layer,
        null,
        0,
        metadata('add-layer'),
      ),
    );
    expect(canUndoLayer(state, page.id)).toBe(true);
    expect(getLayerHistory(state, page.id).past).toHaveLength(1);

    state = undoLayerCommand(state, project.id, page.id);
    expect(getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers).toHaveLength(
      0,
    );
    expect(canRedoLayer(state, page.id)).toBe(true);

    state = redoLayerCommand(state, project.id, page.id);
    expect(getLayerDocument(state.workspace.projects[0]!.pages[0]!).layers).toHaveLength(
      1,
    );
  });

  it('破壊的結合をUndo・Redoできる', () => {
    const { workspace, project, page } = createContext();
    let state = createLayerWorkspaceCommandState(workspace);

    for (const id of ['lower', 'upper']) {
      state = dispatchLayerCommand(
        state,
        createAddLayerCommand(
          project.id,
          page.id,
          createLayer({
            id,
            pageId: page.id,
            name: id,
            type: 'raster',
            createdAt: timestamp,
          }),
          null,
          getLayerDocument(
            state.workspace.projects[0]!.pages[0]!,
          ).rootLayerIds.length,
          metadata(`add-${id}`),
        ),
      );
    }

    const mergedLayer = createLayer({
      id: 'merged',
      pageId: page.id,
      name: '結合レイヤー',
      type: 'raster',
      createdAt: timestamp,
    }) as RasterLayer;
    state = dispatchLayerCommand(
      state,
      createMergeLayersCommand(
        project.id,
        page.id,
        ['lower', 'upper'],
        mergedLayer,
        metadata('merge'),
      ),
    );
    expect(
      getLayerDocument(state.workspace.projects[0]!.pages[0]!).rootLayerIds,
    ).toEqual(['merged']);

    state = undoLayerCommand(state, project.id, page.id);
    expect(
      getLayerDocument(state.workspace.projects[0]!.pages[0]!).rootLayerIds,
    ).toEqual(['lower', 'upper']);

    state = redoLayerCommand(state, project.id, page.id);
    expect(
      getLayerDocument(state.workspace.projects[0]!.pages[0]!).rootLayerIds,
    ).toEqual(['merged']);
  });
});

describe('Broadcast layer projection', () => {
  it('非表示Layerと編集専用ロック情報をOBS DTOへ出さない', () => {
    const { page } = createContext();
    let document: LayerDocument = createEmptyLayerDocument();
    document = addLayer(
      document,
      createLayer({
        id: 'visible-text',
        pageId: page.id,
        name: '表示テキスト',
        type: 'text',
        editLocked: true,
        movementLocked: true,
        content: { text: '配信中' },
        createdAt: timestamp,
      }),
      null,
      0,
    );
    document = addLayer(
      document,
      createLayer({
        id: 'hidden-shape',
        pageId: page.id,
        name: '非表示図形',
        type: 'shape',
        visible: false,
        createdAt: timestamp,
      }),
      null,
      1,
    );

    const output = createBroadcastLayers(document);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ id: 'visible-text', type: 'text' });
    expect(output[0]).not.toHaveProperty('editLocked');
    expect(output[0]).not.toHaveProperty('movementLocked');
  });
});
