import {
  createEmptyWorkspace,
  createLayer,
  createProjectAssetLibrary,
  type RasterLayer,
} from '@live-board/domain';
import { describe, expect, it } from 'vitest';
import { duplicateLiveboardBundle } from '../src/index.js';

describe('Workspace duplicate Raster provenance', () => {
  it('削除済みLayer由来IDを複製先の名前空間へ移す', () => {
    const workspace = createEmptyWorkspace('workspace-original');
    const project = workspace.projects[0]!;
    const page = project.pages[0]!;
    const raster = createLayer({
      id: 'raster-current',
      pageId: page.id,
      name: '結合済みRaster',
      type: 'raster',
      content: {
        assetId: null,
        sourceLayerIds: ['deleted-layer-a', 'deleted-layer-b'],
      },
    }) as RasterLayer;
    page.layerDocument = {
      layers: [raster],
      rootLayerIds: [raster.id],
      activeLayerId: raster.id,
    };

    const duplicated = duplicateLiveboardBundle(
      {
        workspace,
        assetLibraries: {
          [project.id]: createProjectAssetLibrary(),
        },
      },
      'workspace-copy',
      '2026-07-23T00:00:00.000Z',
    );

    const copiedLayer = duplicated.workspace.projects[0]!.pages[0]!
      .layerDocument!.layers[0] as RasterLayer;
    expect(copiedLayer.id).not.toBe(raster.id);
    expect(copiedLayer.content.sourceLayerIds).toHaveLength(2);
    expect(copiedLayer.content.sourceLayerIds).not.toContain('deleted-layer-a');
    expect(copiedLayer.content.sourceLayerIds).not.toContain('deleted-layer-b');
    expect(
      copiedLayer.content.sourceLayerIds.every((id) =>
        id.startsWith('workspace-copy:page:1:source:'),
      ),
    ).toBe(true);
  });
});
