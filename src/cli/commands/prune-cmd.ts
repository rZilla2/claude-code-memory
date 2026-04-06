import { Command } from 'commander';
import { loadConfig } from '../../config.js';
import { openMetadataDb, assertModelMatch, getAllFilePaths, deleteFileMetadata } from '../../core/db/sqlite.js';
import { connectLanceDb, openChunksTable, deleteChunksByPath } from '../../core/db/lance.js';
import { createEmbeddingProvider } from '../../core/embedder/factory.js';
import { scanVault } from '../../core/scanner.js';
import { logger } from '../../logger.js';

export function registerPruneCommand(program: Command): void {
  program
    .command('prune')
    .description('Remove index entries for deleted vault files')
    .option('--vault <path>', 'Path to Obsidian vault')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .action(async (options: { vault?: string; dryRun?: boolean }) => {
      try {
        const config = loadConfig(options.vault ? { vaultPath: options.vault } : undefined);
        const db = openMetadataDb(config.indexPath);
        const embedder = createEmbeddingProvider(config);
        assertModelMatch(db, embedder.modelId());

        const connection = await connectLanceDb(config.indexPath);
        const table = await openChunksTable(connection);

        // Get all paths tracked in SQLite
        const indexedPaths = getAllFilePaths(db);

        // Get all files currently on disk
        const diskPaths = await scanVault(config);
        const vaultPaths = new Set(diskPaths);

        // Find orphaned entries (indexed but no longer on disk)
        const orphaned = indexedPaths.filter(p => !vaultPaths.has(p));

        if (orphaned.length === 0) {
          console.log('No orphaned files found.');
          db.close();
          process.exit(0);
          return;
        }

        if (options.dryRun) {
          console.log(`Dry run — would prune ${orphaned.length} orphaned file(s):`);
          for (const p of orphaned) {
            console.log(`  - ${p}`);
          }
          db.close();
          process.exit(0);
          return;
        }

        // Delete orphaned entries
        for (const p of orphaned) {
          await deleteChunksByPath(table, p);
          deleteFileMetadata(db, p);
          logger.info(`Pruned: ${p}`);
        }

        console.log(`Pruned ${orphaned.length} orphaned file(s).`);

        db.close();
        process.exit(0);
      } catch (err) {
        logger.error('Prune failed', err);
        process.exit(2);
      }
    });
}
