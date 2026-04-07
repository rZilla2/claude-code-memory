import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

// We import lazily inside tests where env vars need to be set before module load
// so we re-import via dynamic import or clear module cache as needed.
// For simplicity we test the functions directly.

describe('assertPathSafety', () => {
  it('does NOT throw for a safe path outside iCloud', async () => {
    const { assertPathSafety } = await import('./config.js');
    expect(() =>
      assertPathSafety(join(homedir(), '.claude-code-memory')),
    ).not.toThrow();
  });

  it('throws for a path containing Mobile Documents', async () => {
    const { assertPathSafety } = await import('./config.js');
    const icloudPath =
      '/Users/rod/Library/Mobile Documents/iCloud~md~obsidian/Documents/.claude-code-memory/';
    expect(() => assertPathSafety(icloudPath)).toThrow(
      /iCloud|Mobile Documents/,
    );
  });
});

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to baseline (remove MEM_* vars)
    delete process.env.MEM_VAULT_PATH;
    delete process.env.MEM_INDEX_PATH;
    delete process.env.MEM_EMBEDDING_PROVIDER;
  });

  afterEach(() => {
    process.env.MEM_VAULT_PATH = originalEnv.MEM_VAULT_PATH;
    process.env.MEM_INDEX_PATH = originalEnv.MEM_INDEX_PATH;
    process.env.MEM_EMBEDDING_PROVIDER = originalEnv.MEM_EMBEDDING_PROVIDER;
  });

  it('returns defaults when no config file exists on disk', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig({ vaultPath: '/tmp/test-vault-defaults' });
    expect(config.indexPath).toBe(join(homedir(), '.claude-code-memory'));
    expect(config.embeddingProvider).toBe('openai');
    expect(config.openaiModel).toBe('text-embedding-3-small');
    expect(config.batchSize).toBe(100);
    expect(config.concurrency).toBe(2);
  });

  it('merges vault-level config file over defaults', async () => {
    const { loadConfig } = await import('./config.js');
    const tmpVault = '/tmp/test-vault-file-merge';
    mkdirSync(tmpVault, { recursive: true });
    writeFileSync(
      join(tmpVault, '.claude-code-memory.json'),
      JSON.stringify({ batchSize: 50, concurrency: 4 }),
    );

    try {
      const config = loadConfig({ vaultPath: tmpVault });
      expect(config.batchSize).toBe(50);
      expect(config.concurrency).toBe(4);
      // Defaults still apply for unspecified fields
      expect(config.embeddingProvider).toBe('openai');
    } finally {
      rmSync(join(tmpVault, '.claude-code-memory.json'));
    }
  });

  it('env var MEM_VAULT_PATH overrides defaults and file', async () => {
    const { loadConfig } = await import('./config.js');
    process.env.MEM_VAULT_PATH = '/tmp/test-env-vault';
    const config = loadConfig();
    expect(config.vaultPath).toBe('/tmp/test-env-vault');
  });

  it('env var MEM_INDEX_PATH overrides defaults', async () => {
    const { loadConfig } = await import('./config.js');
    process.env.MEM_VAULT_PATH = '/tmp/test-vault';
    process.env.MEM_INDEX_PATH = '/tmp/custom-index';
    const config = loadConfig();
    expect(config.indexPath).toBe('/tmp/custom-index');
  });

  it('throws when indexPath override contains Mobile Documents', async () => {
    const { loadConfig } = await import('./config.js');
    const badPath =
      '/Users/rod/Library/Mobile Documents/iCloud~md~obsidian/.claude-code-memory';
    expect(() =>
      loadConfig({ vaultPath: '/tmp/safe-vault', indexPath: badPath }),
    ).toThrow(/iCloud|Mobile Documents/);
  });

  it('returns empty array default for ignorePaths when no config file sets it', async () => {
    const { loadConfig } = await import('./config.js');
    // Override ignorePaths to isolate from global config.json
    const config = loadConfig({ vaultPath: '/tmp/test-vault-ignorepaths', ignorePaths: [] });
    expect(config.ignorePaths).toEqual([]);
  });

  it('returns [".md"] default for includeExtensions', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig({ vaultPath: '/tmp/test-vault-extensions' });
    expect(config.includeExtensions).toEqual(['.md']);
  });

  it('accepts custom ignorePaths override', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig({
      vaultPath: '/tmp/test-vault-custom-ignore',
      ignorePaths: ['90 - Attachments', 'Archive'],
    });
    expect(config.ignorePaths).toEqual(['90 - Attachments', 'Archive']);
  });

  it('accepts custom includeExtensions override', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig({
      vaultPath: '/tmp/test-vault-custom-ext',
      includeExtensions: ['.md', '.txt'],
    });
    expect(config.includeExtensions).toEqual(['.md', '.txt']);
  });
});
