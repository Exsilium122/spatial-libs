import axios from 'axios';
import { parseStringPromise } from 'xml2js';

export interface DiscoveredCollection {
  name: string;
  protocols: ('wfs1.0.0' | 'wfs1.1.0' | 'wfs2.0.0' | 'ogc')[];
  projections: string[];
  bbox: [number, number, number, number];
}

export interface ProbeResult {
  wfsUrl?: string;
  ogcUrl?: string;
  wfsVersions: string[];
  collections: DiscoveredCollection[];
}

/**
 * Normalizes prefix from XML parsed objects
 */
function stripPrefix(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(stripPrefix);
  const newObj: any = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleanKey = k.replace(/^.*:/, '');
    newObj[cleanKey] = stripPrefix(v);
  }
  return newObj;
}

/**
 * Probes the target URL to auto-discover active WFS & OGC API Feature endpoints.
 */
export async function probeTarget(
  targetUrl: string,
  auth?: { user: string; pass: string }
): Promise<ProbeResult> {
  const result: ProbeResult = {
    wfsVersions: [],
    collections: []
  };

  const headers: Record<string, string> = {};
  if (auth && auth.user && auth.pass) {
    const token = Buffer.from(`${auth.user}:${auth.pass}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }

  // Clean trailing slash
  const url = targetUrl.replace(/\/$/, '');

  let has401 = false;

  // 1. Probe OGC API - Features
  const ogcCandidates = [
    url,
    `${url}/api/ogc`,
    `${url}/ogc`
  ];

  for (const candidate of ogcCandidates) {
    try {
      const res = await axios.get(candidate, { headers, timeout: 5000 });
      if (res.status === 200 && typeof res.data === 'object') {
        const landing = res.data;
        const links = landing.links || [];
        // Check if there's a link to collections or self is ogc
        const hasCollectionsLink = links.some((l: any) => l.rel === 'data' || l.href?.includes('/collections'));
        if (hasCollectionsLink || landing.collections || candidate.endsWith('/ogc')) {
          result.ogcUrl = candidate;
          break;
        }
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        has401 = true;
      }
      // Continue probing other OGC candidates
    }
  }

  // 2. Probe WFS
  const wfsCandidates = [
    url,
    `${url}/api/wfs`,
    `${url}/wfs`
  ];

  for (const candidate of wfsCandidates) {
    try {
      // Try GetCapabilities 2.0.0
      const res = await axios.get(`${candidate}?service=WFS&request=GetCapabilities&version=2.0.0`, { headers, timeout: 5000 });
      if (res.status === 200 && typeof res.data === 'string' && res.data.includes('Capabilities')) {
        result.wfsUrl = candidate;
        break;
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        has401 = true;
      }
      try {
        // Fallback GetCapabilities 1.1.0
        const res = await axios.get(`${candidate}?service=WFS&request=GetCapabilities&version=1.1.0`, { headers, timeout: 5000 });
        if (res.status === 200 && typeof res.data === 'string' && res.data.includes('Capabilities')) {
          result.wfsUrl = candidate;
          break;
        }
      } catch (err2: any) {
        if (err2.response?.status === 401) {
          has401 = true;
        }
        // Ignore WFS candidate failures
      }
    }
  }

  // Helper map to deduplicate collections
  const collectionMap = new Map<string, DiscoveredCollection>();

  // 3. Extract Collections & SRS from OGC Collections
  if (result.ogcUrl) {
    try {
      const res = await axios.get(`${result.ogcUrl}/collections`, { headers, timeout: 5000 });
      if (res.status === 200 && res.data && Array.isArray(res.data.collections)) {
        for (const col of res.data.collections) {
          const name = col.id;
          const cleanName = name.replace(/^.*:/, '');
          
          let projections = ['EPSG:4326']; // Default for OGC API - Features
          if (col.crs && Array.isArray(col.crs)) {
            projections = col.crs
              .map((c: string) => {
                const match = c.match(/EPSG\/(0|[1-9][0-9]*)/i);
                return match ? `EPSG:${match[1]}` : c;
              })
              .filter((p: string) => p !== 'EPSG:0' && !p.endsWith(':0') && p !== '0');
            if (projections.length === 0) projections = ['EPSG:4326'];
          }

          let bbox: [number, number, number, number] = [-180, -90, 180, 90];
          if (col.extent?.spatial?.bbox?.[0]) {
            const b = col.extent.spatial.bbox[0];
            if (b.length >= 4) {
              bbox = [Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])];
            }
          }

          collectionMap.set(cleanName, {
            name: cleanName,
            protocols: ['ogc'],
            projections: [...new Set(projections)],
            bbox
          });
        }
      }
    } catch {
      // Gracefully continue even if OGC parsing fails
    }
  }

  // 4. Extract Collections & SRS from WFS GetCapabilities
  if (result.wfsUrl) {
    const versions = ['2.0.0', '1.1.0', '1.0.0'];
    for (const ver of versions) {
      try {
        const res = await axios.get(`${result.wfsUrl}?service=WFS&request=GetCapabilities&version=${ver}`, { headers, timeout: 5000 });
        if (res.status === 200 && typeof res.data === 'string' && res.data.includes('Capabilities')) {
          result.wfsVersions.push(ver);
          const xmlParsed = await parseStringPromise(res.data);
          const cleanXml = stripPrefix(xmlParsed);

          const wfsCap = cleanXml.WFS_Capabilities || cleanXml.WFS_Capabilities_Type;
          if (wfsCap && wfsCap.FeatureTypeList) {
            const featureTypeList = wfsCap.FeatureTypeList[0] || {};
            const featureTypes = featureTypeList.FeatureType || [];

            for (const ft of featureTypes) {
              const name = String(ft.Name ? ft.Name[0] : '');
              if (!name) continue;

              const cleanName = name.replace(/^.*:/, '');

              // Parse projections (SRS)
              let projections: string[] = ['EPSG:4326'];
              if (ft.DefaultSRS) {
                const srs = String(ft.DefaultSRS[0]);
                const match = srs.match(/EPSG::?(\d+)/i);
                if (match && match[1] !== '0') projections = [`EPSG:${match[1]}`];
              } else if (ft.SRS) {
                // WFS 1.0.0
                const srsList = ft.SRS.map((s: any) => {
                  const match = String(s).match(/EPSG::?(\d+)/i);
                  return match ? `EPSG:${match[1]}` : String(s);
                }).filter((p: string) => p !== 'EPSG:0' && !p.endsWith(':0') && p !== '0');
                if (srsList.length > 0) projections = srsList;
              }

              if (ft.OtherSRS) {
                const other = ft.OtherSRS.map((s: any) => {
                  const match = String(s).match(/EPSG::?(\d+)/i);
                  return match ? `EPSG:${match[1]}` : String(s);
                }).filter((p: string) => p !== 'EPSG:0' && !p.endsWith(':0') && p !== '0');
                projections.push(...other);
              }

              projections = projections.filter(p => p !== 'EPSG:0' && !p.endsWith(':0') && p !== '0');
              if (projections.length === 0) {
                projections = ['EPSG:4326'];
              }

              let bbox: [number, number, number, number] = [-180, -90, 180, 90];
              if (ft.WGS84BoundingBox) {
                const wgs = ft.WGS84BoundingBox[0];
                const lower = String(wgs.LowerCorner ? wgs.LowerCorner[0] : '').split(' ');
                const upper = String(wgs.UpperCorner ? wgs.UpperCorner[0] : '').split(' ');
                if (lower.length >= 2 && upper.length >= 2) {
                  bbox = [Number(lower[0]), Number(lower[1]), Number(upper[0]), Number(upper[1])];
                }
              } else if (ft.LatLongBoundingBox) {
                const latlon = ft.LatLongBoundingBox[0];
                const attrs = latlon.$ || {};
                if (attrs.minx && attrs.miny && attrs.maxx && attrs.maxy) {
                  bbox = [Number(attrs.minx), Number(attrs.miny), Number(attrs.maxx), Number(attrs.maxy)];
                }
              }

              const protocol: any = `wfs${ver}`;
              const existing = collectionMap.get(cleanName);
              if (existing) {
                if (!existing.protocols.includes(protocol)) {
                  existing.protocols.push(protocol);
                }
                existing.projections = [...new Set([...existing.projections, ...projections])];
                if (existing.bbox[0] === -180 && bbox[0] !== -180) {
                  existing.bbox = bbox;
                }
              } else {
                collectionMap.set(cleanName, {
                  name: cleanName,
                  protocols: [protocol],
                  projections: [...new Set(projections)],
                  bbox
                });
              }
            }
          }
        }
      } catch {
        // Skip current WFS version Capabilities parsing on failures
      }
    }
  }

  if (!result.wfsUrl && !result.ogcUrl && has401) {
    const error = new Error('Unauthorized');
    (error as any).statusCode = 401;
    throw error;
  }

  result.collections = Array.from(collectionMap.values());
  return result;
}
