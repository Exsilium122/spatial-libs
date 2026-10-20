/**
 * Core contract types for @spatial-api/core (Spatial API 2.0 Provider Contract)
 */

export type Position = [number, number] | [number, number, number] | number[];

export type GeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'
  | 'GeometryCollection';

export interface Point {
  type: 'Point';
  coordinates: Position;
  bbox?: BoundingBox;
}

export interface MultiPoint {
  type: 'MultiPoint';
  coordinates: Position[];
  bbox?: BoundingBox;
}

export interface LineString {
  type: 'LineString';
  coordinates: Position[];
  bbox?: BoundingBox;
}

export interface MultiLineString {
  type: 'MultiLineString';
  coordinates: Position[][];
  bbox?: BoundingBox;
}

export interface Polygon {
  type: 'Polygon';
  coordinates: Position[][];
  bbox?: BoundingBox;
}

export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: Position[][][];
  bbox?: BoundingBox;
}

export interface GeometryCollection {
  type: 'GeometryCollection';
  geometries: Geometry[];
  bbox?: BoundingBox;
}

export type Geometry =
  | Point
  | MultiPoint
  | LineString
  | MultiLineString
  | Polygon
  | MultiPolygon
  | GeometryCollection;

export type BoundingBox =
  | [number, number, number, number]
  | [number, number, number, number, number, number];

export interface Feature {
  type: 'Feature';
  id?: string | number;
  geometry: Geometry | null;
  properties: Record<string, unknown> | null;
  bbox?: BoundingBox;
  [key: string]: unknown;
}

export type PropertyType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'object'
  | 'array';

export interface PropertySchema {
  type: PropertyType;
  nullable?: boolean;
  title?: string;
  queryable?: boolean; // default true
}

export interface CollectionDescription {
  id: string; // stable, URL-safe; used as WFS typeName and OGC collectionId
  title?: string;
  description?: string;
  storageCrs: string; // OGC CRS URI; default 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
  extent?: {
    spatial?: {
      bbox: BoundingBox; // CRS84
    };
    temporal?: {
      interval: [string | null, string | null];
    };
  };
  geometry?: {
    property: string;
    types: GeometryType[];
  } | null; // null = no geometry (pure attribute collection)
  properties: Record<string, PropertySchema>;
  idProperty?: string;
  temporalProperty?: string | { start: string; end: string }; // drives OGC `datetime` and FES temporal operators
}

export type FilterOperator =
  // Logical
  | 'and'
  | 'or'
  | 'not'
  // Comparison
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'like'
  | 'between'
  | 'in'
  | 'isNull'
  // Spatial
  | 's_intersects'
  | 's_equals'
  | 's_disjoint'
  | 's_touches'
  | 's_within'
  | 's_overlaps'
  | 's_crosses'
  | 's_contains'
  // Temporal
  | 't_after'
  | 't_before'
  | 't_contains'
  | 't_disjoint'
  | 't_during'
  | 't_equals'
  | 't_finishedBy'
  | 't_finishes'
  | 't_intersects'
  | 't_meets'
  | 't_metBy'
  | 't_overlappedBy'
  | 't_overlaps'
  | 't_startedBy'
  | 't_starts'
  // Functions
  | 'casei'
  | 'accenti'
  // Extensions
  | 'x_dwithin'
  | 'x_beyond';

export interface FilterNode {
  op: FilterOperator | string;
  args?: unknown[];
  [key: string]: unknown;
}

export type Filter = FilterNode | boolean | Record<string, unknown>;

export interface ProviderCapabilities {
  filter: {
    operators: FilterOperator[];
  }; // evaluated natively; [] = library evaluates everything it can in memory
  paging: boolean; // honours limit/offset natively
  count: 'exact' | 'none'; // 'exact' => getFeatures returns numberMatched; optional countFeatures serves resultType=hits
  sorting: boolean; // honours sortBy natively
  propertySelection: boolean; // honours `properties` natively
  crs: {
    native: string[];
  }; // CRS URIs the provider can return directly; [] = library reprojects
  write?: {
    atomic: boolean;
    idGeneration: ('generate' | 'useExisting' | 'replaceDuplicate')[];
  };
}

export interface RequestContext {
  protocol: { id: string; version?: string }; // e.g. { id: 'wfs', version: '2.0.2' }
  user?: unknown; // host-supplied identity; authorization is the provider's job
  pathParams: Record<string, string>; // from the mount path (Spec 2), {} without a host
  vendorParams: Record<string, string>; // query parameters the protocol did not consume
  signal?: AbortSignal; // aborted when the client disconnects
  cache: Map<unknown, unknown>; // per-request scratch, e.g. memoized describeCollections
}

