import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { scanVault } from './scanner.js';
import type { Config } from '../types.js';

function makeConfig(vaultPath: string, overrides: Partial<Config> = {}): Config {
  return {
    vaultPath,
    indexPath: join(tmpdir(), 'test-index'),
    embeddingProvider: 'openai',
    openaiModel: 'text-embedding-3-small',
    batchSize: 100,
    concurrency: 2,
    ignorePaths: [],
    includeExtensions: ['.md'],
    ...overrides,
  };
}

describe('scanVault', () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = join(tmpdir(), `scanner-test-${randomUUID()}`);
    mkdirSync(vaultDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it('Test 1: discovers all .md files recursively', async () => {
    // Create nested structure
    mkdirSync(join(vaultDir, 'hub', 'project'), { recursive: true });
    writeFileSync(join(vaultDir, 'root.md'), '# Root');
    writeFileSync(join(vaultDir, 'hub', 'hub-note.md'), '# Hub Note');
    writeFileSync(join(vaultDir, 'hub', 'project', 'deep-note.md'), '# Deep Note');

    const result = await scanVault(makeConfig(vaultDir));
    expect(result).toHaveLength(3);
  });

  it('Test 2: skips files inside .obsidian/ directory', async () => {
    mkdirSync(join(vaultDir, '.obsidian'), { recursive: true });
    writeFileSync(join(vaultDir, 'note.md'), '# Note');
    writeFileSync(join(vaultDir, '.obsidian', 'config.json'), '{}');
    writeFileSync(join(vaultDir, '.obsidian', 'workspace.json'), '{}');

    const result = await scanVault(makeConfig(vaultDir));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('note.md');
  });

  it('Test 3: skips files inside node_modules/ directory', async () => {
    mkdirSync(join(vaultDir, 'node_modules', 'some-pkg'), { recursive: true });
    writeFileSync(join(vaultDir, 'real-note.md'), '# Real');
    writeFileSync(join(vaultDir, 'node_modules', 'some-pkg', 'README.md'), '# Pkg');

    const result = await scanVault(makeConfig(vaultDir));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('real-note.md');
  });

  it('Test 4: skips .icloud placeholder files', async () => {
    writeFileSync(join(vaultDir, 'note.md'), '# Note');
    writeFileSync(join(vaultDir, 'note.md.icloud'), ''); // iCloud placeholder

    const result = await scanVault(makeConfig(vaultDir));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('note.md');
    expect(result[0]).not.toContain('.icloud');
  });

  it('Test 5: respects config.ignorePaths', async () => {
    mkdirSync(join(vaultDir, '90 - Attachments'), { recursive: true });
    mkdirSync(join(vaultDir, 'real-notes'), { recursive: true });
    writeFileSync(join(vaultDir, '90 - Attachments', 'image-note.md'), '# Img Note');
    writeFileSync(join(vaultDir, 'real-notes', 'keep.md'), '# Keep');

    const result = await scanVault(makeConfig(vaultDir, { ignorePaths: ['90 - Attachments'] }));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('keep.md');
  });

  it('Test 6: respects config.includeExtensions (only .txt)', async () => {
    writeFileSync(join(vaultDir, 'note.md'), '# MD');
    writeFileSync(join(vaultDir, 'doc.txt'), 'TXT');
    writeFileSync(join(vaultDir, 'script.js'), 'JS');

    const result = await scanVault(makeConfig(vaultDir, { includeExtensions: ['.txt'] }));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('doc.txt');
  });

  it('Test 7: returns absolute paths', async () => {
    writeFileSync(join(vaultDir, 'note.md'), '# Note');

    const result = await scanVault(makeConfig(vaultDir));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/^\//); // starts with /
    expect(result[0]).toContain(vaultDir);
  });

  it('Test 8: handles vault paths with spaces (iCloud-style path)', async () => {
    const spacedDir = join(tmpdir(), `Mobile Documents ${randomUUID()}`);
    mkdirSync(join(spacedDir, 'My Vault', 'notes'), { recursive: true });
    writeFileSync(join(spacedDir, 'My Vault', 'notes', 'note.md'), '# Note');

    try {
      const result = await scanVault(makeConfig(join(spacedDir, 'My Vault')));
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('note.md');
    } finally {
      rmSync(spacedDir, { recursive: true, force: true });
    }
  });
});
