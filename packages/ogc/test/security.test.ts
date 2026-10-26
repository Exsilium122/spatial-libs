import { describe, it, expect, vi } from 'vitest';
import CrsTransformer from '../../crs/src/index.js';
import express from 'express';
import http from 'http';
import createOgcRouter from '../src/index.js';
import {
  SpatialDataProvider,
  GeoJSONFeature,
  BoundingBox,
  FeatureQueryOptions,
  Logger
} from '../src/types.js';

function makeRequest(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let body = rawData;
          try {
            body = JSON.parse(rawData);
          } catch {
            // Keep as string if not valid JSON
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function startServer(router: express.Router, mountPath = '/api/ogc'): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(mountPath, router);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      resolve({ server, port: address.port });
    });
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('OGC API Security & Hardening (@spatial-api/ogc)', () => {
  describe('1. NoSQL injection defense via ?name= (#5)', () => {
    class TrackingForestProvider implements SpatialDataProvider {
      getFeaturesCalled = false;
      lastFilterQuery: any = null;

      async getSupportedTypes(): Promise<string[]> {
        return ['forests'];
      }
      async getBoundingBox(): Promise<BoundingBox> {
        return { minLon: 10, minLat: 50, maxLon: 20, maxLat: 60 };
      }
      async getFeatures(
        _context: any,
        _featureType: string,
        _fids?: string[],
        filterQuery?: any
      ): Promise<GeoJSONFeature[]> {
        this.getFeaturesCalled = true;
        this.lastFilterQuery = filterQuery;
        return [
          {
            id: 'f1',
            geometry: { type: 'Point', coordinates: [15, 55] },
            properties: { name: 'Oak' }
          }
        ];
      }
    }

    it('rejects nested query objects like ?name[$ne]=null with HTTP 400 and does not call provider', async () => {
      const provider = new TrackingForestProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/forests/items?name[$ne]=null');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Invalid "name" parameter: expected a single string value.'
      });
      expect(provider.getFeaturesCalled).toBe(false);

      await stopServer(server);
    });

    it('rejects array query values like ?name=a&name=b with HTTP 400 and does not call provider', async () => {
      const provider = new TrackingForestProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/forests/items?name=a&name=b');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Invalid "name" parameter: expected a single string value.'
      });
      expect(provider.getFeaturesCalled).toBe(false);

      await stopServer(server);
    });

    it('accepts valid string ?name=Oak and passes it to the provider filterQuery', async () => {
      const provider = new TrackingForestProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/forests/items?name=Oak');
      expect(res.status).toBe(200);
      expect(provider.getFeaturesCalled).toBe(true);
      expect(provider.lastFilterQuery).toEqual({ name: 'Oak' });
      expect(res.body.features.length).toBe(1);

      // Verify self link preserves valid name parameter
      const selfLink = res.body.links.find((l: any) => l.rel === 'self');
      expect(selfLink.href).toContain('name=Oak');

      await stopServer(server);
    });

    it('prevents prototype pollution and object serialization in link builders', async () => {
      const provider = new TrackingForestProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(
        port,
        '/api/ogc/collections/forests/items?other[key]=value&__proto__[polluted]=true'
      );
      expect(res.status).toBe(200);

      const selfLink = res.body.links.find((l: any) => l.rel === 'self');
      expect(selfLink.href).not.toContain('[object Object]');
      expect(selfLink.href).not.toContain('polluted');
      expect((Object.prototype as any).polluted).toBeUndefined();

      await stopServer(server);
    });
  });

  describe('2. Database-level pagination & countFeatures (#6, D03)', () => {
    class PaginationAwareProvider implements SpatialDataProvider {
      lastOptions?: FeatureQueryOptions;
      lastFilterQuery?: any;

      async getSupportedTypes(): Promise<string[]> {
        return ['parcels'];
      }
      async getBoundingBox(): Promise<BoundingBox> {
        return { minLon: 0, minLat: 0, maxLon: 10, maxLat: 10 };
      }
      async getFeatures(
        _context: any,
        _featureType: string,
        _fids?: string[],
        filterQuery?: any,
        options?: FeatureQueryOptions
      ): Promise<GeoJSONFeature[]> {
        this.lastOptions = options;
        this.lastFilterQuery = filterQuery;
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? 10;
        return Array.from({ length: limit }, (_, i) => ({
          id: `p-${offset + i}`,
          geometry: { type: 'Point', coordinates: [1, 1] },
          properties: { idx: offset + i }
        }));
      }
      async countFeatures(_context: any, _featureType: string, _filterQuery?: any): Promise<number> {
        return 100;
      }
    }

    it('passes { limit: 10, offset: 20 } as 5th argument, uses countFeatures for numberMatched, and builds correct next/prev links', async () => {
      const provider = new PaginationAwareProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/parcels/items?limit=10&offset=20');
      expect(res.status).toBe(200);

      // Verify 5th argument received by pagination-aware provider
      expect(provider.lastOptions).toEqual({ limit: 10, offset: 20 });

      // Verify envelope counts
      expect(res.body.features.length).toBe(10);
      expect(res.body.numberReturned).toBe(10);
      expect(res.body.numberMatched).toBe(100);

      // Verify links
      const nextLink = res.body.links.find((l: any) => l.rel === 'next');
      const prevLink = res.body.links.find((l: any) => l.rel === 'prev');
      expect(nextLink).toBeDefined();
      expect(nextLink.href).toContain('limit=10');
      expect(nextLink.href).toContain('offset=30');

      expect(prevLink).toBeDefined();
      expect(prevLink.href).toContain('limit=10');
      expect(prevLink.href).toContain('offset=10');

      await stopServer(server);
    });

    it('defensively slices features to limit if provider returns more than limit', async () => {
      class GenerousProvider extends PaginationAwareProvider {
        override async getFeatures(): Promise<GeoJSONFeature[]> {
          // Provider ignores limit and returns 25 items
          return Array.from({ length: 25 }, (_, i) => ({
            id: `p-${i}`,
            geometry: { type: 'Point', coordinates: [1, 1] },
            properties: { idx: i }
          }));
        }
      }

      const provider = new GenerousProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/parcels/items?limit=10&offset=0');
      expect(res.status).toBe(200);
      expect(res.body.features.length).toBe(10);
      expect(res.body.numberReturned).toBe(10);

      await stopServer(server);
    });

    it('rejects invalid limit with 400 and caps large limit to maxLimit', async () => {
      const provider = new PaginationAwareProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc',
        defaultLimit: 25,
        maxLimit: 100
      });
      const { server, port } = await startServer(router);

      // Negative values
      const res1 = await makeRequest(port, '/api/ogc/collections/parcels/items?limit=-5&offset=-10');
      expect(res1.status).toBe(400);

      // Non-numeric strings
      const res2 = await makeRequest(port, '/api/ogc/collections/parcels/items?limit=abc&offset=xyz');
      expect(res2.status).toBe(400);

      // Capped at maxLimit
      const res3 = await makeRequest(port, '/api/ogc/collections/parcels/items?limit=500&offset=0');
      expect(res3.status).toBe(200);
      expect(provider.lastOptions).toEqual({ limit: 100, offset: 0 });

      await stopServer(server);
    });
  });

  describe('3. Legacy provider backward compatibility', () => {
    class LegacyForestProvider implements SpatialDataProvider {
      lastOptions?: FeatureQueryOptions;

      async getSupportedTypes(): Promise<string[]> {
        return ['woods'];
      }
      async getBoundingBox(): Promise<BoundingBox> {
        return { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
      }
      async getFeatures(
        _context: any,
        _featureType: string,
        _fids?: string[],
        _filterQuery?: any,
        options?: FeatureQueryOptions
      ): Promise<GeoJSONFeature[]> {
        this.lastOptions = options;
        // Legacy provider returns all 30 features
        return Array.from({ length: 30 }, (_, i) => ({
          id: `w-${i}`,
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { idx: i }
        }));
      }
      // countFeatures is deliberately NOT implemented
    }

    it('paginates in memory, withholds the 5th arg (no double offset), and logs warning exactly once per router', async () => {
      const mockLogger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      const provider = new LegacyForestProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc',
        logger: mockLogger
      });
      const { server, port } = await startServer(router);

      // First query
      const res1 = await makeRequest(port, '/api/ogc/collections/woods/items?limit=5&offset=10');
      expect(res1.status).toBe(200);
      expect(provider.lastOptions).toBeUndefined();
      expect(res1.body.numberMatched).toBe(30);
      expect(res1.body.numberReturned).toBe(5);
      expect(res1.body.features.length).toBe(5);
      expect(res1.body.features[0].id).toBe('woods_w-10');

      // Verify logger.warn was called once for countFeatures recommendation
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      const warnMsg = (mockLogger.warn as any).mock.calls[0][0];
      expect(warnMsg).toContain('countFeatures');

      // Second query on same router
      const res2 = await makeRequest(port, '/api/ogc/collections/woods/items?limit=5&offset=15');
      expect(res2.status).toBe(200);
      expect(res2.body.features[0].id).toBe('woods_w-15');

      // Warning must still have been called only once
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);

      await stopServer(server);
    });
  });

  describe('4. Host header poisoning protection (#7, D04)', () => {
    class DummyProvider implements SpatialDataProvider {
      async getSupportedTypes(): Promise<string[]> {
        return ['sites'];
      }
      async getBoundingBox(): Promise<BoundingBox> {
        return { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
      }
      async getFeatures(): Promise<GeoJSONFeature[]> {
        return [
          {
            id: '1',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {}
          }
        ];
      }
    }

    it('always uses absolute baseUrl verbatim and ignores untrusted Host header', async () => {
      const router = createOgcRouter({
        provider: new DummyProvider(),
        baseUrl: 'https://api.example.com/ogc'
      });
      const { server, port } = await startServer(router, '/ogc');

      const res = await makeRequest(port, '/ogc/collections', {
        headers: { Host: 'attacker.com' }
      });
      expect(res.status).toBe(200);

      // All links must start with https://api.example.com/ogc
      const links = res.body.links;
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.href.startsWith('https://api.example.com/ogc')).toBe(true);
        expect(link.href).not.toContain('attacker.com');
      }

      await stopServer(server);
    });

    it('with relative baseUrl and trustedHosts, reflects allowed host but falls back to path-relative for untrusted host', async () => {
      const router = createOgcRouter({
        provider: new DummyProvider(),
        baseUrl: '/ogc',
        trustedHosts: ['api.example.com', 'localhost:3000', '[::1]:3000']
      });
      const { server, port } = await startServer(router, '/ogc');

      // Untrusted host: attacker.com
      const resUntrusted = await makeRequest(port, '/ogc/collections/sites/items', {
        headers: { Host: 'attacker.com' }
      });
      expect(resUntrusted.status).toBe(200);
      const untrustedLinks = resUntrusted.body.links;
      for (const link of untrustedLinks) {
        expect(link.href).not.toContain('attacker.com');
        // Path-relative fallback starting with /ogc
        expect(link.href.startsWith('/ogc')).toBe(true);
      }

      // Trusted host: api.example.com
      const resTrusted = await makeRequest(port, '/ogc/collections/sites/items', {
        headers: { Host: 'api.example.com' }
      });
      expect(resTrusted.status).toBe(200);
      const trustedLinks = resTrusted.body.links;
      for (const link of trustedLinks) {
        expect(link.href.startsWith('http://api.example.com/ogc')).toBe(true);
      }

      // Trusted host with case-insensitivity: API.EXAMPLE.COM
      const resCase = await makeRequest(port, '/ogc/collections/sites/items', {
        headers: { Host: 'API.EXAMPLE.COM' }
      });
      expect(resCase.status).toBe(200);
      const caseLinks = resCase.body.links;
      for (const link of caseLinks) {
        expect(link.href.startsWith('http://API.EXAMPLE.COM/ogc')).toBe(true);
      }

      // Trusted bracketed IPv6 host: [::1]:3000
      const resIpv6 = await makeRequest(port, '/ogc/collections/sites/items', {
        headers: { Host: '[::1]:3000' }
      });
      expect(resIpv6.status).toBe(200);
      const ipv6Links = resIpv6.body.links;
      for (const link of ipv6Links) {
        expect(link.href.startsWith('http://[::1]:3000/ogc')).toBe(true);
      }

      await stopServer(server);
    });

    it('rejects malformed Host headers (evil.com/x, a@b) without trustedHosts and falls back to path-relative', async () => {
      const router = createOgcRouter({
        provider: new DummyProvider(),
        baseUrl: '/ogc'
      });
      const { server, port } = await startServer(router, '/ogc');

      // Malformed host with slash
      const res1 = await makeRequest(port, '/ogc/collections', {
        headers: { Host: 'evil.com/x' }
      });
      expect(res1.status).toBe(200);
      for (const link of res1.body.links) {
        expect(link.href).not.toContain('evil.com');
        expect(link.href.startsWith('/ogc')).toBe(true);
      }

      // Malformed host with at-sign
      const res2 = await makeRequest(port, '/ogc/collections', {
        headers: { Host: 'a@b' }
      });
      expect(res2.status).toBe(200);
      for (const link of res2.body.links) {
        expect(link.href).not.toContain('a@b');
        expect(link.href.startsWith('/ogc')).toBe(true);
      }

      await stopServer(server);
    });

    it('when baseUrl is relative and trustedHosts is not configured, does not reflect arbitrary client Host headers and fails closed to relative paths', async () => {
      const router = createOgcRouter({
        provider: new DummyProvider(),
        baseUrl: '/ogc'
      });
      const { server, port } = await startServer(router, '/ogc');

      const res = await makeRequest(port, '/ogc/collections', {
        headers: { Host: 'attacker.com' }
      });
      expect(res.status).toBe(200);
      for (const link of res.body.links) {
        expect(link.href).not.toContain('attacker.com');
        expect(link.href.startsWith('/ogc')).toBe(true);
      }

      const res2 = await makeRequest(port, '/ogc', {
        headers: { Host: 'attacker.com' }
      });
      expect(res2.status).toBe(200);
      for (const link of res2.body.links) {
        expect(link.href).not.toContain('attacker.com');
        expect(link.href.startsWith('/ogc')).toBe(true);
      }

      await stopServer(server);
    });

    it('emits a warning at router creation when relative baseUrl is used without trustedHosts', () => {
      const mockLogger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      // Relative baseUrl without trustedHosts -> should warn
      createOgcRouter({
        provider: new DummyProvider(),
        baseUrl: '/ogc',
        logger: mockLogger
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Relative baseUrl configured without trustedHosts')
      );

      // Relative baseUrl with trustedHosts -> should not warn about host poisoning
      const mockLogger2: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };
      createOgcRouter({
        provider: new DummyProvider(),
        baseUrl: '/ogc',
        trustedHosts: ['api.example.com'],
        logger: mockLogger2
      });
      expect(mockLogger2.warn).not.toHaveBeenCalled();

      // Absolute baseUrl without trustedHosts -> should not warn
      const mockLogger3: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };
      createOgcRouter({
        provider: new DummyProvider(),
        baseUrl: 'https://api.example.com/ogc',
        logger: mockLogger3
      });
      expect(mockLogger3.warn).not.toHaveBeenCalled();
    });
  });

  describe('6. CRS parameter validation and injection hardening', () => {
    class CrsSecurityProvider implements SpatialDataProvider {
      getFeaturesCalled = false;
      lastFilterQuery: any = null;

      async getSupportedTypes(): Promise<string[]> {
        return ['forests'];
      }
      async getBoundingBox(): Promise<BoundingBox> {
        return { minLon: 10, minLat: 50, maxLon: 20, maxLat: 60 };
      }
      async getFeatures(
        _context: any,
        _featureType: string,
        _fids?: string[],
        filterQuery?: any
      ): Promise<GeoJSONFeature[]> {
        this.getFeaturesCalled = true;
        this.lastFilterQuery = filterQuery;
        return [
          {
            id: 'f1',
            geometry: { type: 'Point', coordinates: [15, 55] },
            properties: { name: 'Oak' }
          }
        ];
      }
    }

    it('rejects CRLF and trailing garbage in crs parameter with 400 not 500', async () => {
      const provider = new CrsSecurityProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc',
        crsTransformer: CrsTransformer
      });
      const { server, port } = await startServer(router);

      // Trailing header injection attempt
      const res1 = await makeRequest(port, '/api/ogc/collections/forests/items?crs=http://www.opengis.net/def/crs/EPSG/0/4326%0D%0AX-Evil:%201');
      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain('Unsupported crs requested');
      expect(provider.getFeaturesCalled).toBe(false);

      // Trailing characters on single feature
      const res2 = await makeRequest(port, '/api/ogc/collections/forests/items/forests_f1?crs=http://www.opengis.net/def/crs/EPSG/0/4326%0D%0AX-Evil:%201');
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('Unsupported crs requested');

      // Valid CRS emits canonical URI in Content-Crs and does not echo raw input with headers
      const res3 = await makeRequest(port, '/api/ogc/collections/forests/items?crs=http://www.opengis.net/def/crs/EPSG/0/3006');
      expect(res3.status).toBe(200);
      expect(res3.headers['content-crs']).toBe('<http://www.opengis.net/def/crs/EPSG/0/3006>');
      expect(res3.body.crs).toBe('http://www.opengis.net/def/crs/EPSG/0/3006');

      await stopServer(server);
    });

    it('rejects duplicated crs parameter with 400', async () => {
      const provider = new CrsSecurityProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc',
        crsTransformer: CrsTransformer
      });
      const { server, port } = await startServer(router);

      // Collection items
      const res1 = await makeRequest(port, '/api/ogc/collections/forests/items?crs=EPSG:3006&crs=EPSG:4326');
      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain('Malformed crs parameter: duplicate parameters are not allowed.');
      expect(provider.getFeaturesCalled).toBe(false);

      // Single feature
      const res2 = await makeRequest(port, '/api/ogc/collections/forests/items/forests_f1?crs=EPSG:3006&crs=EPSG:4326');
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('Malformed crs parameter: duplicate parameters are not allowed.');

      await stopServer(server);
    });

    it('triggers lat/lon axis swap for versioned 4326 URL', async () => {
      const provider = new CrsSecurityProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc',
        crsTransformer: CrsTransformer
      });
      const { server, port } = await startServer(router);

      // Collection items: original point is [15, 55] (lon, lat) -> swapped to [55, 15] (lat, lon)
      const res1 = await makeRequest(port, '/api/ogc/collections/forests/items?crs=http://www.opengis.net/def/crs/EPSG/9.9.1/4326');
      expect(res1.status).toBe(200);
      expect(res1.body.features[0].geometry.coordinates).toEqual([55, 15]);
      expect(res1.headers['content-crs']).toBe('<http://www.opengis.net/def/crs/EPSG/0/4326>');
      expect(res1.body.crs).toBe('http://www.opengis.net/def/crs/EPSG/0/4326');

      // Single feature: point is swapped to [55, 15]
      const res2 = await makeRequest(port, '/api/ogc/collections/forests/items/forests_f1?crs=http://www.opengis.net/def/crs/EPSG/9.9.1/4326');
      expect(res2.status).toBe(200);
      expect(res2.body.geometry.coordinates).toEqual([55, 15]);
      expect(res2.headers['content-crs']).toBe('<http://www.opengis.net/def/crs/EPSG/0/4326>');

      await stopServer(server);
    });

    it('does not treat EPSG/0/43260 as 4326 and rejects it with 400', async () => {
      const provider = new CrsSecurityProvider();
      const router = createOgcRouter({
        provider,
        baseUrl: 'http://127.0.0.1/api/ogc',
        crsTransformer: CrsTransformer
      });
      const { server, port } = await startServer(router);

      const res1 = await makeRequest(port, '/api/ogc/collections/forests/items?crs=http://www.opengis.net/def/crs/EPSG/0/43260');
      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain('Unsupported crs requested');
      expect(provider.getFeaturesCalled).toBe(false);

      const res2 = await makeRequest(port, '/api/ogc/collections/forests/items?crs=EPSG/0/43260');
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('Unsupported crs requested');
      expect(provider.getFeaturesCalled).toBe(false);

      const res3 = await makeRequest(port, '/api/ogc/collections/forests/items/forests_f1?crs=http://www.opengis.net/def/crs/EPSG/0/43260');
      expect(res3.status).toBe(400);
      expect(res3.body.error).toContain('Unsupported crs requested');

      await stopServer(server);
    });
  });

  describe('5. Router error handling (HTTP 500 standardized JSON response)', () => {
    class FailingProvider implements SpatialDataProvider {
      async getSupportedTypes(): Promise<string[]> {
        return ['sites'];
      }
      async getBoundingBox(): Promise<BoundingBox> {
        throw new Error('Database connection failed in getBoundingBox');
      }
      async getFeatures(_ctx: any, _col: string, fids?: string[]): Promise<GeoJSONFeature[]> {
        if (fids && fids.length > 0) {
          throw new Error('Database query timeout in single feature getFeatures');
        }
        throw new Error('Database query timeout in getFeatures');
      }
    }

    it('returns standardized status 500 JSON and logs error on /collections failure', async () => {
      class CollectionsFailingProvider extends FailingProvider {
        override async getSupportedTypes(): Promise<string[]> {
          throw new Error('Failed to fetch supported types');
        }
      }
      const mockLogger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const router = createOgcRouter({
        provider: new CollectionsFailingProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc',
        logger: mockLogger
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(mockLogger.error).toHaveBeenCalled();

      await stopServer(server);
    });

    it('returns standardized status 500 JSON and logs error on /collections/:collectionId failure', async () => {
      const mockLogger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const router = createOgcRouter({
        provider: new FailingProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc',
        logger: mockLogger
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/sites');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(mockLogger.error).toHaveBeenCalled();

      await stopServer(server);
    });

    it('returns standardized status 500 JSON and logs error on /collections/:collectionId/items failure', async () => {
      const mockLogger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const router = createOgcRouter({
        provider: new FailingProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc',
        logger: mockLogger
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/sites/items');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(mockLogger.error).toHaveBeenCalled();

      await stopServer(server);
    });

    it('returns standardized status 500 JSON and logs error on /collections/:collectionId/items/:featureId failure', async () => {
      const mockLogger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const router = createOgcRouter({
        provider: new FailingProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc',
        logger: mockLogger
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/sites/items/sites_1');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(mockLogger.error).toHaveBeenCalled();

      await stopServer(server);
    });
  });

  describe('7. Query parameter primitive string assertions and object rejection', () => {
    class ParamTestProvider implements SpatialDataProvider {
      async getSupportedTypes(): Promise<string[]> {
        return ['places'];
      }
      async getBoundingBox(): Promise<BoundingBox> {
        return { minLon: 0, minLat: 0, maxLon: 10, maxLat: 10 };
      }
      async getFeatures(): Promise<GeoJSONFeature[]> {
        return [
          {
            id: '1',
            geometry: { type: 'Point', coordinates: [1, 1] },
            properties: { name: 'Test' }
          }
        ];
      }
    }

    it('rejects nested query objects in limit with HTTP 400', async () => {
      const router = createOgcRouter({
        provider: new ParamTestProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/places/items?limit[gt]=10');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid "limit" parameter: expected a single string value.' });

      await stopServer(server);
    });

    it('rejects nested query objects and invalid values in offset and startindex with HTTP 400', async () => {
      const router = createOgcRouter({
        provider: new ParamTestProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      // Object in offset
      const res1 = await makeRequest(port, '/api/ogc/collections/places/items?offset[ne]=1');
      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: 'Invalid "offset" parameter: expected a single string value.' });

      // Negative offset
      const res2 = await makeRequest(port, '/api/ogc/collections/places/items?offset=-5');
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('Invalid offset parameter');

      // Object in startindex
      const res3 = await makeRequest(port, '/api/ogc/collections/places/items?startindex[ne]=1');
      expect(res3.status).toBe(400);
      expect(res3.body).toEqual({ error: 'Invalid "startindex" parameter: expected a single string value.' });

      // Negative startindex
      const res4 = await makeRequest(port, '/api/ogc/collections/places/items?startindex=-1');
      expect(res4.status).toBe(400);
      expect(res4.body.error).toContain('Invalid startindex parameter');

      await stopServer(server);
    });

    it('rejects nested query objects in crs on items and items/:featureId with HTTP 400', async () => {
      const router = createOgcRouter({
        provider: new ParamTestProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc',
        crsTransformer: CrsTransformer
      });
      const { server, port } = await startServer(router);

      const res1 = await makeRequest(port, '/api/ogc/collections/places/items?crs[evil]=test');
      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: 'Invalid "crs" parameter: expected a single string value.' });

      const res2 = await makeRequest(port, '/api/ogc/collections/places/items/places_1?crs[evil]=test');
      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: 'Invalid "crs" parameter: expected a single string value.' });

      await stopServer(server);
    });

    it('rejects nested query objects in bbox and bbox-crs with HTTP 400', async () => {
      const router = createOgcRouter({
        provider: new ParamTestProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc',
        crsTransformer: CrsTransformer
      });
      const { server, port } = await startServer(router);

      const res1 = await makeRequest(port, '/api/ogc/collections/places/items?bbox[evil]=0,0,1,1');
      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: 'Invalid "bbox" parameter: expected a single string value.' });

      const res2 = await makeRequest(port, '/api/ogc/collections/places/items?bbox=0,0,1,1&bbox-crs[evil]=4326');
      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: 'Invalid "bbox-crs" parameter: expected a single string value.' });

      await stopServer(server);
    });

    it('rejects nested query objects in datetime with HTTP 400', async () => {
      const router = createOgcRouter({
        provider: new ParamTestProvider(),
        baseUrl: 'http://127.0.0.1/api/ogc'
      });
      const { server, port } = await startServer(router);

      const res = await makeRequest(port, '/api/ogc/collections/places/items?datetime[gt]=2020-01-01');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid "datetime" parameter: expected a single string value.' });

      await stopServer(server);
    });
  });
});
