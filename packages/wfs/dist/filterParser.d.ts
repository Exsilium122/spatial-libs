/**
 * Unwraps arrays recursively to support both explicitArray: true and simple object outputs.
 */
export declare function unwrap(val: any): any;
/**
 * Strips namespace prefixes recursively from keys in a parsed XML object.
 */
export declare function normalizeKeys(obj: any): any;
/**
 * Parses an OGC Filter XML string into a normalized JavaScript object structure.
 */
export declare function parseFilterString(xmlString: string): Promise<any>;
/**
 * Recursively parses a normalized OGC filter node into a MongoDB query selector.
 */
export declare function parseFilterObj(filterNode: any): any;
