import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  InvalidParameterError,
  NotFoundError,
  NotSupportedError,
  ProviderContractError,
  ProviderError,
  UnavailableError,
} from '../src/errors.js';

describe('Error Hierarchy & Serialization', () => {
  it('instantiates ProviderError with defaults and options', () => {
    const err = new ProviderError('something went wrong', {
      clientSafe: true,
      locator: 'query.filter',
      statusCode: 422,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderError');
    expect(err.message).toBe('something went wrong');
    expect(err.clientSafe).toBe(true);
    expect(err.locator).toBe('query.filter');
    expect(err.statusCode).toBe(422);

    expect(err.toJSON()).toEqual({
      name: 'ProviderError',
      message: 'something went wrong',
      clientSafe: true,
      locator: 'query.filter',
      statusCode: 422,
    });
  });

  it('instantiates all 6 typed subclasses with appropriate defaults and status codes', () => {
    const notFound = new NotFoundError('Collection not found', { locator: 'collectionId' });
    expect(notFound).toBeInstanceOf(ProviderError);
    expect(notFound.name).toBe('NotFoundError');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.clientSafe).toBe(true);
    expect(notFound.locator).toBe('collectionId');

    const invalidParam = new InvalidParameterError('Invalid bbox parameter', { locator: 'bbox' });
    expect(invalidParam).toBeInstanceOf(ProviderError);
    expect(invalidParam.name).toBe('InvalidParameterError');
    expect(invalidParam.statusCode).toBe(400);
    expect(invalidParam.clientSafe).toBe(true);

    const notSupported = new NotSupportedError('s_crosses operator not supported');
    expect(notSupported).toBeInstanceOf(ProviderError);
    expect(notSupported.name).toBe('NotSupportedError');
    expect(notSupported.statusCode).toBe(501);
    expect(notSupported.clientSafe).toBe(true);

    const conflict = new ConflictError('Feature id already exists');
    expect(conflict).toBeInstanceOf(ProviderError);
    expect(conflict.name).toBe('ConflictError');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.clientSafe).toBe(true);

    const forbidden = new ForbiddenError('Insufficient permissions');
    expect(forbidden).toBeInstanceOf(ProviderError);
    expect(forbidden.name).toBe('ForbiddenError');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.clientSafe).toBe(true);

    const unavailable = new UnavailableError('Database connection pool exhausted');
    expect(unavailable).toBeInstanceOf(ProviderError);
    expect(unavailable.name).toBe('UnavailableError');
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.clientSafe).toBe(false);
  });

  it('serializes errors correctly with toJSON() and JSON.stringify()', () => {
    const err = new InvalidParameterError('Bad parameter', { locator: 'limit' });
    const json = JSON.parse(JSON.stringify(err));
    expect(json).toEqual({
      name: 'InvalidParameterError',
      message: 'Bad parameter',
      clientSafe: true,
      locator: 'limit',
      statusCode: 400,
    });
  });

  it('serializes ProviderContractError with its list of violations', () => {
    const contractErr = new ProviderContractError([
      'Missing describeCollections()',
      'capabilities.write requires transaction()',
    ]);
    expect(contractErr).toBeInstanceOf(Error);
    expect(contractErr.name).toBe('ProviderContractError');
    expect(contractErr.violations).toHaveLength(2);
    expect(contractErr.violations[0]).toBe('Missing describeCollections()');
    expect(contractErr.violations[1]).toBe('capabilities.write requires transaction()');
    expect(contractErr.message).toContain('Missing describeCollections()');
    expect(contractErr.message).toContain('capabilities.write requires transaction()');

    const json = JSON.parse(JSON.stringify(contractErr));
    expect(json).toEqual({
      name: 'ProviderContractError',
      message: contractErr.message,
      violations: [
        'Missing describeCollections()',
        'capabilities.write requires transaction()',
      ],
    });
  });
});
