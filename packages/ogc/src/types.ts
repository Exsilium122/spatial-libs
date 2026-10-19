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

export interface OgcCollectionMetadata {
  id: string;
  title: string;
  description: string;
  extent?: {
    spatial: {
      bbox: number[][];
    };
  };
}

export interface FeatureQueryOptions {
  limit?: number;
  offset?: number;
}

export interface SpatialDataProvider {
  getSupportedTypes(context: any): Promise<string[]>;
  getBoundingBox(context: any, featureType: string): Promise<BoundingBox>;
  getFeatures(
    context: any,
    featureType: string,
    fids?: string[],
    filterQuery?: any,
    options?: FeatureQueryOptions
  ): Promise<GeoJSONFeature[]>;
  countFeatures?(context: any, featureType: string, filterQuery?: any): Promise<number>;
  getCollectionsMetadata?(context: any): Promise<OgcCollectionMetadata[]>;
  getGeometryType?(context: any, featureType: string): Promise<'LineString' | 'Point'>;
}

export interface CoordinateTransformer {
  normalizeSrs(srsName: string): string;
  isSupported(srsName: string): boolean;
  getSupportedCodes(): string[];
  transformCoordinate(coords: [number, number], fromSrs: string, toSrs: string): [number, number];
  transformGeometry(geometry: GeoJSONGeometry, fromSrs: string, toSrs: string): GeoJSONGeometry;
}

export interface OgcOptions {
  provider: SpatialDataProvider;
  logger?: Logger;
  baseUrl: string;
  crsTransformer?: CoordinateTransformer; // Dynamic injection
  appUrl?: string; // Kept as optional for backward compatibility if needed, but not enforced
  defaultLimit?: number;
  maxLimit?: number;
  /**
   * List of allowed Host header values (e.g. ['api.example.com', 'localhost:3000']).
   * Compared case-insensitively; port must be included when present.
   */
  trustedHosts?: string[];
}

export interface GenericRequest {
  method: 'GET';
  url: string;
  path: string;
  query: Record<string, any>;
  params: Record<string, string>;
  user?: any;
}

export interface GenericResponse {
  status: number;
  headers: Record<string, string>;
  body: any; // Can be object (JSON) or string
}
