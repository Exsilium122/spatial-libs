import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchWfsRequest, handleWfs100, handleWfs110, handleWfs200 } from '../src/index.js';
import { SpatialDataProvider, GeoJSONFeature, BoundingBox } from '../src/types.js';

class SecurityMockProvider implements SpatialDataProvider {
  public lastFilterQuery: any = undefined;
  public getFeaturesCalled = false;

  reset(): void {
    this.lastFilterQuery = undefined;
    this.getFeaturesCalled = false;
  }

  async getSupportedTypes(_context: any): Promise<string[]> {
    return ['trees'];
  }

  async getBoundingBox(_context: any, _featureType: string): Promise<BoundingBox> {
    return {
      minLon: 10.0,
      minLat: 50.0,
      maxLon: 12.0,
      maxLat: 52.0,
    };
  }

  async getFeatures(
    _context: any,
    _featureType: string,
    fids?: string[],
    filterQuery?: any
  ): Promise<GeoJSONFeature[]> {
    this.getFeaturesCalled = true;
    this.lastFilterQuery = filterQuery;

    const allTrees: GeoJSONFeature[] = [
      {
        id: 'tree1',
        geometry: {
          type: 'Point',
          coordinates: [10.5, 50.5],
        },
        properties: {
          name: 'Oak Tree',
          'props.height_m': 15,
          'tree-type': 'deciduous',
        },
      },
      {
        id: 'tree2',
        geometry: {
          type: 'Point',
          coordinates: [11.5, 51.5],
        },
        properties: {
          name: 'Pine Tree',
          'props.height_m': 25,
          'tree-type': 'conifer',
        },
      },
    ];

    if (fids && fids.length > 0) {
      return allTrees.filter((t) => fids.includes(String(t.id)));
    }
    return allTrees;
  }

  async getGeometryType(_context: any, _featureType: string): Promise<'Point' | 'LineString'> {
    return 'Point';
  }

  async getPropertiesSchema(
    _context: any,
    _featureType: string
  ): Promise<Record<string, 'string' | 'integer' | 'double' | 'boolean'>> {
    return {
      name: 'string',
      'props.height_m': 'double',
      'tree-type': 'string',
    };
  }
}

