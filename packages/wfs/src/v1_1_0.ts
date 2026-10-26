import { buildXml } from './xmlHelper.js';
import { GenericRequest, GenericResponse, WfsOptions } from './types.js';
import { buildExceptionResponse, WfsClientError, INTERNAL_ERROR_MESSAGE } from './exception.js';
import { parseFilterString, parseFilterObj, normalizeKeys, FilterValidationError } from './filterParser.js';
import { resolvePropertiesSchema, findUnadvertisedFilterProperty, assertFilterPropertiesAdvertised, resolveFeatureCap } from './queryGuard.js';

const XML_NCNAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.-]*$/;

export async function handleWfs110(
  req: GenericRequest,
  options: WfsOptions
): Promise<GenericResponse> {
  const { provider, logger, baseUrl } = options;
  const activeBaseUrl = (baseUrl.startsWith('http') || !req.baseUrl) ? baseUrl : req.baseUrl;
  const nsPrefix = 'wfs';
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
          '@version': '1.1.0',
          '@xmlns': 'http://www.opengis.net/wfs',
          '@xmlns:wfs': nsUri,
          '@xmlns:ows': 'http://www.opengis.net/ows',
          '@xmlns:ogc': 'http://www.opengis.net/ogc',
          '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          '@xmlns:xlink': 'http://www.w3.org/1999/xlink',
          '@xsi:schemaLocation': 'http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.1.0/wfs.xsd',


          'ows:ServiceIdentification': {
            'ows:Title': 'Web Feature Service',
            'ows:Abstract': 'Generic Web Feature Service',
            'ows:Keywords': {
              'ows:Keyword': ['WFS', 'GIS', 'Spatial-API'],
            },
            'ows:ServiceType': 'WFS',
            'ows:ServiceTypeVersion': '1.1.0',
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
                  'ows:Value': ['1.1.0', '1.0.0'],
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
                  'ows:Value': ['text/xml; subtype=gml/3.1.1'],
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
                    'ows:Value': ['text/xml; subtype=gml/3.1.1'],
                  },
                ],
              },
            ],
          },

          FeatureTypeList: {
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
        const otherSrsList = options.crsTransformer
          ? options.crsTransformer.getSupportedCodes().filter(c => c !== 'EPSG:4326')
          : [];
        return {
          Name: `${nsPrefix}:${type}`,
          Title: type,
          Abstract: `Collection of ${type} features`,
          DefaultSRS: 'EPSG:4326',
          ...(otherSrsList.length > 0 ? { OtherSRS: otherSrsList } : {}),
          'ows:WGS84BoundingBox': {
            'ows:LowerCorner': `${bbox.minLon} ${bbox.minLat}`,
            'ows:UpperCorner': `${bbox.maxLon} ${bbox.maxLat}`,
          },
        };
      });

      xmlData.WFS_Capabilities.FeatureTypeList.FeatureType = await Promise.all(promises);

      if (options.xmlOptions?.namespaces) {
        for (const [k, v] of Object.entries(options.xmlOptions.namespaces)) {
          if (k !== 'wfs') {
            xmlData.WFS_Capabilities[`@xmlns:${k}`] = v;
          }
        }
      }

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
            return buildExceptionResponse('InvalidParameterValue', query.TYPENAMES ? 'typeNames' : 'typeName', `Feature type '${cleanType}' is not advertised by this service.`, '1.1.0', 400);
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
              '@schemaLocation': 'http://schemas.opengis.net/gml/3.1.1/base/gml.xsd',
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
        return buildExceptionResponse(200, 'describeFeatureType', 'error: missing feature type', '1.1.0');
      }
    }

    if (requestType === 'getfeature' || postAction === 'getfeature') {
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

        // BBOX parsing
        if (query.BBOX) {
          const parts = String(query.BBOX).split(',');
          const coords = parts.slice(0, 4).map(Number);
          const bboxCrs = parts[4] ? parts[4].trim() : '';
          if (coords.length === 4 && coords.every(n => !isNaN(n))) {
            const isUrnLatLon = /^(?:urn:(?:x-)?ogc:def:crs:EPSG:(?:[\d.]*:)?4326|https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/[\d.]+\/4326)$/i.test(bboxCrs);
            let minLon: number, minLat: number, maxLon: number, maxLat: number;
            if (isUrnLatLon) {
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
              return buildExceptionResponse('InvalidParameterValue', 'bbox', 'Invalid BBOX coordinates: minimum >= maximum', '1.1.0', 400);
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
        requestedSrs = queryNode.$ && queryNode.$.srsName;

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
        return buildExceptionResponse('MissingParameterValue', 'typeName', 'error: missing feature type', '1.1.0');
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
            '1.1.0'
          );
        }
      }

      const isLatFirst = (srs: string): boolean => {
        const norm = srs.toUpperCase();
        return norm === 'EPSG:4326' || norm === 'EPSG:4619' || norm === 'EPSG:4269';
      };

      if (featureType) {
        const supported = await provider.getSupportedTypes(req.user);
        const cleanType = featureType.replace(/^.*:/, '');
        if (!supported.includes(cleanType)) {
          return buildExceptionResponse('InvalidParameterValue', query.TYPENAMES ? 'typeNames' : 'typeName', `Feature type '${featureType}' is not advertised by this service.`, '1.1.0', 400);
        }
        await assertFilterPropertiesAdvertised(provider, req.user, cleanType, filterQuery);

        // MaxFeatures support & defaultCount / maxCount capping
        const maxFeaturesParam = query.MAXFEATURES || query.maxFeatures || query.maxfeatures || (req.body ? (req.body['wfs:getfeature'] || req.body.getfeature)?.$?.maxFeatures : undefined);
        const featureCap = resolveFeatureCap(maxFeaturesParam, options);
        const resultType = (query.RESULTTYPE || query.resultType || 'results').toLowerCase();
        const sortByParam = query.SORTBY || query.sortBy || query.sortby;

        const bbox = await provider.getBoundingBox(req.user, cleanType);
        // Sorting happens here, after the fetch, and hits needs the full count: only an unsorted results
        // request can let the provider stop at the cap.
        let features = resultType !== 'hits' && !sortByParam
          ? await provider.getFeatures(req.user, cleanType, fids, filterQuery, { limit: featureCap })
          : await provider.getFeatures(req.user, cleanType, fids, filterQuery);

        const totalMatched = features.length;

        // SortBy support
        if (sortByParam) {
          const parts = String(sortByParam).trim().split(/\s+/);
          const sortProp = parts[0].replace(/^[^:]+:/, '');
          const isDesc = parts[1] && parts[1].toUpperCase().startsWith('D');
          features.sort((a, b) => {
            const va = a.properties?.[sortProp];
            const vb = b.properties?.[sortProp];
            if (va === vb) return 0;
            if (va === undefined || va === null) return 1;
            if (vb === undefined || vb === null) return -1;
            const cmp = va < vb ? -1 : 1;
            return isDesc ? -cmp : cmp;
          });
        }

        features = features.slice(0, featureCap);

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
            '@xmlns:wfs': 'http://www.opengis.net/wfs',
            '@xmlns:gml': 'http://www.opengis.net/gml',
            '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            '@xsi:schemaLocation': 'http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.1.0/wfs.xsd',
            'gml:boundedBy': {
              'gml:Envelope': {
                '@srsName': targetSrs,
                'gml:lowerCorner': lowerCorner,
                'gml:upperCorner': upperCorner,
              },
            },
            'gml:featureMember': [],
          },
        };

        if (resultType === 'hits') {
          xmlData['wfs:FeatureCollection']['@numberOfFeatures'] = String(totalMatched);
          xmlData['wfs:FeatureCollection']['@timeStamp'] = new Date().toISOString();
        }

        if (options.xmlOptions?.namespaces) {
          for (const [k, v] of Object.entries(options.xmlOptions.namespaces)) {
            if (k !== 'wfs') {
              xmlData['wfs:FeatureCollection'][`@xmlns:${k}`] = v;
            }
          }
        }

        if (resultType !== 'hits') {
          features.forEach((feature) => {
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
                    '@srsName': targetSrs,
                    'gml:posList': posListStr,
                  },
                };
              } else {
                const posStr = isLatFirst(targetSrs)
                  ? `${coords[1]} ${coords[0]}`
                  : `${coords[0]} ${coords[1]}`;

                gmlGeo = {
                  'gml:Point': {
                    '@srsName': targetSrs,
                    'gml:pos': posStr,
                  },
                };
              }

              const featureProps: Record<string, any> = {
                '@xmlns:wfs': nsUri,
                '@fid': feature.id.toString(),
                [`${nsPrefix}:geo`]: gmlGeo
              };

              for (const [k, v] of Object.entries(feature.properties || {})) {
                if (!XML_NCNAME_REGEX.test(k)) continue;
                featureProps[`${nsPrefix}:${k}`] = v !== null && v !== undefined ? String(v) : '';
              }

              xmlData['wfs:FeatureCollection']['gml:featureMember'].push({
                [`${nsPrefix}:${cleanType}`]: featureProps,
              });
            }
          });
        }

        const xml = buildXml(xmlData);
        return {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
          body: xml,
        };
      } else {
        return buildExceptionResponse(300, 'getFeature', 'error: missing feature type', '1.1.0');
      }
    }

    return buildExceptionResponse('OperationNotSupported', 'request', 'Unsupported or invalid WFS request', '1.1.0');
  } catch (err: any) {
    if (err instanceof FilterValidationError || err?.name === 'FilterValidationError') {
      return buildExceptionResponse('InvalidParameterValue', 'filter', err.message, '1.1.0');
    }
    if (err instanceof WfsClientError || err?.isClientSafe) {
      return buildExceptionResponse(err.code || 400, err.locator || 'WFS', err.message, '1.1.0');
    }
    if (logger) logger.error('WFS 1.1.0 error:', err);
    return buildExceptionResponse('OperationProcessingFailed', 'WFS', INTERNAL_ERROR_MESSAGE, '1.1.0', 500);
  }
}
