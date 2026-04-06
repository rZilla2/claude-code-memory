import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmbeddingProvider } from '../../core/embedder/types.js';
import type * as lancedb from '@lancedb/lancedb';

// Mock the search module
vi.mock('../../core/searcher.js', () => ({
  search: vi.fn(),
}));

// Mock lance db
vi.mock('../../core/db/lance.js', () => ({
  ensureFtsIndex: vi.fn(),
}));

// Mock logger
vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { search } from '../../core/searcher.js';
import type { SearchResult } from '../../types.js';

// Minimal McpServer mock
function createMockServer() {
  const tools: Record<string, { description: string; schema: unknown; handler: Function }> = {};
  return {
    tool: vi.fn((name: string, description: string, schema: unknown, handler: Function) => {
      tools[name] = { description, schema, handler };
    }),
    _tools: tools,
  };
}

const mockEmbedder: EmbeddingProvider = {
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  modelId: () => 'openai:text-embedding-3-small',
};

const mockTable = {} as lancedb.Table;

const mockSearchResults: SearchResult[] = [
  {
    id: 'chunk-1',
    sourcePath: '20 - Journal/2026-04-01.md',
    headingPath: 'Daily Notes > Morning',
    text: 'Worked on claude-code-memory project',
    score: 0.95,
    indexedAt: new Date('2026-04-01T10:00:00Z'),
  },
];

describe('registerSearchMemoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: search_memory handler calls search() with correct options mapping', async () => {
    const { registerSearchMemoryTool } = await import('./search-memory.js');
    const server = createMockServer();
    vi.mocked(search).mockResolvedValue(mockSearchResults);

    registerSearchMemoryTool(server as unknown as Parameters<typeof registerSearchMemoryTool>[0], mockTable, mockEmbedder);

    expect(server.tool).toHaveBeenCalledWith(
      'search_memory',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );

    const handler = server._tools['search_memory'].handler;
    await handler({
      query: 'vault memories',
      limit: 10,
      mode: 'vector',
      afterDate: '2026-01-01T00:00:00Z',
      beforeDate: '2026-12-31T00:00:00Z',
      sourceGlob: '20 - Journal/**',
    });

    expect(search).toHaveBeenCalledWith(
      'vault memories',
      mockTable,
      mockEmbedder,
      expect.objectContaining({
        topK: 10,
        mode: 'vector',
        afterDate: new Date('2026-01-01T00:00:00Z'),
        beforeDate: new Date('2026-12-31T00:00:00Z'),
        sourceGlob: '20 - Journal/**',
      }),
    );
  });

  it('Test 2: search_memory returns MCP-formatted content array with type:text containing JSON-serialized SearchResult[]', async () => {
    const { registerSearchMemoryTool } = await import('./search-memory.js');
    const server = createMockServer();
    vi.mocked(search).mockResolvedValue(mockSearchResults);

    registerSearchMemoryTool(server as unknown as Parameters<typeof registerSearchMemoryTool>[0], mockTable, mockEmbedder);

    const handler = server._tools['search_memory'].handler;
    const result = await handler({ query: 'test query', limit: 5, mode: 'hybrid' });

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({
      id: 'chunk-1',
      sourcePath: '20 - Journal/2026-04-01.md',
      headingPath: 'Daily Notes > Morning',
      text: 'Worked on claude-code-memory project',
      score: 0.95,
      indexedAt: '2026-04-01T10:00:00.000Z',
    });
  });

  it('Test 3: search_memory with only required query param uses defaults (limit=5, mode=hybrid)', async () => {
    const { registerSearchMemoryTool } = await import('./search-memory.js');
    const server = createMockServer();
    vi.mocked(search).mockResolvedValue([]);

    registerSearchMemoryTool(server as unknown as Parameters<typeof registerSearchMemoryTool>[0], mockTable, mockEmbedder);

    const handler = server._tools['search_memory'].handler;
    await handler({ query: 'only query' });

    expect(search).toHaveBeenCalledWith(
      'only query',
      mockTable,
      mockEmbedder,
      expect.objectContaining({
        topK: 5,
        mode: 'hybrid',
      }),
    );
  });

  it('Test 4: No production file in src/mcp/ contains the string console.log', async () => {
    const { execSync } = await import('child_process');
    let foundConsoleLogs = false;
    try {
      // Exclude test files — we only care about production MCP code
      execSync(
        'grep -r "console.log" /Users/rod/Projects/claude-code-memory/src/mcp/ --include="*.ts" --exclude="*.test.ts"',
        { encoding: 'utf-8' },
      );
      foundConsoleLogs = true;
    } catch {
      // grep exits 1 when no matches — that's what we want
      foundConsoleLogs = false;
    }
    expect(foundConsoleLogs).toBe(false);
  });
});
