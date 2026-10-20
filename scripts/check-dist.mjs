#!/usr/bin/env node
// Post-build packaging check: loads every built package the way consumers do (ESM import and
// CommonJS require, by package name), exercises its public entrypoint, and verifies that
// `npm pack` would publish only dist/ plus package metadata. Run after `npm run build`.
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));

const provider = {
  getSupportedTypes: async () => ['trees'],
  getBoundingBox: async () => ({ minLon: 10, minLat: 50, maxLon: 12, maxLat: 52 }),
  getFeatures: async () => [],
};

const libraries = [
  {
    name: '@spatial-api/crs-transformer',
    dir: 'packages/crs',
    exports: ['default', 'CrsTransformer', 'CrsTransformerClass'],
    smoke(mod) {
      const [x, y] = mod.CrsTransformer.transformCoordinate([0, 0], 'EPSG:4326', 'EPSG:3857');
      assert.ok(Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6, 'EPSG:4326 -> EPSG:3857 of [0,0] should be [0,0]');
    },
  },
  {
    name: '@spatial-api/ogc',
    dir: 'packages/ogc',
    exports: ['default'],
    smoke(mod) {
      assert.equal(typeof mod.default({ provider, baseUrl: 'https://example.com/ogc' }), 'function');
    },
  },
  {
    name: '@spatial-api/wfs',
    dir: 'packages/wfs',
    exports: ['default', 'dispatchWfsRequest', 'handleWfs100', 'handleWfs110', 'handleWfs200'],
    async smoke(mod) {
      assert.equal(typeof mod.default({ provider, baseUrl: 'https://example.com/wfs' }), 'function');
      const res = await mod.dispatchWfsRequest(
        { method: 'GET', query: { SERVICE: 'WFS', REQUEST: 'GetCapabilities', VERSION: '2.0.0' } },
        { provider, baseUrl: 'https://example.com/wfs' }
      );
      assert.equal(res.status, 200);
      assert.match(res.body, /trees/);
    },
  },
];

const ALLOWED_PACKED = /^(dist\/.+|package\.json|README\.md|LICENSE(\.md)?)$/i;

function checkPackedFiles(dir) {
  const [pack] = JSON.parse(
    execSync('npm pack --dry-run --json --ignore-scripts', { cwd: path.join(root, dir), encoding: 'utf8' })
  );
  const unexpected = pack.files.map((f) => f.path.replace(/\\/g, '/')).filter((p) => !ALLOWED_PACKED.test(p));
  assert.deepEqual(unexpected, [], `${dir} would publish files outside dist/`);
}

let failed = false;
async function check(label, fn) {
  try {
    await fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${label}\n     ${err.message}`);
  }
}

for (const lib of libraries) {
  await check(`${lib.name} declarations`, () => {
    for (const file of ['dist/index.d.ts', 'dist/index.d.cts']) {
      assert.ok(existsSync(path.join(root, lib.dir, file)), `missing ${file} (run npm run build first)`);
    }
  });
  await check(`${lib.name} ESM import`, async () => {
    const mod = await import(lib.name);
    for (const name of lib.exports) assert.ok(name in mod, `missing export "${name}"`);
    await lib.smoke(mod);
  });
  await check(`${lib.name} CommonJS require`, async () => {
    const mod = require(lib.name);
    for (const name of lib.exports) assert.ok(name in mod, `missing export "${name}"`);
    await lib.smoke(mod);
  });
  await check(`${lib.name} published files`, () => checkPackedFiles(lib.dir));
}

await check('@spatial-api/tester CLI prints usage and exits 0 without a target', () => {
  const cli = path.join(root, 'packages/tester/dist/index.js');
  assert.ok(existsSync(cli), 'missing packages/tester/dist/index.js (run npm run build first)');
  const out = execFileSync(process.execPath, [cli], { encoding: 'utf8', env: { ...process.env, AUTH_USER: '', AUTH_PASS: '' } });
  assert.match(out, /Usage/);
});
await check('@spatial-api/tester published files', () => checkPackedFiles('packages/tester'));

if (failed) {
  process.exitCode = 1;
} else {
  console.log('\nAll built packages load and pack correctly.');
}
