import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importWithRetry, isChunkLoadError } from '../lazyWithRetry';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/A.js');

describe('isChunkLoadError', () => {
  it('recognises the wording used by Chrome, Firefox and Safari', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
  });

  it('ignores ordinary errors', () => {
    expect(isChunkLoadError(new Error('Test error'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('importWithRetry', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns the module on the first success without retrying', async () => {
    const factory = vi.fn().mockResolvedValue({ default: 'ok' });
    await expect(importWithRetry(factory, { delayMs: 0 })()).resolves.toEqual({ default: 'ok' });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('retries once after a chunk load failure', async () => {
    const factory = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValue({ default: 'ok' });
    const reload = vi.fn();
    await expect(importWithRetry(factory, { delayMs: 0, reload })()).resolves.toEqual({ default: 'ok' });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not retry errors that are not chunk failures', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('SyntaxError in module'));
    await expect(importWithRetry(factory, { delayMs: 0 })()).rejects.toThrow('SyntaxError in module');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('reloads the page once when retries are exhausted', async () => {
    const factory = vi.fn().mockRejectedValue(chunkError());
    const reload = vi.fn();
    const pending = importWithRetry(factory, { delayMs: 0, reload })();
    const settled = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 30)),
    ]);
    expect(settled).toBe('pending');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('surfaces the error instead of looping when a reload just happened', async () => {
    sessionStorage.setItem('crm:chunk-reload-at', String(Date.now()));
    const factory = vi.fn().mockRejectedValue(chunkError());
    const reload = vi.fn();
    await expect(importWithRetry(factory, { delayMs: 0, reload })()).rejects.toThrow(
      'Failed to fetch dynamically imported module',
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
