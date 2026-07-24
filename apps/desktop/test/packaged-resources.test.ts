import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parsePackagedSmokeArguments,
  resolvePackagedResourcePaths,
} from '../electron/packaged-resources.js';

describe('packaged resources', () => {
  it('RendererとOverlayの配置先を分離して解決する', () => {
    expect(resolvePackagedResourcePaths('/resources/app.asar/dist-electron', '/resources')).toEqual({
      rendererIndex: join('/resources/app.asar/dist-electron', '../dist/index.html'),
      overlayRoot: join('/resources', 'overlay', 'dist'),
      overlayIndex: join('/resources', 'overlay', 'dist', 'index.html'),
    });
  });

  it('smoke testと出力先を解析する', () => {
    expect(parsePackagedSmokeArguments([
      'LiveBoard.exe',
      '--smoke-test',
      '--smoke-output=C:/temp/result.json',
    ])).toEqual({
      enabled: true,
      outputPath: 'C:/temp/result.json',
    });
  });

  it('smoke testなしの出力指定と重複指定を拒否する', () => {
    expect(() => parsePackagedSmokeArguments([
      'LiveBoard.exe',
      '--smoke-output=C:/temp/result.json',
    ])).toThrow('PACKAGED_SMOKE_OUTPUT_WITHOUT_TEST');
    expect(() => parsePackagedSmokeArguments([
      'LiveBoard.exe',
      '--smoke-test',
      '--smoke-output=a.json',
      '--smoke-output=b.json',
    ])).toThrow('PACKAGED_SMOKE_OUTPUT_DUPLICATED');
  });

  it('空のリソースパスを拒否する', () => {
    expect(() => resolvePackagedResourcePaths('', '/resources')).toThrow(
      'PACKAGED_RESOURCE_PATH_REQUIRED',
    );
  });
});
