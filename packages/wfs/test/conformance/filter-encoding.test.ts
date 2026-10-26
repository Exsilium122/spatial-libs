import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RecordingProvider, startWfs, WfsServer } from './helpers.js';

/**
 * OGC Filter Encoding, as used by the WFS GetFeature FILTER parameter and XML wfs:Query bodies:
 *
 * - FES 1.0.0 (OGC 02-059)   https://docs.ogc.org/is/02-059/02-059.zip       — WFS 1.0.0
 * - FES 1.1.0 (OGC 04-095)   https://docs.ogc.org/is/04-095/04-095.pdf       — WFS 1.1.0
 * - FES 2.0.2 (OGC 09-026r2) https://docs.ogc.org/is/09-026r2/09-026r2.html  — WFS 2.0
 *
 * The filter-semantics tests formerly in http-e2e.test.ts (KVP And/Or/Not + gml:Box, POST
 * comparisons per version, POST FeatureId, POST logical operators) live here now.
 */

const OGC = 'xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml"';
const FES = 'xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"';

describe('OGC Filter Encoding (FES 1.0 / 1.1 / 2.0) through WFS GetFeature', () => {
  const provider = new RecordingProvider();
  let wfs: WfsServer;

  /** KVP GetFeature (WFS 1.1.0) with an ogc:Filter; returns the filter handed to the data store. */
  async function kvp(filterBody: string, version = '1.1.0') {
    const filter = `<ogc:Filter ${OGC}>${filterBody}</ogc:Filter>`;
    const res = await wfs.get(`service=WFS&version=${version}&request=GetFeature&typeName=ns:trees&filter=${encodeURIComponent(filter)}`);
    return { res, query: provider.lastCall()?.filterQuery, call: provider.lastCall() };
  }

  /** XML-encoded GetFeature POST; FES 2.0 for version 2.0.x, ogc (FES 1.x) otherwise. */
  async function post(filterBody: string, version = '1.1.0') {
    const two = version.startsWith('2.');
    const body = two
      ? `<wfs:GetFeature service="WFS" version="${version}" xmlns:wfs="http://www.opengis.net/wfs/2.0" ${FES}>
           <wfs:Query typeNames="ns:trees"><fes:Filter>${filterBody}</fes:Filter></wfs:Query>
         </wfs:GetFeature>`
      : `<wfs:GetFeature service="WFS" version="${version}" xmlns:wfs="http://www.opengis.net/wfs" ${OGC}>
           <wfs:Query typeName="ns:trees"><ogc:Filter>${filterBody}</ogc:Filter></wfs:Query>
         </wfs:GetFeature>`;
    const res = await wfs.post(body);
    return { res, query: provider.lastCall()?.filterQuery, call: provider.lastCall() };
  }

  const eq = (prop: string, lit: string, ns = 'ogc') =>
    `<${ns}:PropertyIsEqualTo><${ns}:PropertyName>${prop}</${ns}:PropertyName><${ns}:Literal>${lit}</${ns}:Literal></${ns}:PropertyIsEqualTo>`;

  beforeAll(async () => {
    wfs = await startWfs({ provider });
  });

  afterAll(async () => {
    await wfs.stop();
  });

  beforeEach(() => provider.reset());

  describe('Comparison operators (FES 1.0 §5.2, FES 1.1 §11.2, FES 2.0 §7.7)', () => {
    it.each([
      ['PropertyIsEqualTo', 'Oak', { name: 'Oak' }],
      ['PropertyIsNotEqualTo', 'Oak', { name: { $ne: 'Oak' } }],
      ['PropertyIsLessThan', '10', { name: { $lt: 10 } }],
      ['PropertyIsGreaterThan', '10', { name: { $gt: 10 } }],
      ['PropertyIsLessThanOrEqualTo', '10', { name: { $lte: 10 } }],
      ['PropertyIsGreaterThanOrEqualTo', '10', { name: { $gte: 10 } }],
    ])('ogc:%s is translated into the matching selection', async (op, lit, expected) => {
      const { res, query } = await kvp(`<ogc:${op}><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>${lit}</ogc:Literal></ogc:${op}>`);
      expect(res.status).toBe(200);
      expect(query).toEqual(expected);
    });

    it.each(['1.0.0', '1.1.0', '2.0.2'])('an XML-encoded (POST) comparison is applied for WFS %s', async (version) => {
      const ns = version.startsWith('2.') ? 'fes' : 'ogc';
      const { res, call } = await post(eq('name', 'Oak', ns), version);
      expect(res.status).toBe(200);
      expect(call).toMatchObject({ featureType: 'trees', filterQuery: { name: 'Oak' } });
    });

    it('[GAP] FES 1.1 §11.2 / FES 2.0 §7.7.3.2: matchCase="false" makes PropertyIsEqualTo case-insensitive', async () => {
      const { query } = await kvp(`<ogc:PropertyIsEqualTo matchCase="false"><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>oak</ogc:Literal></ogc:PropertyIsEqualTo>`);
      expect(query.name).not.toBe('oak');
      expect(query.name.$regex?.test('Oak')).toBe(true);
    });

    it('[GAP] FES 1.0 §5.2 / FES 2.0 §7.7: PropertyIsBetween is applied, not silently dropped', async () => {
      const { query } = await kvp(
        `<ogc:PropertyIsBetween><ogc:PropertyName>height</ogc:PropertyName><ogc:LowerBoundary><ogc:Literal>10</ogc:Literal></ogc:LowerBoundary><ogc:UpperBoundary><ogc:Literal>20</ogc:Literal></ogc:UpperBoundary></ogc:PropertyIsBetween>`
      );
      expect(query).toEqual({ height: { $gte: 10, $lte: 20 } });
    });

    it('[GAP] FES 1.0 §5.2 / FES 2.0 §7.7: PropertyIsNull is applied, not silently dropped', async () => {
      const { query } = await kvp('<ogc:PropertyIsNull><ogc:PropertyName>height</ogc:PropertyName></ogc:PropertyIsNull>');
      expect(query).toEqual({ height: null });
    });
  });

  describe('PropertyIsLike (FES 1.0 §5.2, FES 1.1 §11.2.2, FES 2.0 §7.7.3.4)', () => {
    const like = async (attrs: string, lit: string) =>
      (await kvp(`<ogc:PropertyIsLike ${attrs}><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>${lit}</ogc:Literal></ogc:PropertyIsLike>`)).query.name.$regex as RegExp;

    it('the wildCard character matches zero or more characters', async () => {
      const re = await like('wildCard="*" singleChar="." escape="!"', 'Oa*');
      expect(re.test('Oa')).toBe(true);
      expect(re.test('Oak tree')).toBe(true);
      expect(re.test('Pine')).toBe(false);
    });

    it('an XML-encoded (POST) PropertyIsLike inside a logical Or is applied', async () => {
      const { query } = await post(
        `<ogc:Or>
           <ogc:PropertyIsLike wildCard="*" singleChar="." escape="!"><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>Oa*</ogc:Literal></ogc:PropertyIsLike>
           <ogc:PropertyIsNotEqualTo><ogc:PropertyName>name</ogc:PropertyName><ogc:Literal>Pine</ogc:Literal></ogc:PropertyIsNotEqualTo>
         </ogc:Or>`
      );
      expect(query.$or).toHaveLength(2);
      expect(query.$or[0].name.$regex.test('Oak')).toBe(true);
      expect(query.$or[1]).toEqual({ name: { $ne: 'Pine' } });
    });

    it('[GAP] the wildCard attribute defines the wildcard character (wildCard="#")', async () => {
      const re = await like('wildCard="#" singleChar="." escape="!"', 'Oa#');
      expect(re.test('Oak')).toBe(true);
    });

    it('[GAP] the singleChar character matches exactly one character', async () => {
      const re = await like('wildCard="*" singleChar="." escape="!"', 'O.k');
      expect(re.test('Oak')).toBe(true);
      expect(re.test('Ok')).toBe(false);
    });

    it('[GAP] the escape (FES 1.x) / escapeChar (FES 2.0) character makes the next wildcard literal', async () => {
      const re = await like('wildCard="*" singleChar="." escape="!"', 'A!*B');
      expect(re.test('A*B')).toBe(true);
      expect(re.test('AxyzB')).toBe(false);
    });

    it('[GAP] FES 1.1 §11.2 / FES 2.0 §7.7.3.2: matching is case-sensitive by default (matchCase defaults to true)', async () => {
      const re = await like('wildCard="*" singleChar="." escape="!"', 'Oa*');
      expect(re.test('oak')).toBe(false);
    });
  });

  describe('Logical operators (FES 1.0 §5.3, FES 1.1 §12, FES 2.0 §7.10)', () => {
    it('And / Or / Not (with a BBOX operand) are translated recursively', async () => {
      const { res, query } = await kvp(`
        <ogc:And>
          <ogc:BBOX><ogc:PropertyName>geo</ogc:PropertyName><gml:Box><gml:coordinates>10,50 12,52</gml:coordinates></gml:Box></ogc:BBOX>
          <ogc:Or>
            ${eq('name', 'Oak')}
            <ogc:PropertyIsGreaterThan><ogc:PropertyName>height</ogc:PropertyName><ogc:Literal>10</ogc:Literal></ogc:PropertyIsGreaterThan>
          </ogc:Or>
          <ogc:Not>
            <ogc:PropertyIsLessThanOrEqualTo><ogc:PropertyName>height</ogc:PropertyName><ogc:Literal>2</ogc:Literal></ogc:PropertyIsLessThanOrEqualTo>
          </ogc:Not>
        </ogc:And>`);
      expect(res.status).toBe(200);
      expect(query).toEqual({
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

    it('Not negates exactly one operand', async () => {
      const { query } = await kvp(`<ogc:Not>${eq('name', 'Pine')}</ogc:Not>`);
      expect(query).toEqual({ $nor: [{ name: 'Pine' }] });
    });

    it('And over two comparisons of the same property keeps both operands', async () => {
      const { query } = await kvp(`<ogc:And>
        <ogc:PropertyIsGreaterThan><ogc:PropertyName>height</ogc:PropertyName><ogc:Literal>5</ogc:Literal></ogc:PropertyIsGreaterThan>
        <ogc:PropertyIsLessThan><ogc:PropertyName>height</ogc:PropertyName><ogc:Literal>20</ogc:Literal></ogc:PropertyIsLessThan>
      </ogc:And>`);
      expect(query.$and).toEqual(expect.arrayContaining([{ height: { $gt: 5 } }, { height: { $lt: 20 } }]));
    });
  });

  describe('Spatial operator BBOX (FES 1.0 §5.1, FES 1.1 §10, FES 2.0 §7.8)', () => {
    it('BBOX with a GML 2 gml:Box / gml:coordinates selects within the box', async () => {
      const { query } = await kvp(`<ogc:BBOX><ogc:PropertyName>geo</ogc:PropertyName><gml:Box><gml:coordinates>10,50 12,52</gml:coordinates></gml:Box></ogc:BBOX>`);
      expect(query['geo.coordinates'].$geoWithin.$geometry.coordinates[0][2]).toEqual([12, 52]);
    });

    it('BBOX without a PropertyName applies to the default geometry property', async () => {
      const { query } = await kvp('<ogc:BBOX><gml:Box><gml:coordinates>10,50 12,52</gml:coordinates></gml:Box></ogc:BBOX>');
      expect(query['geo.coordinates']).toBeDefined();
    });

    it('[GAP] FES 1.1 / FES 2.0: BBOX with a GML 3 gml:Envelope (lowerCorner / upperCorner) selects within the envelope', async () => {
      const { query } = await kvp(
        '<ogc:BBOX><ogc:PropertyName>geo</ogc:PropertyName><gml:Envelope srsName="EPSG:4326"><gml:lowerCorner>10 50</gml:lowerCorner><gml:upperCorner>12 52</gml:upperCorner></gml:Envelope></ogc:BBOX>'
      );
      expect(query['geo.coordinates']).toBeDefined();
    });

    it('handles numeric lowerCorner/upperCorner without throwing TypeError', async () => {
      const { query } = await kvp(
        '<ogc:BBOX><ogc:PropertyName>geo</ogc:PropertyName><gml:Envelope><gml:lowerCorner>12345</gml:lowerCorner><gml:upperCorner>67890</gml:upperCorner></gml:Envelope></ogc:BBOX>'
      );
      expect(query['geo.coordinates']).toBeUndefined();
    });
  });

  describe('Identifiers (FES 1.x FeatureId, FES 2.0 ResourceId — §7.11)', () => {
    it.each(['1.0.0', '1.1.0'])('WFS %s: ogc:FeatureId fid attributes select features by identifier', async (version) => {
      const { res, call } = await post('<ogc:FeatureId fid="t2"/><ogc:FeatureId fid="missing"/>', version);
      expect(call?.fids).toEqual(['t2', 'missing']);
      expect(res.body).not.toContain('Oak');
    });

    it('WFS 2.0: fes:ResourceId rid attributes select features by identifier', async () => {
      const { call } = await post('<fes:ResourceId rid="t1"/><fes:ResourceId rid="t3"/>', '2.0.2');
      expect(call?.fids).toEqual(['t1', 't3']);
    });
  });

  describe('Value references (FES 1.x PropertyName, FES 2.0 ValueReference — §7.4)', () => {
    it('[GAP] FES 2.0 §7.4: fes:ValueReference addresses the property (PropertyName was removed in FES 2.0)', async () => {
      const { query } = await post(
        '<fes:PropertyIsEqualTo><fes:ValueReference>name</fes:ValueReference><fes:Literal>Oak</fes:Literal></fes:PropertyIsEqualTo>',
        '2.0.2'
      );
      expect(query).toEqual({ name: 'Oak' });
    });

    it('[GAP] FES 1.1 §7.4 / FES 2.0 §7.4.4: a namespace-qualified XPath step (ns:name) is a valid property reference', async () => {
      const { res, query } = await kvp(eq('ns:name', 'Oak'));
      expect(res.status).toBe(200);
      expect(Object.keys(query)).toHaveLength(1);
    });

    it('a property reference that is not a valid XPath step is rejected as InvalidParameterValue before reaching the data store', async () => {
      const { res } = await post(eq('$where', '1', 'fes'), '2.0.2');
      expect(res.body).toContain('InvalidParameterValue');
      expect(provider.calls).toHaveLength(0);
    });

    it('nested property paths (a.b) under an advertised property are accepted', async () => {
      const { query } = await kvp(eq('height.m', '3'));
      expect(Object.keys(query)).toEqual(['height.m']);
    });

    it('nested property paths under an unadvertised property are rejected', async () => {
      const { res } = await kvp(eq('props.height_m', '3'));
      expect(res.status).toBe(400);
      expect(res.body).toContain('InvalidParameterValue');
    });
  });
});
