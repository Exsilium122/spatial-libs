import { XMLParser } from 'fast-xml-parser';

/**
 * Configure fast-xml-parser to normalize parsed XML shape:
 * - Wrap non-attribute child elements in an array
 * - Keep root element as an object
 * - Attributes grouped under '$'
 * - Text node stored under '_'
 * - Safe parsing (do not enable entity expansion beyond defaults)
 * - Strip namespace prefixes automatically
 */
export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributesGroupName: '$',
  attributeNamePrefix: '',
  textNodeName: '_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  removeNSPrefix: true,
  isArray: (tagName, jPath, _isLeafNode, isAttribute) => {
    if (isAttribute || tagName === '$') return false;
    if (typeof jPath === 'string' && !jPath.includes('.')) return false;
    return true;
  }
});

/**
 * Async-compatible XML parsing function using fast-xml-parser.
 */
export async function parseXml(xmlData: string | Buffer): Promise<any> {
  if (!xmlData) return null;
  return xmlParser.parse(xmlData);
}

/**
 * Compatibility alias for callers expecting parseStringPromise.
 */
export const parseStringPromise = parseXml;
