import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MemoryProvider, OgcServer, pointFeatures, startOgc } from './helpers.js';

/**
 * OGC API - Features - Part 1: Core (OGC 17-069r4, corrigendum 1.0.1)
 * https://docs.ogc.org/is/17-069r4/17-069r4.html
 *
 * One `describe` per requirement, named by its identifier. Requirements this library does not
 * meet yet are encoded as `gap('[GAP] …')`: the test states what the standard requires and
 * is expected to fail today; it turns red as soon as the gap is closed so it can be promoted to
 * a regular `it`. See docs/standards/README.md for the conformance matrix.
 */

const CONF = 'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf';

describe('OGC API - Features - Part 1: Core (OGC 17-069r4)', () => {
  const provider = new MemoryProvider({ forests: pointFeatures(5), lakes: pointFeatures(2) });
  let ogc: OgcServer;

  beforeAll(async () => {
    ogc = await startOgc({ provider, defaultLimit: 2, maxLimit: 3 });
  });

  afterAll(async () => {
    await ogc.stop();
  });

  beforeEach(() => {
    provider.calls = [];
  });

  describe('7.2 API landing page', () => {
    it('/req/core/root-op A: supports HTTP GET at the path /', async () => {
      expect((await ogc.get('/')).status).toBe(200);
    });

    it('/req/core/root-success A/B: 200 response links the API definition, /conformance and /collections', async () => {
      const { res, body } = await ogc.json('/');
      expect(res.status).toBe(200);
      expect(Array.isArray(body.links)).toBe(true);
      const rels = body.links.map((l: any) => l.rel);
      expect(rels.some((r: string) => r === 'service-desc' || r === 'service-doc')).toBe(true);
      expect(body.links.find((l: any) => l.rel === 'conformance').href).toBe(`${ogc.root}/conformance`);
      expect(body.links.find((l: any) => l.rel === 'data').href).toBe(`${ogc.root}/collections`);
    });

    it('Recommendation /req/core/root-links: the landing page links to itself (rel=self)', async () => {
      const { body } = await ogc.json('/');
      expect(body.links.find((l: any) => l.rel === 'self').href).toBe(ogc.root);
    });
  });

  describe('7.3 API definition', () => {
    it('/req/core/api-definition-op A: the linked API definition supports HTTP GET', async () => {
      const { body } = await ogc.json('/');
      const desc = body.links.find((l: any) => l.rel === 'service-desc');
      expect((await fetch(desc.href)).status).toBe(200);
    });

    it('/req/core/api-definition-success A: requested with the link type, returns that media type', async () => {
      const { body } = await ogc.json('/');
      const desc = body.links.find((l: any) => l.rel === 'service-desc');
      const res = await fetch(desc.href, { headers: { Accept: desc.type } });
      expect(res.headers.get('content-type')).toContain('application/vnd.oai.openapi+json');
      expect(((await res.json()) as any).openapi).toMatch(/^3\.0\./);
    });
  });

  describe('7.4 Declaration of conformance classes', () => {
    it('/req/core/conformance-op A: supports HTTP GET at /conformance', async () => {
      expect((await ogc.get('/conformance')).status).toBe(200);
    });

    it('/req/core/conformance-success B: lists every conformance class implemented', async () => {
      const { body } = await ogc.json('/conformance');
      expect(body.conformsTo).toEqual(expect.arrayContaining([`${CONF}/core`, `${CONF}/geojson`, `${CONF}/oas30`]));
    });

    it('does not claim conformance classes that are not implemented (html, gmlsf0, gmlsf2)', async () => {
      const { body } = await ogc.json('/conformance');
      for (const cls of ['html', 'gmlsf0', 'gmlsf2']) {
        expect(body.conformsTo).not.toContain(`${CONF}/${cls}`);
      }
    });
  });

  describe('7.5 Use of HTTP 1.1 (/req/core/http)', () => {
    it('answers HEAD requests like GET, without a body', async () => {
      const res = await fetch(`${ogc.root}/collections`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
    });

    it('answers a resource that does not exist with 404', async () => {
      expect((await ogc.get('/collections/unknown')).status).toBe(404);
      expect((await ogc.get('/collections/unknown/items')).status).toBe(404);
    });
  });

  describe('7.6 Unknown or invalid query parameters', () => {
    it(
      '/req/core/query-param-unknown A: a query parameter not in the API definition yields 400 (or the API definition declares free-form parameters)',
      async () => {
        const res = await ogc.get('/collections/forests/items?unknownParameter=1');
        if (res.status === 200) {
          const api: any = await (await ogc.get('/api')).json();
          const params = api.paths?.['/collections/{collectionId}/items']?.get?.parameters ?? [];
          expect(params.some((p: any) => p.style === 'form' && p.schema?.additionalProperties)).toBe(true);
        } else {
          expect(res.status).toBe(400);
        }
      }
    );

    // Invalid limit values are currently replaced by the default instead (see security.test.ts).
    it.each(['0', '-1', 'abc', '1.5'])('/req/core/query-param-invalid A: limit=%s yields 400', async (limit) => {
      expect((await ogc.get(`/collections/forests/items?limit=${limit}`)).status).toBe(400);
    });

    it('/req/core/query-param-invalid A: a bbox that violates its schema yields 400', async () => {
      for (const bbox of ['10,50,12', '10,50,12,52,60', '10,foo,12,52', '10,NaN,12,52', '']) {
        const res = await ogc.get(`/collections/forests/items?bbox=${bbox}`);
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toContain('Malformed bbox parameter');
      }
      expect(provider.calls).toHaveLength(0);
    });

    it('/req/core/query-param-invalid A: a bbox whose southern edge is north of its northern edge yields 400', async () => {
      const res = await ogc.get('/collections/forests/items?bbox=10,52,12,50');
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toContain('minLat');
    });
  });

  describe('7.8 Feature collections (/collections)', () => {
    it('/req/core/fc-md-op, /req/core/fc-md-success: GET /collections returns 200', async () => {
      const { res, body } = await ogc.json('/collections');
      expect(res.status).toBe(200);
      expect(Array.isArray(body.collections)).toBe(true);
    });

    it('/req/core/fc-md-links A/B: links to itself, and every link has rel and type', async () => {
      const { body } = await ogc.json('/collections');
      expect(body.links.find((l: any) => l.rel === 'self').href).toBe(`${ogc.root}/collections`);
      for (const link of [...body.links, ...body.collections.flatMap((c: any) => c.links)]) {
        expect(link.rel).toBeTruthy();
        expect(link.type).toBeTruthy();
      }
    });

    it('/req/core/fc-md-items A: one item per feature collection offered', async () => {
      const { body } = await ogc.json('/collections');
      expect(body.collections.map((c: any) => c.id).sort()).toEqual(['forests', 'lakes']);
    });

    it('/req/core/fc-md-items-links A: each collection links to its items (rel=items) per encoding', async () => {
      const { body } = await ogc.json('/collections');
      for (const col of body.collections) {
        expect(col.links).toContainEqual(
          expect.objectContaining({ rel: 'items', type: 'application/geo+json', href: `${ogc.root}/collections/${col.id}/items` })
        );
      }
    });

    it('/req/core/fc-md-extent, /req/core/fc-md-extent-multi A: the first spatial bbox contains every feature', async () => {
      const { body } = await ogc.json('/collections');
      const forests = body.collections.find((c: any) => c.id === 'forests');
      const [minX, minY, maxX, maxY] = forests.extent.spatial.bbox[0];
      for (const f of pointFeatures(5)) {
        const [x, y] = f.geometry.coordinates;
        expect(x >= minX && x <= maxX && y >= minY && y <= maxY).toBe(true);
      }
    });
  });

  describe('7.14 Feature collection (/collections/{collectionId})', () => {
    it('/req/core/sfc-md-op A/B: GET is supported for every id listed in /collections', async () => {
      const { body } = await ogc.json('/collections');
      for (const col of body.collections) {
        expect((await ogc.get(`/collections/${col.id}`)).status).toBe(200);
      }
    });

    it('/req/core/sfc-md-success B: id, title, extent and links match the /collections entry', async () => {
      const { body: list } = await ogc.json('/collections');
      const entry = list.collections.find((c: any) => c.id === 'forests');
      const { body: single } = await ogc.json('/collections/forests');
      expect(single.id).toBe(entry.id);
      expect(single.title).toBe(entry.title);
      expect(single.extent).toEqual(entry.extent);
      expect(single.links).toEqual(expect.arrayContaining(entry.links));
    });

    it('/req/core/sfc-md-success B: description is identical to the /collections entry', async () => {
      const { body: list } = await ogc.json('/collections');
      const { body: single } = await ogc.json('/collections/forests');
      expect(single.description).toBe(list.collections.find((c: any) => c.id === 'forests').description);
    });
  });

  describe('7.15 Features (/collections/{collectionId}/items)', () => {
    it('/req/core/fc-op A: GET /items is supported for every collection', async () => {
      for (const id of ['forests', 'lakes']) {
        expect((await ogc.get(`/collections/${id}/items`)).status).toBe(200);
      }
    });

    describe('limit', () => {
      it('/req/core/fc-limit-response-1 A: never returns more features than limit', async () => {
        const { body } = await ogc.json('/collections/forests/items?limit=1');
        expect(body.features).toHaveLength(1);
      });

      it('/req/core/fc-limit-response-1 B/C: a limit above the maximum is not an error and the maximum applies', async () => {
        const { res, body } = await ogc.json('/collections/forests/items?limit=10000');
        expect(res.status).toBe(200);
        expect(body.features).toHaveLength(3);
      });

      it('Permission 5: the server default limit applies when limit is omitted', async () => {
        const { body } = await ogc.json('/collections/forests/items');
        expect(body.features).toHaveLength(2);
      });
    });

    describe('bbox', () => {
      it('/req/core/fc-bbox-definition C, /req/core/fc-bbox-response A: four numbers are a CRS84 lon/lat box used for selection', async () => {
        const { res } = await ogc.json('/collections/forests/items?bbox=10,50,12,52');
        expect(res.status).toBe(200);
        expect(provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates).toEqual([
          [[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]],
        ]);
      });

      it('/req/core/fc-bbox-response: a degenerate box (lower left == upper right) is accepted', async () => {
        expect((await ogc.get('/collections/forests/items?bbox=11,51,11,51')).status).toBe(200);
      });

      it('/req/core/fc-bbox-definition A/B/D: six numbers (box with a vertical axis, CRS84h) are accepted', async () => {
        expect((await ogc.get('/collections/forests/items?bbox=10,50,0,12,52,100')).status).toBe(200);
      });

      it('/req/core/fc-bbox-response: a box spanning the anti-meridian (west > east) selects across ±180°', async () => {
        const res = await ogc.get('/collections/forests/items?bbox=170,-10,-170,10');
        expect(res.status).toBe(200);
        const ring = JSON.stringify(provider.lastCall().filterQuery);
        // The selection must not cover the Greenwich side of the globe (e.g. longitude 0).
        expect(ring).not.toContain('[-170,-10],[170,-10]');
        expect(ring).not.toContain('[170,-10],[-170,-10]');
      });

      it('/req/core/fc-bbox-response D: coordinates outside the CRS84 extent (|lat| > 90) are rejected', async () => {
        expect((await ogc.get('/collections/forests/items?bbox=10,-95,12,52')).status).toBe(400);
      });
    });

    describe('datetime', () => {
      it.each(['2018-02-12T23:20:52Z', '2018-02-12T00:00:00Z/2018-03-18T12:31:12Z', '../2018-03-18T12:31:12Z', '2018-02-12T00:00:00Z/..', '/2018-03-18T12:31:12Z'])(
        '/req/core/fc-time-definition, /req/core/fc-time-response C/D/F: datetime=%s is accepted and matches features without a temporal geometry',
        async (datetime) => {
          const { res, body } = await ogc.json(`/collections/lakes/items?datetime=${encodeURIComponent(datetime)}`);
          expect(res.status).toBe(200);
          expect(body.features).toHaveLength(2);
        }
      );

      it.each(['yesterday', '2018-13-45T00:00:00Z', '2018-03-18T12:31:12Z/2018-02-12T00:00:00Z'])(
        '/req/core/fc-time-response D/E, /req/core/query-param-invalid: datetime=%s is not RFC 3339 / a valid interval and yields 400',
        async (datetime) => {
          expect((await ogc.get(`/collections/lakes/items?datetime=${encodeURIComponent(datetime)}`)).status).toBe(400);
        }
      );
    });

    describe('response', () => {
      it('/req/core/fc-response A/B: 200, and a next link when more features are available', async () => {
        const { res, body } = await ogc.json('/collections/forests/items?limit=2');
        expect(res.status).toBe(200);
        const next = body.links.find((l: any) => l.rel === 'next');
        expect(next.href).toContain('limit=2');
      });

      it('/req/core/fc-response B: following next links pages through every feature exactly once, then stops', async () => {
        const seen: string[] = [];
        let url: string | undefined = `${ogc.root}/collections/forests/items?limit=2`;
        while (url) {
          const page: any = await (await fetch(url)).json();
          seen.push(...page.features.map((f: any) => f.id));
          url = page.links.find((l: any) => l.rel === 'next')?.href;
        }
        expect(seen).toEqual(['forests_f1', 'forests_f2', 'forests_f3', 'forests_f4', 'forests_f5']);
      });

      it('/req/core/fc-links A, /req/core/fc-rel-type A: links to itself, and every link has rel and type', async () => {
        const { body } = await ogc.json('/collections/forests/items?limit=2&bbox=10,50,12,52');
        const self = body.links.find((l: any) => l.rel === 'self');
        expect(self.href).toBe(`${ogc.root}/collections/forests/items?limit=2&bbox=10%2C50%2C12%2C52`);
        for (const link of body.links) {
          expect(link.rel).toBeTruthy();
          expect(link.type).toBeTruthy();
        }
      });

      it('/req/core/fc-numberMatched A: numberMatched is the number of features matching the selection', async () => {
        const { body } = await ogc.json('/collections/forests/items?limit=2');
        expect(body.numberMatched).toBe(5);
      });

      it('/req/core/fc-numberReturned A: numberReturned is the number of features in the response', async () => {
        for (const limit of [1, 2, 3]) {
          const { body } = await ogc.json(`/collections/forests/items?limit=${limit}`);
          expect(body.numberReturned).toBe(body.features.length);
        }
      });

      it('/req/core/fc-timeStamp A: timeStamp, when present, is the time the response was generated', async () => {
        const before = Date.now();
        const { body } = await ogc.json('/collections/forests/items');
        if (body.timeStamp !== undefined) {
          const ts = Date.parse(body.timeStamp);
          expect(ts).toBeGreaterThanOrEqual(before - 1000);
          expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
        }
      });
    });

    it('/req/core/crs84 A: without an explicit request, geometries are CRS84 longitude/latitude', async () => {
      const { body } = await ogc.json('/collections/forests/items?limit=1');
      expect(body.features[0].geometry.coordinates).toEqual(pointFeatures(5)[0].geometry.coordinates);
    });
  });

  describe('7.16 Feature (/collections/{collectionId}/items/{featureId})', () => {
    it('/req/core/f-op A, /req/core/f-success A: GET of a single feature returns 200', async () => {
      const { body } = await ogc.json('/collections/forests/items?limit=1');
      expect((await ogc.get(`/collections/forests/items/${body.features[0].id}`)).status).toBe(200);
    });

    it('/req/core/f-links A/B: the feature links to itself and to its collection, with rel and type', async () => {
      const { body: page } = await ogc.json('/collections/forests/items?limit=1');
      const { body } = await ogc.json(`/collections/forests/items/${page.features[0].id}`);
      expect(body.links).toContainEqual(expect.objectContaining({ rel: 'self', type: 'application/geo+json' }));
      expect(body.links).toContainEqual(expect.objectContaining({ rel: 'collection', href: `${ogc.root}/collections/forests` }));
    });

    it('answers an unknown feature with 404', async () => {
      expect((await ogc.get('/collections/forests/items/does-not-exist')).status).toBe(404);
    });
  });

  describe('7.10 / 8.3 Requirements class "GeoJSON"', () => {
    it('/req/geojson/definition A: features use application/geo+json, other resources application/json', async () => {
      expect((await ogc.get('/collections/forests/items')).headers.get('content-type')).toContain('application/geo+json');
      for (const path of ['/', '/conformance', '/collections', '/collections/forests']) {
        expect((await ogc.get(path)).headers.get('content-type')).toContain('application/json');
      }
    });

    it('/req/geojson/content A/C: items are a GeoJSON FeatureCollection with the links as a foreign member', async () => {
      const { body } = await ogc.json('/collections/forests/items');
      expect(body.type).toBe('FeatureCollection');
      expect(Array.isArray(body.features)).toBe(true);
      expect(Array.isArray(body.links)).toBe(true);
    });

    it('/req/geojson/content B: a single feature is a GeoJSON Feature whose id equals the featureId path parameter', async () => {
      const { body: page } = await ogc.json('/collections/forests/items?limit=1');
      const id = page.features[0].id;
      const { body } = await ogc.json(`/collections/forests/items/${id}`);
      expect(body.type).toBe('Feature');
      expect(body.id).toBe(id);
    });
  });

  describe('9. Requirements class "OpenAPI 3.0"', () => {
    it('/req/oas30/oas-definition-1 A: the landing page links service-desc (OpenAPI JSON) and service-doc (text/html)', async () => {
      const { body } = await ogc.json('/');
      expect(body.links).toContainEqual(expect.objectContaining({ rel: 'service-desc', type: 'application/vnd.oai.openapi+json;version=3.0' }));
      expect(body.links).toContainEqual(expect.objectContaining({ rel: 'service-doc', type: 'text/html' }));
    });

    it('/req/oas30/oas-definition-2 A: the JSON representation is an OpenAPI 3.0 document', async () => {
      const api: any = await (await ogc.get('/api')).json();
      expect(api.openapi).toMatch(/^3\.0\./);
      expect(api.info.title).toBeTruthy();
      expect(api.paths).toBeTypeOf('object');
    });

    it('/req/oas30/oas-impl, /req/oas30/completeness: the definition documents every operation the server implements', async () => {
      const api: any = await (await ogc.get('/api')).json();
      for (const path of ['/', '/conformance', '/collections', '/collections/{collectionId}', '/collections/{collectionId}/items']) {
        expect(api.paths[path]?.get, path).toBeDefined();
      }
    });
  });
});
