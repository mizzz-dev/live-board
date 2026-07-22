import {
  parseBroadcastSnapshot,
  parseObsBridgeClientMessage,
  parsePageTransition,
  type BroadcastSnapshot,
  type ObsBridgeClientMessage,
  type ObsBridgeServerMessage,
  type PageTransition,
} from '@live-board/obs-protocol';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

const DEFAULT_HOST = '127.0.0.1' as const;
const DEFAULT_MAX_CONNECTIONS = 4;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_PAGE_TRANSITION: PageTransition = {
  type: 'fade',
  durationMs: 150,
};
const TOKEN_BYTES = 32;

export type LoopbackHost = '127.0.0.1' | '::1';

export interface ObsBridgeOptions {
  host?: LoopbackHost;
  port?: number;
  allowedOrigins?: readonly string[];
  maxConnections?: number;
  maxPayloadBytes?: number;
  overlayRoot?: string;
  initialSnapshot?: BroadcastSnapshot;
  pageTransition?: PageTransition;
}

export interface ObsBridgeInfo {
  host: LoopbackHost;
  port: number;
  overlayUrl: string;
  webSocketUrl: string;
}

export interface ObsBridge {
  readonly info: ObsBridgeInfo;
  getConnectionCount(): number;
  getLatestRevision(): number | null;
  publishSnapshot(snapshot: BroadcastSnapshot): number;
  close(): Promise<void>;
}

export {
  type BroadcastSnapshot,
  type ObsBridgeClientMessage,
  type PageTransition,
};

export function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

export function parseClientMessage(
  rawData: RawData,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
): ObsBridgeClientMessage {
  const text = rawDataToText(rawData);

  if (Buffer.byteLength(text, 'utf8') > maxPayloadBytes) {
    throw new Error('OBS_BRIDGE_MESSAGE_TOO_LARGE');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('OBS_BRIDGE_INVALID_JSON');
  }

  try {
    return parseObsBridgeClientMessage(parsed);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === 'OBS_PROTOCOL_UNKNOWN_CLIENT_MESSAGE'
    ) {
      throw new Error('OBS_BRIDGE_UNKNOWN_MESSAGE');
    }

    throw new Error('OBS_BRIDGE_INVALID_MESSAGE');
  }
}

export async function startObsBridge(
  options: ObsBridgeOptions = {},
): Promise<ObsBridge> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? 0;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const maxPayloadBytes =
    options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const pageTransition = parsePageTransition(
    options.pageTransition ?? DEFAULT_PAGE_TRANSITION,
  );

  validateOptions({ host, port, maxConnections, maxPayloadBytes });

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const configuredOrigins = new Set(
    (options.allowedOrigins ?? []).map(normalizeOrigin),
  );
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: maxPayloadBytes,
    perMessageDeflate: false,
  });

  let ownOrigin = '';
  let latestSnapshot =
    options.initialSnapshot === undefined
      ? undefined
      : parseBroadcastSnapshot(options.initialSnapshot);

  const server = createServer((request, response) => {
    void handleHttpRequest(
      request,
      response,
      token,
      ownOrigin,
      options.overlayRoot,
    ).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
      }
      response.end('Internal Server Error');
    });
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  server.on('upgrade', (request, socket, head) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    const requestUrl = new URL(request.url ?? '/', ownOrigin);

    if (requestUrl.pathname !== '/ws') {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    if (!isValidToken(token, requestUrl.searchParams.get('token'))) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    const origin = request.headers.origin;
    const allowedOrigins = new Set(configuredOrigins);
    allowedOrigins.add(ownOrigin);

    if (origin === undefined || !isAllowedOrigin(origin, allowedOrigins)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    if (webSocketServer.clients.size >= maxConnections) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (webSocket) => {
    registerClientMessageHandler(
      webSocket,
      maxPayloadBytes,
      () => latestSnapshot,
    );

    if (latestSnapshot !== undefined) {
      sendServerMessage(webSocket, {
        type: 'snapshot',
        snapshot: latestSnapshot,
      });
    }
  });

  await listen(server, host, port);

  const address = server.address();

  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('OBS_BRIDGE_ADDRESS_UNAVAILABLE');
  }

  const resolvedPort = (address as AddressInfo).port;
  const formattedHost = formatHostForUrl(host);
  ownOrigin = `http://${formattedHost}:${resolvedPort}`;

  const info: ObsBridgeInfo = Object.freeze({
    host,
    port: resolvedPort,
    overlayUrl: `${ownOrigin}/overlay/${token}`,
    webSocketUrl: `ws://${formattedHost}:${resolvedPort}/ws?token=${token}`,
  });

  return {
    info,
    getConnectionCount: () => webSocketServer.clients.size,
    getLatestRevision: () => latestSnapshot?.revision ?? null,
    publishSnapshot: (input) => {
      const snapshot = parseBroadcastSnapshot(input);

      if (
        latestSnapshot !== undefined &&
        snapshot.revision <= latestSnapshot.revision
      ) {
        throw new Error('OBS_BRIDGE_STALE_REVISION');
      }

      const previousSnapshot = latestSnapshot;
      latestSnapshot = snapshot;
      const message: ObsBridgeServerMessage =
        previousSnapshot !== undefined &&
        previousSnapshot.pageId !== snapshot.pageId
          ? {
              type: 'page.changed',
              snapshot,
              transition: pageTransition,
            }
          : {
              type: 'snapshot',
              snapshot,
            };

      for (const client of webSocketServer.clients) {
        if (client.readyState === 1) {
          sendServerMessage(client, message);
        }
      }

      return snapshot.revision;
    },
    close: async () => {
      for (const client of webSocketServer.clients) {
        client.terminate();
      }

      await Promise.all([
        new Promise<void>((resolvePromise) => {
          webSocketServer.close(() => resolvePromise());
        }),
        new Promise<void>((resolvePromise, reject) => {
          server.close((error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }

            resolvePromise();
          });
        }),
      ]);
    },
  };
}

