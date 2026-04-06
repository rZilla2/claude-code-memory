import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WatcherHandle } from '../../core/watcher.js';

// Mock all external dependencies before imports
vi.mock('../../core/watcher.js', () => ({
  createWatcher: vi.fn(),
  startupCatchUp: vi.fn(),
}));

vi.mock('./compact-cmd.js', () => ({
  maybeAutoCompact: vi.fn(),
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

describe('watch-cmd startup orchestration', () => {
  let mockDb: Database.Database;
  let mockTable: lancedb.Table;
  let mockWatcher: WatcherHandle;
  let sigintHandlers: Array<(...args: unknown[]) => void>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDb = {
      close: vi.fn(),
    } as unknown as Database.Database;

    mockTable = {} as unknown as lancedb.Table;

    mockWatcher = {
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) as unknown as () => Promise<void>,
    };

    sigintHandlers = [];

    // Capture SIGINT handlers
    const originalOn = process.on.bind(process);
    vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      if (event === 'SIGINT') {
        sigintHandlers.push(handler as (...args: unknown[]) => void);
      }
      return process;
    });

    const { openMetadataDb } = await import('../../core/db/sqlite.js');
    const { connectLanceDb, openChunksTable } = await import('../../core/db/lance.js');
    const { loadConfig } = await import('../../config.js');
    const { createEmbeddingProvider } = await import('../../core/embedder/factory.js');
    const { createWatcher, startupCatchUp } = await import('../../core/watcher.js');
    const { maybeAutoCompact } = await import('./compact-cmd.js');

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

    vi.mocked(startupCatchUp).mockResolvedValue({ reindexed: 0, total: 0 });
    vi.mocked(maybeAutoCompact).mockResolvedValue(false);
    vi.mocked(createWatcher).mockReturnValue(mockWatcher);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls startupCatchUp on start', async () => {
    const { startupCatchUp } = await import('../../core/watcher.js');
    const { registerWatchCommand } = await import('./watch-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerWatchCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'watch', '--vault', '/test/vault']);
    } catch {
      // process.exit or SIGINT throws in test
    }

    expect(startupCatchUp).toHaveBeenCalledOnce();

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('calls maybeAutoCompact on start', async () => {
    const { maybeAutoCompact } = await import('./compact-cmd.js');
    const { registerWatchCommand } = await import('./watch-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerWatchCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'watch', '--vault', '/test/vault']);
    } catch {
      // expected
    }

    expect(maybeAutoCompact).toHaveBeenCalledOnce();

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('calls createWatcher with correct WatcherOptions shape', async () => {
    const { createWatcher } = await import('../../core/watcher.js');
    const { registerWatchCommand } = await import('./watch-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerWatchCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['node', 'mem', 'watch', '--vault', '/test/vault']);
    } catch {
      // expected
    }

    expect(createWatcher).toHaveBeenCalledOnce();
    const [options] = vi.mocked(createWatcher).mock.calls[0];
    expect(options).toMatchObject({
      config: expect.objectContaining({ vaultPath: '/test/vault' }),
      db: mockDb,
      table: mockTable,
      embedder: expect.objectContaining({ modelId: expect.any(Function) }),
      onBatchComplete: expect.any(Function),
    });

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('SIGINT handler calls watcher.close()', async () => {
    const { registerWatchCommand } = await import('./watch-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerWatchCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Run command (non-blocking, watcher keeps process alive)
    const parsePromise = program.parseAsync(['node', 'mem', 'watch', '--vault', '/test/vault']);

    // Let the async startup run
    await new Promise(resolve => setTimeout(resolve, 10));

    // Trigger SIGINT
    for (const handler of sigintHandlers) {
      try {
        await handler();
      } catch {
        // process.exit throws
      }
    }

    try {
      await parsePromise;
    } catch {
      // expected
    }

    expect(mockWatcher.close).toHaveBeenCalled();

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('SIGINT handler closes db connection', async () => {
    const { registerWatchCommand } = await import('./watch-cmd.js');
    const { Command } = await import('commander');

    const program = new Command();
    program.exitOverride();
    registerWatchCommand(program);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const parsePromise = program.parseAsync(['node', 'mem', 'watch', '--vault', '/test/vault']);

    await new Promise(resolve => setTimeout(resolve, 10));

    for (const handler of sigintHandlers) {
      try {
        await handler();
      } catch {
        // process.exit throws
      }
    }

    try {
      await parsePromise;
    } catch {
      // expected
    }

    expect(mockDb.close).toHaveBeenCalled();

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
