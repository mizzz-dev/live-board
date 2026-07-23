import { navigateBroadcastPage } from './broadcast-controls.js';
import { findProject, type ProjectId, type Workspace } from './model.js';

export const BROADCAST_PERFORMANCE_BUDGETS = Object.freeze({
  pageListOperationMs: 100,
  layerProjectionMs: 100,
  snapshotBuildMs: 100,
  overlayRenderMs: 100,
  obsSwitchLatencyMs: 100,
  autosaveBlockingMs: 50,
});

export type BroadcastPerformanceMetric =
  keyof typeof BROADCAST_PERFORMANCE_BUDGETS;

export interface BroadcastPerformanceEvaluation {
  metric: BroadcastPerformanceMetric;
  valueMs: number;
  budgetMs: number;
  exceeded: boolean;
  warning: string | null;
}

export interface BroadcastStabilitySimulationResult {
  iterations: number;
  successfulSwitches: number;
  revisionStart: number;
  revisionEnd: number;
  revisionGapCount: number;
  finalPageId: string;
  retainedWorkspaceCount: 1;
  maxSerializedWorkspaceBytes: number;
}

export function evaluateBroadcastPerformance(
  metric: BroadcastPerformanceMetric,
  valueMs: number,
): BroadcastPerformanceEvaluation {
  if (!Number.isFinite(valueMs) || valueMs < 0) {
    throw new Error(`Invalid performance value: ${valueMs}`);
  }
  const budgetMs = BROADCAST_PERFORMANCE_BUDGETS[metric];
  const exceeded = valueMs > budgetMs;
  return {
    metric,
    valueMs,
    budgetMs,
    exceeded,
    warning: exceeded
      ? `${metric}が性能予算を超過しました: ${valueMs.toFixed(1)}ms > ${budgetMs}ms`
      : null,
  };
}

export function estimateDecodedImageBytes(
  width: number,
  height: number,
  imageCount: number,
): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(imageCount) ||
    width < 1 ||
    height < 1 ||
    imageCount < 0 ||
    width > 32_768 ||
    height > 32_768
  ) {
    throw new Error('Invalid image memory estimate input');
  }
  const bytes = width * height * 4 * imageCount;
  if (!Number.isSafeInteger(bytes)) {
    throw new Error('Image memory estimate exceeds safe integer range');
  }
  return bytes;
}

export function simulateBroadcastSession(
  initialWorkspace: Workspace,
  projectId: ProjectId,
  iterations: number,
  revisionStart = 1,
): BroadcastStabilitySimulationResult {
  if (!Number.isSafeInteger(iterations) || iterations < 0 || iterations > 1_000_000) {
    throw new Error(`Invalid simulation iterations: ${iterations}`);
  }
  if (!Number.isSafeInteger(revisionStart) || revisionStart < 0) {
    throw new Error(`Invalid simulation revision: ${revisionStart}`);
  }

  let workspace = initialWorkspace;
  let revision = revisionStart;
  let successfulSwitches = 0;
  let revisionGapCount = 0;
  let previousRevision = revisionStart - 1;
  let maxSerializedWorkspaceBytes = utf8Length(JSON.stringify(workspace));

  for (let index = 0; index < iterations; index += 1) {
    const result = navigateBroadcastPage(workspace, projectId, { type: 'next' });
    workspace = result.workspace;
    if (result.changed) successfulSwitches += 1;
    if (revision !== previousRevision + 1) revisionGapCount += 1;
    previousRevision = revision;
    revision += 1;
    if (index % 1_000 === 0 || index === iterations - 1) {
      maxSerializedWorkspaceBytes = Math.max(
        maxSerializedWorkspaceBytes,
        utf8Length(JSON.stringify(workspace)),
      );
    }
  }

  const project = findProject(workspace, projectId);
  return {
    iterations,
    successfulSwitches,
    revisionStart,
    revisionEnd: iterations === 0 ? revisionStart : revision - 1,
    revisionGapCount,
    finalPageId: project.activeBroadcastPageId,
    retainedWorkspaceCount: 1,
    maxSerializedWorkspaceBytes,
  };
}

function utf8Length(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return value.length;
}
