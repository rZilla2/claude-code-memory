import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock all core modules before importing index-cmd
vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/db/sqlite.js', () => ({
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

vi.mock('../../core/indexer.js', () => ({
  indexVault: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { loadConfig } from '../../config.js';
import { openMetadataDb, assertModelMatch } from '../../core/db/sqlite.js';
import { connectLanceDb, openChunksTable } from '../../core/db/lance.js';
import { createEmbeddingProvider } from '../../core/embedder/factory.js';
import { indexVault } from '../../core/indexer.js';
import { registerIndexCommand } from './index-cmd.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockOpenMetadataDb = vi.mocked(openMetadataDb);
const mockAssertModelMatch = vi.mocked(assertModelMatch);
const mockConnectLanceDb = vi.mocked(connectLanceDb);
const mockOpenChunksTable = vi.mocked(openChunksTable);
const mockCreateEmbeddingProvider = vi.mocked(createEmbeddingProvider);
const mockIndexVault = vi.mocked(indexVault);

describe('registerIndexCommand', () => {
  let program: Command;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const mockDb = { close: vi.fn() } as unknown as import('better-sqlite3').Database;
  const mockConnection = {} as import('@lancedb/lancedb').Connection;
  const mockTable = {} as import('@lancedb/lancedb').Table;
  const mockEmbedder = { modelId: () => 'openai:text-embedding-3-small', embed: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride(); // Prevents process.exit on parse errors

    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockLoadConfig.mockReturnValue({
      vaultPath: '/mock/vault',
      indexPath: '/mock/index',
      embeddingProvider: 'openai',
      openaiModel: 'text-embedding-3-small',
      batchSize: 100,
      concurrency: 2,
      ignorePaths: [],
      includeExtensions: ['.md'],
    });
    mockOpenMetadataDb.mockReturnValue(mockDb);
    mockAssertModelMatch.mockReturnValue(undefined);
    mockConnectLanceDb.mockResolvedValue(mockConnection);
    mockOpenChunksTable.mockResolvedValue(mockTable);
    mockCreateEmbeddingProvider.mockReturnValue(mockEmbedder);
  });

  it('Test 1: adds "index" command to commander program', () => {
    registerIndexCommand(program);
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain('index');
  });

  it('Test 2: calls loadConfig, opens DB, creates embedder, and calls indexVault', async () => {
    mockIndexVault.mockResolvedValue({
      filesIndexed: 5,
      filesSkipped: 2,
      filesFailed: 0,
      chunksCreated: 20,
      failedPaths: [],
    });

    registerIndexCommand(program);
    await program.parseAsync(['index'], { from: 'user' });

    expect(mockLoadConfig).toHaveBeenCalledOnce();
    expect(mockOpenMetadataDb).toHaveBeenCalledWith('/mock/index');
    expect(mockCreateEmbeddingProvider).toHaveBeenCalledOnce();
    expect(mockAssertModelMatch).toHaveBeenCalledWith(mockDb, 'openai:text-embedding-3-small');
    expect(mockConnectLanceDb).toHaveBeenCalledWith('/mock/index');
    expect(mockOpenChunksTable).toHaveBeenCalledWith(mockConnection);
    expect(mockIndexVault).toHaveBeenCalledWith(
      expect.objectContaining({ vaultPath: '/mock/vault' }),
      mockDb,
      mockTable,
      mockEmbedder,
      expect.any(Function),
    );
  });

  it('Test 3: --verbose flag is passed through to progress callback behavior', async () => {
    mockIndexVault.mockImplementation(async (_config, _db, _table, _embedder, onProgress) => {
      onProgress?.(1, 2, 1);
      return { filesIndexed: 1, filesSkipped: 1, filesFailed: 0, chunksCreated: 4, failedPaths: [] };
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    registerIndexCommand(program);
    await program.parseAsync(['index', '--verbose'], { from: 'user' });

    // In verbose mode, no progress bar written to stderr during progress callback
    // (stderr.write still called for newline at end, but not \r bar)
    const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string);
    const hasProgressBar = stderrCalls.some((s) => s.includes('█') || s.includes('░'));
    expect(hasProgressBar).toBe(false);

    consoleSpy.mockRestore();
  });

  it('Test 4: prints summary to stdout after indexing completes', async () => {
    mockIndexVault.mockResolvedValue({
      filesIndexed: 10,
      filesSkipped: 3,
      filesFailed: 0,
      chunksCreated: 42,
      failedPaths: [],
    });

    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg);
    });

    registerIndexCommand(program);
    await program.parseAsync(['index'], { from: 'user' });

    const output = logs.join('\n');
    expect(output).toContain('10');  // filesIndexed
    expect(output).toContain('3');   // filesSkipped
    expect(output).toContain('42');  // chunksCreated

    consoleSpy.mockRestore();
  });

  it('Test 5: progress callback writes to stderr, not stdout', async () => {
    mockIndexVault.mockImplementation(async (_config, _db, _table, _embedder, onProgress) => {
      onProgress?.(1, 5, 1);
      onProgress?.(5, 5, 3);
      return { filesIndexed: 3, filesSkipped: 2, filesFailed: 0, chunksCreated: 12, failedPaths: [] };
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    registerIndexCommand(program);
    await program.parseAsync(['index'], { from: 'user' });

    // Progress bar written to stderr
    expect(stderrSpy).toHaveBeenCalled();
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(stderrOutput).toContain('5/5');

    consoleSpy.mockRestore();
  });
});
