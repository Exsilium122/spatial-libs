import { it } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { XMLParser } from 'fast-xml-parser';
import createWfsRouter from '../../src/index.js';
import { BoundingBox, GeoJSONFeature, SpatialDataProvider, WfsOptions } from '../../src/types.js';

/**
 * Shared fixtures for the WFS / Filter Encoding conformance suites. Every suite drives a real
 * Express server with createWfsRouter mounted, over HTTP (KVP GET and XML POST), the way an
 * OGC conformance test engine would.
 */

/**
 * Declares a requirement the library does not meet yet. By default the test must fail
 * (`it.fails`), keeping the suite green while documenting the gap; with CONFORMANCE_STRICT=1
 * it runs as a regular test so the actual non-conformance is reported.
 */
export const gap: typeof it = (process.env.CONFORMANCE_STRICT ? it : it.fails) as typeof it;

export const FEATURES: Record<string, GeoJSONFeature[]> = {
  trees: [
    { id: 't1', geometry: { type: 'Point', coordinates: [10.5, 50.5] }, properties: { name: 'Oak', height: 12 } },
    { id: 't2', geometry: { type: 'Point', coordinates: [11.5, 51.5] }, properties: { name: 'Pine', height: 30 } },
    { id: 't3', geometry: { type: 'Point', coordinates: [11.8, 51.8] }, properties: { name: 'Birch', height: 8 } },
  ],
  roads: [
    { id: 'r1', geometry: { type: 'LineString', coordinates: [[10.1, 50.1], [10.2, 50.2], [10.3, 50.3]] }, properties: { name: 'Main St' } },
  ],
};

export class RecordingProvider implements SpatialDataProvider {
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
    const all = structuredClone(FEATURES[featureType] || []);
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

  reset() {
    this.calls = [];
    this.failWith = null;
  }
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, isArray: () => false });

/** Parses an XML response body; attributes are prefixed with "@", namespace prefixes are kept. */
export function parseXml(body: string): any {
  return xml.parse(body);
}

/** Lists every value found under `key` anywhere in a parsed XML tree. */
export function findAll(node: any, key: string, out: any[] = []): any[] {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(...(Array.isArray(v) ? v : [v]));
      findAll(v, key, out);
    }
  }
  return out;
}

export async function startWfs(options: Partial<WfsOptions> & { provider: SpatialDataProvider }) {
  const app = express();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wfs`;
  app.use('/wfs', createWfsRouter({ baseUrl: root, ...options }));

  const read = async (res: Response) => {
    const body = await res.text();
    let doc: any = null;
    try {
      doc = parseXml(body);
    } catch {
      // not XML
    }
    return { status: res.status, contentType: res.headers.get('content-type') || '', body, doc };
  };

  return {
    root,
    /** KVP-encoded GET; `query` is the raw query string. */
    async get(query: string) {
      return read(await fetch(`${root}?${query}`));
    },
    /** XML-encoded POST. */
    async post(body: string, contentType = 'text/xml') {
      return read(await fetch(root, { method: 'POST', headers: { 'Content-Type': contentType }, body }));
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

export type WfsServer = Awaited<ReturnType<typeof startWfs>>;
export type WfsResponse = Awaited<ReturnType<WfsServer['get']>>;
