import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openMetadataDb, assertModelMatch } from './sqlite.js';

describe('openMetadataDb', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates metadata.db file in the given directory', () => {
    const db = openMetadataDb(tmpDir);
    db.close();
    expect(fs.existsSync(path.join(tmpDir, 'metadata.db'))).toBe(true);
  });

  it('sets WAL journal mode', () => {
    const db = openMetadataDb(tmpDir);
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    db.close();
    expect(row.journal_mode).toBe('wal');
  });

  it('sets busy_timeout to 5000', () => {
    const db = openMetadataDb(tmpDir);
    const row = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    db.close();
    expect(row.timeout).toBe(5000);
  });

  it('creates index_metadata table', () => {
    const db = openMetadataDb(tmpDir);
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='index_metadata'"
    ).get() as { name: string } | undefined;
    db.close();
    expect(row?.name).toBe('index_metadata');
  });

  it('creates files table with required columns', () => {
    const db = openMetadataDb(tmpDir);
    const tableRow = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='files'"
    ).get() as { name: string } | undefined;
    expect(tableRow?.name).toBe('files');

    const columns = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);
    db.close();

    expect(colNames).toContain('path');
    expect(colNames).toContain('content_hash');
    expect(colNames).toContain('indexed_at');
    expect(colNames).toContain('chunk_count');
    expect(colNames).toContain('staleness_score');
  });
});

describe('assertModelMatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-model-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts embedding_model_id into index_metadata on fresh DB', () => {
    const db = openMetadataDb(tmpDir);
    assertModelMatch(db, 'openai:text-embedding-3-small');
    const row = db.prepare("SELECT value FROM index_metadata WHERE key = 'embedding_model_id'").get() as { value: string } | undefined;
    db.close();
    expect(row?.value).toBe('openai:text-embedding-3-small');
  });

  it('inserts schema_version = 1 on fresh DB', () => {
    const db = openMetadataDb(tmpDir);
    assertModelMatch(db, 'openai:text-embedding-3-small');
    const row = db.prepare("SELECT value FROM index_metadata WHERE key = 'schema_version'").get() as { value: string } | undefined;
    db.close();
    expect(row?.value).toBe('1');
  });

  it('does not throw when called twice with the same model ID', () => {
    const db = openMetadataDb(tmpDir);
    assertModelMatch(db, 'openai:text-embedding-3-small');
    expect(() => assertModelMatch(db, 'openai:text-embedding-3-small')).not.toThrow();
    db.close();
  });

  it('throws when model ID mismatches stored value', () => {
    const db = openMetadataDb(tmpDir);
    assertModelMatch(db, 'openai:text-embedding-3-small');
    expect(() => assertModelMatch(db, 'ollama:nomic-embed-text')).toThrow(/mismatch/i);
    db.close();
  });

  it('mismatch error contains both stored and current model IDs', () => {
    const db = openMetadataDb(tmpDir);
    assertModelMatch(db, 'openai:text-embedding-3-small');
    let errorMsg = '';
    try {
      assertModelMatch(db, 'ollama:nomic-embed-text');
    } catch (e) {
      errorMsg = (e as Error).message;
    }
    db.close();
    expect(errorMsg).toContain('openai:text-embedding-3-small');
    expect(errorMsg).toContain('ollama:nomic-embed-text');
  });
});
