export const SECURITY_STATUS_CHANNEL = 'security:get-status';

export interface SecurityStatusRequest {
  requestId: string;
}

export interface SecurityStatus {
  requestId: string;
  electron: {
    nodeIntegration: false;
    contextIsolation: true;
    sandbox: true;
    webSecurity: true;
  };
  obsBridge: {
    running: true;
    host: '127.0.0.1' | '::1';
    port: number;
    connectionCount: number;
  };
}

export function parseSecurityStatusRequest(
  input: unknown,
): SecurityStatusRequest {
  if (!isRecord(input)) {
    throw new Error('IPC_INVALID_REQUEST');
  }

  const requestId = input.requestId;

  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(requestId)
  ) {
    throw new Error('IPC_INVALID_REQUEST_ID');
  }

  return { requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
