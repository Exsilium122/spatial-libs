import { buildXml } from './xmlHelper.js';
import { GenericRequest, GenericResponse, WfsOptions } from './types.js';
import { buildExceptionResponse, WfsClientError, INTERNAL_ERROR_MESSAGE } from './exception.js';
import { parseFilterString, parseFilterObj, normalizeKeys, FilterValidationError } from './filterParser.js';
import { resolvePropertiesSchema, findUnadvertisedFilterProperty, assertFilterPropertiesAdvertised } from './queryGuard.js';

const XML_NCNAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.-]*$/;

let lastTimestampMs = 0;
let cachedTimestampStr = '';

function getResponseTimestamp(): string {
  const now = Date.now();
  if (now - lastTimestampMs < 2000 && cachedTimestampStr) {
    return cachedTimestampStr;
  }
  lastTimestampMs = now;
  cachedTimestampStr = new Date(now).toISOString();
  return cachedTimestampStr;
}

function formatGmlGeometry(
  geom: any,
  featureId: string | number,
  srsName: string,
  isLatFirstOrder: boolean
): Record<string, any> | null {
  if (!geom || !geom.coordinates || !geom.type) {
    return null;
  }

  const { type, coordinates: coords } = geom;

  if (type === 'Point') {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const posStr = isLatFirstOrder
      ? `${coords[1]} ${coords[0]}`
      : `${coords[0]} ${coords[1]}`;
    return {
      'gml:Point': {
        '@gml:id': `p_${featureId.toString()}`,
        '@srsName': srsName,
        'gml:pos': posStr,
      },
    };
  }

  const formatRing = (ring: any[]) =>
    ring.map((coor: any) => (isLatFirstOrder ? `${coor[1]} ${coor[0]}` : `${coor[0]} ${coor[1]}`)).join(' ');

  if (type === 'LineString') {
    if (!Array.isArray(coords)) return null;
    const posListStr = formatRing(coords);
    return {
      'gml:LineString': {
        '@gml:id': `l_${featureId.toString()}`,
        '@srsName': srsName,
        'gml:posList': posListStr,
      },
    };
  }

  if (type === 'Polygon') {
    if (!Array.isArray(coords) || coords.length === 0) return null;
    const exterior = coords[0] ? {
      'gml:LinearRing': {
        'gml:posList': formatRing(coords[0]),
      },
    } : undefined;

    const interiorRings = coords.slice(1);
    const interior = interiorRings.length > 0
      ? interiorRings.map((ring: any[]) => ({
          'gml:LinearRing': {
            'gml:posList': formatRing(ring),
          },
        }))
      : undefined;

    const polyObj: Record<string, any> = {
      '@gml:id': `poly_${featureId.toString()}`,
      '@srsName': srsName,
    };
    if (exterior) {
      polyObj['gml:exterior'] = exterior;
    }
    if (interior) {
      polyObj['gml:interior'] = interior.length === 1 ? interior[0] : interior;
    }
    return {
      'gml:Polygon': polyObj,
    };
  }

  if (type === 'MultiPoint') {
    if (!Array.isArray(coords)) return null;
    return {
      'gml:MultiPoint': {
        '@gml:id': `mp_${featureId.toString()}`,
        '@srsName': srsName,
        'gml:pointMember': coords.map((pt: any, i: number) => ({
          'gml:Point': {
            '@gml:id': `p_${featureId}_${i}`,
            'gml:pos': isLatFirstOrder ? `${pt[1]} ${pt[0]}` : `${pt[0]} ${pt[1]}`,
          },
        })),
      },
    };
  }

  if (type === 'MultiLineString') {
    if (!Array.isArray(coords)) return null;
    return {
      'gml:MultiCurve': {
        '@gml:id': `mc_${featureId.toString()}`,
        '@srsName': srsName,
        'gml:curveMember': coords.map((line: any, i: number) => ({
          'gml:LineString': {
            '@gml:id': `l_${featureId}_${i}`,
            'gml:posList': formatRing(line),
          },
        })),
      },
    };
  }

  if (type === 'MultiPolygon') {
    if (!Array.isArray(coords)) return null;
    return {
      'gml:MultiSurface': {
        '@gml:id': `ms_${featureId.toString()}`,
        '@srsName': srsName,
        'gml:surfaceMember': coords.map((polyCoords: any, i: number) => {
          const ext = polyCoords[0] ? {
            'gml:LinearRing': {
              'gml:posList': formatRing(polyCoords[0]),
            },
          } : undefined;
          const inRings = polyCoords.slice(1);
          const intObj = inRings.length > 0 ? inRings.map((r: any[]) => ({
            'gml:LinearRing': {
              'gml:posList': formatRing(r),
            },
          })) : undefined;
          const p: Record<string, any> = {
            '@gml:id': `poly_${featureId}_${i}`,
          };
          if (ext) p['gml:exterior'] = ext;
          if (intObj) p['gml:interior'] = intObj.length === 1 ? intObj[0] : intObj;
          return { 'gml:Polygon': p };
        }),
      },
    };
  }

  return null;
}