export interface GetFeaturesParams {
  context: RequestContext;
  collection: string;
  ids?: (string | number)[]; // the only id-selection channel; combined with filter as ids ∧ filter
  filter?: Filter; // only operators the provider declared
  limit: number;
  offset: number; // always set; ignored if capabilities.paging === false
  sortBy?: { property: string; direction: 'asc' | 'desc' }[];
  properties?: string[]; // only if capabilities.propertySelection
  crs?: string; // only if listed in capabilities.crs.native; otherwise library reprojects from storageCrs
}

export interface FeatureResult {
  features: Feature[];
  numberMatched?: number; // numberMatched required when count === 'exact'
}

export type WriteOperation =
  | { type: 'insert'; collection: string; features: Feature[]; crs: string; handle?: string }
  | { type: 'update'; collection: string; filter: Filter; set: Record<string, unknown>; geometry?: Geometry | null; crs?: string; handle?: string }
  | { type: 'replace'; collection: string; filter: Filter; feature: Feature; crs: string; handle?: string }
  | { type: 'delete'; collection: string; filter: Filter; handle?: string };

export interface TransactionResult {
  inserted: { handle?: string; ids: (string | number)[] }[];
  updated: { handle?: string; ids: (string | number)[] }[];
  replaced: { handle?: string; ids: (string | number)[] }[];
  deleted: number;
  status: 'success' | 'partial' | 'failed'; // 'partial' only legal when capabilities.write.atomic === false
  failures?: { handle?: string; error: Error }[];
}

export interface SpatialProvider {
  readonly name?: string; // shown in mount logs
  readonly capabilities: ProviderCapabilities;
  describeCollections(p: { context: RequestContext; ids?: string[] }): Promise<CollectionDescription[]>;
  getFeatures(p: GetFeaturesParams): Promise<FeatureResult>;
  countFeatures?(p: { context: RequestContext; collection: string; filter?: Filter }): Promise<number>;
  streamFeatures?(p: Omit<GetFeaturesParams, 'offset' | 'limit'> & { limit?: number }): AsyncIterable<Feature>;
  transaction?(p: {
    context: RequestContext;
    operations: WriteOperation[];
    idGeneration?: 'generate' | 'useExisting' | 'replaceDuplicate';
  }): Promise<TransactionResult>;
}

export interface FeatureEncoder {
  readonly id: string; // e.g. 'shapefile'
  readonly mediaType: string; // e.g. 'application/x-shapefile+zip'
  readonly fileExtension: string; // e.g. 'zip'
  readonly wfsOutputFormat?: string; // name advertised in WFS outputFormat lists
  readonly limits?: {
    maxFeatures?: number;
    geometryTypes?: GeometryType[];
    singleGeometryType?: boolean;
    multiLayer?: boolean;
  };
  encode(input: {
    layers: { collection: CollectionDescription; features: AsyncIterable<Feature>; properties?: string[] }[];
    crs: string;
    meta: { numberMatched?: number; timeStamp: string; links?: { href: string; rel: string; type?: string }[] };
    signal?: AbortSignal;
    logger: Logger;
  }): AsyncIterable<Uint8Array>;
}

export interface CoordinateTransformer {
  transformCoordinate(coords: [number, number], fromSrs: string, toSrs: string): [number, number];
  transformCoordinate(coords: number[], fromSrs: string, toSrs: string): number[];
  transformGeometry?(geometry: Geometry, fromSrs: string, toSrs: string): Geometry;
  normalizeSrs?(srsName: string): string;
  isSupported?(srsName: string): boolean;
  getSupportedCodes?(): string[];
  transformBoundingBox?(bbox: BoundingBox, fromSrs: string, toSrs: string): BoundingBox;
}

export interface SpatialRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  path: string; // relative to the mount
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  baseUrl: string; // absolute, or path-absolute when the Host header is untrusted (E01-S03 fallback)
  user?: unknown;
  pathParams?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SpatialResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array | AsyncIterable<Uint8Array>;
}

export interface SpatialService {
  handle(req: SpatialRequest): Promise<SpatialResponse>;
  describe(): ServiceInfo;
}

export interface ServiceParameterInfo {
  name: string;
  in: 'query' | 'path';
  operations?: string[];
  required: boolean;
  description: string;
  example?: string;
  source: 'standard' | 'extension' | 'vendor';
  specUrl?: string;
}

export interface ServiceInfo {
  protocol: string;
  versions: string[];
  write: boolean;
  extensions: string[];
  formats: string[];
  entryPoint: string; // relative URL of the protocol's own advertising (GetCapabilities / landing)
  parameters: ServiceParameterInfo[];
}

export interface ServiceLimits {
  maxScan?: number; // default 10 000 features examined for residual filtering
  providerTimeoutMs?: number; // default none; on expiry context.signal aborts and the call fails as internal error
}

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

export interface ProviderRequirements {
  write?: boolean;
  streamFeatures?: boolean;
  countFeatures?: boolean;
  operators?: FilterOperator[];
  crs?: string[];
}
