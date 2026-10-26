import { SpatialDataProvider, WfsOptions } from './types.js';
import { FilterValidationError } from './filterParser.js';

/** Geometry paths a filter may reference besides the advertised properties (BBOX maps `geo` to `geo.coordinates`). */
const GEOMETRY_PROPERTIES = new Set(['geo', 'geo.coordinates']);

const LOGICAL_OPERATORS = new Set(['$and', '$or', '$nor']);

/**
 * Resolves the property schema advertised for a feature type — the same schema
 * DescribeFeatureType publishes: the provider's own schema, else one inferred from a sample feature.
 */
export async function resolvePropertiesSchema(
  provider: SpatialDataProvider,
  user: any,
  featureType: string
): Promise<Record<string, string>> {
  if (typeof provider.getPropertiesSchema === 'function') {
    return provider.getPropertiesSchema(user, featureType);
  }
  const propertiesSchema: Record<string, string> = {};
  const sampleFeatures = await provider.getFeatures(user, featureType, [], { limit: 1 });
  if (sampleFeatures.length > 0 && sampleFeatures[0].properties) {
    for (const key of Object.keys(sampleFeatures[0].properties)) {
      const val = sampleFeatures[0].properties[key];
      propertiesSchema[key] = typeof val === 'number' ? 'double' : (typeof val === 'boolean' ? 'boolean' : 'string');
    }
    return propertiesSchema;
  }
  return { name: 'string', note: 'string', url: 'string' };
}

/**
 * Collects every property path a translated filter query selects on, descending into $and/$or/$nor.
 */
function collectFilterProperties(filterQuery: any, out: Set<string> = new Set()): Set<string> {
  if (!filterQuery || typeof filterQuery !== 'object') return out;
  for (const key of Object.keys(filterQuery)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const children = filterQuery[key];
      if (Array.isArray(children)) {
        for (const child of children) collectFilterProperties(child, out);
      }
    } else if (!key.startsWith('$')) {
      out.add(key);
    }
  }
  return out;
}

/**
 * Returns the first property the filter selects on that the feature type does not advertise, if any.
 */
export async function findUnadvertisedFilterProperty(
  provider: SpatialDataProvider,
  user: any,
  featureType: string,
  filterQuery: any
): Promise<string | undefined> {
  const properties = collectFilterProperties(filterQuery);
  if (properties.size === 0) return undefined;
  const schema = await resolvePropertiesSchema(provider, user, featureType);
  for (const property of properties) {
    const localName = property.replace(/^[^:]+:/, '');
    // Nested value references (a.b) may only descend into an advertised property.
    const rootName = localName.split('.')[0];
    if (
      GEOMETRY_PROPERTIES.has(localName) ||
      Object.prototype.hasOwnProperty.call(schema, localName) ||
      Object.prototype.hasOwnProperty.call(schema, rootName)
    ) continue;
    return localName;
  }
  return undefined;
}

/**
 * Rejects filters that select on properties the feature type does not advertise, so a client cannot
 * query internal or scoping fields the service never published.
 */
export async function assertFilterPropertiesAdvertised(
  provider: SpatialDataProvider,
  user: any,
  featureType: string,
  filterQuery: any
): Promise<void> {
  const unadvertised = await findUnadvertisedFilterProperty(provider, user, featureType, filterQuery);
  if (unadvertised !== undefined) {
    throw new FilterValidationError(`PropertyName "${unadvertised}" is not advertised for feature type "${featureType}"`);
  }
}

/**
 * Resolves the effective MAXFEATURES/COUNT cap: the requested value clamped to `maxCount`,
 * or `defaultCount` when absent or invalid (both default to 1000).
 */
export function resolveFeatureCap(rawParam: unknown, options: WfsOptions): number {
  const maxLimit = options.maxCount ?? 1000;
  const defaultLimit = options.defaultCount ?? maxLimit;
  if (rawParam !== undefined && rawParam !== null) {
    const parsed = parseInt(String(rawParam), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return Math.min(parsed, maxLimit);
    }
  }
  return Math.min(defaultLimit, maxLimit);
}
