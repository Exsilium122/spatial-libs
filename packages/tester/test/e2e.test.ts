import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
// The sibling engines are imported from source so this suite needs no prior `npm run build`.
import createWfsRouter from '../../wfs/src/index.js';
import createOgcRouter from '../../ogc/src/index.js';
import { probeTarget } from '../src/probing.js';
import { runSmokeTests } from '../src/smoke.js';
import { runStressTests } from '../src/stress.js';

/**
 * End-to-end tests: the tester is pointed at a real HTTP server that mounts this monorepo's own
 * OGC API Features and WFS routers — no mocked axios, no mocked autocannon.
 */

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FEATURES = {
  trees: [
    { id: 't1', geometry: { type: 'Point', coordinates: [10.5, 50.5] }, properties: { name: 'Oak' } },
    { id: 't2', geometry: { type: 'Point', coordinates: [11.5, 51.5] }, properties: { name: 'Pine' } },
  ],
  lakes: [{ id: 'l1', geometry: { type: 'Point', coordinates: [11, 51] }, properties: { name: 'Blue' } }],
} as const;

const provider = {
  async getSupportedTypes() {
    return Object.keys(FEATURES);
  },
  async getBoundingBox() {
    return { minLon: 10, minLat: 50, maxLon: 12, maxLat: 52 };
  },
  async getFeatures(context: any, featureType: string) {
    return structuredClone((FEATURES as any)[featureType] || []);
  },
  async getGeometryType() {
    return 'Point' as const;
  },
};

function startSpatialServer(opts: { basicAuth?: { user: string; pass: string } } = {}) {
  const app = express();
  if (opts.basicAuth) {
    const expected = 'Basic ' + Buffer.from(`${opts.basicAuth.user}:${opts.basicAuth.pass}`).toString('base64');
    app.use((req, res, next) => (req.headers.authorization === expected ? next() : res.status(401).send('Unauthorized')));
  }
  const server = http.createServer(app);
  let origin = '';
  return {
    get origin() {
      return origin;
    },
    async start() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      app.use('/api/ogc', createOgcRouter({ provider, baseUrl: `${origin}/api/ogc` }));
      app.use('/api/wfs', createWfsRouter({ provider, baseUrl: `${origin}/api/wfs` }));
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

function runCli(cliPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cliPath, ...args], { timeout: 60_000, env: { ...process.env, AUTH_USER: '', AUTH_PASS: '' } }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

describe('tester end-to-end against the in-repo OGC + WFS servers', () => {
  const server = startSpatialServer();

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('probes the target and discovers both endpoints and every collection', async () => {
    const result = await probeTarget(server.origin);

    expect(result.ogcUrl).toBe(`${server.origin}/api/ogc`);
    expect(result.wfsUrl).toBe(`${server.origin}/api/wfs`);
    expect(result.collections.map((c) => c.name).sort()).toEqual(['lakes', 'trees']);
    for (const col of result.collections) {
      expect(col.protocols).toContain('ogc');
      expect(col.protocols.some((p) => p.startsWith('wfs'))).toBe(true);
      expect(col.bbox).toEqual([10, 50, 12, 52]);
    }
  });

  it('runs smoke tests for every protocol and collection and all of them pass', async () => {
    const probe = await probeTarget(server.origin);
    const results = await runSmokeTests({
      url: server.origin,
      wfsUrl: probe.wfsUrl,
      ogcUrl: probe.ogcUrl,
      collections: probe.collections.map((c) => ({
        name: c.name,
        protocols: ['ogc', 'wfs1.0.0', 'wfs1.1.0', 'wfs2.0.0'],
        srs: 'EPSG:4326',
        bbox: c.bbox,
      })),
    });

    const failures = results.filter((r) => !r.passed);
    expect(failures).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(2 + 2 * 4);
  });

  it('runs a short concurrent stress benchmark against OGC and WFS without errors', async () => {
    const probe = await probeTarget(server.origin);
    const results = await runStressTests({
      wfsUrl: probe.wfsUrl,
      ogcUrl: probe.ogcUrl,
      collections: [{ name: 'trees', protocols: ['ogc', 'wfs1.1.0', 'wfs2.0.0'], srs: 'EPSG:4326', bbox: [10, 50, 12, 52] }],
      duration: 1,
      concurrency: 2,
    });

    expect(results.map((r) => r.target)).toEqual([
      'OGC - trees (EPSG:4326)',
      'WFS1.1.0 - trees (EPSG:4326)',
      'WFS2.0.0 - trees (EPSG:4326)',
    ]);
    for (const r of results) {
      expect(r.totalRequests).toBeGreaterThan(0);
      expect(r.errors).toBe(0);
    }
  });

  describe('Basic Authentication', () => {
    const secured = startSpatialServer({ basicAuth: { user: 'qa', pass: 'qa-pass' } });

    beforeAll(async () => {
      await secured.start();
    });

    afterAll(async () => {
      await secured.stop();
    });

    it('reports 401 without credentials and discovers collections with them', async () => {
      await expect(probeTarget(secured.origin)).rejects.toMatchObject({ statusCode: 401 });

      const probe = await probeTarget(secured.origin, { user: 'qa', pass: 'qa-pass' });
      expect(probe.collections.map((c) => c.name).sort()).toEqual(['lakes', 'trees']);
    });
  });

  describe('CLI (automation mode)', () => {
    const cliPath = path.join(packageDir, 'node_modules', '.cache', 'spatial-tester-e2e', 'cli.mjs');

    beforeAll(async () => {
      // Bundle the CLI exactly like the package build does; dependencies stay external and
      // resolve from the workspace node_modules above the output directory.
      await build({
        entryPoints: [path.join(packageDir, 'src', 'index.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        outfile: cliPath,
        logLevel: 'silent',
      });
    });

    it('smoke mode exits 0 and prints a PASS line per check', async () => {
      const { code, stdout } = await runCli(cliPath, [`--url=${server.origin}`, '--collections=trees:ogc,wfs2.0.0:EPSG:4326', '--mode=smoke']);
      expect(code).toBe(0);
      expect(stdout).toContain('SMOKE TEST RESULTS');
      expect(stdout).toContain('PASS');
      expect(stdout).not.toContain('FAIL:');
    });

    it('smoke mode exits 1 when a requested collection does not exist', async () => {
      const { code, stdout } = await runCli(cliPath, [`--url=${server.origin}`, '--collections=ghosts:ogc:EPSG:4326', '--mode=smoke']);
      expect(code).toBe(1);
      expect(stdout).toContain('FAIL:');
    });

    it('stress mode runs and prints the aggregate load report', async () => {
      const { code, stdout } = await runCli(cliPath, [
        `--url=${server.origin}`,
        '--collections=trees:ogc:EPSG:4326',
        '--mode=stress',
        '--duration=1',
        '--concurrency=2',
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain('OGC - trees (EPSG:4326)');
    });

    it('exits 1 in automation mode when the target requires credentials that were not given', async () => {
      const secured = startSpatialServer({ basicAuth: { user: 'qa', pass: 'qa-pass' } });
      await secured.start();
      try {
        const { code, stderr } = await runCli(cliPath, [`--url=${secured.origin}`, '--mode=smoke']);
        expect(code).toBe(1);
        expect(stderr).toContain('Unauthorized');
      } finally {
        await secured.stop();
      }
    });
  });
});
