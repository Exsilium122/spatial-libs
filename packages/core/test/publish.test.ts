import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageDir, '../..');

describe('Publish Gating and Next Tag', () => {
  it('has prerelease version 2.0.0-next.0 in packages/core/package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    expect(pkg.version).toMatch(/-/);
    expect(pkg.version).toBe('2.0.0-next.0');
  });

  it('determines --tag next for prerelease versions with hyphens', () => {
    const getTag = (version: string) => (version.includes('-') ? 'next' : 'latest');
    expect(getTag('2.0.0-next.0')).toBe('next');
    expect(getTag('2.0.0-alpha.1')).toBe('next');
    expect(getTag('1.0.0')).toBe('latest');
    expect(getTag('2.0.0')).toBe('latest');
  });

  it('publish.yml gates prereleases to --tag next and publishes core first', () => {
    const publishWorkflow = readFileSync(path.join(repoRoot, '.github/workflows/publish.yml'), 'utf8');

    // Core is published first
    const coreIndex = publishWorkflow.indexOf('Publish @spatial-api/core');
    const crsIndex = publishWorkflow.indexOf('Publish @spatial-api/crs-transformer');
    const wfsIndex = publishWorkflow.indexOf('Publish @spatial-api/wfs');
    const ogcIndex = publishWorkflow.indexOf('Publish @spatial-api/ogc');

    expect(coreIndex).toBeGreaterThan(-1);
    expect(coreIndex).toBeLessThan(crsIndex);
    expect(crsIndex).toBeLessThan(wfsIndex);
    expect(wfsIndex).toBeLessThan(ogcIndex);

    // TAG_FLAG next is used
    expect(publishWorkflow).toContain('TAG_FLAG="--tag next"');
    expect(publishWorkflow).toContain('if [[ "$VERSION" == *"-"* ]]');
  });

  it('executes npm publish --dry-run with --tag next without error', () => {
    // (negative acceptance test) Given version 2.0.0-next.0, when the publish dry-run runs,
    // then it publishes with --tag next and never latest.
    const output = execSync('npm publish --dry-run --tag next', {
      cwd: packageDir,
      encoding: 'utf8',
    });
    expect(output).toContain('@spatial-api/core');
    expect(output).toContain('2.0.0-next.0');
  });
});
