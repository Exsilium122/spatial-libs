# @spatial-api/ogc

A modular, lightweight, and database-agnostic TypeScript library to publish spatial data via modern **OGC API - Features (Core & GeoJSON)** standards using **Express**.

Part of the **[@spatial-api/spatial-libs](https://github.com/Exsilium122/spatial-libs)** monorepo suite.

[![npm version](https://img.shields.io/npm/v/@spatial-api/ogc.svg)](https://www.npmjs.com/package/@spatial-api/ogc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🗺️ Looking for Traditional WFS (XML)?
If your enterprise clients or legacy desktop GIS systems require standard XML-based Web Feature Service (v1.0.0, v1.1.0, v2.0.0, etc.) protocols, we also publish **[@spatial-api/wfs](https://www.npmjs.com/package/@spatial-api/wfs)**! Both packages share the exact same `SpatialDataProvider` database interface, allowing you to easily support both standards side-by-side.

---

## 🚀 Features

- **Standard Compliance**: Implements OGC API - Features Part 1: Core (JSON/GeoJSON output) and OpenAPI definition compliance.
- **RESTful Endpoints**: Serves clean landing pages, conformance profiles, and paginated collection item lists.
- **Built-in Spatial Query Filters**: Automatically supports bounding box filtering (`?bbox=minLon,minLat,maxLon,maxLat`) and maps standard MongoDB `$geoWithin` operators.
- **Database Agnostic**: Bring your own database (PostGIS, MongoDB, SQLite, in-memory, etc.). The library delegates spatial queries to your customized database provider class.
- **Express Middleware**: Standard, drop-in Express router is included out-of-the-box.
- **Dependency-Injected Logging**: Inject standard loggers like Pino, Winston, or standard `console` objects.

---

## 📦 Installation

```bash
npm install @spatial-api/ogc
```

---

## 🛠️ Usage Example

Define your spatial data provider matching the standard `SpatialDataProvider` contract, and plug it into `createOgcRouter`.

```typescript
import express from 'express';
import createOgcRouter, { SpatialDataProvider } from '@spatial-api/ogc';

// 1. Define your database-agnostic provider
const mySpatialProvider: SpatialDataProvider = {
  async getSupportedTypes(context) {
    return ['forests'];
  },
  
  async getBoundingBox(context, featureType) {
    return { minLon: 15.0, minLat: 60.0, maxLon: 17.0, maxLat: 62.0 };
  },

  async getFeatures(context, featureType, fids, filterQuery) {
    // Implement spatial queries, bbox queries, or ID lookups here
    return [
      {
        id: '1',
        geometry: { type: 'Point', coordinates: [15.5, 60.5] },
        properties: { name: 'Greenwood Forest', note: 'State park forest' }
      }
    ];
  }
};

const app = express();

// 2. Mount OGC Router
app.use('/api/ogc', createOgcRouter({
  provider: mySpatialProvider,
  baseUrl: 'http://localhost:3000/api/ogc',
  logger: console,
  defaultLimit: 50,
  maxLimit: 1000
}));

app.listen(3000, () => console.log('OGC Features Service running on port 3000'));
```

---

## 🛣️ Standard Endpoints Exposed

The mounted router automatically handles and serves compliance-compliant paths:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/` | Service landing page containing links to conformance and collections. |
| **GET** | `/api` | OpenAPI 3.0 specification definition document. |
| **GET** | `/conformance` | Array of OGC conformance classes supported by the service. |
| **GET** | `/collections` | Metadata list of all active spatial feature collections. |
| **GET** | `/collections/:collectionId` | Extents and links metadata for a specific spatial collection. |
| **GET** | `/collections/:collectionId/items` | The paginated GeoJSON feature collection (GeoJSON output). |

### Supported Item Query Parameters

When querying `/collections/:collectionId/items`, standard parameters are parsed:
- `bbox`: Intersects features with `minLon,minLat,maxLon,maxLat` bounding boxes.
- `limit`: Number of features to return (falls back to `defaultLimit`, capped at `maxLimit`).
- `offset` / `startindex`: Integer index page offset for navigation pagination.
- `name`: Simple match attribute filters.

---

## ⚙️ Configuration Options (`OgcOptions`)

When calling `createOgcRouter(options)`, you can customize behavior using the following properties:

| Property | Type | Description |
| :--- | :--- | :--- |
| `provider` | `SpatialDataProvider` | **(Required)** Your custom data provider instance containing database retrieval methods. |
| `baseUrl` | `string` | **(Required)** The public root endpoint URL (e.g. `http://localhost:3000/api/ogc`). |
| `appUrl` | `string` | *(Optional)* Core server/app URL fallback. |
| `logger` | `Logger` | *(Optional)* Custom logger implementation (e.g. Pino, Winston, or `console`). |
| `defaultLimit` | `number` | *(Optional)* The default fallback item limit returned in pagination (default: `50`). |
| `maxLimit` | `number` | *(Optional)* The maximum safety limit allowed to request (default: `1000`). |

---

## 🔗 Links
- **NPM Package**: [https://www.npmjs.com/package/@spatial-api/ogc](https://www.npmjs.com/package/@spatial-api/ogc)
- **Monorepo GitHub**: [https://github.com/Exsilium122/spatial-libs](https://github.com/Exsilium122/spatial-libs)
- **Sibling WFS Package**: [https://www.npmjs.com/package/@spatial-api/wfs](https://www.npmjs.com/package/@spatial-api/wfs)
