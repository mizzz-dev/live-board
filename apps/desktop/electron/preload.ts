import { contextBridge, ipcRenderer } from 'electron';
import {
  SECURITY_STATUS_CHANNEL,
  type SecurityStatus,
} from './contracts.js';

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
    getSecurityStatus: (requestId: string): Promise<SecurityStatus> =>
      ipcRenderer.invoke(SECURITY_STATUS_CHANNEL, { requestId }) as Promise<SecurityStatus>,
  }),
);
