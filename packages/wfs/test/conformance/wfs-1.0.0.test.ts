import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { findAll, RecordingProvider, startWfs, WfsServer } from './helpers.js';

/**
 * OpenGIS Web Feature Service Implementation Specification 1.0.0 (OGC 02-058)
 * https://docs.ogc.org/sap/02-058/02-058.pdf
 *
 * Section numbers refer to OGC 02-058. Requirements this library does not meet yet are declared
 * with gap() (see helpers.ts and docs/standards/README.md).
 */

const KVP = 'service=WFS&version=1.0.0';

function bboxRing(provider: RecordingProvider) {
  return provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0];
}

describe('WFS 1.0.0 (OGC 02-058)', () => {
  const provider = new RecordingProvider();
  let wfs: WfsServer;

  beforeAll(async () => {
    wfs = await startWfs({ provider });
  });

  afterAll(async () => {
    await wfs.stop();
  });

  beforeEach(() => provider.reset());

  describe('§6.2.4 Version number negotiation', () => {
    it('without a version, the server answers with the highest version it understands', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities');
      expect(res.doc['wfs:WFS_Capabilities']['@version']).toBe('2.0.2');
    });

    it('rule 1: a version the server implements is answered in that version', async () => {
      const res = await wfs.get(`${KVP}&request=GetCapabilities`);
      expect(res.status).toBe(200);
      expect(res.doc.WFS_Capabilities['@version']).toBe('1.0.0');
    });

    it('[GAP] rule 2: an unknown version between known versions (1.5.0) is answered with the highest lower version (1.1.0)', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities&version=1.5.0');
      expect(res.doc.WFS_Capabilities['@version']).toBe('1.1.0');
    });

    it('[GAP] rule 2: a version above every known version (3.0.0) is answered with the highest version (2.0.2)', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities&version=3.0.0');
      expect(res.doc['wfs:WFS_Capabilities']?.['@version']).toBe('2.0.2');
    });

    it('rule 3: a version lower than any known version (0.9.0) is answered with the lowest version (1.0.0)', async () => {
      const res = await wfs.get('service=WFS&request=GetCapabilities&version=0.9.0');
      expect(res.doc.WFS_Capabilities['@version']).toBe('1.0.0');
    });
  });

  describe('§7.7 Exception reporting', () => {
    it('errors are reported as a ServiceExceptionReport version 1.2.0 in the OGC namespace', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature`);
      expect(res.contentType).toContain('text/xml');
      const report = res.doc.ServiceExceptionReport;
      expect(report['@version']).toBe('1.2.0');
      expect(report['@xmlns']).toBe('http://www.opengis.net/ogc');
      expect(report.ServiceException).toBeDefined();
    });

    it('[GAP] the exception report references the WFS 1.0.0 exception schema (OGC-exception.xsd)', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature`);
      expect(res.doc.ServiceExceptionReport['@xsi:schemaLocation']).toMatch(/wfs\/1\.0\.0\/OGC-exception\.xsd$/);
    });

    it('an operation the service does not offer (Transaction over KVP) is reported as an exception', async () => {
      const res = await wfs.get(`${KVP}&request=Transaction`);
      expect(res.status).toBe(400);
      expect(res.doc.ServiceExceptionReport.ServiceException['#text']).toContain('Unsupported or invalid WFS request');
    });
  });

  describe('§13.2.1 Parameter ordering and case', () => {
    it('parameter names are not case sensitive', async () => {
      const res = await wfs.get('SeRvIcE=WFS&VeRsIoN=1.0.0&rEqUeSt=GetCapabilities');
      expect(res.doc.WFS_Capabilities['@version']).toBe('1.0.0');
    });

    it('parameters may appear in any order', async () => {
      const a = await wfs.get(`request=GetFeature&typeName=ns:trees&${KVP}`);
      const b = await wfs.get(`${KVP}&typeName=ns:trees&request=GetFeature`);
      expect(a.body).toBe(b.body);
    });

    it('§13.3.4: parameters that are not part of the specification (vendor-specific) are ignored', async () => {
      const plain = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees`);
      const vsp = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&vendorFlag=on&x-trace=1`);
      expect(vsp.status).toBe(200);
      expect(vsp.body).toBe(plain.body);
    });
  });

  describe('§8 GetCapabilities', () => {
    it('describes the service and lists every feature type with Name, SRS and LatLongBoundingBox', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc.WFS_Capabilities;
      expect(caps.Service.Name).toBe('WFS');
      expect(caps.Service.OnlineResource).toBe(wfs.root);
      const types = [caps.FeatureTypeList.FeatureType].flat();
      expect(types.map((t: any) => t.Name)).toEqual(['ns:trees', 'ns:roads']);
      for (const t of types) {
        expect(t.SRS).toBe('EPSG:4326');
        expect(t.LatLongBoundingBox).toMatchObject({ '@minx': '10', '@miny': '50', '@maxx': '12', '@maxy': '52' });
      }
    });

    it('lists the GetCapabilities, DescribeFeatureType and GetFeature operations and the filter capabilities', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc.WFS_Capabilities;
      expect(Object.keys(caps.Capability.Request)).toEqual(['GetCapabilities', 'DescribeFeatureType', 'GetFeature']);
      expect(caps['ogc:Filter_Capabilities']['ogc:Spatial_Capabilities']['ogc:Spatial_Operators']).toHaveProperty('ogc:BBOX');
    });

    it('[GAP] every operation reachable over KVP advertises an HTTP Get DCPType (GetFeature only advertises Post)', async () => {
      const caps = (await wfs.get(`${KVP}&request=GetCapabilities`)).doc.WFS_Capabilities;
      expect(caps.Capability.Request.GetFeature.DCPType.HTTP.Get).toBeDefined();
    });
  });

  describe('§13.7.2 DescribeFeatureType', () => {
    it('TYPENAME=ns:roads returns the XML Schema of that feature type', async () => {
      const res = await wfs.get(`${KVP}&request=DescribeFeatureType&typeName=ns:roads`);
      expect(res.status).toBe(200);
      const schema = res.doc.schema;
      expect(schema.element['@name']).toBe('roads');
      expect(schema.element['@substitutionGroup']).toBe('gml:_Feature');
      expect(findAll(schema, '@name')).toEqual(expect.arrayContaining(['name', 'height']));
    });

    it('[GAP] without TYPENAME every feature type is described', async () => {
      const res = await wfs.get(`${KVP}&request=DescribeFeatureType`);
      expect(res.status).toBe(200);
      expect(findAll(res.doc, '@name')).toEqual(expect.arrayContaining(['trees', 'roads']));
    });

    it('[GAP] a comma-separated TYPENAME list describes each listed feature type', async () => {
      const res = await wfs.get(`${KVP}&request=DescribeFeatureType&typeName=ns:trees,ns:roads`);
      expect(findAll(res.doc, '@name')).toEqual(expect.arrayContaining(['trees', 'roads']));
    });
  });

  describe('§13.7.3 GetFeature (KVP)', () => {
    it('TYPENAME is mandatory without FEATUREID: omitting it is reported as an exception', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature`);
      expect(res.status).toBe(400);
      expect(res.doc.ServiceExceptionReport).toBeDefined();
      expect(provider.calls).toHaveLength(0);
    });

    it('[GAP] TYPENAME is optional when FEATUREID is given', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&featureId=t2`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('fid="t2"');
    });

    it('FEATUREID fetches the listed feature instances', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&featureId=t1,t3`);
      expect(provider.lastCall().fids).toEqual(['t1', 't3']);
      expect(findAll(res.doc, '@fid')).toEqual(['t1', 't3']);
    });

    it('[GAP] MAXFEATURES=N limits the number of features returned', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&maxFeatures=1`);
      expect(findAll(res.doc, 'gml:featureMember')).toHaveLength(1);
    });

    it('[GAP] PROPERTYNAME restricts the properties returned', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&propertyName=name`);
      expect(res.body).toContain('<ns:name>');
      expect(res.body).not.toContain('<ns:height>');
    });

    it('FILTER selects features with an OGC filter (one filter for the single TYPENAME)', async () => {
      const filter = '<Filter><PropertyIsEqualTo><PropertyName>name</PropertyName><Literal>Oak</Literal></PropertyIsEqualTo></Filter>';
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&filter=${encodeURIComponent(filter)}`);
      expect(res.status).toBe(200);
      expect(provider.lastCall().filterQuery).toEqual({ name: 'Oak' });
    });
  });

  describe('§13.3.3 Bounding box', () => {
    it('BBOX=minx,miny,maxx,maxy (EPSG:4326 longitude/latitude) selects within the box', async () => {
      await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=10,50,12,52`);
      expect(bboxRing(provider)).toEqual([[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]]);
    });

    it('accepts integers and scientific notation', async () => {
      await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=1e1,5e1,12,52`);
      expect(bboxRing(provider)[0]).toEqual([10, 50]);
    });

    it('a box crossing the anti-meridian with -180 <= Xmin < Xmax < 540 is accepted as is', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=170,-10,190,10`);
      expect(res.status).toBe(200);
      expect(bboxRing(provider)[0]).toEqual([170, -10]);
      expect(bboxRing(provider)[1]).toEqual([190, -10]);
    });

    it('[GAP] values are always minx (longitude), miny (latitude): 50,10,52,12 is not re-ordered as latitude-first', async () => {
      await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=50,10,52,12`);
      expect(bboxRing(provider)[0]).toEqual([50, 10]);
    });

    it('[GAP] an invalid box (minimum X >= maximum X, or minimum Y >= maximum Y) raises an exception', async () => {
      for (const bbox of ['12,50,10,52', '10,52,12,50', '10,50,10,52']) {
        const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&bbox=${bbox}`);
        expect(res.doc.ServiceExceptionReport, bbox).toBeDefined();
      }
    });
  });

  describe('§9.3 / §13.5 GetFeature response', () => {
    it('is a GML 2 feature collection with boundedBy and one featureMember per feature', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees`);
      expect(res.contentType).toContain('text/xml');
      expect(res.body).toContain('<gml:coordinates>10,50 12,52</gml:coordinates>');
      expect(findAll(res.doc, 'gml:featureMember')).toHaveLength(3);
      expect(res.body).toContain('fid="t1"');
      expect(res.body).toContain('<gml:coordinates>10.5,50.5</gml:coordinates>');
      expect(res.body).toContain('<ns:name>Oak</ns:name>');
    });

    it('encodes LineString geometries as GML 2 coordinate tuples', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:roads`);
      expect(res.body).toContain('<gml:LineString');
      expect(res.body).toContain('<gml:coordinates>10.1,50.1 10.2,50.2 10.3,50.3</gml:coordinates>');
    });

    it('[GAP] the root element is wfs:FeatureCollection (in the http://www.opengis.net/wfs namespace)', async () => {
      const res = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees`);
      const root = res.doc['wfs:FeatureCollection'] ?? res.doc.FeatureCollection;
      expect(res.doc['wfs:FeatureCollection'] ?? (root['@xmlns'] === 'http://www.opengis.net/wfs' ? root : undefined)).toBeDefined();
    });

    it('§13.5: the response to a KVP request is identical to the response to the equivalent XML request', async () => {
      const kvp = await wfs.get(`${KVP}&request=GetFeature&typeName=ns:trees&featureId=t1`);
      const xml = await wfs.post(
        `<wfs:GetFeature service="WFS" version="1.0.0" xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc">
           <wfs:Query typeName="ns:trees"><ogc:Filter><ogc:FeatureId fid="t1"/></ogc:Filter></wfs:Query>
         </wfs:GetFeature>`
      );
      expect(xml.body).toBe(kvp.body);
    });
  });
});
