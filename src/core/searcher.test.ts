import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecordBatch } from 'apache-arrow';

// --- Mock @lancedb/lancedb (for RRFReranker via lancedb.rerankers) ---
// Use vi.hoisted so variables are available inside the vi.mock() factory
const { mockRerankHybrid, mockRRFCreate } = vi.hoisted(() => {
  const mockRerankHybrid = vi.fn();
  const mockRRFCreate = vi.fn();
  return { mockRerankHybrid, mockRRFCreate };
});

vi.mock('@lancedb/lancedb', () => ({
  rerankers: {
    RRFReranker: {
      create: mockRRFCreate,
    },
  },
}));

// --- Mock logger ---
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { search } from './searcher.js';
import type { SearchOptions } from '../types.js';
import type { EmbeddingProvider } from './embedder/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vault/note.md#0',
    text: 'Hello world chunk',
    source_path: 'vault/note.md',
    heading_path: '# Title',
    indexed_at: BigInt(1_700_000_000_000),
    _distance: 0.25,
    ...overrides,
  };
}

/** Creates a chainable mock query builder returned by table.search() */
function makeQueryBuilder(rows: unknown[] = [makeRow()], arrowResult?: RecordBatch) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    withRowId: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
    toArrow: vi.fn().mockResolvedValue({ batches: [arrowResult ?? buildFakeRecordBatch(rows)] }),
  };
  return builder;
}

/** Minimal fake RecordBatch shape used by hybrid mode */
function buildFakeRecordBatch(rows: unknown[]) {
  const data: Record<string, unknown[]> = {
    id: [],
    text: [],
    source_path: [],
    heading_path: [],
    indexed_at: [],
    _relevance_score: [],
  };

  for (const row of rows as Array<Record<string, unknown>>) {
    data['id'].push(row['id'] ?? '');
    data['text'].push(row['text'] ?? '');
    data['source_path'].push(row['source_path'] ?? '');
    data['heading_path'].push(row['heading_path'] ?? '');
    data['indexed_at'].push(row['indexed_at'] ?? BigInt(0));
    data['_relevance_score'].push(0.9);
  }

  const numRows = rows.length;
  const fieldNames = Object.keys(data);

  return {
    numRows,
    schema: {
      fields: fieldNames.map((name) => ({ name })),
    },
    getChildAt: (idx: number) => ({
      get: (i: number) => data[fieldNames[idx]]?.[i],
    }),
  } as unknown as RecordBatch;
}

