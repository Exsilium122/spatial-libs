import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import CrsTransformer from '../../../crs/src/index.js';
import { CRS84, gap, MemoryProvider, OgcServer, startOgc } from './helpers.js';

/**
 * OGC API - Features - Part 2: Coordinate Reference Systems by Reference (OGC 18-058r1)
 * https://docs.ogc.org/is/18-058r1/18-058r1.html
 *
 * The CRS and bbox-crs tests formerly in ogc.test.ts ("OGC CRS Part 2 Integration Tests" and the
 * bbox-crs cases of "OGC Native and Transformed BBOX Filtering (#15)") live here now.
 */

const SWEREF99 = 'http://www.opengis.net/def/crs/EPSG/0/3006';
const EPSG4326 = 'http://www.opengis.net/def/crs/EPSG/0/4326';

// Greenwood forest: [15.5, 60.5] in CRS84 is ~[527467, 6707201] in SWEREF 99 TM (EPSG:3006).
const forest = () => ({
  forests: [{ id: 'forest1', geometry: { type: 'Point', coordinates: [15.5, 60.5] }, properties: { name: 'Greenwood Forest' } }],
});

describe('OGC API - Features - Part 2: CRS by Reference (OGC 18-058r1)', () => {
  const provider = new MemoryProvider(forest());
  let ogc: OgcServer;

  beforeAll(async () => {
    ogc = await startOgc({ provider, crsTransformer: CrsTransformer });
  });

  afterAll(async () => {
    await ogc.stop();
  });

  beforeEach(() => {
    provider.calls = [];
  });

  it('declares the Part 2 conformance class (only) when a CRS transformer is configured', async () => {
    const { body } = await ogc.json('/conformance');
    expect(body.conformsTo).toContain('http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core');
    expect(body.conformsTo).toContain('http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs');

    const native = await startOgc({ provider: new MemoryProvider(forest()) });
    try {
      const { body: nativeConf } = await native.json('/conformance');
      expect(nativeConf.conformsTo).not.toContain('http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs');
    } finally {
      await native.stop();
    }
  });

  describe('6.2 Collection metadata', () => {
    it('/req/crs/crs-uri: every supported CRS is referenced by a URI', async () => {
      const { body } = await ogc.json('/collections/forests');
      for (const crs of body.crs) {
        expect(crs).toMatch(/^http:\/\/www\.opengis\.net\/def\/crs\/(OGC|EPSG)\/[\d.]+\/\w+$/);
      }
    });

    it('/req/crs/fc-md-crs-list A/B: crs lists the supported CRSs and includes the CRS84 default', async () => {
      for (const path of ['/collections/forests']) {
        const { body } = await ogc.json(path);
        expect(body.crs).toContain(CRS84);
        expect(body.crs).toContain(SWEREF99);
      }
      const { body: list } = await ogc.json('/collections');
      expect(list.collections[0].crs).toContain(CRS84);
    });

    gap('[GAP] /req/crs/fc-md-storageCrs: the storage CRS is advertised as "storageCrs" (currently "storageCRS")', async () => {
      const { body } = await ogc.json('/collections/forests');
      expect(body.storageCrs).toBe(CRS84);
    });

    it('/req/crs/fc-md-storageCrs-valid-value: the advertised storage CRS is one of the listed CRSs', async () => {
      const { body } = await ogc.json('/collections/forests');
      expect(body.crs).toContain(body.storageCrs ?? body.storageCRS);
    });
  });

  describe('6.3 Parameter bbox-crs', () => {
    it('/req/crs/fc-bbox-crs-definition, /req/crs/fc-bbox-crs-action: a bbox in SWEREF 99 TM is transformed before selection', async () => {
      const { res, body } = await ogc.json(`/collections/forests/items?bbox=527400,6707100,527500,6707300&bbox-crs=${SWEREF99}`);
      expect(res.status).toBe(200);
      expect(body.features.map((f: any) => f.id)).toEqual(['forests_forest1']);
      const ring = provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
      expect(ring[0][0]).toBeGreaterThan(15.4);
      expect(ring[0][0]).toBeLessThan(15.6);
      expect(ring[0][1]).toBeGreaterThan(60.4);
      expect(ring[0][1]).toBeLessThan(60.6);
    });

    it('/req/crs/fc-bbox-crs-valid-default-value: without bbox-crs the bbox is CRS84, same as bbox-crs=CRS84', async () => {
      await ogc.get('/collections/forests/items?bbox=10,50,12,52');
      const implicit = provider.lastCall().filterQuery;
      await ogc.get(`/collections/forests/items?bbox=10,50,12,52&bbox-crs=${CRS84}`);
      expect(provider.lastCall().filterQuery).toEqual(implicit);
      await ogc.get('/collections/forests/items?bbox=10,50,12,52&bbox-crs=EPSG:4326');
      expect(provider.lastCall().filterQuery).toEqual(implicit);
    });

    it('/req/crs/fc-bbox-crs-valid-value A: an unsupported bbox-crs yields 400 and the provider is not queried', async () => {
      const res = await ogc.get('/collections/forests/items?bbox=10,50,12,52&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/99999');
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toContain('Unsupported bbox-crs requested');
      expect(provider.calls).toHaveLength(0);
    });

    it('rejects a repeated bbox-crs parameter with 400', async () => {
      expect((await ogc.get(`/collections/forests/items?bbox=10,50,12,52&bbox-crs=${CRS84}&bbox-crs=${SWEREF99}`)).status).toBe(400);
    });

    it('/req/core/query-param-invalid: a malformed bbox is rejected even when bbox-crs is supported', async () => {
      const res = await ogc.get('/collections/forests/items?bbox=10,notanumber,12,52');
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toContain('Malformed bbox parameter');
      expect(provider.calls).toHaveLength(0);
    });

    gap('[GAP] /req/crs/fc-bbox-crs-action: bbox-crs=EPSG/0/4326 is read in that CRS\'s latitude/longitude axis order', async () => {
      await ogc.get(`/collections/forests/items?bbox=60,15,61,16&bbox-crs=${EPSG4326}`);
      const ring = provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
      expect(ring[0]).toEqual([15, 60]);
    });
  });

  describe('6.4 Parameter crs', () => {
    it('/req/crs/fc-crs-definition, /req/crs/fc-crs-action: crs=SWEREF 99 TM presents coordinates in that CRS', async () => {
      const { body } = await ogc.json(`/collections/forests/items?crs=${SWEREF99}`);
      expect(body.type).toBe('FeatureCollection');
      // Library behaviour (not required by Part 2): the requested CRS is echoed as a foreign member.
      expect(body.crs).toBe(SWEREF99);
      expect(body.features[0].id).toBe('forests_forest1');
      const [x, y] = body.features[0].geometry.coordinates;
      expect(Math.round(x)).toBe(527467);
      expect(Math.round(y)).toBe(6707201);
    });

    it('/req/crs/fc-crs-default-value: without crs coordinates are CRS84, same as crs=CRS84', async () => {
      const { body: implicit } = await ogc.json('/collections/forests/items');
      const { res, body: explicit } = await ogc.json(`/collections/forests/items?crs=${encodeURIComponent(CRS84)}`);
      expect(res.status).toBe(200);
      expect(implicit.features[0].geometry.coordinates).toEqual([15.5, 60.5]);
      expect(explicit.features[0].geometry.coordinates).toEqual([15.5, 60.5]);
    });

    it('/req/crs/fc-crs-valid-value A: an unsupported crs yields 400', async () => {
      const res = await ogc.get('/collections/forests/items?crs=http://www.opengis.net/def/crs/EPSG/0/99999');
      expect(res.status).toBe(400);
      expect(provider.calls).toHaveLength(0);
    });

    gap('[GAP] /req/crs/fc-crs-valid-value A / fc-crs-action: crs=EPSG/0/4326 is either rejected (not listed) or presented in latitude/longitude order', async () => {
      const res = await ogc.get(`/collections/forests/items?crs=${EPSG4326}`);
      if (res.status !== 400) {
        const body: any = await res.json();
        expect(body.features[0].geometry.coordinates).toEqual([60.5, 15.5]);
      }
    });

    gap('[GAP] /req/crs/fc-crs-definition: the crs parameter is supported on the single feature resource', async () => {
      const { body } = await ogc.json(`/collections/forests/items/forests_forest1?crs=${SWEREF99}`);
      expect(Math.round(body.geometry.coordinates[0])).toBe(527467);
    });
  });

  describe('6.5 Content-Crs response header', () => {
    gap('[GAP] /req/crs/ogc-crs-header, /req/crs/ogc-crs-header-value: feature responses assert their CRS as Content-Crs: <uri>', async () => {
      expect((await ogc.get('/collections/forests/items')).headers.get('content-crs')).toBe(`<${CRS84}>`);
      expect((await ogc.get(`/collections/forests/items?crs=${SWEREF99}`)).headers.get('content-crs')).toBe(`<${SWEREF99}>`);
    });
  });
});

