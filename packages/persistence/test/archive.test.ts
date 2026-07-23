import {
  createEmptyWorkspace,
  createLayer,
  createProjectAssetLibrary,
  importProjectAsset,
  withRichImageContent,
  type ImageLayer,
  type ProjectAssetLibrary,
} from '@live-board/domain';
import { describe, expect, it } from 'vitest';
import {
  LIVEBOARD_MANIFEST_PATH,
  createLiveboardArchive,
  duplicateLiveboardBundle,
  loadLiveboardArchive,
  readStoredZip,
} from '../src/index.js';

const savedAt = '2026-07-23T00:00:00.000Z';

function createFixture() {
  const workspace = createEmptyWorkspace('workspace-1');
  const project = workspace.projects[0]!;
  const page = project.pages[0]!;
  const imported = importProjectAsset(createProjectAssetLibrary(), {
    fileName: 'cover.svg',
    declaredMime: 'image/svg+xml',
    createdAt: savedAt,
    bytes: new TextEncoder().encode(
      '<svg viewBox="0 0 640 360"><rect width="640" height="360" fill="#336699" /></svg>',
    ),
  });
  const base = createLayer({
    id: 'layer-image-1',
    pageId: page.id,
    name: 'cover.svg',
    type: 'image',
    createdAt: savedAt,
    content: {
      assetId: imported.asset.id,
      width: imported.asset.width,
      height: imported.asset.height,
    },
  }) as ImageLayer;
  const image = withRichImageContent(base, {
    assetId: imported.asset.id,
    width: imported.asset.width,
    height: imported.asset.height,
    crop: { x: 0, y: 0, width: 640, height: 360 },
    flipX: true,
    flipY: false,
  });
  image.transform = { x: 120, y: 80, scaleX: 0.5, scaleY: 0.5, rotation: 15 };
  page.layerDocument = {
    layers: [image],
    rootLayerIds: [image.id],
    activeLayerId: image.id,
  };
  const assetLibraries: Record<string, ProjectAssetLibrary> = {
    [project.id]: imported.library,
  };
  return { workspace, assetLibraries, imported };
}

describe('.liveboard archive', () => {
  it('manifestとAssetを分離してWorkspace全体を保存・再読込できる', () => {
    const fixture = createFixture();
    const archive = createLiveboardArchive({
      workspace: fixture.workspace,
      assetLibraries: fixture.assetLibraries,
      appVersion: '0.1.0',
      savedAt,
    });
    const entries = readStoredZip(archive);
    expect(entries.has(LIVEBOARD_MANIFEST_PATH)).toBe(true);
    expect([...entries.keys()].filter((path) => path.startsWith('assets/'))).toHaveLength(1);
    const manifestText = new TextDecoder().decode(entries.get(LIVEBOARD_MANIFEST_PATH)!);
    expect(manifestText).not.toContain('data:image');
    expect(manifestText).not.toContain('base64,');

    const loaded = loadLiveboardArchive(archive);
    expect(loaded.workspace).toEqual(fixture.workspace);
    expect(loaded.assetLibraries[fixture.workspace.projects[0]!.id]).toEqual(
      fixture.assetLibraries[fixture.workspace.projects[0]!.id],
    );
    expect(loaded.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded.migratedFromVersion).toBeNull();
  });

  it('空のAsset Libraryを含むWorkspaceを保存できる', () => {
    const workspace = createEmptyWorkspace('empty-workspace');
    const archive = createLiveboardArchive({ workspace, assetLibraries: {}, savedAt });
    const loaded = loadLiveboardArchive(archive);
    expect(loaded.workspace).toEqual(workspace);
    expect(loaded.assetLibraries[workspace.activeProjectId]).toEqual({
      assets: [],
      totalBytes: 0,
    });
  });

  it('既存Workspace IDと衝突した場合は明示した新IDへ安全に複製する', () => {
    const fixture = createFixture();
    const archive = createLiveboardArchive({
      workspace: fixture.workspace,
      assetLibraries: fixture.assetLibraries,
      savedAt,
    });
    const loaded = loadLiveboardArchive(archive, {
      existingWorkspaceIds: new Set(['workspace-1']),
      collisionWorkspaceId: 'workspace-imported',
      duplicatedAt: '2026-07-23T01:00:00.000Z',
    });
    expect(loaded.duplicatedBecauseOfCollision).toBe(true);
    expect(loaded.workspace.id).toBe('workspace-imported');
    expect(loaded.workspace.activeProjectId).toBe('workspace-imported:project:1');
    const project = loaded.workspace.projects[0]!;
    const page = project.pages[0]!;
    const layer = page.layerDocument!.layers[0]!;
    expect(project.workspaceId).toBe('workspace-imported');
    expect(page.projectId).toBe(project.id);
    expect(layer.pageId).toBe(page.id);
    expect(page.layerDocument!.rootLayerIds).toEqual([layer.id]);
    expect(loaded.assetLibraries[project.id]!.assets[0]!.id).toBe(fixture.imported.asset.id);
  });

  it('複製後も元Bundleを変更しない', () => {
    const fixture = createFixture();
    const before = JSON.stringify(fixture);
    const duplicated = duplicateLiveboardBundle(
      { workspace: fixture.workspace, assetLibraries: fixture.assetLibraries },
      'workspace-copy',
      savedAt,
    );
    expect(JSON.stringify(fixture)).toBe(before);
    expect(duplicated.workspace.id).toBe('workspace-copy');
    expect(duplicated.workspace.name).toContain('コピー');
  });

  it('衝突時に新しいWorkspace IDがなければ正式領域へ反映しない', () => {
    const fixture = createFixture();
    const archive = createLiveboardArchive({
      workspace: fixture.workspace,
      assetLibraries: fixture.assetLibraries,
      savedAt,
    });
    expect(() =>
      loadLiveboardArchive(archive, {
        existingWorkspaceIds: new Set(['workspace-1']),
      }),
    ).toThrow('Workspace IDが既存データと重複');
  });
});
