import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { relative } from 'path';
import type { Config } from '../types.js';
import type { EmbeddingProvider } from './embedder/types.js';
import { scanVault } from './scanner.js';
import { chunkMarkdown } from './chunker.js';
import { getFileHash, upsertFile, deleteFileMetadata } from './db/sqlite.js';
import { deleteChunksByPath } from './db/lance.js';
import { logger } from '../logger.js';
import type Database from 'better-sqlite3';
import type * as lancedb from '@lancedb/lancedb';

export interface IndexResult {
  filesIndexed: number;
  filesSkipped: number;
  filesFailed: number;
  chunksCreated: number;
  failedPaths: string[];
}

export interface IndexFileResult {
  status: 'indexed' | 'skipped';
  chunksCreated: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export async function indexFile(
  filePath: string,
  config: Config,
  db: Database.Database,
  table: lancedb.Table,
  embedder: EmbeddingProvider,
): Promise<IndexFileResult> {
  // 1. Read file
  const content = await readFile(filePath, 'utf-8');
  const fileHash = sha256(content);

  // 2. File-level hash gate
  const storedHash = getFileHash(db, filePath);
  if (storedHash === fileHash) {
    return { status: 'skipped', chunksCreated: 0 };
  }

  // 3. Remove SQLite hash first so a crash forces re-index
  deleteFileMetadata(db, filePath);

  // 4. Delete stale chunks BEFORE inserting new ones
  await deleteChunksByPath(table, filePath);

  // 5. Chunk the file
  const relativePath = relative(config.vaultPath, filePath);
  const chunks = chunkMarkdown(content, relativePath);

  if (chunks.length === 0) {
    upsertFile(db, { path: filePath, content_hash: fileHash, indexed_at: Date.now(), chunk_count: 0 });
    return { status: 'indexed', chunksCreated: 0 };
  }

  // 6. Embed all chunks
  const texts = chunks.map(c => c.embeddableText);
  const vectors = await embedder.embed(texts);

  // 7. Insert into LanceDB
  const rows = chunks.map((c, i) => ({
    id: c.id,
    vector: vectors[i],
    text: c.embeddableText,
    source_path: filePath,
    heading_path: c.headingPath,
    chunk_hash: c.chunkHash,
    indexed_at: BigInt(Date.now()),
    embedding_model_id: embedder.modelId(),
  }));

  await table.add(rows);

  // 8. Update SQLite metadata (after successful LanceDB add)
  upsertFile(db, {
    path: filePath,
    content_hash: fileHash,
    indexed_at: Date.now(),
    chunk_count: chunks.length,
  });

  return { status: 'indexed', chunksCreated: chunks.length };
}

export async function indexFiles(
  filePaths: string[],
  config: Config,
  db: Database.Database,
  table: lancedb.Table,
  embedder: EmbeddingProvider,
): Promise<IndexResult> {
  const result: IndexResult = {
    filesIndexed: 0,
    filesSkipped: 0,
    filesFailed: 0,
    chunksCreated: 0,
    failedPaths: [],
  };
  for (const filePath of filePaths) {
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        const fileResult = await indexFile(filePath, config, db, table, embedder);
        if (fileResult.status === 'indexed') result.filesIndexed++;
        else result.filesSkipped++;
        result.chunksCreated += fileResult.chunksCreated;
        break;
      } catch (err) {
        if (attempts >= 2) {
          result.filesFailed++;
          result.failedPaths.push(filePath);
          logger.error(`Failed to index after ${attempts} attempts: ${filePath}`, err);
        }
      }
    }
  }
  return result;
}

export async function indexVault(
  config: Config,
  db: Database.Database,
  table: lancedb.Table,
  embedder: EmbeddingProvider,
  onProgress?: (done: number, total: number, changed: number) => void,
): Promise<IndexResult> {
  const files = await scanVault(config);
  const result: IndexResult = {
    filesIndexed: 0,
    filesSkipped: 0,
    filesFailed: 0,
    chunksCreated: 0,
    failedPaths: [],
  };

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    try {
      const fileResult = await indexFile(filePath, config, db, table, embedder);
      if (fileResult.status === 'indexed') {
        result.filesIndexed++;
      } else {
        result.filesSkipped++;
      }
      result.chunksCreated += fileResult.chunksCreated;
    } catch (err) {
      // Retry once for transient errors
      try {
        const fileResult = await indexFile(filePath, config, db, table, embedder);
        if (fileResult.status === 'indexed') result.filesIndexed++;
        else result.filesSkipped++;
        result.chunksCreated += fileResult.chunksCreated;
      } catch (retryErr) {
        result.filesFailed++;
        result.failedPaths.push(filePath);
        logger.error(`Failed to index: ${filePath}`, retryErr);
      }
    }
    onProgress?.(i + 1, files.length, result.filesIndexed);
  }

  return result;
}
