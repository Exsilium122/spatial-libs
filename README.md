# @spatial-api/spatial-libs

A modular, lightweight, and database-agnostic suite of TypeScript libraries to easily publish spatial data via standard **WFS (Web Feature Service)** and **OGC API - Features** protocols using **Express**.

This is the main monorepo containing our core library packages:

- **[@spatial-api/wfs](packages/wfs)** (Traditional XML-based Web Feature Service: WFS v1.0.0, v1.1.0, v2.0.0, v2.0.2)
  - [![npm version](https://img.shields.io/npm/v/@spatial-api/wfs.svg)](https://www.npmjs.com/package/@spatial-api/wfs)
  - Published NPM Package: [`@spatial-api/wfs`](https://www.npmjs.com/package/@spatial-api/wfs)
- **[@spatial-api/ogc](packages/ogc)** (Modern JSON/GeoJSON RESTful API: OGC API - Features Part 1: Core, and Part 2: Coordinate Reference Systems by Reference)
  - [![npm version](https://img.shields.io/npm/v/@spatial-api/ogc.svg)](https://www.npmjs.com/package/@spatial-api/ogc)
  - Published NPM Package: [`@spatial-api/ogc`](https://www.npmjs.com/package/@spatial-api/ogc)
- **[@spatial-api/crs-transformer](packages/crs)** (Dynamic CRS transformations and administrative synonym registry using Proj4)
  - [![npm version](https://img.shields.io/npm/v/@spatial-api/crs-transformer.svg)](https://www.npmjs.com/package/@spatial-api/crs-transformer)
  - Published NPM Package: [`@spatial-api/crs-transformer`](https://www.npmjs.com/package/@spatial-api/crs-transformer)

---

## Technical Features

- **Written in TypeScript**: Modern, strictly-typed codebase with ready-to-run compiled JavaScript outputs and full type definitions (`.d.ts`).
- **Database Agnostic**: Bring your own database (PostgreSQL/PostGIS, MongoDB, SQLite, in-memory). The library delegates query execution and connection management to you.
- **Framework-Agnostic Core**: Decoupled handlers make it easy to adapt to Express, Fastify, NestJS, Koa, or serverless functions (AWS Lambda).
- **Consolidated Configuration**: Simple, single-object constructor setups with granular control to enable or disable specific protocol versions.
- **Strict Verification on Initialization**: Dynamic scanning checks your data provider on boot to verify all required methods are implemented, throwing clear, descriptive errors early.
- **Dependency-Injected Logging**: Simple standard Logger contract. Inject your custom Pino, Winston, or `console` logger—or leave empty for completely silent operation.
- **Built-in OGC Exception Mapping**: Automatically formats standard database exceptions or validation errors into WFS-compliant XML exception bodies or OGC JSON error responses.

---

## The Unified contract: `SpatialDataProvider`

To use either library, you implement a single, unified database-agnostic interface:

```typescript
export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface GeoJSONFeature {
  id: string | number;
  name?: string;
  note?: string;
  geo?: {
    coordinates?: {
      type: string;
      coordinates: any;
    };
  };
  [key: string]: any; // Any extra custom attributes
}

export interface SpatialDataProvider {
  /** Returns list of supported feature type/collection IDs. */
  getSupportedTypes(context: any): Promise<string[]>;

  /** Returns coordinate boundaries envelope for a feature type. */
  getBoundingBox(context: any, featureType: string): Promise<BoundingBox>;

  /** Fetches the spatial features. */
  getFeatures(
    context: any,
    featureType: string,
    fids?: string[],
    filterQuery?: any
  ): Promise<GeoJSONFeature[]>;

  /** Optional: Determines whether geometry is LineString or Point. Defaults to Point. */
  getGeometryType?(context: any, featureType: string): Promise<'Point' | 'LineString'>;
}
```

---

## 1. Quickstart: "Hello World" In-Memory Express Middleware

Below is a complete, minimal example using a static array of city park `trees` (Point features) as your data provider.

```typescript
import express from 'express';
import createWfsRouter from '@spatial-api/wfs';
import createOgcRouter from '@spatial-api/ogc';
import CrsTransformer from '@spatial-api/crs-transformer'; // 1. Import dynamic coordinate transformer plug-in
import { SpatialDataProvider } from './types';

// 1. Define clean mock spatial data
const mockTrees = [
  { id: '1', name: 'Oak Tree', note: 'Near west gate', geo: { coordinates: { type: 'Point', coordinates: [10.5, 50.5] } } },
  { id: '2', name: 'Maple Tree', note: 'Near main pond', geo: { coordinates: { type: 'Point', coordinates: [11.0, 51.0] } } }
];

// 2. Implement the simple data provider
const myTreesProvider: SpatialDataProvider = {
  async getSupportedTypes() {
    return ['trees'];
  },
  async getBoundingBox() {
    return { minLon: 10.0, minLat: 50.0, maxLon: 12.0, maxLat: 52.0 };
  },
  async getFeatures(context, featureType, fids) {
    if (fids && fids.length > 0) {
      return mockTrees.filter(t => fids.includes(String(t.id)));
    }
    return mockTrees;
  }
};

const app = express();

// 3. Mount WFS (XML) and OGC Features (JSON) routers with CRS Transformer injected
app.use('/api/wfs', createWfsRouter({
  provider: myTreesProvider,
  baseUrl: 'http://localhost:3000/api/wfs',
  appUrl: 'http://localhost:3000',
  logger: console, // Inject console logger
  crsTransformer: CrsTransformer, // Inject to automatically translate coordinates and advertise systems
  xmlOptions: {
    namespaces: {
      'parks': 'http://example.com/parks'
    }
  }
}));

app.use('/api/ogc', createOgcRouter({
  provider: myTreesProvider,
  baseUrl: 'http://localhost:3000/api/ogc',
  appUrl: 'http://localhost:3000',
  crsTransformer: CrsTransformer // Inject to enable dynamic OGC Part 2 CRS queries (?crs and ?bbox-crs)
}));

app.listen(3000, () => console.log('Spatial API Server running on port 3000!'));
```

---

## 2. Granular Consumption: Separate Version Handlers & Dispatcher

You can selectively import and plug individual version handlers or the unified request dispatcher if you do not want to use the unified Express middleware bundle (e.g. if you are using Fastify, Koa, or Serverless platforms).

### Framework-Agnostic Dispatcher (`dispatchWfsRequest`)

```typescript
import { dispatchWfsRequest } from '@spatial-api/wfs';

// Decoupled dispatcher parses version parameters and routes to versioned handlers automatically
const response = await dispatchWfsRequest({
  method: 'GET',
  query: req.query,
  body: req.body,
  user: req.user,
  baseUrl: 'http://localhost:3000/wfs'
}, wfsOptions);

// Returns standard shape: { status: number, headers: Record<string, string>, body: string }
```

### Direct Handlers (`handleWfs100`, `handleWfs110`, `handleWfs200`)

```typescript
import express from 'express';
import { handleWfs100, handleWfs110, handleWfs200 } from '@spatial-api/wfs';

const app = express();

const wfsOptions = {
  provider: myTreesProvider,
  baseUrl: 'http://localhost:3000/wfs',
  appUrl: 'http://localhost:3000'
};

// Mount specific protocol endpoints manually
app.get('/wfs/1.0', async (req, res, next) => {
  try {
    const response = await handleWfs100({
      method: 'GET',
      query: req.query,
      user: req.user
    }, wfsOptions);

    res.status(response.status).set(response.headers).send(response.body);
  } catch (err) {
    next(err);
  }
});

app.get('/wfs/1.1', async (req, res, next) => {
  try {
    const response = await handleWfs110({
      method: 'GET',
      query: req.query,
      user: req.user
    }, wfsOptions);

    res.status(response.status).set(response.headers).send(response.body);
  } catch (err) {
    next(err);
  }
});

app.get('/wfs/2.0', async (req, res, next) => {
  try {
    const response = await handleWfs200({
      method: 'GET',
      query: req.query,
      user: req.user
    }, wfsOptions);

    res.status(response.status).set(response.headers).send(response.body);
  } catch (err) {
    next(err);
  }
});
```

---

## 3. Database Cookbooks

### A. MongoDB Cookbook
A simple, single-collection integration fetching features using MongoDB's `$geoWithin` operators.

```typescript
import { MongoClient, ObjectId } from 'mongodb';
import { SpatialDataProvider } from '@spatial-api/wfs';

const client = new MongoClient('mongodb://localhost:27017');
const db = client.db('city_parks');

export const mongoTreesProvider: SpatialDataProvider = {
  async getSupportedTypes() {
    return ['trees'];
  },

  async getBoundingBox(context, featureType) {
    // Standard aggregation to get bounds
    const pipeline = [
      { $match: { type: featureType } },
      { $group: {
          _id: null,
          minLon: { $min: '$geo.coordinates.coordinates.0' },
          minLat: { $min: '$geo.coordinates.coordinates.1' },
          maxLon: { $max: '$geo.coordinates.coordinates.0' },
          maxLat: { $max: '$geo.coordinates.coordinates.1' }
      }}
    ];
    const result = await db.collection('features').aggregate(pipeline).toArray();
    return result[0] || { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
  },

  async getFeatures(context, featureType, fids, filterQuery) {
    const query: any = { type: featureType };

    if (fids && fids.length > 0) {
      query._id = { $in: fids.map(id => new ObjectId(id)) };
    }

    // Merge standard spatial filters (e.g. $geoWithin mapped by the parser)
    const combinedQuery = filterQuery ? { ...query, ...filterQuery } : query;

    const docs = await db.collection('features').find(combinedQuery).toArray();
    return docs.map(d => ({
      id: d._id.toString(),
      name: d.name,
      note: d.note,
      geo: d.geo
    }));
  }
};
```

### B. PostgreSQL / PostGIS Cookbook
A standard relational spatial implementation querying PostGIS tables using `ST_AsGeoJSON` and `ST_Extent`.

```typescript
import pg from 'pg';
import { SpatialDataProvider } from '@spatial-api/wfs';

const pool = new pg.Pool({ connectionString: 'postgresql://postgres:secret@localhost:5432/gis_db' });

export const postgisTreesProvider: SpatialDataProvider = {
  async getSupportedTypes() {
    return ['trees'];
  },

  async getBoundingBox(context, featureType) {
    const sql = 'SELECT ST_Extent(geom) as box FROM trees';
    const res = await pool.query(sql);
    const box = res.rows[0]?.box; // e.g. "BOX(10.5 50.5,11.5 51.5)"
    if (!box) return { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
    
    const matches = box.match(/BOX\((.+) (.+),(.+) (.+)\)/);
    return {
      minLon: parseFloat(matches[1]),
      minLat: parseFloat(matches[2]),
      maxLon: parseFloat(matches[3]),
      maxLat: parseFloat(matches[4])
    };
  },

  async getFeatures(context, featureType, fids, filterQuery) {
    let sql = 'SELECT id, name, note, ST_AsGeoJSON(geom) as geometry FROM trees';
    const params: any[] = [];

    if (fids && fids.length > 0) {
      sql += ' WHERE id = ANY($1)';
      params.push(fids);
    }

    const res = await pool.query(sql, params);
    return res.rows.map(row => ({
      id: row.id,
      name: row.name,
      note: row.note,
      geo: {
        coordinates: JSON.parse(row.geometry)
      }
    }));
  }
};
```

---

## 4. GIS Client Integration (QGIS)

Once your Express server is running locally:

### Adding WFS Connection in QGIS:
1. Open **QGIS**.
2. Right-click on **WFS / OGC API - Features** in the browser panel, and select **New Connection**.
3. Configure the connection:
   - **Name**: `Local Trees Service`
   - **URL**: `http://localhost:3000/api/wfs`
   - **Version**: Select `2.0.0` or `1.1.0` (or `Detect`).
4. Click **OK**.
5. Connect to the service, and drag-and-drop the `trees` layer onto your QGIS map area.

### Adding OGC API Features Connection:
1. Right-click on **WFS / OGC API - Features** in QGIS browser.
2. Configure **URL** as `http://localhost:3000/api/ogc`.
3. Connect and load the GeoJSON layers natively!
