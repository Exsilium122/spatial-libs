import { buildXml } from './xmlHelper.js';
import { GenericRequest, GenericResponse, WfsOptions } from './types.js';
import { buildExceptionResponse, WfsClientError, INTERNAL_ERROR_MESSAGE } from './exception.js';
import { parseFilterString, parseFilterObj, normalizeKeys, FilterValidationError } from './filterParser.js';

const XML_NCNAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.-]*$/;

export async function handleWfs100(
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
        WFS_Capabilities: {
          '@version': '1.0.0',
          '@xmlns': 'http://www.opengis.net/wfs',
          [`@xmlns:${nsPrefix}`]: nsUri,
          '@xmlns:ogc': 'http://www.opengis.net/ogc',
          '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          '@xsi:schemaLocation': `http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.0.0/WFS-capabilities.xsd`,
          Service: {
            Name: 'WFS',
            Title: 'Web Feature Service',
            Abstract: 'Generic Web Feature Service',
            Keywords: 'WFS, GIS, Spatial-API',
            OnlineResource: activeBaseUrl,
            Fees: 'NONE',
            AccessConstraints: 'NONE',
          },
          Capability: {
            Request: {
              GetCapabilities: {
                DCPType: {
                  HTTP: {
                    Get: {
                      '@onlineResource': `${activeBaseUrl}?`,
                    },
                  },
                },
              },
              DescribeFeatureType: {
                SchemaDescriptionLanguage: {
                  XMLSCHEMA: {},
                },
                DCPType: {
                  HTTP: {
                    Get: {
                      '@onlineResource': `${activeBaseUrl}?`,
                    },
                  },
                },
              },
              GetFeature: {
                ResultFormat: {
                  GML2: {},
                },
                DCPType: {
                  HTTP: {
                    Get: {
                      '@onlineResource': `${activeBaseUrl}?`,
                    },
                    Post: {
                      '@onlineResource': activeBaseUrl,
                    },
                  },
                },
              },
            },
          },
          FeatureTypeList: {
            Operations: {
              Operation: 'Query',
            },
            FeatureType: [],
          },
          'ogc:Filter_Capabilities': {
            'ogc:Spatial_Capabilities': {
              'ogc:Spatial_Operators': {
                'ogc:BBOX': {},
              },
            },
            'ogc:Scalar_Capabilities': {
              'ogc:Logical_Operators': {},
              'ogc:Comparison_Operators': {
                'ogc:Simple_Comparisons': {},
              },
            },
          },
        },
      };

      const promises = types.map(async (type) => {
        const bbox = await provider.getBoundingBox(req.user, type);
        return {
          Name: { '#text': `${nsPrefix}:${type}` },
          Title: type,
          Abstract: `Collection of ${type} features`,
          Keywords: `features, ${type}`,
          SRS: 'EPSG:4326',
          LatLongBoundingBox: {
            '@minx': bbox.minLon,
            '@miny': bbox.minLat,
            '@maxx': bbox.maxLon,
            '@maxy': bbox.maxLat,
          },
        };
      });

      xmlData.WFS_Capabilities.FeatureTypeList.FeatureType = await Promise.all(promises);

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
      let typesToDescribe: string[] = [];
      if (typeName) {
        typesToDescribe = typeName.split(',').map((t: string) => t.trim().replace(/^[^:]+:/, ''));
        for (const cleanType of typesToDescribe) {
          if (!supported.includes(cleanType)) {
            return buildExceptionResponse('InvalidParameterValue', query.TYPENAMES ? 'typeNames' : 'typeName', `Feature type '${cleanType}' is not advertised by this service.`, '1.0.0', 400);
          }
        }
      } else {
        typesToDescribe = supported;
      }

      if (typesToDescribe.length > 0) {
        const elementList: any[] = [];
        const complexTypeList: any[] = [];

        for (const cleanType of typesToDescribe) {
          const geomType = (typeof provider.getGeometryType === 'function') 
            ? await provider.getGeometryType(req.user, cleanType) 
            : 'Point';

          const gmlGeomType = geomType === 'LineString' ? 'gml:LineStringPropertyType' : 'gml:PointPropertyType';

          let propertiesSchema: Record<string, string> = {};
          if (typeof provider.getPropertiesSchema === 'function') {
            propertiesSchema = await provider.getPropertiesSchema(req.user, cleanType);
          } else {
            const sampleFeatures = await provider.getFeatures(req.user, cleanType, [], { limit: 1 });
            if (sampleFeatures.length > 0 && sampleFeatures[0].properties) {
              for (const key of Object.keys(sampleFeatures[0].properties)) {
                const val = sampleFeatures[0].properties[key];
                propertiesSchema[key] = typeof val === 'number' ? 'double' : (typeof val === 'boolean' ? 'boolean' : 'string');
              }
            } else {
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
            '@substitutionGroup': 'gml:_Feature',
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
            '@xmlns:gml': 'http://www.opengis.net/gml',
            '@elementFormDefault': 'qualified',
            '@version': '0.1',
            import: {
              '@namespace': 'http://www.opengis.net/gml',
              '@schemaLocation': 'http://schemas.opengis.net/gml/2.1.2/feature.xsd',
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
      } else {
        return buildExceptionResponse(200, 'describeFeatureType', 'error: missing feature type', '1.0.0');
      }
    }

    if (requestType === 'getfeature' || postAction === 'getfeature') {
      let featureType;
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
            const minLon = coords[0];
            const minLat = coords[1];
            const maxLon = coords[2];
            const maxLat = coords[3];

            if (minLon >= maxLon || minLat >= maxLat) {
              return buildExceptionResponse(400, 'bbox', 'Invalid BBOX coordinates: minimum X >= maximum X, or minimum Y >= maximum Y', '1.0.0');
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

        const filters = queryNode['ogc:filter'] || queryNode.filter;
        if (filters) {
          const normalized = normalizeKeys(filters[0]);
          if (normalized.FeatureId) {
            const fidList = Array.isArray(normalized.FeatureId) ? normalized.FeatureId : [normalized.FeatureId];
            fids = fidList.map((node: any) => node.$?.fid).filter(Boolean);
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

      if (featureType) {
        const supported = await provider.getSupportedTypes(req.user);
        const cleanType = featureType.replace(/^[^:]+:/, '');
        if (!supported.includes(cleanType)) {
          return buildExceptionResponse('InvalidParameterValue', query.TYPENAMES ? 'typeNames' : 'typeName', `Feature type '${featureType}' is not advertised by this service.`, '1.0.0', 400);
        }
        const bbox = await provider.getBoundingBox(req.user, cleanType);
        let features = await provider.getFeatures(req.user, cleanType, fids, filterQuery);

        const maxLimit = options.maxCount ?? 1000;
        const defaultLimit = options.defaultCount ?? maxLimit;
        const maxFeaturesParam = query.MAXFEATURES || query.maxFeatures || query.maxfeatures || (req.body ? (req.body['wfs:getfeature'] || req.body.getfeature)?.$?.maxFeatures : undefined);
        if (maxFeaturesParam !== undefined) {
          const maxNum = parseInt(String(maxFeaturesParam), 10);
          if (!isNaN(maxNum) && maxNum >= 0) {
            features = features.slice(0, Math.min(maxNum, maxLimit));
          } else {
            features = features.slice(0, Math.min(defaultLimit, maxLimit));
          }
        } else {
          features = features.slice(0, Math.min(defaultLimit, maxLimit));
        }

        const propNameParam = query.PROPERTYNAME || query.propertyName || query.propertyname;
        const allowedProps = propNameParam
          ? String(propNameParam).split(',').map((p: string) => p.trim().replace(/^[^:]+:/, ''))
          : null;

        const xmlData: Record<string, any> = {
          'wfs:FeatureCollection': {
            '@xmlns': 'http://www.opengis.net/wfs',
            [`@xmlns:${nsPrefix}`]: nsUri,
            '@xmlns:wfs': 'http://www.opengis.net/wfs',
            '@xmlns:gml': 'http://www.opengis.net/gml',
            '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            '@xsi:schemaLocation': 'http://schemas.opengis.net/wfs/1.0.0/WFS-basic.xsd',
            'gml:featureMember': [],
          },
        };

        if (features.length > 0) {
          xmlData['wfs:FeatureCollection']['gml:boundedBy'] = {
            'gml:Box': {
              '@srsName': 'http://www.opengis.net/gml/srs/epsg.xml#4326',
              'gml:coordinates': {
                '#text': `${bbox.minLon},${bbox.minLat} ${bbox.maxLon},${bbox.maxLat}`,
              },
            },
          };
        }

        features.forEach((feature) => {
          const coords = feature?.geometry?.coordinates;
          if (coords) {
            const isLineString = feature.geometry?.type === 'LineString';
            const gmlGeo = isLineString
              ? {
                  'gml:LineString': {
                    '@srsName': 'http://www.opengis.net/gml/srs/epsg.xml#4326',
                    'gml:coordinates': {
                      '#text': coords.map((coor: any) => `${coor[0]},${coor[1]}`).join(' '),
                    },
                  },
                }
              : {
                  'gml:Point': {
                    '@srsName': 'http://www.opengis.net/gml/srs/epsg.xml#4326',
                    'gml:coordinates': {
                      '#text': `${coords[0]},${coords[1]}`,
                    },
                  },
                };

            const featureProps: Record<string, any> = {
              '@fid': feature.id.toString(),
              [`${nsPrefix}:geo`]: gmlGeo
            };

            for (const [k, v] of Object.entries(feature.properties || {})) {
              if (!XML_NCNAME_REGEX.test(k)) continue;
              if (allowedProps && !allowedProps.includes(k)) continue;
              featureProps[`${nsPrefix}:${k}`] = v !== null && v !== undefined ? String(v) : '';
            }

            xmlData['wfs:FeatureCollection']['gml:featureMember'].push({
              [`${nsPrefix}:${cleanType}`]: featureProps,
            });
          }
        });

        const xml = buildXml(xmlData);
        return {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
          body: xml,
        };
      } else {
        return buildExceptionResponse(300, 'getFeature', 'error: missing feature type', '1.0.0');
      }
    }

    // Default fall-through or unsupported WFS request
    return buildExceptionResponse(400, 'WFS', 'Unsupported or invalid WFS request', '1.0.0');
  } catch (err: any) {
    if (err instanceof FilterValidationError || err?.name === 'FilterValidationError') {
      return buildExceptionResponse('InvalidParameterValue', 'filter', err.message, '1.0.0');
    }
    if (err instanceof WfsClientError || err?.isClientSafe) {
      return buildExceptionResponse(err.code || 400, err.locator || 'WFS', err.message, '1.0.0');
    }
    if (logger) logger.error('WFS 1.0.0 error:', err);
    return buildExceptionResponse('OperationProcessingFailed', 'WFS', INTERNAL_ERROR_MESSAGE, '1.0.0', 500);
  }
}
