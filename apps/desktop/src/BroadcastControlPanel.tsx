import {
  MAX_OVERLAY_CUSTOM_CSS_LENGTH,
  type BroadcastOverlayTheme,
  type BroadcastPreset,
} from '@live-board/obs-protocol';
import { useEffect, useState } from 'react';
import type { BroadcastControlsController } from './useBroadcastControls';
import './broadcast-controls.css';

interface BroadcastControlPanelProps {
  controller: BroadcastControlsController;
}

const PRESETS: ReadonlyArray<{ value: BroadcastPreset; label: string }> = [
  { value: 'simple', label: 'シンプル配信' },
  { value: 'illustration', label: 'イラスト' },
  { value: 'whiteboard', label: 'ホワイトボード' },
  { value: 'blackboard', label: '黒板' },
  { value: 'obs-priority', label: 'OBS優先' },
];

const THEMES: ReadonlyArray<{ value: BroadcastOverlayTheme; label: string }> = [
  { value: 'transparent', label: '透過' },
  { value: 'whiteboard', label: 'ホワイトボード' },
  { value: 'blackboard', label: '黒板' },
];

export function BroadcastControlPanel({
  controller,
}: BroadcastControlPanelProps) {
  const [customCssDraft, setCustomCssDraft] = useState(controller.settings.customCss);
  const [customCssEnabled, setCustomCssEnabled] = useState(
    controller.settings.customCssEnabled,
  );

  useEffect(() => {
    setCustomCssDraft(controller.settings.customCss);
    setCustomCssEnabled(controller.settings.customCssEnabled);
  }, [controller.settings.customCss, controller.settings.customCssEnabled]);

  return (
    <section className="broadcast-control-panel" aria-label="配信操作設定">
      <div className="panel-heading">
        <h2>配信操作</h2>
        <span className={controller.locked ? 'broadcast-lock active' : 'broadcast-lock'}>
          {controller.locked ? '固定中' : '切替可能'}
        </span>
      </div>

      <div className="broadcast-navigation" aria-label="配信ページ切り替え">
        <button
          type="button"
          disabled={controller.locked || controller.pageCount < 2}
          onClick={() => controller.navigate({ type: 'previous' })}
        >
          前へ
        </button>
        <strong>
          {controller.activePageIndex + 1} / {controller.pageCount}
        </strong>
        <button
          type="button"
          disabled={controller.locked || controller.pageCount < 2}
          onClick={() => controller.navigate({ type: 'next' })}
        >
          次へ
        </button>
      </div>

      <button
        type="button"
        className="broadcast-lock-button"
        aria-pressed={controller.locked}
        onClick={controller.toggleLock}
      >
        {controller.locked ? '配信ページ固定を解除' : '配信ページを固定'}
      </button>

      <label className="broadcast-field">
        プリセット
        <select
          aria-label="配信プリセット"
          value={controller.settings.preset}
          onChange={(event) =>
            controller.applyPreset(event.currentTarget.value as BroadcastPreset)
          }
        >
          {PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <label className="broadcast-field">
        Overlayテーマ
        <select
          aria-label="Overlayテーマ"
          value={controller.settings.theme}
          onChange={(event) =>
            controller.setTheme(event.currentTarget.value as BroadcastOverlayTheme)
          }
        >
          {THEMES.map((theme) => (
            <option key={theme.value} value={theme.value}>
              {theme.label}
            </option>
          ))}
        </select>
      </label>

      <div className="broadcast-css-editor">
        <label>
          <span>Overlay専用カスタムCSS</span>
          <textarea
            aria-label="Overlay専用カスタムCSS"
            value={customCssDraft}
            maxLength={MAX_OVERLAY_CUSTOM_CSS_LENGTH}
            spellCheck={false}
            placeholder=".broadcast-canvas { filter: contrast(1.05); }"
            onChange={(event) => setCustomCssDraft(event.currentTarget.value)}
          />
        </label>
        <label className="broadcast-checkbox">
          <input
            type="checkbox"
            checked={customCssEnabled}
            onChange={(event) => setCustomCssEnabled(event.currentTarget.checked)}
          />
          カスタムCSSを有効化
        </label>
        <button
          type="button"
          onClick={() => controller.applyCustomCss(customCssDraft, customCssEnabled)}
        >
          CSSを安全性検証して適用
        </button>
        <small>
          外部URL、url()、@import、@font-face、壊れた括弧は拒否します。
        </small>
      </div>

      <p className="broadcast-shortcuts">
        Alt＋← / →: 前後、Alt＋1〜9 / 0: 番号、Alt＋L: 固定切替
      </p>
      <p className="broadcast-status" role="status" aria-live="polite">
        {controller.status}
      </p>
    </section>
  );
}
