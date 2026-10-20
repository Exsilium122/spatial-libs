import { describe, expect, it } from 'vitest';
import { ProviderContractError } from '../src/errors.js';
import type { SpatialProvider } from '../src/types.js';
import { validateProvider } from '../src/validate.js';

function createValidProvider(): SpatialProvider {
  return {
    name: 'test-provider',
    capabilities: {
      filter: { operators: ['=', 'like', 's_intersects'] },
      paging: true,
      count: 'exact',
      sorting: true,
      propertySelection: true,
      crs: { native: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'] },
    },
    describeCollections: async () => [],
    getFeatures: async () => ({ features: [], numberMatched: 0 }),
  };
}

describe('validateProvider', () => {
  it('passes a fully conforming provider without throwing', () => {
    const provider = createValidProvider();
    expect(() => validateProvider(provider)).not.toThrow();
  });

  it('collects both missing describeCollections and write without transaction in one ProviderContractError', () => {
    // Acceptance criterion:
    // Given a provider with no describeCollections that declares write but has no transaction,
    // when validateProvider runs, then one ProviderContractError lists both violations.
    const provider: Partial<SpatialProvider> = {
      capabilities: {
        filter: { operators: ['='] },
        paging: true,
        count: 'exact',
        sorting: true,
        propertySelection: true,
        crs: { native: [] },
        write: {
          atomic: true,
          idGeneration: ['generate'],
        },
      },
      // describeCollections omitted!
      getFeatures: async () => ({ features: [] }),
      // transaction omitted!
    };

    let caughtError: ProviderContractError | null = null;
    try {
      validateProvider(provider);
    } catch (err) {
      if (err instanceof ProviderContractError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError).toBeInstanceOf(ProviderContractError);
    expect(caughtError!.violations.some((v) => v.includes('describeCollections'))).toBe(true);
    expect(caughtError!.violations.some((v) => v.includes('transaction'))).toBe(true);
    expect(caughtError!.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('fails when required methods are missing', () => {
    const provider = {
      capabilities: createValidProvider().capabilities,
      // missing describeCollections and getFeatures
    };

    expect(() => validateProvider(provider)).toThrowError(ProviderContractError);
    try {
      validateProvider(provider);
    } catch (err: any) {
      expect(err.violations).toContain('Provider must implement describeCollections()');
      expect(err.violations).toContain('Provider must implement getFeatures()');
    }
  });

  it('fails when capabilities.paging is not a boolean', () => {
    const provider = createValidProvider();
    (provider.capabilities as any).paging = 'yes';

    expect(() => validateProvider(provider)).toThrowError(ProviderContractError);
    try {
      validateProvider(provider);
    } catch (err: any) {
      expect(err.violations).toContain('capabilities.paging must be a boolean');
    }
  });

  it('fails when capabilities.count is neither exact nor none', () => {
    const provider = createValidProvider();
    (provider.capabilities as any).count = 'approximate';

    expect(() => validateProvider(provider)).toThrowError(ProviderContractError);
    try {
      validateProvider(provider);
    } catch (err: any) {
      expect(err.violations).toContain("capabilities.count must be 'exact' or 'none'");
    }
  });

  it('fails when capabilities.filter.operators contains unknown operator names', () => {
    const provider = createValidProvider();
    (provider.capabilities.filter.operators as any).push('invalid_op', 'unknown_function');

    expect(() => validateProvider(provider)).toThrowError(ProviderContractError);
    try {
      validateProvider(provider);
    } catch (err: any) {
      expect(err.violations.some((v: string) => v.includes("unknown operator 'invalid_op'"))).toBe(true);
      expect(err.violations.some((v: string) => v.includes("unknown operator 'unknown_function'"))).toBe(true);
    }
  });

  it('validates write capabilities with transaction and idGeneration', () => {
    const provider = createValidProvider();
    provider.capabilities.write = {
      atomic: true,
      idGeneration: ['generate', 'invalid_id_mode' as any],
    };
    provider.transaction = async () => ({
      inserted: [],
      updated: [],
      replaced: [],
      deleted: 0,
      status: 'success',
    });

    expect(() => validateProvider(provider)).toThrowError(ProviderContractError);
    try {
      validateProvider(provider);
    } catch (err: any) {
      expect(err.violations.some((v: string) => v.includes('invalid_id_mode'))).toBe(true);
    }
  });

  it('validates against additional service requirements', () => {
    const provider = createValidProvider();

    // Requires write
    expect(() => validateProvider(provider, { write: true })).toThrowError(ProviderContractError);

    // Requires specific operator not declared
    expect(() => validateProvider(provider, { operators: ['s_within'] })).toThrowError(ProviderContractError);

    // Requires specific native CRS not declared
    expect(() => validateProvider(provider, { crs: ['http://www.opengis.net/def/crs/EPSG/0/3857'] })).toThrowError(
      ProviderContractError
    );
  });
});
