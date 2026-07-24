import { join } from 'node:path';

export interface PackagedResourcePaths {
  rendererIndex: string;
  overlayRoot: string;
  overlayIndex: string;
}

export interface PackagedSmokeArguments {
  enabled: boolean;
  outputPath: string | undefined;
}

export function resolvePackagedResourcePaths(
  currentDirectory: string,
  resourcesPath: string,
): PackagedResourcePaths {
  if (currentDirectory.length === 0 || resourcesPath.length === 0) {
    throw new Error('PACKAGED_RESOURCE_PATH_REQUIRED');
  }

  const overlayRoot = join(resourcesPath, 'overlay', 'dist');
  return {
    rendererIndex: join(currentDirectory, '../dist/index.html'),
    overlayRoot,
    overlayIndex: join(overlayRoot, 'index.html'),
  };
}

export function parsePackagedSmokeArguments(
  argv: readonly string[],
): PackagedSmokeArguments {
  const enabled = argv.includes('--smoke-test');
  const outputArguments = argv.filter((argument) =>
    argument.startsWith('--smoke-output='),
  );

  if (outputArguments.length > 1) {
    throw new Error('PACKAGED_SMOKE_OUTPUT_DUPLICATED');
  }

  const outputPath = outputArguments[0]?.slice('--smoke-output='.length);
  if (outputArguments.length === 1 && (outputPath === undefined || outputPath.length === 0)) {
    throw new Error('PACKAGED_SMOKE_OUTPUT_INVALID');
  }
  if (!enabled && outputPath !== undefined) {
    throw new Error('PACKAGED_SMOKE_OUTPUT_WITHOUT_TEST');
  }

  return { enabled, outputPath };
}
