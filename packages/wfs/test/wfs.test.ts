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
            service: 'WFS',
            request: 'GetFeature',
            version,
            typename: 'trees-ns:trees',
          },
        };

        const res = await dispatchWfsRequest(req, failingOptions);

        expect(res.status).toBe(500);
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
            service: 'WFS',
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

        expect(res.status).toBe(500);
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
              service: 'WFS',
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

  describe('Review Findings Regression Tests (PR23 findings C, D, E, F)', () => {
    // Finding C: GetFeatureById stored query handles null-geometry and Polygon features returning 200 XML
    describe('Finding C: GetFeatureById geometry handling', () => {
      class StoredQueryProvider extends MockTreesProvider {
        override async getFeatures(context: any, featureType: string, fids?: string[]): Promise<GeoJSONFeature[]> {
          const features: GeoJSONFeature[] = [
            {
              id: 'poly-1',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [[10.0, 50.0], [12.0, 50.0], [12.0, 52.0], [10.0, 52.0], [10.0, 50.0]]
                ]
              },
              properties: { name: 'Park Area' }
            },
            {
              id: 'null-geom-1',
              geometry: null as any,
              properties: { name: 'Non-spatial Asset' }
            }
          ];
          if (fids && fids.length > 0) {
            return features.filter(f => fids.includes(String(f.id)));
          }
          return features;
        }
      }

      it('returns 200 XML for a Polygon feature via GetFeatureById', async () => {
        const sqOptions = { ...options, provider: new StoredQueryProvider() };
        const req = {
          method: 'GET' as const,
          query: {
            SERVICE: 'WFS',
            VERSION: '2.0.0',
            REQUEST: 'GetFeature',
            STOREDQUERY_ID: 'http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById',
            ID: 'poly-1'
          }
        };

        const res = await dispatchWfsRequest(req, sqOptions);
        expect(res.status).toBe(200);
        expect(res.headers['Content-Type']).toContain('application/gml+xml');
        expect(res.body).toContain('gml:Polygon');
        expect(res.body).toContain('gml:exterior');
        expect(res.body).toContain('gml:LinearRing');
        expect(res.body).toContain('gml:posList');
        expect(res.body).toContain('Park Area');
      });

      it('returns 200 XML and omits the geometry property for a null-geometry feature via GetFeatureById', async () => {
        const sqOptions = { ...options, provider: new StoredQueryProvider() };
        const req = {
          method: 'GET' as const,
          query: {
            SERVICE: 'WFS',
            VERSION: '2.0.0',
            REQUEST: 'GetFeature',
            STOREDQUERY_ID: 'http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById',
            ID: 'null-geom-1'
          }
        };

        const res = await dispatchWfsRequest(req, sqOptions);
        expect(res.status).toBe(200);
        expect(res.headers['Content-Type']).toContain('application/gml+xml');
        expect(res.body).not.toContain(':geo');
        expect(res.body).not.toContain('gml:Point');
        expect(res.body).not.toContain('gml:Polygon');
        expect(res.body).toContain('Non-spatial Asset');
      });
    });

    // Finding D: BBOX with EPSG:25832 is interpreted easting/northing
    describe('Finding D: BBOX projected CRS axis order', () => {
      it('interprets BBOX with EPSG:25832 as easting/northing (x/y)', async () => {
        let capturedFilterQuery: any = null;
        class BboxProvider extends MockTreesProvider {
          override async getFeatures(context: any, featureType: string, fids?: string[], filterQuery?: any): Promise<GeoJSONFeature[]> {
            capturedFilterQuery = filterQuery;
            return [];
          }
        }

        const bboxOptions = { ...options, provider: new BboxProvider() };
        const req = {
          method: 'GET' as const,
          query: {
            SERVICE: 'WFS',
            VERSION: '2.0.0',
            REQUEST: 'GetFeature',
            TYPENAMES: 'trees-ns:trees',
            BBOX: '500000,5700000,501000,5701000,EPSG:25832'
          }
        };

        const res = await dispatchWfsRequest(req, bboxOptions);
        expect(res.status).toBe(200);
        expect(capturedFilterQuery).toBeDefined();
        const ring = capturedFilterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
        // Coordinates must be easting (minLon=500000), northing (minLat=5700000)
        expect(ring[0]).toEqual([500000, 5700000]);
        expect(ring[1]).toEqual([501000, 5700000]);
        expect(ring[2]).toEqual([501000, 5701000]);
        expect(ring[3]).toEqual([500000, 5701000]);
        expect(ring[4]).toEqual([500000, 5700000]);
      });

      it.each(['2.0.0', '1.1.0'].flatMap((version) => [
        [version, 'urn:ogc:def:crs:EPSG::4326', [20, 10]],
        [version, 'urn:x-ogc:def:crs:EPSG:4326', [20, 10]],
        [version, 'http://www.opengis.net/def/crs/EPSG/0/4326', [20, 10]],
        [version, 'urn:ogc:def:crs:EPSG::43260', [10, 20]],
        [version, 'http://www.opengis.net/def/crs/EPSG/0/24326', [10, 20]],
      ]))('WFS %s treats BBOX CRS %s as lat/lon only when it is exactly EPSG 4326', async (version, crs, firstCorner) => {
        let capturedFilterQuery: any = null;
        class BboxProvider extends MockTreesProvider {
          override async getFeatures(context: any, featureType: string, fids?: string[], filterQuery?: any): Promise<GeoJSONFeature[]> {
            capturedFilterQuery = filterQuery;
            return [];
          }
        }

        const res = await dispatchWfsRequest({
          method: 'GET',
          query: {
            SERVICE: 'WFS',
            VERSION: version,
            REQUEST: 'GetFeature',
            TYPENAMES: 'trees-ns:trees',
            TYPENAME: 'trees-ns:trees',
            BBOX: `10,20,11,21,${crs}`
          }
        }, { ...options, provider: new BboxProvider() });
        expect(res.status).toBe(200);
        const ring = capturedFilterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
        expect(ring[0]).toEqual(firstCorner);
      });
    });

    // Finding E: dispatchWfsRequest called directly returns 500 on throwing provider and MissingParameterValue without SERVICE
    describe('Finding E: dispatchWfsRequest error handling and validation without Express', () => {
      it('returns 500 when called directly (no Express) with a throwing provider', async () => {
        class ThrowingProvider extends MockTreesProvider {
          override async getFeatures(): Promise<GeoJSONFeature[]> {
            throw new Error('Database unreachable');
          }
        }

        const req = {
          method: 'GET' as const,
          query: {
            SERVICE: 'WFS',
            VERSION: '2.0.0',
            REQUEST: 'GetFeature',
            TYPENAMES: 'trees-ns:trees'
          }
        };

        const res = await dispatchWfsRequest(req, { ...options, provider: new ThrowingProvider() });
        expect(res.status).toBe(500);
        expect(res.body).toContain('OperationProcessingFailed');
      });

      it('returns MissingParameterValue for service when called directly without SERVICE', async () => {
        const req = {
          method: 'GET' as const,
          query: {
            VERSION: '2.0.0',
            REQUEST: 'GetFeature',
            TYPENAMES: 'trees-ns:trees'
          }
        };

        const res = await dispatchWfsRequest(req, options);
        expect(res.status).toBe(400);
        expect(res.body).toContain('MissingParameterValue');
        expect(res.body).toContain('locator="service"');
      });
    });

    // Finding F: ListStoredQueries lists all provider types
    describe('Finding F: ListStoredQueries lists all provider types', () => {
      it('lists all provider types under wfs:ReturnFeatureType in ListStoredQueries', async () => {
        class MultiTypeProvider extends MockTreesProvider {
          override async getSupportedTypes(): Promise<string[]> {
            return ['trees', 'rivers', 'roads'];
          }
        }

        const req = {
          method: 'GET' as const,
          query: {
            SERVICE: 'WFS',
            VERSION: '2.0.0',
            REQUEST: 'ListStoredQueries'
          }
        };

        const res = await dispatchWfsRequest(req, { ...options, provider: new MultiTypeProvider() });
        expect(res.status).toBe(200);
        expect(res.body).toContain('<wfs:ReturnFeatureType>trees-ns:trees</wfs:ReturnFeatureType>');
        expect(res.body).toContain('<wfs:ReturnFeatureType>trees-ns:rivers</wfs:ReturnFeatureType>');
        expect(res.body).toContain('<wfs:ReturnFeatureType>trees-ns:roads</wfs:ReturnFeatureType>');
      });
    });
  });
});

