import { describe, it, expect } from 'vitest';
import CrsTransformer from '../../src/index.js';

/**
 * RFC 7946 — The GeoJSON Format (IETF, August 2016)
 * https://www.rfc-editor.org/rfc/rfc7946
 *
 * transformGeometry() consumes and produces GeoJSON geometry objects, so reprojection must keep
 * every geometry RFC 7946-valid: position structure, extra ordinates, ring closure and the
 * GeometryCollection shape.
 */

const roundAll = (v: any): any => (Array.isArray(v) ? v.map(roundAll) : typeof v === 'number' ? Math.round(v) : v);

describe('RFC 7946 GeoJSON geometries through CrsTransformer', () => {
  describe('§3.1.1 positions and §3.1.2–3.1.8 geometry types under reprojection (#16, moved from crs.test.ts)', () => {
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

  describe('§3.1 geometry objects', () => {
    it('§3.1.1: positions are [longitude, latitude] in WGS 84; easting follows longitude when projecting', () => {
      const [x0] = CrsTransformer.transformCoordinate([0, 50], 'EPSG:4326', 'EPSG:3857');
      const [x10, y10] = CrsTransformer.transformCoordinate([10, 50], 'EPSG:4326', 'EPSG:3857');
      expect(Math.round(x0)).toBe(0);
      expect(Math.round(x10)).toBe(1113195);
      expect(Math.round(y10)).toBe(6446276);
    });

    it('§3.1.1: a round trip WGS 84 -> projected -> WGS 84 returns the original position', () => {
      const there = CrsTransformer.transformCoordinate([15.5, 60.5, 12], 'EPSG:4326', 'EPSG:3006');
      const back = CrsTransformer.transformCoordinate(there, 'EPSG:3006', 'EPSG:4326');
      expect(back[0]).toBeCloseTo(15.5, 6);
      expect(back[1]).toBeCloseTo(60.5, 6);
      expect(back[2]).toBe(12);
    });

    it('§3.1.3 / §3.1.5: MultiPoint and MultiLineString keep their nesting depth and every position', () => {
      const mp = CrsTransformer.transformGeometry({ type: 'MultiPoint', coordinates: [[15, 60], [16, 61]] }, 'EPSG:4326', 'EPSG:3006');
      expect(mp.type).toBe('MultiPoint');
      expect(mp.coordinates).toEqual([
        CrsTransformer.transformCoordinate([15, 60], 'EPSG:4326', 'EPSG:3006'),
        CrsTransformer.transformCoordinate([16, 61], 'EPSG:4326', 'EPSG:3006'),
      ]);
      expect(roundAll(mp.coordinates[0])).toEqual([500000, 6651411]);

      const ml = CrsTransformer.transformGeometry(
        { type: 'MultiLineString', coordinates: [[[15, 60], [16, 61]], [[15, 60], [15, 61]]] },
        'EPSG:4326',
        'EPSG:3006'
      );
      expect(ml.type).toBe('MultiLineString');
      expect(ml.coordinates).toHaveLength(2);
      ml.coordinates.forEach((line: number[][]) => expect(line).toHaveLength(2));
    });

    it('§3.1.6: a linear ring stays closed (first and last positions identical) after reprojection', () => {
      const poly = CrsTransformer.transformGeometry(
        {
          type: 'Polygon',
          coordinates: [
            [[15, 60], [16, 60], [16, 61], [15, 61], [15, 60]],
            [[15.2, 60.2], [15.2, 60.4], [15.4, 60.4], [15.4, 60.2], [15.2, 60.2]],
          ],
        },
        'EPSG:4326',
        'EPSG:3006'
      );
      expect(poly.coordinates).toHaveLength(2);
      for (const ring of poly.coordinates) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[ring.length - 1]).toEqual(ring[0]);
      }
    });

    it('§3.1.8: a GeometryCollection nested in a GeometryCollection is reprojected recursively', () => {
      const out = CrsTransformer.transformGeometry(
        { type: 'GeometryCollection', geometries: [{ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [15, 60] }] }] },
        'EPSG:4326',
        'EPSG:3006'
      );
      expect(roundAll(out.geometries![0].geometries![0].coordinates)).toEqual([500000, 6651411]);
      expect(out.coordinates).toBeUndefined();
    });

    it('§3.1.8: an empty GeometryCollection stays a valid empty collection', () => {
      expect(CrsTransformer.transformGeometry({ type: 'GeometryCollection', geometries: [] }, 'EPSG:4326', 'EPSG:3006')).toEqual({
        type: 'GeometryCollection',
        geometries: [],
      });
    });

    it('§3.1: empty coordinate arrays (empty geometries) are preserved as empty', () => {
      expect(CrsTransformer.transformGeometry({ type: 'LineString', coordinates: [] }, 'EPSG:4326', 'EPSG:3006').coordinates).toEqual([]);
    });

    it('§5: a reprojected geometry does not carry a stale bounding box from the source CRS', () => {
      const out: any = CrsTransformer.transformGeometry(
        { type: 'Point', coordinates: [15, 60], bbox: [15, 60, 15, 60] } as any,
        'EPSG:4326',
        'EPSG:3006'
      );
      if (out.bbox !== undefined) {
        expect(roundAll(out.bbox)).toEqual([500000, 6651411, 500000, 6651411]);
      }
    });
  });
});
