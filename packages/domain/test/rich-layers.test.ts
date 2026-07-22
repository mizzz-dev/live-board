import { describe, expect, it } from 'vitest';
import {
  createAddLayerCommand,
  createBroadcastSnapshot,
  createCanvasWorkspaceCommandState,
  createEmptyWorkspace,
  createLayer,
  createProjectAssetLibrary,
  createUpdateLayerContentCommand,
  dispatchLayerCommandWithCanvasHistory,
  dispatchLayerContentCommand,
  getLayerDocument,
  getRichTextContent,
  importProjectAsset,
  redoLayerCommand,
  undoLayerCommand,
  withRichImageContent,
  type ImageLayer,
  type TextLayer,
} from '../src/index.js';

const metadata = (id: string) => ({
  commandId: id,
  createdAt: '2026-07-22T00:00:00.000Z',
});

describe('Rich Layer', () => {
  it('文字内容更新をLayer Undo・Redoできる', () => {
    let state = createCanvasWorkspaceCommandState(createEmptyWorkspace('workspace-1'));
    const project = state.workspace.projects[0]!;
    const page = project.pages[0]!;
    const textLayer = createLayer({
      id: 'text-1',
      pageId: page.id,
      name: 'テキスト',
      type: 'text',
    }) as TextLayer;
    state = dispatchLayerCommandWithCanvasHistory(
      state,
      createAddLayerCommand(
        project.id,
        page.id,
        textLayer,
        null,
        0,
        metadata('add-text'),
      ),
    );

    const current = getRichTextContent(textLayer);
    state = dispatchLayerContentCommand(
      state,
      createUpdateLayerContentCommand(
        project.id,
        page.id,
        textLayer.id,
        {
          ...current,
          text: '配信用テキスト',
          fontWeight: 700,
          strokeColor: '#000000',
          strokeWidth: 2,
        },
        metadata('update-text'),
      ),
    );
    expect(readText(state, page.id)).toMatchObject({
      text: '配信用テキスト',
      fontWeight: 700,
      strokeWidth: 2,
    });

    state = undoLayerCommand(state, project.id, page.id);
    expect(readText(state, page.id).text).toBe('テキスト');

    state = redoLayerCommand(state, project.id, page.id);
    expect(readText(state, page.id).text).toBe('配信用テキスト');
  });

  it('OBSへ表示中Image Layerが参照するAssetだけを投影しファイル名を除外する', () => {
    let library = createProjectAssetLibrary();
    const first = importProjectAsset(library, {
      fileName: 'secret-local-name.svg',
      declaredMime: 'image/svg+xml',
      bytes: new TextEncoder().encode(
        '<svg viewBox="0 0 640 360"><rect width="640" height="360" /></svg>',
      ),
    });
    library = first.library;
    const unused = importProjectAsset(library, {
      fileName: 'unused.svg',
      declaredMime: 'image/svg+xml',
      bytes: new TextEncoder().encode(
        '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" /></svg>',
      ),
    });
    library = unused.library;

    const workspace = createEmptyWorkspace('workspace-1');
    const project = workspace.projects[0]!;
    const page = project.pages[0]!;
    const base = createLayer({
      id: 'image-1',
      pageId: page.id,
      name: '配信画像',
      type: 'image',
      content: {
        assetId: first.asset.id,
        width: first.asset.width,
        height: first.asset.height,
      },
    }) as ImageLayer;
    const image = withRichImageContent(base, {
      assetId: first.asset.id,
      width: first.asset.width,
      height: first.asset.height,
      crop: { x: 0, y: 0, width: first.asset.width, height: first.asset.height },
      flipX: false,
      flipY: false,
    });
    page.layerDocument = {
      layers: [image],
      rootLayerIds: [image.id],
      activeLayerId: image.id,
    };

    const snapshot = createBroadcastSnapshot(
      workspace,
      project.id,
      1,
      '2026-07-22T00:00:00.000Z',
      library,
    );
    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.assets?.[0]?.id).toBe(first.asset.id);
    expect(JSON.stringify(snapshot)).not.toContain('secret-local-name.svg');
    expect(JSON.stringify(snapshot)).not.toContain('unused.svg');
    expect(JSON.stringify(snapshot)).not.toContain('fileNames');
  });

  it('crop境界外と不正文字書式を拒否する', () => {
    const image = createLayer({
      id: 'image-1',
      pageId: 'page-1',
      name: '画像',
      type: 'image',
      content: { assetId: null, width: 100, height: 100 },
    }) as ImageLayer;
    expect(() => withRichImageContent(image, {
      crop: { x: 90, y: 0, width: 20, height: 20 },
    })).toThrow('INVALID_IMAGE_CROP');

    const text = createLayer({
      id: 'text-1',
      pageId: 'page-1',
      name: '文字',
      type: 'text',
    }) as TextLayer;
    const content = getRichTextContent(text);
    expect(() => createUpdateLayerContentCommand(
      'project-1',
      'page-1',
      text.id,
      { ...content, fontWeight: 450 },
      metadata('invalid-text'),
    )).not.toThrow();
    expect(() => dispatchLayerContentCommand(
      createCanvasWorkspaceCommandState(createEmptyWorkspace('workspace-2')),
      createUpdateLayerContentCommand(
        'project-1',
        'page-1',
        text.id,
        { ...content, fontWeight: 450 },
        metadata('invalid-text-dispatch'),
      ),
    )).toThrow();
  });
});

function readText(
  state: ReturnType<typeof createCanvasWorkspaceCommandState>,
  pageId: string,
) {
  const page = state.workspace.projects
    .flatMap((project) => project.pages)
    .find((candidate) => candidate.id === pageId)!;
  const layer = getLayerDocument(page).layers.find((candidate) => candidate.type === 'text') as TextLayer;
  return getRichTextContent(layer);
}
