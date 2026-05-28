import { describe, it, expect } from 'vitest';
import express from 'express';
import createOgcRouter from '../src/index.js';
import { SpatialDataProvider, GeoJSONFeature, BoundingBox } from '../src/types.js';
import CrsTransformer from '../../crs/src/index.js';
// We don't need a real server to test core dispatch, but we can verify provider validation
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

  describe('OGC CRS Part 2 Integration Tests', () => {
    let server: any;
    let port: number;

    const startServer = (router: any): Promise<void> => {
      const app = express();
      app.use('/api/ogc', router);
      return new Promise<void>((resolve) => {
        server = app.listen(0, () => {
          port = server.address().port;
          resolve();
        });
      });
    };

    const stopServer = (): Promise<void> => {
      return new Promise<void>((resolve) => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    };

    it('verifies conformance class includes Part 2 CRS profile when crsTransformer is active', async () => {
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://localhost:9000/api/ogc',
        crsTransformer: CrsTransformer
      });
      await startServer(router);

      const res = await fetch(`http://localhost:${port}/api/ogc/conformance`);
      const data: any = await res.json();
      
      expect(data.conformsTo).toContain('http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core');
      expect(data.conformsTo).toContain('http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs');

      await stopServer();
    });

    it('verifies collection metadata exposes crs list and storageCRS', async () => {
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://localhost:9000/api/ogc',
        crsTransformer: CrsTransformer
      });
      await startServer(router);

      const res = await fetch(`http://localhost:${port}/api/ogc/collections/forests`);
      const data: any = await res.json();

      expect(data.crs).toContain('http://www.opengis.net/def/crs/OGC/1.3/CRS84');
      expect(data.crs).toContain('http://www.opengis.net/def/crs/EPSG/0/3006');
      expect(data.storageCRS).toBe('http://www.opengis.net/def/crs/OGC/1.3/CRS84');

      await stopServer();
    });

    it('reprojects collection items dynamically using the crs parameter', async () => {
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://localhost:9000/api/ogc',
        crsTransformer: CrsTransformer
      });
      await startServer(router);

      // Request items reprojected to Swedish SWEREF 99 TM
      const res = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?crs=http://www.opengis.net/def/crs/EPSG/0/3006`);
      const data: any = await res.json();

      expect(data.type).toBe('FeatureCollection');
      expect(data.crs).toBe('http://www.opengis.net/def/crs/EPSG/0/3006');
      
      const feature = data.features[0];
      expect(feature.id).toBe('forests_forest1');
      
      // [15.5, 60.5] in EPSG:4326 should transform to [527467, 6707201] (rounded)
      const coords = feature.geometry.coordinates;
      expect(Math.round(coords[0])).toBe(527467);
      expect(Math.round(coords[1])).toBe(6707201);

      await stopServer();
    });

    it('reprojects bounding box queries dynamically using bbox-crs', async () => {
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://localhost:9000/api/ogc',
        crsTransformer: CrsTransformer
      });
      await startServer(router);

      // Bounding box supplied in SWEREF 99 TM (EPSG:3006). Greenwood forest is at [527467, 6707201].
      // We search a small box around it: [527400, 6707100, 527500, 6707300]
      const res = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=527400,6707100,527500,6707300&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/3006`);
      const data: any = await res.json();

      expect(data.features.length).toBe(1);
      expect(data.features[0].id).toBe('forests_forest1');

      await stopServer();
    });
  });
});
