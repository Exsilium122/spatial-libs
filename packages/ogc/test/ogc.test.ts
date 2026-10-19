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

class CapturingMockForestProvider implements SpatialDataProvider {
  public capturedQueries: any[] = [];
  public lastFilterQuery: any = undefined;

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
    this.capturedQueries.push(filterQuery);
    this.lastFilterQuery = filterQuery;
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

  reset(): void {
    this.capturedQueries = [];
    this.lastFilterQuery = undefined;
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

  describe('OGC Native and Transformed BBOX Filtering (#15)', () => {
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

    it('parses and passes ?bbox=10,50,12,52 to provider in native mode (without crsTransformer)', async () => {
      const capturingProvider = new CapturingMockForestProvider();
      const nativeRouter = createOgcRouter({
        provider: capturingProvider,
        baseUrl: 'http://localhost:9000/api/ogc'
      });
      await startServer(nativeRouter);

      const res = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.type).toBe('FeatureCollection');
      expect(capturingProvider.capturedQueries.length).toBe(1);
      const nativeQuery = capturingProvider.lastFilterQuery;
      expect(nativeQuery['geo.coordinates']).toEqual({
        $geoWithin: {
          $geometry: {
            type: 'Polygon',
            coordinates: [[
              [10, 50],
              [12, 50],
              [12, 52],
              [10, 52],
              [10, 50]
            ]]
          }
        }
      });

      await stopServer();

      // Compare with router configured with crsTransformer and bbox-crs EPSG:4326
      const transformerProvider = new CapturingMockForestProvider();
      const transformerRouter = createOgcRouter({
        provider: transformerProvider,
        baseUrl: 'http://localhost:9000/api/ogc',
        crsTransformer: CrsTransformer
      });
      await startServer(transformerRouter);

      const resTransformed = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52&bbox-crs=EPSG:4326`);
      expect(resTransformed.status).toBe(200);
      expect(transformerProvider.capturedQueries.length).toBe(1);
      const transformerQuery = transformerProvider.lastFilterQuery;

      expect(nativeQuery).toEqual(transformerQuery);

      await stopServer();
    });

    it('transforms non-WGS84 bbox-crs to EPSG:4326 when crsTransformer is present', async () => {
      const capturingProvider = new CapturingMockForestProvider();
      const router = createOgcRouter({
        provider: capturingProvider,
        baseUrl: 'http://localhost:9000/api/ogc',
        crsTransformer: CrsTransformer
      });
      await startServer(router);

      // SWEREF 99 TM coordinates around Greenwood forest [15.5, 60.5] (~[527467, 6707201])
      const res = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=527400,6707100,527500,6707300&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/3006`);
      expect(res.status).toBe(200);
      expect(capturingProvider.capturedQueries.length).toBe(1);
      const query = capturingProvider.lastFilterQuery;
      expect(query['geo.coordinates']).toBeDefined();
      expect(query['geo.coordinates'].$geoWithin.$geometry.type).toBe('Polygon');
      const ring = query['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
      // Transformed coordinates should be in WGS84 around [15.5, 60.5]
      expect(ring[0][0]).toBeGreaterThan(15.4);
      expect(ring[0][0]).toBeLessThan(15.6);
      expect(ring[0][1]).toBeGreaterThan(60.4);
      expect(ring[0][1]).toBeLessThan(60.6);

      await stopServer();
    });

    it('rejects unsupported bbox-crs without crsTransformer with a 400 JSON error', async () => {
      const capturingProvider = new CapturingMockForestProvider();
      const router = createOgcRouter({
        provider: capturingProvider,
        baseUrl: 'http://localhost:9000/api/ogc'
      });
      await startServer(router);

      // Non-WGS84 EPSG:3006 URI
      const res1 = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/3006`);
      expect(res1.status).toBe(400);
      const data1: any = await res1.json();
      expect(data1.error).toContain('Unsupported bbox-crs requested');
      expect(capturingProvider.capturedQueries.length).toBe(0);

      // Non-WGS84 EPSG:3857 code
      const res2 = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52&bbox-crs=EPSG:3857`);
      expect(res2.status).toBe(400);
      const data2: any = await res2.json();
      expect(data2.error).toContain('Unsupported bbox-crs requested');
      expect(capturingProvider.capturedQueries.length).toBe(0);

      await stopServer();
    });

    it('accepts CRS84 URI and EPSG:4326 forms without crsTransformer', async () => {
      const capturingProvider = new CapturingMockForestProvider();
      const router = createOgcRouter({
        provider: capturingProvider,
        baseUrl: 'http://localhost:9000/api/ogc'
      });
      await startServer(router);

      // CRS84 OGC URI
      const res1 = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52&bbox-crs=http://www.opengis.net/def/crs/OGC/1.3/CRS84`);
      expect(res1.status).toBe(200);
      expect(capturingProvider.capturedQueries.length).toBe(1);

      // EPSG:4326 shortcode
      const res2 = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52&bbox-crs=EPSG:4326`);
      expect(res2.status).toBe(200);
      expect(capturingProvider.capturedQueries.length).toBe(2);

      // EPSG:4326 URI
      const res3 = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/4326`);
      expect(res3.status).toBe(200);
      expect(capturingProvider.capturedQueries.length).toBe(3);

      // CRS84 shortcode
      const res4 = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52&bbox-crs=CRS84`);
      expect(res4.status).toBe(200);
      expect(capturingProvider.capturedQueries.length).toBe(4);

      await stopServer();
    });

    it('rejects malformed bbox parameters with a 400 JSON error', async () => {
      const capturingProvider = new CapturingMockForestProvider();
      const router = createOgcRouter({
        provider: capturingProvider,
        baseUrl: 'http://localhost:9000/api/ogc'
      });
      await startServer(router);

      // 1. Wrong count: fewer than 4 numbers (3 values)
      const resCountLess = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12`);
      expect(resCountLess.status).toBe(400);
      const dataCountLess: any = await resCountLess.json();
      expect(dataCountLess.error).toContain('Malformed bbox parameter');

      // 2. Wrong count: more than 4 numbers (5 values)
      const resCountMore = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,50,12,52,60`);
      expect(resCountMore.status).toBe(400);
      const dataCountMore: any = await resCountMore.json();
      expect(dataCountMore.error).toContain('Malformed bbox parameter');

      // 3. Non-numeric value
      const resNonNumeric = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,foo,12,52`);
      expect(resNonNumeric.status).toBe(400);
      const dataNonNumeric: any = await resNonNumeric.json();
      expect(dataNonNumeric.error).toContain('Malformed bbox parameter');

