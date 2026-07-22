import { RichCanvasRenderer, type RenderMetrics } from '@live-board/canvas-engine';
import {
  parseObsBridgeServerMessage,
  type BroadcastSnapshot,
  type PageTransition,
} from '@live-board/obs-protocol';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

type ConnectionState =
  | 'preview'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const NO_TRANSITION: PageTransition = { type: 'none', durationMs: 0 };

export function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting');
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot | null>(null);
  const [transition, setTransition] =
    useState<PageTransition>(NO_TRANSITION);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [revisionGapCount, setRevisionGapCount] = useState(0);
  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics | null>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const latestRevisionRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RichCanvasRenderer | null>(null);
  if (rendererRef.current === null) {
    rendererRef.current = new RichCanvasRenderer(() => {
      setAssetRevision((revision) => revision + 1);
    });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || snapshot === null) return;
    setRenderMetrics(rendererRef.current!.render(canvas, snapshot));
  }, [snapshot, assetRevision]);

  useEffect(() => {
    const webSocketUrl = createWebSocketUrl(window.location);

    if (webSocketUrl === null) {
      setConnectionState('preview');
      return;
    }

    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let webSocket: WebSocket | undefined;

    const clearConnectionTimers = () => {
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (heartbeatTimer !== undefined) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const requestLatestSnapshot = (lastRevision: number | null) => {
      if (webSocket?.readyState === WebSocket.OPEN) {
        webSocket.send(
          JSON.stringify({ type: 'snapshot.request', lastRevision }),
        );
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      setConnectionState('reconnecting');
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt,
        RECONNECT_MAX_DELAY_MS,
      );
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      setConnectionState(
        latestRevisionRef.current === null ? 'connecting' : 'reconnecting',
      );
      webSocket = new WebSocket(webSocketUrl);

      webSocket.addEventListener('open', () => {
        reconnectAttempt = 0;
        setConnectionState('connected');
        requestLatestSnapshot(latestRevisionRef.current);
        heartbeatTimer = window.setInterval(() => {
          if (webSocket?.readyState === WebSocket.OPEN) {
            webSocket.send(
              JSON.stringify({ type: 'ping', timestamp: Date.now() }),
            );
          }
        }, HEARTBEAT_INTERVAL_MS);
      });

      webSocket.addEventListener('message', (event) => {
        try {
          const message = parseObsBridgeServerMessage(
            JSON.parse(String(event.data)),
          );
          if (message.type === 'pong') return;

          const incomingSnapshot = message.snapshot;
          const currentRevision = latestRevisionRef.current;
          if (
            currentRevision !== null &&
            incomingSnapshot.revision > currentRevision + 1
          ) {
            setRevisionGapCount((count) => count + 1);
            requestLatestSnapshot(currentRevision);
          }
          if (
            currentRevision !== null &&
            incomingSnapshot.revision <= currentRevision
          ) {
            return;
          }

          latestRevisionRef.current = incomingSnapshot.revision;
          setLastLatencyMs(
            Math.max(
              0,
              Date.now() - Date.parse(incomingSnapshot.generatedAt),
            ),
          );
          setTransition(
            message.type === 'page.changed'
              ? message.transition
              : NO_TRANSITION,
          );
          setSnapshot(incomingSnapshot);
        } catch {
          webSocket?.close(1008, 'Invalid server message');
        }
      });

      webSocket.addEventListener('close', () => {
        if (heartbeatTimer !== undefined) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        scheduleReconnect();
      });

      webSocket.addEventListener('error', () => {
        webSocket?.close();
      });
    };

    connect();

    return () => {
      disposed = true;
      clearConnectionTimers();
      webSocket?.close(1000, 'Overlay unmounted');
    };
  }, []);

  if (snapshot === null) {
    return (
      <main className="overlay-root">
        <section className="connection-state" aria-live="polite">
          <span className="connection-indicator" aria-hidden="true" />
          <div>
            <h1>Live Board Overlay</h1>
            <p>{connectionLabel(connectionState)}</p>
          </div>
        </section>
      </main>
    );
  }

  const background =
    snapshot.canvas.background.type === 'transparent'
      ? 'transparent'
      : snapshot.canvas.background.value;
  const transitionClassName =
    transition.type === 'fade' ? ' page-transition-fade' : '';
  const outputStyle = {
    background,
    '--page-transition-duration': `${transition.durationMs}ms`,
  } as CSSProperties;

  return (
    <main
      key={snapshot.pageId}
      className={`overlay-root broadcast-output${transitionClassName}`}
      data-page-id={snapshot.pageId}
      data-revision={snapshot.revision}
      data-canvas-width={snapshot.canvas.width}
      data-canvas-height={snapshot.canvas.height}
      data-latency-ms={lastLatencyMs ?? undefined}
      data-render-duration-ms={renderMetrics?.durationMs.toFixed(2)}
      data-cache-hits={renderMetrics?.cacheHits}
      data-cache-misses={renderMetrics?.cacheMisses}
      data-revision-gap-count={revisionGapCount}
      style={outputStyle}
    >
      <canvas
        ref={canvasRef}
        className="broadcast-canvas"
        width={snapshot.canvas.width}
        height={snapshot.canvas.height}
        aria-label={`${snapshot.pageName}の配信Canvas`}
      />
      <span className="visually-hidden" aria-live="polite">
        {snapshot.pageName} revision {snapshot.revision} /{' '}
        {connectionLabel(connectionState)} / latency {lastLatencyMs ?? 0} ms /
        render {renderMetrics?.durationMs.toFixed(1) ?? 0} ms / revision gaps{' '}
        {revisionGapCount}
      </span>
    </main>
  );
}

export function createWebSocketUrl(location: Location): string | null {
  const match = /^\/overlay\/([0-9A-Fa-f]{64})$/.exec(location.pathname);
  if (match === null) return null;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws?token=${encodeURIComponent(match[1]!)}`;
}

function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'preview':
      return 'Browser Preview';
    case 'connected':
      return 'ローカル接続済み';
    case 'reconnecting':
      return 'ローカル接続を再確立しています';
    case 'connecting':
      return 'ローカル接続を待機しています';
  }
}
