import { z } from 'zod';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { Config } from './types.js';

export const ConfigSchema = z.object({
  vaultPath: z.string(),
  indexPath: z.string().default(join(homedir(), '.claude-code-memory')),
  embeddingProvider: z.enum(['openai', 'ollama']).default('openai'),
  openaiModel: z.string().default('text-embedding-3-small'),
  batchSize: z.number().default(100),
  concurrency: z.number().default(2),
});

export function assertPathSafety(indexPath: string): void {
  const resolved = resolve(indexPath);
  if (resolved.includes('Mobile Documents')) {
    throw new Error(
      `Index path "${resolved}" is inside iCloud sync. ` +
        `This causes data corruption. Set indexPath to a location ` +
        `outside ~/Library/Mobile Documents/ (e.g., ~/.claude-code-memory/).`,
    );
  }
}

export function loadConfig(overrides?: Partial<Config>): Config {
  const partial: Record<string, unknown> = {};

  // 1. Read ~/.claude-code-memory/config.json if exists
  const globalConfig = join(homedir(), '.claude-code-memory', 'config.json');
  if (existsSync(globalConfig)) {
    try {
      const data = JSON.parse(readFileSync(globalConfig, 'utf-8'));
      Object.assign(partial, data);
    } catch {
      // Ignore parse errors — defaults apply
    }
  }

  // 2. Read vault-level .claude-code-memory.json if vaultPath is known
  const vaultPath = (overrides?.vaultPath ?? partial.vaultPath ?? process.env.MEM_VAULT_PATH) as
    | string
    | undefined;
  if (vaultPath) {
    const vaultConfig = join(vaultPath, '.claude-code-memory.json');
    if (existsSync(vaultConfig)) {
      try {
        const data = JSON.parse(readFileSync(vaultConfig, 'utf-8'));
        Object.assign(partial, data);
      } catch {
        // Ignore parse errors — defaults apply
      }
    }
  }

  // 3. Merge env vars (highest priority before overrides)
  if (process.env.MEM_VAULT_PATH) partial.vaultPath = process.env.MEM_VAULT_PATH;
  if (process.env.MEM_INDEX_PATH) partial.indexPath = process.env.MEM_INDEX_PATH;
  if (process.env.MEM_EMBEDDING_PROVIDER) partial.embeddingProvider = process.env.MEM_EMBEDDING_PROVIDER;

  // 4. Merge overrides parameter
  if (overrides) Object.assign(partial, overrides);

  // 5. Parse and validate via zod (applies defaults)
  const result = ConfigSchema.parse(partial);

  // 6. Assert path safety before returning
  assertPathSafety(result.indexPath);

  return result;
}
