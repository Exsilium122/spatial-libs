import { describe, it, expect } from 'vitest';
import CrsTransformer from '../../src/index.js';

/**
 * CRS identifier forms the spatial protocols require servers to understand:
 *
 * - OGC 09-025r2 (WFS 2.0) §7.9.2.4.4.1: srsName as urn:ogc:def:crs:EPSG::{code} (deprecated)
 *   and http://www.opengis.net/def/crs/{epsg|ogc}/0/{code}
 * - OGC 18-058r1 (OGC API Features Part 2) /req/crs/crs-uri: CRS referenced by URI, incl.
 *   http://www.opengis.net/def/crs/OGC/1.3/CRS84 and .../OGC/0/CRS84h (OGC 17-069r4 /req/core/crs84)
 * - OGC 02-058 (WFS 1.0) / GML 2: http://www.opengis.net/gml/srs/epsg.xml#{code}
 * - OGC 04-094 (WFS 1.1): EPSG:{code} and the versioned URN urn:x-ogc:def:crs:EPSG:{version}:{code}
 *
 * The URN/URI normalization assertions formerly in crs.test.ts moved here.
 */

describe('OGC CRS identifiers understood by CrsTransformer.normalizeSrs', () => {
  describe('WGS 84 longitude/latitude (CRS84)', () => {
    it.each([
      'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
      'urn:ogc:def:crs:OGC:1.3:CRS84',
      'urn:ogc:def:crs:OGC::CRS84',
      'CRS:84',
      'CRS84',
    ])('/req/core/crs84: %s is the default CRS84 (EPSG:4326 lon/lat)', (id) => {
      expect(CrsTransformer.normalizeSrs(id)).toBe('EPSG:4326');
      expect(CrsTransformer.isSupported(id)).toBe(true);
    });

    it('/req/core/crs84: CRS84h (with ellipsoidal height) maps to the same horizontal CRS and keeps the height', () => {
      const id = 'http://www.opengis.net/def/crs/OGC/0/CRS84h';
      expect(CrsTransformer.normalizeSrs(id)).toBe('EPSG:4326');
      const [, , h] = CrsTransformer.transformCoordinate([15, 60, 250], id, 'EPSG:3006');
      expect(h).toBe(250);
    });

    it('an empty identifier falls back to the default CRS', () => {
      expect(CrsTransformer.normalizeSrs('')).toBe('EPSG:4326');
    });
  });

  describe('EPSG codes', () => {
    it.each([
      ['EPSG:3006', 'WFS 1.1 / OWS short form'],
      ['urn:ogc:def:crs:EPSG::3006', 'WFS 2.0 §7.9.2.4.4.1 URN without version (deprecated, still allowed)'],
      ['http://www.opengis.net/def/crs/EPSG/0/3006', 'WFS 2.0 §7.9.2.4.4.1 / OGC API Part 2 http URI'],
      ['http://www.opengis.net/def/crs/epsg/0/3006', 'WFS 2.0 §7.9.2.4.4.1 example uses a lower-case authority'],
      ['http://www.opengis.net/gml/srs/epsg.xml#3006', 'WFS 1.0 / GML 2 srsName'],
      ['urn:x-ogc:def:crs:EPSG:3006', 'WFS 1.1 URN without version'],
      ['  EPSG:3006  ', 'surrounding whitespace'],
    ])('%s (%s) normalizes to EPSG:3006', (id) => {
      expect(CrsTransformer.normalizeSrs(id)).toBe('EPSG:3006');
      expect(CrsTransformer.isSupported(id)).toBe(true);
    });

    it.each([
      'urn:ogc:def:crs:EPSG:6.3:3006',
      'urn:x-ogc:def:crs:EPSG:6.11:4326',
      'http://www.opengis.net/def/crs/EPSG/9.9.1/3006',
    ])('OGC 07-092 versioned identifier %s resolves to its EPSG code, not the version number', (id) => {
      expect(CrsTransformer.normalizeSrs(id)).toBe(`EPSG:${id.split(/[:/]/).pop()}`);
    });
  });

  describe('identifiers that must not be mistaken for a supported CRS', () => {
    it.each(['http://www.opengis.net/def/crs/ESRI/0/102100', 'EPSG:', 'EPSG:99999', 'not-a-crs'])('%s is not supported', (id) => {
      expect(CrsTransformer.isSupported(id)).toBe(false);
    });
  });
});
