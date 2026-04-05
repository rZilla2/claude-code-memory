import { Command } from 'commander';
import { loadConfig } from '../../config.js';
import { openMetadataDb, getStatus } from '../../core/db/sqlite.js';
import { logger } from '../../logger.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show index status and statistics')
    .option('--vault <path>', 'Path to Obsidian vault')
    .action(async (options: { vault?: string }) => {
      try {
        const config = loadConfig(options.vault ? { vaultPath: options.vault } : undefined);
        const db = openMetadataDb(config.indexPath);
        const status = getStatus(db);

        if (status.fileCount === 0) {
          console.log('No files indexed yet. Run `mem index` first.');
          db.close();
          return;
        }

        const lastIndexed = status.lastIndexedAt
          ? status.lastIndexedAt.toISOString().replace('T', ' ').slice(0, 19)
          : 'never';

        console.log('Index Status');
        console.log(`  Files indexed:    ${status.fileCount.toLocaleString()}`);
        console.log(`  Chunks stored:    ${status.chunkCount.toLocaleString()}`);
        console.log(`  Last indexed:     ${lastIndexed}`);
        console.log(`  Embedding model:  ${status.embeddingModel}`);

        db.close();
      } catch (err) {
        logger.error('Status check failed', err);
        process.exit(1);
      }
    });
}
