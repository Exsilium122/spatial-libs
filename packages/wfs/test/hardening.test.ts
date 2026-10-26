import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import createWfsRouter, { dispatchWfsRequest, handleWfs100, handleWfs110, handleWfs200 } from '../src/index.js';
import { SpatialDataProvider, GeoJSONFeature, BoundingBox, WfsOptions } from '../src/types.js';
import { parseFilterObj, FilterValidationError } from '../src/filterParser.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

class HardeningMockProvider implements SpatialDataProvider {
  public calls: { method: string; args: any[] }[] = [];
  public supportedTypes: string[] = ['trees'];
  public featuresToReturn: GeoJSONFeature[] = [];

  reset() {
    this.calls = [];
    this.supportedTypes = ['trees'];
    this.featuresToReturn = [
      {
        id: 'tree1',
        geometry: { type: 'Point', coordinates: [10.5, 50.5] },
        properties: {
          name: 'Oak',
          valid_ncname: 'ok',
          'props.nested_val': 'also-ok',
          '123_invalid_lead_digit': 'dropped',
          'has space': 'dropped',
          'bad<tag>name': 'dropped',
          'dollar$prop': 'dropped',
        },
      },
    ];
  }

  async getSupportedTypes(context: any): Promise<string[]> {
    this.calls.push({ method: 'getSupportedTypes', args: [context] });
    return this.supportedTypes;
  }

  async getBoundingBox(context: any, featureType: string): Promise<BoundingBox> {
    this.calls.push({ method: 'getBoundingBox', args: [context, featureType] });
    return { minLon: 10, minLat: 50, maxLon: 12, maxLat: 52 };
  }

  async getFeatures(
    context: any,
    featureType: string,
    fids?: string[],
    filterQuery?: any
  ): Promise<GeoJSONFeature[]> {
    this.calls.push({ method: 'getFeatures', args: [context, featureType, fids, filterQuery] });
    return this.featuresToReturn;
  }

  async getGeometryType(context: any, featureType: string): Promise<'Point' | 'LineString'> {
    this.calls.push({ method: 'getGeometryType', args: [context, featureType] });
    return 'Point';
  }

  async getPropertiesSchema(
    context: any,
    featureType: string
  ): Promise<Record<string, 'string' | 'integer' | 'double' | 'boolean'>> {
    this.calls.push({ method: 'getPropertiesSchema', args: [context, featureType] });
    return {
      name: 'string',
      valid_ncname: 'string',
      '123_invalid_lead_digit': 'string',
    };
  }
}

