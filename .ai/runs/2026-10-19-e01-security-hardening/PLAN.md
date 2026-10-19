# E01 — Critical Security Hardening & Injection Defenses

Issue: #1 (stories #5, #6, #7, #8)
Mode: `om-orchestrate` → `om-auto-fix-issue`, children on antigravity / `gemini-3.8-flash-high`

## Design decisions

- **D01/D02 (#5)** — WFS filter property names must match `/^[a-zA-Z0-9_.-]+$/`, may not start with `$`, and may not be (or contain a segment equal to) `__proto__`, `constructor`, `prototype`. Literals must be primitives. Violations raise an error that each WFS version handler turns into an `InvalidParameterValue` OGC exception (HTTP 400). OGC `?name=` accepts only a single string; anything else → HTTP 400.
- **ReDoS (#5)** — `PropertyIsLike` collapses consecutive wildcards and bounds literal length before building the RegExp.
- **D03 (#6)** — `SpatialDataProvider.getFeatures` (OGC) gains an optional 5th argument `options?: { limit?: number; offset?: number }`. Providers opt into database pagination by also implementing `countFeatures(context, featureType, filterQuery)`; then the router trusts the provider page and uses the count for `numberMatched`. Providers without `countFeatures` keep the legacy in-memory slice (non-breaking), with a one-time `logger.warn`.
- **D04 (#7)** — both `OgcOptions` and `WfsOptions` gain `trustedHosts?: string[]`. An absolute configured `baseUrl` always wins. Otherwise the `Host` header is used only if it is syntactically valid and (when `trustedHosts` is set) in the allowlist; otherwise links fall back to path-relative URLs.
- **D05 (#8)** — `normalizeKeys` builds results with `Object.create(null)` and drops `__proto__`, `constructor`, `prototype` keys.

## Progress

### Phase 1 — parallel implementation (disjoint scopes)
- [x] Unit A — WFS filter hardening (#5 WFS part, #8): `packages/wfs/src/filterParser.ts`, `packages/wfs/src/v1_0_0.ts`, `v1_1_0.ts`, `v2_0_0.ts`, `packages/wfs/test/filter-security.test.ts`
- [x] Unit B — OGC hardening (#5 OGC part, #6, #7 OGC part): `packages/ogc/**`
- [x] Unit C — WFS trusted base URL (#7 WFS part): `packages/wfs/src/index.ts`, `packages/wfs/src/types.ts`, `packages/wfs/README.md`, `packages/wfs/test/host-security.test.ts`

### Phase 2 — integration
- [x] Merge units, run `npm test` + `npm run build` from root
- [ ] Final review subtask (`--kind review`) approves
- [ ] PR ready
