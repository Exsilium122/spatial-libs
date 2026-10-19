import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import createWfsRouter from '../src/index.js';
import { SpatialDataProvider, BoundingBox, GeoJSONFeature, WfsOptions } from '../src/types.js';

/**
 * End-to-end tests: a real Express server with createWfsRouter mounted, driven over HTTP.
 * Every request goes through the real query normalization and express-xml-bodyparser stack.
 */

const FEATURES: Record<string, GeoJSONFeature[]> = {
  trees: [
    { id: 't1', geometry: { type: 'Point', coordinates: [10.5, 50.5] }, properties: { name: 'Oak', height: 12 } },
    { id: 't2', geometry: { type: 'Point', coordinates: [11.5, 51.5] }, properties: { name: 'Pine', height: null } },
  ],
  roads: [
    {
      id: 'r1',
      geometry: { type: 'LineString', coordinates: [[10.1, 50.1], [10.2, 50.2], [10.3, 50.3]] },
      properties: { name: 'Main St' },
    },
  ],
};

class RecordingProvider implements SpatialDataProvider {
  calls: { featureType: string; fids?: string[]; filterQuery?: any }[] = [];
  failWith: Error | null = null;

  async getSupportedTypes(): Promise<string[]> {
    return Object.keys(FEATURES);
  }

  async getBoundingBox(): Promise<BoundingBox> {
    return { minLon: 10, minLat: 50, maxLon: 12, maxLat: 52 };
  }

  async getFeatures(context: any, featureType: string, fids?: string[], filterQuery?: any): Promise<GeoJSONFeature[]> {
    this.calls.push({ featureType, fids, filterQuery });
    if (this.failWith) throw this.failWith;
    const all = FEATURES[featureType] || [];
    return fids && fids.length > 0 ? all.filter((f) => fids.includes(String(f.id))) : all;
  }

  async getGeometryType(context: any, featureType: string): Promise<'LineString' | 'Point'> {
    return featureType === 'roads' ? 'LineString' : 'Point';
  }

  async getPropertiesSchema(): Promise<Record<string, 'string' | 'integer' | 'double' | 'boolean'>> {
    return { name: 'string', height: 'integer' };
  }

  lastCall() {
    return this.calls[this.calls.length - 1];
  }
}

