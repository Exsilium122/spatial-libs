/**
 * Error hierarchy for @spatial-api/core
 */

export interface ProviderErrorOptions extends ErrorOptions {
  clientSafe?: boolean;
  locator?: string;
  statusCode?: number;
}

export class ProviderError extends Error {
  readonly clientSafe: boolean;
  readonly locator?: string;
  readonly statusCode: number;

  constructor(message: string, options?: ProviderErrorOptions) {
    super(message, options);
    this.name = 'ProviderError';
    this.clientSafe = options?.clientSafe ?? false;
    this.locator = options?.locator;
    this.statusCode = options?.statusCode ?? 500;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      clientSafe: this.clientSafe,
      locator: this.locator,
      statusCode: this.statusCode,
    };
  }
}

export class NotFoundError extends ProviderError {
  constructor(message = 'Not Found', options?: Omit<ProviderErrorOptions, 'statusCode'>) {
    super(message, {
      ...options,
      clientSafe: options?.clientSafe ?? true,
      statusCode: 404,
    });
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidParameterError extends ProviderError {
  constructor(message = 'Invalid Parameter', options?: Omit<ProviderErrorOptions, 'statusCode'>) {
    super(message, {
      ...options,
      clientSafe: options?.clientSafe ?? true,
      statusCode: 400,
    });
    this.name = 'InvalidParameterError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotSupportedError extends ProviderError {
  constructor(message = 'Not Supported', options?: Omit<ProviderErrorOptions, 'statusCode'>) {
    super(message, {
      ...options,
      clientSafe: options?.clientSafe ?? true,
      statusCode: 501,
    });
    this.name = 'NotSupportedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConflictError extends ProviderError {
  constructor(message = 'Conflict', options?: Omit<ProviderErrorOptions, 'statusCode'>) {
    super(message, {
      ...options,
      clientSafe: options?.clientSafe ?? true,
      statusCode: 409,
    });
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ForbiddenError extends ProviderError {
  constructor(message = 'Forbidden', options?: Omit<ProviderErrorOptions, 'statusCode'>) {
    super(message, {
      ...options,
      clientSafe: options?.clientSafe ?? true,
      statusCode: 403,
    });
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnavailableError extends ProviderError {
  constructor(message = 'Service Unavailable', options?: Omit<ProviderErrorOptions, 'statusCode'>) {
    super(message, {
      ...options,
      clientSafe: options?.clientSafe ?? false,
      statusCode: 503,
    });
    this.name = 'UnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProviderContractError extends Error {
  readonly violations: readonly string[];

  constructor(violations: string[]) {
    const summary =
      violations.length === 1
        ? `Provider contract violation: ${violations[0]}`
        : `Provider contract violations (${violations.length}):\n${violations.map((v) => `- ${v}`).join('\n')}`;
    super(summary);
    this.name = 'ProviderContractError';
    this.violations = Object.freeze([...violations]);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      violations: this.violations,
    };
  }
}
