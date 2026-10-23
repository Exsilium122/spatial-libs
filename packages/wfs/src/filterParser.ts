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
  if (!/^[a-zA-Z0-9_.:-]+$/.test(name)) {
    throw new FilterValidationError(`Invalid PropertyName "${name}": must match /^[a-zA-Z0-9_.:-]+$/`);
  }
  if (name.startsWith('$')) {
    throw new FilterValidationError(`Invalid PropertyName "${name}": cannot start with "$"`);
  }
  const segments = name.split(/[.:]/);
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

function escapeRegExp(str: string): string {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

interface LikeOptions {
  wildCard?: string;
  singleChar?: string;
  escapeChar?: string;
  matchCase?: boolean;
}

function parseLikePattern(pattern: string, options: LikeOptions = {}): string[] {
  const customWild = options.wildCard !== undefined;
  const wildChars = customWild ? [options.wildCard!] : ['*', '%'];
  const singleChar = options.singleChar;
  const esc = options.escapeChar;

  const segments: string[] = [];
  let currentSegment = '';
  let inWild = false;

  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];

    if (esc && ch === esc && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      currentSegment += escapeRegExp(next);
      i += 2;
      inWild = false;
      continue;
    }

    if (wildChars.includes(ch)) {
      if (!inWild) {
        segments.push(currentSegment);
        currentSegment = '';
        inWild = true;
      }
      i++;
      continue;
    }

    inWild = false;

    if (singleChar !== undefined && ch === singleChar) {
      currentSegment += '.';
      i++;
      continue;
    }

    currentSegment += escapeRegExp(ch);
    i++;
  }

  segments.push(currentSegment);
  return segments;
}

/**
 * Converts a PropertyIsLike pattern into an anchored RegExp that matches in linear time.
 */
function likePatternToRegExp(pattern: string, options: LikeOptions = {}): RegExp {
  const segments = parseLikePattern(pattern, options);
  const flags = options.matchCase === false ? 'i' : '';

  if (segments.length === 1) {
    return new RegExp('^' + segments[0] + '$', flags);
  }

  let source = '^' + segments[0];
  for (let i = 1; i < segments.length - 1; i++) {
    source += '(?=(.*?' + segments[i] + '))\\' + i;
  }
  source += '.*' + segments[segments.length - 1] + '$';
  return new RegExp(source, flags);
}

/**
 * Unwraps arrays recursively to support both explicitArray: true and simple object outputs.
 */
