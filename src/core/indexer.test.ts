import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IndexResult, IndexFileResult } from './indexer.js';

// --- Mock fs/promises ---
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// --- Mock scanner ---
vi.mock('./scanner.js', () => ({
  scanVault: vi.fn(),
}));

// --- Mock chunker ---
vi.mock('./chunker.js', () => ({
  chunkMarkdown: vi.fn(),
}));

// --- Mock DB helpers ---
vi.mock('./db/sqlite.js', () => ({
  getFileHash: vi.fn(),
  upsertFile: vi.fn(),
}));

vi.mock('./db/lance.js', () => ({
  deleteChunksByPath: vi.fn(),
}));

// --- Mock logger ---
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { readFile } from 'fs/promises';
import { scanVault } from './scanner.js';
import { chunkMarkdown } from './chunker.js';
import { getFileHash, upsertFile } from './db/sqlite.js';
import { deleteChunksByPath } from './db/lance.js';
import { indexFile, indexVault } from './indexer.js';
import type { Config } from '../types.js';
import type { EmbeddingProvider } from './embedder/types.js';

const mockConfig: Config = {
  vaultPath: '/vault',
  indexPath: '/index',
  embeddingProvider: 'openai',
  openaiModel: 'text-embedding-3-small',
  batchSize: 100,
  concurrency: 5,
  ignorePaths: [],
  includeExtensions: ['.md'],
};

function makeMockDb() {
  return {} as any;
}

function makeMockTable() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeMockEmbedder(vectors?: number[][]): EmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue(vectors ?? [[0.1, 0.2, 0.3]]),
    modelId: () => 'test:mock',
  };
}

