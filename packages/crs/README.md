# @spatial-api/crs-transformer

A lightweight, high-performance coordinate reference system (CRS) translation and reprojection library using **Proj4** and a preloaded dictionary of standard and regional projections.

Part of the **[@spatial-api/spatial-libs](https://github.com/Exsilium122/spatial-libs)** monorepo suite.

[![npm version](https://img.shields.io/npm/v/@spatial-api/crs-transformer.svg)](https://www.npmjs.com/package/@spatial-api/crs-transformer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🛠️ Companion Purpose
This library was **not designed as a general-purpose standalone projection utility**. Instead, it acts as an **enhancement plug-in** explicitly built to inject coordinate reprojections on-the-fly into:
*   **[@spatial-api/wfs](https://www.npmjs.com/package/@spatial-api/wfs)** (Web Feature Service protocol engine)
*   **[@spatial-api/ogc](https://www.npmjs.com/package/@spatial-api/ogc)** (OGC API Features protocol engine)

By using an explicit **Dependency Injection Pattern**, developers can optionally pull in this package to instantly enable multi-projection support, while keeping the core routing libraries free of large external projection dependencies by default.

---

## 🚀 Features

- **Lean Footprint**: Avoids carrying the massive ~7.7 MB database of all worldwide systems. Weighs under **20 KB** compiled.
- **Air-Gap Secure**: 100% offline. Zero dynamic external network requests to resources like `epsg.io` at runtime.
- **Robust Synonym Normalization**: Translates differing standard URN formats, XML URLs, and simple shortcodes case-insensitively (e.g. `urn:ogc:def:crs:EPSG::3006`, `http://www.opengis.net/gml/srs/epsg.xml#3006`, and `EPSG:3006` all resolve identically).
- **Recursive Geometry Reprojection**: Recursively reprojects entire standard GeoJSON Geometry structures (Points, LineStrings, Polygons, etc.).

---

## 🌐 Preloaded Coordinate Reference Systems (CRS)

Out-of-the-box, this library comes preloaded with standard global projections and major European country-specific zones:

1. **Global Systems**:
   *   `EPSG:4326` (WGS 84 - Geographic latitude/longitude)
   *   `EPSG:3857` / `EPSG:900913` (Web Mercator / Google Maps)
   *   `EPSG:4269` (NAD83 - North American Datum)

2. **Regional Systems**:
   *   🇸🇪 **Sweden**: `EPSG:3006` (SWEREF99 TM national standard) and `EPSG:3007` to `EPSG:3018` (SWEREF99 local municipalities zones).
   *   🇵🇱 **Poland**: `EPSG:2180` (PUWG CS92 topographic scale) and `EPSG:2176` to `EPSG:2179` (PUWG CS2000 Zones 5-8 cadastral scale).
   *   🇩🇪 **Germany**: `EPSG:25832` & `EPSG:25833` (ETRS89 / UTM zones 32N & 33N) and `EPSG:31466` to `EPSG:31469` (DHDN / Gauss-Krüger 3-degree zones 2-5).
   *   🇫🇷 **France**: `EPSG:2154` (RGF93 / Lambert-93) and `EPSG:27572` (NTF / Lambert Zone II Extended).
   *   🇳🇴 **Norway**: `EPSG:25832` to `EPSG:25835` (EUREF89 / UTM zones 32N-35N) and selected high-precision `NTM` zones.

---

## 📦 Installation

```bash
npm install @spatial-api/crs-transformer
```

---

## 🏷️ Preloaded Local Synonyms

To support highly localized queries, the library automatically translates common informal or administrative system names case-insensitively into their standard EPSG counterparts:

*   🇸🇪 **Sweden**: `"SWEREF 99 TM"` / `"SWEREF99 TM"` $\rightarrow$ `EPSG:3006`, `"SWEREF 99 18 00"` $\rightarrow$ `EPSG:3011`, and all other Swedish local municipal naming patterns (zones 12 00 to 23 15).
*   🇫🇷 **France**: `"Lambert 93"` / `"Lambert93"` $\rightarrow$ `EPSG:2154`, `"Lambert II Extended"` / `"Lambert II etendu"` $\rightarrow$ `EPSG:27572`.
*   🇵🇱 **Poland**: `"CS92"` / `"PUWG 1992"` $\rightarrow$ `EPSG:2180`, and `"CS2000 zone 5"` to `"CS2000 zone 8"` $\rightarrow$ `EPSG:2176` - `EPSG:2179`.
*   🇩🇪 **Germany**: `"Gauss-Kruger Zone 3"` / `"Gauss-Krüger Zone 3"` $\rightarrow$ `EPSG:31467`, `"ETRS89 UTM 32N"` $\rightarrow$ `EPSG:25832`, etc.

---

## ⚙️ Custom Projections & Synonyms Registration

If your zone is not preloaded, you can register both the custom projection definition and custom local naming synonyms once at server setup:

```typescript
import CrsTransformer from '@spatial-api/crs-transformer';

// 1. Register a new projection definition (Swiss LV95)
CrsTransformer.register(
  'EPSG:2056',
  '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs'
);

// 2. Register custom local synonyms mapping to standard target codes
CrsTransformer.registerSynonym('SwissLV95', 'EPSG:2056');
CrsTransformer.registerSynonym('CH1903+', 'EPSG:2056');
```

Once registered, clients can query using the synonym name (e.g. `?crs=CH1903+` or `srsName="SwissLV95"`), and it will automatically resolve to `EPSG:2056` and transform coordinates correctly!

---

## 📖 Public API Reference

The imported `CrsTransformer` class implements the `CoordinateTransformer` contract:

```typescript
export interface CoordinateTransformer {
  /**
   * Normalizes standard URIs, URLs, URNs, and local synonyms to standard 'EPSG:XXXX' codes
   */
  normalizeSrs(srsName: string): string;

  /**
   * Checks if the coordinate system (or synonym) is supported by the library
   */
  isSupported(srsName: string): boolean;

  /**
   * Returns a list of all preloaded and custom EPSG codes currently supported
   */
  getSupportedCodes(): string[];

  /**
   * Converts a single 2D coordinate pair [x, y] or [lon, lat] from one SRS to another
   */
  transformCoordinate(
    coords: [number, number], 
    fromSrs: string, 
    toSrs: string
  ): [number, number];

  /**
   * Recursively traverses and reprojects all coordinates inside a standard GeoJSON Geometry object
   */
  transformGeometry(
    geometry: GeoJSONGeometry, 
    fromSrs: string, 
    toSrs: string
  ): GeoJSONGeometry;

  /**
   * Registers a new custom projection definition at runtime
   */
  register(code: string, projString: string): void;

  /**
   * Registers a new local synonym mapping at runtime
   */
  registerSynonym(synonym: string, targetCode: string): void;
}
```

---

## 🔗 Links
*   **WFS Core Package**: [@spatial-api/wfs](https://www.npmjs.com/package/@spatial-api/wfs)
*   **OGC Core Package**: [@spatial-api/ogc](https://www.npmjs.com/package/@spatial-api/ogc)
*   **Monorepo GitHub**: [https://github.com/Exsilium122/spatial-libs](https://github.com/Exsilium122/spatial-libs)
