import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as lancedb from '@lancedb/lancedb';
import type { registerGetContextTool as RegisterGetContextToolType } from './get-context.js';

// Mock logger
vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

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

interface MockChunkRow {
  id: string;
  text: string;
  source_path: string;
  heading_path: string;
  indexed_at: number;
}

// Helper to create a mock table with controllable query results
// calls array: index 0 = target query result, index 1 = sibling query result
function createMockTable(calls: MockChunkRow[][]) {
  let callCount = 0;

  const queryChain = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockImplementation(() => {
      const result = calls[callCount] ?? [];
      callCount++;
      return Promise.resolve(result);
    }),
  };

  return {
    query: vi.fn().mockReturnValue(queryChain),
    _queryChain: queryChain,
  } as unknown as lancedb.Table;
}

const BASE_DATE = 1743840000000; // 2025-04-05T08:00:00.000Z

// heading_path values sort alphabetically: Alpha < Beta < Gamma
const chunk1: MockChunkRow = {
  id: 'chunk-1',
  text: 'First section content',
  source_path: '20 - Journal/2026-04-01.md',
  heading_path: 'Daily Notes > Alpha',
  indexed_at: BASE_DATE,
};

const chunk2: MockChunkRow = {
  id: 'chunk-2',
  text: 'Second section content',
  source_path: '20 - Journal/2026-04-01.md',
  heading_path: 'Daily Notes > Beta',
  indexed_at: BASE_DATE,
};

const chunk3: MockChunkRow = {
  id: 'chunk-3',
  text: 'Third section content',
  source_path: '20 - Journal/2026-04-01.md',
  heading_path: 'Daily Notes > Gamma',
  indexed_at: BASE_DATE,
};

describe('registerGetContextTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: get_context returns target chunk when ID exists, with sourcePath, headingPath, text fields', async () => {
    const { registerGetContextTool } = await import('./get-context.js');
    const server = createMockServer();
    const table = createMockTable([[chunk2], [chunk2]]);

    registerGetContextTool(
      server as unknown as Parameters<typeof RegisterGetContextToolType>[0],
      table,
    );

    const handler = server._tools['get_context'].handler;
    const result = await handler({ chunkId: 'chunk-2' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBeDefined();
    expect(parsed.target.id).toBe('chunk-2');
    expect(parsed.target.sourcePath).toBe('20 - Journal/2026-04-01.md');
    expect(parsed.target.headingPath).toBe('Daily Notes > Beta');
    expect(parsed.target.text).toBe('Second section content');
    expect(parsed.target.indexedAt).toBeDefined();
  });

  it('Test 2: get_context returns prev and next neighbors sorted by heading_path within same source_path', async () => {
    const { registerGetContextTool } = await import('./get-context.js');
    const server = createMockServer();
    // sibling list intentionally unsorted: Gamma, Alpha, Beta
    const table = createMockTable([[chunk2], [chunk3, chunk1, chunk2]]);

    registerGetContextTool(
      server as unknown as Parameters<typeof RegisterGetContextToolType>[0],
      table,
    );

    const handler = server._tools['get_context'].handler;
    const result = await handler({ chunkId: 'chunk-2' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.prev).not.toBeNull();
    expect(parsed.prev.id).toBe('chunk-1'); // Alpha < Beta alphabetically
    expect(parsed.next).not.toBeNull();
    expect(parsed.next.id).toBe('chunk-3'); // Gamma > Beta alphabetically
  });

  it('Test 3: get_context returns null for prev when target is first chunk in file (lowest heading_path)', async () => {
    const { registerGetContextTool } = await import('./get-context.js');
    const server = createMockServer();
    const table = createMockTable([[chunk1], [chunk1, chunk2, chunk3]]);

    registerGetContextTool(
      server as unknown as Parameters<typeof RegisterGetContextToolType>[0],
      table,
    );

    const handler = server._tools['get_context'].handler;
    const result = await handler({ chunkId: 'chunk-1' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.prev).toBeNull();
    expect(parsed.next).not.toBeNull();
    expect(parsed.next.id).toBe('chunk-2');
  });

  it('Test 4: get_context returns null for next when target is last chunk in file (highest heading_path)', async () => {
    const { registerGetContextTool } = await import('./get-context.js');
    const server = createMockServer();
    const table = createMockTable([[chunk3], [chunk1, chunk2, chunk3]]);

    registerGetContextTool(
      server as unknown as Parameters<typeof RegisterGetContextToolType>[0],
      table,
    );

    const handler = server._tools['get_context'].handler;
    const result = await handler({ chunkId: 'chunk-3' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.next).toBeNull();
    expect(parsed.prev).not.toBeNull();
    expect(parsed.prev.id).toBe('chunk-2');
  });

  it('Test 5: get_context returns error content when chunk ID not found', async () => {
    const { registerGetContextTool } = await import('./get-context.js');
    const server = createMockServer();
    // target query returns empty — no sibling call expected
    const table = createMockTable([[], []]);

    registerGetContextTool(
      server as unknown as Parameters<typeof RegisterGetContextToolType>[0],
      table,
    );

    const handler = server._tools['get_context'].handler;
    const result = await handler({ chunkId: 'nonexistent-id' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('nonexistent-id');
  });
});
