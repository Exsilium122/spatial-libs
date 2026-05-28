import express from 'express';
import { WfsOptions, GenericRequest, GenericResponse } from './types.js';
export * from './types.js';
export { handleWfs100 } from './v1_0_0.js';
export { handleWfs110 } from './v1_1_0.js';
export { handleWfs200 } from './v2_0_0.js';
/**
 * Framework-agnostic unified WFS request dispatcher.
 */
export declare function dispatchWfsRequest(req: GenericRequest, options: WfsOptions): Promise<GenericResponse>;
/**
 * Creates a standard Express router configured with the WFS protocol handlers.
 */
export default function createWfsRouter(options: WfsOptions): express.Router;
