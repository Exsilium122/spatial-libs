import { describe, it, expect } from 'vitest';
import CrsTransformer from '../src/index.js';

describe('CRS Transformer Tests', () => {
  it('should normalize standard EPSG coordinate formats and synonyms', () => {
    // Normalization of default system
    expect(CrsTransformer.normalizeSrs('')).toBe('EPSG:4326');
    expect(CrsTransformer.normalizeSrs('urn:ogc:def:crs:OGC:1.3:CRS84')).toBe('EPSG:4326');
    expect(CrsTransformer.normalizeSrs('CRS:84')).toBe('EPSG:4326');

    // Normalization of typical formats
    expect(CrsTransformer.normalizeSrs('EPSG:3006')).toBe('EPSG:3006');
    expect(CrsTransformer.normalizeSrs('epsg:3006')).toBe('EPSG:3006');
    expect(CrsTransformer.normalizeSrs('urn:ogc:def:crs:EPSG::3006')).toBe('EPSG:3006');
    expect(CrsTransformer.normalizeSrs('http://www.opengis.net/gml/srs/epsg.xml#3006')).toBe('EPSG:3006');
    expect(CrsTransformer.normalizeSrs('http://www.opengis.net/def/crs/EPSG/0/3006')).toBe('EPSG:3006');

    // Local synonyms normalization
    expect(CrsTransformer.normalizeSrs('SWEREF 99 TM')).toBe('EPSG:3006');
    expect(CrsTransformer.normalizeSrs('SWEREF 99 18 00')).toBe('EPSG:3011');
    expect(CrsTransformer.normalizeSrs('Lambert 93')).toBe('EPSG:2154');
    expect(CrsTransformer.normalizeSrs('Lambert II etendu')).toBe('EPSG:27572');
    expect(CrsTransformer.normalizeSrs('CS92')).toBe('EPSG:2180');
    expect(CrsTransformer.normalizeSrs('Gauss-Kruger Zone 3')).toBe('EPSG:31467');
  });

  it('should support registering custom local synonyms at runtime', () => {
    expect(CrsTransformer.normalizeSrs('SwedishStandard')).toBe('SwedishStandard');
    CrsTransformer.registerSynonym('SwedishStandard', 'EPSG:3006');
    expect(CrsTransformer.normalizeSrs('SwedishStandard')).toBe('EPSG:3006');
    expect(CrsTransformer.normalizeSrs('swedishstandard')).toBe('EPSG:3006');
  });

  it('should verify supported built-in country-specific codes', () => {
    expect(CrsTransformer.isSupported('EPSG:4326')).toBe(true);
    expect(CrsTransformer.isSupported('EPSG:3857')).toBe(true);
    
    // Sweden SWEREF
    expect(CrsTransformer.isSupported('urn:ogc:def:crs:EPSG::3006')).toBe(true);
    expect(CrsTransformer.isSupported('EPSG:3007')).toBe(true);

    // Poland PUWG
    expect(CrsTransformer.isSupported('EPSG:2180')).toBe(true);
    expect(CrsTransformer.isSupported('EPSG:2177')).toBe(true);

    // Germany Gauss-Kruger / ETRS89
    expect(CrsTransformer.isSupported('EPSG:25832')).toBe(true);
    expect(CrsTransformer.isSupported('EPSG:31467')).toBe(true);

    // France Lambert
    expect(CrsTransformer.isSupported('EPSG:2154')).toBe(true);
    expect(CrsTransformer.isSupported('EPSG:27572')).toBe(true);

    // Norway EUREF89 / NTM
    expect(CrsTransformer.isSupported('EPSG:25835')).toBe(true);
    expect(CrsTransformer.isSupported('EPSG:5105')).toBe(true);
  });

  it('should successfully transform coordinates between systems', () => {
    // Transform point from EPSG:4326 to Swedish SWEREF99 TM (EPSG:3006)
    // Coordinates [15.0, 60.0] should land precisely near [500000, 6651411] in SWEREF99 TM
    const [x, y] = CrsTransformer.transformCoordinate([15.0, 60.0], 'EPSG:4326', 'EPSG:3006');
    expect(Math.round(x)).toBe(500000);
    expect(Math.round(y)).toBe(6651411);
  });

  it('should recursively transform geometries', () => {
    const geojsonPoint = {
      type: 'Point',
      coordinates: [15.0, 60.0]
    };

    const transformed = CrsTransformer.transformGeometry(geojsonPoint, 'EPSG:4326', 'EPSG:3006');
    expect(transformed.type).toBe('Point');
    expect(Math.round(transformed.coordinates[0])).toBe(500000);
    expect(Math.round(transformed.coordinates[1])).toBe(6651411);
  });

  it('should support dynamic custom registration', () => {
    // Swiss projection CH1903+ / LV95 (EPSG:2056)
    const ch1903Plus = '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs';
    
    expect(CrsTransformer.isSupported('EPSG:2056')).toBe(false);
    
    CrsTransformer.register('EPSG:2056', ch1903Plus);
    
    expect(CrsTransformer.isSupported('EPSG:2056')).toBe(true);
    
    // LV95 coordinates [2600000, 1200000] transforms to [7.43863, 46.95108] in WGS84 (including datum shift)
    const [lon, lat] = CrsTransformer.transformCoordinate([2600000, 1200000], 'EPSG:2056', 'EPSG:4326');
    expect(lon).toBeCloseTo(7.43863, 4);
    expect(lat).toBeCloseTo(46.95108, 4);
  });
});
