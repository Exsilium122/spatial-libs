/**
 * Provider contract validation for @spatial-api/core
 */

import { ProviderContractError } from './errors.js';
import type { FilterOperator, ProviderRequirements, SpatialProvider } from './types.js';

export const VALID_FILTER_OPERATORS: ReadonlySet<FilterOperator> = new Set<FilterOperator>([
  // Logical
  'and',
  'or',
  'not',
  // Comparison
  '=',
  '<>',
  '<',
  '<=',
  '>',
  '>=',
  'like',
  'between',
  'in',
  'isNull',
  // Spatial
  's_intersects',
  's_equals',
  's_disjoint',
  's_touches',
  's_within',
  's_overlaps',
  's_crosses',
  's_contains',
  // Temporal
  't_after',
  't_before',
  't_contains',
  't_disjoint',
  't_during',
  't_equals',
  't_finishedBy',
  't_finishes',
  't_intersects',
  't_meets',
  't_metBy',
  't_overlappedBy',
  't_overlaps',
  't_startedBy',
  't_starts',
  // Functions
  'casei',
  'accenti',
  // Extensions
  'x_dwithin',
  'x_beyond',
]);

const VALID_ID_GENERATIONS = new Set(['generate', 'useExisting', 'replaceDuplicate']);

/**
 * Synchronously validates that a provider conforms to the SpatialProvider contract
 * and satisfies any service-specific requirements.
 *
 * Collects all violations and throws a single ProviderContractError if any exist.
 */
export function validateProvider(
  provider: unknown,
  requirements?: ProviderRequirements
): asserts provider is SpatialProvider {
  const violations: string[] = [];

  if (typeof provider !== 'object' || provider === null) {
    throw new ProviderContractError(['Provider must be a non-null object']);
  }

  const p = provider as Partial<SpatialProvider> & Record<string, unknown>;

  // Required methods
  if (typeof p.describeCollections !== 'function') {
    violations.push('Provider must implement describeCollections()');
  }

  if (typeof p.getFeatures !== 'function') {
    violations.push('Provider must implement getFeatures()');
  }

  // Capabilities
  if (typeof p.capabilities !== 'object' || p.capabilities === null) {
    violations.push('Provider must declare capabilities object');
  } else {
    const caps = p.capabilities;

    // paging
    if (typeof caps.paging !== 'boolean') {
      violations.push('capabilities.paging must be a boolean');
    }

    // count
    if (caps.count !== 'exact' && caps.count !== 'none') {
      violations.push("capabilities.count must be 'exact' or 'none'");
    }

    // sorting
    if (typeof caps.sorting !== 'boolean') {
      violations.push('capabilities.sorting must be a boolean');
    }

    // propertySelection
    if (typeof caps.propertySelection !== 'boolean') {
      violations.push('capabilities.propertySelection must be a boolean');
    }

    // crs
    if (typeof caps.crs !== 'object' || caps.crs === null || !Array.isArray(caps.crs.native)) {
      violations.push('capabilities.crs.native must be an array of CRS URIs');
    } else {
      for (const item of caps.crs.native) {
        if (typeof item !== 'string') {
          violations.push('capabilities.crs.native elements must be strings');
          break;
        }
      }
    }

    // filter operators
    if (typeof caps.filter !== 'object' || caps.filter === null || !Array.isArray(caps.filter.operators)) {
      violations.push('capabilities.filter.operators must be an array of FilterOperator');
    } else {
      for (const op of caps.filter.operators) {
        if (!VALID_FILTER_OPERATORS.has(op as FilterOperator)) {
          violations.push(`capabilities.filter.operators contains unknown operator '${String(op)}'`);
        }
      }
    }

    // write declarations
    if (caps.write != null) {
      if (typeof caps.write !== 'object' || caps.write === null) {
        violations.push('capabilities.write must be an object');
      } else {
        if (typeof caps.write.atomic !== 'boolean') {
          violations.push('capabilities.write.atomic must be a boolean');
        }

        if (!Array.isArray(caps.write.idGeneration)) {
          violations.push('capabilities.write.idGeneration must be an array');
        } else {
          for (const idGen of caps.write.idGeneration) {
            if (!VALID_ID_GENERATIONS.has(idGen)) {
              violations.push(
                `capabilities.write.idGeneration contains invalid value '${String(idGen)}'`
              );
            }
          }
        }
      }

      // Contract rule 7: write declaration requires transaction()
      if (typeof p.transaction !== 'function') {
        violations.push('capabilities.write is declared but provider does not implement transaction()');
      }
    }
  }

  // Optional methods validation (if provided, must be functions)
  if (p.countFeatures != null && typeof p.countFeatures !== 'function') {
    violations.push('provider.countFeatures must be a function if provided');
  }

  if (p.streamFeatures != null && typeof p.streamFeatures !== 'function') {
    violations.push('provider.streamFeatures must be a function if provided');
  }

  if (p.transaction != null && typeof p.transaction !== 'function') {
    violations.push('provider.transaction must be a function if provided');
  }

  // Check additional service requirements
  if (requirements) {
    if (requirements.write) {
      if (!p.capabilities?.write || typeof p.transaction !== 'function') {
        violations.push('Provider does not satisfy required write capability');
      }
    }

    if (requirements.streamFeatures) {
      if (typeof p.streamFeatures !== 'function') {
        violations.push('Provider does not satisfy required streamFeatures method');
      }
    }

    if (requirements.countFeatures) {
      if (typeof p.countFeatures !== 'function') {
        violations.push('Provider does not satisfy required countFeatures method');
      }
    }

    if (requirements.operators && p.capabilities?.filter?.operators) {
      const declaredOps = new Set(p.capabilities.filter.operators);
      for (const op of requirements.operators) {
        if (!declaredOps.has(op)) {
          violations.push(`Provider does not satisfy required filter operator '${op}'`);
        }
      }
    }

    if (requirements.crs && p.capabilities?.crs?.native) {
      const declaredCrs = new Set(p.capabilities.crs.native);
      for (const c of requirements.crs) {
        if (!declaredCrs.has(c)) {
          violations.push(`Provider does not satisfy required native CRS '${c}'`);
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new ProviderContractError(violations);
  }
}
