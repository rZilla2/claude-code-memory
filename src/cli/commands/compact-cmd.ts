import { Command } from 'commander';
import type Database from 'better-sqlite3';
import type * as lancedb from '@lancedb/lancedb';
import { loadConfig } from '../../config.js';
import { openMetadataDb, assertModelMatch, getCompactionMetadata, recordCompaction } from '../../core/db/sqlite.js';
import { connectLanceDb, openChunksTable } from '../../core/db/lance.js';
import { createEmbeddingProvider } from '../../core/embedder/factory.js';
import { logger } from '../../logger.js';

/**
 * maybeAutoCompact — fires table.optimize() if last compaction was >24h ago
 * AND there have been >50 updates since the last compaction.
 * Returns true if compaction ran, false otherwise.
 */
export async function maybeAutoCompact(
  db: Database.Database,
  table: lancedb.Table,
): Promise<boolean> {
  const { lastCompactedAt, updatesSinceCompact } = getCompactionMetadata(db);
  const hoursSinceCompact = (Date.now() - lastCompactedAt) / (1000 * 60 * 60);

  if (hoursSinceCompact > 24 && updatesSinceCompact > 50) {
    logger.info(`Auto-compacting: ${updatesSinceCompact} updates since last compact`);
    await table.optimize();
    recordCompaction(db);
    return true;
  }

  return false;
}

export function registerCompactCommand(program: Command): void {
  program
    .command('compact')
    .description('Compact the vector index to improve query performance')
    .option('--vault <path>', 'Path to Obsidian vault')
    .action(async (options: { vault?: string }) => {
      try {
        const config = loadConfig(options.vault ? { vaultPath: options.vault } : undefined);
        const db = openMetadataDb(config.indexPath);
        const embedder = createEmbeddingProvider(config);
        assertModelMatch(db, embedder.modelId());

        const connection = await connectLanceDb(config.indexPath);
        const table = await openChunksTable(connection);

        logger.info('Running manual compaction...');
        await table.optimize();
        recordCompaction(db);

        console.log('Compaction complete');

        db.close();
        process.exit(0);
      } catch (err) {
        logger.error('Compact failed', err);
        process.exit(2);
      }
    });
}
