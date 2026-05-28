import express from 'express';
import { OgcOptions } from './types.js';
declare module 'express-serve-static-core' {
    interface Request {
        user?: any;
    }
}
export * from './types.js';
/**
 * Creates a standard Express router configured with the OGC API Features handlers.
 */
export default function createOgcRouter(options: OgcOptions): express.Router;
