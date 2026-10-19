import { buildXml } from './xmlHelper.js';
import { GenericRequest, GenericResponse, WfsOptions } from './types.js';
import { buildExceptionResponse, WfsClientError, INTERNAL_ERROR_MESSAGE } from './exception.js';
import { parseFilterString, parseFilterObj, normalizeKeys, FilterValidationError } from './filterParser.js';

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
              'wfs:ReturnFeatureType': `${nsPrefix}:trees`,
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
      let typeName = query.TYPENAME || query.TYPENAMES || '';
      let cleanTypes: string[] = [];
      if (typeName) {
        cleanTypes = String(typeName).split(',').map((t: string) => t.trim().replace(new RegExp(`^(${nsPrefix}|wfs):`), ''));
      } else {
        cleanTypes = await provider.getSupportedTypes(req.user);
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
        let propertiesSchema: Record<string, string> = {};
        if (typeof provider.getPropertiesSchema === 'function') {
          propertiesSchema = await provider.getPropertiesSchema(req.user, cleanType);
        } else {
          // Fallback: fetch a sample feature to infer properties dynamically
          const sampleFeatures = await provider.getFeatures(req.user, cleanType, [], { limit: 1 });
          if (sampleFeatures.length > 0 && sampleFeatures[0].properties) {
            for (const key of Object.keys(sampleFeatures[0].properties)) {
              const val = sampleFeatures[0].properties[key];
              propertiesSchema[key] = typeof val === 'number' ? 'double' : (typeof val === 'boolean' ? 'boolean' : 'string');
            }
          } else {
            // Default fallback
            propertiesSchema = {
              name: 'string',
              note: 'string',
              url: 'string',
            };
          }
        }

        const elements: any[] = [
          {
            '@name': 'geo',
            '@nillable': 'true',
            '@type': gmlGeomType,
          }
        ];

        for (const [propName, propType] of Object.entries(propertiesSchema)) {
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
          const id = query.ID || query.FEATUREID || '';
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
          const coords = geom?.coordinates;
          const isLineString = geom?.type === 'LineString';
          let gmlGeo;
          const responseSrsName = 'urn:ogc:def:crs:EPSG::4326';
          if (isLineString) {
            const posListStr = coords.map((coor: any) => `${coor[1]} ${coor[0]}`).join(' ');
            gmlGeo = {
              'gml:LineString': {
                '@gml:id': `l_${foundFeature.id.toString()}`,
                '@srsName': responseSrsName,
                'gml:posList': posListStr,
              },
            };
          } else {
            const posStr = `${coords[1]} ${coords[0]}`;
            gmlGeo = {
              'gml:Point': {
                '@gml:id': `p_${foundFeature.id.toString()}`,
                '@srsName': responseSrsName,
                'gml:pos': posStr,
              },
            };
          }

          const featureProps: Record<string, any> = {
            [`${nsPrefix}:geo`]: gmlGeo,
          };
          for (const [k, v] of Object.entries(foundFeature.properties || {})) {
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
            let isLatFirst = true;
            if (parts.length >= 5) {
              const bboxCrs = parts[4].trim().toUpperCase();
              if (bboxCrs.includes('CRS84')) {
                isLatFirst = false;
              } else if (bboxCrs.includes('EPSG::3857') || bboxCrs.includes('EPSG:3857') || bboxCrs.includes('EPSG::3006') || bboxCrs.includes('EPSG:3006')) {
                isLatFirst = false;
              } else {
                isLatFirst = true;
              }
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

      const cleanType = featureType.replace(new RegExp(`^(${nsPrefix}|wfs):`), '');
      const supported = await provider.getSupportedTypes(req.user);
      if (!supported.includes(cleanType)) {
        return buildExceptionResponse('InvalidParameterValue', 'typeNames', `Feature type '${featureType}' is not advertised by this service.`, version, 400);
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

      const bbox = await provider.getBoundingBox(req.user, cleanType);
      const features = await provider.getFeatures(req.user, cleanType, fids, filterQuery);

      const resultType = (query.RESULTTYPE || 'results').toLowerCase();
      let startIndex = 0;
      if (query.STARTINDEX !== undefined) {
        const parsed = parseInt(String(query.STARTINDEX), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          startIndex = parsed;
        }
      }
      let count: number | undefined = undefined;
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
      }

      const totalMatched = features.length;
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
        if (doReproject && options.crsTransformer) {
          geom = options.crsTransformer.transformGeometry(geom, 'EPSG:4326', targetSrs);
        }

        const coords = geom?.coordinates;
        if (coords) {
          const isLineString = geom?.type === 'LineString';
          let gmlGeo;

          if (isLineString) {
            const posListStr = coords.map((coor: any) => {
              return isLatFirst(targetSrs)
                ? `${coor[1]} ${coor[0]}`
                : `${coor[0]} ${coor[1]}`;
            }).join(' ');

            gmlGeo = {
              'gml:LineString': {
                '@gml:id': `l_${feature.id.toString()}`,
                '@srsName': responseSrsName,
                'gml:posList': posListStr,
              },
            };
          } else {
            const posStr = isLatFirst(targetSrs)
              ? `${coords[1]} ${coords[0]}`
              : `${coords[0]} ${coords[1]}`;

            gmlGeo = {
              'gml:Point': {
                '@gml:id': `p_${feature.id.toString()}`,
                '@srsName': responseSrsName,
                'gml:pos': posStr,
              },
            };
          }

          const featureProps: Record<string, any> = {
            [`${nsPrefix}:geo`]: gmlGeo
          };

          for (const [k, v] of Object.entries(feature.properties || {})) {
            featureProps[`${nsPrefix}:${k}`] = v !== null && v !== undefined ? String(v) : '';
          }

          xmlData['wfs:FeatureCollection']['wfs:member'].push({
            [`${nsPrefix}:${cleanType}`]: {
              '@gml:id': `${cleanType}_${feature.id.toString()}`,
              ...featureProps
            },
          });
        }
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
    return buildExceptionResponse('OperationProcessingFailed', 'WFS', INTERNAL_ERROR_MESSAGE, version, 400);
  }
}
