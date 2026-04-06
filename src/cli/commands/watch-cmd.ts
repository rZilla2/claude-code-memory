import { Command } from 'commander';
import { loadConfig } from '../../config.js';
import { openMetadataDb, assertModelMatch } from '../../core/db/sqlite.js';
import { connectLanceDb, openChunksTable } from '../../core/db/lance.js';
import { createEmbeddingProvider } from '../../core/embedder/factory.js';
import { createWatcher, startupCatchUp } from '../../core/watcher.js';
import { maybeAutoCompact } from './compact-cmd.js';
import { logger } from '../../logger.js';

export function registerWatchCommand(program: Command): void {
  program
    .command('watch')
    .description('Watch vault for changes and reindex incrementally')
    .option('--vault <path>', 'Path to Obsidian vault')
    .action(async (options: { vault?: string }) => {
      try {
        const config = loadConfig(options.vault ? { vaultPath: options.vault } : undefined);
        const db = openMetadataDb(config.indexPath);
        const embedder = createEmbeddingProvider(config);
        assertModelMatch(db, embedder.modelId());

        const connection = await connectLanceDb(config.indexPath);
        const table = await openChunksTable(connection);

        // Auto-compact on startup if thresholds met
        try {
          const didCompact = await maybeAutoCompact(db, table);
          if (didCompact) {
            logger.info('Auto-compaction completed on startup');
          }
        } catch (err) {
          logger.warn('Auto-compaction failed (non-fatal)', err);
        }

        // Catch-up scan for files changed since last session
        try {
          const catchUp = await startupCatchUp({ config, db, table, embedder });
          if (catchUp.reindexed > 0) {
            logger.info(`Catch-up: re-indexed ${catchUp.reindexed}/${catchUp.total} files`);
          }
        } catch (err) {
          logger.warn('Catch-up scan failed (non-fatal)', err);
        }

        // Start file watcher
        const watcher = createWatcher({
          config,
          db,
          table,
          embedder,
          onBatchComplete: (result) => {
            console.log(
              `Batch: ${result.reindexed} reindexed, ${result.renamed} renamed, ${result.deleted} deleted`,
            );
          },
        });

        console.log(`Watching ${config.vaultPath} for changes... (Ctrl+C to stop)`);

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
          await watcher.close();
          db.close();
          console.log('Stopped watching');
          process.exit(0);
        });

        process.on('SIGTERM', async () => {
          await watcher.close();
          db.close();
          process.exit(0);
        });
      } catch (err) {
        logger.error('Watch failed', err);
        process.exit(2);
      }
    });
}
