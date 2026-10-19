import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { runSmokeTests, SmokeTestConfig } from '../src/smoke.js';

vi.mock('axios');

const mockedAxios = vi.mocked(axios, { deep: true });

describe('runSmokeTests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs global and collection smoke tests for WFS 2.0.0 and 1.1.0 with XML parsing', async () => {
    const describeFeatureTypeXml = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:wfs="http://www.opengis.net/wfs/2.0" targetNamespace="http://example.com/spatial">
  <xs:complexType name="ForestsType">
    <xs:sequence>
      <xs:element name="name" type="xs:string"/>
      <xs:element name="area" type="xs:double"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

    const getCapabilitiesXml = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1" version="2.0.0">
  <ows:ServiceIdentification>
    <ows:Title>WFS Server</ows:Title>
  </ows:ServiceIdentification>
</wfs:WFS_Capabilities>`;

    const getFeatureXml = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" numberMatched="1" numberReturned="1">
  <wfs:member>
    <forests gml:id="forests.1">
      <name>Black Forest</name>
    </forests>
  </wfs:member>
</wfs:FeatureCollection>`;

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('request=GetCapabilities')) {
        return { status: 200, data: getCapabilitiesXml };
      }
      if (url.includes('request=DescribeFeatureType')) {
        return { status: 200, data: describeFeatureTypeXml };
      }
      if (url.includes('request=GetFeature')) {
        return { status: 200, data: getFeatureXml };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const config: SmokeTestConfig = {
      url: 'http://localhost:8080/wfs',
      wfsUrl: 'http://localhost:8080/wfs',
      collections: [
        {
          name: 'forests',
          protocols: ['wfs2.0.0', 'wfs1.1.0'],
          srs: 'EPSG:4326',
          bbox: [10.0, 40.0, 20.0, 50.0]
        }
      ]
    };

    const results = await runSmokeTests(config);

    expect(results).toHaveLength(3); // Global WFS + WFS 2.0.0 collection + WFS 1.1.0 collection
    expect(results.every(r => r.passed)).toBe(true);
    expect(results[0].target).toBe('WFS - GetCapabilities Global');
    expect(results[1].target).toContain('WFS2.0.0 - forests (EPSG:4326)');
    expect(results[2].target).toContain('WFS1.1.0 - forests (EPSG:4326)');
  });

  it('reports failure when DescribeFeatureType returns unparseable or empty XML', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('request=GetCapabilities')) {
        return { status: 200, data: '<WFS_Capabilities/>' };
      }
      if (url.includes('request=DescribeFeatureType')) {
        return { status: 200, data: '' };
      }
      return { status: 200, data: '' };
    });

    const config: SmokeTestConfig = {
      url: 'http://localhost:8080/wfs',
      wfsUrl: 'http://localhost:8080/wfs',
      collections: [
        {
          name: 'rivers',
          protocols: ['wfs2.0.0'],
          srs: 'EPSG:4326'
        }
      ]
    };

    const results = await runSmokeTests(config);

    expect(results[0].passed).toBe(true); // Global GetCapabilities passes
    expect(results[1].passed).toBe(false); // Collection smoke test fails due to schema XML parsing failure
    expect(results[1].message).toContain('Schema XML parsing failed');
  });

  it('runs OGC API Features smoke tests successfully', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === 'http://localhost:8080/ogc') {
        return { status: 200, data: { links: [{ rel: 'self', href: url }] } };
      }
      if (url === 'http://localhost:8080/ogc/conformance') {
        return { status: 200, data: { conformsTo: ['http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core'] } };
      }
      if (url === 'http://localhost:8080/ogc/collections/parcels') {
        return { status: 200, data: { id: 'parcels', title: 'Land Parcels' } };
      }
      if (url.includes('/collections/parcels/items')) {
        return {
          status: 200,
          data: {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', id: 1, properties: { name: 'Parcel A' } }]
          }
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const config: SmokeTestConfig = {
      url: 'http://localhost:8080/ogc',
      ogcUrl: 'http://localhost:8080/ogc',
      collections: [
        {
          name: 'parcels',
          protocols: ['ogc'],
          srs: 'EPSG:4326',
          bbox: [5.0, 45.0, 6.0, 46.0]
        }
      ]
    };

    const results = await runSmokeTests(config);

    expect(results).toHaveLength(3); // Landing + Conformance + OGC Collection
    expect(results.every(r => r.passed)).toBe(true);
    expect(results[0].target).toBe('OGC - Landing Page Global');
    expect(results[1].target).toBe('OGC - Conformance Global');
    expect(results[2].target).toBe('OGC - parcels (EPSG:4326)');
  });
});
