import { it } from 'vitest';

/**
 * Declares a requirement the library does not meet yet. By default the test must fail
 * (`it.fails`), keeping the suite green while documenting the gap; with CONFORMANCE_STRICT=1
 * it runs as a regular test so the actual non-conformance is reported.
 */
export const gap: typeof it = (process.env.CONFORMANCE_STRICT ? it : it.fails) as typeof it;
