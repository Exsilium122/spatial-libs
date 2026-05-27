import { GenericResponse } from './types.js';
export declare function buildExceptionXml(code: string | number, locator: string, msg: string, version?: string): string;
export declare function buildExceptionResponse(code: string | number, locator: string, msg: string, version?: string): GenericResponse;