async function listen(
  server: ReturnType<typeof createServer>,
  host: LoopbackHost,
  port: number,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolvePromise();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port, exclusive: true });
  });
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  ownOrigin: string,
  overlayRoot: string | undefined,
): Promise<void> {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.writeHead(403, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Forbidden');
    return;
  }

  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');

  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (
    request.method === 'GET' &&
    requestUrl.pathname.startsWith('/overlay/')
  ) {
    const candidateToken = requestUrl.pathname.slice('/overlay/'.length);

    if (!isValidToken(token, candidateToken)) {
      response.writeHead(401, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('Unauthorized');
      return;
    }

    const html =
      overlayRoot === undefined
        ? createFallbackOverlayDocument()
        : await readFile(resolve(overlayRoot, 'index.html'), 'utf8');
    const webSocketOrigin = ownOrigin.replace(/^http:/, 'ws:');

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        `connect-src 'self' ${webSocketOrigin}`,
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    response.end(html);
    return;
  }

  if (
    request.method === 'GET' &&
    requestUrl.pathname.startsWith('/assets/') &&
    overlayRoot !== undefined
  ) {
    const assetPath = resolveStaticAssetPath(
      overlayRoot,
      requestUrl.pathname,
    );

    if (assetPath === null) {
      response.writeHead(400, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('Bad Request');
      return;
    }

    try {
      const content = await readFile(assetPath);
      response.writeHead(200, {
        'Content-Type': contentTypeForPath(assetPath),
      });
      response.end(content);
    } catch {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('Not Found');
    }
    return;
  }

  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end('Not Found');
}

function registerClientMessageHandler(
  webSocket: WebSocket,
  maxPayloadBytes: number,
  getLatestSnapshot: () => BroadcastSnapshot | undefined,
): void {
  webSocket.on('message', (rawData, isBinary) => {
    if (isBinary) {
      webSocket.close(1008, 'Binary messages are not supported');
      return;
    }

    try {
      const message = parseClientMessage(rawData, maxPayloadBytes);

      if (message.type === 'ping') {
        sendServerMessage(webSocket, {
          type: 'pong',
          timestamp: message.timestamp,
        });
        return;
      }

      const snapshot = getLatestSnapshot();

      if (
        snapshot !== undefined &&
        message.lastRevision !== snapshot.revision
      ) {
        sendServerMessage(webSocket, {
          type: 'snapshot',
          snapshot,
        });
      }
    } catch {
      webSocket.close(1008, 'Invalid message');
    }
  });
}

function sendServerMessage(
  webSocket: WebSocket,
  message: ObsBridgeServerMessage,
): void {
  webSocket.send(JSON.stringify(message));
}

function validateOptions(options: {
  host: LoopbackHost;
  port: number;
  maxConnections: number;
  maxPayloadBytes: number;
}): void {
  if (options.host !== '127.0.0.1' && options.host !== '::1') {
    throw new Error('OBS_BRIDGE_HOST_MUST_BE_LOOPBACK');
  }

  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65535
  ) {
    throw new Error('OBS_BRIDGE_INVALID_PORT');
  }

  if (
    !Number.isInteger(options.maxConnections) ||
    options.maxConnections < 1 ||
    options.maxConnections > 16
  ) {
    throw new Error('OBS_BRIDGE_INVALID_CONNECTION_LIMIT');
  }

  if (
    !Number.isInteger(options.maxPayloadBytes) ||
    options.maxPayloadBytes < 1024 ||
    options.maxPayloadBytes > 1024 * 1024
  ) {
    throw new Error('OBS_BRIDGE_INVALID_PAYLOAD_LIMIT');
  }
}

function isValidToken(
  expectedToken: string,
  candidateToken: string | null,
): boolean {
  if (candidateToken === null) {
    return false;
  }

  const expected = Buffer.from(expectedToken, 'utf8');
  const candidate = Buffer.from(candidateToken, 'utf8');

  return (
    expected.length === candidate.length &&
    timingSafeEqual(expected, candidate)
  );
}

function rejectUpgrade(
  socket: import('node:stream').Duplex,
  statusCode: number,
  statusText: string,
): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function normalizeOrigin(origin: string): string {
  const url = new URL(origin);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OBS_BRIDGE_INVALID_ORIGIN');
  }

  return url.origin;
}

function isAllowedOrigin(
  origin: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  try {
    return allowedOrigins.has(normalizeOrigin(origin));
  } catch {
    return false;
  }
}

function formatHostForUrl(host: LoopbackHost): string {
  return host === '::1' ? '[::1]' : host;
}

function rawDataToText(rawData: RawData): string {
  if (Array.isArray(rawData)) {
    return Buffer.concat(rawData).toString('utf8');
  }

  if (rawData instanceof ArrayBuffer) {
    return Buffer.from(rawData).toString('utf8');
  }

  return rawData.toString('utf8');
}

function resolveStaticAssetPath(
  overlayRoot: string,
  requestPath: string,
): string | null {
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(requestPath.slice(1));
  } catch {
    return null;
  }

  if (decodedPath.includes('\\') || decodedPath.includes('\0')) {
    return null;
  }

  const root = resolve(overlayRoot);
  const candidate = resolve(root, decodedPath);

  if (!candidate.startsWith(`${root}${sep}`)) {
    return null;
  }

  return candidate;
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function createFallbackOverlayDocument(): string {
  return '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Live Board Overlay</title><style>html,body{margin:0;background:transparent;color:#fff;font-family:sans-serif}main{padding:16px}</style><main>Live Board Overlay assets are not configured.</main></html>';
}
