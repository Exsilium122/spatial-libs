import { buildXml } from './xmlHelper.js';
import { GenericResponse } from './types.js';

export const INTERNAL_ERROR_MESSAGE = 'An internal error occurred while processing the request.';

export class WfsClientError extends Error {
  readonly isClientSafe = true;
  readonly code: string | number;
  readonly locator: string;

  constructor(message: string, code: string | number = 400, locator: string = 'WFS') {
    super(message);
    this.name = 'WfsClientError';
    this.code = code;
    this.locator = locator;
    Object.setPrototypeOf(this, WfsClientError.prototype);
  }
}

export function buildExceptionXml(code: string | number, locator: string, msg: string, version: string = '1.1.0'): string {
  // WFS 2.0.0 uses OWS ExceptionReport 1.1.0
  if (version.startsWith('2.')) {
    const xmlData = {
      'ows:ExceptionReport': {
        '@version': '2.0.0',
        '@xmlns:ows': 'http://www.opengis.net/ows/1.1',
        '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        '@xsi:schemaLocation': 'http://www.opengis.net/ows/1.1 http://schemas.opengis.net/ows/1.1.0/owsExceptionReport.xsd',
        'ows:Exception': {
          '@exceptionCode': String(code),
          '@locator': locator,
          'ows:ExceptionText': msg
        }
      }
    };
    return buildXml(xmlData);
  } else if (version === '1.1.0') {
    // WFS 1.1.0 uses OWS ExceptionReport version 1.1.0
    const xmlData = {
      'ows:ExceptionReport': {
        '@version': '1.1.0',
        '@xmlns:ows': 'http://www.opengis.net/ows',
        '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        '@xsi:schemaLocation': 'http://www.opengis.net/ows http://schemas.opengis.net/ows/1.1.0/owsExceptionReport.xsd',
        'ows:Exception': {
          '@exceptionCode': String(code),
          '@code': String(code),
          '@locator': locator,
          'ows:ExceptionText': msg
        }
      }
    };
    return buildXml(xmlData);
  } else {
    // 1.0.0 standard uses ServiceExceptionReport version 1.2.0 in OGC namespace
    const xmlData = {
      ServiceExceptionReport: {
        '@version': '1.2.0',
        '@xmlns': 'http://www.opengis.net/ogc',
        '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        '@xsi:schemaLocation': 'http://www.opengis.net/ogc http://schemas.opengis.net/wfs/1.0.0/OGC-exception.xsd',
        ServiceException: {
          '@code': String(code),
          '@locator': locator,
          '#text': msg,
        },
      },
    };
    return buildXml(xmlData);
  }
}

export function buildExceptionResponse(
  code: string | number,
  locator: string,
  msg: string,
  version: string = '1.1.0',
  status: number = 400
): GenericResponse {
  if (code === 'NotFound' && status === 400) status = 404;
  if (code === 'OperationProcessingFailed' && status === 400) status = 500;
  const body = buildExceptionXml(code, locator, msg, version);
  return {
    status,
    headers: {
      'Content-Type': 'text/xml'
    },
    body
  };
}