describe('WFS Filter Security Hardening', () => {
  const provider = new SecurityMockProvider();
  const options = {
    provider,
    baseUrl: 'http://localhost:9000/wfs',
    appUrl: 'http://localhost:9000',
    xmlOptions: {
      namespaces: {
        'trees-ns': 'http://example.com/trees',
      },
    },
  };

  beforeEach(() => {
    provider.reset();
  });

  describe('NoSQL Operator Injection in PropertyName', () => {
    it('rejects $where in GET FILTER with 400 InvalidParameterValue and never calls getFeatures', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>$where</PropertyName><Literal>1</Literal></PropertyIsEqualTo></Filter>',
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(400);
      expect(res.body).toContain('InvalidParameterValue');
      expect(res.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);
    });

    it('rejects $expr in GET FILTER with 400 InvalidParameterValue and never calls getFeatures', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>$expr</PropertyName><Literal>1</Literal></PropertyIsEqualTo></Filter>',
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(400);
      expect(res.body).toContain('InvalidParameterValue');
      expect(res.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);
    });

    it('rejects a.__proto__.b in GET FILTER with 400 InvalidParameterValue and never calls getFeatures', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>a.__proto__.b</PropertyName><Literal>1</Literal></PropertyIsEqualTo></Filter>',
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(400);
      expect(res.body).toContain('InvalidParameterValue');
      expect(res.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);
    });

    it('rejects $where across WFS 1.0.0, 1.1.0, and 2.0.0 direct handlers', async () => {
      const req100 = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          TYPENAME: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>$where</PropertyName><Literal>1</Literal></PropertyIsEqualTo></Filter>',
        },
      };
      const res100 = await handleWfs100(req100, options);
      expect(res100.status).toBe(400);
      expect(res100.body).toContain('code="InvalidParameterValue"');
      expect(res100.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);

      const req110 = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          TYPENAME: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>$where</PropertyName><Literal>1</Literal></PropertyIsEqualTo></Filter>',
        },
      };
      const res110 = await handleWfs110(req110, options);
      expect(res110.status).toBe(400);
      expect(res110.body).toContain('code="InvalidParameterValue"');
      expect(res110.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);

      const req200 = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>$where</PropertyName><Literal>1</Literal></PropertyIsEqualTo></Filter>',
        },
      };
      const res200 = await handleWfs200(req200, options);
      expect(res200.status).toBe(400);
      expect(res200.body).toContain('exceptionCode="InvalidParameterValue"');
      expect(res200.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);
    });

    it('rejects invalid PropertyName in BBOX filter with 400 InvalidParameterValue', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><BBOX><PropertyName>$where</PropertyName><Box><coordinates>10,50 12,52</coordinates></Box></BBOX></Filter>',
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(400);
      expect(res.body).toContain('InvalidParameterValue');
      expect(res.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);
    });
  });

  describe('Prototype Pollution in normalizeKeys', () => {
    it('prevents prototype pollution from POST body containing __proto__ and constructor elements', async () => {
      expect(({} as any).polluted).toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();

      const req = {
        method: 'POST' as const,
        query: {},
        body: {
          'wfs:getfeature': {
            $: { version: '1.1.0' },
            'wfs:query': [
              {
                $: { typeName: 'trees-ns:trees' },
                'ogc:filter': [
                  {
                    __proto__: { polluted: 'yes' },
                    constructor: { prototype: { polluted: 'yes' } },
                    prototype: { polluted: 'yes' },
                    'ogc:PropertyIsEqualTo': {
                      'ogc:PropertyName': 'name',
                      'ogc:Literal': 'Oak Tree',
                    },
                  },
                ],
              },
            ],
          },
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(200);
      expect(({} as any).polluted).toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect(provider.getFeaturesCalled).toBe(true);
      expect(provider.lastFilterQuery).toEqual({ name: 'Oak Tree' });
    });
  });

  describe('Literal Validation', () => {
    it('rejects object literal (nested element inside Literal) with 400 InvalidParameterValue', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>name</PropertyName><Literal><nested>bad</nested></Literal></PropertyIsEqualTo></Filter>',
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(400);
      expect(res.body).toContain('InvalidParameterValue');
      expect(res.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);
    });
  });

  describe('Valid Property Names', () => {
    it('allows valid property names (name, props.height_m, tree-type) and filters normally', async () => {
      // 1. Simple name
      const req1 = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>name</PropertyName><Literal>Oak Tree</Literal></PropertyIsEqualTo></Filter>',
        },
      };
      const res1 = await dispatchWfsRequest(req1, options);
      expect(res1.status).toBe(200);
      expect(provider.getFeaturesCalled).toBe(true);
      expect(provider.lastFilterQuery).toEqual({ name: 'Oak Tree' });

      // 2. Dot-separated path
      provider.reset();
      const req2 = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsGreaterThan><PropertyName>props.height_m</PropertyName><Literal>15</Literal></PropertyIsGreaterThan></Filter>',
        },
      };
      const res2 = await dispatchWfsRequest(req2, options);
      expect(res2.status).toBe(200);
      expect(provider.getFeaturesCalled).toBe(true);
      expect(provider.lastFilterQuery).toEqual({ 'props.height_m': { $gt: 15 } });

      // 3. Hyphenated name
      provider.reset();
      const req3 = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsEqualTo><PropertyName>tree-type</PropertyName><Literal>deciduous</Literal></PropertyIsEqualTo></Filter>',
        },
      };
      const res3 = await dispatchWfsRequest(req3, options);
      expect(res3.status).toBe(200);
      expect(provider.getFeaturesCalled).toBe(true);
      expect(provider.lastFilterQuery).toEqual({ 'tree-type': 'deciduous' });
    });
  });

  describe('PropertyIsLike ReDoS & Length Bounding', () => {
    it('supports PropertyIsLike with Oak* and yields a matching regex', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsLike><PropertyName>name</PropertyName><Literal>Oak*</Literal></PropertyIsLike></Filter>',
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(200);
      expect(provider.getFeaturesCalled).toBe(true);
      expect(provider.lastFilterQuery.name).toBeDefined();
      expect(provider.lastFilterQuery.name.$regex).toBeInstanceOf(RegExp);
      expect(provider.lastFilterQuery.name.$regex.test('Oak Tree')).toBe(true);
      expect(provider.lastFilterQuery.name.$regex.test('Pine Tree')).toBe(false);
    });

    it('collapses runs of consecutive wildcards to prevent catastrophic backtracking', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: '<Filter><PropertyIsLike><PropertyName>name</PropertyName><Literal>Oak***</Literal></PropertyIsLike></Filter>',
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(200);
      expect(provider.getFeaturesCalled).toBe(true);
      expect(provider.lastFilterQuery.name.$regex.source).toBe('^Oak.*$');
      expect(provider.lastFilterQuery.name.$regex.test('Oak Tree')).toBe(true);
    });

    it('handles pathological PropertyIsLike pattern fast (< 100 ms)', async () => {
      const pathological = '*a'.repeat(100); // 200 characters <= 256
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: `<Filter><PropertyIsLike><PropertyName>name</PropertyName><Literal>${pathological}</Literal></PropertyIsLike></Filter>`,
        },
      };

      const start = performance.now();
      const res = await dispatchWfsRequest(req, options);
      const elapsed = performance.now() - start;

      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(100);
      expect(provider.getFeaturesCalled).toBe(true);
    });

    it('produces a regex that evaluates adversarial values in linear time', async () => {
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: `<Filter><PropertyIsLike><PropertyName>name</PropertyName><Literal>${'*ba'.repeat(30)}*c</Literal></PropertyIsLike></Filter>`,
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(200);
      const re: RegExp = provider.lastFilterQuery.name.$regex;

      const start = performance.now();
      expect(re.test('ba'.repeat(2000))).toBe(false);
      expect(re.test('a'.repeat(5000))).toBe(false);
      expect(performance.now() - start).toBeLessThan(100);

      expect(re.test('ba'.repeat(30) + 'c')).toBe(true);
      expect(re.test('xx' + 'ba'.repeat(31) + 'yyc')).toBe(true);
    });

    it('keeps glob semantics for multi-wildcard patterns', async () => {
      const like = async (pattern: string) => {
        await dispatchWfsRequest({
          method: 'GET' as const,
          query: {
            REQUEST: 'GetFeature',
            SERVICE: 'WFS',
            VERSION: '1.1.0',
            TYPENAMES: 'trees-ns:trees',
            FILTER: `<Filter><PropertyIsLike><PropertyName>name</PropertyName><Literal>${pattern}</Literal></PropertyIsLike></Filter>`,
          },
        }, options);
        return provider.lastFilterQuery.name.$regex as RegExp;
      };

      expect((await like('a*b*c')).test('aXbYc')).toBe(true);
      expect((await like('a*b*c')).test('aXcYb')).toBe(false);
      expect((await like('*ab*ab')).test('xabab')).toBe(true);
      expect((await like('*ab*ab')).test('xab')).toBe(false);
      expect((await like('a.b%')).test('a.bc')).toBe(true);
      expect((await like('a.b%')).test('axbc')).toBe(false);
    });

    it('rejects PropertyIsLike literal > 256 characters with 400 InvalidParameterValue', async () => {
      const longLiteral = 'a'.repeat(257);
      const req = {
        method: 'GET' as const,
        query: {
          REQUEST: 'GetFeature',
          SERVICE: 'WFS',
          VERSION: '1.1.0',
          TYPENAMES: 'trees-ns:trees',
          FILTER: `<Filter><PropertyIsLike><PropertyName>name</PropertyName><Literal>${longLiteral}</Literal></PropertyIsLike></Filter>`,
        },
      };

      const res = await dispatchWfsRequest(req, options);
      expect(res.status).toBe(400);
      expect(res.body).toContain('InvalidParameterValue');
      expect(res.body).toContain('locator="filter"');
      expect(provider.getFeaturesCalled).toBe(false);
    });
  });
});
