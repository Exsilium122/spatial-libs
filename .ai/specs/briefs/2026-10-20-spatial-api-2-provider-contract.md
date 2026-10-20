# Spatial-api 2.0 provider contract: shared provider, filter tree, capabilities, conformance kit, framework-agnostic wfs/ogc

- Date: 2026-10-20
- Category: feature
- Priority signal: high — every planned protocol and format package (roadmap A, B, C) builds on this contract; nothing else can start before it
- Risk signal: high — deliberate 2.0 clean break of the published `@spatial-api/ogc` and `@spatial-api/wfs` provider interfaces, with no compatibility shim
- Routing: Next: om-spec-writing "Spatial-api 2.0 provider contract: shared provider, filter tree, capabilities, conformance kit, framework-agnostic wfs/ogc — brief: .ai/specs/briefs/2026-10-20-spatial-api-2-provider-contract.md"

## Problem

The goal is to grow spatial-libs into a more complete open-standards toolkit. New protocols and export formats will ship as optional sub-libraries, all sharing one way of accessing data. The codebase cannot support that today:
- `packages/ogc/src/types.ts` and `packages/wfs/src/types.ts` each define their own `SpatialDataProvider`, and the two have diverged. Only ogc has `countFeatures`, paging options and `getCollectionsMetadata`. Only wfs has `getPropertiesSchema`. `Logger`, `BoundingBox`, `GeoJSONFeature` and `CoordinateTransformer` are duplicated.
- The filter passed to providers is typed `any` and is effectively a MongoDB query dict. For example, `filterQuery['geo.coordinates']` is built in `packages/wfs/src/v1_0_0.ts:275`, and in the v1_1_0 and v2_0_0 handlers too.
- `@spatial-api/ogc` exports only an Express router (`createOgcRouter`), and both packages have `express` as a peer dependency.

A provider author therefore has to know which protocol calls them and how. The goal: one well-written provider supports every protocol in the suite, and users are never responsible for compatibility between packages.

## Programme (this brief seeds all of it; this routing starts Spec 1)

Prerequisite: epic **E**, closing all `[GAP]` tests listed in `docs/standards/README.md`, must be merged first. It is in progress in cezar task `1f6ea890-937b-4827-b70c-0917c94c6a43` (branch `cez/1f6ea890`). All 2.0 work builds on top of it.

1. **Spec 1 — Provider contract** (this handoff). Shared contract package, typed parameter objects, protocol-neutral filter tree, capability declaration and startup validation, provider conformance kit, write contract, logging contract. Also: migrate `wfs` and `ogc` to 2.0 on top of it as framework-agnostic dispatchers.
2. **Spec 2 — Registry and host.** Self-registration registry, the extension model, the `@spatial-api/express` host package, mounting rules, the landing page. Write it after Spec 1.
3. **One detailed spec per package**, each written as the first story of its epic:
   - **A, write path:** `wfs-t` (WFS Transaction for 1.0, 1.1 and 2.0); `ogc-features-part4` (Create/Replace/Update/Delete); later, a separate epic for `wfs-locking` (LockFeature, GetFeatureWithLock).
   - **B, richer reads:** `ogc-features-part3` (Filtering / CQL2); `ogc-features-part5` (Schemas / queryables).
   - **C, encodings:** `format-shapefile`, `format-geopackage`, `format-kml` (KML + KMZ), `format-flatgeobuf`, `format-csv-wkt`, `format-dxf` (export only, for CAD users), `format-gpx`, `format-gml` (standalone, reusing the WFS writer). GeoJSON and GeoJSONSeq (RFC 8142) are built into core (Spec 2).
   - **Later:** optional database-wrapper provider packages.
4. The backlog is filed from the specs' Phasing with `om-backlog`.

Every protocol and format task is made of these parts:
- Download the official standard documents.
- Write an extensive conformance test suite, one test per requirement, following the existing pattern in `docs/standards/README.md`, so the implementation conforms strictly.
- Write tests proving the package plugs into the rest of the ecosystem.
- Create or update the documentation.
- Make the package publishable to npm (`"files": ["dist"]`, gated publish).

Documentation also needs a catalogue of all candidate standards. Raster services (WMS, WMTS, OGC API Tiles / MVT) and a far-future image stitching/splitting cache proxy are listed there as future work only.

## Agreed direction

Build a shared contract package (name to be decided; placeholder `@spatial-api/provider`). It holds one `SpatialDataProvider`, split into small capability interfaces: core reads, count/paging, schema/queryables, filter handling, transactions and, later, locking. It also holds the shared types and the provider conformance kit. Release `wfs` and `ogc` as 2.0 on top of it.

