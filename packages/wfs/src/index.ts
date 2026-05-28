import express, { Request, Response, NextFunction } from 'express';
import xmlparser from 'express-xml-bodyparser';
import { WfsOptions, GenericRequest, GenericResponse, SpatialDataProvider } from './types.js';
import { handleWfs100 } from './v1_0_0.js';
import { handleWfs110 } from './v1_1_0.js';
import { handleWfs200 } from './v2_0_0.js';
import { buildExceptionXml } from './exception.js';

// Export everything for granular consumption
export * from './types.js';
export { handleWfs100 } from './v1_0_0.js';
export { handleWfs110 } from './v1_1_0.js';
export { handleWfs200 } from './v2_0_0.js';

/**
 * Boot-time verification helper to check if the data provider implements necessary methods.
 */
function verifyProvider(provider: SpatialDataProvider): void {
  const requiredMethods = ['getSupportedTypes', 'getBoundingBox', 'getFeatures'] as const;
  for (const m of requiredMethods) {
    if (typeof provider[m] !== 'function') {
      throw new Error(
        `[Spatial-API WFS Verification Error]: The provided SpatialDataProvider is missing the required method "${m}".`
      );
    }
  }
}

/**
 * Framework-agnostic unified WFS request dispatcher.
 */
export async function dispatchWfsRequest(
  req: GenericRequest,
  options: WfsOptions
): Promise<GenericResponse> {
  // Determine requested WFS version case-insensitively
  let version = req.query?.VERSION || req.query?.version || req.query?.Version || '';

  // Check AcceptVersions parameter (used in GetCapabilities)
  const acceptVersions = req.query?.ACCEPTVERSIONS || req.query?.acceptVersions || req.query?.AcceptVersions;
  if (!version && acceptVersions) {
    const versions = String(acceptVersions).split(',');
    if (versions.includes('2.0.2')) {
      version = '2.0.2';
    } else if (versions.includes('2.0.0')) {
      version = '2.0.0';
    } else if (versions.includes('1.1.0')) {
      version = '1.1.0';
    } else if (versions.includes('1.0.0')) {
      version = '1.0.0';
    }
  }

  // Check POST body (already parsed by xmlparser)
  if (!version && req.body) {
    const bodyKeys = Object.keys(req.body);
    if (bodyKeys.length > 0) {
      const rootNode = req.body[bodyKeys[0]];
      version = rootNode?.$?.version || '';
    }
  }

  // Default to highest version: 2.0.2
  if (!version) {
    version = '2.0.2';
  }

  // Apply enabledVersions constraint if specified
  if (options.enabledVersions && options.enabledVersions.length > 0) {
    const matchVer = version as any;
    if (!options.enabledVersions.includes(matchVer)) {
      const body = buildExceptionXml(
        'VersionNegotiationFailed',
        'version',
        `WFS version ${version} is disabled by administrator.`,
        '1.1.0'
      );
      return {
        status: 400,
        headers: { 'Content-Type': 'text/xml' },
        body
      };
    }
  }

  // Dispatch to the correct version handler
  if (version === '2.0.0' || version === '2.0.2') {
    return handleWfs200(req, options);
  } else if (version === '1.1.0') {
    return handleWfs110(req, options);
  } else {
    return handleWfs100(req, options);
  }
}

/**
 * Creates a standard Express router configured with the WFS protocol handlers.
 */
export default function createWfsRouter(options: WfsOptions): express.Router {
  // 1. Boot-time check
  verifyProvider(options.provider);

  const router = express.Router();

  // 2. Register XML body parser middleware at root so we can parse POST bodies
  // Using cast since express-xml-bodyparser has older typing shapes
  router.use(xmlparser({ trim: false, explicitArray: true }) as any);

  // Normalize request queries case-insensitively
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.query) {
      const normalizedQuery: Record<string, any> = {};
      for (const key of Object.keys(req.query)) {
        normalizedQuery[key.toUpperCase()] = req.query[key];
      }
      // Put standard properties inside a generic query property to prevent mutating Express's type check
      (req as any).normalizedQuery = normalizedQuery;
    }
    next();
  });

  const requestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const genericReq: GenericRequest = {
        method: req.method as any,
        query: (req as any).normalizedQuery || req.query,
        body: req.body,
        user: (req as any).user || {},
        baseUrl: `${req.protocol}://${req.get('host')}${req.baseUrl}`
      };

      const result = await dispatchWfsRequest(genericReq, options);

      res.status(result.status);
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
      res.send(result.body);
    } catch (error) {
      if (options.logger) {
        options.logger.error('WFS router execution error:', error);
      }
      next(error);
    }
  };

  router.get('/', requestHandler);
  router.post('/', requestHandler);

  return router;
}
