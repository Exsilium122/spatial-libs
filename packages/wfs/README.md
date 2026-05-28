# @spatial-api/wfs

A modular, lightweight, and database-agnostic TypeScript library to publish spatial data via standard **WFS (Web Feature Service)** protocols (v1.0.0, v1.1.0, v2.0.0, and v2.0.2) using **Express**.

Part of the **[@spatial-api/spatial-libs](https://github.com/Exsilium122/spatial-libs)** monorepo suite.

[![npm version](https://img.shields.io/npm/v/@spatial-api/wfs.svg)](https://www.npmjs.com/package/@spatial-api/wfs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 💡 Looking for OGC API - Features (JSON)?
If your developers prefer a modern, RESTful API returning GeoJSON instead of XML-based traditional WFS, we also publish **[@spatial-api/ogc](https://www.npmjs.com/package/@spatial-api/ogc)**! Both packages share the exact same `SpatialDataProvider` database interface, allowing you to easily support both standards side-by-side.

---

## 🚀 Features

- **Protocol Coverage**: Complete support for WFS v1.0.0, v1.1.0, v2.0.0, and v2.0.2 (XML outputs).
- **Framework-Agnostic Core**: Decoupled handlers (`handleWfs100`, `handleWfs110`, `handleWfs200`) make it easy to adapt to any web framework or serverless platform.
- **Database Agnostic**: Bring your own database (PostGIS, MongoDB, SQLite, in-memory, etc.). The library delegates spatial queries to your customized database provider class.
- **Express Middleware**: Standard, drop-in Express router is included out-of-the-box.
- **Dependency-Injected Logging**: Inject standard loggers like Pino, Winston, or standard `console` objects.
- **CRS & Axis-Order Swapping**: Hardcoded coordinate system support for `EPSG:4326` with GML-compliant coordinate formatting (axis-swapping automatic coordinate formatting to `lat lon` for WFS v1.1.0/v2.0.0 vs `lon,lat` for WFS v1.0.0). No automatic projection conversion or on-the-fly coordinate transformation is supported out of the box; developers must perform coordinate transformations in their custom `SpatialDataProvider` if features are stored in another reference system.

---

## 📦 Installation

```bash
npm install @spatial-api/wfs
```

---

## 🛠️ Usage Example

Define your spatial data provider matching the standard `SpatialDataProvider` contract, and plug it into `createWfsRouter`.

```typescript
import express from 'express';
import createWfsRouter, { SpatialDataProvider } from '@spatial-api/wfs';

// 1. Define your database-agnostic provider
const mySpatialProvider: SpatialDataProvider = {
  async getSupportedTypes(context) {
    return ['trees'];
  },
  
  async getBoundingBox(context, featureType) {
    return { minLon: 10.0, minLat: 50.0, maxLon: 12.0, maxLat: 52.0 };
  },

  async getFeatures(context, featureType, fids, filterQuery) {
    // Implement spatial queries or ID lookups here
    return [
      {
        id: '1',
        geometry: { type: 'Point', coordinates: [10.5, 50.5] },
        properties: { name: 'Oak Tree', note: 'Near west gate' }
      }
    ];
  }
};

const app = express();

// 2. Mount WFS Router
app.use('/api/wfs', createWfsRouter({
  provider: mySpatialProvider,
  baseUrl: 'http://localhost:3000/api/wfs',
  logger: console,
  xmlOptions: {
    namespaces: {
      'parks': 'http://example.com/parks'
    }
  }
}));

app.listen(3000, () => console.log('WFS Service running on port 3000'));
```

---

## ⚙️ Configuration Options (`WfsOptions`)

When calling `createWfsRouter(options)` or the dispatch handlers, you can customize behaviour using the following properties:

| Property | Type | Description |
| :--- | :--- | :--- |
| `provider` | `SpatialDataProvider` | **(Required)** Your custom data provider instance containing database retrieval methods. |
| `baseUrl` | `string` | **(Required)** The public root endpoint URL (e.g. `http://localhost:3000/api/wfs`). |
| `appUrl` | `string` | *(Optional)* Core server/app URL fallback used in XML metadata schemas. |
| `logger` | `Logger` | *(Optional)* Custom logger implementation (e.g. Pino, Winston, or `console`). |
| `enabledVersions` | `('1.0.0' \| '1.1.0' \| '2.0.0' \| '2.0.2')[]` | *(Optional)* Constrain WFS requests to only specific active versions. |
| `xmlOptions` | `object` | *(Optional)* Namespace mapping & XML customization options. |

---

## ⚡ Advanced Framework-Agnostic Usage

For use cases where you are not using Express (e.g. Fastify, Koa, AWS Lambda, or Cloud Functions), `@spatial-api/wfs` exports decoupled, pure-function dispatchers and version-specific handlers.

### 1. `dispatchWfsRequest`
A unified request dispatcher that automatically detects the WFS protocol version requested, verifies enabled versions, and routes it to the appropriate version-specific handler.

```typescript
import { dispatchWfsRequest, GenericRequest } from '@spatial-api/wfs';

const genericRequest: GenericRequest = {
  method: 'GET', // or 'POST'
  query: {
    request: 'GetCapabilities',
    version: '2.0.0'
  },
  body: {}, // Parsed POST body object (if POST)
  user: { role: 'admin' }, // Optional auth context
  baseUrl: 'https://myservice.com/wfs'
};

const response = await dispatchWfsRequest(genericRequest, wfsOptions);
// Returns a GenericResponse: { status: number, headers: Record<string, string>, body: string }
```

### 2. Version-Specific Handlers: `handleWfs100`, `handleWfs110`, `handleWfs200`
If you want to completely bypass the automatic version detection/negotiation of `dispatchWfsRequest` and bind specific endpoints manually to specific WFS specifications:

```typescript
import { handleWfs100, handleWfs110, handleWfs200 } from '@spatial-api/wfs';

// Force WFS 1.1.0 logic for a specific endpoint
const response = await handleWfs110(genericRequest, wfsOptions);
```

---

## 🔗 Links
- **NPM Package**: [https://www.npmjs.com/package/@spatial-api/wfs](https://www.npmjs.com/package/@spatial-api/wfs)
- **Monorepo GitHub**: [https://github.com/Exsilium122/spatial-libs](https://github.com/Exsilium122/spatial-libs)
- **Sibling OGC Package**: [https://www.npmjs.com/package/@spatial-api/ogc](https://www.npmjs.com/package/@spatial-api/ogc)
