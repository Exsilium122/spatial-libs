import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryProvider, OgcServer, startOgc } from './helpers.js';

/**
 * RFC 7946 — The GeoJSON Format (IETF, August 2016)
 * https://www.rfc-editor.org/rfc/rfc7946
 *
 * Validates the GeoJSON documents produced by /collections/{collectionId}/items, which
 * /req/geojson/content (OGC 17-069r4) requires to be RFC 7946 FeatureCollections.
 */

const geometries: Record<string, any> = {
  point: { type: 'Point', coordinates: [10.5, 50.5] },
  point3d: { type: 'Point', coordinates: [10.5, 50.5, 120.25] },
  multipoint: { type: 'MultiPoint', coordinates: [[10, 50], [11, 51]] },
  line: { type: 'LineString', coordinates: [[10, 50], [11, 51], [12, 52]] },
  multiline: { type: 'MultiLineString', coordinates: [[[10, 50], [11, 51]], [[11, 50], [12, 51]]] },
  polygon: {
    type: 'Polygon',
    coordinates: [
      [[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]],
      [[10.5, 50.5], [10.5, 51], [11, 51], [11, 50.5], [10.5, 50.5]],
    ],
  },
  multipolygon: { type: 'MultiPolygon', coordinates: [[[[10, 50], [11, 50], [11, 51], [10, 50]]], [[[11, 51], [12, 51], [12, 52], [11, 51]]]] },
  collection: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [10, 50] }, { type: 'LineString', coordinates: [[10, 50], [11, 51]] }] },
};

function isPosition(p: unknown): boolean {
  return Array.isArray(p) && p.length >= 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** RFC 7946 §3.1 structural validation of a geometry object (null is allowed for features). */
function assertGeometry(g: any): void {
  expect(g).toBeTypeOf('object');
  switch (g.type) {
    case 'Point':
      expect(isPosition(g.coordinates)).toBe(true);
      break;
    case 'MultiPoint':
      expect(g.coordinates.every(isPosition)).toBe(true);
      break;
    case 'LineString':
      expect(g.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(g.coordinates.every(isPosition)).toBe(true);
      break;
    case 'MultiLineString':
      g.coordinates.forEach((line: any) => assertGeometry({ type: 'LineString', coordinates: line }));
      break;
    case 'Polygon':
      for (const ring of g.coordinates) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring.every(isPosition)).toBe(true);
        expect(ring[ring.length - 1]).toEqual(ring[0]);
      }
      break;
    case 'MultiPolygon':
      g.coordinates.forEach((poly: any) => assertGeometry({ type: 'Polygon', coordinates: poly }));
      break;
    case 'GeometryCollection':
      expect(Array.isArray(g.geometries)).toBe(true);
      expect(g.coordinates).toBeUndefined();
      g.geometries.forEach(assertGeometry);
      break;
    default:
      throw new Error(`Not an RFC 7946 geometry type: ${g.type}`);
  }
}

describe('RFC 7946 GeoJSON output of /collections/{collectionId}/items', () => {
  const provider = new MemoryProvider({
    shapes: Object.entries(geometries).map(([id, geometry]) => ({ id, geometry, properties: { kind: id } })),
    numbered: [{ id: 42, geometry: geometries.point, properties: { a: 1 } }],
    unlocated: [{ id: 'nowhere', geometry: null as any, properties: { note: 'no geometry' } }],
    bare: [{ id: 'bare', geometry: geometries.point, properties: undefined as any }],
  });
  let ogc: OgcServer;
  const items = async (collection: string) => (await ogc.json(`/collections/${collection}/items?limit=100`)).body;
  const byKind = async (kind: string) => (await items('shapes')).features.find((f: any) => f.properties.kind === kind);

  beforeAll(async () => {
    ogc = await startOgc({ provider });
  });

  afterAll(async () => {
    await ogc.stop();
  });

  it('§12: is served with the application/geo+json media type', async () => {
    expect((await ogc.get('/collections/shapes/items')).headers.get('content-type')).toMatch(/^application\/geo\+json/);
  });

  it('§3.3: a FeatureCollection has type "FeatureCollection" and a "features" array of Feature objects', async () => {
    const body = await items('shapes');
    expect(body.type).toBe('FeatureCollection');
    expect(Array.isArray(body.features)).toBe(true);
    for (const f of body.features) expect(f.type).toBe('Feature');
  });

  it('§3.2: every Feature has "geometry" and "properties" members, and properties is an object or null', async () => {
    for (const collection of ['shapes', 'numbered', 'bare']) {
      for (const f of (await items(collection)).features) {
        expect('geometry' in f).toBe(true);
        expect('properties' in f).toBe(true);
        expect(f.properties === null || typeof f.properties === 'object').toBe(true);
      }
    }
  });

  it('§3.2: a Feature identifier is a string or a number', async () => {
    for (const collection of ['shapes', 'numbered']) {
      for (const f of (await items(collection)).features) {
        expect(['string', 'number']).toContain(typeof f.id);
      }
    }
  });

  it.each(['point', 'multipoint', 'line', 'multiline', 'polygon', 'multipolygon'])(
    '§3.1: a %s geometry is emitted as a structurally valid RFC 7946 geometry, unchanged',
    async (kind) => {
      const f = await byKind(kind);
      assertGeometry(f.geometry);
      expect(f.geometry).toEqual(geometries[kind]);
    }
  );

  it('§3.1.1: positions are longitude, latitude and an optional altitude, which is preserved', async () => {
    expect((await byKind('point')).geometry.coordinates).toEqual([10.5, 50.5]);
    expect((await byKind('point3d')).geometry.coordinates).toEqual([10.5, 50.5, 120.25]);
  });

  it('§3.1.6: polygon rings stay closed (first position equals last) with the interior ring kept', async () => {
    const f = await byKind('polygon');
    expect(f.geometry.coordinates).toHaveLength(2);
    for (const ring of f.geometry.coordinates) expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it('§3.1.8: a GeometryCollection keeps its "geometries" member and has no "coordinates"', async () => {
    const f = await byKind('collection');
    assertGeometry(f.geometry);
    expect(f.geometry).toEqual(geometries.collection);
  });

  it('§3.2: an unlocated feature has "geometry": null (not a Point without coordinates)', async () => {
    const [f] = (await items('unlocated')).features;
    expect(f.geometry).toBeNull();
  });
});
