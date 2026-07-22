/// <reference types="vite/client" />

interface RuntimeInfo {
  platform: string;
  versions: {
    electron: string;
    chrome: string;
  };
}

interface SecurityStatus {
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

interface Window {
  liveBoard?: {
    getRuntimeInfo: () => RuntimeInfo;
    getSecurityStatus: (requestId: string) => Promise<SecurityStatus>;
  };
}
