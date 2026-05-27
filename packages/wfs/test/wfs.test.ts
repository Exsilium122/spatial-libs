import { describe, it, expect } from 'vitest';
import createWfsRouter, { verifyProvider, dispatchWfsRequest } from '../src/index.js';
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

  it('verifies that the provider meets the SpatialDataProvider contract', () => {
    expect(() => verifyProvider(provider)).not.toThrow();
  });

  it('fails verification if a required method is missing', () => {
    const invalidProvider = {
      getSupportedTypes: async () => []
    };
    expect(() => verifyProvider(invalidProvider as any)).toThrow();
  });

  it('handles GetCapabilities WFS 1.0.0 request', async () => {
    const req = {
      method: 'GET' as const,
      query: {
        request: 'GetCapabilities',
        version: '1.0.0'
      }
    };
    const res = await dispatchWfsRequest(req, options);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/xml');
    expect(res.body).toContain('<WFS_Capabilities version="1.0.0"');
    expect(res.body).toContain('<Name>trees-ns:trees</Name>');
  });

  it('handles GetFeature WFS 1.1.0 request', async () => {
    const req = {
      method: 'GET' as const,
      query: {
        request: 'GetFeature',
        version: '1.1.0',
        typename: 'trees-ns:trees'
      }
    };
    const res = await dispatchWfsRequest(req, options);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/xml');
    expect(res.body).toContain('<wfs:FeatureCollection');
    expect(res.body).toContain('<wfs:trees xmlns:wfs="http://example.com/trees" fid="tree1"');
    expect(res.body).toContain('<gml:Point');
    expect(res.body).toContain('<gml:pos>50.5 10.5</gml:pos>');
  });

  it('handles DescribeFeatureType WFS 2.0.0 request', async () => {
    const req = {
      method: 'GET' as const,
      query: {
        request: 'DescribeFeatureType',
        version: '2.0.0',
        typename: 'trees-ns:trees'
      }
    };
    const res = await dispatchWfsRequest(req, options);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/xml');
    expect(res.body).toContain('<element name="trees"');
    expect(res.body).toContain('type="trees-ns:trees_Type"');
  });
});
