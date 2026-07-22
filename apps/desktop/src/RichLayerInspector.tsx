import {
  createCanvasSelection,
  moveSelection,
  rotateSelection,
  scaleSelection,
  type CanvasSelection,
} from '@live-board/canvas-engine';
import {
  createTransformLayerCommand,
  createUpdateLayerContentCommand,
  dispatchCanvasCommand,
  dispatchLayerContentCommand,
  getLayerDocument,
  getLayerLocalBounds,
  getLayerTransform,
  getRichImageContent,
  getRichShapeContent,
  getRichTextContent,
  type CanvasWorkspaceCommandState,
  type ImageLayer,
  type Page,
  type Project,
  type RichImageContent,
  type RichShapeContent,
  type RichTextContent,
  type ShapeLayer,
  type TextLayer,
} from '@live-board/domain';
import type { Dispatch, SetStateAction } from 'react';
import './rich-layer-inspector.css';

interface RichLayerInspectorProps {
  state: CanvasWorkspaceCommandState;
  project: Project;
  page: Page;
  selection: CanvasSelection | null;
  setSelection: Dispatch<SetStateAction<CanvasSelection | null>>;
  setState: Dispatch<SetStateAction<CanvasWorkspaceCommandState>>;
  onError(message: string | null): void;
}

export function RichLayerInspector({
  state,
  project,
  page,
  selection,
  setSelection,
  setState,
  onError,
}: RichLayerInspectorProps) {
  const document = getLayerDocument(page);
  const layer = document.activeLayerId === null
    ? null
    : document.layers.find((candidate) => candidate.id === document.activeLayerId) ?? null;
  if (layer === null || layer.type === 'folder') return null;
  const transform = getLayerTransform(layer);

  function updateContent(content: RichTextContent | RichImageContent | RichShapeContent): void {
    try {
      setState((current) => dispatchLayerContentCommand(
        current,
        createUpdateLayerContentCommand(
          project.id,
          page.id,
          layer!.id,
          content,
          metadata('layer-content'),
        ),
      ));
      onError(null);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : 'Layer内容の更新に失敗しました');
    }
  }

  function updateTransform(next: typeof transform): void {
    try {
      setState((current) => dispatchCanvasCommand(
        current,
        createTransformLayerCommand(
          project.id,
          page.id,
          layer!.id,
          next,
          metadata('layer-transform'),
        ),
      ));
      onError(null);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : 'Layer変形に失敗しました');
    }
  }

  function selectLayerBounds(): void {
    const bounds = getLayerLocalBounds(layer!);
    const width = Math.max(1, bounds.width * Math.abs(transform.scaleX));
    const height = Math.max(1, bounds.height * Math.abs(transform.scaleY));
    setSelection(createCanvasSelection('rectangle', [
      { x: transform.x, y: transform.y },
      { x: transform.x + width, y: transform.y + height },
    ]));
  }

  function transformSelection(action: 'left' | 'right' | 'up' | 'down' | 'grow' | 'shrink' | 'rotate-left' | 'rotate-right'): void {
    if (selection === null) return;
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      const dx = action === 'left' ? -10 : action === 'right' ? 10 : 0;
      const dy = action === 'up' ? -10 : action === 'down' ? 10 : 0;
      setSelection((current) => current === null ? null : moveSelection(current, dx, dy));
      updateTransform({ ...transform, x: transform.x + dx, y: transform.y + dy });
      return;
    }
    if (action === 'grow' || action === 'shrink') {
      const scale = action === 'grow' ? 1.1 : 0.9;
      setSelection((current) => current === null ? null : scaleSelection(current, scale, scale));
      updateTransform({
        ...transform,
        scaleX: transform.scaleX * scale,
        scaleY: transform.scaleY * scale,
      });
      return;
    }
    const rotation = action === 'rotate-left' ? -15 : 15;
    setSelection((current) => current === null ? null : rotateSelection(current, rotation));
    updateTransform({ ...transform, rotation: transform.rotation + rotation });
  }

  return (
    <section className="rich-layer-inspector">
      <div className="panel-heading">
        <h2>詳細・選択変形</h2>
        <button type="button" onClick={selectLayerBounds}>Layerを選択</button>
      </div>

      <div className="transform-grid">
        <NumberField label="X" value={transform.x} onChange={(value) => updateTransform({ ...transform, x: value })} />
        <NumberField label="Y" value={transform.y} onChange={(value) => updateTransform({ ...transform, y: value })} />
        <NumberField label="拡大X" value={transform.scaleX} step={0.1} onChange={(value) => updateTransform({ ...transform, scaleX: value })} />
        <NumberField label="拡大Y" value={transform.scaleY} step={0.1} onChange={(value) => updateTransform({ ...transform, scaleY: value })} />
        <NumberField label="回転" value={transform.rotation} onChange={(value) => updateTransform({ ...transform, rotation: value })} />
      </div>

      <div className="selection-actions" aria-label="選択対象の基本変形">
        {([
          ['left', '←'], ['right', '→'], ['up', '↑'], ['down', '↓'],
          ['shrink', '縮小'], ['grow', '拡大'], ['rotate-left', '左15°'], ['rotate-right', '右15°'],
        ] as const).map(([action, label]) => (
          <button key={action} type="button" disabled={selection === null} onClick={() => transformSelection(action)}>
            {label}
          </button>
        ))}
        <button type="button" disabled={selection === null} onClick={() => setSelection(null)}>選択解除</button>
      </div>

      {layer.type === 'text' ? (
        <TextEditor layer={layer} onChange={updateContent} />
      ) : layer.type === 'image' ? (
        <ImageEditor layer={layer} onChange={updateContent} />
      ) : layer.type === 'shape' ? (
        <ShapeEditor layer={layer} onChange={updateContent} />
      ) : null}
    </section>
  );
}

