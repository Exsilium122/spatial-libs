import { describe, it, expect } from 'vitest';
import createOgcRouter from '../src/index.js';
import { SpatialDataProvider, GeoJSONFeature, BoundingBox } from '../src/types.js';
// Router construction and boot-time validation. Protocol behaviour is covered by test/conformance/*.

class MockForestProvider implements SpatialDataProvider {
  async getSupportedTypes(context: any): Promise<string[]> {
    return ['forests'];
  }

  async getBoundingBox(context: any, featureType: string): Promise<BoundingBox> {
    return {
      minLon: 15.0,
      minLat: 60.0,
      maxLon: 17.0,
      maxLat: 62.0
    };
  }

  async getFeatures(
    context: any,
    featureType: string,
    fids?: string[],
    filterQuery?: any
  ): Promise<GeoJSONFeature[]> {
    return [
      {
        id: 'forest1',
        geometry: {
          type: 'Point',
          coordinates: [15.5, 60.5]
        },
        properties: {
          name: 'Greenwood Forest',
          note: 'State park forest'
        }
      }
    ];
  }
}

describe('OGC API Features Library - @spatial-api/ogc', () => {
  const provider = new MockForestProvider();

  it('verifies that the provider meets the SpatialDataProvider contract indirectly', () => {
    expect(() => {
      createOgcRouter({
        provider,
        baseUrl: 'http://localhost:9000/api/ogc',
        appUrl: 'http://localhost:9000'
      });
    }).not.toThrow();
  });

  it('fails verification if the provider is missing required methods', () => {
    const invalidProvider = {
      getSupportedTypes: async () => []
    };
    expect(() => {
      createOgcRouter({
        provider: invalidProvider as any,
        baseUrl: 'http://localhost:9000/api/ogc',
        appUrl: 'http://localhost:9000'
      });
    }).toThrow('[Spatial-API OGC Verification Error]');
  });

  it('fails verification if a required crsTransformer method is missing', () => {
    const invalidTransformer = {
      normalizeSrs: () => 'EPSG:4326'
    };
    expect(() => {
      createOgcRouter({
        provider,
        baseUrl: 'http://localhost:9000/api/ogc',
        appUrl: 'http://localhost:9000',
        crsTransformer: invalidTransformer as any
      });
    }).toThrow('[Spatial-API OGC Verification Error]: The provided CoordinateTransformer is missing the required method "isSupported".');
  });

  it('fails verification if a required logger method is missing', () => {
    const invalidLogger = {
      info: () => {}
    };
    expect(() => {
      createOgcRouter({
        provider,
        baseUrl: 'http://localhost:9000/api/ogc',
        appUrl: 'http://localhost:9000',
        logger: invalidLogger as any
      });
    }).toThrow('[Spatial-API OGC Verification Error]: The provided Logger is missing the required method "warn".');
  });

  it('creates an express router successfully', () => {
    const router = createOgcRouter({
      provider,
      baseUrl: 'http://localhost:9000/api/ogc',
      appUrl: 'http://localhost:9000'
    });
    expect(router).toBeDefined();
    expect(typeof router).toBe('function'); // Express routers are standard middleware functions
  });
});
