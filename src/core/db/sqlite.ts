import Database from 'better-sqlite3';
import { join } from 'path';
import { logger } from '../../logger.js';

export function openMetadataDb(indexPath: string): Database.Database {
  const db = new Database(join(indexPath, 'metadata.db'));

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path            TEXT PRIMARY KEY,
      content_hash    TEXT NOT NULL,
      indexed_at      INTEGER NOT NULL,
      chunk_count     INTEGER NOT NULL DEFAULT 0,
      staleness_score REAL DEFAULT 0.0
    )
  `);

  logger.info('Opened metadata DB', { path: join(indexPath, 'metadata.db') });

  return db;
}

export function getFileHash(db: Database.Database, filePath: string): string | null {
  const row = db.prepare('SELECT content_hash FROM files WHERE path = ?').get(filePath) as { content_hash: string } | undefined;
  return row?.content_hash ?? null;
}

export function upsertFile(db: Database.Database, file: {
  path: string;
  content_hash: string;
  indexed_at: number;
  chunk_count: number;
}): void {
  db.prepare(`
    INSERT INTO files (path, content_hash, indexed_at, chunk_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      content_hash = excluded.content_hash,
      indexed_at = excluded.indexed_at,
      chunk_count = excluded.chunk_count
  `).run(file.path, file.content_hash, file.indexed_at, file.chunk_count);
}

export interface StatusResult {
  fileCount: number;
  chunkCount: number;
  lastIndexedAt: Date | null;
  embeddingModel: string;
}

export function getStatus(db: Database.Database): StatusResult {
  const counts = db.prepare(`
    SELECT COUNT(*) as file_count, COALESCE(SUM(chunk_count), 0) as total_chunks,
           MAX(indexed_at) as last_indexed_at
    FROM files
  `).get() as { file_count: number; total_chunks: number; last_indexed_at: number | null };

  const model = db.prepare(
    "SELECT value FROM index_metadata WHERE key = 'embedding_model_id'"
  ).get() as { value: string } | undefined;

  return {
    fileCount: counts.file_count,
    chunkCount: counts.total_chunks,
    lastIndexedAt: counts.last_indexed_at ? new Date(counts.last_indexed_at) : null,
    embeddingModel: model?.value ?? 'unknown',
  };
}

export function getCompactionMetadata(db: Database.Database): { lastCompactedAt: number; updatesSinceCompact: number } {
  const rowLast = db.prepare("SELECT value FROM index_metadata WHERE key = 'last_compacted_at'").get() as { value: string } | undefined;
  const rowUpdates = db.prepare("SELECT value FROM index_metadata WHERE key = 'updates_since_compact'").get() as { value: string } | undefined;
  return {
    lastCompactedAt: rowLast ? parseInt(rowLast.value, 10) : 0,
    updatesSinceCompact: rowUpdates ? parseInt(rowUpdates.value, 10) : 0,
  };
}

export function incrementUpdateCounter(db: Database.Database, count: number): void {
  const current = getCompactionMetadata(db).updatesSinceCompact;
  db.prepare(`
    INSERT INTO index_metadata (key, value) VALUES ('updates_since_compact', ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(String(current + count), String(current + count));
}

export function recordCompaction(db: Database.Database): void {
  db.prepare(`
    INSERT INTO index_metadata (key, value) VALUES ('last_compacted_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(String(Date.now()), String(Date.now()));
  db.prepare(`
    INSERT INTO index_metadata (key, value) VALUES ('updates_since_compact', '0')
    ON CONFLICT(key) DO UPDATE SET value = '0'
  `).run();
}

export function updateSourcePath(db: Database.Database, oldPath: string, newPath: string): void {
  db.prepare('UPDATE files SET path = ? WHERE path = ?').run(newPath, oldPath);
}

export function getAllFilePaths(db: Database.Database): string[] {
  const rows = db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  return rows.map(r => r.path);
}

export function deleteFileMetadata(db: Database.Database, path: string): void {
  db.prepare('DELETE FROM files WHERE path = ?').run(path);
}

export function assertModelMatch(db: Database.Database, providerModelId: string): void {
  const row = db
    .prepare("SELECT value FROM index_metadata WHERE key = 'embedding_model_id'")
    .get() as { value: string } | undefined;

  if (!row) {
    db.prepare("INSERT INTO index_metadata (key, value) VALUES (?, ?)").run(
      'embedding_model_id',
      providerModelId
    );
    db.prepare("INSERT INTO index_metadata (key, value) VALUES (?, ?)").run(
      'schema_version',
      '1'
    );
    logger.info('Stored embedding model fingerprint', { model: providerModelId });
    return;
  }

  if (row.value === providerModelId) {
    return;
  }

  const msg = `Embedding model mismatch: stored="${row.value}", current="${providerModelId}". Re-index required.`;
  logger.warn(msg);
  throw new Error(msg);
}
