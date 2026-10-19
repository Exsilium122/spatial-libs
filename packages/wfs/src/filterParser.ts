import { parseXml } from './xmlHelper.js';

export class FilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterValidationError';
  }
}

/**
 * Validates a property name against NoSQL operator injection and prototype pollution.
 */
function validatePropertyName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new FilterValidationError(`Invalid PropertyName: expected string, received ${typeof name}`);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    throw new FilterValidationError(`Invalid PropertyName "${name}": must match /^[a-zA-Z0-9_.-]+$/`);
  }
  if (name.startsWith('$')) {
    throw new FilterValidationError(`Invalid PropertyName "${name}": cannot start with "$"`);
  }
  const segments = name.split('.');
  for (const seg of segments) {
    if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') {
      throw new FilterValidationError(`Invalid PropertyName "${name}": contains forbidden property segment "${seg}"`);
    }
  }
  return name;
}

/**
 * Validates a literal value. Accepts only primitive string, number, or boolean.
 * Missing literals (undefined) return undefined to preserve existing behavior.
 */
function validateLiteral(lit: unknown): string | number | boolean | undefined {
  if (lit === undefined) {
    return undefined;
  }
  if (typeof lit === 'string' || typeof lit === 'number' || typeof lit === 'boolean') {
    return lit;
  }
  throw new FilterValidationError(`Invalid Literal: expected string, number, or boolean primitive, received ${typeof lit}`);
}

/**
 * Converts a PropertyIsLike pattern (wildcards * or %) into an anchored, case-insensitive RegExp
 * that matches in linear time. A naive `.*` per wildcard backtracks polynomially (O(n^k) for k
 * wildcards). Instead, every middle segment is matched at its earliest occurrence inside an
 * atomic group emulated with a capturing lookahead + backreference, which is equivalent for
 * glob semantics and cannot backtrack.
 */
function likePatternToRegExp(pattern: string): RegExp {
  const segments = pattern
    .replace(/[*%]+/g, '*')
    .split('*')
    .map((s) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
  if (segments.length === 1) {
    return new RegExp('^' + segments[0] + '$', 'i');
  }
  let source = '^' + segments[0];
  for (let i = 1; i < segments.length - 1; i++) {
    source += '(?=(.*?' + segments[i] + '))\\' + i;
  }
  source += '.*' + segments[segments.length - 1] + '$';
  return new RegExp(source, 'i');
}

/**
 * Unwraps arrays recursively to support both explicitArray: true and simple object outputs.
 */
export function unwrap(val: any): any {
  if (Array.isArray(val)) {
    return unwrap(val[0]);
  }
  return val;
}

/**
 * Strips namespace prefixes recursively from keys in a parsed XML object.
 */
export function normalizeKeys(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  const res: Record<string, any> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@') || key === '$') continue;
    const cleanKey = key.includes(':') ? key.split(':')[1] : key;
    if (cleanKey === '__proto__' || cleanKey === 'constructor' || cleanKey === 'prototype') {
      continue;
    }
    res[cleanKey] = normalizeKeys(obj[key]);
  }
  return res;
}

/**
 * Parses an OGC Filter XML string into a normalized JavaScript object structure.
 */
export async function parseFilterString(xmlString: string): Promise<any> {
  try {
    const obj = parseXml(xmlString);
    const normalized = normalizeKeys(obj);
    return normalized?.Filter || null;
  } catch (err) {
    return null;
  }
}

/**
 * Extracts logical operator children (And/Or/Not) recursively.
 */
function getLogicalChildren(node: any): any[] {
  const children: any[] = [];
  if (!node || typeof node !== 'object') return children;
  
  if (Array.isArray(node)) {
    return node.map(parseFilterObj).filter(q => Object.keys(q).length > 0);
  }

  for (const key of Object.keys(node)) {
    if (key === '$') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      val.forEach(item => {
        const sub = parseFilterObj({ [key]: item });
        if (Object.keys(sub).length > 0) children.push(sub);
      });
    } else if (typeof val === 'object' && val !== null) {
      const sub = parseFilterObj({ [key]: val });
      if (Object.keys(sub).length > 0) children.push(sub);
    }
  }
  return children;
}

/**
 * Recursively parses a normalized OGC filter node into a MongoDB query selector.
 */
