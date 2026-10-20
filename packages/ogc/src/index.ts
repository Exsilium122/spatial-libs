import express, { Request, Response, NextFunction } from 'express';
import { OgcOptions, SpatialDataProvider, OgcCollectionMetadata, GeoJSONFeature } from './types.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: any;
  }
}

export * from './types.js';

function verifyInterface(obj: any, requiredMethods: readonly string[], errorContext: string): void {
  for (const m of requiredMethods) {
    if (!obj || typeof obj[m] !== 'function') {
      throw new Error(`${errorContext} is missing the required method "${m}".`);
    }
  }
}

/**
 * Boot-time verification helper to check if the data provider implements necessary methods.
 */
function verifyProvider(provider: SpatialDataProvider): void {
  verifyInterface(
    provider,
    ['getSupportedTypes', 'getBoundingBox', 'getFeatures'],
    '[Spatial-API OGC Verification Error]: The provided SpatialDataProvider'
  );
}

function verifyTransformer(transformer: any): void {
  verifyInterface(
    transformer,
    ['normalizeSrs', 'isSupported', 'getSupportedCodes', 'transformCoordinate', 'transformGeometry'],
    '[Spatial-API OGC Verification Error]: The provided CoordinateTransformer'
  );
}

function verifyLogger(logger: any): void {
  verifyInterface(
    logger,
    ['info', 'warn', 'error'],
    '[Spatial-API OGC Verification Error]: The provided Logger'
  );
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function serializeQuery(params: Record<string, any>): string {
  const pairs: string[] = [];
  for (const key of Object.keys(params)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const val = params[key];
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
        }
      }
    }
  }
  return pairs.join('&');
}

/**
 * Checks whether an SRS identifier refers to WGS84 / CRS84 standard coordinates.
 */
function isWgs84Crs(srsName: string): boolean {
  if (!srsName) return false;
  const trimmed = srsName.trim();
  if (!trimmed) return false;
  if (
    /^(?:https?:\/\/(?:[a-zA-Z0-9.-]+\/)*(?:def\/crs\/)?ogc\/(?:[\d.]+\/)?|urn:(?:x-)?ogc:def:crs:OGC:(?:[\d.]+)?::?|ogc:)?crs:?84h?$/i.test(trimmed)
  ) {
    return true;
  }
  const epsgMatch = trimmed.match(/^(?:https?:\/\/(?:[a-zA-Z0-9.-]+\/)*(?:def\/crs\/|gml\/srs\/)|urn:(?:x-)?ogc:def:crs:)?(?:EPSG|epsg\.xml)[:/#]+(?:[\d.]+[:/#]+)?(\d+)$/i);
  if (epsgMatch && epsgMatch[1] === '4326') {
    return true;
  }
  if (trimmed === '4326' || trimmed === 'EPSG:4326') {
    return true;
  }
  return false;
}

function isValidRfc3339DateTime(str: string): boolean {
  if (!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(str)) {
    return false;
  }
  const t = Date.parse(str);
  return !isNaN(t);
}

function validateDatetime(dt: string): boolean {
  if (dt.includes('/')) {
    const parts = dt.split('/');
    if (parts.length !== 2) return false;
    const [start, end] = parts;
    const startOpen = start === '' || start === '..';
    const endOpen = end === '' || end === '..';
    if (startOpen && endOpen) return false;
    let startTime = -Infinity;
    let endTime = Infinity;
    if (!startOpen) {
      if (!isValidRfc3339DateTime(start)) return false;
      startTime = Date.parse(start);
    }
    if (!endOpen) {
      if (!isValidRfc3339DateTime(end)) return false;
      endTime = Date.parse(end);
    }
    return startTime <= endTime;
  } else {
    return isValidRfc3339DateTime(dt);
  }
}

function isLatLonEpsg4326(srs: string, rawCrs?: string): boolean {
  if (!rawCrs) return false;
  const trimmed = rawCrs.trim();
  if (/CRS84/i.test(trimmed)) return false;
  return (
    /^(?:https?:\/\/(?:[a-zA-Z0-9.-]+\/)*def\/crs\/)?EPSG\/(?:[\d.]+\/)?4326$/i.test(trimmed) ||
    /^(?:urn:(?:x-)?ogc:def:crs:EPSG:(?:[\d.]+:|:?)4326|EPSG:(?:[\d.]+:|:)4326)$/i.test(trimmed) ||
    /^https?:\/\/(?:[a-zA-Z0-9.-]+\/)*gml\/srs\/epsg\.xml#4326$/i.test(trimmed)
  );
}

function toCanonicalCrsUri(targetSrs: string, rawCrs?: string): string {
  if (isLatLonEpsg4326(targetSrs, rawCrs)) {
    return 'http://www.opengis.net/def/crs/EPSG/0/4326';
  }
  if (targetSrs === 'EPSG:4326' || !targetSrs) {
    return 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
  }
  if (targetSrs.toUpperCase().startsWith('EPSG:')) {
    return 'http://www.opengis.net/def/crs/EPSG/0/' + targetSrs.slice(5);
  }
  return targetSrs;
}

function swapGeometryAxes(geom: any): any {
  if (!geom) return null;
  if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
    return {
      type: 'GeometryCollection',
      geometries: geom.geometries.map(swapGeometryAxes)
    };
  }
  const recurse = (coords: any): any => {
    if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return [coords[1], coords[0], ...coords.slice(2)];
    }
    if (Array.isArray(coords)) {
      return coords.map(recurse);
    }
    return coords;
  };
  return {
    ...geom,
    coordinates: recurse(geom.coordinates)
  };
}