export async function handleWfs200(
  req: GenericRequest,
  options: WfsOptions
): Promise<GenericResponse> {
  const { provider, logger, baseUrl } = options;
  const activeBaseUrl = (baseUrl.startsWith('http') || !req.baseUrl) ? baseUrl : req.baseUrl;
  const nsPrefix = options.xmlOptions?.namespaces ? Object.keys(options.xmlOptions.namespaces)[0] : 'ns';
  const nsUri = options.xmlOptions?.namespaces ? Object.values(options.xmlOptions.namespaces)[0] : 'http://example.com/ns';

  // Normalize queries to uppercase keys
  const query: Record<string, any> = {};
  for (const k of Object.keys(req.query || {})) {
    query[k.toUpperCase()] = req.query[k];
  }

  // Determine version (2.0.0 vs 2.0.2)
  let version = '2.0.2';
  const queryVer = query.VERSION;
  if (queryVer === '2.0.0') {
    version = '2.0.0';
  } else if (query.ACCEPTVERSIONS) {
    const acc = String(query.ACCEPTVERSIONS).split(',').map((s) => s.trim());
    if (!acc.includes('2.0.2') && acc.includes('2.0.0')) {
      version = '2.0.0';
    }
  }

  const requestType = (query.REQUEST || '').toLowerCase();

  // Route POST actions from body
  let postAction = '';
  if (req.method === 'POST' && req.body) {
    const bodyKeys = Object.keys(req.body);
    if (bodyKeys.length > 0) {
      postAction = bodyKeys[0].replace(/^.*:/, '').toLowerCase();
    }
  }

  try {
    if (requestType === 'liststoredqueries' || postAction === 'liststoredqueries') {
      const xmlData = {
        'wfs:ListStoredQueriesResponse': {
          '@xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
          '@xmlns:ows': 'http://www.opengis.net/ows/1.1',
          '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          '@xsi:schemaLocation': 'http://www.opengis.net/wfs/2.0 http://schemas.opengis.net/wfs/2.0/wfs.xsd',
          'wfs:StoredQuery': [
            {
              '@id': 'http://www.opengis.net/def/query/OGC-WFS/0/GetFeatureById',
              'wfs:Title': 'Get feature by identifier',
              'wfs:ReturnFeatureType': (await provider.getSupportedTypes(req.user)).map((t: string) => `${nsPrefix}:${t}`),
            }
          ]
        }
      };
      return {
        status: 200,
        headers: { 'Content-Type': 'application/gml+xml; version=3.2' },
        body: buildXml(xmlData),
      };
    }

    if (requestType === 'getcapabilities' || postAction === 'getcapabilities') {
      const types = await provider.getSupportedTypes(req.user);

      const xmlData: Record<string, any> = {
        'wfs:WFS_Capabilities': {
          '@version': version,
          '@xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
          [`@xmlns:${nsPrefix}`]: nsUri,
          '@xmlns:ows': 'http://www.opengis.net/ows/1.1',
          '@xmlns:fes': 'http://www.opengis.net/fes/2.0',
          '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          '@xmlns:xlink': 'http://www.w3.org/1999/xlink',
          '@xsi:schemaLocation': 'http://www.opengis.net/wfs/2.0 http://schemas.opengis.net/wfs/2.0/wfs.xsd',

          'ows:ServiceIdentification': {
            'ows:Title': 'Web Feature Service',
            'ows:Abstract': `Generic WFS ${version} Service`,
            'ows:Keywords': {
              'ows:Keyword': ['WFS', 'GIS', 'Spatial-API'],
            },
            'ows:ServiceType': 'WFS',
            'ows:ServiceTypeVersion': version,
            'ows:Fees': 'NONE',
            'ows:AccessConstraints': 'NONE',
          },

          'ows:ServiceProvider': {
            'ows:ProviderName': 'Spatial Provider',
            'ows:ProviderSite': {
              '@xlink:href': activeBaseUrl,
            },
            'ows:ServiceContact': {
              'ows:IndividualName': 'Administrator',
            },
          },

          'ows:OperationsMetadata': {
            'ows:Operation': [
              {
                '@name': 'GetCapabilities',
                'ows:DCP': {
                  'ows:HTTP': {
                    'ows:Get': {
                      '@xlink:href': `${activeBaseUrl}?`,
                    },
                  },
                },
                'ows:Parameter': {
                  '@name': 'AcceptVersions',
                  'ows:Value': ['2.0.2', '2.0.0', '1.1.0', '1.0.0'],
                },
              },
              {
                '@name': 'DescribeFeatureType',
                'ows:DCP': {
                  'ows:HTTP': {
                    'ows:Get': {
                      '@xlink:href': `${activeBaseUrl}?`,
                    },
                  },
                },
                'ows:Parameter': {
                  '@name': 'outputFormat',
                  'ows:Value': ['application/gml+xml; version=3.2', 'text/xml; subtype=gml/3.2'],
                },
              },
              {
                '@name': 'GetFeature',
                'ows:DCP': {
                  'ows:HTTP': {
                    'ows:Get': {
                      '@xlink:href': `${activeBaseUrl}?`,
                    },
                    'ows:Post': {
                      '@xlink:href': activeBaseUrl,
                    },
                  },
                },
                'ows:Parameter': [
                  {
                    '@name': 'resultType',
                    'ows:Value': ['results'],
                  },
                  {
                    '@name': 'outputFormat',
                    'ows:Value': ['application/gml+xml; version=3.2', 'text/xml; subtype=gml/3.2'],
                  },
                ],
              },
            ],
          },

          'wfs:FeatureTypeList': {
            'wfs:FeatureType': [],
          },

          'fes:Filter_Capabilities': {
            'fes:Conformance': {
              'fes:Constraint': [
                {
                  '@name': 'ImplementsQuery',
                  'ows:NoValues': {},
                  'ows:DefaultValue': 'TRUE',
                },
                {
                  '@name': 'ImplementsAdHocQuery',
                  'ows:NoValues': {},
                  'ows:DefaultValue': 'TRUE',
                },
              ],
            },
            'fes:Spatial_Capabilities': {
              'fes:GeometryOperands': {
                'fes:GeometryOperand': [
                  { '@name': 'gml:Envelope' },
                  { '@name': 'gml:Point' },
                  { '@name': 'gml:LineString' },
                ],
              },
              'fes:SpatialOperators': {
                'fes:SpatialOperator': {
                  '@name': 'BBOX',
                },
              },
            },
            'fes:Scalar_Capabilities': {
              'fes:LogicalOperators': {},
              'fes:ComparisonOperators': {
                'fes:ComparisonOperator': [
                  { '@name': 'ValueReference' },
                  { '@name': 'PropertyIsEqualTo' },
                  { '@name': 'PropertyIsNotEqualTo' },
                  { '@name': 'PropertyIsLike' },
                ],
              },
            },
          },
        },
      };

      const promises = types.map(async (type) => {
        const bbox = await provider.getBoundingBox(req.user, type);
        const otherSrsList = options.crsTransformer
          ? options.crsTransformer.getSupportedCodes()
              .filter(c => c !== 'EPSG:4326')
              .map(c => `urn:ogc:def:crs:EPSG::${c.replace('EPSG:', '')}`)
          : [];
        return {
          'wfs:Name': `${nsPrefix}:${type}`,
          'wfs:Title': type,
          'wfs:Abstract': `Collection of ${type} features`,
          'wfs:DefaultCRS': 'urn:ogc:def:crs:EPSG::4326',
          ...(otherSrsList.length > 0 ? { 'wfs:OtherCRS': otherSrsList } : {}),
          'ows:WGS84BoundingBox': {
            'ows:LowerCorner': `${bbox.minLon} ${bbox.minLat}`,
            'ows:UpperCorner': `${bbox.maxLon} ${bbox.maxLat}`,
          },
        };
      });

      xmlData['wfs:WFS_Capabilities']['wfs:FeatureTypeList']['wfs:FeatureType'] = await Promise.all(promises);

      const xml = buildXml(xmlData);
      return {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: xml,
      };
    }

    if (requestType === 'describefeaturetype') {
      const supported = await provider.getSupportedTypes(req.user);
      let typeName = query.TYPENAME || query.TYPENAMES || '';
      let cleanTypes: string[] = [];
      if (typeName) {
        cleanTypes = String(typeName).split(',').map((t: string) => t.trim().replace(/^[^:]+:/, ''));
        for (const ct of cleanTypes) {
          if (!supported.includes(ct)) {
            return buildExceptionResponse('InvalidParameterValue', query.TYPENAMES ? 'typeNames' : 'typeName', `Feature type '${ct}' is not advertised by this service.`, version, 400);
          }
        }
      } else {
        cleanTypes = supported;
      }

      if (cleanTypes.length === 0) {
        return buildExceptionResponse('InvalidParameterValue', 'typeNames', 'No feature types available', version, 400);
      }

      const elementList: any[] = [];
      const complexTypeList: any[] = [];

      for (const cleanType of cleanTypes) {
        const geomType = (typeof provider.getGeometryType === 'function') 
          ? await provider.getGeometryType(req.user, cleanType) 
          : 'Point';

        const gmlGeomType = geomType === 'LineString' ? 'gml:CurvePropertyType' : 'gml:PointPropertyType';

        // Dynamic schema resolution
        const propertiesSchema = await resolvePropertiesSchema(provider, req.user, cleanType);

        const elements: any[] = [
          {
            '@name': 'geo',
            '@nillable': 'true',
            '@type': gmlGeomType,
          }
        ];

        for (const [propName, propType] of Object.entries(propertiesSchema)) {
          if (!XML_NCNAME_REGEX.test(propName)) continue;
          let xsdType = 'string';
          if (propType === 'integer') xsdType = 'integer';
          else if (propType === 'double') xsdType = 'double';
          else if (propType === 'boolean') xsdType = 'boolean';

          elements.push({
            '@name': propName,
            '@type': xsdType,
          });
        }

        elementList.push({
          '@name': cleanType,
          '@type': `${nsPrefix}:${cleanType}_Type`,
          '@substitutionGroup': 'gml:AbstractFeature',
        });

        complexTypeList.push({
          '@name': `${cleanType}_Type`,
          complexContent: {
            extension: {
              '@base': 'gml:AbstractFeatureType',
              sequence: {
                element: elements,
              },
            },
          },
        });
      }

      const xmlData = {
        schema: {
          '@targetNamespace': nsUri,
          [`@xmlns:${nsPrefix}`]: nsUri,
          '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
          '@xmlns': 'http://www.w3.org/2001/XMLSchema',
          '@xmlns:gml': 'http://www.opengis.net/gml/3.2',
          '@elementFormDefault': 'qualified',
          '@version': '0.1',
          import: {
            '@namespace': 'http://www.opengis.net/gml/3.2',
            '@schemaLocation': 'http://schemas.opengis.net/gml/3.2.1/gml.xsd',
          },
          element: elementList.length === 1 ? elementList[0] : elementList,
          complexType: complexTypeList.length === 1 ? complexTypeList[0] : complexTypeList,
        },
      };

      const xml = buildXml(xmlData);
      return {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: xml,
      };
    }

    if (requestType === 'getfeature' || postAction === 'getfeature') {
      const storedQueryId = query.STOREDQUERY_ID || '';
      if (storedQueryId) {
        if (storedQueryId.includes('GetFeatureById')) {
          const rawId = query.ID !== undefined ? query.ID : query.FEATUREID;
          if (rawId === undefined || rawId === null || rawId === '') {
            return buildExceptionResponse('MissingParameterValue', 'id', 'Missing mandatory parameter: id', version, 400);
          }
          if (typeof rawId !== 'string' && typeof rawId !== 'number') {
            return buildExceptionResponse('InvalidParameterValue', 'id', 'Invalid parameter: id must be a primitive string', version, 400);
          }
          const id = String(rawId);
          if (!id) {
            return buildExceptionResponse('MissingParameterValue', 'id', 'Missing mandatory parameter: id', version, 400);
          }
          const supported = await provider.getSupportedTypes(req.user);
          let foundFeature: any = null;
          let foundType: string = '';
          for (const t of supported) {
            const matches = await provider.getFeatures(req.user, t, [id]);
            if (matches.length > 0) {
              foundFeature = matches[0];
              foundType = t;
              break;
            }
          }
          if (!foundFeature) {
            return buildExceptionResponse('NotFound', 'id', `Feature with id '${id}' not found`, version, 404);
          }

          const geom = foundFeature.geometry;
          const responseSrsName = 'urn:ogc:def:crs:EPSG::4326';
          const gmlGeo = geom ? formatGmlGeometry(geom, foundFeature.id, responseSrsName, true) : null;

          const featureProps: Record<string, any> = {};
          if (gmlGeo) {
            featureProps[`${nsPrefix}:geo`] = gmlGeo;
          }
          for (const [k, v] of Object.entries(foundFeature.properties || {})) {
            if (!XML_NCNAME_REGEX.test(k)) continue;
            featureProps[`${nsPrefix}:${k}`] = v !== null && v !== undefined ? String(v) : '';
          }

          const xmlData = {
            [`${nsPrefix}:${foundType}`]: {
              '@xmlns:gml': 'http://www.opengis.net/gml/3.2',
              '@xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
              [`@xmlns:${nsPrefix}`]: nsUri,
              '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
              '@xsi:schemaLocation': `${nsUri} ${activeBaseUrl}?service=WFS&version=${version}&request=DescribeFeatureType&typeNames=${nsPrefix}:${foundType} http://www.opengis.net/wfs/2.0 http://schemas.opengis.net/wfs/2.0/wfs.xsd`,
              '@gml:id': `${foundType}_${foundFeature.id.toString()}`,
              ...featureProps,
            },
          };

          return {
            status: 200,
            headers: { 'Content-Type': 'application/gml+xml; version=3.2' },
            body: buildXml(xmlData),
          };
        } else {
          return buildExceptionResponse('InvalidParameterValue', 'storedQuery_id', `Unknown stored query: ${storedQueryId}`, version, 400);
        }
      }

      let featureType;
      let fids: string[] = [];
      let filterQuery: Record<string, any> = {};
      let requestedSrs = '';

      if (req.method === 'GET') {
        featureType = query.TYPENAME || query.TYPENAMES || '';
        requestedSrs = query.SRSNAME || '';
        if (query.FEATUREID) {
          fids = String(query.FEATUREID).split(',');
        }
        if (query.RESOURCEID) {
          fids = String(query.RESOURCEID).split(',');
        }

        // BBOX parsing
        if (query.BBOX) {
          const parts = String(query.BBOX).split(',');
          const coords = parts.slice(0, 4).map(Number);
          if (coords.length === 4 && coords.every(n => !isNaN(n))) {
            let isLatFirst = false;
            if (parts.length >= 5) {
              const bboxCrs = parts[4].trim();
              isLatFirst = /^(?:urn:(?:x-)?ogc:def:crs:EPSG:(?:[\d.]*:)?4326|https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/[\d.]+\/4326)$/i.test(bboxCrs);
            } else {
              // DefaultCRS in WFS 2.0 is urn:ogc:def:crs:EPSG::4326 (lat/lon per Table 8 note c)
              isLatFirst = true;
            }

            let minLon, minLat, maxLon, maxLat;
            if (isLatFirst) {
              minLat = coords[0];
              minLon = coords[1];
              maxLat = coords[2];
              maxLon = coords[3];
            } else {
              minLon = coords[0];
              minLat = coords[1];
              maxLon = coords[2];
              maxLat = coords[3];
            }

            if (minLon >= maxLon || minLat >= maxLat) {
              return buildExceptionResponse('InvalidParameterValue', 'bbox', 'Invalid BBOX coordinates: minimum >= maximum', version, 400);
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

        if (query.FILTER) {
          const filterNode = await parseFilterString(query.FILTER);
          if (filterNode) {
            const parsed = parseFilterObj(filterNode);
            if (parsed) {
              filterQuery = { ...filterQuery, ...parsed };
            }
          }
        }
      } else {
        // POST parsing
        const getf = req.body['wfs:getfeature'] || req.body.getfeature || {};
        const queries = getf['wfs:query'] || getf.query || [];
        const queryNode = queries[0] || {};
        featureType = queryNode.$ && (queryNode.$.typeNames || queryNode.$.typeName);
        requestedSrs = queryNode.$ && queryNode.$.srsName;

        const filters = queryNode['fes:filter'] || queryNode['ogc:filter'] || queryNode.filter;
        if (filters) {
          const normalized = normalizeKeys(filters[0]);
          if (normalized.ResourceId || normalized.FeatureId) {
            const resIdNode = normalized.ResourceId || normalized.FeatureId;
            const fidList = Array.isArray(resIdNode) ? resIdNode : [resIdNode];
            fids = fidList.map((node: any) => node.$?.rid || node.$?.fid).filter(Boolean);
          } else {
            const parsed = parseFilterObj(normalized);
            if (parsed) filterQuery = parsed;
          }
        }
      }

      if (!featureType && fids.length > 0) {
        const supported = await provider.getSupportedTypes(req.user);
        for (const t of supported) {
          if (await findUnadvertisedFilterProperty(provider, req.user, t, filterQuery) !== undefined) continue;
          const check = await provider.getFeatures(req.user, t, fids, filterQuery);
          if (check.length > 0) {
            featureType = t;
            break;
          }
        }
        if (!featureType && supported.length > 0) {
          featureType = supported[0];
        }
      }

      if (!featureType) {
        return buildExceptionResponse('MissingParameterValue', 'typeNames', 'error: missing feature type', version, 400);
      }

      const cleanType = featureType.replace(/^[^:]+:/, '');
      const supported = await provider.getSupportedTypes(req.user);
      if (!supported.includes(cleanType)) {
        return buildExceptionResponse('InvalidParameterValue', query.TYPENAMES ? 'typeNames' : 'typeName', `Feature type '${featureType}' is not advertised by this service.`, version, 400);
      }

      let targetSrs = 'EPSG:4326';
      let doReproject = false;
      if (requestedSrs && options.crsTransformer) {
        if (options.crsTransformer.isSupported(requestedSrs)) {
          targetSrs = options.crsTransformer.normalizeSrs(requestedSrs);
          doReproject = true;
        } else {
          return buildExceptionResponse(
            'InvalidParameterValue',
            'srsName',
            `Unsupported SRS requested: ${requestedSrs}`,
            version,
            400
          );
        }
      }

      const isLatFirst = (srs: string): boolean => {
        const norm = srs.toUpperCase();
        return norm === 'EPSG:4326' || norm === 'EPSG:4619' || norm === 'EPSG:4269';
      };

      let responseSrsName = 'urn:ogc:def:crs:EPSG::4326';
      if (doReproject) {
        if (requestedSrs.toLowerCase().includes('urn:') || requestedSrs.toLowerCase().includes('http:')) {
          responseSrsName = requestedSrs;
        } else {
          responseSrsName = `urn:ogc:def:crs:EPSG::${targetSrs.replace('EPSG:', '')}`;
        }
      }

      await assertFilterPropertiesAdvertised(provider, req.user, cleanType, filterQuery);

      const resultType = (query.RESULTTYPE || 'results').toLowerCase();
      let startIndex = 0;
      if (query.STARTINDEX !== undefined) {
        const parsed = parseInt(String(query.STARTINDEX), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          startIndex = parsed;
        }
      }
      let count: number | undefined = undefined;
      const postGetF = req.body ? (req.body['wfs:getfeature'] || req.body.getfeature) : undefined;
      const postCount = postGetF?.$?.count || postGetF?.$?.maxFeatures;
      if (query.COUNT !== undefined) {
        const parsed = parseInt(String(query.COUNT), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          count = parsed;
        }
      } else if (query.MAXFEATURES !== undefined) {
        const parsed = parseInt(String(query.MAXFEATURES), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          count = parsed;
        }
      } else if (postCount !== undefined) {
        const parsed = parseInt(String(postCount), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          count = parsed;
        }
      }

      const maxLimit = options.maxCount ?? 1000;
      const defaultLimit = options.defaultCount ?? maxLimit;
      if (count !== undefined) {
        count = Math.min(count, maxLimit);
      } else {
        count = Math.min(defaultLimit, maxLimit);
      }

      // Ask the provider for one feature past the page so a full page can report numberMatched="unknown";
      // hits needs the full match count, so it is not limited.
      const fetchLimit = resultType === 'hits' ? undefined : startIndex + count + 1;
      const bbox = await provider.getBoundingBox(req.user, cleanType);
      const features = fetchLimit !== undefined
        ? await provider.getFeatures(req.user, cleanType, fids, filterQuery, { limit: fetchLimit })
        : await provider.getFeatures(req.user, cleanType, fids, filterQuery);

      const totalMatched: number | 'unknown' = features.length === fetchLimit ? 'unknown' : features.length;
      let returnedFeatures = features.slice(startIndex);
      if (count !== undefined) {
        returnedFeatures = returnedFeatures.slice(0, count);
      }
      if (resultType === 'hits') {
        returnedFeatures = [];
      }

      let displayBbox = { ...bbox };
      if (doReproject && options.crsTransformer) {
        const minPt = options.crsTransformer.transformCoordinate([bbox.minLon, bbox.minLat], 'EPSG:4326', targetSrs);
        const maxPt = options.crsTransformer.transformCoordinate([bbox.maxLon, bbox.maxLat], 'EPSG:4326', targetSrs);
        displayBbox = {
          minLon: minPt[0],
          minLat: minPt[1],
          maxLon: maxPt[0],
          maxLat: maxPt[1]
        };
      }

      const lowerCorner = isLatFirst(targetSrs)
        ? `${displayBbox.minLat} ${displayBbox.minLon}`
        : `${displayBbox.minLon} ${displayBbox.minLat}`;

      const upperCorner = isLatFirst(targetSrs)
        ? `${displayBbox.maxLat} ${displayBbox.maxLon}`
        : `${displayBbox.maxLon} ${displayBbox.maxLat}`;

      const xmlData: Record<string, any> = {
        'wfs:FeatureCollection': {
          '@xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
          '@xmlns:gml': 'http://www.opengis.net/gml/3.2',
          [`@xmlns:${nsPrefix}`]: nsUri,
          '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          '@xsi:schemaLocation': `${nsUri} ${activeBaseUrl}?service=WFS&version=${version}&request=DescribeFeatureType&typeNames=${nsPrefix}:${cleanType} http://www.opengis.net/wfs/2.0 http://schemas.opengis.net/wfs/2.0/wfs.xsd`,
          '@numberMatched': String(totalMatched),
          '@numberReturned': String(returnedFeatures.length),
          '@timeStamp': getResponseTimestamp(),
          '@version': version,
          'wfs:boundedBy': {
            'gml:Envelope': {
              '@srsName': responseSrsName,
              'gml:lowerCorner': lowerCorner,
              'gml:upperCorner': upperCorner,
            },
          },
          'wfs:member': [],
        },
      };

      returnedFeatures.forEach((feature) => {
        let geom = feature.geometry;
        if (doReproject && options.crsTransformer && geom) {
          geom = options.crsTransformer.transformGeometry(geom, 'EPSG:4326', targetSrs);
        }

        const gmlGeo = geom ? formatGmlGeometry(geom, feature.id, responseSrsName, isLatFirst(targetSrs)) : null;

        const featureProps: Record<string, any> = {};
        if (gmlGeo) {
          featureProps[`${nsPrefix}:geo`] = gmlGeo;
        }

        for (const [k, v] of Object.entries(feature.properties || {})) {
          if (!XML_NCNAME_REGEX.test(k)) continue;
          featureProps[`${nsPrefix}:${k}`] = v !== null && v !== undefined ? String(v) : '';
        }

        xmlData['wfs:FeatureCollection']['wfs:member'].push({
          [`${nsPrefix}:${cleanType}`]: {
            '@gml:id': `${cleanType}_${feature.id.toString()}`,
            ...featureProps
          },
        });
      });

      const xml = buildXml(xmlData);
      return {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: xml,
      };
    }

    return buildExceptionResponse('OperationNotSupported', 'request', 'Unsupported or invalid WFS request', version, 400);
  } catch (err: any) {
    if (err instanceof FilterValidationError || err?.name === 'FilterValidationError') {
      return buildExceptionResponse('InvalidParameterValue', 'filter', err.message, version);
    }
    if (err instanceof WfsClientError || err?.isClientSafe) {
      return buildExceptionResponse(err.code || 400, err.locator || 'WFS', err.message, version);
    }
    if (logger) logger.error(`WFS ${version} error:`, err);
    return buildExceptionResponse('OperationProcessingFailed', 'WFS', INTERNAL_ERROR_MESSAGE, version, 500);
  }
}