export function parseFilterObj(filterNode: any): any {
  if (!filterNode) return {};

  const query: Record<string, any> = {};

  // 1. Spatial BBOX Filter
  if (filterNode.BBOX) {
    const bboxNode = unwrap(filterNode.BBOX);
    const rawProp = bboxNode?.PropertyName !== undefined && bboxNode?.PropertyName !== null
      ? unwrap(bboxNode.PropertyName)
      : undefined;
    const propName = rawProp !== undefined ? validatePropertyName(rawProp) : 'geo';
    const dbPropName = propName === 'geo' ? 'geo.coordinates' : propName;
    const boxNode = unwrap(bboxNode?.Box);
    if (boxNode && boxNode.coordinates) {
      const coordStr = unwrap(boxNode.coordinates).trim();
      const coords = coordStr.split(/\s+/).map((p: string) => p.split(',').map(Number));
      if (coords.length === 2 && coords.every((p: any) => p.length === 2 && p.every((n: number) => !isNaN(n)))) {
        query[dbPropName] = {
          $geoWithin: {
            $geometry: {
              type: 'Polygon',
              coordinates: [[
                [coords[0][0], coords[0][1]], // minLon, minLat
                [coords[1][0], coords[0][1]], // maxLon, minLat
                [coords[1][0], coords[1][1]], // maxLon, maxLat
                [coords[0][0], coords[1][1]], // minLon, maxLat
                [coords[0][0], coords[0][1]]  // Close the loop
              ]]
            }
          },
        };
      }
    }
  }

  // 2. Simple Comparisons
  if (filterNode.PropertyIsEqualTo) {
    const node = unwrap(filterNode.PropertyIsEqualTo);
    const prop = validatePropertyName(unwrap(node?.PropertyName));
    const lit = validateLiteral(unwrap(node?.Literal));
    query[prop] = lit;
  }
  if (filterNode.PropertyIsNotEqualTo) {
    const node = unwrap(filterNode.PropertyIsNotEqualTo);
    const prop = validatePropertyName(unwrap(node?.PropertyName));
    const lit = validateLiteral(unwrap(node?.Literal));
    query[prop] = { $ne: lit };
  }
  if (filterNode.PropertyIsLessThan) {
    const node = unwrap(filterNode.PropertyIsLessThan);
    const prop = validatePropertyName(unwrap(node?.PropertyName));
    const lit = validateLiteral(unwrap(node?.Literal));
    query[prop] = { $lt: lit };
  }
  if (filterNode.PropertyIsGreaterThan) {
    const node = unwrap(filterNode.PropertyIsGreaterThan);
    const prop = validatePropertyName(unwrap(node?.PropertyName));
    const lit = validateLiteral(unwrap(node?.Literal));
    query[prop] = { $gt: lit };
  }
  if (filterNode.PropertyIsLessThanOrEqualTo) {
    const node = unwrap(filterNode.PropertyIsLessThanOrEqualTo);
    const prop = validatePropertyName(unwrap(node?.PropertyName));
    const lit = validateLiteral(unwrap(node?.Literal));
    query[prop] = { $lte: lit };
  }
  if (filterNode.PropertyIsGreaterThanOrEqualTo) {
    const node = unwrap(filterNode.PropertyIsGreaterThanOrEqualTo);
    const prop = validatePropertyName(unwrap(node?.PropertyName));
    const lit = validateLiteral(unwrap(node?.Literal));
    query[prop] = { $gte: lit };
  }
  if (filterNode.PropertyIsLike) {
    const node = unwrap(filterNode.PropertyIsLike);
    const prop = validatePropertyName(unwrap(node?.PropertyName));
    const rawLit = unwrap(node?.Literal);
    const lit = validateLiteral(rawLit);
    if (lit !== undefined) {
      const litStr = String(lit);
      if (litStr.length > 256) {
        throw new FilterValidationError('PropertyIsLike literal exceeds maximum length of 256 characters');
      }
      query[prop] = { $regex: likePatternToRegExp(litStr) };
    }
  }

  // 3. Logical Operators
  if (filterNode.And) {
    const children = getLogicalChildren(unwrap(filterNode.And));
    if (children.length > 0) {
      query.$and = children;
    }
  }
  if (filterNode.Or) {
    const children = getLogicalChildren(unwrap(filterNode.Or));
    if (children.length > 0) {
      query.$or = children;
    }
  }
  if (filterNode.Not) {
    const children = getLogicalChildren(unwrap(filterNode.Not));
    if (children.length > 0) {
      query.$nor = children;
    }
  }

  return query;
}
