import { z } from 'zod';
import type * as lancedb from '@lancedb/lancedb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { search } from '../../core/searcher.js';
import { ensureFtsIndex } from '../../core/db/lance.js';
import { logger } from '../../logger.js';
import type { EmbeddingProvider } from '../../core/embedder/types.js';

export function registerSearchMemoryTool(
  server: McpServer,
  table: lancedb.Table,
  embedder: EmbeddingProvider,
): void {
  server.tool(
    'search_memory',
    'Search vault memories semantically',
    {
      query: z.string().describe('Natural language search query'),
      limit: z.number().optional().default(5).describe('Max results'),
      mode: z
        .enum(['vector', 'fts', 'hybrid'])
        .optional()
        .default('hybrid')
        .describe('Search mode'),
      afterDate: z
        .string()
        .optional()
        .describe('ISO date string — exclude older'),
      beforeDate: z
        .string()
        .optional()
        .describe('ISO date string — exclude newer'),
      sourceGlob: z.string().optional().describe('File path glob filter'),
    },
    async (args) => {
      try {
        const options = {
          topK: args.limit ?? 5,
          mode: (args.mode ?? 'hybrid') as 'vector' | 'fts' | 'hybrid',
          ...(args.afterDate ? { afterDate: new Date(args.afterDate) } : {}),
          ...(args.beforeDate ? { beforeDate: new Date(args.beforeDate) } : {}),
          ...(args.sourceGlob ? { sourceGlob: args.sourceGlob } : {}),
        };

        if (options.mode !== 'vector') {
          await ensureFtsIndex(table);
        }

        const results = await search(args.query, table, embedder, options);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                results.map((r) => ({
                  sourcePath: r.sourcePath,
                  headingPath: r.headingPath,
                  text: r.text,
                  score: r.score,
                  indexedAt: r.indexedAt.toISOString(),
                })),
              ),
            },
          ],
        };
      } catch (err) {
        logger.error('search_memory tool error', err);
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
