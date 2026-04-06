import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before imports
vi.mock('../../core/db/sqlite.js', () => ({
  getAllFilePaths: vi.fn(),
  deleteFileMetadata: vi.fn(),
  openMetadataDb: vi.fn(),
  assertModelMatch: vi.fn(),
}));

vi.mock('../../core/db/lance.js', () => ({
  connectLanceDb: vi.fn(),
  openChunksTable: vi.fn(),
  deleteChunksByPath: vi.fn(),
}));

vi.mock('../../core/embedder/factory.js', () => ({
  createEmbeddingProvider: vi.fn(),
}));

vi.mock('../../core/scanner.js', () => ({
  scanVault: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import type Database from 'better-sqlite3';
import type * as lancedb from '@lancedb/lancedb';

describe('mem prune command', () => {
  let mockDb: Database.Database;
  let mockTable: lancedb.Table;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDb = {
      close: vi.fn(),
    } as unknown as Database.Database;

    mockTable = {} as unknown as lancedb.Table;

    const { openMetadataDb } = await import('../../core/db/sqlite.js');
    const { connectLanceDb, openChunksTable } = await import('../../core/db/lance.js');
    const { loadConfig } = await import('../../config.js');
    const { createEmbeddingProvider } = await import('../../core/embedder/factory.js');

    vi.mocked(loadConfig).mockReturnValue({
      vaultPath: '/test/vault',
      indexPath: '/test/index',
      embeddingProvider: 'openai',
      openaiApiKey: 'test-key',
      embeddingModel: 'text-embedding-3-small',
      includeExtensions: ['.md'],
      ignorePaths: [],
      chunkSize: 400,
      chunkOverlap: 50,
    } as never);

    vi.mocked(openMetadataDb).mockReturnValue(mockDb);
    vi.mocked(connectLanceDb).mockResolvedValue({} as never);
    vi.mocked(openChunksTable).mockResolvedValue(mockTable);
    vi.mocked(createEmbeddingProvider).mockReturnValue({
      embed: vi.fn(),
      modelId: vi.fn().mockReturnValue('openai:text-embedding-3-small'),
    } as never);
  });

  it('identifies files in SQLite that do not exist on disk', async () => {
    const { getAllFilePaths } = await import('../../core/db/sqlite.js');
    const { scanVault } = await import('../../core/scanner.js');
    const { deleteChunksByPath } = await import('../../core/db/lance.js');

    vi.mocked(getAllFilePaths).mockReturnValue([
      '/test/vault/note-a.md',
      '/test/vault/note-b.md',
      '/test/vault/orphan.md',
    ]);
    vi.mocked(scanVault).mockResolvedValue([
      '/test/vault/note-a.md',
      '/test/vault/note-b.md',
    ]);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    const { registerPruneCommand } = await import('./prune-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerPruneCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'prune', '--vault', '/test/vault']);
    } catch {
      // process.exit throws in test
    }

    // Should call deleteChunksByPath only for orphan
    expect(deleteChunksByPath).toHaveBeenCalledWith(mockTable, '/test/vault/orphan.md');
    expect(deleteChunksByPath).not.toHaveBeenCalledWith(mockTable, '/test/vault/note-a.md');
    expect(deleteChunksByPath).not.toHaveBeenCalledWith(mockTable, '/test/vault/note-b.md');

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('calls deleteChunksByPath for each orphaned file', async () => {
    const { getAllFilePaths } = await import('../../core/db/sqlite.js');
    const { scanVault } = await import('../../core/scanner.js');
    const { deleteChunksByPath } = await import('../../core/db/lance.js');

    vi.mocked(getAllFilePaths).mockReturnValue([
      '/test/vault/orphan1.md',
      '/test/vault/orphan2.md',
    ]);
    vi.mocked(scanVault).mockResolvedValue([]);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    const { registerPruneCommand } = await import('./prune-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerPruneCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'prune', '--vault', '/test/vault']);
    } catch {
      // process.exit throws in test
    }

    expect(deleteChunksByPath).toHaveBeenCalledWith(mockTable, '/test/vault/orphan1.md');
    expect(deleteChunksByPath).toHaveBeenCalledWith(mockTable, '/test/vault/orphan2.md');
    expect(deleteChunksByPath).toHaveBeenCalledTimes(2);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('calls deleteFileMetadata for each orphaned file', async () => {
    const { getAllFilePaths, deleteFileMetadata } = await import('../../core/db/sqlite.js');
    const { scanVault } = await import('../../core/scanner.js');
    const { deleteChunksByPath } = await import('../../core/db/lance.js');

    vi.mocked(getAllFilePaths).mockReturnValue(['/test/vault/orphan.md']);
    vi.mocked(scanVault).mockResolvedValue([]);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    const { registerPruneCommand } = await import('./prune-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerPruneCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'prune', '--vault', '/test/vault']);
    } catch {
      // process.exit throws in test
    }

    expect(deleteFileMetadata).toHaveBeenCalledWith(mockDb, '/test/vault/orphan.md');

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('reports count of pruned files', async () => {
    const { getAllFilePaths } = await import('../../core/db/sqlite.js');
    const { scanVault } = await import('../../core/scanner.js');
    const { deleteChunksByPath } = await import('../../core/db/lance.js');

    vi.mocked(getAllFilePaths).mockReturnValue([
      '/test/vault/orphan1.md',
      '/test/vault/orphan2.md',
      '/test/vault/orphan3.md',
    ]);
    vi.mocked(scanVault).mockResolvedValue([]);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    const { registerPruneCommand } = await import('./prune-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerPruneCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'prune', '--vault', '/test/vault']);
    } catch {
      // process.exit throws in test
    }

    // Should report 3 pruned files
    const calls = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(calls).toMatch(/3/);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('does not delete files in dry-run mode but shows orphaned paths', async () => {
    const { getAllFilePaths } = await import('../../core/db/sqlite.js');
    const { scanVault } = await import('../../core/scanner.js');
    const { deleteChunksByPath } = await import('../../core/db/lance.js');

    vi.mocked(getAllFilePaths).mockReturnValue([
      '/test/vault/orphan.md',
      '/test/vault/existing.md',
    ]);
    vi.mocked(scanVault).mockResolvedValue(['/test/vault/existing.md']);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    const { registerPruneCommand } = await import('./prune-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerPruneCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'prune', '--dry-run', '--vault', '/test/vault']);
    } catch {
      // process.exit throws in test
    }

    // dry-run: should NOT delete
    expect(deleteChunksByPath).not.toHaveBeenCalled();
    // Should show orphaned path
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('/test/vault/orphan.md');

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
