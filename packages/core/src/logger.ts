/**
 * Logging utilities for @spatial-api/core
 */

import type { Logger } from './types.js';

export const NOOP_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Creates a console-backed logger with a configurable prefix (default: '[spatial-api]').
 */
export function createConsoleLogger(prefix = '[spatial-api]'): Logger {
  return {
    info: (message: string, ...args: unknown[]) => {
      console.info(`${prefix} ${message}`, ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
      console.warn(`${prefix} ${message}`, ...args);
    },
    error: (message: string, ...args: unknown[]) => {
      console.error(`${prefix} ${message}`, ...args);
    },
    debug: (message: string, ...args: unknown[]) => {
      console.debug(`${prefix} ${message}`, ...args);
    },
  };
}

/**
 * Normalizes a Logger | false | undefined into a concrete Logger instance.
 * - `false` returns a silent no-op logger.
 * - `undefined` / `null` returns `createConsoleLogger()`.
 * - A provided Logger is returned, with an optional debug fallback if omitted.
 */
export function normalizeLogger(logger?: Logger | false | null): Logger {
  if (logger === false) {
    return NOOP_LOGGER;
  }
  if (!logger) {
    return createConsoleLogger();
  }
  return {
    info: (msg, ...args) => logger.info(msg, ...args),
    warn: (msg, ...args) => logger.warn(msg, ...args),
    error: (msg, ...args) => logger.error(msg, ...args),
    debug: logger.debug ? (msg, ...args) => logger.debug!(msg, ...args) : () => {},
  };
}
