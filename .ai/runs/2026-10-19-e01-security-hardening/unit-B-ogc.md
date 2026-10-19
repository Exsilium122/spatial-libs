# Unit B — OGC API hardening (#5 OGC part, #6, #7 OGC part)

All work is in `packages/ogc/` (router in `src/index.ts`, contract in `src/types.ts`, tests in `test/`). Read `BACKWARD_COMPATIBILITY.md` §2.2 — every change must be **additive / non-breaking** for existing `SpatialDataProvider` implementations.

## 1. NoSQL injection via `?name=` (#5)
`GET /collections/:id/items` does `filterQuery.name = req.query.name`, so `?name[$ne]=null` (Express qs parses this into `{ $ne: 'null' }`) or `?name=a&name=b` (array) reaches the provider as an operator object.
- Accept `name` only when `typeof req.query.name === 'string'`. Any other shape → **HTTP 400** `{ error: 'Invalid "name" parameter: expected a single string value.' }` (or similar), provider never called.
- Hardening of the self/next/prev link builders: they iterate `req.query`; make sure non-string query values cannot produce `[object Object]` or throw (skip or stringify safely), and that keys like `__proto__` are not copied into the `params` object (use `Object.create(null)` or filter).

## 2. Database-level pagination (#6, decision D03)
Today `provider.getFeatures(...)` returns the whole dataset and the router does `.slice(offset, offset + limit)` in memory → OOM on large collections.
- In `types.ts` add and export:
  ```ts
  export interface FeatureQueryOptions { limit?: number; offset?: number; }
  ```
  Extend `SpatialDataProvider`:
  ```ts
  getFeatures(context, featureType, fids?, filterQuery?, options?: FeatureQueryOptions): Promise<GeoJSONFeature[]>;
  countFeatures?(context: any, featureType: string, filterQuery?: any): Promise<number>;
  ```
- Router: always pass `{ limit, offset }` as the 5th argument.
  - If the provider implements `countFeatures`, it is **pagination-aware**: trust the returned page (defensively `.slice(0, limit)` if it returns more), and `numberMatched = await provider.countFeatures(user, collectionId, filterQuery)`.
  - Otherwise (legacy provider) keep the current behaviour: `numberMatched = all.length`, slice in memory. Log a **one-time** `logger?.warn(...)` per router telling the integrator to implement `countFeatures` to enable database-level pagination.
- Keep the existing limit/offset sanitising (invalid/negative → `defaultLimit` / 0, cap at `maxLimit`). Also guard against non-numeric `options.defaultLimit` / `maxLimit` not needed. Next/prev links must stay correct in both modes.

## 3. Host header poisoning (#7 OGC part, decision D04)
`getRequestBaseUrl` reflects `req.get('host')` into every hypermedia link when `baseUrl` is not absolute.
- Add `trustedHosts?: string[]` to `OgcOptions` (doc comment: list of allowed `Host` header values, e.g. `['api.example.com', 'localhost:3000']`, compared case-insensitively, port included when present).
- Resolution order:
  1. `baseUrl` starts with `http://` or `https://` → always use it verbatim (Host header ignored).
  2. Otherwise take `req.get('host')`; it is usable only if it matches `/^[a-zA-Z0-9.-]+(:\d{1,5})?$/` (or a bracketed IPv6 literal `[::1]:3000`) **and**, when `trustedHosts` is set, is in the allowlist. Usable → `${req.protocol}://${host}${req.baseUrl}`.
  3. Not usable → fall back to a path-relative base: `req.baseUrl` (links become `/ogc/collections/...`). Never reflect the untrusted host.
- At router creation, if `baseUrl` is relative and `trustedHosts` is not set, emit a one-time `logger?.warn` recommending an absolute `baseUrl` or `trustedHosts`.
- Keep this logic internal (do not export helpers from `src/index.ts` besides types).

## 4. Docs
Update `packages/ogc/README.md`: document `trustedHosts`, the new optional `getFeatures` 5th argument + `countFeatures` (with a short Mongo-style example using `.skip(offset).limit(limit)` and `countDocuments`), and the `name` parameter validation.

## 5. Tests
Add a new file `packages/ogc/test/security.test.ts` (vitest + supertest/express, mirror the style of `packages/ogc/test/ogc.test.ts`; check package.json devDependencies for what is available). Cover the acceptance criteria:
- `?name[$ne]=null` → 400, provider not called; `?name=Oak` → provider receives `{ name: 'Oak' }`.
- `?limit=10&offset=20` → pagination-aware provider receives `{ limit: 10, offset: 20 }` as 5th arg, response has ≤ 10 features, `numberMatched` from `countFeatures`, correct next/prev links.
- Legacy provider (no `countFeatures`) still paginates in memory exactly as before; warning logged once.
- Invalid/negative `limit`/`offset` → defaults (`defaultLimit`, 0).
- Absolute `baseUrl: 'https://api.example.com/ogc'` + `Host: attacker.com` → all links start with `https://api.example.com/ogc`.
- Relative `baseUrl` + `trustedHosts: ['api.example.com']` + `Host: attacker.com` → no link contains `attacker.com` (path-relative fallback); `Host: api.example.com` → absolute links on that host.
- Malformed Host header (e.g. `evil.com/x` or `a@b`) without `trustedHosts` → not reflected.
Existing `ogc.test.ts` must stay green (you may edit it only if a test asserts the exact old vulnerable behaviour — explain why in your report).

## Scope (edit ONLY these)
`packages/ogc/**` (src, test, README). Do NOT touch `packages/wfs/**`, root files, package.json versions or lockfiles.

## Done when
`npm test` and `npm run build` pass from repo root; work committed on your branch (`fix(ogc): …`); not pushed.
