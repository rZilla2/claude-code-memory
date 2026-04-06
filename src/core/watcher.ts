import { watch } from 'chokidar';
import { access, stat, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import type { Config } from '../types.js';
import type { EmbeddingProvider } from './embedder/types.js';
import type Database from 'better-sqlite3';
import type * as lancedb from '@lancedb/lancedb';
import { logger } from '../logger.js';
import { getFileHash, incrementUpdateCounter, updateSourcePath, deleteFileMetadata } from './db/sqlite.js';
import { deleteChunksByPath, updateChunksSourcePath } from './db/lance.js';
import { indexFiles } from './indexer.js';
import { scanVault } from './scanner.js';

export interface WatcherOptions {
  config: Config;
  db: Database.Database;
  table: lancedb.Table;
  embedder: EmbeddingProvider;
  onBatchComplete?: (result: BatchResult) => void;
}

export interface BatchResult {
  renamed: number;
  deleted: number;
  reindexed: number;
  failed: number;
}

export interface WatcherHandle {
  close(): Promise<void>;
}

export interface ProcessBatchInput {
  paths: Set<string>;
  options: WatcherOptions;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * processBatch — given a set of .md paths, classify as adds vs unlinks,
 * detect renames by content hash, then dispatch to appropriate handlers.
 * Errors are caught and logged — never thrown.
 */
export async function processBatch({ paths, options }: ProcessBatchInput): Promise<BatchResult> {
  const { config, db, table, embedder, onBatchComplete } = options;
  const result: BatchResult = { renamed: 0, deleted: 0, reindexed: 0, failed: 0 };

  try {
    // 1. Classify each path as existing (add/change) or missing (unlink)
    const addPaths: string[] = [];
    const unlinkPaths: string[] = [];

    await Promise.all(
      Array.from(paths).map(async (p) => {
        try {
          await access(p);
          addPaths.push(p);
        } catch {
          unlinkPaths.push(p);
        }
      })
    );

    // 2. Compute hashes for all add candidates
    const addHashes = new Map<string, string>(); // path → hash
    await Promise.all(
      addPaths.map(async (p) => {
        try {
          const content = await readFile(p, 'utf-8');
          addHashes.set(p, sha256(content));
        } catch (err) {
          logger.error(`Failed to hash file: ${p}`, err);
        }
      })
    );

    // 3. Get stored hashes for unlink candidates
    const unlinkHashes = new Map<string, string>(); // path → stored hash
    for (const p of unlinkPaths) {
      const stored = getFileHash(db, p);
      if (stored) unlinkHashes.set(p, stored);
    }

    // 4. Build reverse map: stored hash → unlink path (for rename matching)
    const hashToUnlinkPath = new Map<string, string>();
    for (const [p, h] of unlinkHashes) {
      hashToUnlinkPath.set(h, p);
    }

    // 5. Classify renames, real deletes, real adds/changes
    const renames: Array<{ oldPath: string; newPath: string }> = [];
    const realDeletes: string[] = [];
    const realAdds: string[] = [];

    // Check adds: if its hash matches an unlink hash → rename
    const matchedUnlinks = new Set<string>();
    for (const [newPath, hash] of addHashes) {
      const oldPath = hashToUnlinkPath.get(hash);
      if (oldPath) {
        renames.push({ oldPath, newPath });
        matchedUnlinks.add(oldPath);
      } else {
        realAdds.push(newPath);
      }
    }

    // Unmatched unlinks → real deletes
    for (const p of unlinkPaths) {
      if (!matchedUnlinks.has(p)) {
        realDeletes.push(p);
      }
    }

    // 6. Handle renames
    for (const { oldPath, newPath } of renames) {
      try {
        await updateChunksSourcePath(table, oldPath, newPath);
        updateSourcePath(db, oldPath, newPath);
        result.renamed++;
        logger.info(`Renamed: ${oldPath} → ${newPath}`);
      } catch (err) {
        logger.error(`Failed to process rename ${oldPath} → ${newPath}`, err);
        result.failed++;
      }
    }

    // 7. Handle real deletes
    for (const p of realDeletes) {
      try {
        await deleteChunksByPath(table, p);
        deleteFileMetadata(db, p);
        result.deleted++;
        logger.info(`Deleted: ${p}`);
      } catch (err) {
        logger.error(`Failed to delete chunks for: ${p}`, err);
        result.failed++;
      }
    }

    // 8. Handle real adds/changes
    if (realAdds.length > 0) {
      try {
        const indexResult = await indexFiles(realAdds, config, db, table, embedder);
        result.reindexed += indexResult.filesIndexed;
        result.failed += indexResult.filesFailed;
        if (indexResult.filesIndexed > 0) {
          incrementUpdateCounter(db, indexResult.filesIndexed);
        }
        logger.info(`Reindexed ${indexResult.filesIndexed} files in batch`);
      } catch (err) {
        logger.error('Failed to reindex batch', err);
        result.failed += realAdds.length;
      }
    }
  } catch (err) {
    logger.error('processBatch encountered unexpected error', err);
  }

  onBatchComplete?.(result);
  return result;
}

/**
 * startupCatchUp — scan vault against SQLite, re-index files changed since last session.
 * Fast pre-filter: skip files where mtime <= indexed_at.
 * Hash check: re-index only if content hash changed.
 */
export async function startupCatchUp(
  options: WatcherOptions
): Promise<{ reindexed: number; total: number }> {
  const { config, db, table, embedder } = options;
  const vaultFiles = await scanVault(config);
  const staleFiles: string[] = [];

  for (const filePath of vaultFiles) {
    try {
      const { mtimeMs } = await stat(filePath);
      // Fast pre-filter: check indexed_at from SQLite
      const row = db.prepare('SELECT indexed_at, content_hash FROM files WHERE path = ?').get(filePath) as
        | { indexed_at: number; content_hash: string }
        | undefined;

      if (row && mtimeMs <= row.indexed_at) {
        // Not modified since last index — skip
        continue;
      }

      // Hash check
      const content = await readFile(filePath, 'utf-8');
      const currentHash = sha256(content);
      const storedHash = row?.content_hash ?? null;

      if (currentHash !== storedHash) {
        staleFiles.push(filePath);
      }
    } catch (err) {
      logger.error(`catch-up: error checking file ${filePath}`, err);
    }
  }

  if (staleFiles.length > 0) {
    logger.info(`Startup catch-up: re-indexing ${staleFiles.length} changed files...`);
    await indexFiles(staleFiles, config, db, table, embedder);
  } else {
    logger.info('Startup catch-up: index is up to date');
  }

  return { reindexed: staleFiles.length, total: vaultFiles.length };
}

/**
 * createWatcher — starts a chokidar watcher on vaultPath, batches .md events
 * over a 5-second window, then calls processBatch.
 */
export function createWatcher(options: WatcherOptions): WatcherHandle {
  const { config } = options;
  const pendingPaths = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      if (pendingPaths.size === 0) return;
      const batch = new Set(pendingPaths);
      pendingPaths.clear();
      await processBatch({ paths: batch, options });
    }, 5000);
  };

  const watcher = watch(config.vaultPath, {
    ignored: ['**/*.icloud', '**/.*'],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 200,
    },
  });

  const handleEvent = (filePath: string) => {
    if (!filePath.endsWith('.md')) return;
    pendingPaths.add(filePath);
    scheduleFlush();
  };

  watcher.on('add', handleEvent);
  watcher.on('change', handleEvent);
  watcher.on('unlink', handleEvent);

  return {
    async close(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await watcher.close();
    },
  };
}
