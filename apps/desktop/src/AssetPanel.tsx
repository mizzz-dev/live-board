import {
  MAX_ASSET_BYTES,
  type AssetImportInput,
  type ProjectAssetLibrary,
} from '@live-board/domain';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import './asset-panel.css';

interface AssetPanelProps {
  library: ProjectAssetLibrary;
  onImport(inputs: AssetImportInput[]): Promise<void>;
  error: string | null;
}

export function AssetPanel({ library, onImport, error }: AssetPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return;
      event.preventDefault();
      void readAndImport(files, 'clipboard');
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  async function readAndImport(files: readonly File[], source: string): Promise<void> {
    if (reading || files.length === 0) return;
    setReading(true);
    try {
      const inputs: AssetImportInput[] = [];
      for (const [index, file] of files.entries()) {
        if (file.size < 1 || file.size > MAX_ASSET_BYTES) {
          throw new Error(`${file.name || source}は25MB以内の画像を選択してください`);
        }
        inputs.push({
          fileName: file.name || `${source}-image-${index + 1}`,
          declaredMime: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
      await onImport(inputs);
    } finally {
      setReading(false);
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    void readAndImport([...event.dataTransfer.files], 'drop');
  }

  return (
    <section className="asset-panel">
      <div className="panel-heading">
        <h2>画像アセット</h2>
        <span>{library.assets.length}件</span>
      </div>
      <div
        className={`asset-drop-zone${dragging ? ' dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          aria-label="画像ファイルを選択"
          onChange={(event) => void readAndImport([...(event.currentTarget.files ?? [])], 'file')}
        />
        <button type="button" disabled={reading} onClick={() => inputRef.current?.click()}>
          {reading ? '検証中…' : '画像を追加'}
        </button>
        <p>ドロップ、貼り付け、またはファイル選択</p>
        <small>PNG / JPEG / WebP / GIF静止画 / SVG・1件25MBまで</small>
      </div>
      {error === null ? null : <p className="asset-error" role="alert">{error}</p>}
      <div className="asset-list" aria-label="登録済み画像アセット">
        {library.assets.map((asset) => (
          <article key={asset.id} className="asset-row">
            <img src={asset.dataUrl} alt="" />
            <div>
              <strong>{asset.fileNames[0]}</strong>
              <small>{asset.width} × {asset.height} / {formatBytes(asset.byteLength)}</small>
              <small>{asset.sanitized ? 'SVGサニタイズ済み' : asset.mime}</small>
            </div>
          </article>
        ))}
      </div>
      <p className="asset-total">保存バイナリ: {formatBytes(library.totalBytes)}</p>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
