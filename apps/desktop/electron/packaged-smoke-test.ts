import { startObsBridge } from '@live-board/obs-bridge';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspacePersistenceService } from './persistence-service.js';
import {
  resolvePackagedResourcePaths,
  type PackagedResourcePaths,
} from './packaged-resources.js';

export interface PackagedSmokeTestResult {
  ok: true;
  version: string;
  host: '127.0.0.1' | '::1';
  port: number;
  overlayStatus: number;
}

export interface RunPackagedSmokeTestOptions {
  currentDirectory: string;
  resourcesPath: string;
  version: string;
}

export async function runPackagedSmokeTest(
  options: RunPackagedSmokeTestOptions,
): Promise<PackagedSmokeTestResult> {
  const paths = resolvePackagedResourcePaths(
    options.currentDirectory,
    options.resourcesPath,
  );
  await assertPackagedResources(paths);

  const smokeRoot = await mkdtemp(join(tmpdir(), 'live-board-packaged-smoke-'));
  const persistenceService = createWorkspacePersistenceService(
    join(smokeRoot, 'persistence'),
  );
  await persistenceService.initialize();

  const bridge = await startObsBridge({
    allowedOrigins: [],
    overlayRoot: paths.overlayRoot,
  });

  try {
    const response = await fetch(bridge.info.overlayUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`PACKAGED_SMOKE_OVERLAY_HTTP_${response.status}`);
    }

    const html = await response.text();
    if (!/id=["']root["']/.test(html)) {
      throw new Error('PACKAGED_SMOKE_OVERLAY_ROOT_MISSING');
    }

    return {
      ok: true,
      version: options.version,
      host: bridge.info.host,
      port: bridge.info.port,
      overlayStatus: response.status,
    };
  } finally {
    await bridge.close();
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

export async function writePackagedSmokeResult(
  outputPath: string,
  result: PackagedSmokeTestResult,
): Promise<void> {
  await access(dirname(outputPath));
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function assertPackagedResources(
  paths: PackagedResourcePaths,
): Promise<void> {
  try {
    await Promise.all([
      access(paths.rendererIndex),
      access(paths.overlayIndex),
    ]);
  } catch {
    throw new Error('PACKAGED_SMOKE_RESOURCE_MISSING');
  }
}
