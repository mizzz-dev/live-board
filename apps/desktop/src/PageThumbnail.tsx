import { RichCanvasRenderer } from '@live-board/canvas-engine';
import {
  createPageRenderSnapshot,
  type Page,
  type ProjectAssetLibrary,
} from '@live-board/domain';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface PageThumbnailProps {
  page: Page;
  projectId: string;
  assetLibrary: ProjectAssetLibrary;
}

export function PageThumbnail({
  page,
  projectId,
  assetLibrary,
}: PageThumbnailProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const layerSignature = JSON.stringify(page.layerDocument ?? null);
  const assetSignature = `${assetLibrary.totalBytes}:${assetLibrary.assets
    .map((asset) => asset.sha256)
    .join('|')}`;

  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [page.id]);

  useEffect(() => {
    if (!visible) return;
    let canceled = false;
    const run = () => {
      if (canceled) return;
      const source = document.createElement('canvas');
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 96;
      thumbnail.height = 54;
      const renderer = new RichCanvasRenderer();
      try {
        const snapshot = createPageRenderSnapshot(
          page,
          projectId,
          0,
          new Date(0).toISOString(),
          assetLibrary,
        );
        renderer.render(source, snapshot);
        const context = thumbnail.getContext('2d');
        if (context === null) return;
        context.clearRect(0, 0, thumbnail.width, thumbnail.height);
        context.drawImage(
          source,
          0,
          0,
          source.width,
          source.height,
          0,
          0,
          thumbnail.width,
          thumbnail.height,
        );
        if (!canceled) setDataUrl(thumbnail.toDataURL('image/png'));
      } finally {
        renderer.clear();
        source.width = 1;
        source.height = 1;
        thumbnail.width = 1;
        thumbnail.height = 1;
      }
    };

    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => run(), { timeout: 750 });
    } else {
      timeoutHandle = window.setTimeout(run, 0);
    }
    return () => {
      canceled = true;
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [visible, page.id, page.updatedAt, layerSignature, projectId, assetSignature]);

  const style = dataUrl === null
    ? undefined
    : ({ backgroundImage: `url(${JSON.stringify(dataUrl)})` } as CSSProperties);
  return (
    <span
      ref={elementRef}
      className={`page-thumbnail${dataUrl === null ? ' pending' : ' ready'}`}
      data-thumbnail-state={dataUrl === null ? 'pending' : 'ready'}
      style={style}
      aria-hidden="true"
    />
  );
}