**Why "build nothing" lost:** the driver is completeness of the toolkit. Closing the gaps (E) is already happening and does not grow the toolkit. Without a shared contract, every new protocol and format would multiply the divergence that already exists.

Alternatives explicitly rejected:
- An adapter shim for 1.x providers. The user chose a clean break.
- Scanning `node_modules` for discovery, and probing known package names. The user chose import side-effect registration.
- An umbrella host that owns every protocol.
- Query-parameter routing.
- GeoParquet.
- Raster research.

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Driver | Making the suite a more complete standards toolkit. There is no single consumer. |
| Roadmap | Shared contract first, then A (write path), then B (richer reads), then C (encodings). E is a prerequisite. |
| 1.x consumers | 2.0 major, clean break, migration guide, no adapter shim. |
| Format scope (C) | Shapefile, GeoPackage, KML (+ KMZ), FlatGeobuf, CSV + WKT, DXF (export only), GPX, GML standalone. GeoJSONSeq (RFC 8142) is a core encoder. The standalone `export` endpoint is **opt-in** (`enableExport: true` or listed in `protocols`), because it allows bulk downloads. |
| Packaging | Every protocol, extension and format is an optional npm package; the user decides what to install. Monorepo releases in lockstep: all packages share one major version. |
| Provider method shape | Typed, protocol-neutral parameter objects, e.g. `getFeatures({ collection, ids, filter, bbox, limit, offset, crs, properties })`. Providers never receive the raw request and never know which protocol called them. `params.context` is an escape hatch for advanced, protocol-specific needs: protocol id and version, user, vendor parameters. |
| Query parameters | The server never routes or selects providers by query parameters. Where a protocol allows vendor parameters, they reach the provider through `context`, and the provider author interprets them. OGC API `/req/core/query-param-unknown` needs a way for a provider or protocol to declare the extra parameters it accepts, so they appear in the OpenAPI document instead of being answered with 400. |
| Filter model | The foundation (Spec 1) owns a typed, protocol-neutral filter tree: comparison, logical, spatial, temporal and id filters. Filter Encoding 1.0/1.1/2.0 converts into it now, and CQL2 (Part 3) later, without another breaking change. A capability declares whether the provider handles a filter natively; otherwise the library filters in memory. Reference translators (SQL/Mongo) belong to the later database-wrapper epic. |
| Capabilities | Providers declare their capabilities. Each library validates at startup what it needs: a missing required capability throws, and a missing optional one falls back. Protocols advertise only what the provider and the registered formats can actually do. |
| Conformance kit | Published with the contract. A provider author runs it against their provider and gets pass/fail per capability, including that whatever is advertised actually works and that an unauthorised write is rejected. |
| Framework coupling | Protocol packages expose only framework-agnostic dispatchers. Extract a dispatcher for OGC (today it has only `createOgcRouter`). Move the Express routers out of `wfs`/`ogc` into the host package, and drop the `express` peer dependency from protocol packages. Part of the 2.0 break. |
| Writes | A single atomic batch method, `transaction(params)`. OGC API Part 4 single-feature operations are one-operation batches. The library is database-agnostic, so atomicity is the provider's responsibility. Capability `atomicWrites: true \| false`. WFS 1.0 may report `PARTIAL`. On WFS 1.1/2.0 a non-atomic provider gets a startup warning and documented non-conformance. A generic helper `fromSingleOperations({ insert, update, delete, begin?, commit?, rollback? })` in the contract package has no database dependency. Database wrapper packages come later, with drivers as optional peer dependencies. Note for the docs: MongoDB transactions need a replica set. |
| Authorization | The provider's responsibility, via `context.user`. The library never enforces it. |
| Locking | WFS LockFeature / GetFeatureWithLock is a later, separate epic, with an optional lock-store capability. WFS 2.0 lets Transactional ship without Locking. |
| Logging | Logging is the host's or library's job, **never the provider's**. A `logger` option goes on the host factory and on every protocol entrypoint. The default is `console` with a `[spatial-api]` prefix; `logger: false` silences it. After the provider is attached and its capabilities are validated, log one `info` line per mount: protocol and versions, full path, extensions, formats, optional provider `name`. Capability findings (non-atomic writes, in-memory filter fallback) are logged as `warn`. A failed gate throws and does not log. |
| Discovery (Spec 2) | Import side effect, e.g. `import '@spatial-api/format-kml'`. The registry lives on a `globalThis` symbol in the contract package and fails loudly when two incompatible copies register. Packages declare registration entries in `sideEffects` so tree-shaking keeps them. |
| Mounting without host (Spec 2) | The user wires providers into each protocol's dispatcher and mounts it. |
| Host factory (Spec 2) | Optional `@spatial-api/express`. Placeholder `createSpatialRouter(providerOrConfig, options?)`. `createSpatialRouter(prov, { enableWriteProtocols: true })` ≡ `createSpatialRouter({ provider: prov, enableWriteProtocols: true })`. The user mounts the returned router at their own path. |
| Mounting precedence (Spec 2) | **With a default `provider`:** every installed protocol except those configured in `protocols` is mounted on its default path with that provider. Protocols listed in `protocols` are mounted only according to their own config. **Without a default `provider`:** only the `protocols` entries are mounted. `protocols` is keyed by registered protocol id. A value is a provider, `{ provider, path }`, an array of these (several endpoints of the same protocol, e.g. different databases), or `false` (do not mount an installed protocol). |
| Per-request providers (Spec 2) | A mount accepts a provider resolver `(ctx) => provider` instead of an instance. Path params such as `':tenant/wfs'` support multiple tenants or databases uniformly for every protocol. |
| Write protocols (Spec 2) | `enableWriteProtocols` has three states. **Unset:** read protocols plus any protocol explicitly configured in `protocols`, so the user can turn on a single write protocol. **`true`:** write protocols are auto-mounted too. **`false`:** kill switch; a write protocol listed in `protocols` throws at startup. |
| Extensions (Spec 2) | Extensions (`wfs-t`, `ogc-features-part3/4/5`, `wfs-locking`) have a regular dependency on their base protocol package, so installing an extension installs its base. Formats depend only on the contract package. `wfs` and `wfs-t` are separate config keys. A `wfs` mount is always pure WFS even when `wfs-t` is installed. Two gates: configuration decides what is exposed, and provider capabilities are validated at startup (a `wfs-t` mount with a non-writing provider throws and never degrades silently). Several `wfs` and `wfs-t` endpoints may coexist. |
| Advertising | No cross-protocol capabilities document exists in any standard. Each protocol uses its own mechanism: WFS GetCapabilities (Transaction is an operation inside it); OGC API landing page, `/conformance`, OpenAPI and queryables. Formats appear inside their host protocol's advertising: WFS `outputFormat` lists, OGC `f=`/media types and links. |
| Landing page (Spec 2) | The host has an optional, disableable JSON index at its root listing every mount and its entry URL. It is explicitly non-standard. |
| Spec authoring mode | Co-designed with the user. The user may give the author a free hand partway through. |

