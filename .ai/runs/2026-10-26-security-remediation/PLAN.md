# Security Remediation: Multi-Package Vulnerability Hardening

Mode: `om-orchestrate` → `om-auto-create-pr`
Target: Fix all discovered security audit findings across CRS, OGC, WFS, CI/CD, and Documentation.

## Design Decisions

- **D01 (CRS)** — Replace `in BUILTIN_PROJECTIONS` with `Object.prototype.hasOwnProperty.call(BUILTIN_PROJECTIONS, normalized)` in `packages/crs/src/index.ts` so inherited Object prototype properties (`constructor`, `toString`, `valueOf`) evaluate to `false` in `isSupported()` and cannot trigger proj4 runtime errors.
- **D02 (OGC)** — Fail closed when `baseUrl` is relative and `trustedHosts` is not configured; do not reflect arbitrary client `Host` headers. In OGC route handlers, catch unexpected errors and return standardized JSON error envelopes (500) rather than calling `next(err)` to prevent stack trace leaks in non-production environments.
- **D03 (WFS Auth)** — Uniformly check `provider.getSupportedTypes(req.user)` across WFS 1.0.0, 1.1.0, and 2.0.0 `DescribeFeatureType` and `GetFeature` handlers before calling provider methods. Return `InvalidParameterValue` exception if unadvertised feature types are requested.
- **D04 (WFS Injection)** — Strictly assert and coerce primitive string types on `query.ID || query.FEATUREID` in WFS 2.0 StoredQuery `GetFeatureById`. Validate `feature.properties` keys against XML NCName pattern (`/^[a-zA-Z_][a-zA-Z0-9_.-]*$/`) before formatting as XML element tags in GML responses.
- **D05 (WFS DoS & Parsing)** — Enforce `maxBodyBytes` (default 1MB) on POST XML bodies returning HTTP 413. Remove `^0.3.0` from `express-xml-bodyparser` peer range in `package.json`. Enforce maximum recursion depth of 32 nodes on XML filter trees in `filterParser.ts`. Implement `defaultCount` / `maxCount` (default 1000) to cap unbounded GetFeature queries.
- **D06 (CI/CD & Tester)** — In `.github/workflows/publish.yml`, use `npm ci --ignore-scripts` for jobs holding OIDC publishing tokens. Set `persist-credentials: false` on `actions/checkout` steps. In `packages/tester`, warn when passwords are passed on CLI instead of `AUTH_PASS` env var, and use null-prototype objects in prefix stripping. Update MongoDB cookbook in `README.md` to ensure scoping keys take precedence over filter queries.

## Progress

### Phase 1 — Parallel Implementation (Disjoint Scopes)
- [x] Unit 1: CRS Transformer prototype check hardening (`packages/crs/**`) — Merged `cez/c09546fc`
- [x] Unit 2: OGC API Features fail-closed host & error handling (`packages/ogc/**`) — Merged `cez/a1fc9691`
- [x] Unit 3: WFS protocol engine authorization, injection, and body limits (`packages/wfs/**`) — Merged `cez/a5df0728`
- [x] Unit 4: Workflows, Tester CLI & Documentation hardening (`.github/workflows/**`, `packages/tester/**`, `README.md`) — Merged `cez/33648654`

### Phase 2 — Integration & Verification
- [x] Sequentially merge all 4 child branches into `cez/c0301c79`
- [x] Run full validation gate from root (`npm run build` and `npm test` — all 424 tests passing)
- [x] Final integration summary and report