function makeMockEmbedder(vector: number[] = Array(1536).fill(0.1)): EmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue([vector]),
    modelId: vi.fn().mockReturnValue('openai:text-embedding-3-small'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search()', () => {
  let mockTable: { search: ReturnType<typeof vi.fn> };
  let mockEmbedder: EmbeddingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedder = makeMockEmbedder();
    mockTable = { search: vi.fn() };
    // Default RRFReranker.create() returns an instance with rerankHybrid
    mockRRFCreate.mockResolvedValue({ rerankHybrid: mockRerankHybrid });
  });

  // --- Vector mode ---

  describe('vector mode', () => {
    it('calls embedder.embed with the query string', async () => {
      mockTable.search.mockReturnValue(makeQueryBuilder());
      await search('test query', mockTable as never, mockEmbedder, { mode: 'vector' });
      expect(mockEmbedder.embed).toHaveBeenCalledWith(['test query']);
    });

    it('calls table.search with the embedding vector (not a string)', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      await search('test query', mockTable as never, mockEmbedder, { mode: 'vector' });
      const arg = mockTable.search.mock.calls[0][0];
      expect(Array.isArray(arg)).toBe(true);
    });

    it('calls .select() with result columns', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      await search('q', mockTable as never, mockEmbedder, { mode: 'vector' });
      expect(qb.select).toHaveBeenCalled();
    });

    it('calls .limit() with topK', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      await search('q', mockTable as never, mockEmbedder, { mode: 'vector', topK: 5 });
      expect(qb.limit).toHaveBeenCalledWith(5);
    });

    it('returns SearchResult[] with correct shape', async () => {
      mockTable.search.mockReturnValue(makeQueryBuilder([makeRow()]));
      const results = await search('q', mockTable as never, mockEmbedder, { mode: 'vector' });
      expect(results).toHaveLength(1);
      const r = results[0];
      expect(typeof r.id).toBe('string');
      expect(typeof r.sourcePath).toBe('string');
      expect(typeof r.headingPath).toBe('string');
      expect(typeof r.text).toBe('string');
      expect(typeof r.score).toBe('number');
      expect(r.indexedAt).toBeInstanceOf(Date);
    });

    it('maps source_path → sourcePath, heading_path → headingPath', async () => {
      const row = makeRow({ source_path: 'notes/a.md', heading_path: '# A > ## B' });
      mockTable.search.mockReturnValue(makeQueryBuilder([row]));
      const [result] = await search('q', mockTable as never, mockEmbedder, { mode: 'vector' });
      expect(result.sourcePath).toBe('notes/a.md');
      expect(result.headingPath).toBe('# A > ## B');
    });
  });

  // --- FTS mode ---

  describe('fts mode', () => {
    it('calls table.search with query string and "fts" type', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      await search('hello', mockTable as never, mockEmbedder, { mode: 'fts' });
      expect(mockTable.search).toHaveBeenCalledWith('hello', 'fts');
    });

    it('does NOT call embedder.embed in fts mode', async () => {
      mockTable.search.mockReturnValue(makeQueryBuilder());
      await search('hello', mockTable as never, mockEmbedder, { mode: 'fts' });
      expect(mockEmbedder.embed).not.toHaveBeenCalled();
    });

    it('returns SearchResult[] with correct shape', async () => {
      const row = makeRow({ _distance: undefined, _score: 0.8 });
      mockTable.search.mockReturnValue(makeQueryBuilder([row]));
      const results = await search('q', mockTable as never, mockEmbedder, { mode: 'fts' });
      expect(results).toHaveLength(1);
      expect(results[0].indexedAt).toBeInstanceOf(Date);
    });
  });

  // --- Hybrid mode ---

  describe('hybrid mode', () => {
    it('calls table.search twice (vector + fts) in parallel', async () => {
      const fakeArrow = buildFakeRecordBatch([makeRow()]);
      mockRerankHybrid.mockResolvedValue(fakeArrow);
      const vecQb = makeQueryBuilder([], fakeArrow);
      const ftsQb = makeQueryBuilder([], fakeArrow);
      mockTable.search
        .mockReturnValueOnce(vecQb)
        .mockReturnValueOnce(ftsQb);

      await search('q', mockTable as never, mockEmbedder, { mode: 'hybrid' });

      expect(mockTable.search).toHaveBeenCalledTimes(2);
      // First call: vector (array)
      expect(Array.isArray(mockTable.search.mock.calls[0][0])).toBe(true);
      // Second call: fts (string)
      expect(mockTable.search.mock.calls[1][1]).toBe('fts');
    });

    it('calls rerankHybrid with the query', async () => {
      const fakeArrow = buildFakeRecordBatch([makeRow()]);
      mockRerankHybrid.mockResolvedValue(fakeArrow);
      const qb = makeQueryBuilder([], fakeArrow);
      mockTable.search.mockReturnValue(qb);

      await search('myquery', mockTable as never, mockEmbedder, { mode: 'hybrid' });
      expect(mockRerankHybrid).toHaveBeenCalledWith(
        'myquery',
        expect.anything(),
        expect.anything(),
      );
    });

    it('calls .withRowId() on hybrid sub-queries', async () => {
      const fakeArrow = buildFakeRecordBatch([makeRow()]);
      mockRerankHybrid.mockResolvedValue(fakeArrow);
      const vecQb = makeQueryBuilder([], fakeArrow);
      const ftsQb = makeQueryBuilder([], fakeArrow);
      mockTable.search
        .mockReturnValueOnce(vecQb)
        .mockReturnValueOnce(ftsQb);

      await search('q', mockTable as never, mockEmbedder, { mode: 'hybrid' });
      expect(vecQb.withRowId).toHaveBeenCalled();
      expect(ftsQb.withRowId).toHaveBeenCalled();
    });
  });

  // --- Default options ---

  describe('defaults', () => {
    it('defaults topK to 10 when not specified', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      await search('q', mockTable as never, mockEmbedder, { mode: 'fts' });
      expect(qb.limit).toHaveBeenCalledWith(10);
    });

    it('defaults mode to hybrid when not specified', async () => {
      const fakeArrow = buildFakeRecordBatch([makeRow()]);
      mockRerankHybrid.mockResolvedValue(fakeArrow);
      const qb = makeQueryBuilder([], fakeArrow);
      mockTable.search.mockReturnValue(qb);

      await search('q', mockTable as never, mockEmbedder);
      // hybrid calls search twice
      expect(mockTable.search).toHaveBeenCalledTimes(2);
    });
  });

  // --- Where predicate ---

  describe('date filter', () => {
    it('applies afterDate as indexed_at >= predicate', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      const afterDate = new Date('2024-01-01T00:00:00Z');
      await search('q', mockTable as never, mockEmbedder, { mode: 'fts', afterDate });
      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining(`indexed_at >= ${afterDate.getTime()}`),
      );
    });

    it('applies beforeDate as indexed_at <= predicate', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      const beforeDate = new Date('2024-12-31T00:00:00Z');
      await search('q', mockTable as never, mockEmbedder, { mode: 'fts', beforeDate });
      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining(`indexed_at <= ${beforeDate.getTime()}`),
      );
    });

    it('does NOT call .where() when no filters are set', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      await search('q', mockTable as never, mockEmbedder, { mode: 'fts' });
      expect(qb.where).not.toHaveBeenCalled();
    });
  });

  describe('source glob filter', () => {
    it('applies sourceGlob as source_path LIKE predicate', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      await search('q', mockTable as never, mockEmbedder, { mode: 'fts', sourceGlob: 'notes/%' });
      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining("source_path LIKE 'notes/%'"),
      );
    });

    it('combines sourceGlob and afterDate in a single predicate', async () => {
      const qb = makeQueryBuilder();
      mockTable.search.mockReturnValue(qb);
      const afterDate = new Date('2024-06-01T00:00:00Z');
      await search('q', mockTable as never, mockEmbedder, {
        mode: 'fts',
        afterDate,
        sourceGlob: 'journal/%',
      });
      const predicate: string = qb.where.mock.calls[0][0];
      expect(predicate).toContain('indexed_at >=');
      expect(predicate).toContain("source_path LIKE");
      expect(predicate).toContain(' AND ');
    });
  });

  // --- Result shape ---

  describe('result shape', () => {
    it('converts indexed_at BigInt milliseconds to a Date', async () => {
      const ms = 1_700_000_000_000;
      const row = makeRow({ indexed_at: BigInt(ms) });
      mockTable.search.mockReturnValue(makeQueryBuilder([row]));
      const [result] = await search('q', mockTable as never, mockEmbedder, { mode: 'vector' });
      expect(result.indexedAt.getTime()).toBe(ms);
    });

    it('uses _distance as score when present', async () => {
      const row = makeRow({ _distance: 0.42, _score: undefined });
      mockTable.search.mockReturnValue(makeQueryBuilder([row]));
      const [result] = await search('q', mockTable as never, mockEmbedder, { mode: 'vector' });
      expect(result.score).toBe(0.42);
    });
  });
});
