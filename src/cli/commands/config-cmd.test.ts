import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { loadConfig } from '../../config.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { registerConfigCommand } from './config-cmd.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

const MOCK_CONFIG = {
  vaultPath: '/mock/vault',
  indexPath: '/mock/.claude-code-memory',
  embeddingProvider: 'openai' as const,
  openaiModel: 'text-embedding-3-small',
  batchSize: 100,
  concurrency: 2,
  ignorePaths: [],
  includeExtensions: ['.md'],
};

describe('registerConfigCommand', () => {
  let program: Command;
  let logs: string[];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    logs = [];
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg ?? ''));
    });
    mockLoadConfig.mockReturnValue(MOCK_CONFIG);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ vaultPath: '/mock/vault' }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('Test 4: config show (no args) prints all config key-value pairs', async () => {
    registerConfigCommand(program);
    await program.parseAsync(['config'], { from: 'user' });

    const output = logs.join('\n');
    expect(output).toContain('vaultPath');
    expect(output).toContain('/mock/vault');
    expect(output).toContain('embeddingProvider');
    expect(output).toContain('openai');
    expect(output).toContain('batchSize');
    expect(output).toContain('100');
  });

  it('Test 5: config set writes key-value to config.json, preserving existing keys', async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ vaultPath: '/existing/vault', batchSize: 50 }),
    );

    registerConfigCommand(program);
    await program.parseAsync(['config', 'set', 'openaiModel', 'text-embedding-ada-002'], {
      from: 'user',
    });

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('openaiModel'),
    );

    const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    // Existing keys preserved
    expect(parsed.vaultPath).toBe('/existing/vault');
    expect(parsed.batchSize).toBe(50);
    // New key added
    expect(parsed.openaiModel).toBe('text-embedding-ada-002');
  });

  it('Test 6: config set with ignorePaths parses comma-separated string into array', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ vaultPath: '/mock/vault' }));

    registerConfigCommand(program);
    await program.parseAsync(
      ['config', 'set', 'ignorePaths', 'node_modules,Archive,.trash'],
      { from: 'user' },
    );

    const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(Array.isArray(parsed.ignorePaths)).toBe(true);
    expect(parsed.ignorePaths).toEqual(['node_modules', 'Archive', '.trash']);
  });
});