function TextEditor({ layer, onChange }: { layer: TextLayer; onChange(content: RichTextContent): void }) {
  const content = getRichTextContent(layer);
  return (
    <div className="content-editor">
      <label>文字<textarea value={content.text} onChange={(event) => onChange({ ...content, text: event.currentTarget.value })} /></label>
      <label>フォント<input value={content.fontFamily} onChange={(event) => onChange({ ...content, fontFamily: event.currentTarget.value })} /></label>
      <NumberField label="文字サイズ" value={content.fontSize} min={1} onChange={(fontSize) => onChange({ ...content, fontSize })} />
      <label>太さ<select value={content.fontWeight} onChange={(event) => onChange({ ...content, fontWeight: Number(event.currentTarget.value) })}>{[100,200,300,400,500,600,700,800,900].map((weight) => <option key={weight}>{weight}</option>)}</select></label>
      <label><input type="checkbox" checked={content.fontStyle === 'italic'} onChange={(event) => onChange({ ...content, fontStyle: event.currentTarget.checked ? 'italic' : 'normal' })} />斜体</label>
      <label>揃え<select value={content.align} onChange={(event) => onChange({ ...content, align: event.currentTarget.value as RichTextContent['align'] })}><option value="left">左</option><option value="center">中央</option><option value="right">右</option></select></label>
      <label>文字色<input type="color" value={content.color.slice(0, 7)} onChange={(event) => onChange({ ...content, color: event.currentTarget.value })} /></label>
      <label>縁色<input type="color" value={(content.strokeColor ?? '#000000').slice(0, 7)} onChange={(event) => onChange({ ...content, strokeColor: event.currentTarget.value })} /></label>
      <NumberField label="縁幅" value={content.strokeWidth} min={0} onChange={(strokeWidth) => onChange({ ...content, strokeWidth })} />
      <label>影色<input type="color" value={(content.shadowColor ?? '#000000').slice(0, 7)} onChange={(event) => onChange({ ...content, shadowColor: event.currentTarget.value })} /></label>
      <NumberField label="影ぼかし" value={content.shadowBlur} min={0} onChange={(shadowBlur) => onChange({ ...content, shadowBlur })} />
    </div>
  );
}

function ImageEditor({ layer, onChange }: { layer: ImageLayer; onChange(content: RichImageContent): void }) {
  const content = getRichImageContent(layer);
  const updateCrop = (patch: Partial<RichImageContent['crop']>) => onChange({ ...content, crop: { ...content.crop, ...patch } });
  return (
    <div className="content-editor">
      <p>{content.width} × {content.height}</p>
      <NumberField label="crop X" value={content.crop.x} min={0} onChange={(x) => updateCrop({ x })} />
      <NumberField label="crop Y" value={content.crop.y} min={0} onChange={(y) => updateCrop({ y })} />
      <NumberField label="crop幅" value={content.crop.width} min={1} onChange={(width) => updateCrop({ width })} />
      <NumberField label="crop高さ" value={content.crop.height} min={1} onChange={(height) => updateCrop({ height })} />
      <label><input type="checkbox" checked={content.flipX} onChange={(event) => onChange({ ...content, flipX: event.currentTarget.checked })} />画像を左右反転</label>
      <label><input type="checkbox" checked={content.flipY} onChange={(event) => onChange({ ...content, flipY: event.currentTarget.checked })} />画像を上下反転</label>
    </div>
  );
}

function ShapeEditor({ layer, onChange }: { layer: ShapeLayer; onChange(content: RichShapeContent): void }) {
  const content = getRichShapeContent(layer);
  return (
    <div className="content-editor">
      <label>図形<select value={content.shape} onChange={(event) => onChange({ ...content, shape: event.currentTarget.value as RichShapeContent['shape'] })}><option value="rectangle">矩形</option><option value="ellipse">楕円</option><option value="line">線</option></select></label>
      <NumberField label="幅" value={content.width} min={1} onChange={(width) => onChange({ ...content, width })} />
      <NumberField label="高さ" value={content.height} min={1} onChange={(height) => onChange({ ...content, height })} />
      <NumberField label="角丸" value={content.cornerRadius} min={0} onChange={(cornerRadius) => onChange({ ...content, cornerRadius })} />
      <label>塗り<input type="color" value={(content.fill ?? '#ffffff').slice(0, 7)} onChange={(event) => onChange({ ...content, fill: event.currentTarget.value })} /></label>
      <label>線色<input type="color" value={content.stroke.slice(0, 7)} onChange={(event) => onChange({ ...content, stroke: event.currentTarget.value })} /></label>
      <NumberField label="線幅" value={content.strokeWidth} min={0.1} step={0.5} onChange={(strokeWidth) => onChange({ ...content, strokeWidth })} />
    </div>
  );
}

function NumberField({ label, value, min, step = 1, onChange }: { label: string; value: number; min?: number; step?: number; onChange(value: number): void }) {
  return <label>{label}<input type="number" value={Number.isFinite(value) ? value : 0} min={min} step={step} onChange={(event) => { const next = Number(event.currentTarget.value); if (Number.isFinite(next)) onChange(next); }} /></label>;
}

function metadata(prefix: string) {
  return {
    commandId: `${prefix}:${globalThis.crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
}
