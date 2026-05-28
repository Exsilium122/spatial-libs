import { describe, it, expect } from 'vitest';
import createOgcRouter, { verifyProvider } from '../src/index.js';
import { SpatialDataProvider, GeoJSONFeature, BoundingBox } from '../src';
// We don't need a real server to test core dispatch, but we can verify verifyProvider
// and basic responses since it is standard JS logic.

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

  it('verifies that the provider meets the SpatialDataProvider contract', () => {
    expect(() => verifyProvider(provider)).not.toThrow();
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
