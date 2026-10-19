import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { probeTarget } from '../src/probing.js';

vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

describe('probeTarget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Error branches', () => {
    it('throws 401 Unauthorized when endpoint requires Basic Authentication', async () => {
      mockedAxios.get.mockRejectedValue({
        response: { status: 401, statusText: 'Unauthorized' }
      });

      await expect(probeTarget('http://localhost:8080')).rejects.toMatchObject({
        message: 'Unauthorized',
        statusCode: 401
      });
    });

    it('returns empty result when endpoint is unreachable / connection refused', async () => {
      mockedAxios.get.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8080'));

      const result = await probeTarget('http://localhost:8080');
      expect(result.wfsUrl).toBeUndefined();
      expect(result.ogcUrl).toBeUndefined();
      expect(result.wfsVersions).toEqual([]);
      expect(result.collections).toEqual([]);
    });

    it('passes Authorization header when credentials are provided', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Not found'));

      await probeTarget('http://localhost:8080', { user: 'admin', pass: 'secret' });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}`
          }
        })
      );
    });
  });

  describe('WFS GetCapabilities XML collection discovery', () => {
    it('discovers collections, protocols, projections, and bbox from namespaced WFS 2.0.0 XML', async () => {
      const wfsXml200 = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1" version="2.0.0">
  <wfs:FeatureTypeList>
    <wfs:FeatureType>
      <wfs:Name>workspace:forests</wfs:Name>
      <wfs:Title>National Forests</wfs:Title>
      <wfs:DefaultSRS>urn:ogc:def:crs:EPSG::4326</wfs:DefaultSRS>
      <wfs:OtherSRS>urn:ogc:def:crs:EPSG::3857</wfs:OtherSRS>
      <wfs:WGS84BoundingBox>
        <wfs:LowerCorner>12.5 45.0</wfs:LowerCorner>
        <wfs:UpperCorner>14.5 46.5</wfs:UpperCorner>
      </wfs:WGS84BoundingBox>
    </wfs:FeatureType>
  </wfs:FeatureTypeList>
</wfs:WFS_Capabilities>`;

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('request=GetCapabilities')) {
          if (url.includes('version=2.0.0')) {
            return {
              status: 200,
              data: wfsXml200
            };
          }
          throw new Error('Unsupported version');
        }
        // OGC candidates fail
        throw new Error('Not an OGC endpoint');
      });

      const result = await probeTarget('http://localhost:8080/wfs');

      expect(result.wfsUrl).toBe('http://localhost:8080/wfs');
      expect(result.wfsVersions).toContain('2.0.0');
      expect(result.collections).toHaveLength(1);

      const col = result.collections[0];
      expect(col.name).toBe('forests');
      expect(col.protocols).toEqual(['wfs2.0.0']);
      expect(col.projections).toContain('EPSG:4326');
      expect(col.projections).toContain('EPSG:3857');
      expect(col.bbox).toEqual([12.5, 45.0, 14.5, 46.5]);
    });

    it('discovers collections and bbox from WFS 1.0.0 XML with LatLongBoundingBox', async () => {
      const wfsXml100 = `<?xml version="1.0" encoding="UTF-8"?>
<WFS_Capabilities version="1.0.0">
  <FeatureTypeList>
    <FeatureType>
      <Name>rivers</Name>
      <SRS>EPSG:4326</SRS>
      <SRS>EPSG:2154</SRS>
      <LatLongBoundingBox minx="-5.5" miny="42.0" maxx="8.5" maxy="51.0"/>
    </FeatureType>
  </FeatureTypeList>
</WFS_Capabilities>`;

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('request=GetCapabilities')) {
          if (url.includes('version=1.1.0')) {
            // initial probe check for 1.1.0 candidate check
            return { status: 200, data: '<Capabilities>version 1.1.0</Capabilities>' };
          }
          if (url.includes('version=1.0.0')) {
            return { status: 200, data: wfsXml100 };
          }
          throw new Error('Version probe failed');
        }
        throw new Error('OGC failed');
      });

      const result = await probeTarget('http://localhost:8080/api/wfs');

      expect(result.wfsUrl).toBe('http://localhost:8080/api/wfs');
      expect(result.wfsVersions).toContain('1.0.0');
      expect(result.collections).toHaveLength(1);

      const col = result.collections[0];
      expect(col.name).toBe('rivers');
      expect(col.protocols).toEqual(['wfs1.0.0']);
      expect(col.projections).toEqual(['EPSG:4326', 'EPSG:2154']);
      expect(col.bbox).toEqual([-5.5, 42.0, 8.5, 51.0]);
    });
  });

  describe('OGC API Features collection discovery', () => {
    it('discovers collections, protocols, projections, and bbox from OGC /collections JSON', async () => {
      const landingData = {
        title: 'Spatial OGC Server',
        links: [
          { rel: 'self', href: 'http://localhost:8080/ogc' },
          { rel: 'data', href: 'http://localhost:8080/ogc/collections' }
        ]
      };

      const collectionsData = {
        collections: [
          {
            id: 'lakes',
            title: 'Freshwater Lakes',
            crs: [
              'http://www.opengis.net/def/crs/EPSG/4326',
              'http://www.opengis.net/def/crs/EPSG/3857'
            ],
            extent: {
              spatial: {
                bbox: [[-122.5, 37.0, -121.5, 38.0]]
              }
            }
          }
        ]
      };

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url === 'http://localhost:8080/ogc') {
          return { status: 200, data: landingData };
        }
        if (url === 'http://localhost:8080/ogc/collections') {
          return { status: 200, data: collectionsData };
        }
        // WFS probes fail
        throw new Error('Not WFS');
      });

      const result = await probeTarget('http://localhost:8080/ogc');

      expect(result.ogcUrl).toBe('http://localhost:8080/ogc');
      expect(result.collections).toHaveLength(1);

      const col = result.collections[0];
      expect(col.name).toBe('lakes');
      expect(col.protocols).toEqual(['ogc']);
      expect(col.projections).toEqual(['EPSG:4326', 'EPSG:3857']);
      expect(col.bbox).toEqual([-122.5, 37.0, -121.5, 38.0]);
    });

    it('merges protocols and projections when the same collection is discovered via both WFS and OGC', async () => {
      const ogcLanding = {
        links: [{ rel: 'data', href: 'http://localhost:8080/collections' }]
      };
      const ogcCollections = {
        collections: [
          {
            id: 'roads',
            crs: ['http://www.opengis.net/def/crs/EPSG/0/4326'],
            extent: { spatial: { bbox: [[10.0, 20.0, 30.0, 40.0]] } }
          }
        ]
      };
      const wfsXml = `<?xml version="1.0" encoding="UTF-8"?>
<WFS_Capabilities version="2.0.0">
  <FeatureTypeList>
    <FeatureType>
      <Name>roads</Name>
      <DefaultSRS>EPSG:3857</DefaultSRS>
      <WGS84BoundingBox>
        <LowerCorner>10.0 20.0</LowerCorner>
        <UpperCorner>30.0 40.0</UpperCorner>
      </WGS84BoundingBox>
    </FeatureType>
  </FeatureTypeList>
</WFS_Capabilities>`;

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url === 'http://localhost:8080') {
          return { status: 200, data: ogcLanding };
        }
        if (url === 'http://localhost:8080/collections') {
          return { status: 200, data: ogcCollections };
        }
        if (url.includes('request=GetCapabilities')) {
          if (url.includes('version=2.0.0')) {
            return { status: 200, data: wfsXml };
          }
          throw new Error('Unsupported version');
        }
        throw new Error('Not found');
      });

      const result = await probeTarget('http://localhost:8080');

      expect(result.ogcUrl).toBe('http://localhost:8080');
      expect(result.wfsUrl).toBe('http://localhost:8080');
      expect(result.collections).toHaveLength(1);

      const col = result.collections[0];
      expect(col.name).toBe('roads');
      expect(col.protocols).toContain('ogc');
      expect(col.protocols).toContain('wfs2.0.0');
      expect(col.projections).toContain('EPSG:4326');
      expect(col.projections).toContain('EPSG:3857');
      expect(col.bbox).toEqual([10.0, 20.0, 30.0, 40.0]);
    });
  });
});
