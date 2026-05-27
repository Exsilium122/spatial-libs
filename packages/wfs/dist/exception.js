import { create } from 'xmlbuilder2';
export function buildExceptionXml(code, locator, msg, version = '1.1.0') {
    // WFS 2.0.0 uses OwsExceptionReport, while older versions use ServiceExceptionReport
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
        return create(xmlData).end({ prettyPrint: true });
    }
    else {
        // 1.0.0 or 1.1.0 standard
        const xmlData = {
            ServiceExceptionReport: {
                '@version': version === '1.0.0' ? '1.2.0' : '1.1.0',
                '@xmlns': 'http://www.opengis.net/ogc',
                '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                '@xsi:schemaLocation': 'http://www.opengis.net/ogc http://schemas.opengis.net/wfs/1.1.0/wfs.xsd',
                ServiceException: {
                    '@code': String(code),
                    '@locator': locator,
                    '#text': msg,
                },
            },
        };
        return create(xmlData).end({ prettyPrint: true });
    }
}
export function buildExceptionResponse(code, locator, msg, version = '1.1.0') {
    const body = buildExceptionXml(code, locator, msg, version);
    return {
        status: 400,
        headers: {
            'Content-Type': 'text/xml'
        },
        body
    };
}
