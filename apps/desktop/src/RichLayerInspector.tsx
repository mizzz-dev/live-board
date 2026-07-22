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

interface Props {
  project: Project;
  page: Page;
  selection: CanvasSelection | null;
  setSelection: Dispatch<SetStateAction<CanvasSelection | null>>;
  setState: Dispatch<SetStateAction<CanvasWorkspaceCommandState>>;
  onError(message: string | null): void;
}

export function RichLayerInspector({
  project,
  page,
  selection,
  setSelection,
  setState,
  onError,
}: Props) {
  const document = getLayerDocument(page);
  const found = document.activeLayerId === null
    ? undefined
    : document.layers.find((layer) => layer.id === document.activeLayerId);
  if (found === undefined || found.type === 'folder') return null;
  const activeLayer = found;
  const transform = getLayerTransform(activeLayer);

  function updateContent(
    content: RichTextContent | RichImageContent | RichShapeContent,
  ): void {
    run(() => setState((state) => dispatchLayerContentCommand(
      state,
      createUpdateLayerContentCommand(
        project.id,
        page.id,
        activeLayer.id,
        content,
        metadata('layer-content'),
      ),
    )), 'Layer内容の更新に失敗しました');
  }

  function updateTransform(next: typeof transform): void {
    run(() => setState((state) => dispatchCanvasCommand(
      state,
      createTransformLayerCommand(
        project.id,
        page.id,
        activeLayer.id,
        next,
        metadata('layer-transform'),
      ),
    )), 'Layer変形に失敗しました');
  }

  function run(operation: () => void, fallback: string): void {
    try {
      operation();
      onError(null);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : fallback);
    }
  }

  function selectLayerBounds(): void {
    const bounds = getLayerLocalBounds(activeLayer);
    const width = Math.max(1, bounds.width * Math.abs(transform.scaleX));
    const height = Math.max(1, bounds.height * Math.abs(transform.scaleY));
    setSelection(createCanvasSelection('rectangle', [
      { x: transform.x, y: transform.y },
      { x: transform.x + width, y: transform.y + height },
    ]));
  }

  function transformSelection(action: TransformAction): void {
    if (selection === null) return;
    if (['left', 'right', 'up', 'down'].includes(action)) {
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
        <NumberField label="X" value={transform.x} onChange={(x) => updateTransform({ ...transform, x })} />
        <NumberField label="Y" value={transform.y} onChange={(y) => updateTransform({ ...transform, y })} />
        <NumberField label="拡大X" value={transform.scaleX} step={0.1} onChange={(scaleX) => updateTransform({ ...transform, scaleX })} />
        <NumberField label="拡大Y" value={transform.scaleY} step={0.1} onChange={(scaleY) => updateTransform({ ...transform, scaleY })} />
        <NumberField label="回転" value={transform.rotation} onChange={(rotation) => updateTransform({ ...transform, rotation })} />
      </div>
      <div className="selection-actions" aria-label="選択対象の基本変形">
        {TRANSFORM_ACTIONS.map(([action, label]) => (
          <button key={action} type="button" disabled={selection === null} onClick={() => transformSelection(action)}>{label}</button>
        ))}
        <button type="button" disabled={selection === null} onClick={() => setSelection(null)}>選択解除</button>
      </div>
      {activeLayer.type === 'text'
        ? <TextEditor layer={activeLayer} onChange={updateContent} />
        : activeLayer.type === 'image'
          ? <ImageEditor layer={activeLayer} onChange={updateContent} />
          : activeLayer.type === 'shape'
            ? <ShapeEditor layer={activeLayer} onChange={updateContent} />
            : null}
    </section>
  );
}

type TransformAction = 'left' | 'right' | 'up' | 'down' | 'grow' | 'shrink' | 'rotate-left' | 'rotate-right';
const TRANSFORM_ACTIONS: Array<[TransformAction, string]> = [
  ['left', '←'], ['right', '→'], ['up', '↑'], ['down', '↓'],
  ['shrink', '縮小'], ['grow', '拡大'], ['rotate-left', '左15°'], ['rotate-right', '右15°'],
];