      // 4. NaN value
      const resNaN = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,NaN,12,52`);
      expect(resNaN.status).toBe(400);
      const dataNaN: any = await resNaN.json();
      expect(dataNaN.error).toContain('Malformed bbox parameter');

      // 5. minLat > maxLat
      const resInvertedLat = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,52,12,50`);
      expect(resInvertedLat.status).toBe(400);
      const dataInvertedLat: any = await resInvertedLat.json();
      expect(dataInvertedLat.error).toContain('Malformed bbox parameter');
      expect(dataInvertedLat.error).toContain('minLat');

      // 6. Empty bbox
      const resEmpty = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=`);
      expect(resEmpty.status).toBe(400);
      const dataEmpty: any = await resEmpty.json();
      expect(dataEmpty.error).toContain('Malformed bbox parameter');

      // Verify provider was never queried during failed requests
      expect(capturingProvider.capturedQueries.length).toBe(0);

      await stopServer();
    });

    it('rejects malformed bbox even when crsTransformer is configured', async () => {
      const capturingProvider = new CapturingMockForestProvider();
      const router = createOgcRouter({
        provider: capturingProvider,
        baseUrl: 'http://localhost:9000/api/ogc',
        crsTransformer: CrsTransformer
      });
      await startServer(router);

      const res = await fetch(`http://localhost:${port}/api/ogc/collections/forests/items?bbox=10,notanumber,12,52`);
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain('Malformed bbox parameter');
      expect(capturingProvider.capturedQueries.length).toBe(0);

      await stopServer();
    });
  });
});
