import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { runFirstTimeSetup } from './first-run.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe('runFirstTimeSetup', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('Test 1: returns false when config.json already exists', () => {
    // config.json exists → skip setup
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith('config.json')) return true;
      return false;
    });

    const result = runFirstTimeSetup();
    expect(result).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('Test 2: creates config.json with vaultPath when iCloud Obsidian path exists', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith('config.json')) return false;
      if (path.includes('iCloud~md~obsidian')) return true;
      return false;
    });

    const result = runFirstTimeSetup();
    expect(result).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('.claude-code-memory'), {
      recursive: true,
    });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('vaultPath'),
    );
    const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.vaultPath).toContain('iCloud~md~obsidian');
  });

  it('Test 3: returns false when neither config nor vault found', () => {
    mockExistsSync.mockReturnValue(false);

    const result = runFirstTimeSetup();
    expect(result).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
