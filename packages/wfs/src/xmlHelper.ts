import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const builder = new XMLBuilder({
  attributeNamePrefix: '@',
  ignoreAttributes: false,
  format: true,
  indentBy: '  ',
  suppressBooleanAttributes: false,
});

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
});

export function buildXml(xmlData: Record<string, any>): string {
  return builder.build(xmlData);
}

export function parseXml(xmlString: string): any {
  return parser.parse(xmlString);
}
