# Backward Compatibility Contract: spatial-libs

This document inventories the protected public contract surfaces of the `spatial-libs` monorepo. Automated review skills (`om-code-review`, `om-auto-review-pr`) and implementation agents check changes against this document to protect consuming applications from unexpected breaking changes.

---

## 1. Protected Contract Surfaces

The repository publishes four distinct packages, each exposing public contracts:

```
spatial-libs
├── packages/crs     (@spatial-api/crs-transformer)  -> Core CRS & Coordinate Reprojection Engine
├── packages/ogc     (@spatial-api/ogc)              -> OGC API Features Express Router
├── packages/wfs     (@spatial-api/wfs)              -> Unified WFS (1.0.0 / 1.1.0 / 2.0.0) Dispatcher
└── packages/tester  (@spatial-api/tester)           -> CLI Smoke & Concurrent Stress Tester
```

---

## 2. Package Surface Inventories

### 2.1 `@spatial-api/crs-transformer`

#### Exported Surface
* **Default Export**: `CrsTransformer` (singleton instance of `CrsTransformerClass`).
* **Named Exports**:
  * `CrsTransformer`
  * Interface: `CoordinateTransformer`
  * Interface: `GeoJSONGeometry`
* **Public Method Signatures**:
  * `normalizeSrs(srsName: string): string`
  * `isSupported(srsName: string): boolean`
  * `getSupportedCodes(): string[]`
  * `transformCoordinate(coords: [number, number], fromSrs: string, toSrs: string): [number, number]`
  * `transformGeometry(geometry: GeoJSONGeometry, fromSrs: string, toSrs: string): GeoJSONGeometry`
* **Built-in SRS Registry**:
  * Global: `EPSG:4326`, `EPSG:3857`, `EPSG:900913`, `EPSG:4269`
  * Sweden (SWEREF99): `EPSG:3006` through `EPSG:3018`
  * Poland (PUWG 1992/2000): `EPSG:2180`, `EPSG:2176` through `EPSG:2179`
  * Germany (ETRS89 / DHDN): `EPSG:25832`, `EPSG:25833`, `EPSG:4647`, `EPSG:5648`, `EPSG:31466` through `EPSG:31469`
  * France (Lambert): `EPSG:2154`, `EPSG:27572`
  * Norway (EUREF89 / NTM): `EPSG:25834`, `EPSG:25835`, `EPSG:5105`, `EPSG:5106`, `EPSG:5109`, `EPSG:5122`

#### Breaking Changes
* Removing or modifying any method signature on `CoordinateTransformer`.
* Inverting return axis order from `[lon, lat]` / `[x, y]` to `[lat, lon]`.
* Dropping support for any built-in projection code or local synonym.
* Dropping 3D / elevation coordinate components during geometry transformation.

---

### 2.2 `@spatial-api/ogc`

#### Exported Surface
* **Default Export**: `createOgcRouter(options: OgcOptions): express.Router`
* **Named Exports**: All types and interfaces exported from `./types.js` (`OgcOptions`, `SpatialDataProvider`, `OgcCollectionMetadata`, `OgcFeature`, `OgcFeatureCollection`, etc.).
* **HTTP Route Contract**:
  * `GET /` — Landing page with compliant link relations (`rel="self"`, `rel="service-desc"`, `rel="conformance"`, `rel="data"`).
  * `GET /api` — OpenAPI 3.0 document.
  * `GET /conformance` — Conformance declaration classes.
  * `GET /collections` — Collections listing.
  * `GET /collections/:collectionId` — Single collection metadata.
  * `GET /collections/:collectionId/items` — Feature query endpoint supporting query params: `limit`, `offset`, `bbox`, `bbox-crs`, `crs`, `datetime`, and property filters.
  * `GET /collections/:collectionId/items/:featureId` — Single feature retrieval.
* **Provider Contract (`SpatialDataProvider`)**:
  * `getSupportedTypes(): Promise<string[]> | string[]`
  * `getBoundingBox(type: string): Promise<[number, number, number, number]> | [number, number, number, number]`
  * `getFeatures(params: any): Promise<any>`

#### Breaking Changes
* Modifying route URL patterns or standard query parameter names.
* Altering the GeoJSON envelope (`type: "FeatureCollection"`, `features: []`, `numberMatched`, `numberReturned`).
* Adding required, non-optional methods to `SpatialDataProvider` without backward-compatible defaults.

---

### 2.3 `@spatial-api/wfs`

#### Exported Surface
* **Named Exports**:
  * `dispatchWfsRequest(req: GenericRequest, options: WfsOptions): Promise<GenericResponse>`
  * `handleWfs100(req: GenericRequest, options: WfsOptions): Promise<GenericResponse>`
  * `handleWfs110(req: GenericRequest, options: WfsOptions): Promise<GenericResponse>`
  * `handleWfs200(req: GenericRequest, options: WfsOptions): Promise<GenericResponse>`
  * Types: `WfsOptions`, `GenericRequest`, `GenericResponse`, `SpatialDataProvider`, `WfsVersion`
* **Protocol Operations Handled**:
  * `GetCapabilities` (WFS versions 1.0.0, 1.1.0, 2.0.0, 2.0.2).
  * `DescribeFeatureType`.
  * `GetFeature`.
* **XML Response Envelopes**:
  * WFS 1.0.0: GML 2.1.2 schema compliance, `wfs:WFS_Capabilities`.
  * WFS 1.1.0: GML 3.1.1 schema compliance, `wfs:WFS_Capabilities`, OWS common namespaces.
  * WFS 2.0.0: GML 3.2.1 schema compliance, `wfs:WFS_Capabilities`, FES filter encoding.

#### Breaking Changes
* Modifying the `GenericRequest` or `GenericResponse` interface structure.
* Changing XML namespace prefixes or URI bindings.
* Removing support for any WFS protocol version (1.0.0, 1.1.0, 2.0.0, 2.0.2).
* Breaking schema validity of XML Exception reports (`ServiceExceptionReport` in 1.0.0 vs `ows:ExceptionReport` in 1.1.0/2.0.0).

---

### 2.4 `@spatial-api/tester` CLI

#### Exported Surface
* **CLI Executable Names**: `tester`, `spatial-tester` (via `package.json` `"bin"`).
* **CLI Command-Line Arguments**:
  * Positional target URL: `[target-url]`
  * `--url=<target-url>`
  * `--user=<username>`
  * `--pass=<password>`
  * `--collections=<list>`
  * `--mode=smoke|stress`
  * `--duration=<seconds>`
* **Process Exit Codes**:
  * `0`: Success (all smoke tests passed or stress run concluded).
  * Non-zero: Connection failure, probe error, or failed smoke assertions.

#### Breaking Changes
* Removing or renaming existing CLI flags.
* Inverting or changing process exit code semantics.

---

## 3. Policy for Breaking Changes

When a breaking change to any protected contract surface cannot be avoided:

1. **SemVer Major Bump**: The affected package must increment its major version (`1.x.x` → `2.0.0`).
2. **Deprecation Window**: Deprecated signatures or options must emit a runtime warning (via injected logger or `console.warn`) for at least one minor release cycle prior to removal.
3. **Migration Documentation**: The PR must include detailed upgrade instructions in `UPGRADE.md` or the package README.
4. **Maintainer Approval**: Any PR introducing a breaking contract change is automatically classified as `risk-high` and requires explicit maintainer review and sign-off.
