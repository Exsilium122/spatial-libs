import { it } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import createOgcRouter from '../../src/index.js';
import { FeatureQueryOptions, GeoJSONFeature, OgcOptions, SpatialDataProvider } from '../../src/types.js';

/**
 * Shared fixtures for the standards conformance suites. Every suite drives a real Express server
 * over HTTP, the way an OGC conformance test engine (e.g. OGC TEAM Engine) would.
 */

export const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';

/** Five point features laid out on a diagonal inside the collection extent [10,50,12,52]. */
export function pointFeatures(count = 5): GeoJSONFeature[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i + 1}`,
    geometry: { type: 'Point', coordinates: [10 + (i * 2) / Math.max(count - 1, 1), 50 + (i * 2) / Math.max(count - 1, 1)] },
    properties: { name: `Feature ${i + 1}`, rank: i + 1 },
  }));
}

export class MemoryProvider implements SpatialDataProvider {
  calls: { featureType: string; fids?: string[]; filterQuery?: any; options?: FeatureQueryOptions }[] = [];

  constructor(public collections: Record<string, GeoJSONFeature[]> = { forests: pointFeatures() }) {}

  async getSupportedTypes(): Promise<string[]> {
    return Object.keys(this.collections);
  }

  async getBoundingBox() {
    return { minLon: 10, minLat: 50, maxLon: 12, maxLat: 52 };
  }

  async getFeatures(context: any, featureType: string, fids?: string[], filterQuery?: any, options?: FeatureQueryOptions) {
    this.calls.push({ featureType, fids, filterQuery, options });
    let all = structuredClone(this.collections[featureType] || []);
    if (fids && fids.length > 0) all = all.filter((f) => fids.includes(String(f.id)));
    if (!options) return all;
    const offset = options.offset ?? 0;
    return all.slice(offset, offset + (options.limit ?? all.length));
  }

  async countFeatures(context: any, featureType: string) {
    return (this.collections[featureType] || []).length;
  }

  lastCall() {
    return this.calls[this.calls.length - 1];
  }
}

export async function startOgc(options: Partial<OgcOptions> & { provider: SpatialDataProvider }) {
  const app = express();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ogc`;
  app.use('/ogc', createOgcRouter({ baseUrl: root, ...options }));

  return {
    root,
    async get(path: string, headers: Record<string, string> = {}) {
      return fetch(`${root}${path}`, { headers });
    },
    async json(path: string) {
      const res = await fetch(`${root}${path}`);
      return { res, body: (await res.json()) as any };
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

export type OgcServer = Awaited<ReturnType<typeof startOgc>>;

/**
 * Declares a requirement the library does not meet yet. By default the test must fail
 * (`it.fails`), keeping the suite green while documenting the gap; with CONFORMANCE_STRICT=1
 * it runs as a regular test so the actual non-conformance is reported.
 */
export const gap: typeof it = (process.env.CONFORMANCE_STRICT ? it : it.fails) as typeof it;
