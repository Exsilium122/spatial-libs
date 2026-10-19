import { describe, it, expect, vi } from 'vitest';
import createWfsRouter, { dispatchWfsRequest, handleWfs100, handleWfs110, handleWfs200 } from '../src/index.js';
import { SpatialDataProvider, GeoJSONFeature, BoundingBox } from '../src/types.js';

// Generic Hello World trees spatial data provider
class MockTreesProvider implements SpatialDataProvider {
  async getSupportedTypes(context: any): Promise<string[]> {
    return ['trees'];
  }

  async getBoundingBox(context: any, featureType: string): Promise<BoundingBox> {
    return {
      minLon: 10.0,
      minLat: 50.0,
      maxLon: 12.0,
      maxLat: 52.0
    };
  }

  async getFeatures(
    context: any,
    featureType: string,
    fids?: string[],
    filterQuery?: any
  ): Promise<GeoJSONFeature[]> {
    const allTrees: GeoJSONFeature[] = [
      {
        id: 'tree1',
        geometry: {
          type: 'Point',
          coordinates: [10.5, 50.5]
        },
        properties: {
          name: 'Oak Tree',
          note: 'Old oak near entrance',
          url: 'http://localhost:9000#map/tree1'
        }
      },
      {
        id: 'tree2',
        geometry: {
          type: 'Point',
          coordinates: [11.5, 51.5]
        },
        properties: {
          name: 'Pine Tree',
          note: 'Tall pine near lake',
          url: 'http://localhost:9000#map/tree2'
        }
      }
    ];

    if (fids && fids.length > 0) {
      return allTrees.filter(t => fids.includes(String(t.id)));
    }
    return allTrees;
  }

  async getGeometryType(context: any, featureType: string): Promise<'Point' | 'LineString'> {
    return 'Point';
  }

  async getPropertiesSchema(context: any, featureType: string): Promise<Record<string, 'string' | 'integer' | 'double' | 'boolean'>> {
    return {
      name: 'string',
      note: 'string',
      url: 'string'
    };
  }
}

describe('WFS Library - @spatial-api/wfs', () => {
  const provider = new MockTreesProvider();
  const options = {
    provider,
    baseUrl: 'http://localhost:9000/wfs',
    appUrl: 'http://localhost:9000',
    xmlOptions: {
      namespaces: {
        'trees-ns': 'http://example.com/trees'
      }
    }
  };

  it('verifies that the provider meets the SpatialDataProvider contract indirectly', () => {
    expect(() => {
      createWfsRouter(options);
    }).not.toThrow();
  });

  it('fails verification if a required provider method is missing', () => {
    const invalidProvider = {
      getSupportedTypes: async () => []
    };
    expect(() => {
      createWfsRouter({
        ...options,
        provider: invalidProvider as any
      });
    }).toThrow('[Spatial-API WFS Verification Error]');
  });

  it('fails verification if a required crsTransformer method is missing', () => {
    const invalidTransformer = {
      normalizeSrs: () => 'EPSG:4326'
    };
    expect(() => {
      createWfsRouter({
        ...options,
        crsTransformer: invalidTransformer as any
      });
    }).toThrow('[Spatial-API WFS Verification Error]: The provided CoordinateTransformer is missing the required method "isSupported".');
  });

  it('fails verification if a required logger method is missing', () => {
    const invalidLogger = {
      info: () => {}
    };
    expect(() => {
      createWfsRouter({
        ...options,
        logger: invalidLogger as any
      });
    }).toThrow('[Spatial-API WFS Verification Error]: The provided Logger is missing the required method "warn".');
  });

  // GetCapabilities / GetFeature / DescribeFeatureType and srsName behaviour per version is covered by
  // test/conformance/wfs-*.test.ts.

  describe('WFS Exception Sanitization and Diagnostics (#17)', () => {
    const secretError = new Error('relation "secret_table" does not exist');

    class FailingProvider extends MockTreesProvider {
      override async getFeatures(): Promise<GeoJSONFeature[]> {
        throw secretError;
      }
    }

    const versions = ['1.0.0', '1.1.0', '2.0.0'] as const;

    for (const version of versions) {
      it(`sanitizes unexpected provider errors in WFS ${version} via dispatchWfsRequest`, async () => {
        const logger = {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };

        const failingOptions = {
          ...options,
          provider: new FailingProvider(),
          logger,
        };

        const req = {
          method: 'GET' as const,
          query: {
            request: 'GetFeature',
            version,
            typename: 'trees-ns:trees',
          },
        };

        const res = await dispatchWfsRequest(req, failingOptions);

        expect(res.status).toBe(400);
        expect(res.headers['Content-Type']).toBe('text/xml');
        expect(res.body).not.toContain('secret_table');
        expect(res.body).toContain('An internal error occurred while processing the request.');
        expect(logger.error).toHaveBeenCalled();
        const logged = logger.error.mock.calls.some((call) => call.includes(secretError));
        expect(logged).toBe(true);
      });

      it(`preserves expected client validation diagnostics in WFS ${version}`, async () => {
        const logger = {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };

        const req = {
          method: 'GET' as const,
          query: {
            request: 'GetFeature',
            version,
          },
        };

        const res = await dispatchWfsRequest(req, { ...options, logger });

        expect(res.status).toBe(400);
        expect(res.headers['Content-Type']).toBe('text/xml');
        expect(res.body).toContain('error: missing feature type');
        expect(logger.error).not.toHaveBeenCalled();
      });
    }

    it('sanitizes unexpected provider errors via direct version handler entrypoints', async () => {
      const handlers = [
        { version: '1.0.0', handler: handleWfs100 },
        { version: '1.1.0', handler: handleWfs110 },
        { version: '2.0.0', handler: handleWfs200 },
      ] as const;

      for (const { version, handler } of handlers) {
        const logger = {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };

        const failingOptions = {
          ...options,
          provider: new FailingProvider(),
          logger,
        };

        const req = {
          method: 'GET' as const,
          query: {
            request: 'GetFeature',
            version,
            typename: 'trees-ns:trees',
          },
        };

        const res = await handler(req, failingOptions);

        expect(res.status).toBe(400);
        expect(res.headers['Content-Type']).toBe('text/xml');
        expect(res.body).not.toContain('secret_table');
        expect(res.body).toContain('An internal error occurred while processing the request.');
        expect(logger.error).toHaveBeenCalled();
        const logged = logger.error.mock.calls.some((call) => call.includes(secretError));
        expect(logged).toBe(true);
      }
    });

    it('preserves specific error diagnostics when client-safe error is thrown', async () => {
      class ClientSafeFailingProvider extends MockTreesProvider {
        override async getFeatures(): Promise<GeoJSONFeature[]> {
          const err = new Error('Custom validation error: invalid filter syntax');
          (err as any).isClientSafe = true;
          (err as any).code = 'InvalidParameterValue';
          (err as any).locator = 'filter';
          throw err;
        }
      }

      for (const version of versions) {
        const logger = {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };

        const res = await dispatchWfsRequest(
          {
            method: 'GET',
            query: {
              request: 'GetFeature',
              version,
              typename: 'trees-ns:trees',
            },
          },
          {
            ...options,
            provider: new ClientSafeFailingProvider(),
            logger,
          }
        );

        expect(res.status).toBe(400);
        expect(res.body).toContain('Custom validation error: invalid filter syntax');
        expect(res.body).not.toContain('An internal error occurred while processing the request.');
        expect(logger.error).not.toHaveBeenCalled();
      }
    });
  });
});