describe('OGC API - Features bbox-crs without a CRS transformer (Part 1 server)', () => {
  const provider = new MemoryProvider(forest());
  let ogc: OgcServer;

  beforeAll(async () => {
    ogc = await startOgc({ provider });
  });

  afterAll(async () => {
    await ogc.stop();
  });

  beforeEach(() => {
    provider.calls = [];
  });

  it('accepts the CRS84 / WGS 84 identifiers and treats them like the default bbox CRS', async () => {
    await ogc.get('/collections/forests/items?bbox=10,50,12,52');
    const implicit = provider.lastCall().filterQuery;
    for (const crs of [CRS84, 'CRS84', 'EPSG:4326', EPSG4326]) {
      expect((await ogc.get(`/collections/forests/items?bbox=10,50,12,52&bbox-crs=${crs}`)).status).toBe(200);
      expect(provider.lastCall().filterQuery).toEqual(implicit);
    }
  });

  it('rejects any other bbox-crs with 400 and does not query the provider', async () => {
    for (const crs of [SWEREF99, 'EPSG:3857']) {
      const res = await ogc.get(`/collections/forests/items?bbox=10,50,12,52&bbox-crs=${crs}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toContain('Unsupported bbox-crs requested');
    }
    expect(provider.calls).toHaveLength(0);
  });
});