export function unwrap(val: any): any {
  if (Array.isArray(val)) {
    return unwrap(val[0]);
  }
  if (val && typeof val === 'object') {
    if ('#text' in val) return unwrap(val['#text']);
    if ('_' in val) return unwrap(val['_']);
  }
  return val;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Canonical casing of the filter elements parseFilterObj understands. express-xml-bodyparser
 * lowercases tag names (normalizeTags), so POST bodies arrive as e.g. `ogc:propertyisequalto`.
 */
const CANONICAL_FILTER_KEYS = new Map(
  [
    'Filter', 'FeatureId', 'ResourceId', 'BBOX', 'Box', 'coordinates',
    'PropertyName', 'ValueReference', 'Literal',
    'PropertyIsEqualTo', 'PropertyIsNotEqualTo', 'PropertyIsLessThan', 'PropertyIsGreaterThan',
    'PropertyIsLessThanOrEqualTo', 'PropertyIsGreaterThanOrEqualTo', 'PropertyIsLike',
    'PropertyIsBetween', 'LowerBoundary', 'UpperBoundary', 'PropertyIsNull',
    'Envelope', 'lowerCorner', 'upperCorner',
    'And', 'Or', 'Not',
  ].map((k) => [k.toLowerCase(), k] as const)
);

/**
 * Strips namespace prefixes recursively from keys in a parsed XML object and restores the
 * canonical casing of known filter elements. The xml2js attribute bag (`$`) is kept as a
 * flat, prototype-free copy so FeatureId/ResourceId `fid`/`rid` attributes survive.
 */
export function normalizeKeys(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  const res: Record<string, any> = Object.create(null);
  const attrs: Record<string, any> = Object.create(null);

  if (obj.$ && typeof obj.$ === 'object') {
    for (const [name, value] of Object.entries(obj.$)) {
      if (!FORBIDDEN_KEYS.has(name) && typeof value === 'string') attrs[name] = value;
    }
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('@')) {
      const attrName = key.replace(/^@_?/, '');
      if (!FORBIDDEN_KEYS.has(attrName)) {
        attrs[attrName] = String(obj[key]);
      }
      continue;
    }
    if (key === '$') {
      continue;
    }
    const localKey = key.includes(':') ? key.split(':')[1] : key;
    if (FORBIDDEN_KEYS.has(localKey)) {
      continue;
    }
    const cleanKey = CANONICAL_FILTER_KEYS.get(localKey.toLowerCase()) ?? localKey;
    res[cleanKey] = normalizeKeys(obj[key]);
  }

  if (Object.keys(attrs).length > 0) {
    res.$ = attrs;
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

function getAttr(node: any, ...names: string[]): string | undefined {
  if (!node?.$) return undefined;
  for (const name of names) {
    if (node.$[name] !== undefined) return String(node.$[name]);
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(node.$)) {
      if (k.toLowerCase() === lower && v !== undefined && v !== null) return String(v);
    }
  }
  return undefined;
}

function getPropertyName(node: any): string | undefined {
  const raw = node?.PropertyName !== undefined && node?.PropertyName !== null
    ? node.PropertyName
    : (node?.ValueReference !== undefined && node?.ValueReference !== null ? node.ValueReference : undefined);
  if (raw === undefined || raw === null) return undefined;
  return validatePropertyName(unwrap(raw));
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
      : (bboxNode?.ValueReference !== undefined && bboxNode?.ValueReference !== null ? unwrap(bboxNode.ValueReference) : undefined);
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
    const envNode = unwrap(bboxNode?.Envelope);
    if (envNode && envNode.lowerCorner && envNode.upperCorner) {
      const lower = String(unwrap(envNode.lowerCorner) ?? '').trim().split(/\s+/).map(Number);
      const upper = String(unwrap(envNode.upperCorner) ?? '').trim().split(/\s+/).map(Number);
      if (lower.length >= 2 && upper.length >= 2 && !isNaN(lower[0]) && !isNaN(lower[1]) && !isNaN(upper[0]) && !isNaN(upper[1])) {
        query[dbPropName] = {
          $geoWithin: {
            $geometry: {
              type: 'Polygon',
              coordinates: [[
                [lower[0], lower[1]],
                [upper[0], lower[1]],
                [upper[0], upper[1]],
                [lower[0], upper[1]],
                [lower[0], lower[1]],
              ]]
            }
          }
        };
      }
    }
  }

  // 2. Simple Comparisons
  if (filterNode.PropertyIsEqualTo) {
    const node = unwrap(filterNode.PropertyIsEqualTo);
    const prop = getPropertyName(node);
    if (prop) {
      const lit = validateLiteral(unwrap(node?.Literal));
      const matchCaseAttr = getAttr(node, 'matchCase', 'matchcase');
      const matchCase = matchCaseAttr !== undefined ? matchCaseAttr !== 'false' : true;
      if (!matchCase && lit !== undefined) {
        query[prop] = { $regex: new RegExp('^' + escapeRegExp(String(lit)) + '$', 'i') };
      } else {
        query[prop] = lit;
      }
    }
  }
  if (filterNode.PropertyIsNotEqualTo) {
    const node = unwrap(filterNode.PropertyIsNotEqualTo);
    const prop = getPropertyName(node);
    if (prop) {
      const lit = validateLiteral(unwrap(node?.Literal));
      query[prop] = { $ne: lit };
    }
  }
  if (filterNode.PropertyIsLessThan) {
    const node = unwrap(filterNode.PropertyIsLessThan);
    const prop = getPropertyName(node);
    if (prop) {
      const lit = validateLiteral(unwrap(node?.Literal));
      query[prop] = { $lt: lit };
    }
  }
  if (filterNode.PropertyIsGreaterThan) {
    const node = unwrap(filterNode.PropertyIsGreaterThan);
    const prop = getPropertyName(node);
    if (prop) {
      const lit = validateLiteral(unwrap(node?.Literal));
      query[prop] = { $gt: lit };
    }
  }
  if (filterNode.PropertyIsLessThanOrEqualTo) {
    const node = unwrap(filterNode.PropertyIsLessThanOrEqualTo);
    const prop = getPropertyName(node);
    if (prop) {
      const lit = validateLiteral(unwrap(node?.Literal));
      query[prop] = { $lte: lit };
    }
  }
  if (filterNode.PropertyIsGreaterThanOrEqualTo) {
    const node = unwrap(filterNode.PropertyIsGreaterThanOrEqualTo);
    const prop = getPropertyName(node);
    if (prop) {
      const lit = validateLiteral(unwrap(node?.Literal));
      query[prop] = { $gte: lit };
    }
  }
  if (filterNode.PropertyIsBetween) {
    const node = unwrap(filterNode.PropertyIsBetween);
    const prop = getPropertyName(node);
    if (prop) {
      const lowerNode = unwrap(node?.LowerBoundary);
      const upperNode = unwrap(node?.UpperBoundary);
      const lowerLit = validateLiteral(unwrap(lowerNode?.Literal));
      const upperLit = validateLiteral(unwrap(upperNode?.Literal));
      const lowerVal = typeof lowerLit === 'string' && !isNaN(Number(lowerLit)) ? Number(lowerLit) : lowerLit;
      const upperVal = typeof upperLit === 'string' && !isNaN(Number(upperLit)) ? Number(upperLit) : upperLit;
      query[prop] = { $gte: lowerVal, $lte: upperVal };
    }
  }
  if (filterNode.PropertyIsNull) {
    const node = unwrap(filterNode.PropertyIsNull);
    const prop = getPropertyName(node);
    if (prop) {
      query[prop] = null;
    }
  }
  if (filterNode.PropertyIsLike) {
    const node = unwrap(filterNode.PropertyIsLike);
    const prop = getPropertyName(node);
    if (prop) {
      const rawLit = unwrap(node?.Literal);
      const lit = validateLiteral(rawLit);
      if (lit !== undefined) {
        const litStr = String(lit);
        if (litStr.length > 256) {
          throw new FilterValidationError('PropertyIsLike literal exceeds maximum length of 256 characters');
        }
        const wildCard = getAttr(node, 'wildCard', 'wildcard');
        const singleChar = getAttr(node, 'singleChar', 'singlechar');
        const escapeChar = getAttr(node, 'escapeChar', 'escapechar', 'escape');
        const matchCaseAttr = getAttr(node, 'matchCase', 'matchcase');
        const matchCase = matchCaseAttr !== undefined ? matchCaseAttr !== 'false' : true;
        query[prop] = {
          $regex: likePatternToRegExp(litStr, {
            wildCard,
            singleChar,
            escapeChar,
            matchCase,
          }),
        };
      }
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
