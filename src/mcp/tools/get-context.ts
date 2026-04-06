import type * as lancedb from '@lancedb/lancedb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../../logger.js';

interface ChunkRow {
  id: string;
  text: string;
  source_path: string;
  heading_path: string;
  indexed_at: number;
}

interface ChunkSummary {
  id: string;
  sourcePath: string;
  headingPath: string;
  text: string;
  indexedAt: string;
}

interface ContextResult {
  target: ChunkSummary;
  prev: ChunkSummary | null;
  next: ChunkSummary | null;
}

const SELECT_COLS = ['id', 'text', 'source_path', 'heading_path', 'indexed_at'];

function formatChunk(row: ChunkRow): ChunkSummary {
  return {
    id: row.id,
    sourcePath: row.source_path,
    headingPath: row.heading_path,
    text: row.text,
    indexedAt: new Date(Number(row.indexed_at)).toISOString(),
  };
}

export function registerGetContextTool(server: McpServer, table: lancedb.Table): void {
  server.tool(
    'get_context',
    'Retrieve a chunk by ID with its neighboring chunks from the same source file for surrounding context',
    { chunkId: z.string().describe('The chunk ID from a search_memory result') },
    async ({ chunkId }) => {
      try {
        // Query target chunk by ID
        const targetRows = await table
          .query()
          .where(`id = '${chunkId.replace(/'/g, "''")}'`)
          .select(SELECT_COLS)
          .limit(1)
          .toArray();

        if (targetRows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Chunk not found: ${chunkId}` }),
              },
            ],
            isError: true,
          };
        }

        const target = targetRows[0] as unknown as ChunkRow;

        // Query all chunks from the same source file
        const siblingRows = await table
          .query()
          .where(`source_path = '${target.source_path.replace(/'/g, "''")}'`)
          .select(SELECT_COLS)
          .toArray();

        // Sort by heading_path to establish positional order
        const siblings = (siblingRows as unknown as ChunkRow[]).sort((a, b) =>
          a.heading_path.localeCompare(b.heading_path),
        );

        // Find target index and extract neighbors
        const targetIdx = siblings.findIndex((s) => s.id === chunkId);
        const prevChunk = targetIdx > 0 ? siblings[targetIdx - 1] : null;
        const nextChunk = targetIdx < siblings.length - 1 ? siblings[targetIdx + 1] : null;

        const result: ContextResult = {
          target: formatChunk(target),
          prev: prevChunk ? formatChunk(prevChunk) : null,
          next: nextChunk ? formatChunk(nextChunk) : null,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        logger.error('get_context tool error', err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
