import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/db/sqlite.js', () => ({
  openMetadataDb: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { loadConfig } from '../../config.js';
import { openMetadataDb, getStatus } from '../../core/db/sqlite.js';
import { registerStatusCommand } from './status-cmd.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockOpenMetadataDb = vi.mocked(openMetadataDb);
const mockGetStatus = vi.mocked(getStatus);

describe('registerStatusCommand', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const mockDb = { close: vi.fn() } as unknown as import('better-sqlite3').Database;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockLoadConfig.mockReturnValue({
      vaultPath: '/mock/vault',
      indexPath: '/mock/index',
      embeddingProvider: 'openai',
      openaiModel: 'text-embedding-3-small',
      batchSize: 100,
      concurrency: 2,
      ignorePaths: [],
      includeExtensions: ['.md'],
    });
    mockOpenMetadataDb.mockReturnValue(mockDb);
  });

  it('Test 1: adds "status" command to commander program', () => {
    registerStatusCommand(program);
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain('status');
  });

  it('Test 2: prints file count, chunk count, last indexed date, and embedding model', async () => {
    mockGetStatus.mockReturnValue({
      fileCount: 1247,
      chunkCount: 4891,
      lastIndexedAt: new Date('2026-04-05T14:32:11.000Z'),
      embeddingModel: 'openai:text-embedding-3-small',
    });

    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg);
    });

    registerStatusCommand(program);
    await program.parseAsync(['status'], { from: 'user' });

    const output = logs.join('\n');
    expect(output).toContain('1,247');
    expect(output).toContain('4,891');
    expect(output).toContain('openai:text-embedding-3-small');
    // last indexed date should appear
    expect(output).toMatch(/2026-04-05/);

    consoleSpy.mockRestore();
  });

  it('Test 3: shows "No files indexed yet" when fileCount is 0', async () => {
    mockGetStatus.mockReturnValue({
      fileCount: 0,
      chunkCount: 0,
      lastIndexedAt: null,
      embeddingModel: 'unknown',
    });

    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg);
    });

    registerStatusCommand(program);
    await program.parseAsync(['status'], { from: 'user' });

    const output = logs.join('\n');
    expect(output).toContain('No files indexed yet');

    consoleSpy.mockRestore();
  });

  it('Test 4: calls loadConfig and openMetadataDb', async () => {
    mockGetStatus.mockReturnValue({
      fileCount: 5,
      chunkCount: 20,
      lastIndexedAt: new Date(),
      embeddingModel: 'openai:text-embedding-3-small',
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    registerStatusCommand(program);
    await program.parseAsync(['status'], { from: 'user' });

    expect(mockLoadConfig).toHaveBeenCalledOnce();
    expect(mockOpenMetadataDb).toHaveBeenCalledWith('/mock/index');
    expect(mockGetStatus).toHaveBeenCalledWith(mockDb);

    consoleSpy.mockRestore();
  });
});