function startServer(options: WfsOptions) {
  const app = express();
  app.use('/wfs', createWfsRouter(options));
  const server = http.createServer(app);
  let base = '';
  return {
    async start() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wfs`;
    },
    async stop() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
    get(query: string) {
      return fetch(`${base}?${query}`);
    },
    post(xml: string, contentType = 'text/xml') {
      return fetch(base, { method: 'POST', headers: { 'Content-Type': contentType }, body: xml });
    },
  };
}

const NS = 'xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml"';

function getFeaturePost(version: string, filter: string, typeAttr = 'typeName') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature service="WFS" version="${version}" ${NS}>
  <wfs:Query ${typeAttr}="ns:trees">
    <ogc:Filter>${filter}</ogc:Filter>
  </wfs:Query>
</wfs:GetFeature>`;
}

describe('WFS end-to-end over HTTP (createWfsRouter + Express)', () => {
  const provider = new RecordingProvider();
  const server = startServer({ provider, baseUrl: 'https://api.example.com/wfs' });

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    provider.calls = [];
    provider.failWith = null;
  });

  describe('GetCapabilities', () => {
    it.each(['1.0.0', '1.1.0', '2.0.0'])('lists every provider feature type for WFS %s', async (version) => {
      const res = await server.get(`service=WFS&request=GetCapabilities&version=${version}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/xml');
      const body = await res.text();
      expect(body).toContain('trees');
      expect(body).toContain('roads');
    });

    it('negotiates the version from AcceptVersions and defaults to 2.0.x without one', async () => {
      const negotiated = await (await server.get('service=WFS&request=GetCapabilities&AcceptVersions=1.1.0,1.0.0')).text();
      expect(negotiated).toContain('version="1.1.0"');

      const defaulted = await (await server.get('service=WFS&request=GetCapabilities')).text();
      expect(defaulted).toContain('http://www.opengis.net/wfs/2.0');
    });

    it('reads the version from a POSTed GetCapabilities body', async () => {
      const res = await server.post(`<wfs:GetCapabilities service="WFS" version="1.0.0" ${NS}/>`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<WFS_Capabilities version="1.0.0"');
    });
  });

  describe('DescribeFeatureType', () => {
    it.each(['1.0.0', '1.1.0', '2.0.0'])('describes the schema of a feature type for WFS %s', async (version) => {
      const res = await server.get(`service=WFS&request=DescribeFeatureType&version=${version}&typeName=ns:roads`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('roads');
      expect(body).toContain('name');
    });
  });

  describe('GetFeature (GET)', () => {
    it('WFS 1.0.0 encodes Point and LineString geometries as GML2 coordinates', async () => {
      const points = await (await server.get('service=WFS&request=GetFeature&version=1.0.0&typeName=ns:trees')).text();
      expect(points).toContain('fid="t1"');
      expect(points).toContain('<gml:coordinates>10.5,50.5</gml:coordinates>');
      expect(points).toContain('<gml:coordinates>10,50 12,52</gml:coordinates>');
      expect(points).toContain('<ns:name>Oak</ns:name>');

      const lines = await (await server.get('service=WFS&request=GetFeature&version=1.0.0&typeName=ns:roads')).text();
      expect(lines).toContain('<gml:LineString');
      expect(lines).toContain('<gml:coordinates>10.1,50.1 10.2,50.2 10.3,50.3</gml:coordinates>');
    });

    it.each(['1.1.0', '2.0.0'])('WFS %s encodes LineString geometries as a GML3 posList', async (version) => {
      const body = await (await server.get(`service=WFS&request=GetFeature&version=${version}&typeName=ns:roads`)).text();
      expect(body).toContain('<gml:LineString');
      expect(body).toMatch(/<gml:posList>50\.1 10\.1 50\.2 10\.2 50\.3 10\.3<\/gml:posList>/);
    });

    it.each(['1.0.0', '1.1.0', '2.0.0'])('WFS %s passes FEATUREID to the provider', async (version) => {
      const body = await (await server.get(`service=WFS&request=GetFeature&version=${version}&typeName=ns:trees&featureId=t2`)).text();
      expect(provider.lastCall().fids).toEqual(['t2']);
      expect(body).toContain('t2');
      expect(body).not.toContain('Oak');
    });

    it.each(['1.0.0', '1.1.0', '2.0.0'])('WFS %s turns a lon/lat BBOX parameter into a $geoWithin polygon', async (version) => {
      await server.get(`service=WFS&request=GetFeature&version=${version}&typeName=ns:trees&bbox=10,50,12,52`);
      expect(provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates).toEqual([
        [[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]],
      ]);
    });

    it('detects lat/lon axis order in the BBOX parameter', async () => {
      await server.get('service=WFS&request=GetFeature&version=2.0.0&typeName=ns:trees&bbox=50,10,52,12,urn:ogc:def:crs:EPSG::4326');
      expect(provider.lastCall().filterQuery['geo.coordinates'].$geoWithin.$geometry.coordinates[0][0]).toEqual([10, 50]);
    });

    it('ignores a non-numeric BBOX parameter instead of passing NaN to the provider', async () => {
      await server.get('service=WFS&request=GetFeature&version=1.1.0&typeName=ns:trees&bbox=10,foo,12,52');
      expect(provider.lastCall().filterQuery).toEqual({});
    });

    it('translates logical And/Or/Not filters and a gml:Box BBOX from the FILTER parameter', async () => {
      const filter = `<ogc:Filter ${NS}>
        <ogc:And>
          <ogc:BBOX><ogc:PropertyName>geo</ogc:PropertyName><gml:Box><gml:coordinates>10,50 12,52</gml:coordinates></gml:Box></ogc:BBOX>
          <ogc:Or>
            <ogc:PropertyIsEqualTo><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>Oak</ogc:Literal></ogc:PropertyIsEqualTo>
            <ogc:PropertyIsGreaterThan><ogc:PropertyName>height</ogc:PropertyName><ogc:Literal>10</ogc:Literal></ogc:PropertyIsGreaterThan>
          </ogc:Or>
          <ogc:Not>
            <ogc:PropertyIsLessThanOrEqualTo><ogc:PropertyName>height</ogc:PropertyName><ogc:Literal>2</ogc:Literal></ogc:PropertyIsLessThanOrEqualTo>
          </ogc:Not>
        </ogc:And>
      </ogc:Filter>`;
      const res = await server.get(`service=WFS&request=GetFeature&version=1.1.0&typeName=ns:trees&filter=${encodeURIComponent(filter)}`);
      expect(res.status).toBe(200);
      expect(provider.lastCall().filterQuery).toEqual({
        $and: [
          {
            'geo.coordinates': {
              $geoWithin: { $geometry: { type: 'Polygon', coordinates: [[[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]]] } },
            },
          },
          { $or: [{ name: 'Oak' }, { height: { $gt: 10 } }] },
          { $nor: [{ height: { $lte: 2 } }] },
        ],
      });
    });
  });

  describe('GetFeature (POST XML body)', () => {
    it.each(['1.0.0', '1.1.0', '2.0.0'])('WFS %s applies an ogc:Filter comparison from the request body', async (version) => {
      const res = await server.post(
        getFeaturePost(
          version,
          '<ogc:PropertyIsEqualTo><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>Oak</ogc:Literal></ogc:PropertyIsEqualTo>'
        )
      );
      expect(res.status).toBe(200);
      expect(provider.lastCall()).toMatchObject({ featureType: 'trees', filterQuery: { name: 'Oak' } });
    });

    it.each(['1.0.0', '1.1.0'])('WFS %s applies ogc:FeatureId fid attributes from the request body', async (version) => {
      const body = await (
        await server.post(getFeaturePost(version, '<ogc:FeatureId fid="t2"/><ogc:FeatureId fid="missing"/>'))
      ).text();
      expect(provider.lastCall().fids).toEqual(['t2', 'missing']);
      expect(body).not.toContain('Oak');
    });

    it('WFS 2.0.0 applies fes:ResourceId rid attributes and the standard typeNames attribute', async () => {
      const xml = `<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0">
        <wfs:Query typeNames="ns:trees"><fes:Filter><fes:ResourceId rid="t1"/></fes:Filter></wfs:Query>
      </wfs:GetFeature>`;
      const res = await server.post(xml, 'application/xml');
      expect(res.status).toBe(200);
      expect(provider.lastCall()).toMatchObject({ featureType: 'trees', fids: ['t1'] });
    });

    it('applies logical operators from the request body', async () => {
      await server.post(
        getFeaturePost(
          '1.1.0',
          `<ogc:Or>
             <ogc:PropertyIsLike wildCard="*" singleChar="." escape="!"><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>Oa*</ogc:Literal></ogc:PropertyIsLike>
             <ogc:PropertyIsNotEqualTo><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>Pine</ogc:Literal></ogc:PropertyIsNotEqualTo>
           </ogc:Or>`
        )
      );
      const { $or } = provider.lastCall().filterQuery;
      expect($or).toHaveLength(2);
      expect($or[0].name.$regex.test('Oak')).toBe(true);
      expect($or[1]).toEqual({ name: { $ne: 'Pine' } });
    });

    it('rejects an injected PropertyName in a POST body before reaching the provider', async () => {
      const res = await server.post(
        getFeaturePost(
          '2.0.0',
          '<ogc:PropertyIsEqualTo><ogc:PropertyName>$where</ogc:PropertyName><ogc:Literal>1</ogc:Literal></ogc:PropertyIsEqualTo>'
        )
      );
      expect(await res.text()).toContain('InvalidParameterValue');
      expect(provider.calls).toHaveLength(0);
    });

    it('rejects a malformed XML body with an XML exception report instead of an HTML stack trace', async () => {
      const res = await server.post('<wfs:GetFeature version="1.1.0"><unclosed>');
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('text/xml');
      const body = await res.text();
      expect(body).toContain('code="OperationParsingFailed"');
      expect(body).not.toMatch(/<html|\bat .*\.js:\d+/i);
      expect(provider.calls).toHaveLength(0);
    });
  });

  describe('Errors and version policy', () => {
    it('returns a sanitized exception report when the provider throws', async () => {
      provider.failWith = new Error('connection to db-internal:5432 refused');
      const res = await server.get('service=WFS&request=GetFeature&version=2.0.0&typeName=ns:trees');
      const body = await res.text();
      expect(body).toContain('ExceptionReport');
      expect(body).not.toContain('db-internal');
    });

    it.each(['1.0.0', '1.1.0', '2.0.0'])('WFS %s reports an unsupported request type', async (version) => {
      const res = await server.get(`service=WFS&request=Transaction&version=${version}`);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Unsupported or invalid WFS request');
    });

    it('rejects versions disabled through enabledVersions', async () => {
      const restricted = startServer({ provider, baseUrl: 'https://api.example.com/wfs', enabledVersions: ['2.0.0'] });
      await restricted.start();
      try {
        const res = await restricted.get('service=WFS&request=GetCapabilities&version=1.0.0');
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('VersionNegotiationFailed');
        expect((await restricted.get('service=WFS&request=GetCapabilities&version=2.0.0')).status).toBe(200);
      } finally {
        await restricted.stop();
      }
    });
  });
});
