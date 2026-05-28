export interface Logger {
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  debug?(msg: string, ...args: any[]): void;
}

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface GeoJSONGeometry {
  type: string;
  coordinates: any;
}

export interface GeoJSONFeature {
  id: string | number;
  geometry: GeoJSONGeometry;
  properties: Record<string, any>;
}

export interface SpatialDataProvider {
  getSupportedTypes(context: any): Promise<string[]>;
  getBoundingBox(context: any, featureType: string): Promise<BoundingBox>;
  getFeatures(
    context: any,
    featureType: string,
    fids?: string[],
    filterQuery?: any
  ): Promise<GeoJSONFeature[]>;
  getGeometryType?(context: any, featureType: string): Promise<'LineString' | 'Point'>;
  getPropertiesSchema?(
    context: any,
    featureType: string
  ): Promise<Record<string, 'string' | 'integer' | 'double' | 'boolean'>>;
}

export interface CoordinateTransformer {
  normalizeSrs(srsName: string): string;
  isSupported(srsName: string): boolean;
  getSupportedCodes(): string[];
  transformCoordinate(coords: [number, number], fromSrs: string, toSrs: string): [number, number];
  transformGeometry(geometry: GeoJSONGeometry, fromSrs: string, toSrs: string): GeoJSONGeometry;
}

export interface WfsOptions {
  provider: SpatialDataProvider;
  logger?: Logger;
  baseUrl: string;
  crsTransformer?: CoordinateTransformer; // Dynamic injection
  appUrl?: string; // Kept as optional fallback/backward compatibility if needed, but not enforced
  enabledVersions?: ('1.0.0' | '1.1.0' | '2.0.0' | '2.0.2')[];
  xmlOptions?: {
    schemaLocations?: Record<string, string>;
    namespaces?: Record<string, string>;
    urlPropertyName?: string;
  };
}

export interface GenericRequest {
  method: 'GET' | 'POST';
  query: Record<string, any>;
  body?: any;
  user?: any; // To pass context
  baseUrl?: string;
}

export interface GenericResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
