import type { BroadcastSnapshot } from '@live-board/obs-protocol';
import { contextBridge, ipcRenderer } from 'electron';
import {
  BROADCAST_PUBLISH_CHANNEL,
  SECURITY_STATUS_CHANNEL,
  type PublishBroadcastSnapshotResponse,
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
    publishBroadcastSnapshot: (
      requestId: string,
      snapshot: BroadcastSnapshot,
    ): Promise<PublishBroadcastSnapshotResponse> =>
      ipcRenderer.invoke(BROADCAST_PUBLISH_CHANNEL, {
        requestId,
        snapshot,
      }) as Promise<PublishBroadcastSnapshotResponse>,
  }),
);
