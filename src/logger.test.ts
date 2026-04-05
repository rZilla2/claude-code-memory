import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('logger.info writes to stderr', async () => {
    const { logger } = await import('./logger.js');
    logger.info('hello info');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy.mock.calls[0][0]).toContain('[INFO]');
    expect(stderrSpy.mock.calls[0][0]).toContain('hello info');
  });

  it('logger.warn writes to stderr', async () => {
    const { logger } = await import('./logger.js');
    logger.warn('hello warn');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy.mock.calls[0][0]).toContain('[WARN]');
    expect(stderrSpy.mock.calls[0][0]).toContain('hello warn');
  });

  it('logger.error writes to stderr', async () => {
    const { logger } = await import('./logger.js');
    logger.error('hello error');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy.mock.calls[0][0]).toContain('[ERROR]');
    expect(stderrSpy.mock.calls[0][0]).toContain('hello error');
  });

  it('does not use console.log', async () => {
    // Static check: import the module source and verify no console.log
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('./logger.ts', import.meta.url).pathname, 'utf-8');
    expect(src).not.toContain('console.log');
  });
});
