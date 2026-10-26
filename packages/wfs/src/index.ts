import express, { Request, Response, NextFunction } from 'express';
import xmlparser from 'express-xml-bodyparser';
import { WfsOptions, GenericRequest, GenericResponse, SpatialDataProvider } from './types.js';
import { handleWfs100 } from './v1_0_0.js';
import { handleWfs110 } from './v1_1_0.js';
import { handleWfs200 } from './v2_0_0.js';
import { buildExceptionXml, buildExceptionResponse, WfsClientError, INTERNAL_ERROR_MESSAGE } from './exception.js';

// Export everything for granular consumption
export * from './types.js';
export { handleWfs100 } from './v1_0_0.js';
export { handleWfs110 } from './v1_1_0.js';
export { handleWfs200 } from './v2_0_0.js';

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
    '[Spatial-API WFS Verification Error]: The provided SpatialDataProvider'
  );
}

function verifyTransformer(transformer: any): void {
  verifyInterface(
    transformer,
    ['normalizeSrs', 'isSupported', 'getSupportedCodes', 'transformCoordinate', 'transformGeometry'],
    '[Spatial-API WFS Verification Error]: The provided CoordinateTransformer'
  );
}

function verifyLogger(logger: any): void {
  verifyInterface(
    logger,
    ['info', 'warn', 'error'],
    '[Spatial-API WFS Verification Error]: The provided Logger'
  );
}

function parseVersion(v: string): number[] {
  return v.split('.').map((n) => parseInt(n, 10) || 0);
}

function compareVersions(v1: string, v2: string): number {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 !== n2) return n1 - n2;
  }
  return 0;
}

const SUPPORTED_VERSIONS = ['1.0.0', '1.1.0', '2.0.0', '2.0.2'] as const;

function negotiateVersion(requested: string): string {
  if (SUPPORTED_VERSIONS.includes(requested as any)) {
    return requested;
  }
  if (compareVersions(requested, '2.0.2') >= 0) {
    return '2.0.2';
  }
  if (compareVersions(requested, '1.0.0') <= 0) {
    return '1.0.0';
  }
  for (let i = SUPPORTED_VERSIONS.length - 1; i >= 0; i--) {
    if (compareVersions(requested, SUPPORTED_VERSIONS[i]) >= 0) {
      return SUPPORTED_VERSIONS[i];
    }
  }
  return '1.0.0';
}

/**
 * Framework-agnostic unified WFS request dispatcher.
 */
