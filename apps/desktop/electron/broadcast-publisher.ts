import {
  applyBroadcastLayerPatchDescriptor,
  parseBroadcastLayerPatchDescriptor,
  parseBroadcastSnapshotDescriptor,
  type BroadcastLayerPatchDescriptor,
  type BroadcastSnapshotDescriptor,
} from '@live-board/obs-protocol';

export interface BroadcastDescriptorBridge {
  publishSnapshotDescriptor(snapshot: BroadcastSnapshotDescriptor): number;
}

export class BroadcastDescriptorPublisher {
  private latestSnapshot: BroadcastSnapshotDescriptor | undefined;

  constructor(private readonly bridge: BroadcastDescriptorBridge) {}

  publishSnapshot(input: BroadcastSnapshotDescriptor): number {
    const snapshot = parseBroadcastSnapshotDescriptor(input);
    const acceptedRevision = this.bridge.publishSnapshotDescriptor(snapshot);
    this.latestSnapshot = snapshot;
    return acceptedRevision;
  }

  publishLayerPatch(input: BroadcastLayerPatchDescriptor): number {
    if (this.latestSnapshot === undefined) {
      throw new Error('IPC_BROADCAST_SNAPSHOT_REQUIRED');
    }
    const patch = parseBroadcastLayerPatchDescriptor(input);
    const nextSnapshot = applyBroadcastLayerPatchDescriptor(
      this.latestSnapshot,
      patch,
    );
    const acceptedRevision = this.bridge.publishSnapshotDescriptor(nextSnapshot);
    this.latestSnapshot = nextSnapshot;
    return acceptedRevision;
  }

  getLatestSnapshot(): BroadcastSnapshotDescriptor | undefined {
    return this.latestSnapshot;
  }
}
