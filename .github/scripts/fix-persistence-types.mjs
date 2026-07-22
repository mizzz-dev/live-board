import { readFile, writeFile } from 'node:fs/promises';

await patch('apps/desktop/electron/contracts.ts', [
  ['  documentId?: string;\n', '  documentId?: string | undefined;\n'],
]);

await patch('apps/desktop/electron/persistence-service.ts', [
  ['  documentId?: string;\n  targetPath?: string;\n', '  documentId?: string | undefined;\n  targetPath?: string | undefined;\n'],
]);

await patch('apps/desktop/electron/preload.ts', [
  ['    documentId?: string;\n', '    documentId?: string | undefined;\n'],
  ['  saveWorkspace: (input): Promise<WorkspaceSaveResponse> =>\n', '  saveWorkspace: (input: Parameters<LiveBoardApi[\'saveWorkspace\']>[0]): Promise<WorkspaceSaveResponse> =>\n'],
  ['  openWorkspace: (requestId): Promise<WorkspaceOpenResponse> =>\n', '  openWorkspace: (requestId: string): Promise<WorkspaceOpenResponse> =>\n'],
  ['  openRecentWorkspace: (requestId, documentId): Promise<WorkspaceOpenResponse> =>\n', '  openRecentWorkspace: (requestId: string, documentId: string): Promise<WorkspaceOpenResponse> =>\n'],
  ['  listRecentWorkspaces: (requestId): Promise<WorkspaceListRecentResponse> =>\n', '  listRecentWorkspaces: (requestId: string): Promise<WorkspaceListRecentResponse> =>\n'],
  ['    requestId,\n    documentId,\n    favorite,\n  ): Promise<WorkspaceSetFavoriteResponse> =>\n', '    requestId: string,\n    documentId: string,\n    favorite: boolean,\n  ): Promise<WorkspaceSetFavoriteResponse> =>\n'],
  ['    requestId,\n    workspaceId,\n    revision,\n  ): Promise<WorkspaceMutationResponse> =>\n', '    requestId: string,\n    workspaceId: string,\n    revision: number,\n  ): Promise<WorkspaceMutationResponse> =>\n'],
  ['    requestId,\n    workspaceId,\n    revision,\n    archive,\n  ): Promise<WorkspaceMutationResponse> =>\n', '    requestId: string,\n    workspaceId: string,\n    revision: number,\n    archive: Uint8Array,\n  ): Promise<WorkspaceMutationResponse> =>\n'],
  ['  listRecoveryCandidates: (requestId): Promise<RecoveryListResponse> =>\n', '  listRecoveryCandidates: (requestId: string): Promise<RecoveryListResponse> =>\n'],
  ['    requestId,\n    candidateId,\n  ): Promise<RecoveryLoadResponse> =>\n', '    requestId: string,\n    candidateId: string,\n  ): Promise<RecoveryLoadResponse> =>\n'],
  ['    requestId,\n    candidateId,\n    revision,\n  ): Promise<WorkspaceMutationResponse> =>\n', '    requestId: string,\n    candidateId: string,\n    revision: number,\n  ): Promise<WorkspaceMutationResponse> =>\n'],
]);

async function patch(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [search, replacement] of replacements) {
    const count = source.split(search).length - 1;
    if (count !== 1) throw new Error(`${path}: expected one match, got ${count}: ${search.slice(0, 60)}`);
    source = source.replace(search, replacement);
  }
  await writeFile(path, source);
}
