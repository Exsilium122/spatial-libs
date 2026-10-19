import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  parsePositionalArgs,
  normalizeUrl,
  parseCollectionsSpec,
  resolveCliParams
} from '../src/cli-args.js';

describe('CLI argument parsing and helpers', () => {
  describe('parseArgs', () => {
    it('parses standard --key=value flags', () => {
      const args = ['--url=http://localhost:8080', '--mode=stress', '--duration=15'];
      const result = parseArgs(args);
      expect(result).toEqual({
        url: 'http://localhost:8080',
        mode: 'stress',
        duration: '15'
      });
    });

    it('handles values containing "=" characters correctly', () => {
      const args = [
        '--filter=name=oak=ancient',
        '--collections=trees:ogc=wfs:EPSG:4326',
        '--equation=a=b=c'
      ];
      const result = parseArgs(args);
      expect(result.filter).toBe('name=oak=ancient');
      expect(result.collections).toBe('trees:ogc=wfs:EPSG:4326');
      expect(result.equation).toBe('a=b=c');
    });

    it('handles flags with no value as empty string', () => {
      const args = ['--verbose', '--dry-run', '--flag='];
      const result = parseArgs(args);
      expect(result).toEqual({
        verbose: '',
        'dry-run': '',
        flag: ''
      });
    });

    it('ignores positional arguments in parseArgs', () => {
      const args = ['http://localhost:8080', '--mode=smoke', 'admin', 'pass'];
      const result = parseArgs(args);
      expect(result).toEqual({
        mode: 'smoke'
      });
    });
  });

  describe('parsePositionalArgs', () => {
    it('extracts non-flag positional arguments in order', () => {
      const args = ['http://localhost:8080', '--mode=stress', 'admin', '--duration=10', 'secret'];
      const positional = parsePositionalArgs(args);
      expect(positional).toEqual(['http://localhost:8080', 'admin', 'secret']);
    });

    it('returns empty array when no positional arguments are present', () => {
      const args = ['--url=http://localhost:8080', '--user=admin'];
      expect(parsePositionalArgs(args)).toEqual([]);
    });
  });

  describe('normalizeUrl', () => {
    it('preserves URLs starting with http:// or https://', () => {
      expect(normalizeUrl('http://localhost:8080')).toBe('http://localhost:8080');
      expect(normalizeUrl('https://example.com/api')).toBe('https://example.com/api');
    });

    it('prepends http:// if protocol is omitted', () => {
      expect(normalizeUrl('localhost:8080')).toBe('http://localhost:8080');
      expect(normalizeUrl('127.0.0.1:9000/wfs')).toBe('http://127.0.0.1:9000/wfs');
    });
  });

  describe('parseCollectionsSpec', () => {
    it('parses composite spec with protocols and srs', () => {
      const spec = 'trees:ogc,wfs2.0.0:EPSG:4326;lakes:ogc:EPSG:3857';
      const discovered = [
        { name: 'trees', bbox: [10, 20, 30, 40] as [number, number, number, number] }
      ];
      const result = parseCollectionsSpec(spec, discovered);
      expect(result).toEqual([
        {
          name: 'trees',
          protocols: ['ogc', 'wfs2.0.0'],
          srs: 'EPSG:4326',
          bbox: [10, 20, 30, 40]
        },
        {
          name: 'lakes',
          protocols: ['ogc'],
          srs: 'EPSG:3857',
          bbox: [-180, -90, 180, 90]
        }
      ]);
    });

    it('defaults srs to EPSG:4326 and uses fallback bbox when collection is not in discovered list', () => {
      const spec = 'rivers:ogc';
      const result = parseCollectionsSpec(spec);
      expect(result).toEqual([
        {
          name: 'rivers',
          protocols: ['ogc'],
          srs: 'EPSG:4326',
          bbox: [-180, -90, 180, 90]
        }
      ]);
    });

    it('ignores invalid chunks without colon separators', () => {
      const spec = 'invalidchunk;valid:ogc:EPSG:4326';
      const result = parseCollectionsSpec(spec);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid');
    });
  });

  describe('resolveCliParams', () => {
    it('resolves positional url and auth flags', () => {
      const params = resolveCliParams(['http://example.com', '--user=myuser', '--pass=mypass'], {});
      expect(params.rawUrl).toBe('http://example.com');
      expect(params.targetUrl).toBe('http://example.com');
      expect(params.authUser).toBe('myuser');
      expect(params.authPass).toBe('mypass');
      expect(params.auth).toEqual({ user: 'myuser', pass: 'mypass' });
    });

    it('resolves flags --url, --user, --pass', () => {
      const params = resolveCliParams([
        '--url=localhost:9000',
        '--user=flaguser',
        '--pass=flagpass'
      ], {});
      expect(params.rawUrl).toBe('localhost:9000');
      expect(params.targetUrl).toBe('http://localhost:9000');
      expect(params.authUser).toBe('flaguser');
      expect(params.authPass).toBe('flagpass');
      expect(params.auth).toEqual({ user: 'flaguser', pass: 'flagpass' });
    });

    it('falls back to environment variables for auth', () => {
      const params = resolveCliParams(['http://example.com'], {
        AUTH_USER: 'envuser',
        AUTH_PASS: 'envpass'
      });
      expect(params.authUser).toBe('envuser');
      expect(params.authPass).toBe('envpass');
      expect(params.auth).toEqual({ user: 'envuser', pass: 'envpass' });
    });

    it('handles missing URL when neither positional arg nor --url is provided', () => {
      const params = resolveCliParams(['--mode=stress', '--duration=10'], {});
      expect(params.rawUrl).toBeUndefined();
      expect(params.targetUrl).toBeUndefined();
      expect(params.auth).toBeUndefined();
      expect(params.options.mode).toBe('stress');
    });
  });
});
