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
