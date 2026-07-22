import { contextBridge } from 'electron';

export interface RuntimeInfo {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
  };
}

const runtimeInfo: RuntimeInfo = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
});

contextBridge.exposeInMainWorld(
  'liveBoard',
  Object.freeze({
    getRuntimeInfo: (): RuntimeInfo => runtimeInfo,
  }),
);
