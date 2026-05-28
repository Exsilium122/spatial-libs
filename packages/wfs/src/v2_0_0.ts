import { create } from 'xmlbuilder2';
import { GenericRequest, GenericResponse, WfsOptions } from './types.js';
import { buildExceptionResponse } from './exception.js';
import { parseFilterString, parseFilterObj, normalizeKeys } from './filterParser.js';

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
  for (const k of Object.keys(req.query)) {
    query[k.toUpperCase()] = req.query[k];
  }

  // Determine version (2.0.0 vs 2.0.2)
  let version = '2.0.2';
  const queryVer = query.VERSION;
  if (queryVer === '2.0.0') {
    version = '2.0.0';
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
        return {
          Name: `${nsPrefix}:${type}`,
          Title: type,
          Abstract: `Collection of ${type} features`,
          DefaultSRS: 'urn:ogc:def:crs:EPSG::4326',
          'ows:WGS84BoundingBox': {
            'ows:LowerCorner': `${bbox.minLon} ${bbox.minLat}`,
            'ows:UpperCorner': `${bbox.maxLon} ${bbox.maxLat}`,
          },
        };
      });

      xmlData['wfs:WFS_Capabilities']['wfs:FeatureTypeList']['wfs:FeatureType'] = await Promise.all(promises);

      const xml = create(xmlData).end({ prettyPrint: true });
      return {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: xml,
      };
    }

    if (requestType === 'describefeaturetype') {
      let typeName = query.TYPENAME || query.TYPENAMES || '';
      if (typeName) {
        const cleanType = typeName.replace(new RegExp(`^(${nsPrefix}|wfs):`), '');
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
            element: {
              '@name': cleanType,
              '@type': `${nsPrefix}:${cleanType}_Type`,
              '@substitutionGroup': 'gml:AbstractFeature',
            },
            complexType: {
              '@name': `${cleanType}_Type`,
              complexContent: {
                extension: {
                  '@base': 'gml:AbstractFeatureType',
                  sequence: {
                    element: elements,
                  },
                },
              },
            },
          },
        };

        const xml = create(xmlData).end({ prettyPrint: true });
        return {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
          body: xml,
        };
      } else {
        return buildExceptionResponse(200, 'describeFeatureType', 'error: missing feature type', '2.0.0');
      }
    }

    if (requestType === 'getfeature' || postAction === 'getfeature') {
      let featureType = '';
      let fids: string[] = [];
      let filterQuery: Record<string, any> = {};

      if (req.method === 'GET') {
        featureType = query.TYPENAME || query.TYPENAMES || '';
        if (query.FEATUREID) {
          fids = String(query.FEATUREID).split(',');
        }

        // BBOX parsing
        if (query.BBOX) {
          const parts = String(query.BBOX).split(',');
          const coords = parts.slice(0, 4).map(Number);
          if (coords.length === 4 && coords.every(n => !isNaN(n))) {
            let minLon, minLat, maxLon, maxLat;
            let isLatFirst = false;
            if (Math.abs(coords[1]) > 90 || Math.abs(coords[3]) > 90) {
              isLatFirst = true;
            } else if (Math.abs(coords[0]) > 90 || Math.abs(coords[2]) > 90) {
              isLatFirst = false;
            } else {
              isLatFirst = Math.abs(coords[0]) > Math.abs(coords[1]);
            }

            if (isLatFirst) {
              minLat = Math.min(coords[0], coords[2]);
              minLon = Math.min(coords[1], coords[3]);
              maxLat = Math.max(coords[0], coords[2]);
              maxLon = Math.max(coords[1], coords[3]);
            } else {
              minLon = Math.min(coords[0], coords[2]);
              minLat = Math.min(coords[1], coords[3]);
              maxLon = Math.max(coords[0], coords[2]);
              maxLat = Math.max(coords[1], coords[3]);
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
        featureType = queryNode.$ && queryNode.$.typeName;

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

      if (featureType) {
        const cleanType = featureType.replace(new RegExp(`^(${nsPrefix}|wfs):`), '');
        const bbox = await provider.getBoundingBox(req.user, cleanType);
        const features = await provider.getFeatures(req.user, cleanType, fids, filterQuery);

        const xmlData: Record<string, any> = {
          'wfs:FeatureCollection': {
            '@xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
            '@xmlns:gml': 'http://www.opengis.net/gml/3.2',
            [`@xmlns:${nsPrefix}`]: nsUri,
            '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            '@xsi:schemaLocation': 'http://www.opengis.net/wfs/2.0 http://schemas.opengis.net/wfs/2.0/wfs.xsd',
            '@numberMatched': features.length,
            '@numberReturned': features.length,
            '@version': version,
            'wfs:boundedBy': {
              'gml:Envelope': {
                '@srsName': 'urn:ogc:def:crs:EPSG::4326',
                'gml:lowerCorner': `${bbox.minLat} ${bbox.minLon}`,
                'gml:upperCorner': `${bbox.maxLat} ${bbox.maxLon}`,
              },
            },
            'wfs:member': [],
          },
        };

        features.forEach((feature) => {
          const coords = feature?.geometry?.coordinates;
          if (coords) {
            const isLineString = feature.geometry?.type === 'LineString';
            const gmlGeo = isLineString
              ? {
                  'gml:LineString': {
                    '@gml:id': `l_${feature.id.toString()}`,
                    '@srsName': 'urn:ogc:def:crs:EPSG::4326',
                    'gml:posList': coords.map((coor: any) => `${coor[1]} ${coor[0]}`).join(' '),
                  },
                }
              : {
                  'gml:Point': {
                    '@gml:id': `p_${feature.id.toString()}`,
                    '@srsName': 'urn:ogc:def:crs:EPSG::4326',
                    'gml:pos': `${coords[1]} ${coords[0]}`,
                  },
                };

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

        const xml = create(xmlData).end({ prettyPrint: true });
        return {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
          body: xml,
        };
      } else {
        return buildExceptionResponse(300, 'getFeature', 'error: missing feature type', version);
      }
    }

    return buildExceptionResponse(400, 'WFS', 'Unsupported or invalid WFS request', version);
  } catch (err: any) {
    if (logger) logger.error(`WFS ${version} error:`, err);
    return buildExceptionResponse(301, 'WFS', `Internal WFS Processing Error: ${err.message}`, version);
  }
}
