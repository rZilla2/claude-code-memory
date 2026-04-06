import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/db/lance.js', () => ({
  connectLanceDb: vi.fn(),
  openChunksTable: vi.fn(),
  ensureFtsIndex: vi.fn(),
}));

vi.mock('../../core/embedder/factory.js', () => ({
  createEmbeddingProvider: vi.fn(),
}));

vi.mock('../../core/searcher.js', () => ({
  search: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { loadConfig } from '../../config.js';
import { connectLanceDb, openChunksTable } from '../../core/db/lance.js';
import { createEmbeddingProvider } from '../../core/embedder/factory.js';
import { search } from '../../core/searcher.js';
import { registerSearchCommand } from './search-cmd.js';
import type { SearchResult } from '../../types.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockConnectLanceDb = vi.mocked(connectLanceDb);
const mockOpenChunksTable = vi.mocked(openChunksTable);
const mockCreateEmbeddingProvider = vi.mocked(createEmbeddingProvider);
const mockSearch = vi.mocked(search);

const MOCK_CONFIG = {
  vaultPath: '/mock/vault',
  indexPath: '/mock/index',
  embeddingProvider: 'openai' as const,
  openaiModel: 'text-embedding-3-small',
  batchSize: 100,
  concurrency: 2,
  ignorePaths: [],
  includeExtensions: ['.md'],
};

const SAMPLE_RESULT: SearchResult = {
  id: 'abc123',
  sourcePath: '/mock/vault/notes/My Note.md',
  headingPath: 'My Note > Section One',
  text: 'A'.repeat(300), // 300 chars — longer than 150
  score: 0.87654,
  indexedAt: new Date('2026-04-01T00:00:00Z'),
};

describe('registerSearchCommand', () => {
  let program: Command;
  let logs: string[];
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const mockConnection = {} as Awaited<ReturnType<typeof connectLanceDb>>;
  const mockTable = {} as Awaited<ReturnType<typeof openChunksTable>>;
  const mockEmbedder = { embed: vi.fn(), modelId: vi.fn().mockReturnValue('openai:test') };

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    logs = [];
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg ?? '');
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockLoadConfig.mockReturnValue(MOCK_CONFIG);
    mockConnectLanceDb.mockResolvedValue(mockConnection);
    mockOpenChunksTable.mockResolvedValue(mockTable);
    mockCreateEmbeddingProvider.mockReturnValue(mockEmbedder as never);
    mockSearch.mockResolvedValue([SAMPLE_RESULT]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('Test 1: formats results with sourcePath, headingPath, score (3 decimal places), and 150-char snippet', async () => {
    registerSearchCommand(program);
    await program.parseAsync(['search', 'test query'], { from: 'user' });

    const output = logs.join('\n');
    expect(output).toContain('/mock/vault/notes/My Note.md');
    expect(output).toContain('My Note > Section One');
    expect(output).toContain('0.877'); // 0.87654 rounded to 3 decimal places
    // snippet should be truncated at 150 chars
    const snippet = 'A'.repeat(150) + '...';
    expect(output).toContain(snippet);
    // should NOT contain full 300-char text as a block
    expect(output).not.toContain('A'.repeat(151) + 'A');
  });

  it('Test 2: --full flag outputs complete text instead of truncated snippet', async () => {
    registerSearchCommand(program);
    await program.parseAsync(['search', 'test query', '--full'], { from: 'user' });

    const output = logs.join('\n');
    expect(output).toContain('A'.repeat(300));
    expect(output).not.toContain('A'.repeat(300) + '...');
  });

  it('Test 3: --json flag outputs valid JSON array of result objects', async () => {
    registerSearchCommand(program);
    await program.parseAsync(['search', 'test query', '--json'], { from: 'user' });

    const jsonOutput = logs.find((l) => l.startsWith('['));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({
      id: 'abc123',
      sourcePath: '/mock/vault/notes/My Note.md',
      headingPath: 'My Note > Section One',
    });
    // indexedAt should be ISO string in JSON
    expect(typeof parsed[0].indexedAt).toBe('string');
  });

  it('Test 4: --limit flag maps to topK option in search()', async () => {
    registerSearchCommand(program);
    await program.parseAsync(['search', 'test query', '--limit', '10'], { from: 'user' });

    expect(mockSearch).toHaveBeenCalledWith(
      'test query',
      mockTable,
      mockEmbedder,
      expect.objectContaining({ topK: 10 }),
    );
  });

  it('Test 5: --mode flag maps to mode option in search()', async () => {
    registerSearchCommand(program);
    await program.parseAsync(['search', 'test query', '--mode', 'fts'], { from: 'user' });

    expect(mockSearch).toHaveBeenCalledWith(
      'test query',
      mockTable,
      mockEmbedder,
      expect.objectContaining({ mode: 'fts' }),
    );
  });

  it('Test 6: --after and --before flags map to afterDate/beforeDate as Date objects', async () => {
    registerSearchCommand(program);
    await program.parseAsync(
      ['search', 'test query', '--after', '2026-01-01', '--before', '2026-06-01'],
      { from: 'user' },
    );

    expect(mockSearch).toHaveBeenCalledWith(
      'test query',
      mockTable,
      mockEmbedder,
      expect.objectContaining({
        afterDate: new Date('2026-01-01'),
        beforeDate: new Date('2026-06-01'),
      }),
    );
  });
});
