# Standards conformance

The spatial protocols implemented in this monorepo are specified by OGC standards and IETF RFCs.
Each one has a conformance suite under `packages/*/test/conformance/`: one test per requirement or
normative clause, named by its identifier (e.g. `/req/core/fc-limit-response-1 A`, `WFS 2.0 §7.6.3.5`),
and driven over HTTP against a real Express server where the standard describes a web service.

| Standard | Version / document | Package | Suite |
|---|---|---|---|
| [OGC API – Features – Part 1: Core](https://docs.ogc.org/is/17-069r4/17-069r4.html) | 1.0.1, OGC 17-069r4 (Core, GeoJSON, OpenAPI 3.0 classes) | `ogc` | `ogcapi-features-1-core.test.ts` |
| [OGC API – Features – Part 2: CRS by Reference](https://docs.ogc.org/is/18-058r1/18-058r1.html) | 1.0.1, OGC 18-058r1 | `ogc` | `ogcapi-features-2-crs.test.ts` |
| [RFC 7946 – The GeoJSON Format](https://www.rfc-editor.org/rfc/rfc7946) | August 2016 | `ogc`, `crs` | `rfc7946-geojson.test.ts` (both) |
| [Web Feature Service 1.0.0](https://docs.ogc.org/sap/02-058/02-058.pdf) | OGC 02-058 | `wfs` | `wfs-1.0.0.test.ts` |
| [Web Feature Service 1.1.0](https://docs.ogc.org/is/04-094/04-094.pdf) | OGC 04-094 | `wfs` | `wfs-1.1.0.test.ts` |
| [Web Feature Service 2.0.2](https://docs.ogc.org/is/09-025r2/09-025r2.html) | OGC 09-025r2 / ISO 19142 | `wfs` | `wfs-2.0.test.ts` |
| Filter Encoding [1.0](https://docs.ogc.org/is/02-059/02-059.zip), [1.1](https://docs.ogc.org/is/04-095/04-095.pdf), [2.0.2](https://docs.ogc.org/is/09-026r2/09-026r2.html) | OGC 02-059, 04-095, 09-026r2 | `wfs` | `filter-encoding.test.ts` |
| OGC CRS identifiers (URN/URI forms) | as required by WFS 2.0 §7.9.2.4.4.1, OGC 18-058r1 `/req/crs/crs-uri`, WFS 1.0/1.1 | `crs` | `ogc-crs-identifiers.test.ts` |

The `tester` package is a client of these same protocols; it is covered end to end against the
in-repo OGC and WFS servers by `packages/tester/test/e2e.test.ts`, not by a separate suite.

## Known gaps

Requirements the libraries do not meet yet are written as tests that state what the standard
requires, declared with `gap()` and titled `[GAP] …`. By default they run as `it.fails`, so the
suite stays green while the gap is documented; when a gap is closed its test starts failing and
must be promoted to a regular `it`. To see the actual non-conformance of every gap:

```sh
CONFORMANCE_STRICT=1 npm test
```

Status on 2026-10-19 (190 requirement tests passing, 77 documented gaps):

| Suite | Passing | Gaps |
|---|---:|---:|
| OGC API Features Part 1 | 41 | 17 |
| OGC API Features Part 2 | 14 | 5 |
| RFC 7946 (ogc output) | 12 | 2 |
| RFC 7946 (crs transformer) | 15 | 0 |
| OGC CRS identifiers | 18 | 3 |
| WFS 1.0.0 | 20 | 12 |
| WFS 1.1.0 | 19 | 7 |
| WFS 2.0.2 | 30 | 21 |
| Filter Encoding | 21 | 10 |

### OGC API – Features (`@spatial-api/ogc`)
- **Single feature resource** `/collections/{id}/items/{featureId}` is not implemented (`/req/core/f-op`, `f-success`, `f-links`, `/req/geojson/content B`, Part 2 `crs` on features).
- **Parameter validation** — invalid `limit` (0, negative, non-integer) and malformed `datetime` are silently ignored instead of answered with 400 (`/req/core/query-param-invalid`); unknown parameters are neither rejected nor declared free-form in the API definition (`query-param-unknown`). `security.test.ts` currently asserts the lenient `limit` behaviour; update it when closing this gap.
- **bbox** — six-number (3D) boxes are rejected, anti-meridian boxes (west > east) select the wrong side of the globe, and latitudes beyond ±90 are accepted.
- **Collection metadata** — `/collections/{id}` description differs from the `/collections` entry (`/req/core/sfc-md-success B`); storage CRS is published as `storageCRS` instead of `storageCrs`.
- **CRS (Part 2)** — no `Content-Crs` response header; `EPSG/0/4326` is served and read in lon/lat order although that CRS is lat/lon.
- **OpenAPI** — no `service-doc` (HTML) link and the definition does not document `/collections/{collectionId}` or `/items`.
- **GeoJSON** — a `GeometryCollection` loses its `geometries`; a feature without geometry gets `{"type":"Point","coordinates":[]}` instead of `"geometry": null`.

### CRS identifiers (`@spatial-api/crs-transformer`)
- Versioned identifiers (`urn:ogc:def:crs:EPSG:6.3:3006`, `urn:x-ogc:def:crs:EPSG:6.11:4326`, `http://www.opengis.net/def/crs/EPSG/9.9.1/3006`) resolve to the version number (`EPSG:6`) or are not recognised.

### WFS (`@spatial-api/wfs`)
- **Exceptions** — codes are numeric (`300`, `301`, `400`) instead of the OWS/WFS codes (`MissingParameterValue`, `OperationNotSupported`, `OperationProcessingFailed`, `InvalidParameterValue`); WFS 1.1 uses the 1.0 `ServiceExceptionReport` shape; the 1.0 report points at the 1.1 schema; HTTP status is always 400.
- **Version negotiation** — unknown versions fall back to 1.0.0 instead of following the OGC rules; `AcceptVersions=2.0.0` answers 2.0.2; no `VersionNegotiationFailed`.
- **Mandatory parameters** — missing/wrong `SERVICE` and missing `VERSION` are accepted; unknown type names are passed to the provider.
- **Presentation** — `MAXFEATURES` / `COUNT`, `STARTINDEX`, `RESULTTYPE=hits`, `PROPERTYNAME` and `SORTBY` are ignored; no `timeStamp`, no `numberOfFeatures` (1.1), no application schema in `xsi:schemaLocation` (2.0).
- **Selection** — `RESOURCEID` (2.0 KVP) is ignored; `FEATUREID` without `TYPENAME` is rejected; `DescribeFeatureType` without (or with several) type names fails.
- **Stored queries** — the mandatory `GetFeatureById` stored query and `ListStoredQueries` are not implemented (required for the Simple WFS conformance class).
- **BBOX axis order** — decided by the magnitude of the values instead of the CRS: an unsuffixed 2.0 BBOX is read lon/lat although the advertised default CRS is lat/lon, and unambiguous lon/lat boxes such as `50,10,52,12` are swapped (1.0, 1.1); inverted boxes are silently normalised instead of rejected (1.0).
- **Capabilities / encoding** — WFS 2.0 feature types use `DefaultSRS`/`OtherSRS` (1.1 names) outside the `wfs` namespace instead of `wfs:DefaultCRS`/`wfs:OtherCRS`; the WFS 1.0 `FeatureCollection` root is not in the WFS namespace; WFS 1.0 does not advertise HTTP GET for `GetFeature`.
- **Filter Encoding** — `fes:ValueReference` (FES 2.0) is ignored, so FES 2.0 comparison filters match everything; `PropertyIsBetween` and `PropertyIsNull` are silently dropped; `PropertyIsLike` ignores `wildCard`/`singleChar`/`escape(Char)` and is always case-insensitive; `matchCase` is ignored; `gml:Envelope` BBOX operands are ignored; namespace-qualified property names (`ns:name`) are rejected.

## Out of scope / not claimed

- OGC API Features HTML, GML SF0 and GML SF2 requirements classes are not declared in `/conformance` and are not tested (the suite asserts they are not claimed).
- WFS Transaction, locking (`LockFeature`, `GetFeatureWithLock`), `GetPropertyValue`, joins, stored-query management and SOAP are not implemented; only the error response for an unsupported operation is tested.
- Spatial filter operators other than `BBOX` (FES Minimum Spatial Filter) are not implemented and not tested.
- RFC 7946 §3.1.1 recommends not extending positions beyond three elements; `CrsTransformer` deliberately preserves extra ordinates (e.g. measures) through reprojection (#16).
- KVP parameter **values** are matched case-insensitively for `REQUEST` (WFS §13.2.1 says values are case sensitive); the server accepts them leniently, which is not treated as a gap.

## Sources

The standards were retrieved from docs.ogc.org and rfc-editor.org on 2026-10-19. They are referenced
by URL rather than vendored. Requirement texts are paraphrased in test names; consult the linked
documents for the normative wording.
