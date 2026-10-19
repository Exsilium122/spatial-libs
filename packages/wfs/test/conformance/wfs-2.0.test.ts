import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import CrsTransformer from '../../../crs/src/index.js';
import { findAll, RecordingProvider, startWfs, WfsResponse, WfsServer } from './helpers.js';

/**
 * OGC Web Feature Service 2.0 Interface Standard, version 2.0.2 (OGC 09-025r2 / ISO 19142)
 * https://docs.ogc.org/is/09-025r2/09-025r2.html
 *
 * Exception codes: Table 3 and OGC 06-121r3 Table 25; HTTP status codes: Annex D.3, Table D.2.
 * Includes the 2.0 tests formerly in wfs.test.ts ("handles DescribeFeatureType WFS 2.0.0 request",
 * the 2.0.0 cases of "WFS CRS Integration Tests") and in http-e2e.test.ts.
 */

const KVP = 'service=WFS&version=2.0.2';

function exception(res: WfsResponse) {
  const e = res.doc?.['ows:ExceptionReport']?.['ows:Exception'];
  return { code: e?.['@exceptionCode'], locator: e?.['@locator'], text: e?.['ows:ExceptionText'] };
}

function members(res: WfsResponse): any[] {
  return findAll(res.doc, 'wfs:member');
}

function bboxRing(provider: RecordingProvider) {
  return provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
}