## Non-goals

- Raster services (WMS, WMTS, Tiles/MVT) and the image-cache proxy: listed in the docs catalogue only. No research, no specs.
- GeoParquet, OGC API Records/CSW, SensorThings, EDR: listed in the docs catalogue only.
- DWG (proprietary; implementations are the paid ODA SDK or GPL-3.0 LibreDWG), DGN, IFC, CityGML/CityJSON, MapInfo MIF/MID, SpatiaLite, OSM XML/PBF, Esri File Geodatabase, TopoJSON: listed in the docs catalogue only, with the reason.
- Any compatibility shim or adapter for 1.x providers.
- Routing or selecting providers by query parameters.
- Universal database transactions inside the library. Atomicity belongs to the provider.
- Implementing registry, host or protocol extensions inside Spec 1. Those belong to Spec 2 and the per-package specs.
- Starting implementation before epic E is merged.

## Affected areas (if known)

- `packages/ogc/src/types.ts`, `packages/wfs/src/types.ts`: duplicated and diverged provider interfaces, to be replaced by the shared contract.
- `packages/ogc/src/index.ts` (`createOgcRouter`, `verifyProvider`): Express-only, so a dispatcher is needed.
- `packages/wfs/src/index.ts` (`dispatchWfsRequest`, `createWfsRouter`, `verifyProvider`): the router moves to the host.
- `packages/wfs/src/v1_0_0.ts`, `v1_1_0.ts`, `v2_0_0.ts`, `filterParser.ts`: Mongo-style `filterQuery` construction, to be replaced by the filter tree.
- `packages/crs`: `CoordinateTransformer` moves into, or is re-exported from, the shared contract types.
- `docs/standards/README.md`, `BACKWARD_COMPATIBILITY.md`, package READMEs, `AGENTS.md` package list: 2.0 contract, migration guide, standards catalogue.
