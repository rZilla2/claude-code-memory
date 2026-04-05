import { Command } from 'commander';
import { loadConfig } from '../../config.js';
import { openMetadataDb, assertModelMatch } from '../../core/db/sqlite.js';
import { connectLanceDb, openChunksTable } from '../../core/db/lance.js';
import { createEmbeddingProvider } from '../../core/embedder/factory.js';
import { indexVault } from '../../core/indexer.js';
import { logger } from '../../logger.js';

export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Index vault markdown files for semantic search')
    .option('--vault <path>', 'Path to Obsidian vault')
    .option('--verbose', 'Show per-file output')
    .action(async (options: { vault?: string; verbose?: boolean }) => {
      try {
        const config = loadConfig(options.vault ? { vaultPath: options.vault } : undefined);
        const db = openMetadataDb(config.indexPath);
        const embedder = createEmbeddingProvider(config);
        assertModelMatch(db, embedder.modelId());

        const connection = await connectLanceDb(config.indexPath);
        const table = await openChunksTable(connection);

        const onProgress = options.verbose
          ? (_done: number, _total: number, _changed: number) => {
              // In verbose mode, individual file output is handled by the indexer logger
            }
          : (done: number, total: number, _changed: number) => {
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const filled = '█'.repeat(Math.floor(pct / 5));
              const empty = '░'.repeat(20 - Math.floor(pct / 5));
              process.stderr.write(`\r[${filled}${empty}] ${done}/${total} files`);
            };

        const result = await indexVault(config, db, table, embedder, onProgress);

        // Clear progress line after indexing
        if (!options.verbose) {
          process.stderr.write('\n');
        }

        // Print summary to stdout
        console.log('\nIndex Complete');
        console.log(`  Files indexed:  ${result.filesIndexed}`);
        console.log(`  Files skipped:  ${result.filesSkipped}`);
        console.log(`  Files failed:   ${result.filesFailed}`);
        console.log(`  Chunks created: ${result.chunksCreated}`);

        if (result.failedPaths.length > 0) {
          console.log('\nFailed files:');
          for (const p of result.failedPaths) {
            console.log(`  - ${p}`);
          }
        }

        db.close();
        process.exit(result.filesFailed > 0 ? 1 : 0);
      } catch (err) {
        logger.error('Index failed', err);
        process.exit(2);
      }
    });
}
