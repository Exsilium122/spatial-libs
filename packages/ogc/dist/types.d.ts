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
export interface SpatialDataProvider {
    getSupportedTypes(context: any): Promise<string[]>;
    getBoundingBox(context: any, featureType: string): Promise<BoundingBox>;
    getFeatures(context: any, featureType: string, fids?: string[], filterQuery?: any): Promise<GeoJSONFeature[]>;
    getCollectionsMetadata?(context: any): Promise<OgcCollectionMetadata[]>;
    getGeometryType?(context: any, featureType: string): Promise<'LineString' | 'Point'>;
}
export interface OgcOptions {
    provider: SpatialDataProvider;
    logger?: Logger;
    baseUrl: string;
    appUrl?: string;
    defaultLimit?: number;
    maxLimit?: number;
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
    body: any;
}
