# Backlogs

## Security and DevOps Audit (2026-10-19)
Backlog source: Security and DevOps Audit (2026-10-19)
Last filed: 2026-10-19

| Id | Issue | Title | Epic | Depends on | Adopted |
|---|---|---|---|---|---|
| E01 | [#1](https://github.com/Exsilium122/spatial-libs/issues/1) | E01 � Epic: Critical Security Hardening & Injection Defenses | � | � | no |
| E01-S01 | [#5](https://github.com/Exsilium122/spatial-libs/issues/5) | E01-S01 � Sanitize MongoDB/NoSQL Query Operators & Property Names in WFS and OGC | #1 | � | no |
| E01-S02 | [#6](https://github.com/Exsilium122/spatial-libs/issues/6) | E01-S02 � Prevent Server Heap Exhaustion (DoS) via Database-Level Feature Pagination | #1 | � | no |
| E01-S03 | [#7](https://github.com/Exsilium122/spatial-libs/issues/7) | E01-S03 � Mitigate Host Header Poisoning and Cache Poisoning in Base URL Generation | #1 | � | no |
| E01-S04 | [#8](https://github.com/Exsilium122/spatial-libs/issues/8) | E01-S04 � Prevent Prototype Pollution in XML Key Normalization (normalizeKeys) | #1 | � | no |
| E02 | [#2](https://github.com/Exsilium122/spatial-libs/issues/2) | E02 � Epic: Dependency & Supply Chain Vulnerability Remediation | � | � | no |
| E02-S01 | [#9](https://github.com/Exsilium122/spatial-libs/issues/9) | E02-S01 � Remove Vulnerable UUID Override and Update Core Dependencies | #2 | � | no |
| E02-S02 | [#10](https://github.com/Exsilium122/spatial-libs/issues/10) | E02-S02 � Upgrade Axios and Consolidate XML Parsers in @spatial-api/tester | #2 | � | no |
| E02-S03 | [#11](https://github.com/Exsilium122/spatial-libs/issues/11) | E02-S03 � Upgrade Vitest and Esbuild DevDependencies to Resolve Tinypool RCE | #2 | � | no |
| E03 | [#3](https://github.com/Exsilium122/spatial-libs/issues/3) | E03 � Epic: DevOps & CI/CD Pipeline Hardening | � | � | no |
| E03-S01 | [#12](https://github.com/Exsilium122/spatial-libs/issues/12) | E03-S01 � Create Automated PR and Main Branch CI Validation Workflow | #3 | � | no |
| E03-S02 | [#13](https://github.com/Exsilium122/spatial-libs/issues/13) | E03-S02 � Secure and Gate NPM Release Workflow (publish.yml) | #3 | #12 | no |
| E03-S03 | [#14](https://github.com/Exsilium122/spatial-libs/issues/14) | E03-S03 � Add Automated Test Suite for @spatial-api/tester CLI | #3 | � | no |
| E04 | [#4](https://github.com/Exsilium122/spatial-libs/issues/4) | E04 � Epic: Spatial Protocol Integrity & Error Handling | � | � | no |
| E04-S01 | [#15](https://github.com/Exsilium122/spatial-libs/issues/15) | E04-S01 � Fix Native WGS84 BBOX Filter Omission in @spatial-api/ogc | #4 | � | no |
| E04-S02 | [#16](https://github.com/Exsilium122/spatial-libs/issues/16) | E04-S02 � Support 3D GeoJSON Coordinates in CrsTransformer Reprojection | #4 | � | no |
| E04-S03 | [#17](https://github.com/Exsilium122/spatial-libs/issues/17) | E04-S03 � Sanitize Internal Exception Messages in WFS XML Error Responses | #4 | � | no |

## Spatial-api 2.0 provider contract (Spec 1)
Backlog source: .ai/specs/2026-10-20-spatial-api-2-provider-contract.md
Last filed: 2026-10-20

| Id | Issue | Title | Epic | Depends on | Adopted |
|---|---|---|---|---|---|
| E05 | [#24](https://github.com/Exsilium122/spatial-libs/issues/24) | E05 — Epic: Spatial-api 2.0 provider contract (@spatial-api/core, wfs/ogc/crs 2.0) | — | — | no |
| E05-S01 | [#40](https://github.com/Exsilium122/spatial-libs/issues/40) | E05-S01 — Core scaffold: contract types, errors, validateProvider, logger, next-tag publish gating | #24 | epic E (cezar 1f6ea890) | no |
| E05-S02 | [#41](https://github.com/Exsilium122/spatial-libs/issues/41) | E05-S02 — Filter tree: CQL2-JSON profile, exact in-memory evaluator, splitter, query pipeline | #24 | #40 | no |
| E05-S03 | [#42](https://github.com/Exsilium122/spatial-libs/issues/42) | E05-S03 — Memory reference provider, fromSingleOperations, FeatureEncoder type and provider conformance kit | #24 | #41 | no |
| E05-S04 | [#43](https://github.com/Exsilium122/spatial-libs/issues/43) | E05-S04 — @spatial-api/crs-transformer 2.0 on core | #24 | #40 | no |
| E05-S05 | [#44](https://github.com/Exsilium122/spatial-libs/issues/44) | E05-S05 — @spatial-api/wfs 2.0: filter tree, createWfsService, raw XML POST, no Express | #24 | #42, #43 | no |
| E05-S06 | [#45](https://github.com/Exsilium122/spatial-libs/issues/45) | E05-S06 — @spatial-api/ogc 2.0: createOgcService, describeCollections, no Express | #24 | #42, #43 | no |
| E05-S07 | [#46](https://github.com/Exsilium122/spatial-libs/issues/46) | E05-S07 — 2.0 migration guide, READMEs, standards catalogue and release readiness | #24 | #44, #45 | no |

## Spatial-api 2.0 registry, extensions & host (Spec 2)
Backlog source: .ai/specs/2026-10-20-spatial-api-2-registry-and-host.md
Last filed: 2026-10-20

| Id | Issue | Title | Epic | Depends on | Adopted |
|---|---|---|---|---|---|
| E06 | [#25](https://github.com/Exsilium122/spatial-libs/issues/25) | E06 — Epic: Spatial-api 2.0 registry, extensions & Express host | — | #24 | no |
| E06-S01 | [#47](https://github.com/Exsilium122/spatial-libs/issues/47) | E06-S01 — Registry in core, built-in geojson/geojsonseq encoders, packages self-register | #25 | #46 | no |
| E06-S02 | [#48](https://github.com/Exsilium122/spatial-libs/issues/48) | E06-S02 — Extension points in wfs and ogc (WfsExtension / OgcExtension) | #25 | #47 | no |
| E06-S03 | [#49](https://github.com/Exsilium122/spatial-libs/issues/49) | E06-S03 — @spatial-api/server: mount planning, resolvers, base URL, logging | #25 | #47, #48 | no |
| E06-S04 | [#50](https://github.com/Exsilium122/spatial-libs/issues/50) | E06-S04 — Landing page (JSON + HTML with allowed parameters) and opt-in export endpoint | #25 | #49 | no |
| E06-S05 | [#51](https://github.com/Exsilium122/spatial-libs/issues/51) | E06-S05 — @spatial-api/express adapter (Express 4 and 5) | #25 | #49 | no |
| E06-S06 | [#52](https://github.com/Exsilium122/spatial-libs/issues/52) | E06-S06 — All suites through the host, package docs, 2.0.0 release | #25 | #50, #51 | no |

## Spatial-api 2.0 programme packages (brief)
Backlog source: .ai/specs/briefs/2026-10-20-spatial-api-2-provider-contract.md
Last filed: 2026-10-20

| Id | Issue | Title | Epic | Depends on | Adopted |
|---|---|---|---|---|---|
| E07 | [#26](https://github.com/Exsilium122/spatial-libs/issues/26) | E07 — Epic: WFS-T — transactional WFS (wfs-t) | — | — | no |
| E08 | [#27](https://github.com/Exsilium122/spatial-libs/issues/27) | E08 — Epic: OGC API – Features Part 4 — create/replace/update/delete (ogc-t) | — | — | no |
| E09 | [#28](https://github.com/Exsilium122/spatial-libs/issues/28) | E09 — Epic: OGC API – Features Part 3 — Filtering / CQL2 (ogc-part3) | — | — | no |
| E10 | [#29](https://github.com/Exsilium122/spatial-libs/issues/29) | E10 — Epic: OGC API – Features Part 5 — Schemas / queryables (ogc-part5) | — | — | no |
| E11 | [#30](https://github.com/Exsilium122/spatial-libs/issues/30) | E11 — Epic: Shapefile encoder (format-shapefile) | — | — | no |
| E12 | [#31](https://github.com/Exsilium122/spatial-libs/issues/31) | E12 — Epic: GeoPackage encoder (format-geopackage) | — | — | no |
| E13 | [#32](https://github.com/Exsilium122/spatial-libs/issues/32) | E13 — Epic: KML + KMZ encoder (format-kml) | — | — | no |
| E14 | [#33](https://github.com/Exsilium122/spatial-libs/issues/33) | E14 — Epic: FlatGeobuf encoder (format-flatgeobuf) | — | — | no |
| E15 | [#34](https://github.com/Exsilium122/spatial-libs/issues/34) | E15 — Epic: CSV + WKT encoder (format-csv-wkt) | — | — | no |
| E16 | [#35](https://github.com/Exsilium122/spatial-libs/issues/35) | E16 — Epic: DXF encoder for CAD users (format-dxf, export only) | — | — | no |
| E17 | [#36](https://github.com/Exsilium122/spatial-libs/issues/36) | E17 — Epic: GPX encoder (format-gpx) | — | — | no |
| E18 | [#37](https://github.com/Exsilium122/spatial-libs/issues/37) | E18 — Epic: Standalone GML encoder (format-gml) | — | — | no |
| E19 | [#38](https://github.com/Exsilium122/spatial-libs/issues/38) | E19 — Epic: WFS locking — LockFeature / GetFeatureWithLock (wfs-locking, later) | — | — | no |
| E20 | [#39](https://github.com/Exsilium122/spatial-libs/issues/39) | E20 — Epic: Database-wrapper provider packages (later) | — | — | no |
| E07-S01 | [#53](https://github.com/Exsilium122/spatial-libs/issues/53) | E07-S01 — Spec written and approved: @spatial-api/wfs-t | #26 | — | no |
| E08-S01 | [#54](https://github.com/Exsilium122/spatial-libs/issues/54) | E08-S01 — Spec written and approved: @spatial-api/ogc-t | #27 | — | no |
| E09-S01 | [#55](https://github.com/Exsilium122/spatial-libs/issues/55) | E09-S01 — Spec written and approved: @spatial-api/ogc-part3 | #28 | — | no |
| E10-S01 | [#56](https://github.com/Exsilium122/spatial-libs/issues/56) | E10-S01 — Spec written and approved: @spatial-api/ogc-part5 | #29 | — | no |
| E11-S01 | [#57](https://github.com/Exsilium122/spatial-libs/issues/57) | E11-S01 — Spec written and approved: @spatial-api/format-shapefile | #30 | — | no |
| E12-S01 | [#58](https://github.com/Exsilium122/spatial-libs/issues/58) | E12-S01 — Spec written and approved: @spatial-api/format-geopackage | #31 | — | no |
| E13-S01 | [#59](https://github.com/Exsilium122/spatial-libs/issues/59) | E13-S01 — Spec written and approved: @spatial-api/format-kml | #32 | — | no |
| E14-S01 | [#60](https://github.com/Exsilium122/spatial-libs/issues/60) | E14-S01 — Spec written and approved: @spatial-api/format-flatgeobuf | #33 | — | no |
| E15-S01 | [#61](https://github.com/Exsilium122/spatial-libs/issues/61) | E15-S01 — Spec written and approved: @spatial-api/format-csv-wkt | #34 | — | no |
| E16-S01 | [#62](https://github.com/Exsilium122/spatial-libs/issues/62) | E16-S01 — Spec written and approved: @spatial-api/format-dxf | #35 | — | no |
| E17-S01 | [#63](https://github.com/Exsilium122/spatial-libs/issues/63) | E17-S01 — Spec written and approved: @spatial-api/format-gpx | #36 | — | no |
| E18-S01 | [#64](https://github.com/Exsilium122/spatial-libs/issues/64) | E18-S01 — Spec written and approved: @spatial-api/format-gml | #37 | — | no |
| E19-S01 | [#65](https://github.com/Exsilium122/spatial-libs/issues/65) | E19-S01 — Spec written and approved: @spatial-api/wfs-locking | #38 | — | no |
| E20-S01 | [#66](https://github.com/Exsilium122/spatial-libs/issues/66) | E20-S01 — Spec written and approved: @spatial-api/provider-postgres / provider-mongodb | #39 | — | no |