describe('WFS 2.0.2 (OGC 09-025r2)', () => {
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

  describe('§6.2 Version numbering and negotiation', () => {
    it('§6.2.2: the service metadata lists version 2.0.2', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc['wfs:WFS_Capabilities'];
      expect(caps['@version']).toBe('2.0.2');
      const accept = [caps['ows:OperationsMetadata']['ows:Operation']].flat().find((o: any) => o['@name'] === 'GetCapabilities');
      expect(accept['ows:Parameter']['ows:Value']).toContain('2.0.2');
    });

    it('§6.2.3 (OWS 06-121r3 §7.3.2): without a version GetCapabilities answers with the highest supported version', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities');
      expect(res.doc['wfs:WFS_Capabilities']['@version']).toBe('2.0.2');
    });

    it('[GAP] §6.2.3: AcceptVersions=2.0.0,1.1.0 is answered with 2.0.0 (the response says 2.0.2)', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities&AcceptVersions=2.0.0,1.1.0');
      expect(res.doc['wfs:WFS_Capabilities']['@version']).toBe('2.0.0');
    });

    it('[GAP] §6.2.2: a request (other than GetCapabilities) with an unsupported version raises InvalidParameterValue', async () => {
      const res = await wfs.get('service=WFS&version=3.0.0&request=GetFeature&typeNames=ns:trees');
      expect(exception(res).code).toBe('InvalidParameterValue');
    });
  });

  describe('§6.2.5 KVP parameter encoding rules', () => {
    it('§6.2.5.2: parameter names are not case sensitive', async () => {
      const a = await wfs.get(`${KVP}&request=GetFeature&TYPENAMES=ns:trees`);
      const b = await wfs.get('SERVICE=WFS&Version=2.0.2&REQUEST=GetFeature&typenames=ns:trees');
      expect(members(a)).toHaveLength(3);
      expect(b.body).toBe(a.body);
    });

    it('§6.2.5.2 / §7.6.6: unknown (vendor-specific) parameters are ignored', async () => {
      const plain = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`);
      const vsp = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&myVendorParam=1`);
      expect(vsp.body).toBe(plain.body);
    });
  });

  describe('§7.5 Exception reporting and Annex D.3 HTTP status codes', () => {
    it('§7.5: errors are an ows:ExceptionReport (OWS 1.1) with an exceptionCode and an ExceptionText', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature`);
      const report = res.doc['ows:ExceptionReport'];
      expect(report['@xmlns:ows']).toBe('http://www.opengis.net/ows/1.1');
      expect(['2.0.0', '2.0.2']).toContain(report['@version']);
      expect(exception(res).code).toBeTruthy();
      expect(exception(res).text).toBeTruthy();
    });

    it('D.3: a successful operation is answered with HTTP 200', async () => {
      expect((await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`)).status).toBe(200);
    });

    it('Table 3 / D.2: an invalid filter value is InvalidParameterValue with HTTP 400', async () => {
      const filter = '<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"><fes:PropertyIsEqualTo><fes:PropertyName>$where</fes:PropertyName><fes:Literal>1</fes:Literal></fes:PropertyIsEqualTo></fes:Filter>';
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&filter=${encodeURIComponent(filter)}`);
      expect(res.status).toBe(400);
      expect(exception(res).code).toBe('InvalidParameterValue');
    });

    it('Table 3 / D.2: a badly formed XML request is OperationParsingFailed with HTTP 400', async () => {
      const res = await wfs.post('<wfs:GetFeature service="WFS" version="2.0.2"><unclosed>');
      expect(res.status).toBe(400);
      expect(res.body).toContain('OperationParsingFailed');
    });

    it('[GAP] OWS Table 25: a missing mandatory parameter (TYPENAMES) is MissingParameterValue, not code "300"', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature`);
      expect(res.status).toBe(400);
      expect(exception(res).code).toBe('MissingParameterValue');
    });

    it('an operation the server does not offer is answered with an exception report and HTTP 400', async () => {
      const res = await wfs.get(`${KVP}&request=Transaction`);
      expect(res.status).toBe(400);
      expect(exception(res).text).toContain('Unsupported or invalid WFS request');
    });

    it('[GAP] OWS Table 25: an operation the server does not offer is OperationNotSupported', async () => {
      const res = await wfs.get(`${KVP}&request=Transaction`);
      expect(exception(res).code).toBe('OperationNotSupported');
    });

    it('[GAP] Table 3: a processing failure in the data store is OperationProcessingFailed with a 5xx/403 status', async () => {
      provider.failWith = new Error('connection to db-internal:5432 refused');
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`);
      expect(res.body).not.toContain('db-internal');
      expect(exception(res).code).toBe('OperationProcessingFailed');
      expect(res.status === 403 || res.status >= 500).toBe(true);
    });
  });

  describe('§7.6.2 Base request parameters', () => {
    it('[GAP] §7.6.2.4: SERVICE is mandatory; omitting it is MissingParameterValue', async () => {
      const res = await wfs.get('version=2.0.2&request=GetFeature&typeNames=ns:trees');
      expect(exception(res).code).toBe('MissingParameterValue');
    });

    it('[GAP] §7.6.2.4: SERVICE other than "WFS" is InvalidParameterValue', async () => {
      const res = await wfs.get('service=WMS&version=2.0.2&request=GetFeature&typeNames=ns:trees');
      expect(exception(res).code).toBe('InvalidParameterValue');
    });

    it('[GAP] §7.6.2.5: VERSION is mandatory for every operation except GetCapabilities', async () => {
      const res = await wfs.get('service=WFS&request=GetFeature&typeNames=ns:trees');
      expect(exception(res).code).toBe('MissingParameterValue');
    });
  });

  describe('§7.6.3 Standard presentation parameters', () => {
    it('[GAP] §7.6.3.5: COUNT limits the number of features presented', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&count=2`);
      expect(members(res)).toHaveLength(2);
      expect(res.doc['wfs:FeatureCollection']['@numberReturned']).toBe('2');
    });

    it('[GAP] §7.6.3.4: STARTINDEX starts presenting results at that index (0-based)', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&startIndex=1`);
      expect(findAll(res.doc, '@gml:id').filter((id: string) => id.startsWith('trees_'))).toEqual(['trees_t2', 'trees_t3']);
    });

    it('[GAP] §7.6.3.6: RESULTTYPE=hits returns no members, numberReturned=0 and the total in numberMatched', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&resultType=hits`);
      const fc = res.doc['wfs:FeatureCollection'];
      expect(members(res)).toHaveLength(0);
      expect(fc['@numberReturned']).toBe('0');
      expect(fc['@numberMatched']).toBe('3');
    });

    it('§7.6.3.6: RESULTTYPE=results (the default) presents the features with numberMatched >= numberReturned', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&resultType=results`);
      const fc = res.doc['wfs:FeatureCollection'];
      expect(Number(fc['@numberMatched'])).toBeGreaterThanOrEqual(Number(fc['@numberReturned']));
    });

    it('§7.6.3.7: the default OUTPUTFORMAT application/gml+xml; version=3.2 is supported', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&outputFormat=${encodeURIComponent('application/gml+xml; version=3.2')}`);
      expect(res.status).toBe(200);
      expect(members(res)).toHaveLength(3);
    });
  });

  describe('§7.7 Standard response parameters', () => {
    it('§7.7.4.3: numberReturned is the number of features presented', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`);
      expect(res.doc['wfs:FeatureCollection']['@numberReturned']).toBe(String(members(res).length));
    });

    it('§7.7.4.2: numberMatched reports the total number of matching features', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&featureId=t1`);
      expect(res.doc['wfs:FeatureCollection']['@numberMatched']).toBe('1');
    });

    it('[GAP] §7.7.4.1: timeStamp reports when the response collection was generated (required by wfs.xsd)', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`);
      expect(Date.parse(res.doc['wfs:FeatureCollection']['@timeStamp'])).not.toBeNaN();
    });

    it('[GAP] §7.8: the response references the GML application schema (DescribeFeatureType) in xsi:schemaLocation', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`);
      expect(res.doc['wfs:FeatureCollection']['@xsi:schemaLocation']).toContain('DescribeFeatureType');
    });
  });

  describe('§7.2 Resource identifiers', () => {
    it('§7.2.2: every feature carries a unique gml:id that is a valid XML NCName', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`);
      const ids = members(res).map((m: any) => m['ns:trees']['@gml:id']);
      expect(ids).toEqual(['trees_t1', 'trees_t2', 'trees_t3']);
      for (const id of ids) expect(id).toMatch(/^[A-Za-z_][\w.-]*$/);
    });
  });

  describe('§7.9.2 Ad hoc query expressions (KVP and XML)', () => {
    it('[GAP] §7.9.2.3: RESOURCEID selects features by identifier (TYPENAMES may be omitted)', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&resourceId=t2`);
      expect(res.status).toBe(200);
      expect(provider.lastCall()?.fids).toEqual(['t2']);
    });

    it('[GAP] §7.9.2.4.1: a TYPENAMES value not advertised in the capabilities is InvalidParameterValue', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:unknown`);
      expect(exception(res).code).toBe('InvalidParameterValue');
    });

    it('§7.9.2.4.1: the XML typeNames attribute of wfs:Query selects the feature type', async () => {
      const res = await wfs.post(
        `<wfs:GetFeature service="WFS" version="2.0.2" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0">
           <wfs:Query typeNames="ns:trees"><fes:Filter><fes:ResourceId rid="t1"/></fes:Filter></wfs:Query>
         </wfs:GetFeature>`,
        'application/xml'
      );
      expect(res.status).toBe(200);
      expect(provider.lastCall()).toMatchObject({ featureType: 'trees', fids: ['t1'] });
    });

    it('FEATUREID (WFS 1.x KVP, still accepted) fetches the listed features', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&featureId=t2`);
      expect(provider.lastCall().fids).toEqual(['t2']);
      expect(members(res)).toHaveLength(1);
    });

    describe('BBOX', () => {
      it('a BBOX with the CRS84 (lon/lat) suffix becomes a spatial selection', async () => {
        await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&bbox=10,50,12,52,urn:ogc:def:crs:OGC:1.3:CRS84`);
        expect(bboxRing(provider)).toEqual([[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]]);
      });

      it('a BBOX with the urn:ogc:def:crs:EPSG::4326 suffix is read in latitude/longitude order', async () => {
        await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&bbox=50,10,52,12,urn:ogc:def:crs:EPSG::4326`);
        expect(bboxRing(provider)[0]).toEqual([10, 50]);
      });

      it('[GAP] Table 8 note c: a BBOX without CRS suffix is in the DefaultCRS (urn:ogc:def:crs:EPSG::4326, lat/lon)', async () => {
        await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees&bbox=10,50,12,52`);
        // Read as lat 10..12 / lon 50..52 in the advertised lat/lon DefaultCRS.
        expect(bboxRing(provider)[0]).toEqual([50, 10]);
      });
    });

    describe('§7.9.2.4.4 srsName', () => {
      it('without srsName geometries are encoded in the advertised default CRS', async () => {
        const res = await crs.get(`${KVP}&request=GetFeature&typeNames=trees-ns:trees&featureId=t1`);
        expect(res.body).toContain('srsName="urn:ogc:def:crs:EPSG::4326"');
      });

      it('srsName=urn:ogc:def:crs:EPSG::3006 reprojects the returned geometries', async () => {
        const res = await crs.get(`${KVP}&request=GetFeature&typename=trees-ns:trees&srsName=urn:ogc:def:crs:EPSG::3006`);
        expect(res.status).toBe(200);
        expect(res.body).toContain('srsName="urn:ogc:def:crs:EPSG::3006"');
        expect(res.body).toContain('180917');
        expect(res.body).toContain('5603903');
      });

      it('srsName in the http://www.opengis.net/def/crs/epsg/0/{code} form is understood', async () => {
        const res = await crs.get(`${KVP}&request=GetFeature&typeNames=trees-ns:trees&srsName=${encodeURIComponent('http://www.opengis.net/def/crs/epsg/0/3006')}`);
        expect(res.status).toBe(200);
        expect(res.body).toContain('180917');
      });

      it('an unsupported srsName is answered with an exception', async () => {
        const res = await crs.get(`${KVP}&request=GetFeature&typeNames=trees-ns:trees&srsName=urn:ogc:def:crs:EPSG::99999`);
        expect(res.status).toBe(400);
        expect(exception(res).text).toContain('Unsupported SRS requested');
      });
    });
  });

  describe('§7.9.3.6 GetFeatureById stored query (mandatory for every server)', () => {
    it('[GAP] STOREDQUERY_ID=http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById&ID=t1 returns that single feature', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&storedQuery_id=${encodeURIComponent('http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById')}&id=t1`);
      expect(res.status).toBe(200);
      expect(res.doc['ns:trees']?.['@gml:id']).toBe('trees_t1');
    });

    it('[GAP] Table 3 / D.2: GetFeatureById for an unknown identifier is NotFound with HTTP 404', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&storedQuery_id=${encodeURIComponent('http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById')}&id=nope`);
      expect(res.status).toBe(404);
      expect(exception(res).code).toBe('NotFound');
    });

    it('[GAP] Simple WFS conformance: ListStoredQueries is offered and lists GetFeatureById', async () => {
      const res = await wfs.get(`${KVP}&request=ListStoredQueries`);
      expect(res.body).toContain('GetFeatureById');
    });
  });

  describe('§8 GetCapabilities', () => {
    it('§8.3: lists the GetCapabilities, DescribeFeatureType and GetFeature operations with HTTP bindings', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc['wfs:WFS_Capabilities'];
      const ops = [caps['ows:OperationsMetadata']['ows:Operation']].flat();
      expect(ops.map((o: any) => o['@name'])).toEqual(['GetCapabilities', 'DescribeFeatureType', 'GetFeature']);
      const getFeature = ops.find((o: any) => o['@name'] === 'GetFeature');
      expect(getFeature['ows:DCP']['ows:HTTP']['ows:Get']['@xlink:href']).toBe(`${wfs.root}?`);
      expect(getFeature['ows:DCP']['ows:HTTP']['ows:Post']['@xlink:href']).toBe(wfs.root);
    });

    it('§8.3.4: every feature type is listed with a WGS84BoundingBox', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc['wfs:WFS_Capabilities'];
      const types = [caps['wfs:FeatureTypeList']['wfs:FeatureType']].flat();
      expect(types).toHaveLength(2);
      for (const t of types) expect(t['ows:WGS84BoundingBox']).toEqual({ 'ows:LowerCorner': '10 50', 'ows:UpperCorner': '12 52' });
    });

    it('§8.3.4: the CRSs the server can reproject to are advertised as URNs', async () => {
      const res = await crs.get('service=WFS&version=2.0.0&request=GetCapabilities');
      expect(res.status).toBe(200);
      expect(res.body).toContain('urn:ogc:def:crs:EPSG::4326');
      expect(res.body).toContain('urn:ogc:def:crs:EPSG::3006');
      expect(res.body).toContain('urn:ogc:def:crs:EPSG::3857');
    });

    it('[GAP] §8.3.4: FeatureType children are wfs:Name / wfs:DefaultCRS / wfs:OtherCRS (WFS 2.0 names, in the wfs namespace)', async () => {
      const caps = (await crs.get(`${KVP}&request=GetCapabilities`)).doc['wfs:WFS_Capabilities'];
      const [first] = [caps['wfs:FeatureTypeList']['wfs:FeatureType']].flat();
      expect(first['wfs:Name']).toBe('trees-ns:trees');
      expect(first['wfs:DefaultCRS']).toBe('urn:ogc:def:crs:EPSG::4326');
      expect([first['wfs:OtherCRS']].flat()).toContain('urn:ogc:def:crs:EPSG::3006');
    });

    it('FES 2.0 §7.14: the filter capabilities declare the implemented FES conformance classes', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc['wfs:WFS_Capabilities'];
      const constraints = [caps['fes:Filter_Capabilities']['fes:Conformance']['fes:Constraint']].flat();
      expect(constraints.map((c: any) => c['@name'])).toEqual(expect.arrayContaining(['ImplementsQuery', 'ImplementsAdHocQuery']));
    });
  });

  describe('§9 DescribeFeatureType', () => {
    it('returns the GML 3.2 application schema of the requested type', async () => {
      const res = await crs.get('service=WFS&version=2.0.0&request=DescribeFeatureType&typename=trees-ns:trees');
      expect(res.status).toBe(200);
      expect(res.contentType).toContain('text/xml');
      expect(res.body).toContain('<element name="trees"');
      expect(res.body).toContain('type="trees-ns:trees_Type"');
      expect(res.body).toContain('substitutionGroup="gml:AbstractFeature"');
    });

    it('describes LineString geometry properties as gml:CurvePropertyType', async () => {
      const res = await wfs.get(`${KVP}&request=DescribeFeatureType&typeNames=ns:roads`);
      expect(res.body).toContain('gml:CurvePropertyType');
    });

    it('[GAP] §9.2.4.1: without TYPENAMES the complete application schema (all types) is returned', async () => {
      const res = await wfs.get(`${KVP}&request=DescribeFeatureType`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('name="trees"');
      expect(res.body).toContain('name="roads"');
    });
  });

  describe('§11 GetFeature response', () => {
    it('§11.2: is a wfs:FeatureCollection with one wfs:member per feature and a boundedBy envelope', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:trees`);
      const fc = res.doc['wfs:FeatureCollection'];
      expect(fc['@xmlns:wfs']).toBe('http://www.opengis.net/wfs/2.0');
      expect(fc['wfs:boundedBy']['gml:Envelope']).toBeDefined();
      expect(members(res)).toHaveLength(3);
    });

    it('encodes LineString geometries as a GML 3.2 posList with a gml:id', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeNames=ns:roads`);
      expect(res.body).toContain('<gml:LineString gml:id="l_r1"');
      expect(res.body).toMatch(/<gml:posList>50\.1 10\.1 50\.2 10\.2 50\.3 10\.3<\/gml:posList>/);
    });
  });
});
