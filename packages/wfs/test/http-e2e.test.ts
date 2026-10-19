import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import createWfsRouter from '../src/index.js';
import { SpatialDataProvider, BoundingBox, GeoJSONFeature, WfsOptions } from '../src/types.js';

/**
 * End-to-end tests of the Express router plumbing: a real server with createWfsRouter mounted,
 * driven over HTTP through the real query normalization and express-xml-bodyparser stack.
 * Protocol behaviour per standard lives in test/conformance/ (WFS 1.0/1.1/2.0, Filter Encoding).
 */

const FEATURES: Record<string, GeoJSONFeature[]> = {
  trees: [
    { id: 't1', geometry: { type: 'Point', coordinates: [10.5, 50.5] }, properties: { name: 'Oak', height: 12 } },
    { id: 't2', geometry: { type: 'Point', coordinates: [11.5, 51.5] }, properties: { name: 'Pine', height: null } },
  ],
  roads: [
    {
      id: 'r1',
      geometry: { type: 'LineString', coordinates: [[10.1, 50.1], [10.2, 50.2], [10.3, 50.3]] },
      properties: { name: 'Main St' },
    },
  ],
};

class RecordingProvider implements SpatialDataProvider {
  calls: { featureType: string; fids?: string[]; filterQuery?: any }[] = [];
  failWith: Error | null = null;

  async getSupportedTypes(): Promise<string[]> {
    return Object.keys(FEATURES);
  }

  async getBoundingBox(): Promise<BoundingBox> {
    return { minLon: 10, minLat: 50, maxLon: 12, maxLat: 52 };
  }

  async getFeatures(context: any, featureType: string, fids?: string[], filterQuery?: any): Promise<GeoJSONFeature[]> {
    this.calls.push({ featureType, fids, filterQuery });
    if (this.failWith) throw this.failWith;
    const all = FEATURES[featureType] || [];
    return fids && fids.length > 0 ? all.filter((f) => fids.includes(String(f.id))) : all;
  }

  async getGeometryType(context: any, featureType: string): Promise<'LineString' | 'Point'> {
    return featureType === 'roads' ? 'LineString' : 'Point';
  }

  async getPropertiesSchema(): Promise<Record<string, 'string' | 'integer' | 'double' | 'boolean'>> {
    return { name: 'string', height: 'integer' };
  }

  lastCall() {
    return this.calls[this.calls.length - 1];
  }
}

function startServer(options: WfsOptions) {
  const app = express();
  app.use('/wfs', createWfsRouter(options));
  const server = http.createServer(app);
  let base = '';
  return {
    async start() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wfs`;
    },
    async stop() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
    get(query: string) {
      return fetch(`${base}?${query}`);
    },
    post(xml: string, contentType = 'text/xml') {
      return fetch(base, { method: 'POST', headers: { 'Content-Type': contentType }, body: xml });
    },
  };
}

const NS = 'xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml"';

describe('WFS end-to-end over HTTP (createWfsRouter + Express)', () => {
  const provider = new RecordingProvider();
  const server = startServer({ provider, baseUrl: 'https://api.example.com/wfs' });

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    provider.calls = [];
    provider.failWith = null;
  });

  describe('GetCapabilities', () => {
    it('reads the version from a POSTed GetCapabilities body', async () => {
      const res = await server.post(`<wfs:GetCapabilities service="WFS" version="1.0.0" ${NS}/>`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<WFS_Capabilities version="1.0.0"');
    });
  });

  describe('XML request bodies', () => {
    it('rejects a malformed XML body with an XML exception report instead of an HTML stack trace', async () => {
      const res = await server.post('<wfs:GetFeature version="1.1.0"><unclosed>');
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('text/xml');
      const body = await res.text();
      expect(body).toContain('code="OperationParsingFailed"');
      expect(body).not.toMatch(/<html|\bat .*\.js:\d+/i);
      expect(provider.calls).toHaveLength(0);
    });
  });

  describe('Errors and version policy', () => {
    it('returns a sanitized exception report when the provider throws', async () => {
      provider.failWith = new Error('connection to db-internal:5432 refused');
      const res = await server.get('service=WFS&request=GetFeature&version=2.0.0&typeName=ns:trees');
      const body = await res.text();
      expect(body).toContain('ExceptionReport');
      expect(body).not.toContain('db-internal');
    });

    it('rejects versions disabled through enabledVersions', async () => {
      const restricted = startServer({ provider, baseUrl: 'https://api.example.com/wfs', enabledVersions: ['2.0.0'] });
      await restricted.start();
      try {
        const res = await restricted.get('service=WFS&request=GetCapabilities&version=1.0.0');
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('VersionNegotiationFailed');
        expect((await restricted.get('service=WFS&request=GetCapabilities&version=2.0.0')).status).toBe(200);
      } finally {
        await restricted.stop();
      }
    });
  });
});