export async function dispatchWfsRequest(
  req: GenericRequest,
  options: WfsOptions
): Promise<GenericResponse> {
  const method = (req.method || 'GET').toUpperCase();
  const query: Record<string, any> = {};
  for (const k of Object.keys(req.query || {})) {
    query[k.toUpperCase()] = req.query[k];
  }
  const request = (query.REQUEST || '').toLowerCase();
  const rawService = query.SERVICE;
  const rawVersion = query.VERSION;
  const rawAcceptVersions = query.ACCEPTVERSIONS;

  let version = rawVersion ? String(rawVersion) : '';

  try {
    const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
    if (method === 'POST') {
      let bodyLength = 0;
      if (typeof req.body === 'string') {
        bodyLength = Buffer.byteLength(req.body);
      } else if (Buffer.isBuffer(req.body)) {
        bodyLength = req.body.length;
      } else if (typeof (req as any).rawBody === 'string') {
        bodyLength = Buffer.byteLength((req as any).rawBody);
      }
      if (bodyLength > maxBodyBytes) {
        return buildExceptionResponse(
          'OperationProcessingFailed',
          'request',
          `Request body exceeds maximum allowed size of ${maxBodyBytes} bytes`,
          version || '1.1.0',
          413
        );
      }
    }

    if (method === 'GET' && request) {
      if (rawService !== undefined && String(rawService).toUpperCase() !== 'WFS') {
        return buildExceptionResponse('InvalidParameterValue', 'service', `SERVICE parameter must be "WFS", received "${rawService}"`, '2.0.0');
      }
      if (rawService === undefined) {
        return buildExceptionResponse('MissingParameterValue', 'service', 'Missing mandatory SERVICE parameter', '2.0.0');
      }
      if (request !== 'getcapabilities' && !rawVersion) {
        return buildExceptionResponse('MissingParameterValue', 'version', 'Missing mandatory VERSION parameter', '2.0.0');
      }
    }

    if (request === 'getcapabilities') {
      if (rawAcceptVersions) {
        const versions = String(rawAcceptVersions).split(',').map((s) => s.trim());
        if (versions.includes('2.0.2')) {
          version = '2.0.2';
        } else if (versions.includes('2.0.0')) {
          version = '2.0.0';
        } else if (versions.includes('1.1.0')) {
          version = '1.1.0';
        } else if (versions.includes('1.0.0')) {
          version = '1.0.0';
        } else {
          const body = buildExceptionXml(
            'VersionNegotiationFailed',
            'AcceptVersions',
            `None of the requested versions (${rawAcceptVersions}) are supported.`,
            '1.1.0'
          );
          return {
            status: 400,
            headers: { 'Content-Type': 'text/xml' },
            body,
          };
        }
      } else if (version) {
        version = negotiateVersion(version);
      } else {
        version = '2.0.2';
      }
    } else {
      // Non-GetCapabilities request with explicit version
      if (version && !SUPPORTED_VERSIONS.includes(version as any)) {
        return buildExceptionResponse('InvalidParameterValue', 'version', `Unsupported WFS version: ${version}`, '2.0.0');
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
      return await handleWfs200(req, options);
    } else if (version === '1.1.0') {
      return await handleWfs110(req, options);
    } else {
      return await handleWfs100(req, options);
    }
  } catch (err: any) {
    if (err instanceof WfsClientError || err?.isClientSafe) {
      return buildExceptionResponse(err.code || 400, err.locator || 'WFS', err.message, version || '1.1.0');
    }
    if (options.logger) {
      options.logger.error('WFS dispatch error:', err);
    }
    return buildExceptionResponse('OperationProcessingFailed', 'WFS', INTERNAL_ERROR_MESSAGE, version || '2.0.2', 500);
  }
}

const HOST_REGEX = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
const IPV6_HOST_REGEX = /^\[[a-fA-F0-9:]+\](:\d{1,5})?$/;

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isValidHost(host: string): boolean {
  return HOST_REGEX.test(host) || IPV6_HOST_REGEX.test(host);
}

function resolveBaseUrl(req: Request, options: WfsOptions): string | undefined {
  if (isAbsoluteUrl(options.baseUrl)) {
    return options.baseUrl;
  }

  const host = req.get('host');
  if (!host || typeof host !== 'string' || !isValidHost(host)) {
    return undefined;
  }

  if (options.trustedHosts) {
    const isAllowed = options.trustedHosts.some(
      (trusted) => trusted.toLowerCase() === host.toLowerCase()
    );
    if (!isAllowed) {
      return undefined;
    }
  }

  return `${req.protocol}://${host}${req.baseUrl}`;
}

/**
 * Creates a standard Express router configured with the WFS protocol handlers.
 */
export default function createWfsRouter(options: WfsOptions): express.Router {
  // 1. Boot-time check
  verifyProvider(options.provider);
  if (options.crsTransformer) {
    verifyTransformer(options.crsTransformer);
  }
  if (options.logger) {
    verifyLogger(options.logger);
  }

  if (options.crsTransformer) {
    options.logger?.info(`[Spatial WFS] CRS Reprojection enabled. Injected systems: ${options.crsTransformer.getSupportedCodes().join(', ')}`);
  } else {
    options.logger?.info('[Spatial WFS] Operating in native WGS84 mode (No CRS transformer injected).');
  }

  if (!isAbsoluteUrl(options.baseUrl) && !options.trustedHosts) {
    options.logger?.warn(
      '[Spatial WFS] baseUrl is relative and trustedHosts is not configured. An absolute baseUrl or trustedHosts allowlist is recommended to prevent Host header poisoning.'
    );
  }

  const router = express.Router();
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  // Enforce maximum POST body size
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST') {
      const contentLengthHeader = req.headers['content-length'];
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > maxBodyBytes) {
          const exception = buildExceptionResponse(
            'OperationProcessingFailed',
            'request',
            `Request body exceeds maximum allowed size of ${maxBodyBytes} bytes`,
            '1.1.0',
            413
          );
          res.status(413);
          for (const [k, v] of Object.entries(exception.headers)) {
            res.setHeader(k, v);
          }
          return res.send(exception.body);
        }
      }

      let receivedBytes = 0;
      let exceeded = false;
      const onData = (chunk: any) => {
        receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        if (receivedBytes > maxBodyBytes && !exceeded) {
          exceeded = true;
          req.removeListener('data', onData);
          req.destroy();
          if (!res.headersSent) {
            const exception = buildExceptionResponse(
              'OperationProcessingFailed',
              'request',
              `Request body exceeds maximum allowed size of ${maxBodyBytes} bytes`,
              '1.1.0',
              413
            );
            res.status(413);
            for (const [k, v] of Object.entries(exception.headers)) {
              res.setHeader(k, v);
            }
            res.send(exception.body);
          }
        }
      };
      req.on('data', onData);
    }
    next();
  });

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
        baseUrl: resolveBaseUrl(req, options)
      };
      if ((req as any).rawBody !== undefined) {
        (genericReq as any).rawBody = (req as any).rawBody;
      }

      const result = await dispatchWfsRequest(genericReq, options);

      res.status(result.status);
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
      res.send(result.body);
    } catch (error: any) {
      if (options.logger) {
        options.logger.error('WFS router execution error:', error);
      }
      const genericResponse = (error instanceof WfsClientError || error?.isClientSafe)
        ? buildExceptionResponse(error.code || 400, error.locator || 'WFS', error.message, '1.1.0')
        : buildExceptionResponse('OperationProcessingFailed', 'WFS', INTERNAL_ERROR_MESSAGE, '2.0.2', 500);

      res.status(genericResponse.status);
      for (const [k, v] of Object.entries(genericResponse.headers)) {
        res.setHeader(k, v);
      }
      res.send(genericResponse.body);
    }
  };

  router.get('/', requestHandler);
  router.post('/', requestHandler);

  // Malformed XML bodies are rejected by xmlparser via next(err); answer with an OWS exception
  // instead of letting Express render its default HTML error page (which includes a stack trace).
  router.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    if (err.status === 413 || err.statusCode === 413) {
      const exception = buildExceptionResponse(
        'OperationProcessingFailed',
        'request',
        err.message || `Request body exceeds maximum allowed size of ${maxBodyBytes} bytes`,
        '1.1.0',
        413
      );
      res.status(413);
      for (const [k, v] of Object.entries(exception.headers)) {
        res.setHeader(k, v);
      }
      return res.send(exception.body);
    }
    options.logger?.warn('[Spatial WFS] Rejected unparseable request body:', err?.message);
    const exception = buildExceptionResponse('OperationParsingFailed', 'request', 'Request body is not well-formed XML', '1.1.0');
    res.status(400);
    for (const [k, v] of Object.entries(exception.headers)) {
      res.setHeader(k, v);
    }
    res.send(exception.body);
  });

  return router;
}