function makeChunk(id: string) {
  return {
    id,
    headingPath: '# Section',
    embeddableText: `Text for ${id}`,
    chunkHash: `hash-${id}`,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// -------------------------------------------------------------------------
// Test 1: New file (no stored hash) gets chunked, embedded, and stored
// -------------------------------------------------------------------------
describe('indexFile - new file', () => {
  it('calls embedder.embed with chunk texts for a new file', async () => {
    const db = makeMockDb();
    const table = makeMockTable();
    const embedder = makeMockEmbedder([[0.1, 0.2]]);

    vi.mocked(readFile).mockResolvedValue('# Hello\n\nworld' as any);
    vi.mocked(getFileHash).mockReturnValue(null); // no stored hash
    vi.mocked(chunkMarkdown).mockReturnValue([makeChunk('chunk1')]);

    const result = await indexFile('/vault/note.md', mockConfig, db, table, embedder);

    expect(embedder.embed).toHaveBeenCalledWith(['Text for chunk1']);
    expect(table.add).toHaveBeenCalled();
    expect(upsertFile).toHaveBeenCalled();
    expect(result.status).toBe('indexed');
    expect(result.chunksCreated).toBe(1);
  });
});

// -------------------------------------------------------------------------
// Test 2: Unchanged file (same hash) is skipped
// -------------------------------------------------------------------------
describe('indexFile - unchanged file', () => {
  it('skips embedding when file hash matches stored hash', async () => {
    const db = makeMockDb();
    const table = makeMockTable();
    const embedder = makeMockEmbedder();

    // File content sha256 must match getFileHash return value
    // We use a known content and its pre-computed sha256
    const content = 'same content';
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(content, 'utf-8').digest('hex');

    vi.mocked(readFile).mockResolvedValue(content as any);
    vi.mocked(getFileHash).mockReturnValue(hash); // matches

    const result = await indexFile('/vault/note.md', mockConfig, db, table, embedder);

    expect(embedder.embed).not.toHaveBeenCalled();
    expect(result.status).toBe('skipped');
    expect(result.chunksCreated).toBe(0);
  });
});

// -------------------------------------------------------------------------
// Test 3: Changed file: deleteChunksByPath called BEFORE table.add
// -------------------------------------------------------------------------
describe('indexFile - changed file', () => {
  it('deletes stale chunks before inserting new ones', async () => {
    const db = makeMockDb();
    const table = makeMockTable();
    const embedder = makeMockEmbedder([[0.1, 0.2]]);

    vi.mocked(readFile).mockResolvedValue('new content' as any);
    vi.mocked(getFileHash).mockReturnValue('old-hash'); // different — file changed
    vi.mocked(chunkMarkdown).mockReturnValue([makeChunk('c1')]);

    const callOrder: string[] = [];
    vi.mocked(deleteChunksByPath).mockImplementation(async () => { callOrder.push('delete'); });
    table.add.mockImplementation(async () => { callOrder.push('add'); });

    await indexFile('/vault/note.md', mockConfig, db, table, embedder);

    expect(callOrder).toEqual(['delete', 'add']);
  });
});

// -------------------------------------------------------------------------
// Test 4: indexVault returns IndexResult with correct counts
// -------------------------------------------------------------------------
describe('indexVault - result counts', () => {
  it('returns correct indexed/skipped/failed/chunksCreated', async () => {
    const db = makeMockDb();
    const table = makeMockTable();
    const embedder = makeMockEmbedder([[0.1], [0.2], [0.3]]);

    // 3 files: file1 (new, 2 chunks), file2 (unchanged), file3 (new, 1 chunk)
    vi.mocked(scanVault).mockResolvedValue(['/vault/f1.md', '/vault/f2.md', '/vault/f3.md']);

    const { createHash } = await import('crypto');
    const f2Content = 'unchanged';
    const f2Hash = createHash('sha256').update(f2Content, 'utf-8').digest('hex');

    vi.mocked(readFile)
      .mockResolvedValueOnce('new file 1' as any)
      .mockResolvedValueOnce(f2Content as any)
      .mockResolvedValueOnce('new file 3' as any);

    vi.mocked(getFileHash)
      .mockReturnValueOnce(null)       // f1 - new
      .mockReturnValueOnce(f2Hash)     // f2 - unchanged
      .mockReturnValueOnce(null);      // f3 - new

    vi.mocked(chunkMarkdown)
      .mockReturnValueOnce([makeChunk('c1'), makeChunk('c2')]) // f1 gets 2 chunks
      .mockReturnValueOnce([makeChunk('c3')]);                  // f3 gets 1 chunk

    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);
    embedder.embed = vi.fn()
      .mockResolvedValueOnce([[0.1, 0.2], [0.3, 0.4]])  // f1 vectors
      .mockResolvedValueOnce([[0.5, 0.6]]);               // f3 vectors

    const result: IndexResult = await indexVault(mockConfig, db, table, embedder);

    expect(result.filesIndexed).toBe(2);
    expect(result.filesSkipped).toBe(1);
    expect(result.filesFailed).toBe(0);
    expect(result.chunksCreated).toBe(3); // 2 + 0 + 1
    expect(result.failedPaths).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// Test 5: File read error logs warning and continues pipeline
// -------------------------------------------------------------------------
describe('indexVault - read error resilience', () => {
  it('logs failure and continues when a file read throws', async () => {
    const db = makeMockDb();
    const table = makeMockTable();
    const embedder = makeMockEmbedder([[0.1]]);

    vi.mocked(scanVault).mockResolvedValue(['/vault/bad.md', '/vault/good.md']);

    // bad.md always throws
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT: no such file'))
      .mockRejectedValueOnce(new Error('ENOENT: no such file')) // retry also fails
      .mockResolvedValueOnce('good content' as any);

    vi.mocked(getFileHash).mockReturnValue(null);
    vi.mocked(chunkMarkdown).mockReturnValue([makeChunk('c1')]);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    const result = await indexVault(mockConfig, db, table, embedder);

    expect(result.filesFailed).toBe(1);
    expect(result.failedPaths).toContain('/vault/bad.md');
    expect(result.filesIndexed).toBe(1);
  });
});

// -------------------------------------------------------------------------
// Test 6: Embedder error on one file logs failure and continues
// -------------------------------------------------------------------------
describe('indexVault - embedder error resilience', () => {
  it('marks file as failed when embedder throws and continues to next file', async () => {
    const db = makeMockDb();
    const table = makeMockTable();
    const embedder = makeMockEmbedder();

    vi.mocked(scanVault).mockResolvedValue(['/vault/a.md', '/vault/b.md']);

    vi.mocked(readFile).mockResolvedValue('content' as any);
    vi.mocked(getFileHash).mockReturnValue(null);
    vi.mocked(chunkMarkdown).mockReturnValue([makeChunk('chunk')]);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    // embedder fails on first two calls (first try + retry), then succeeds on third
    embedder.embed = vi.fn()
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockRejectedValueOnce(new Error('API timeout'))  // retry fails too
      .mockResolvedValueOnce([[0.1, 0.2]]);              // b.md succeeds

    const result = await indexVault(mockConfig, db, table, embedder);

    expect(result.filesFailed).toBe(1);
    expect(result.failedPaths).toContain('/vault/a.md');
    expect(result.filesIndexed).toBe(1);
  });
});

// -------------------------------------------------------------------------
// Test 7: indexFile returns IndexFileResult with chunksCreated matching chunks
// -------------------------------------------------------------------------
describe('indexFile - IndexFileResult shape', () => {
  it('returns chunksCreated equal to number of chunks produced', async () => {
    const db = makeMockDb();
    const table = makeMockTable();
    const embedder = makeMockEmbedder([[0.1], [0.2], [0.3]]);

    vi.mocked(readFile).mockResolvedValue('three chunks file' as any);
    vi.mocked(getFileHash).mockReturnValue(null);
    vi.mocked(chunkMarkdown).mockReturnValue([
      makeChunk('c1'),
      makeChunk('c2'),
      makeChunk('c3'),
    ]);
    vi.mocked(deleteChunksByPath).mockResolvedValue(undefined);

    const result: IndexFileResult = await indexFile('/vault/note.md', mockConfig, db, table, embedder);

    expect(result.status).toBe('indexed');
    expect(result.chunksCreated).toBe(3);
  });
});
