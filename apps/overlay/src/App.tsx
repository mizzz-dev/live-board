import {
  parseObsBridgeServerMessage,
  type BroadcastSnapshot,
} from '@live-board/obs-protocol';
import { useEffect, useRef, useState } from 'react';

type ConnectionState =
  | 'preview'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

export function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting');
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot | null>(null);
  const latestRevisionRef = useRef<number | null>(null);

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

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) {
        return;
      }

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
      if (disposed) {
        return;
      }

      setConnectionState(
        latestRevisionRef.current === null ? 'connecting' : 'reconnecting',
      );
      webSocket = new WebSocket(webSocketUrl);

      webSocket.addEventListener('open', () => {
        reconnectAttempt = 0;
        setConnectionState('connected');
        webSocket?.send(
          JSON.stringify({
            type: 'snapshot.request',
            lastRevision: latestRevisionRef.current,
          }),
        );
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
          const message = parseObsBridgeServerMessage(JSON.parse(String(event.data)));

          if (
            message.type === 'snapshot' &&
            (latestRevisionRef.current === null ||
              message.snapshot.revision > latestRevisionRef.current)
          ) {
            latestRevisionRef.current = message.snapshot.revision;
            setSnapshot(message.snapshot);
          }
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

  return (
    <main
      className="overlay-root broadcast-output"
      data-page-id={snapshot.pageId}
      data-revision={snapshot.revision}
      data-canvas-width={snapshot.canvas.width}
      data-canvas-height={snapshot.canvas.height}
      style={{ background }}
    >
      <span className="visually-hidden" aria-live="polite">
        {snapshot.pageName} revision {snapshot.revision} / {connectionLabel(connectionState)}
      </span>
    </main>
  );
}

export function createWebSocketUrl(location: Location): string | null {
  const match = /^\/overlay\/([0-9A-Fa-f]{64})$/.exec(location.pathname);

  if (match === null) {
    return null;
  }

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
