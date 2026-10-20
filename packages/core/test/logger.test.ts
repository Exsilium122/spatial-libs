import { describe, expect, it, vi } from 'vitest';
import { createConsoleLogger, NOOP_LOGGER, normalizeLogger } from '../src/logger.js';
import type { Logger } from '../src/types.js';

describe('Logger Utilities', () => {
  it('logs with default [spatial-api] prefix and custom prefix', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    try {
      const defaultLogger = createConsoleLogger();
      defaultLogger.info('service ready');
      expect(infoSpy).toHaveBeenCalledWith('[spatial-api] service ready');

      const customLogger = createConsoleLogger('[my-app]');
      customLogger.warn('slow query');
      expect(warnSpy).toHaveBeenCalledWith('[my-app] slow query');

      customLogger.error('query failed');
      expect(errorSpy).toHaveBeenCalledWith('[my-app] query failed');

      customLogger.debug?.('details');
      expect(debugSpy).toHaveBeenCalledWith('[my-app] details');
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });

  it('silences all logs when false is passed', () => {
    const logger = normalizeLogger(false);
    expect(logger).toBe(NOOP_LOGGER);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      logger.info('test message');
      logger.warn('test warning');
      logger.error('test error');
      logger.debug?.('test debug');
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('handles custom Logger where debug is optional', () => {
    const calls: string[] = [];
    // Logger implementing only required info, warn, error:
    const custom: Logger = {
      info: (msg) => calls.push(`info: ${msg}`),
      warn: (msg) => calls.push(`warn: ${msg}`),
      error: (msg) => calls.push(`error: ${msg}`),
    };

    const normalized = normalizeLogger(custom);
    normalized.info('one');
    normalized.warn('two');
    normalized.error('three');
    // debug is present on normalized and does not throw even though custom.debug was undefined
    expect(() => normalized.debug?.('four')).not.toThrow();

    expect(calls).toEqual(['info: one', 'warn: two', 'error: three']);
  });

  it('defaults to console logger when undefined or null is passed', () => {
    const loggerUndefined = normalizeLogger();
    expect(typeof loggerUndefined.info).toBe('function');
    expect(typeof loggerUndefined.warn).toBe('function');
    expect(typeof loggerUndefined.error).toBe('function');

    const loggerNull = normalizeLogger(null);
    expect(typeof loggerNull.info).toBe('function');
  });
});
