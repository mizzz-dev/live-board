import type { Session } from 'electron';

export interface RendererTrustConfig {
  packagedRendererUrl: string;
  developmentServerUrl?: string;
}

export interface IpcSenderDescriptor {
  senderUrl: string;
  isMainFrame: boolean;
}

export function createRendererContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://[::1]:* ws://[::1]:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function installContentSecurityPolicy(
  targetSession: Session,
  policy: string,
): void {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: mergeSecurityHeaders(details.responseHeaders, policy),
    });
  });
}

export function installPermissionDenyPolicy(targetSession: Session): void {
  targetSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  targetSession.setPermissionCheckHandler(() => false);
}

export function mergeSecurityHeaders(
  currentHeaders: Record<string, string[]> | undefined,
  policy: string,
): Record<string, string[]> {
  return {
    ...(currentHeaders ?? {}),
    'Content-Security-Policy': [policy],
    'X-Content-Type-Options': ['nosniff'],
    'Referrer-Policy': ['no-referrer'],
  };
}

export function isTrustedRendererUrl(
  candidateUrl: string,
  config: RendererTrustConfig,
): boolean {
  try {
    const candidate = new URL(candidateUrl);

    if (config.developmentServerUrl !== undefined) {
      const developmentServer = new URL(config.developmentServerUrl);

      if (
        candidate.protocol === developmentServer.protocol &&
        candidate.origin === developmentServer.origin &&
        candidate.username === '' &&
        candidate.password === ''
      ) {
        return true;
      }
    }

    const packagedRenderer = new URL(config.packagedRendererUrl);

    return (
      candidate.protocol === 'file:' &&
      packagedRenderer.protocol === 'file:' &&
      candidate.host === packagedRenderer.host &&
      candidate.pathname === packagedRenderer.pathname
    );
  } catch {
    return false;
  }
}

export function assertTrustedIpcSender(
  sender: IpcSenderDescriptor,
  config: RendererTrustConfig,
): void {
  if (!sender.isMainFrame || !isTrustedRendererUrl(sender.senderUrl, config)) {
    throw new Error('IPC_UNTRUSTED_SENDER');
  }
}
