# Code Review Guidelines: spatial-libs

This document defines the code-review standards and automated review gates for the `spatial-libs` monorepo. Every PR is evaluated against these rules by human reviewers and the `om-code-review` / `om-auto-review-pr` skills.

---

## 1. Review Priorities

Reviewers assess incoming changes against four core pillars, in descending order of priority:

1. **Correctness & Spatial Integrity**: Mathematical precision in coordinate reprojection, adherence to OGC API Features and WFS (v1.0.0, v1.1.0, v2.0.0) protocol specifications, and preservation of geometry integrity across CRS conversions.
2. **Security & Input Sanitization**: Defenses against prototype pollution, XML injection / entity expansion, query operator injection, and information leakage in exception XMLs.
3. **Public Contract Stability**: Strict minimalism in package exports (`packages/*/src/index.ts`) and zero unversioned breaking changes to public APIs, HTTP routes, or CLI flags.
4. **Build & Package Hygiene**: Clean compilation to `dist/`, dual ESM/CJS outputs with TypeScript declaration maps, and exclusion of test suites/internal assets from npm distributions.

---

## 2. Repo-Specific Architecture Checks

### 2.1 Public API Boundary Control
* **Internal Helper Isolation**: Internal utilities, XML builders, and validators (such as `verifyProvider`, `verifyTransformer`, `verifyLogger`, `parseFilterString`, `normalizeKeys`, and internal XML parsers) **must never** be re-exported in package entrypoints (`packages/*/src/index.ts`).
* **High-Level Dispatchers Only**: Only expose clean, framework-agnostic orchestrators and routers:
  * `@spatial-api/crs-transformer`: `CrsTransformer`, `CoordinateTransformer`, `GeoJSONGeometry`.
  * `@spatial-api/ogc`: `createOgcRouter`, `SpatialDataProvider`, and associated TypeScript interfaces.
  * `@spatial-api/wfs`: `dispatchWfsRequest`, `handleWfs100`, `handleWfs110`, `handleWfs200`, and options/types.
  * `@spatial-api/tester`: CLI entrypoint binary scripts (`tester`, `spatial-tester`).
* **Black-Box Testing**: Validate internal helper behaviors through top-level router/dispatcher test cases rather than testing private methods directly.

### 2.2 XML Parsing, Serialization & Security Hardening
* **XML Parser Consolidation**: Consolidate XML parsing and building on `fast-xml-parser` (version `5.8.0` or later).
* **CVE-2026-41650 Compliance**: Never downgrade `fast-xml-parser` below version `5.7.0` (prevents CDATA and comment delimiter injection vulnerabilities).
* **Prototype Pollution Guard**: Any function traversing or normalizing XML keys (such as `normalizeKeys`) must explicitly reject or sanitize `__proto__`, `constructor`, and `prototype` keys before mutating objects.
* **Error Sanitization**: WFS XML `ExceptionReport` responses and OGC JSON error payloads must never leak database connection strings, file paths, raw SQL/NoSQL queries, or internal stack traces to clients.

### 2.3 Spatial Protocol & Geometry Correctness
* **Coordinate Axis Ordering**: Be vigilant about axis order differences between CRS definitions (e.g. EPSG:4326 lat/long vs CRS84 long/lat, SWEREF99 TM x/y). Ensure bbox and coordinate transformations preserve expected client axes.
* **Multi-Dimensional Coordinates**: Reprojection via `CrsTransformer.transformGeometry()` must support both 2D `[x, y]` and 3D `[x, y, z]` coordinates without truncating elevation or M values.
* **WFS Version Negotiation**: Verify that `dispatchWfsRequest` respects `AcceptVersions`, explicit `version` query parameters, and XML root element attributes, falling back gracefully to supported versions.
* **OGC API Features Conformance**:
  * Landing page (`/`), Conformance (`/conformance`), and Collections (`/collections`) must return valid link relations (`rel="self"`, `rel="service-desc"`, `rel="conformance"`, `rel="items"`).
  * Feature responses must adhere to GeoJSON standards (`type: "FeatureCollection"`, `features: [...]`).

### 2.4 Monorepo Build & Distribution Hygiene
* **Validation Gate**: Every pull request must pass the full validation gate from the repository root:
  1. `npm test` (executes Vitest across all workspace packages).
  2. `npm run build` (executes TypeScript declaration generation and esbuild bundling for ESM and CJS).
* **npm Distribution Filter**: Ensure `package.json` in each package contains `"files": ["dist"]` so that source files, tests, and scratch assets are excluded from npm publishing.

---

## 3. Findings Severity Guidance

Review comments and automated review passes categorize issues into three severity tiers:

### 🚨 Blocker (Must fix before merge)
* Any regression that breaks the validation gate (`npm test` or `npm run build`).
* Prototype pollution vulnerabilities or unescaped XML/NoSQL injection risks.
* Downgrading security dependencies (`fast-xml-parser < 5.7.0`).
* Leaking private internal helpers into public package exports (`src/index.ts`).
* Breaking backward compatibility on protected contract surfaces without major versioning or maintainer sign-off.
* Axis inversion bugs that corrupt spatial geometry coordinates.

### ⚠️ Major (Must address or explicitly justify)
* Missing unit or integration tests for new spatial endpoints or protocol handlers.
* Unhandled geometry edge cases (e.g., GeometryCollection, multi-polygons with holes, 3D coordinates).
* Non-standard error codes or invalid WFS Exception XML formatting.
* Inefficient in-memory feature array manipulation instead of provider pagination.

### 💡 Minor (Advisory / Non-blocking)
* Code readability, variable naming, and internal refactoring opportunities.
* Documentation, JSDoc comment improvements, or README updates.
* Benchmark script formatting in `@spatial-api/tester`.
