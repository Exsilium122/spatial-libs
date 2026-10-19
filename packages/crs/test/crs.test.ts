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

  describe('3D Coordinates and Nested Geometry Reprojection (#16)', () => {
    it('should transform 3D and 4D coordinates while preserving z and extra ordinates', () => {
      // 2D position returns 2-element array
      const pt2d = CrsTransformer.transformCoordinate([15.0, 60.0], 'EPSG:4326', 'EPSG:3006');
      expect(pt2d).toHaveLength(2);
      expect(Math.round(pt2d[0])).toBe(500000);
      expect(Math.round(pt2d[1])).toBe(6651411);

      // 3D position [x, y, z] preserves elevation ordinate z
      const pt3d = CrsTransformer.transformCoordinate([15.5, 60.5, 120.0], 'EPSG:4326', 'EPSG:3006');
      expect(pt3d).toHaveLength(3);
      expect(Math.round(pt3d[0])).toBe(527467);
      expect(Math.round(pt3d[1])).toBe(6707201);
      expect(pt3d[2]).toBe(120.0);

      // 4D position [x, y, z, m] preserves z and m
      const pt4d = CrsTransformer.transformCoordinate([15.5, 60.5, 120.0, 42.5], 'EPSG:4326', 'EPSG:3006');
      expect(pt4d).toHaveLength(4);
      expect(Math.round(pt4d[0])).toBe(527467);
      expect(Math.round(pt4d[1])).toBe(6707201);
      expect(pt4d[2]).toBe(120.0);
      expect(pt4d[3]).toBe(42.5);

      // Same-SRS returns coordinates unchanged
      const sameSrs = CrsTransformer.transformCoordinate([15.5, 60.5, 120.0], 'EPSG:4326', 'EPSG:4326');
      expect(sameSrs).toEqual([15.5, 60.5, 120.0]);
    });

    it('should reproject 3D Point and 2D Point geometries correctly', () => {
      // 2D Point preserves 2-element array
      const point2d = {
        type: 'Point',
        coordinates: [15.0, 60.0]
      };
      const trans2d = CrsTransformer.transformGeometry(point2d, 'EPSG:4326', 'EPSG:3006');
      expect(trans2d.coordinates).toHaveLength(2);
      expect(Math.round(trans2d.coordinates[0])).toBe(500000);
      expect(Math.round(trans2d.coordinates[1])).toBe(6651411);

      // 3D Point [15.5, 60.5, 120.0] yields projected X/Y and preserved 120.0 elevation
      const point3d = {
        type: 'Point',
        coordinates: [15.5, 60.5, 120.0]
      };
      const trans3d = CrsTransformer.transformGeometry(point3d, 'EPSG:4326', 'EPSG:3006');
      expect(trans3d.type).toBe('Point');
      expect(trans3d.coordinates).toHaveLength(3);
      expect(Math.round(trans3d.coordinates[0])).toBe(527467);
      expect(Math.round(trans3d.coordinates[1])).toBe(6707201);
      expect(trans3d.coordinates[2]).toBe(120.0);
    });

    it('should reproject nested 3D LineString geometries', () => {
      const lineString3d = {
        type: 'LineString',
        coordinates: [
          [15.5, 60.5, 120.0],
          [16.0, 61.0, 130.0]
        ]
      };
      const transLine = CrsTransformer.transformGeometry(lineString3d, 'EPSG:4326', 'EPSG:3006');
      expect(transLine.type).toBe('LineString');
      expect(transLine.coordinates).toHaveLength(2);

      // Vertex 0
      expect(transLine.coordinates[0]).toHaveLength(3);
      expect(Math.round(transLine.coordinates[0][0])).toBe(527467);
      expect(Math.round(transLine.coordinates[0][1])).toBe(6707201);
      expect(transLine.coordinates[0][2]).toBe(120.0);

      // Vertex 1
      expect(transLine.coordinates[1]).toHaveLength(3);
      expect(Math.round(transLine.coordinates[1][0])).toBe(554084);
      expect(Math.round(transLine.coordinates[1][1])).toBe(6763200);
      expect(transLine.coordinates[1][2]).toBe(130.0);
    });

    it('should reproject nested 3D Polygon and MultiPolygon geometries', () => {
      const polygon3d = {
        type: 'Polygon',
        coordinates: [
          [
            [15.5, 60.5, 120.0],
            [16.0, 60.5, 120.0],
            [16.0, 61.0, 120.0],
            [15.5, 61.0, 120.0],
            [15.5, 60.5, 120.0]
          ]
        ]
      };
      const transPoly = CrsTransformer.transformGeometry(polygon3d, 'EPSG:4326', 'EPSG:3006');
      expect(transPoly.type).toBe('Polygon');
      expect(transPoly.coordinates[0]).toHaveLength(5);
      transPoly.coordinates[0].forEach((pt: number[]) => {
        expect(pt).toHaveLength(3);
        expect(pt[2]).toBe(120.0);
      });
      expect(Math.round(transPoly.coordinates[0][0][0])).toBe(527467);
      expect(Math.round(transPoly.coordinates[0][0][1])).toBe(6707201);

      // MultiPolygon with 3D coordinates
      const multiPolygon3d = {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [15.5, 60.5, 120.0],
              [16.0, 60.5, 120.0],
              [16.0, 61.0, 120.0],
              [15.5, 61.0, 120.0],
              [15.5, 60.5, 120.0]
            ]
          ]
        ]
      };
      const transMultiPoly = CrsTransformer.transformGeometry(multiPolygon3d, 'EPSG:4326', 'EPSG:3006');
      expect(transMultiPoly.type).toBe('MultiPolygon');
      expect(transMultiPoly.coordinates[0][0]).toHaveLength(5);
      transMultiPoly.coordinates[0][0].forEach((pt: number[]) => {
        expect(pt).toHaveLength(3);
        expect(pt[2]).toBe(120.0);
      });
      expect(Math.round(transMultiPoly.coordinates[0][0][0][0])).toBe(527467);
      expect(Math.round(transMultiPoly.coordinates[0][0][0][1])).toBe(6707201);
    });

    it('should reproject GeometryCollection containing 3D geometries', () => {
      const collection = {
        type: 'GeometryCollection',
        geometries: [
          {
            type: 'Point',
            coordinates: [15.5, 60.5, 120.0]
          },
          {
            type: 'LineString',
            coordinates: [
              [15.5, 60.5, 120.0],
              [16.0, 61.0, 130.0]
            ]
          }
        ]
      };
      const transCollection = CrsTransformer.transformGeometry(collection, 'EPSG:4326', 'EPSG:3006');
      expect(transCollection.type).toBe('GeometryCollection');
      expect(transCollection.geometries).toHaveLength(2);

      // Sub-geometry 0 (Point)
      expect(transCollection.geometries![0].type).toBe('Point');
      expect(transCollection.geometries![0].coordinates).toHaveLength(3);
      expect(Math.round(transCollection.geometries![0].coordinates[0])).toBe(527467);
      expect(Math.round(transCollection.geometries![0].coordinates[1])).toBe(6707201);
      expect(transCollection.geometries![0].coordinates[2]).toBe(120.0);

      // Sub-geometry 1 (LineString)
      expect(transCollection.geometries![1].type).toBe('LineString');
      expect(transCollection.geometries![1].coordinates[0]).toHaveLength(3);
      expect(Math.round(transCollection.geometries![1].coordinates[0][0])).toBe(527467);
      expect(Math.round(transCollection.geometries![1].coordinates[0][1])).toBe(6707201);
      expect(transCollection.geometries![1].coordinates[0][2]).toBe(120.0);
      expect(transCollection.geometries![1].coordinates[1][2]).toBe(130.0);
    });

    it('should short-circuit when fromSrs and toSrs are identical', () => {
      const point3d = {
        type: 'Point',
        coordinates: [15.5, 60.5, 120.0]
      };
      // Returns exact same object reference
      const result = CrsTransformer.transformGeometry(point3d, 'EPSG:4326', 'EPSG:4326');
      expect(result).toBe(point3d);

      const collection = {
        type: 'GeometryCollection',
        geometries: [point3d]
      };
      const resultCol = CrsTransformer.transformGeometry(collection, 'EPSG:3006', 'EPSG:3006');
      expect(resultCol).toBe(collection);
    });

    it('should handle null or empty geometry gracefully', () => {
      expect(CrsTransformer.transformGeometry(null as any, 'EPSG:4326', 'EPSG:3006')).toBeNull();
      const noCoords = { type: 'Unknown' };
      expect(CrsTransformer.transformGeometry(noCoords as any, 'EPSG:4326', 'EPSG:3006')).toBe(noCoords);
    });
  });
});
