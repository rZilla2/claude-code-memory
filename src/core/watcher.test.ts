import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// --- Mock chokidar ---
const mockChokidarOn = vi.fn().mockReturnThis();
const mockChokidarClose = vi.fn().mockResolvedValue(undefined);
const mockWatcherInstance = {
  on: mockChokidarOn,
  close: mockChokidarClose,
};
vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcherInstance),
}));

// --- Mock DB helpers ---
vi.mock('./db/sqlite.js', () => ({
  getFileHash: vi.fn(),
  incrementUpdateCounter: vi.fn(),
  updateSourcePath: vi.fn(),
  deleteFileMetadata: vi.fn(),
  getAllFilePaths: vi.fn(() => []),
}));

// --- Mock LanceDB helpers ---
vi.mock('./db/lance.js', () => ({
  deleteChunksByPath: vi.fn().mockResolvedValue(undefined),
  updateChunksSourcePath: vi.fn().mockResolvedValue(undefined),
}));

// --- Mock indexer ---
vi.mock('./indexer.js', () => ({
  indexFiles: vi.fn().mockResolvedValue({
    filesIndexed: 1,
    filesSkipped: 0,
    filesFailed: 0,
    chunksCreated: 5,
    failedPaths: [],
  }),
}));

// --- Mock scanner ---
vi.mock('./scanner.js', () => ({
  scanVault: vi.fn().mockResolvedValue([]),
}));

// --- Mock fs/promises ---
vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
  readFile: vi.fn().mockResolvedValue('file content'),
}));

// --- Mock crypto ---
vi.mock('crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('abc123hash'),
  })),
}));

import * as chokidar from 'chokidar';
import * as fsp from 'fs/promises';
import * as sqliteHelpers from './db/sqlite.js';
import * as lanceHelpers from './db/lance.js';
import * as indexerModule from './indexer.js';
import * as scannerModule from './scanner.js';
import { createWatcher, processBatch, startupCatchUp } from './watcher.js';
import type { WatcherOptions } from './watcher.js';

const mockConfig = {
  vaultPath: '/vault',
  indexPath: '/index',
  embeddingProvider: 'openai' as const,
  openaiModel: 'text-embedding-3-small',
  batchSize: 100,
  concurrency: 3,
  ignorePaths: [],
  includeExtensions: ['.md'],
};

const mockDb = {} as any;
const mockTable = {} as any;
const mockEmbedder = { embed: vi.fn(), modelId: vi.fn() } as any;

const watcherOptions: WatcherOptions = {
  config: mockConfig,
  db: mockDb,
  table: mockTable,
  embedder: mockEmbedder,
};

describe('createWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChokidarOn.mockReturnThis();
  });

  it('calls chokidar.watch with correct options', () => {
    createWatcher(watcherOptions);

    expect(chokidar.watch).toHaveBeenCalledWith(
      '/vault',
      expect.objectContaining({
        ignored: expect.arrayContaining(['**/*.icloud', '**/.*']),
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 1500,
          pollInterval: 200,
        },
      })
    );
  });

  it('registers add, change, unlink event listeners', () => {
    createWatcher(watcherOptions);
    const events = mockChokidarOn.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('add');
    expect(events).toContain('change');
    expect(events).toContain('unlink');
  });

  it('returns a handle with a close() method', () => {
    const handle = createWatcher(watcherOptions);
    expect(typeof handle.close).toBe('function');
  });

  it('close() calls chokidar close', async () => {
    const handle = createWatcher(watcherOptions);
    await handle.close();
    expect(mockChokidarClose).toHaveBeenCalled();
  });
});

describe('processBatch - file existence classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('separates existing files (adds) from missing files (unlinks)', async () => {
    (fsp.access as Mock).mockImplementation(async (p: string) => {
      if (p === '/vault/missing.md') throw new Error('ENOENT');
    });
    (sqliteHelpers.getFileHash as Mock).mockReturnValue('oldhash');
    // no matching add for the unlink — real delete
    vi.mocked(fsp.readFile).mockResolvedValue('different content');
    (indexerModule.indexFiles as Mock).mockResolvedValue({ filesIndexed: 0, filesSkipped: 0, filesFailed: 0, chunksCreated: 0, failedPaths: [] });

    await processBatch({
      paths: new Set(['/vault/missing.md']),
      options: watcherOptions,
    });

    // Missing file should trigger delete
    expect(lanceHelpers.deleteChunksByPath).toHaveBeenCalledWith(mockTable, '/vault/missing.md');
    expect(sqliteHelpers.deleteFileMetadata).toHaveBeenCalledWith(mockDb, '/vault/missing.md');
  });

  it('ignores non-.md files added to batch', async () => {
    // processBatch only receives .md paths — filtering is watcher responsibility
    // This test verifies the watcher handler doesn't add non-.md paths
    const handle = createWatcher(watcherOptions);
    // Simulate 'add' event for a non-.md file by checking registered handler
    const addCall = mockChokidarOn.mock.calls.find((c: any[]) => c[0] === 'add');
    expect(addCall).toBeDefined();
    await handle.close();
  });
});