function TextEditor({ layer, onChange }: { layer: TextLayer; onChange(content: RichTextContent): void }) {
  const content = getRichTextContent(layer);
  return (
    <div className="content-editor">
      <label>文字<textarea value={content.text} onChange={(event) => onChange({ ...content, text: event.currentTarget.value })} /></label>
      <label>フォント<input value={content.fontFamily} onChange={(event) => onChange({ ...content, fontFamily: event.currentTarget.value })} /></label>
      <NumberField label="文字サイズ" value={content.fontSize} min={1} onChange={(fontSize) => onChange({ ...content, fontSize })} />
      <label>太さ<select value={content.fontWeight} onChange={(event) => onChange({ ...content, fontWeight: Number(event.currentTarget.value) })}>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>揃え<select value={content.align} onChange={(event) => onChange({ ...content, align: event.currentTarget.value as RichTextContent['align'] })}><option value="left">左</option><option value="center">中央</option><option value="right">右</option></select></label>
      <label><input type="checkbox" checked={content.fontStyle === 'italic'} onChange={(event) => onChange({ ...content, fontStyle: event.currentTarget.checked ? 'italic' : 'normal' })} />斜体</label>
      <ColorField label="文字色" value={content.color} onChange={(color) => onChange({ ...content, color })} />
      <ColorField label="縁色" value={content.strokeColor ?? '#000000'} onChange={(strokeColor) => onChange({ ...content, strokeColor })} />
      <NumberField label="縁幅" value={content.strokeWidth} min={0} onChange={(strokeWidth) => onChange({ ...content, strokeWidth })} />
      <ColorField label="影色" value={content.shadowColor ?? '#000000'} onChange={(shadowColor) => onChange({ ...content, shadowColor })} />
      <NumberField label="影ぼかし" value={content.shadowBlur} min={0} onChange={(shadowBlur) => onChange({ ...content, shadowBlur })} />
    </div>
  );
}

function ImageEditor({ layer, onChange }: { layer: ImageLayer; onChange(content: RichImageContent): void }) {
  const content = getRichImageContent(layer);
  const crop = (patch: Partial<RichImageContent['crop']>) => onChange({ ...content, crop: { ...content.crop, ...patch } });
  return (
    <div className="content-editor">
      <p>{content.width} × {content.height}</p>
      <NumberField label="crop X" value={content.crop.x} min={0} onChange={(x) => crop({ x })} />
      <NumberField label="crop Y" value={content.crop.y} min={0} onChange={(y) => crop({ y })} />
      <NumberField label="crop幅" value={content.crop.width} min={1} onChange={(width) => crop({ width })} />
      <NumberField label="crop高さ" value={content.crop.height} min={1} onChange={(height) => crop({ height })} />
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
      <ColorField label="塗り" value={content.fill ?? '#ffffff'} onChange={(fill) => onChange({ ...content, fill })} />
      <ColorField label="線色" value={content.stroke} onChange={(stroke) => onChange({ ...content, stroke })} />
      <NumberField label="線幅" value={content.strokeWidth} min={0.1} step={0.5} onChange={(strokeWidth) => onChange({ ...content, strokeWidth })} />
    </div>
  );
}

function NumberField({ label, value, min, step = 1, onChange }: { label: string; value: number; min?: number; step?: number; onChange(value: number): void }) {
  return <label>{label}<input type="number" value={value} min={min} step={step} onChange={(event) => { const next = Number(event.currentTarget.value); if (Number.isFinite(next)) onChange(next); }} /></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label>{label}<input type="color" value={value.slice(0, 7)} onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}

function metadata(prefix: string) {
  return { commandId: `${prefix}:${globalThis.crypto.randomUUID()}`, createdAt: new Date().toISOString() };
}