function formatGeoJsonGeometry(geom: any, defaultType: string = 'Point'): any {
  if (!geom) return null;
  if (geom.type === 'GeometryCollection') {
    return {
      type: 'GeometryCollection',
      geometries: Array.isArray(geom.geometries) ? geom.geometries : []
    };
  }
  return {
    type: geom.type || defaultType,
    coordinates: geom.coordinates || []
  };
}

/**
 * Creates a standard Express router configured with the OGC API Features handlers.
 */
export default function createOgcRouter(options: OgcOptions): express.Router {
  // 1. Boot-time check
  verifyProvider(options.provider);
  if (options.crsTransformer) {
    verifyTransformer(options.crsTransformer);
  }
  if (options.logger) {
    verifyLogger(options.logger);
  }

  if (options.crsTransformer) {
    options.logger?.info(`[Spatial OGC] CRS Reprojection enabled. Injected systems: ${options.crsTransformer.getSupportedCodes().join(', ')}`);
  } else {
    options.logger?.info('[Spatial OGC] Operating in native CRS84 mode (No CRS transformer injected).');
  }

  const { provider, logger, baseUrl } = options;
  const defaultLimit = options.defaultLimit || 50;
  const maxLimit = options.maxLimit || 1000;

  const isAbsoluteBaseUrl = baseUrl.startsWith('http://') || baseUrl.startsWith('https://');
  if (!isAbsoluteBaseUrl && !options.trustedHosts) {
    logger?.warn(
      '[Spatial OGC] Relative baseUrl configured without trustedHosts allowlist. Set an absolute baseUrl or configure trustedHosts to prevent Host header poisoning.'
    );
  }

  const trustedHostsSet = options.trustedHosts
    ? new Set(options.trustedHosts.map(h => h.trim().toLowerCase()))
    : null;

  let hasWarnedLegacyPagination = false;

  const router = express.Router();

  const HOST_PATTERN = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
  const IPV6_HOST_PATTERN = /^\[[a-fA-F0-9:]+\](:\d{1,5})?$/;

  const isHostUsable = (host: string | undefined): boolean => {
    if (!host || typeof host !== 'string') return false;
    if (!HOST_PATTERN.test(host) && !IPV6_HOST_PATTERN.test(host)) return false;
    if (trustedHostsSet !== null) {
      return trustedHostsSet.has(host.toLowerCase());
    }
    return true;
  };

  // Helper to get baseUrl dynamically from request if baseUrl was relative, or use configured baseUrl
  const getRequestBaseUrl = (req: Request): string => {
    if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
      return baseUrl;
    }
    const host = req.get('host');
    if (isHostUsable(host)) {
      return `${req.protocol}://${host}${req.baseUrl}`;
    }
    return req.baseUrl;
  };

  // 1. Landing Page (GET /)
  router.get('/', (req: Request, res: Response) => {
    const activeBase = getRequestBaseUrl(req);
    res.json({
      title: 'OGC API - Features read-only service',
      description: 'OGC API - Features compliant spatial feature server',
      links: [
        {
          rel: 'self',
          type: 'application/json',
          title: 'This document (Landing Page)',
          href: `${activeBase}`
        },
        {
          rel: 'service-desc',
          type: 'application/vnd.oai.openapi+json;version=3.0',
          title: 'API definition',
          href: `${activeBase}/api`
        },
        {
          rel: 'service-doc',
          type: 'text/html',
          title: 'API documentation',
          href: `${activeBase}/api`
        },
        {
          rel: 'conformance',
          type: 'application/json',
          title: 'OGC API Conformance Declaration',
          href: `${activeBase}/conformance`
        },
        {
          rel: 'data',
          type: 'application/json',
          title: 'Feature Collections',
          href: `${activeBase}/collections`
        }
      ]
    });
  });

  // 1.5. API Definition (GET /api)
  router.get('/api', (req: Request, res: Response) => {
    if (req.headers.accept?.includes('text/html') && !req.headers.accept?.includes('application/vnd.oai.openapi+json')) {
      return res.type('text/html').send('<!DOCTYPE html><html><head><title>OGC API - Features Service</title></head><body><h1>OGC API - Features Service</h1></body></html>');
    }
    res.type('application/vnd.oai.openapi+json;version=3.0').json({
      openapi: '3.0.0',
      info: {
        title: 'OGC API - Features Service',
        version: '1.0.0'
      },
      paths: {
        '/': {
          get: {
            responses: {
              200: {
                description: 'Landing page'
              }
            }
          }
        },
        '/conformance': {
          get: {
            responses: {
              200: {
                description: 'Conformance classes'
              }
            }
          }
        },
        '/collections': {
          get: {
            responses: {
              200: {
                description: 'Metadata for collections'
              }
            }
          }
        },
        '/collections/{collectionId}': {
          get: {
            responses: {
              200: {
                description: 'Metadata for a collection'
              }
            }
          }
        },
        '/collections/{collectionId}/items': {
          get: {
            parameters: [
              {
                name: 'extra',
                in: 'query',
                style: 'form',
                schema: {
                  type: 'object',
                  additionalProperties: true
                }
              }
            ],
            responses: {
              200: {
                description: 'Features in a collection'
              }
            }
          }
        }
      }
    });
  });

  // 2. Conformance Page (GET /conformance)
  router.get('/conformance', (req: Request, res: Response) => {
    const conformsTo = [
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson',
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30'
    ];
    if (options.crsTransformer) {
      conformsTo.push('http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs');
    }
    res.json({ conformsTo });
  });

  // 3. Collections Page (GET /collections)
  router.get('/collections', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const activeBase = getRequestBaseUrl(req);
      const validTypes = await provider.getSupportedTypes(req.user);

      let collections: any[];

      const getCollectionCrsList = () => {
        if (!options.crsTransformer) return ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'];
        return [
          'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
          ...options.crsTransformer.getSupportedCodes()
            .filter(c => c !== 'EPSG:4326')
            .map(c => `http://www.opengis.net/def/crs/EPSG/0/${c.replace('EPSG:', '')}`)
        ];
      };

      if (typeof provider.getCollectionsMetadata === 'function') {
        const raw = await provider.getCollectionsMetadata(req.user);
        collections = raw.map(c => {
          const sCrs = (c as any).storageCrs || (c as any).storageCRS || 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
          return {
            ...c,
            crs: (c as any).crs || getCollectionCrsList(),
            storageCrs: sCrs,
            storageCRS: sCrs
          };
        });
      } else {
        // Fallback: dynamically generate basic collection metadata using getBoundingBox
        const promises = validTypes.map(async (featureType) => {
          const bbox = await provider.getBoundingBox(req.user, featureType);
          const title = featureType.charAt(0).toUpperCase() + featureType.slice(1).replace(/([A-Z])/g, ' $1');
          return {
            id: featureType,
            title,
            description: `Spatial ${featureType} dataset`,
            crs: getCollectionCrsList(),
            storageCrs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
            storageCRS: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
            extent: {
              spatial: {
                bbox: [[
                  bbox.minLon,
                  bbox.minLat,
                  bbox.maxLon,
                  bbox.maxLat
                ]]
              }
            },
            links: [
              {
                rel: 'self',
                type: 'application/json',
                title: `${title} collection metadata`,
                href: `${activeBase}/collections/${featureType}`
              },
              {
                rel: 'items',
                type: 'application/geo+json',
                title: `${title} features (GeoJSON)`,
                href: `${activeBase}/collections/${featureType}/items`
              }
            ]
          };
        });
        collections = await Promise.all(promises);
      }

      res.json({
        collections,
        links: [
          {
            rel: 'self',
            type: 'application/json',
            title: 'Metadata for all collections',
            href: `${activeBase}/collections`
          }
        ]
      });
    } catch (err) {
      if (logger) logger.error('OGC Collections error:', err);
      next(err);
    }
  });

  // 4. Collection Detail Page (GET /collections/:collectionId)
  router.get('/collections/:collectionId', async (req: Request, res: Response, next: NextFunction) => {
    const { collectionId } = req.params;
    try {
      const validTypes = await provider.getSupportedTypes(req.user);
      if (!validTypes.includes(collectionId)) {
        return res.status(404).json({ error: `Collection "${collectionId}" not found.` });
      }

      const activeBase = getRequestBaseUrl(req);

      const getCollectionCrsList = () => {
        if (!options.crsTransformer) return ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'];
        return [
          'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
          ...options.crsTransformer.getSupportedCodes()
            .filter(c => c !== 'EPSG:4326')
            .map(c => `http://www.opengis.net/def/crs/EPSG/0/${c.replace('EPSG:', '')}`)
        ];
      };

      if (typeof provider.getCollectionsMetadata === 'function') {
        const raw = await provider.getCollectionsMetadata(req.user);
        const match = raw.find((c: any) => c.id === collectionId);
        if (match) {
          const sCrs = (match as any).storageCrs || (match as any).storageCRS || 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
          return res.json({
            ...match,
            crs: (match as any).crs || getCollectionCrsList(),
            storageCrs: sCrs,
            storageCRS: sCrs,
            links: [
              ...(match.links || []),
              {
                rel: 'self',
                type: 'application/json',
                title: `${match.title || collectionId} collection metadata`,
                href: `${activeBase}/collections/${collectionId}`
              },
              {
                rel: 'items',
                type: 'application/geo+json',
                title: `${match.title || collectionId} features (GeoJSON)`,
                href: `${activeBase}/collections/${collectionId}/items`
              }
            ]
          });
        }
      }

      const bbox = await provider.getBoundingBox(req.user, collectionId);
      const title = collectionId.charAt(0).toUpperCase() + collectionId.slice(1).replace(/([A-Z])/g, ' $1');

      res.json({
        id: collectionId,
        title,
        description: `Spatial ${collectionId} dataset`,
        crs: getCollectionCrsList(),
        storageCrs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        storageCRS: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        extent: {
          spatial: {
            bbox: [[
              bbox.minLon,
              bbox.minLat,
              bbox.maxLon,
              bbox.maxLat
            ]]
          }
        },
        links: [
          {
            rel: 'self',
            type: 'application/json',
            title: `${title} collection metadata`,
            href: `${activeBase}/collections/${collectionId}`
          },
          {
            rel: 'items',
            type: 'application/geo+json',
            title: `${title} features (GeoJSON)`,
            href: `${activeBase}/collections/${collectionId}/items`
          }
        ]
      });
    } catch (err) {
      if (logger) logger.error(`OGC Collection Detail error for ${collectionId}:`, err);
      next(err);
    }
  });

  // 5. Items (GeoJSON Features) Page (GET /collections/:collectionId/items)
  router.get('/collections/:collectionId/items', async (req: Request, res: Response, next: NextFunction) => {
    const { collectionId } = req.params;
    try {
      const validTypes = await provider.getSupportedTypes(req.user);
      if (!validTypes.includes(collectionId)) {
        return res.status(404).json({ error: `Collection "${collectionId}" not found.` });
      }

      const activeBase = getRequestBaseUrl(req);

      // Parse optional crs and bbox-crs parameters
      let targetSrs = 'EPSG:4326';
      let doReproject = false;
      if (req.query.crs !== undefined) {
        if (Array.isArray(req.query.crs)) {
          return res.status(400).json({ error: 'Malformed crs parameter: duplicate parameters are not allowed.' });
        }
        if (options.crsTransformer) {
          const reqCrs = String(req.query.crs);
          if (options.crsTransformer.isSupported(reqCrs)) {
            targetSrs = options.crsTransformer.normalizeSrs(reqCrs);
            doReproject = true;
          } else {
            return res.status(400).json({ error: `Unsupported crs requested: ${reqCrs}` });
          }
        }
      }

      let bboxSrs = 'EPSG:4326';
      if (req.query['bbox-crs'] !== undefined) {
        if (Array.isArray(req.query['bbox-crs'])) {
          return res.status(400).json({ error: 'Malformed bbox-crs parameter: duplicate parameters are not allowed.' });
        }
        const reqBboxCrs = String(req.query['bbox-crs']);
        if (options.crsTransformer) {
          if (options.crsTransformer.isSupported(reqBboxCrs)) {
            bboxSrs = options.crsTransformer.normalizeSrs(reqBboxCrs);
          } else if (isWgs84Crs(reqBboxCrs)) {
            bboxSrs = 'EPSG:4326';
          } else {
            return res.status(400).json({ error: `Unsupported bbox-crs requested: ${reqBboxCrs}` });
          }
        } else {
          if (isWgs84Crs(reqBboxCrs)) {
            bboxSrs = 'EPSG:4326';
          } else {
            return res.status(400).json({ error: `Unsupported bbox-crs requested: ${reqBboxCrs}` });
          }
        }
      }

      // Parse pagination limits
      if (req.query.limit !== undefined) {
        const rawLimit = String(req.query.limit).trim();
        if (!/^\d+$/.test(rawLimit) || parseInt(rawLimit, 10) < 1) {
          return res.status(400).json({ error: `Invalid limit parameter: "${req.query.limit}" must be a positive integer.` });
        }
      }
      let limit = parseInt(String(req.query.limit || defaultLimit), 10);
      if (isNaN(limit) || limit < 1) limit = defaultLimit;
      if (limit > maxLimit) limit = maxLimit;

      let offset = parseInt(String(req.query.offset || req.query.startindex || 0), 10);
      if (isNaN(offset) || offset < 0) offset = 0;

      // Validate datetime parameter
      if (req.query.datetime !== undefined) {
        if (typeof req.query.datetime !== 'string' || !validateDatetime(req.query.datetime)) {
          return res.status(400).json({ error: `Invalid datetime parameter: "${req.query.datetime}" is not a valid RFC 3339 datetime or interval.` });
        }
      }

      // Extract bounding box filter parameter
      let filterQuery: Record<string, any> = {};
      if (req.query.bbox !== undefined) {
        if (Array.isArray(req.query.bbox)) {
          return res.status(400).json({ error: 'Malformed bbox parameter: duplicate parameters are not allowed.' });
        }
        const rawBbox = String(req.query.bbox).trim();
        const rawParts = rawBbox.split(',');
        if (rawParts.length !== 4 && rawParts.length !== 6) {
          return res.status(400).json({ error: `Malformed bbox parameter: expected 4 or 6 comma-separated numbers, got ${rawParts.length}.` });
        }

        const parts: number[] = [];
        for (const part of rawParts) {
          const trimmed = part.trim();
          if (trimmed === '' || trimmed.toLowerCase() === 'nan') {
            return res.status(400).json({ error: `Malformed bbox parameter: "${part}" is not a valid number.` });
          }
          const num = Number(trimmed);
          if (!Number.isFinite(num)) {
            return res.status(400).json({ error: `Malformed bbox parameter: "${part}" is not a valid number.` });
          }
          parts.push(num);
        }

        let minLon: number, minLat: number, maxLon: number, maxLat: number;
        if (rawParts.length === 6) {
          minLon = parts[0];
          minLat = parts[1];
          maxLon = parts[3];
          maxLat = parts[4];
        } else {
          if (options.crsTransformer && req.query['bbox-crs'] && isLatLonEpsg4326(bboxSrs, String(req.query['bbox-crs']))) {
            minLat = parts[0];
            minLon = parts[1];
            maxLat = parts[2];
            maxLon = parts[3];
          } else {
            minLon = parts[0];
            minLat = parts[1];
            maxLon = parts[2];
            maxLat = parts[3];
          }
        }

        if (minLat > maxLat) {
          return res.status(400).json({ error: `Malformed bbox parameter: minLat (${minLat}) cannot be greater than maxLat (${maxLat}).` });
        }

        // CRS84 latitude bounds check (|lat| <= 90)
        if (bboxSrs === 'EPSG:4326') {
          if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
            return res.status(400).json({ error: `Malformed bbox parameter: latitude coordinates must be within [-90, 90].` });
          }
        }

        // If bbox-crs is NOT WGS84, we must transform the coordinates of the bbox back to WGS84 prior to the provider query
        if (bboxSrs !== 'EPSG:4326' && options.crsTransformer) {
          const minPt = options.crsTransformer.transformCoordinate([minLon, minLat], bboxSrs, 'EPSG:4326');
          const maxPt = options.crsTransformer.transformCoordinate([maxLon, maxLat], bboxSrs, 'EPSG:4326');
          minLon = minPt[0];
          minLat = minPt[1];
          maxLon = maxPt[0];
          maxLat = maxPt[1];

          if (minLat > maxLat) {
            return res.status(400).json({ error: `Malformed bbox parameter: transformed minLat (${minLat}) cannot be greater than maxLat (${maxLat}).` });
          }
        }

        if (minLon > maxLon) {
          filterQuery['geo.coordinates'] = {
            $geoWithin: {
              $geometry: {
                type: 'MultiPolygon',
                coordinates: [
                  [[
                    [minLon, minLat],
                    [180, minLat],
                    [180, maxLat],
                    [minLon, maxLat],
                    [minLon, minLat]
                  ]],
                  [[
                    [-180, minLat],
                    [maxLon, minLat],
                    [maxLon, maxLat],
                    [-180, maxLat],
                    [-180, minLat]
                  ]]
                ]
              }
            }
          };
        } else {
          filterQuery['geo.coordinates'] = {
            $geoWithin: {
              $geometry: {
                type: 'Polygon',
                coordinates: [[
                  [minLon, minLat],
                  [maxLon, minLat],
                  [maxLon, maxLat],
                  [minLon, maxLat],
                  [minLon, minLat]
                ]]
              }
            }
          };
        }
      }

      // Validate and extract name filter parameter
      if (req.query.name !== undefined) {
        if (typeof req.query.name !== 'string') {
          return res.status(400).json({ error: 'Invalid "name" parameter: expected a single string value.' });
        }
        filterQuery.name = req.query.name;
      }

      const isPaginationAware = typeof provider.countFeatures === 'function';
      let paginatedFeatures: GeoJSONFeature[];
      let numberMatched: number;

      if (isPaginationAware) {
        const featuresPage = await provider.getFeatures(req.user, collectionId, [], filterQuery, { limit, offset });
        numberMatched = await provider.countFeatures!(req.user, collectionId, filterQuery);
        paginatedFeatures = featuresPage.length > limit ? featuresPage.slice(0, limit) : featuresPage;
      } else {
        if (!hasWarnedLegacyPagination) {
          hasWarnedLegacyPagination = true;
          logger?.warn(
            '[Spatial OGC] SpatialDataProvider does not implement countFeatures(); falling back to in-memory pagination. Implement countFeatures to enable database-level pagination.'
          );
        }
        // Options are deliberately withheld: a provider that paged without countFeatures would get the offset applied twice
        const allFeatures = await provider.getFeatures(req.user, collectionId, [], filterQuery);
        numberMatched = allFeatures.length;
        paginatedFeatures = allFeatures.slice(offset, offset + limit);
      }

      const numberReturned = paginatedFeatures.length;

      const geomType = (typeof provider.getGeometryType === 'function') 
        ? await provider.getGeometryType(req.user, collectionId) 
        : 'Point';

      const features = paginatedFeatures.map((feature) => {
        let geom = feature.geometry;
        if (geom) {
          if (doReproject && options.crsTransformer) {
            geom = options.crsTransformer.transformGeometry(geom, 'EPSG:4326', targetSrs);
          }
          if (isLatLonEpsg4326(targetSrs, req.query.crs ? String(req.query.crs) : '')) {
            geom = swapGeometryAxes(geom);
          }
        }
        return {
          type: 'Feature',
          id: `${collectionId}_${feature.id.toString()}`,
          geometry: geom ? formatGeoJsonGeometry(geom, geomType) : null,
          properties: {
            ...feature.properties
          }
        };
      });

      const links: any[] = [];

      // Construct self link preserving other queries
      const selfParams: Record<string, any> = Object.create(null);
      for (const key of Object.keys(req.query)) {
        if (!DANGEROUS_KEYS.has(key)) {
          selfParams[key] = req.query[key];
        }
      }
      const selfQueryStr = serializeQuery(selfParams);
      links.push({
        rel: 'self',
        type: 'application/geo+json',
        title: 'This document',
        href: `${activeBase}/collections/${collectionId}/items` + (selfQueryStr ? `?${selfQueryStr}` : '')
      });

      const getPageHref = (newOffset: number) => {
        const pageParams: Record<string, any> = Object.create(null);
        for (const key of Object.keys(req.query)) {
          if (!DANGEROUS_KEYS.has(key) && key !== 'startindex' && key !== 'offset' && key !== 'limit') {
            pageParams[key] = req.query[key];
          }
        }
        pageParams.limit = limit;
        pageParams.offset = newOffset;
        const pageQueryStr = serializeQuery(pageParams);
        return `${activeBase}/collections/${collectionId}/items?${pageQueryStr}`;
      };

      // Next link
      if (offset + limit < numberMatched) {
        links.push({
          rel: 'next',
          type: 'application/geo+json',
          title: 'Next page of features',
          href: getPageHref(offset + limit)
        });
      }

      // Previous link
      if (offset > 0) {
        links.push({
          rel: 'prev',
          type: 'application/geo+json',
          title: 'Previous page of features',
          href: getPageHref(Math.max(0, offset - limit))
        });
      }

      // Parent collection link
      links.push({
        rel: 'collection',
        type: 'application/json',
        title: 'Metadata for this collection',
        href: `${activeBase}/collections/${collectionId}`
      });

      const fcResponse: Record<string, any> = {
        type: 'FeatureCollection',
        numberMatched,
        numberReturned,
        features,
        links
      };

      if (doReproject) {
        fcResponse.crs = toCanonicalCrsUri(targetSrs, req.query.crs ? String(req.query.crs) : undefined);
      }

      if (options.crsTransformer) {
        const activeCrsUri = doReproject
          ? toCanonicalCrsUri(targetSrs, req.query.crs ? String(req.query.crs) : undefined)
          : 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
        res.setHeader('Content-Crs', `<${activeCrsUri}>`);
      }

      res.type('application/geo+json').json(fcResponse);
    } catch (err) {
      if (logger) logger.error(`OGC Items error for ${collectionId}:`, err);
      next(err);
    }
  });

  // 6. Single Feature (GET /collections/:collectionId/items/:featureId)
  router.get('/collections/:collectionId/items/:featureId', async (req: Request, res: Response, next: NextFunction) => {
    const { collectionId, featureId } = req.params;
    try {
      const validTypes = await provider.getSupportedTypes(req.user);
      if (!validTypes.includes(collectionId)) {
        return res.status(404).json({ error: `Collection "${collectionId}" not found.` });
      }

      let targetSrs = 'EPSG:4326';
      let doReproject = false;
      if (req.query.crs !== undefined) {
        if (Array.isArray(req.query.crs)) {
          return res.status(400).json({ error: 'Malformed crs parameter: duplicate parameters are not allowed.' });
        }
        if (options.crsTransformer) {
          const reqCrs = String(req.query.crs);
          if (options.crsTransformer.isSupported(reqCrs)) {
            targetSrs = options.crsTransformer.normalizeSrs(reqCrs);
            doReproject = true;
          } else {
            return res.status(400).json({ error: `Unsupported crs requested: ${reqCrs}` });
          }
        }
      }

      const activeBase = getRequestBaseUrl(req);
      const prefix = `${collectionId}_`;
      const rawId = featureId.startsWith(prefix) ? featureId.slice(prefix.length) : featureId;

      const candidates = await provider.getFeatures(req.user, collectionId, [rawId, featureId]);
      const matched = candidates.find(
        (f) => String(f.id) === rawId || String(f.id) === featureId || `${collectionId}_${f.id}` === featureId
      );

      if (!matched) {
        return res.status(404).json({ error: `Feature "${featureId}" not found in collection "${collectionId}".` });
      }

      const geomType = (typeof provider.getGeometryType === 'function')
        ? await provider.getGeometryType(req.user, collectionId)
        : 'Point';

      let geom = matched.geometry;
      if (geom) {
        if (doReproject && options.crsTransformer) {
          geom = options.crsTransformer.transformGeometry(geom, 'EPSG:4326', targetSrs);
        }
        if (isLatLonEpsg4326(targetSrs, req.query.crs ? String(req.query.crs) : '')) {
          geom = swapGeometryAxes(geom);
        }
      }

      const responseFeature = {
        type: 'Feature',
        id: featureId,
        geometry: geom ? formatGeoJsonGeometry(geom, geomType) : null,
        properties: { ...matched.properties },
        links: [
          {
            rel: 'self',
            type: 'application/geo+json',
            title: 'This feature',
            href: `${activeBase}/collections/${collectionId}/items/${featureId}`
          },
          {
            rel: 'collection',
            type: 'application/json',
            title: `${collectionId} collection metadata`,
            href: `${activeBase}/collections/${collectionId}`
          }
        ]
      };

      if (options.crsTransformer) {
        const activeCrsUri = doReproject
          ? toCanonicalCrsUri(targetSrs, req.query.crs ? String(req.query.crs) : undefined)
          : 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
        res.setHeader('Content-Crs', `<${activeCrsUri}>`);
      }
      res.type('application/geo+json').json(responseFeature);
    } catch (err) {
      if (logger) logger.error(`OGC Single Feature error for ${collectionId}/${featureId}:`, err);
      next(err);
    }
  });

  return router;
}