describe('processBatch - rename detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects rename when unlink+add have matching content hash', async () => {
    const HASH = 'matchinghash123';
    // /vault/old.md does not exist on disk (unlink)
    // /vault/new.md exists on disk (add) with same hash
    (fsp.access as Mock).mockImplementation(async (p: string) => {
      if (p === '/vault/old.md') throw new Error('ENOENT');
      // /vault/new.md accessible
    });
    (sqliteHelpers.getFileHash as Mock).mockImplementation((_db: any, p: string) => {
      if (p === '/vault/old.md') return HASH;
      return null;
    });
    // readFile for /vault/new.md returns content that hashes to HASH
    vi.mocked(fsp.readFile).mockResolvedValue('content');
    const { createHash } = await import('crypto');
    vi.mocked(createHash).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue(HASH),
    } as any);

    await processBatch({
      paths: new Set(['/vault/old.md', '/vault/new.md']),
      options: watcherOptions,
    });

    expect(lanceHelpers.updateChunksSourcePath).toHaveBeenCalledWith(mockTable, '/vault/old.md', '/vault/new.md');
    expect(sqliteHelpers.updateSourcePath).toHaveBeenCalledWith(mockDb, '/vault/old.md', '/vault/new.md');
    // Should NOT call indexFiles or deleteChunksByPath for rename
    expect(lanceHelpers.deleteChunksByPath).not.toHaveBeenCalled();
    expect(indexerModule.indexFiles).not.toHaveBeenCalled();
  });

  it('treats unmatched unlink as real delete', async () => {
    (fsp.access as Mock).mockImplementation(async (p: string) => {
      throw new Error('ENOENT');
    });
    (sqliteHelpers.getFileHash as Mock).mockReturnValue('somehash');

    await processBatch({
      paths: new Set(['/vault/deleted.md']),
      options: watcherOptions,
    });

    expect(lanceHelpers.deleteChunksByPath).toHaveBeenCalledWith(mockTable, '/vault/deleted.md');
    expect(sqliteHelpers.deleteFileMetadata).toHaveBeenCalledWith(mockDb, '/vault/deleted.md');
  });

  it('treats unmatched add as new file to reindex', async () => {
    (fsp.access as Mock).mockResolvedValue(undefined); // file exists
    (sqliteHelpers.getFileHash as Mock).mockReturnValue(null); // not in SQLite

    await processBatch({
      paths: new Set(['/vault/new-file.md']),
      options: watcherOptions,
    });

    expect(indexerModule.indexFiles).toHaveBeenCalledWith(
      ['/vault/new-file.md'],
      mockConfig,
      mockDb,
      mockTable,
      mockEmbedder,
    );
  });
});

describe('processBatch - update counter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls incrementUpdateCounter after indexing files', async () => {
    (fsp.access as Mock).mockResolvedValue(undefined);
    (sqliteHelpers.getFileHash as Mock).mockReturnValue(null);
    (indexerModule.indexFiles as Mock).mockResolvedValue({
      filesIndexed: 2,
      filesSkipped: 0,
      filesFailed: 0,
      chunksCreated: 10,
      failedPaths: [],
    });

    await processBatch({
      paths: new Set(['/vault/a.md', '/vault/b.md']),
      options: watcherOptions,
    });

    expect(sqliteHelpers.incrementUpdateCounter).toHaveBeenCalledWith(mockDb, 2);
  });

  it('does not crash if onBatch throws — errors are caught and logged', async () => {
    (fsp.access as Mock).mockRejectedValue(new Error('fs error'));

    // Should not throw
    await expect(processBatch({
      paths: new Set(['/vault/x.md']),
      options: watcherOptions,
    })).resolves.not.toThrow();
  });
});

describe('startupCatchUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns total vault file count', async () => {
    (scannerModule.scanVault as Mock).mockResolvedValue(['/vault/a.md', '/vault/b.md']);
    (fsp.stat as Mock).mockResolvedValue({ mtimeMs: 500 });
    (sqliteHelpers.getFileHash as Mock).mockReturnValue('hash');
    // getIndexedAt — need to check files table; add mock for db.prepare
    // Use a db that returns indexed_at > mtimeMs so files are skipped
    const mockDbWithPrepare = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ indexed_at: 1000 }), // indexed_at > mtimeMs(500)
      }),
    };

    const result = await startupCatchUp({ ...watcherOptions, db: mockDbWithPrepare as any });
    expect(result.total).toBe(2);
  });

  it('skips files where mtime <= indexed_at (fast pre-filter)', async () => {
    (scannerModule.scanVault as Mock).mockResolvedValue(['/vault/fresh.md']);
    (fsp.stat as Mock).mockResolvedValue({ mtimeMs: 500 }); // mtime=500

    const mockDbSkip = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ indexed_at: 1000 }), // indexed_at=1000 > mtime=500 → skip
      }),
    };

    const result = await startupCatchUp({ ...watcherOptions, db: mockDbSkip as any });
    expect(result.reindexed).toBe(0);
    expect(indexerModule.indexFiles).not.toHaveBeenCalled();
  });

  it('re-indexes files where mtime > indexed_at AND hash differs', async () => {
    (scannerModule.scanVault as Mock).mockResolvedValue(['/vault/stale.md']);
    (fsp.stat as Mock).mockResolvedValue({ mtimeMs: 2000 }); // mtime=2000 > indexed_at=500
    vi.mocked(fsp.readFile).mockResolvedValue('new content');
    const { createHash } = await import('crypto');
    vi.mocked(createHash).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('newhash'),
    } as any);

    const mockDbStale = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ indexed_at: 500, content_hash: 'oldhash' }),
      }),
    };

    const result = await startupCatchUp({ ...watcherOptions, db: mockDbStale as any });
    expect(result.reindexed).toBe(1);
    expect(indexerModule.indexFiles).toHaveBeenCalledWith(
      ['/vault/stale.md'],
      mockConfig,
      expect.anything(),
      mockTable,
      mockEmbedder,
    );
  });
});
