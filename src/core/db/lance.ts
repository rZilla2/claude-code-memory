import * as lancedb from '@lancedb/lancedb';
import { Index } from '@lancedb/lancedb';
import { Schema, Field, Utf8, Float32, FixedSizeList, Int64 } from 'apache-arrow';
import { logger } from '../../logger.js';

/** Strip unsafe characters and escape quotes for LanceDB filter predicates. */
export function sanitizeLanceFilter(value: string): string {
  const stripped = value.replace(/[^a-zA-Z0-9 /_.,#:>()@%*-]/g, '');
  return stripped.replace(/'/g, "''");
}

export async function connectLanceDb(dbPath: string): Promise<lancedb.Connection> {
  const db = await lancedb.connect(dbPath);
  logger.info('Connected to LanceDB', { path: dbPath });
  return db;
}

export async function openChunksTable(
  connection: lancedb.Connection,
  vectorDimension: number = 1536
): Promise<lancedb.Table> {
  const tableNames = await connection.tableNames();

  if (tableNames.includes('chunks')) {
    logger.info('Opening existing chunks table');
    return connection.openTable('chunks');
  }

  logger.info('Creating chunks table', { vectorDimension });

  const schema = new Schema([
    new Field('id', new Utf8(), false),
    new Field(
      'vector',
      new FixedSizeList(vectorDimension, new Field('item', new Float32(), true)),
      false
    ),
    new Field('text', new Utf8(), false),
    new Field('source_path', new Utf8(), false),
    new Field('heading_path', new Utf8(), false),
    new Field('chunk_hash', new Utf8(), false),
    new Field('indexed_at', new Int64(), false),
    new Field('embedding_model_id', new Utf8(), false),
  ]);

  const table = await connection.createEmptyTable('chunks', schema);
  logger.info('Created chunks table successfully');
  return table;
}

export async function deleteChunksByPath(table: lancedb.Table, sourcePath: string): Promise<void> {
  await table.delete(`source_path = '${sanitizeLanceFilter(sourcePath)}'`);
}

export async function getChunksByPath(table: lancedb.Table, sourcePath: string): Promise<Array<Record<string, unknown>>> {
  const escaped = sanitizeLanceFilter(sourcePath);
  const results = await table.query().where(`source_path = '${escaped}'`).toArray();
  return results.map(row => ({ ...row }));
}

export async function updateChunksSourcePath(table: lancedb.Table, oldPath: string, newPath: string): Promise<void> {
  const rows = await getChunksByPath(table, oldPath);
  if (rows.length === 0) return;
  await deleteChunksByPath(table, oldPath);
  const updated = rows.map(row => ({ ...row, source_path: newPath }));
  await table.add(updated);
}

let ftsIndexCreated = false;

export async function ensureFtsIndex(table: lancedb.Table): Promise<void> {
  if (ftsIndexCreated) return;
  await table.createIndex('text', {
    config: Index.fts({
      withPosition: true,
      baseTokenizer: 'simple',
      lowercase: true,
    }),
    replace: true,
  });
  ftsIndexCreated = true;
  logger.info('FTS index created/replaced on text column');
}
