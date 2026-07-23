import {
  applyBroadcastPresetToWorkspace,
  getBroadcastOverlaySettings,
  navigateBroadcastPage,
  resolveBroadcastShortcut,
  selectBroadcastPageSafely,
  setBroadcastPageLocked,
  setBroadcastTheme,
  updateBroadcastOverlaySettings,
  type BroadcastNavigationAction,
  type CanvasWorkspaceCommandState,
} from '@live-board/domain';
import {
  sanitizeOverlayCustomCss,
  type BroadcastOverlaySettings,
  type BroadcastOverlayTheme,
  type BroadcastPreset,
} from '@live-board/obs-protocol';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

interface UseBroadcastControlsOptions {
  commandState: CanvasWorkspaceCommandState;
  setCommandState: Dispatch<SetStateAction<CanvasWorkspaceCommandState>>;
  projectId: string;
}

export interface BroadcastControlsController {
  settings: BroadcastOverlaySettings;
  locked: boolean;
  activePageIndex: number;
  pageCount: number;
  status: string;
  navigate(action: BroadcastNavigationAction): void;
  selectPage(pageId: string): void;
  toggleLock(): void;
  applyPreset(preset: BroadcastPreset): void;
  setTheme(theme: BroadcastOverlayTheme): void;
  applyCustomCss(css: string, enabled: boolean): boolean;
}

export function useBroadcastControls({
  commandState,
  setCommandState,
  projectId,
}: UseBroadcastControlsOptions): BroadcastControlsController {
  const stateRef = useRef(commandState);
  stateRef.current = commandState;
  const [status, setStatus] = useState('配信ショートカット: Alt＋← / →、Alt＋1〜9 / 0');
  const project = commandState.workspace.projects.find(
    (candidate) => candidate.id === projectId,
  ) ?? commandState.workspace.projects[0]!;
  const settings = useMemo(
    () => getBroadcastOverlaySettings(project),
    [project.broadcastSettings],
  );
  const activePageIndex = project.pages.findIndex(
    (page) => page.id === project.activeBroadcastPageId,
  );

  const commitWorkspace = useCallback(
    (workspace: CanvasWorkspaceCommandState['workspace']) => {
      const current = stateRef.current;
      if (workspace === current.workspace) return;
      const next = { ...current, workspace };
      stateRef.current = next;
      setCommandState(next);
    },
    [setCommandState],
  );

  const navigate = useCallback(
    (action: BroadcastNavigationAction) => {
      const current = stateRef.current;
      const result = navigateBroadcastPage(current.workspace, projectId, action);
      commitWorkspace(result.workspace);
      if (result.reason === 'locked') {
        setStatus('配信ページは固定中です。Alt＋Lで解除できます');
      } else if (result.reason === 'page-out-of-range') {
        setStatus('指定番号の配信ページは存在しません');
      } else if (result.reason === 'changed') {
        setStatus('配信ページを切り替えました');
      }
    },
    [commitWorkspace, projectId],
  );

  const selectPage = useCallback(
    (pageId: string) => {
      const current = stateRef.current;
      const result = selectBroadcastPageSafely(current.workspace, projectId, pageId);
      commitWorkspace(result.workspace);
      setStatus(
        result.reason === 'locked'
          ? '配信ページは固定中です。解除してから切り替えてください'
          : result.reason === 'changed'
            ? '編集中ページを配信ページへ設定しました'
            : 'このページは既に配信中です',
      );
    },
    [commitWorkspace, projectId],
  );

  const toggleLock = useCallback(() => {
    const current = stateRef.current;
    const activeProject = current.workspace.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (activeProject === undefined) return;
    const locked = !activeProject.broadcastPageLocked;
    commitWorkspace(
      setBroadcastPageLocked(current.workspace, projectId, locked),
    );
    setStatus(locked ? '配信ページを固定しました' : '配信ページの固定を解除しました');
  }, [commitWorkspace, projectId]);

  const applyPreset = useCallback(
    (preset: BroadcastPreset) => {
      const current = stateRef.current;
      commitWorkspace(
        applyBroadcastPresetToWorkspace(current.workspace, projectId, preset),
      );
      setStatus(`配信プリセットを「${presetLabel(preset)}」へ変更しました`);
    },
    [commitWorkspace, projectId],
  );

  const changeTheme = useCallback(
    (theme: BroadcastOverlayTheme) => {
      const current = stateRef.current;
      commitWorkspace(setBroadcastTheme(current.workspace, projectId, theme));
      setStatus(`Overlayテーマを「${themeLabel(theme)}」へ変更しました`);
    },
    [commitWorkspace, projectId],
  );

  const applyCustomCss = useCallback(
    (css: string, enabled: boolean): boolean => {
      const sanitized = sanitizeOverlayCustomCss(css);
      if (!sanitized.accepted) {
        setStatus(`カスタムCSSを適用できません: ${sanitized.reason ?? '不正なCSSです'}`);
        return false;
      }
      const current = stateRef.current;
      commitWorkspace(
        updateBroadcastOverlaySettings(current.workspace, projectId, {
          customCss: sanitized.css,
          customCssEnabled: enabled && sanitized.css.length > 0,
          customCssFallback: false,
        }),
      );
      setStatus(
        enabled && sanitized.css.length > 0
          ? '安全性検証後のカスタムCSSを適用しました'
          : 'カスタムCSSを無効化しました',
      );
      return true;
    },
    [commitWorkspace, projectId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const action = resolveBroadcastShortcut(event);
      if (action === null) return;
      event.preventDefault();
      if (action.type === 'toggle-lock') toggleLock();
      else navigate(action);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, toggleLock]);

  return {
    settings,
    locked: project.broadcastPageLocked,
    activePageIndex,
    pageCount: project.pages.length,
    status,
    navigate,
    selectPage,
    toggleLock,
    applyPreset,
    setTheme: changeTheme,
    applyCustomCss,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

function presetLabel(preset: BroadcastPreset): string {
  switch (preset) {
    case 'simple': return 'シンプル配信';
    case 'illustration': return 'イラスト';
    case 'whiteboard': return 'ホワイトボード';
    case 'blackboard': return '黒板';
    case 'obs-priority': return 'OBS優先';
  }
}

function themeLabel(theme: BroadcastOverlayTheme): string {
  if (theme === 'whiteboard') return 'ホワイトボード';
  if (theme === 'blackboard') return '黒板';
  return '透過';
}
