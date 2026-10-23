import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import CrsTransformer from '../../../crs/src/index.js';
import { findAll, RecordingProvider, startWfs, WfsServer } from './helpers.js';

/**
 * OpenGIS Web Feature Service Implementation Specification 1.1.0 (OGC 04-094)
 * https://docs.ogc.org/is/04-094/04-094.pdf
 *
 * Includes the 1.1.0 tests formerly in wfs.test.ts ("handles GetFeature WFS 1.1.0 request" and the
 * 1.1.0 cases of "WFS CRS Integration Tests") and in http-e2e.test.ts (posList, AcceptVersions, BBOX).
 */

const KVP = 'service=WFS&version=1.1.0';

function bboxRing(provider: RecordingProvider) {
  return provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
}

describe('WFS 1.1.0 (OGC 04-094)', () => {
  const provider = new RecordingProvider();
  let wfs: WfsServer;
  let crs: WfsServer;

  beforeAll(async () => {
    wfs = await startWfs({ provider });
    crs = await startWfs({ provider, crsTransformer: CrsTransformer, xmlOptions: { namespaces: { 'trees-ns': 'http://example.com/trees' } } });
  });

  afterAll(async () => {
    await wfs.stop();
    await crs.stop();
  });

  beforeEach(() => provider.reset());

  describe('§6.2.4 Version negotiation (OWS AcceptVersions)', () => {
    it('AcceptVersions=1.1.0,1.0.0 is answered with 1.1.0, the highest listed version the server supports', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities&AcceptVersions=1.1.0,1.0.0');
      expect(res.doc.WFS_Capabilities['@version']).toBe('1.1.0');
    });

    it('AcceptVersions=1.0.0 is answered with 1.0.0', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities&AcceptVersions=1.0.0');
      expect(res.doc.WFS_Capabilities['@version']).toBe('1.0.0');
    });

    it('[GAP] AcceptVersions listing no supported version raises VersionNegotiationFailed', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities&AcceptVersions=0.5.0');
      expect(res.body).toContain('VersionNegotiationFailed');
    });
  });

  describe('§7.7 Exception reporting', () => {
    it('[GAP] errors are an OWS ExceptionReport version 1.1.0 with Exception/ExceptionText (not a 1.0 ServiceExceptionReport)', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature`);
      const report = res.doc.ExceptionReport ?? res.doc['ows:ExceptionReport'];
      expect(report['@version']).toBe('1.1.0');
      expect(findAll(report, 'ExceptionText').concat(findAll(report, 'ows:ExceptionText'))).toHaveLength(1);
    });

    it('a request without TYPENAME (and no FEATUREID) is answered with an exception, not data', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature`);
      expect(res.status).toBe(400);
      expect(res.body).toMatch(/ExceptionReport/);
      expect(provider.calls).toHaveLength(0);
    });
    it('an operation the service does not offer (Transaction over KVP) is reported as an exception', async () => {
      const res = await wfs.get(`${KVP}&request=Transaction`);
      expect(res.status).toBe(400);
      expect(res.body).toContain('Unsupported or invalid WFS request');
    });
  });

  describe('§13 GetCapabilities', () => {
    it('reports version 1.1.0 with ServiceIdentification and OperationsMetadata', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc.WFS_Capabilities;
      expect(caps['@version']).toBe('1.1.0');
      expect(caps['ows:ServiceIdentification']['ows:ServiceType']).toBe('WFS');
      expect(caps['ows:ServiceIdentification']['ows:ServiceTypeVersion']).toBe('1.1.0');
      const ops = [caps['ows:OperationsMetadata']['ows:Operation']].flat().map((o: any) => o['@name']);
      expect(ops).toEqual(['GetCapabilities', 'DescribeFeatureType', 'GetFeature']);
    });

    it('lists every feature type with DefaultSRS and a WGS84BoundingBox', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc.WFS_Capabilities;
      const types = [caps.FeatureTypeList.FeatureType].flat();
      expect(types).toHaveLength(2);
      for (const t of types) {
        expect(t.DefaultSRS).toBe('EPSG:4326');
        expect(t['ows:WGS84BoundingBox']).toEqual({ 'ows:LowerCorner': '10 50', 'ows:UpperCorner': '12 52' });
      }
    });

    it('advertises every CRS it can reproject to as OtherSRS', async () => {
      const res = await crs.get(`${KVP}&request=GetCapabilities`);
      expect(res.status).toBe(200);
      const types = [res.doc.WFS_Capabilities.FeatureTypeList.FeatureType].flat();
      expect(types[0].DefaultSRS).toBe('EPSG:4326');
      expect([types[0].OtherSRS].flat()).toContain('EPSG:3006');
    });
  });

  describe('§8 DescribeFeatureType', () => {
    it('returns a GML 3.1.1 application schema for the requested type', async () => {
      const res = await wfs.get(`${KVP}&request=DescribeFeatureType&typeName=ns:roads`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('roads');
      expect(res.body).toContain('gml:LineStringPropertyType');
    });

    it('[GAP] without TYPENAME every feature type is described', async () => {
      const res = await wfs.get(`${KVP}&request=DescribeFeatureType`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('trees');
      expect(res.body).toContain('roads');
    });
  });

  describe('§9 GetFeature', () => {
    it('returns a wfs:FeatureCollection of GML 3 features with fid and gml:Point/gml:pos', async () => {
      const res = await crs.get(`${KVP}&request=GetFeature&typename=trees-ns:trees`);
      expect(res.status).toBe(200);
      expect(res.contentType).toContain('text/xml');
      expect(res.body).toContain('<wfs:FeatureCollection');
      expect(res.body).toContain('<wfs:trees xmlns:wfs="http://example.com/trees" fid="t1"');
      expect(res.body).toContain('<gml:Point');
      expect(res.body).toContain('<gml:pos>50.5 10.5</gml:pos>');
    });

    it('encodes LineString geometries as a GML 3 posList', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:roads`);
      expect(res.body).toContain('<gml:LineString');
      expect(res.body).toMatch(/<gml:posList>50\.1 10\.1 50\.2 10\.2 50\.3 10\.3<\/gml:posList>/);
    });

    it('FEATUREID fetches the listed feature instances', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&featureId=t2`);
      expect(provider.lastCall().fids).toEqual(['t2']);
      expect(res.body).toContain('Pine');
      expect(res.body).not.toContain('Oak');
    });

    it('[GAP] §9.2 resultType=hits returns an empty FeatureCollection carrying numberOfFeatures and timeStamp', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&resultType=hits`);
      const fc = res.doc['wfs:FeatureCollection'];
      expect(fc['@numberOfFeatures']).toBe('3');
      expect(fc['@timeStamp']).toBeDefined();
      expect(findAll(fc, 'gml:featureMember')).toHaveLength(0);
    });

    it('§9.3 the optional numberOfFeatures, when present, counts the features in the response', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees`);
      const count = res.doc['wfs:FeatureCollection']['@numberOfFeatures'];
      if (count !== undefined) expect(count).toBe('3');
      expect(findAll(res.doc, 'gml:featureMember')).toHaveLength(3);
    });

    it('[GAP] §9.2 maxFeatures=N truncates the result set after N features', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&maxFeatures=2`);
      expect(findAll(res.doc, 'gml:featureMember')).toHaveLength(2);
    });

    it('[GAP] §14.7.3 SORTBY orders the features (name D = descending)', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&sortBy=name%20D`);
      expect(findAll(res.doc, '@fid')).toEqual(['t2', 't1', 't3']);
    });

    describe('SRSNAME', () => {
      it('without SRSNAME geometries use the DefaultSRS of the feature type', async () => {
        const res = await crs.get(`${KVP}&request=GetFeature&typename=trees-ns:trees&featureId=t1`);
        expect(res.body).toContain('srsName="EPSG:4326"');
      });

      it('SRSNAME=EPSG:3006 (an advertised OtherSRS) reprojects the returned geometries', async () => {
        const res = await crs.get(`${KVP}&request=GetFeature&typename=trees-ns:trees&srsname=EPSG:3006`);
        expect(res.status).toBe(200);
        expect(res.body).toContain('srsName="EPSG:3006"');
        // [10.5, 50.5] in SWEREF 99 TM is [180917.x, 5603903.x]
        expect(res.body).toContain('180917');
        expect(res.body).toContain('5603903');
      });

      it('an SRSNAME that is neither DefaultSRS nor an OtherSRS is answered with an exception', async () => {
        const res = await crs.get(`${KVP}&request=GetFeature&typename=trees-ns:trees&srsname=EPSG:99999`);
        expect(res.status).toBe(400);
        expect(res.body).toContain('Unsupported SRS requested');
        expect(res.body).toContain('exceptionCode="InvalidParameterValue"');
        expect(res.body).toContain('locator="srsName"');
      });

      it('the srsName attribute of an XML-encoded wfs:Query is honoured the same way', async () => {
        const res = await crs.post(
          `<wfs:GetFeature service="WFS" version="1.1.0" xmlns:wfs="http://www.opengis.net/wfs">
             <wfs:Query typeName="trees-ns:trees" srsName="EPSG:3006"/>
           </wfs:GetFeature>`
        );
        expect(res.body).toContain('srsName="EPSG:3006"');
        expect(res.body).toContain('180917');
      });
    });

    describe('BBOX (OWS BoundingBox KVP: minx,miny,maxx,maxy[,crs])', () => {
      it('a lon/lat box selects within it', async () => {
        await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=10,50,12,52`);
        expect(bboxRing(provider)).toEqual([[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]]);
      });

      it('a box with the urn:x-ogc:def:crs:EPSG:4326 CRS suffix is read in latitude/longitude order', async () => {
        await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=50,10,52,12,urn:x-ogc:def:crs:EPSG:4326`);
        expect(bboxRing(provider)[0]).toEqual([10, 50]);
      });

      it('[GAP] the axis order follows the CRS suffix, not the magnitude of the values (EPSG:4326 short form = lon/lat)', async () => {
        await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=50,10,52,12,EPSG:4326`);
        expect(bboxRing(provider)[0]).toEqual([50, 10]);
      });

      it('a non-numeric BBOX is not passed to the data store as NaN', async () => {
        await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=10,foo,12,52`);
        expect(provider.lastCall().filterQuery).toEqual({});
      });

      it('returns InvalidParameterValue for invalid BBOX coordinate bounds (minX >= maxX or minY >= maxY)', async () => {
        const res1 = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=12,50,10,52`);
        expect(res1.status).toBe(400);
        expect(res1.body).toContain('exceptionCode="InvalidParameterValue"');
        expect(res1.body).toContain('locator="bbox"');

        const res2 = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=10,52,12,50`);
        expect(res2.status).toBe(400);
        expect(res2.body).toContain('exceptionCode="InvalidParameterValue"');
        expect(res2.body).toContain('locator="bbox"');
      });
    });
  });
});
