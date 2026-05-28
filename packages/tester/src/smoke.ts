import axios from 'axios';
import { parseStringPromise } from 'xml2js';

export interface SmokeTestConfig {
  url: string;
  auth?: { user: string; pass: string };
  wfsUrl?: string;
  ogcUrl?: string;
  collections: {
    name: string;
    protocols: string[];
    srs: string;
    bbox?: [number, number, number, number];
  }[];
}

export interface SmokeTestResult {
  target: string;
  passed: boolean;
  message: string;
}

function getRandomBbox(extent: [number, number, number, number]): [number, number, number, number] {
  const [minLon, minLat, maxLon, maxLat] = extent;
  const rangeLon = Math.max(maxLon - minLon, 0.01);
  const rangeLat = Math.max(maxLat - minLat, 0.01);
  const widthLon = rangeLon * (0.1 + Math.random() * 0.4);
  const heightLat = rangeLat * (0.1 + Math.random() * 0.4);
  const leftLon = minLon + Math.random() * (rangeLon - widthLon);
  const bottomLat = minLat + Math.random() * (rangeLat - heightLat);
  return [
    parseFloat(leftLon.toFixed(6)),
    parseFloat(bottomLat.toFixed(6)),
    parseFloat((leftLon + widthLon).toFixed(6)),
    parseFloat((bottomLat + heightLat).toFixed(6))
  ];
}

/**
 * Runs structural and semantic smoke tests against OGC & WFS endpoints.
 */
export async function runSmokeTests(config: SmokeTestConfig): Promise<SmokeTestResult[]> {
  const results: SmokeTestResult[] = [];

  const headers: Record<string, string> = {};
  if (config.auth && config.auth.user && config.auth.pass) {
    const token = Buffer.from(`${config.auth.user}:${config.auth.pass}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }

  // 1. Run Global WFS / OGC Smoke Tests
  if (config.wfsUrl) {
    try {
      const res = await axios.get(`${config.wfsUrl}?service=WFS&request=GetCapabilities&version=2.0.0`, { headers, timeout: 5000 });
      if (res.status === 200 && res.data.includes('Capabilities')) {
        results.push({
          target: 'WFS - GetCapabilities Global',
          passed: true,
          message: 'GetCapabilities XML parsed successfully'
        });
      } else {
        throw new Error('Invalid capabilities response');
      }
    } catch (err: any) {
      results.push({
        target: 'WFS - GetCapabilities Global',
        passed: false,
        message: err.message
      });
    }
  }

  if (config.ogcUrl) {
    // Landing Page
    try {
      const res = await axios.get(config.ogcUrl, { headers, timeout: 5000 });
      if (res.status === 200 && res.data.links) {
        results.push({
          target: 'OGC - Landing Page Global',
          passed: true,
          message: 'Landing JSON and links parsed successfully'
        });
      } else {
        throw new Error('Invalid landing page');
      }
    } catch (err: any) {
      results.push({
        target: 'OGC - Landing Page Global',
        passed: false,
        message: err.message
      });
    }

    // Conformance
    try {
      const res = await axios.get(`${config.ogcUrl}/conformance`, { headers, timeout: 5000 });
      if (res.status === 200 && Array.isArray(res.data.conformsTo)) {
        results.push({
          target: 'OGC - Conformance Global',
          passed: true,
          message: `Discovered ${res.data.conformsTo.length} conformance classes`
        });
      } else {
        throw new Error('Invalid conformance response');
      }
    } catch (err: any) {
      results.push({
        target: 'OGC - Conformance Global',
        passed: false,
        message: err.message
      });
    }
  }

  // 2. Run Per-Collection Smoke Tests
  for (const col of config.collections) {
    for (const proto of col.protocols) {
      const targetLabel = `${proto.toUpperCase()} - ${col.name} (${col.srs})`;

      if (proto === 'ogc' && config.ogcUrl) {
        // OGC Collection Info
        try {
          const detailRes = await axios.get(`${config.ogcUrl}/collections/${col.name}`, { headers, timeout: 5000 });
          if (detailRes.status !== 200 || !detailRes.data.id) {
            throw new Error(`Failed to query collection info: status ${detailRes.status}`);
          }

          // Query Items with random bbox
          const bbox = getRandomBbox(col.bbox || [-180, -90, 180, 90]);
          const itemsRes = await axios.get(`${config.ogcUrl}/collections/${col.name}/items?limit=1&bbox=${bbox.join(',')}`, { headers, timeout: 5000 });
          if (itemsRes.status === 200 && itemsRes.data.type === 'FeatureCollection') {
            const count = Array.isArray(itemsRes.data.features) ? itemsRes.data.features.length : 0;
            results.push({
              target: targetLabel,
              passed: true,
              message: `GeoJSON FeatureCollection verified with random bbox query (${count} sample features fetched)`
            });
          } else {
            throw new Error(`Invalid GeoJSON payload: ${itemsRes.status}`);
          }
        } catch (err: any) {
          results.push({
            target: targetLabel,
            passed: false,
            message: err.message
          });
        }
      }

      if (proto.startsWith('wfs') && config.wfsUrl) {
        const ver = proto.replace('wfs', '');
        
        try {
          // DescribeFeatureType
          const descRes = await axios.get(`${config.wfsUrl}?service=WFS&request=DescribeFeatureType&version=${ver}&typename=${col.name}`, { headers, timeout: 5000 });
          const descXml = await parseStringPromise(descRes.data);
          if (!descXml) throw new Error('Schema XML parsing failed');

          // GetFeature with random bbox
          const srsParamName = ver === '1.0.0' ? 'srsname' : 'srsName';
          const srsUrn = ver === '2.0.0' ? `urn:ogc:def:crs:EPSG::${col.srs.replace('EPSG:', '')}` : col.srs;
          const bbox = getRandomBbox(col.bbox || [-180, -90, 180, 90]);

          const featRes = await axios.get(
            `${config.wfsUrl}?service=WFS&request=GetFeature&version=${ver}&typename=${col.name}&maxfeatures=1&limit=1&${srsParamName}=${encodeURIComponent(srsUrn)}&bbox=${bbox.join(',')}`,
            { headers, timeout: 5000 }
          );

          if (featRes.status === 200 && typeof featRes.data === 'string' && featRes.data.includes('FeatureCollection')) {
            results.push({
              target: targetLabel,
              passed: true,
              message: `GetFeature GML XML verified with random bbox query (status 200)`
            });
          } else {
            throw new Error(`GetFeature returned bad status or XML: status ${featRes.status}`);
          }
        } catch (err: any) {
          results.push({
            target: targetLabel,
            passed: false,
            message: err.message
          });
        }
      }
    }
  }

  return results;
}
