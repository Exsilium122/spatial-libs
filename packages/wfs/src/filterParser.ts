import { parseXml } from './xmlHelper.js';

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
  const res: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@') || key === '$') continue;
    const cleanKey = key.includes(':') ? key.split(':')[1] : key;
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
    const propName = unwrap(bboxNode.PropertyName) || 'geo';
    const dbPropName = propName === 'geo' ? 'geo.coordinates' : propName;
    const boxNode = unwrap(bboxNode.Box);
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
    const prop = unwrap(node.PropertyName);
    const lit = unwrap(node.Literal);
    if (prop) query[prop] = lit;
  }
  if (filterNode.PropertyIsNotEqualTo) {
    const node = unwrap(filterNode.PropertyIsNotEqualTo);
    const prop = unwrap(node.PropertyName);
    const lit = unwrap(node.Literal);
    if (prop) query[prop] = { $ne: lit };
  }
  if (filterNode.PropertyIsLessThan) {
    const node = unwrap(filterNode.PropertyIsLessThan);
    const prop = unwrap(node.PropertyName);
    const lit = unwrap(node.Literal);
    if (prop) query[prop] = { $lt: lit };
  }
  if (filterNode.PropertyIsGreaterThan) {
    const node = unwrap(filterNode.PropertyIsGreaterThan);
    const prop = unwrap(node.PropertyName);
    const lit = unwrap(node.Literal);
    if (prop) query[prop] = { $gt: lit };
  }
  if (filterNode.PropertyIsLessThanOrEqualTo) {
    const node = unwrap(filterNode.PropertyIsLessThanOrEqualTo);
    const prop = unwrap(node.PropertyName);
    const lit = unwrap(node.Literal);
    if (prop) query[prop] = { $lte: lit };
  }
  if (filterNode.PropertyIsGreaterThanOrEqualTo) {
    const node = unwrap(filterNode.PropertyIsGreaterThanOrEqualTo);
    const prop = unwrap(node.PropertyName);
    const lit = unwrap(node.Literal);
    if (prop) query[prop] = { $gte: lit };
  }
  if (filterNode.PropertyIsLike) {
    const node = unwrap(filterNode.PropertyIsLike);
    const prop = unwrap(node.PropertyName);
    const lit = unwrap(node.Literal);
    if (prop && lit) {
      // Map wildcards (* or %) to regex
      const escaped = lit
        .replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') // escape regex chars
        .replace(/\\\*/g, '.*')
        .replace(/\\%/g, '.*');
      query[prop] = { $regex: new RegExp('^' + escaped + '$', 'i') };
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