describe('WFS Security Hardening & Limits', () => {
  const provider = new HardeningMockProvider();
  const options: WfsOptions = {
    provider,
    baseUrl: 'http://localhost:9000/wfs',
    xmlOptions: {
      namespaces: {
        ns: 'http://example.com/ns',
      },
    },
  };

  beforeEach(() => {
    provider.reset();
  });

  describe('1) Authorization check: getSupportedTypes across DescribeFeatureType & GetFeature', () => {
    it('rejects unadvertised feature type in DescribeFeatureType across v1.0.0, v1.1.0, and v2.0.0 without calling provider methods', async () => {
      // WFS 1.0.0
      const res100 = await handleWfs100(
        { method: 'GET', query: { REQUEST: 'DescribeFeatureType', TYPENAME: 'ns:unadvertised' }, user: { role: 'guest' } },
        options
      );
      expect(res100.status).toBe(400);
      expect(res100.body).toContain('InvalidParameterValue');
      expect(res100.body).toContain('not advertised');
      expect(provider.calls.some((c) => c.method === 'getPropertiesSchema' || c.method === 'getFeatures')).toBe(false);
      expect(provider.calls.some((c) => c.method === 'getSupportedTypes')).toBe(true);

      // WFS 1.1.0
      provider.reset();
      const res110 = await handleWfs110(
        { method: 'GET', query: { REQUEST: 'DescribeFeatureType', TYPENAME: 'ns:unadvertised' }, user: { role: 'guest' } },
        options
      );
      expect(res110.status).toBe(400);
      expect(res110.body).toContain('InvalidParameterValue');
      expect(res110.body).toContain('not advertised');
      expect(provider.calls.some((c) => c.method === 'getPropertiesSchema' || c.method === 'getFeatures')).toBe(false);

      // WFS 2.0.0
      provider.reset();
      const res200 = await handleWfs200(
        { method: 'GET', query: { REQUEST: 'DescribeFeatureType', TYPENAMES: 'ns:unadvertised', VERSION: '2.0.0' }, user: { role: 'guest' } },
        options
      );
      expect(res200.status).toBe(400);
      expect(res200.body).toContain('InvalidParameterValue');
      expect(res200.body).toContain('not advertised');
      expect(provider.calls.some((c) => c.method === 'getPropertiesSchema' || c.method === 'getFeatures')).toBe(false);
    });

    it('rejects unadvertised feature type in GetFeature across v1.0.0, v1.1.0, and v2.0.0 without calling getFeatures/getBoundingBox', async () => {
      // WFS 1.0.0
      const res100 = await handleWfs100(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAME: 'ns:secret_layer' }, user: { id: 42 } },
        options
      );
      expect(res100.status).toBe(400);
      expect(res100.body).toContain('InvalidParameterValue');
      expect(res100.body).toContain('not advertised');
      expect(provider.calls.some((c) => c.method === 'getFeatures' || c.method === 'getBoundingBox')).toBe(false);
      expect(provider.calls.find((c) => c.method === 'getSupportedTypes')?.args[0]).toEqual({ id: 42 });

      // WFS 1.1.0
      provider.reset();
      const res110 = await handleWfs110(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAME: 'ns:secret_layer' } },
        options
      );
      expect(res110.status).toBe(400);
      expect(res110.body).toContain('InvalidParameterValue');
      expect(res110.body).toContain('not advertised');
      expect(provider.calls.some((c) => c.method === 'getFeatures' || c.method === 'getBoundingBox')).toBe(false);

      // WFS 2.0.0
      provider.reset();
      const res200 = await handleWfs200(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAMES: 'ns:secret_layer', VERSION: '2.0.0' } },
        options
      );
      expect(res200.status).toBe(400);
      expect(res200.body).toContain('InvalidParameterValue');
      expect(res200.body).toContain('not advertised');
      expect(provider.calls.some((c) => c.method === 'getFeatures' || c.method === 'getBoundingBox')).toBe(false);
    });
  });

  describe('2) v2_0_0.ts StoredQuery GetFeatureById primitive string assertion and coercion', () => {
    it('strictly asserts primitive string/number on query.ID and coerces via String()', async () => {
      // Coerces number primitive 123 into string '123'
      const resValidNum = await handleWfs200(
        {
          method: 'GET',
          query: {
            REQUEST: 'GetFeature',
            STOREDQUERY_ID: 'http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById',
            ID: 123 as any,
          },
        },
        options
      );
      expect(resValidNum.status).toBe(200);
      const getFeaturesCall = provider.calls.find((c) => c.method === 'getFeatures');
      expect(getFeaturesCall?.args[2]).toEqual(['123']);

      // Rejects object ID (NoSQL injection attempt: ID[$ne]=null)
      provider.reset();
      const resObj = await handleWfs200(
        {
          method: 'GET',
          query: {
            REQUEST: 'GetFeature',
            STOREDQUERY_ID: 'http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById',
            ID: { $ne: null } as any,
          },
        },
        options
      );
      expect(resObj.status).toBe(400);
      expect(resObj.body).toContain('InvalidParameterValue');
      expect(provider.calls.some((c) => c.method === 'getFeatures')).toBe(false);

      // Rejects array ID
      provider.reset();
      const resArr = await handleWfs200(
        {
          method: 'GET',
          query: {
            REQUEST: 'GetFeature',
            STOREDQUERY_ID: 'http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById',
            ID: ['tree1', 'tree2'] as any,
          },
        },
        options
      );
      expect(resArr.status).toBe(400);
      expect(resArr.body).toContain('InvalidParameterValue');
      expect(provider.calls.some((c) => c.method === 'getFeatures')).toBe(false);
    });
  });

  describe('3) XML NCName validation on feature.properties keys', () => {
    it('drops invalid NCName property keys in v1.0.0, v1.1.0, and v2.0.0 XML outputs', async () => {
      // WFS 1.0.0
      const res100 = await handleWfs100(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAME: 'ns:trees' } },
        options
      );
      expect(res100.status).toBe(200);
      expect(res100.body).toContain('<ns:name>Oak</ns:name>');
      expect(res100.body).toContain('<ns:valid_ncname>ok</ns:valid_ncname>');
      expect(res100.body).toContain('<ns:props.nested_val>also-ok</ns:props.nested_val>');
      expect(res100.body).not.toContain('123_invalid_lead_digit');
      expect(res100.body).not.toContain('has space');
      expect(res100.body).not.toContain('bad<tag>name');
      expect(res100.body).not.toContain('dollar$prop');

      // WFS 1.1.0
      provider.reset();
      const res110 = await handleWfs110(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAME: 'ns:trees' } },
        options
      );
      expect(res110.status).toBe(200);
      expect(res110.body).toContain('<wfs:name>Oak</wfs:name>');
      expect(res110.body).toContain('<wfs:valid_ncname>ok</wfs:valid_ncname>');
      expect(res110.body).not.toContain('123_invalid_lead_digit');
      expect(res110.body).not.toContain('has space');
      expect(res110.body).not.toContain('bad<tag>name');

      // WFS 2.0.0
      provider.reset();
      const res200 = await handleWfs200(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAMES: 'ns:trees' } },
        options
      );
      expect(res200.status).toBe(200);
      expect(res200.body).toContain('<ns:name>Oak</ns:name>');
      expect(res200.body).toContain('<ns:valid_ncname>ok</ns:valid_ncname>');
      expect(res200.body).not.toContain('123_invalid_lead_digit');
      expect(res200.body).not.toContain('has space');
      expect(res200.body).not.toContain('bad<tag>name');
    });
  });

  describe('4) Maximum body size enforcement & package.json peerDependencies', () => {
    it('returns HTTP 413 for oversized POST bodies in Express router', async () => {
      const app = express();
      app.use('/wfs', createWfsRouter({ ...options, maxBodyBytes: 150 }));
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wfs`;

      try {
        const largeXml = `<wfs:GetCapabilities service="WFS" version="1.1.0">${' '.repeat(200)}</wfs:GetCapabilities>`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: largeXml,
        });
        expect(res.status).toBe(413);
        const text = await res.text();
        expect(text).toContain('maximum allowed size');
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      }
    });

    it('returns HTTP 413 in dispatchWfsRequest for oversized body string', async () => {
      const res = await dispatchWfsRequest(
        {
          method: 'POST',
          query: {},
          body: `<wfs:GetCapabilities service="WFS" version="1.1.0">${'x'.repeat(300)}</wfs:GetCapabilities>`,
        },
        { ...options, maxBodyBytes: 100 }
      );
      expect(res.status).toBe(413);
      expect(res.body).toContain('maximum allowed size');
    });

    it('verifies packages/wfs/package.json removed ^0.3.0 from express-xml-bodyparser peerDependencies', () => {
      const pkgJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
      expect(pkgJson.peerDependencies['express-xml-bodyparser']).toBe('^0.4.1');
      expect(pkgJson.peerDependencies['express-xml-bodyparser']).not.toContain('0.3.0');
    });
  });

  describe('5) Maximum recursion depth of 32 nodes on XML filter trees', () => {
    it('allows filter trees up to 32 nodes deep and rejects trees exceeding 32 levels', async () => {
      // 10 nested Ands - within limit
      let shallowFilter = '<PropertyIsEqualTo><PropertyName>name</PropertyName><Literal>Oak</Literal></PropertyIsEqualTo>';
      for (let i = 0; i < 10; i++) {
        shallowFilter = `<And>${shallowFilter}</And>`;
      }
      shallowFilter = `<Filter>${shallowFilter}</Filter>`;

      const resShallow = await dispatchWfsRequest(
        {
          method: 'GET',
          query: {
            REQUEST: 'GetFeature',
            SERVICE: 'WFS',
            VERSION: '1.1.0',
            TYPENAMES: 'ns:trees',
            FILTER: shallowFilter,
          },
        },
        options
      );
      expect(resShallow.status).toBe(200);

      // Deeply nested filter (> 32 levels)
      let deepFilter = '<PropertyIsEqualTo><PropertyName>name</PropertyName><Literal>Oak</Literal></PropertyIsEqualTo>';
      for (let i = 0; i < 35; i++) {
        deepFilter = `<And>${deepFilter}</And>`;
      }
      deepFilter = `<Filter>${deepFilter}</Filter>`;

      const resDeep = await dispatchWfsRequest(
        {
          method: 'GET',
          query: {
            REQUEST: 'GetFeature',
            SERVICE: 'WFS',
            VERSION: '1.1.0',
            TYPENAMES: 'ns:trees',
            FILTER: deepFilter,
          },
        },
        options
      );
      expect(resDeep.status).toBe(400);
      expect(resDeep.body).toContain('InvalidParameterValue');
      expect(resDeep.body).toContain('maximum recursion depth of 32');

      // Direct parseFilterObj test
      let deepObj: any = { PropertyIsEqualTo: { PropertyName: 'name', Literal: 'Oak' } };
      for (let i = 0; i < 35; i++) {
        deepObj = { And: deepObj };
      }
      expect(() => parseFilterObj(deepObj)).toThrow(FilterValidationError);
    });
  });

  describe('6) options.defaultCount / options.maxCount capping', () => {
    beforeEach(() => {
      provider.featuresToReturn = Array.from({ length: 1500 }, (_, i) => ({
        id: `tree_${i}`,
        geometry: { type: 'Point', coordinates: [10, 50] },
        properties: { name: `Tree ${i}` },
      }));
    });

    it('caps unbounded queries at default 1000 features when COUNT/MAXFEATURES is omitted', async () => {
      // 1.0.0
      const res100 = await handleWfs100(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAME: 'ns:trees' } },
        options
      );
      expect(res100.status).toBe(200);
      const matches100 = res100.body.match(/<gml:featureMember>/g);
      expect(matches100?.length).toBe(1000);

      // 1.1.0
      const res110 = await handleWfs110(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAME: 'ns:trees' } },
        options
      );
      expect(res110.status).toBe(200);
      const matches110 = res110.body.match(/<gml:featureMember>/g);
      expect(matches110?.length).toBe(1000);

      // 2.0.0
      const res200 = await handleWfs200(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAMES: 'ns:trees' } },
        options
      );
      expect(res200.status).toBe(200);
      expect(res200.body).toContain('numberReturned="1000"');
      expect(res200.body).toContain('numberMatched="1500"');
    });

    it('respects custom options.defaultCount and options.maxCount', async () => {
      const customOptions: WfsOptions = {
        ...options,
        defaultCount: 25,
        maxCount: 200,
      };

      // When omitted, caps at defaultCount = 25
      const resDefault = await handleWfs200(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAMES: 'ns:trees' } },
        customOptions
      );
      expect(resDefault.body).toContain('numberReturned="25"');

      // When client asks for 500, capped at maxCount = 200
      const resCapped = await handleWfs200(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAMES: 'ns:trees', COUNT: '500' } },
        customOptions
      );
      expect(resCapped.body).toContain('numberReturned="200"');

      // When client asks for 10 (below maxCount), returns 10
      const resExplicit = await handleWfs200(
        { method: 'GET', query: { REQUEST: 'GetFeature', TYPENAMES: 'ns:trees', COUNT: '10' } },
        customOptions
      );
      expect(resExplicit.body).toContain('numberReturned="10"');
    });
  });
});
