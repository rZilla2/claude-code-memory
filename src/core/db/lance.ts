import * as lancedb from '@lancedb/lancedb';
import { Schema, Field, Utf8, Float32, FixedSizeList, Int64 } from 'apache-arrow';
import { logger } from '../../logger.js';

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
