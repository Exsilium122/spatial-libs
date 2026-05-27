import express from 'express';
import { OgcOptions, SpatialDataProvider } from './types.js';
declare module 'express-serve-static-core' {
    interface Request {
        user?: any;
    }
}
export * from './types.js';
/**
 * Boot-time verification helper to check if the data provider implements necessary methods.
 */
export declare function verifyProvider(provider: SpatialDataProvider): void;
/**
 * Creates a standard Express router configured with the OGC API Features handlers.
 */
export default function createOgcRouter(options: OgcOptions): express.Router;
