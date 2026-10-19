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
        collections = raw.map(c => ({
          ...c,
          crs: (c as any).crs || getCollectionCrsList(),
          storageCRS: (c as any).storageCRS || 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
        }));
      } else {
        // Fallback: dynamically generate basic collection metadata using getBoundingBox
        const promises = validTypes.map(async (featureType) => {
          const bbox = await provider.getBoundingBox(req.user, featureType);
          const title = featureType.charAt(0).toUpperCase() + featureType.slice(1).replace(/([A-Z])/g, ' $1');
          return {
            id: featureType,
            title,
            description: `Generic spatial ${featureType} dataset`,
            crs: getCollectionCrsList(),
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
      const bbox = await provider.getBoundingBox(req.user, collectionId);
      const title = collectionId.charAt(0).toUpperCase() + collectionId.slice(1).replace(/([A-Z])/g, ' $1');

      const getCollectionCrsList = () => {
        if (!options.crsTransformer) return ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'];
        return [
          'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
          ...options.crsTransformer.getSupportedCodes()
            .filter(c => c !== 'EPSG:4326')
            .map(c => `http://www.opengis.net/def/crs/EPSG/0/${c.replace('EPSG:', '')}`)
        ];
      };

      res.json({
        id: collectionId,
        title,
        description: `Spatial ${collectionId} dataset`,
        crs: getCollectionCrsList(),
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
      if (req.query.crs && options.crsTransformer) {
        const reqCrs = String(req.query.crs);
        if (options.crsTransformer.isSupported(reqCrs)) {
          targetSrs = options.crsTransformer.normalizeSrs(reqCrs);
          doReproject = true;
        } else {
          return res.status(400).json({ error: `Unsupported crs requested: ${reqCrs}` });
        }
      }

      let bboxSrs = 'EPSG:4326';
      if (req.query['bbox-crs'] && options.crsTransformer) {
        const reqBboxCrs = String(req.query['bbox-crs']);
        if (options.crsTransformer.isSupported(reqBboxCrs)) {
          bboxSrs = options.crsTransformer.normalizeSrs(reqBboxCrs);
        } else {
          return res.status(400).json({ error: `Unsupported bbox-crs requested: ${reqBboxCrs}` });
        }
      }

      // Parse pagination limits
      let limit = parseInt(String(req.query.limit || defaultLimit), 10);
      if (isNaN(limit) || limit < 1) limit = defaultLimit;
      if (limit > maxLimit) limit = maxLimit;

      let offset = parseInt(String(req.query.offset || req.query.startindex || 0), 10);
      if (isNaN(offset) || offset < 0) offset = 0;

      // Extract bounding box filter parameter
      let filterQuery: Record<string, any> = {};
      if (req.query.bbox) {
        const parts = String(req.query.bbox).split(',').map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n)) && options.crsTransformer) {
          let minLon = parts[0];
          let minLat = parts[1];
          let maxLon = parts[2];
          let maxLat = parts[3];

          // If bbox-crs is NOT WGS84, we must transform the coordinates of the bbox back to WGS84 prior to the provider query
          if (bboxSrs !== 'EPSG:4326') {
            const minPt = options.crsTransformer.transformCoordinate([minLon, minLat], bboxSrs, 'EPSG:4326');
            const maxPt = options.crsTransformer.transformCoordinate([maxLon, maxLat], bboxSrs, 'EPSG:4326');
            minLon = minPt[0];
            minLat = minPt[1];
            maxLon = maxPt[0];
            maxLat = maxPt[1];
          }

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
        const allFeatures = await provider.getFeatures(req.user, collectionId, [], filterQuery, { limit, offset });
        numberMatched = allFeatures.length;
        paginatedFeatures = allFeatures.slice(offset, offset + limit);
      }

      const numberReturned = paginatedFeatures.length;

      const geomType = (typeof provider.getGeometryType === 'function') 
        ? await provider.getGeometryType(req.user, collectionId) 
        : 'Point';

      const features = paginatedFeatures.map((feature) => {
        let geom = feature.geometry;
        if (doReproject && options.crsTransformer) {
          geom = options.crsTransformer.transformGeometry(geom, 'EPSG:4326', targetSrs);
        }
        return {
          type: 'Feature',
          id: `${collectionId}_${feature.id.toString()}`,
          geometry: {
            type: geom?.type || geomType,
            coordinates: geom?.coordinates || []
          },
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
        fcResponse.crs = req.query.crs;
      }

      res.type('application/geo+json').json(fcResponse);
    } catch (err) {
      if (logger) logger.error(`OGC Items error for ${collectionId}:`, err);
      next(err);
    }
  });

  return router;
}
