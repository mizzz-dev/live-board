/// <reference types="vite/client" />

interface RuntimeInfo {
  platform: string;
  versions: {
    electron: string;
    chrome: string;
  };
}

interface Window {
  liveBoard?: {
    getRuntimeInfo: () => RuntimeInfo;
  };
}
