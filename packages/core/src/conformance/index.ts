/**
 * Conformance test kit for @spatial-api/core
 */

export type ConformanceStatus = 'pass' | 'fail' | 'skip';

export interface ConformanceRequirementResult {
  id: string;
  capability?: string;
  status: ConformanceStatus;
  message?: string;
}

export interface ConformanceReport {
  results: ConformanceRequirementResult[];
  passed: number;
  failed: number;
  skipped: number;
}
