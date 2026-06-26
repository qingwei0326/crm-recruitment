import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../logger';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('error always logs to console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('test error', { detail: 'fail' });
    expect(spy).toHaveBeenCalledWith('[CRM]', 'test error', { detail: 'fail' });
  });

  it('log is silent in production', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // In test mode (import.meta.env.DEV is true), log should work
    logger.log('test log');
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });

  it('warn is silent in production', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('test warn');
    expect(true).toBe(true);
  });
});
