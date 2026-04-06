import { Command } from 'commander';
import { loadConfig } from '../../config.js';
import { connectLanceDb, openChunksTable, ensureFtsIndex } from '../../core/db/lance.js';
import { createEmbeddingProvider } from '../../core/embedder/factory.js';
import { search } from '../../core/searcher.js';
import { logger } from '../../logger.js';
import pc from 'picocolors';
import type { SearchOptions } from '../../types.js';

const SNIPPET_LENGTH = 150;

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search indexed vault memories')
    .option('-n, --limit <n>', 'Number of results', '5')
    .option('--mode <mode>', 'Search mode: vector, fts, hybrid', 'hybrid')
    .option('--after <date>', 'Only results after this date (ISO format)')
    .option('--before <date>', 'Only results before this date (ISO format)')
    .option('--source <glob>', 'Filter by source file path glob')
    .option('--full', 'Show full chunk text instead of snippet')
    .option('--json', 'Output as JSON')
    .option('--no-color', 'Disable colored output')
    .action(
      async (
        query: string,
        options: {
          limit: string;
          mode: string;
          after?: string;
          before?: string;
          source?: string;
          full?: boolean;
          json?: boolean;
          color: boolean;
        },
      ) => {
        try {
          const config = loadConfig();
          const connection = await connectLanceDb(config.indexPath);
          const table = await openChunksTable(connection);
          const embedder = createEmbeddingProvider(config);

          if (options.mode !== 'vector') {
            await ensureFtsIndex(table);
          }

          const searchOpts: SearchOptions = {
            topK: parseInt(options.limit, 10),
            mode: options.mode as SearchOptions['mode'],
            afterDate: options.after ? new Date(options.after) : undefined,
            beforeDate: options.before ? new Date(options.before) : undefined,
            sourceGlob: options.source,
          };

          const results = await search(query, table, embedder, searchOpts);

          if (results.length === 0) {
            console.log('No results found.');
            return;
          }

          // JSON output mode
          if (options.json) {
            console.log(
              JSON.stringify(
                results.map((r) => ({ ...r, indexedAt: r.indexedAt.toISOString() })),
                null,
                2,
              ),
            );
            return;
          }

          // Text output mode
          const useColor = process.stdout.isTTY && !process.env.NO_COLOR && options.color !== false;

          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const snippet = options.full ? r.text : r.text.slice(0, SNIPPET_LENGTH) + (r.text.length > SNIPPET_LENGTH ? '...' : '');
            const scoreStr = r.score.toFixed(3);

            if (useColor) {
              console.log(pc.cyan(r.sourcePath));
            } else {
              console.log(r.sourcePath);
            }
            console.log(`  ${r.headingPath}`);
            if (useColor) {
              console.log(`  score: ${pc.yellow(scoreStr)}`);
            } else {
              console.log(`  score: ${scoreStr}`);
            }
            console.log(`  ${snippet}`);
            if (i < results.length - 1) {
              console.log('');
            }
          }
        } catch (err) {
          logger.error('Search failed', err);
          process.exit(1);
        }
      },
    );
}
