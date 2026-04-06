import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before imports
vi.mock('../../core/db/sqlite.js', () => ({
  getCompactionMetadata: vi.fn(),
  recordCompaction: vi.fn(),
  openMetadataDb: vi.fn(),
  assertModelMatch: vi.fn(),
}));

vi.mock('../../core/db/lance.js', () => ({
  connectLanceDb: vi.fn(),
  openChunksTable: vi.fn(),
}));

vi.mock('../../core/embedder/factory.js', () => ({
  createEmbeddingProvider: vi.fn(),
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

import { maybeAutoCompact } from './compact-cmd.js';
import { getCompactionMetadata, recordCompaction } from '../../core/db/sqlite.js';
import type Database from 'better-sqlite3';
import type * as lancedb from '@lancedb/lancedb';

describe('maybeAutoCompact', () => {
  let mockDb: Database.Database;
  let mockTable: lancedb.Table;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {} as Database.Database;
    mockTable = {
      optimize: vi.fn().mockResolvedValue(undefined),
    } as unknown as lancedb.Table;
  });

  it('calls table.optimize() when lastCompactedAt is >24h ago AND updatesSinceCompact >50', async () => {
    const twentySixHoursAgo = Date.now() - 26 * 60 * 60 * 1000;
    vi.mocked(getCompactionMetadata).mockReturnValue({
      lastCompactedAt: twentySixHoursAgo,
      updatesSinceCompact: 51,
    });

    const result = await maybeAutoCompact(mockDb, mockTable);

    expect(mockTable.optimize).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('does NOT call table.optimize() when lastCompactedAt is <24h ago', async () => {
    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000;
    vi.mocked(getCompactionMetadata).mockReturnValue({
      lastCompactedAt: tenHoursAgo,
      updatesSinceCompact: 100,
    });

    const result = await maybeAutoCompact(mockDb, mockTable);

    expect(mockTable.optimize).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('does NOT call table.optimize() when updatesSinceCompact <=50', async () => {
    const twentySixHoursAgo = Date.now() - 26 * 60 * 60 * 1000;
    vi.mocked(getCompactionMetadata).mockReturnValue({
      lastCompactedAt: twentySixHoursAgo,
      updatesSinceCompact: 50,
    });

    const result = await maybeAutoCompact(mockDb, mockTable);

    expect(mockTable.optimize).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('calls recordCompaction(db) after successful optimize', async () => {
    const twentySixHoursAgo = Date.now() - 26 * 60 * 60 * 1000;
    vi.mocked(getCompactionMetadata).mockReturnValue({
      lastCompactedAt: twentySixHoursAgo,
      updatesSinceCompact: 75,
    });

    await maybeAutoCompact(mockDb, mockTable);

    expect(recordCompaction).toHaveBeenCalledWith(mockDb);
  });

  it('does NOT call recordCompaction when thresholds not met', async () => {
    vi.mocked(getCompactionMetadata).mockReturnValue({
      lastCompactedAt: Date.now(),
      updatesSinceCompact: 10,
    });

    await maybeAutoCompact(mockDb, mockTable);

    expect(recordCompaction).not.toHaveBeenCalled();
  });
});

describe('mem compact command', () => {
  let mockDb: Database.Database;
  let mockTable: lancedb.Table;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDb = {
      close: vi.fn(),
    } as unknown as Database.Database;

    mockTable = {
      optimize: vi.fn().mockResolvedValue(undefined),
    } as unknown as lancedb.Table;

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
    vi.mocked(getCompactionMetadata).mockReturnValue({
      lastCompactedAt: Date.now(),
      updatesSinceCompact: 0,
    });
  });

  it('always calls table.optimize() regardless of thresholds', async () => {
    const { registerCompactCommand } = await import('./compact-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerCompactCommand(program);

    // Mock process.exit to prevent actual exit
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    try {
      await program.parseAsync(['node', 'mem', 'compact', '--vault', '/test/vault']);
    } catch {
      // process.exit throws in test
    }

    expect(mockTable.optimize).toHaveBeenCalledOnce();
    exitSpy.mockRestore();
  });

  it('calls recordCompaction(db) after optimize in compact command', async () => {
    const { registerCompactCommand } = await import('./compact-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerCompactCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    try {
      await program.parseAsync(['node', 'mem', 'compact', '--vault', '/test/vault']);
    } catch {
      // process.exit throws in test
    }

    expect(recordCompaction).toHaveBeenCalledWith(mockDb);
    exitSpy.mockRestore();
  });
});
