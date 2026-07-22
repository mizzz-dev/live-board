import {
  createCanvasWorkspaceCommandState,
  type CanvasWorkspaceCommandState,
  type ProjectAssetLibrary,
} from '@live-board/domain';
import {
  createLiveboardArchive,
  duplicateLiveboardBundle,
  loadLiveboardArchive,
  type LiveboardBundle,
} from '@live-board/persistence';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

const AUTOSAVE_DEBOUNCE_MS = 2_000;
const APP_VERSION = '0.1.0';

export interface WorkspacePersistenceController {
  enabled: boolean;
  busy: boolean;
  status: string;
  error: string | null;
  document: PublicDocumentRecord | null;
  recentDocuments: PublicDocumentRecord[];
  recoveryCandidates: PublicRecoveryCandidate[];
  revision: number;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  open(): Promise<void>;
  importCopy(): Promise<void>;
  duplicateCurrent(): void;
  openRecent(documentId: string): Promise<void>;
  toggleFavorite(documentId: string, favorite: boolean): Promise<void>;
  restore(candidateId: string): Promise<void>;
  discard(candidateId: string): Promise<void>;
  refresh(): Promise<void>;
}

export function useWorkspacePersistence(input: {
  commandState: CanvasWorkspaceCommandState;
  assetLibraries: Record<string, ProjectAssetLibrary>;
  setCommandState: Dispatch<SetStateAction<CanvasWorkspaceCommandState>>;
  setAssetLibraries: Dispatch<
    SetStateAction<Record<string, ProjectAssetLibrary>>
  >;
}): WorkspacePersistenceController {
  const api = window.liveBoard;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    api === undefined ? '保存: Browser Preview' : '保存: 未保存',
  );
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<PublicDocumentRecord | null>(null);
  const [recentDocuments, setRecentDocuments] = useState<PublicDocumentRecord[]>([]);
  const [recoveryCandidates, setRecoveryCandidates] = useState<
    PublicRecoveryCandidate[]
  >([]);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const suppressNextChangeRef = useRef(false);
  const workspaceRef = useRef(input.commandState.workspace);
  const assetLibrariesRef = useRef(input.assetLibraries);

  workspaceRef.current = input.commandState.workspace;
  assetLibrariesRef.current = input.assetLibraries;

  const signature = useMemo(
    () =>
      JSON.stringify({
        workspace: input.commandState.workspace,
        assets: Object.fromEntries(
          Object.entries(input.assetLibraries).map(([projectId, library]) => [
            projectId,
            {
              totalBytes: library.totalBytes,
              assets: library.assets.map((asset) => ({
                id: asset.id,
                sha256: asset.sha256,
                fileNames: asset.fileNames,
              })),
            },
          ]),
        ),
      }),
    [input.commandState.workspace, input.assetLibraries],
  );
  const lastSignatureRef = useRef(signature);

  const refresh = useCallback(async (): Promise<void> => {
    if (api === undefined) return;
    const [recent, recovery] = await Promise.all([
      api.listRecentWorkspaces(globalThis.crypto.randomUUID()),
      api.listRecoveryCandidates(globalThis.crypto.randomUUID()),
    ]);
    setRecentDocuments(recent.documents);
    setRecoveryCandidates(recovery.candidates);
  }, [api]);

  useEffect(() => {
    if (api === undefined) return;
    let active = true;
    void refresh().catch((caught: unknown) => {
      if (active) setError(errorMessage(caught, '保存情報の取得に失敗しました'));
    });
    return () => {
      active = false;
    };
  }, [api, refresh]);

  useEffect(() => {
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;
    if (suppressNextChangeRef.current) {
      suppressNextChangeRef.current = false;
      return;
    }
    const nextRevision = revisionRef.current + 1;
    revisionRef.current = nextRevision;
    setRevision(nextRevision);
    if (api === undefined) {
      setStatus('保存: Browser Preview');
      return;
    }
    setStatus('保存: 変更あり');
    const workspaceId = workspaceRef.current.id;
    void api
      .appendWorkspaceOperation(
        globalThis.crypto.randomUUID(),
        workspaceId,
        nextRevision,
      )
      .catch((caught: unknown) => {
        setError(errorMessage(caught, '操作ジャーナルの記録に失敗しました'));
      });

    const timer = window.setTimeout(() => {
      try {
        const archive = createCurrentArchive(
          workspaceRef.current,
          assetLibrariesRef.current,
        );
        setStatus('保存: 自動保存中');
        void api
          .autosaveWorkspace(
            globalThis.crypto.randomUUID(),
            workspaceId,
            nextRevision,
            archive,
          )
          .then(() => {
            if (revisionRef.current === nextRevision) {
              setStatus('保存: 自動保存済み');
            }
            setError(null);
            return refresh();
          })
          .catch((caught: unknown) => {
            setStatus('保存: 自動保存失敗');
            setError(errorMessage(caught, '自動保存に失敗しました'));
          });
      } catch (caught: unknown) {
        setStatus('保存: 自動保存失敗');
        setError(errorMessage(caught, '自動保存データの生成に失敗しました'));
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [api, refresh, signature]);

  const applyBundle = useCallback(
    (bundle: LiveboardBundle, nextDocument: PublicDocumentRecord | null): void => {
      suppressNextChangeRef.current = true;
      revisionRef.current = 0;
      setRevision(0);
      input.setCommandState(createCanvasWorkspaceCommandState(bundle.workspace));
      input.setAssetLibraries(bundle.assetLibraries);
      setDocument(nextDocument);
      setStatus(nextDocument === null ? '保存: 未保存' : '保存: 読込済み');
      setError(null);
    },
    [input.setAssetLibraries, input.setCommandState],
  );

  const saveWithMode = useCallback(
    async (saveAs: boolean): Promise<void> => {
      if (api === undefined) return;
      setBusy(true);
      setStatus('保存: 保存中');
      try {
        const archive = createCurrentArchive(
          workspaceRef.current,
          assetLibrariesRef.current,
        );
        const response = await api.saveWorkspace({
          requestId: globalThis.crypto.randomUUID(),
          workspaceId: workspaceRef.current.id,
          revision: revisionRef.current,
          archive,
          documentId: saveAs ? undefined : document?.documentId,
          saveAs,
        });
        if (response.canceled) {
          setStatus(document === null ? '保存: 未保存' : '保存: 変更あり');
          return;
        }
        if (response.document === undefined) {
          throw new Error('保存結果にdocumentがありません');
        }
        setDocument(response.document);
        setStatus('保存: 明示保存済み');
        setError(null);
        await refresh();
      } catch (caught: unknown) {
        setStatus('保存: 失敗');
        setError(errorMessage(caught, 'ワークスペースの保存に失敗しました'));
      } finally {
        setBusy(false);
      }
    },
    [api, document, refresh],
  );

  const loadOpenResponse = useCallback(
    (response: WorkspaceOpenResponse): void => {
      if (response.canceled) return;
      if (response.archive === undefined || response.document === undefined) {
        throw new Error('読込結果が不完全です');
      }
      const loaded = loadLiveboardArchive(response.archive);
      applyBundle(
        {
          workspace: loaded.workspace,
          assetLibraries: loaded.assetLibraries,
        },
        response.document,
      );
    },
    [applyBundle],
  );

  const open = useCallback(async (): Promise<void> => {
    if (api === undefined) return;
    setBusy(true);
    setStatus('保存: 読込中');
    try {
      loadOpenResponse(
        await api.openWorkspace(globalThis.crypto.randomUUID()),
      );
      await refresh();
    } catch (caught: unknown) {
      setStatus('保存: 読込失敗');
      setError(errorMessage(caught, 'ワークスペースの読込に失敗しました'));
    } finally {
      setBusy(false);
    }
  }, [api, loadOpenResponse, refresh]);

  const importCopy = useCallback(async (): Promise<void> => {
    if (api === undefined) return;
    setBusy(true);
    setStatus('保存: インポート中');
    try {
      const response = await api.openWorkspace(globalThis.crypto.randomUUID());
      if (response.canceled) return;
      if (response.archive === undefined) throw new Error('Archiveがありません');
      const loaded = loadLiveboardArchive(response.archive);
      const duplicated = duplicateLiveboardBundle(
        {
          workspace: loaded.workspace,
          assetLibraries: loaded.assetLibraries,
        },
        createWorkspaceId('import'),
      );
      applyBundle(duplicated, null);
      setStatus('保存: インポート済み・未保存');
    } catch (caught: unknown) {
      setStatus('保存: インポート失敗');
      setError(errorMessage(caught, 'ワークスペースのインポートに失敗しました'));
    } finally {
      setBusy(false);
    }
  }, [api, applyBundle]);

  const duplicateCurrent = useCallback((): void => {
    try {
      applyBundle(
        duplicateLiveboardBundle(
          {
            workspace: workspaceRef.current,
            assetLibraries: assetLibrariesRef.current,
          },
          createWorkspaceId('copy'),
        ),
        null,
      );
      setStatus('保存: 複製済み・未保存');
    } catch (caught: unknown) {
      setError(errorMessage(caught, 'ワークスペースの複製に失敗しました'));
    }
  }, [applyBundle]);

  const openRecent = useCallback(
    async (documentId: string): Promise<void> => {
      if (api === undefined) return;
      setBusy(true);
      setStatus('保存: 最近使用を読込中');
      try {
        loadOpenResponse(
          await api.openRecentWorkspace(
            globalThis.crypto.randomUUID(),
            documentId,
          ),
        );
        await refresh();
      } catch (caught: unknown) {
        setStatus('保存: 読込失敗');
        setError(errorMessage(caught, '最近使用したファイルを開けませんでした'));
      } finally {
        setBusy(false);
      }
    },
    [api, loadOpenResponse, refresh],
  );

  const toggleFavorite = useCallback(
    async (documentId: string, favorite: boolean): Promise<void> => {
      if (api === undefined) return;
      try {
        await api.setWorkspaceFavorite(
          globalThis.crypto.randomUUID(),
          documentId,
          favorite,
        );
        await refresh();
      } catch (caught: unknown) {
        setError(errorMessage(caught, 'お気に入りの更新に失敗しました'));
      }
    },
    [api, refresh],
  );

  const restore = useCallback(
    async (candidateId: string): Promise<void> => {
      if (api === undefined) return;
      setBusy(true);
      setStatus('保存: 復元中');
      try {
        const response = await api.loadRecoveryCandidate(
          globalThis.crypto.randomUUID(),
          candidateId,
        );
        const loaded = loadLiveboardArchive(response.archive);
        applyBundle(
          {
            workspace: loaded.workspace,
            assetLibraries: loaded.assetLibraries,
          },
          null,
        );
        await api.discardRecoveryCandidate(
          globalThis.crypto.randomUUID(),
          candidateId,
          revisionRef.current,
        );
        setStatus('保存: 復元済み・未保存');
        await refresh();
      } catch (caught: unknown) {
        setStatus('保存: 復元失敗');
        setError(errorMessage(caught, 'クラッシュ復元に失敗しました'));
      } finally {
        setBusy(false);
      }
    },
    [api, applyBundle, refresh],
  );

  const discard = useCallback(
    async (candidateId: string): Promise<void> => {
      if (api === undefined) return;
      try {
        await api.discardRecoveryCandidate(
          globalThis.crypto.randomUUID(),
          candidateId,
          revisionRef.current,
        );
        await refresh();
      } catch (caught: unknown) {
        setError(errorMessage(caught, '復元候補の破棄に失敗しました'));
      }
    },
    [api, refresh],
  );

  return {
    enabled: api !== undefined,
    busy,
    status,
    error,
    document,
    recentDocuments,
    recoveryCandidates,
    revision,
    save: () => saveWithMode(false),
    saveAs: () => saveWithMode(true),
    open,
    importCopy,
    duplicateCurrent,
    openRecent,
    toggleFavorite,
    restore,
    discard,
    refresh,
  };
}

function createCurrentArchive(
  workspace: CanvasWorkspaceCommandState['workspace'],
  assetLibraries: Record<string, ProjectAssetLibrary>,
): Uint8Array {
  return createLiveboardArchive({
    workspace,
    assetLibraries,
    appVersion: APP_VERSION,
  });
}

function createWorkspaceId(kind: string): string {
  return `workspace-${kind}-${globalThis.crypto.randomUUID()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}
