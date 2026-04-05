import { glob } from 'fast-glob';
import type { Config } from '../types.js';

export async function scanVault(config: Config): Promise<string[]> {
  const exts = config.includeExtensions;

  // Build extension pattern: '**/*.md' for single, or '**/*.{md,txt}' for multiple
  const extPattern =
    exts.length === 1
      ? `**/*${exts[0]}`
      : `**/*{${exts.join(',')}}`;

  const ignore = [
    '**/.obsidian/**',
    '**/node_modules/**',
    '**/*.icloud',
    ...config.ignorePaths.map((p) => `**/${p}/**`),
  ];

  return glob(extPattern, {
    cwd: config.vaultPath,
    absolute: true,
    ignore,
    followSymbolicLinks: false,
  });
}
