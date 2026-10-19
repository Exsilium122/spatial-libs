import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import createWfsRouter from '../src/index.js';
import { SpatialDataProvider, BoundingBox, GeoJSONFeature, Logger } from '../src/types.js';

class MockTreesProvider implements SpatialDataProvider {
  async getSupportedTypes(context: any): Promise<string[]> {
    return ['trees'];
  }

  async getBoundingBox(context: any, featureType: string): Promise<BoundingBox> {
    return {
      minLon: 10.0,
      minLat: 50.0,
      maxLon: 12.0,
      maxLat: 52.0
    };
  }

  async getFeatures(
    context: any,
    featureType: string,
    fids?: string[],
    filterQuery?: any
  ): Promise<GeoJSONFeature[]> {
    return [];
  }
}

function createTestClient(router: express.Router, mountPath = '/wfs') {
  const app = express();
  app.use(mountPath, router);
  const server = http.createServer(app);
  let port: number;

  return {
    async start(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    request(path: string, host: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path,
            method: 'GET',
            headers: {
              host
            }
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => {
              resolve({ status: res.statusCode || 200, body });
            });
          }
        );
        req.on('error', reject);
        req.end();
      });
    }
  };
}

describe('WFS Host Header Security & trustedHosts', () => {
  const provider = new MockTreesProvider();

  describe('Absolute baseUrl configured', () => {
    const router = createWfsRouter({
      provider,
      baseUrl: 'https://api.example.com/wfs'
    });
    const client = createTestClient(router);

    beforeAll(async () => {
      await client.start();
    });

    afterAll(async () => {
      await client.stop();
    });

    it('WFS 1.1.0 GetCapabilities uses configured absolute baseUrl and ignores Host header', async () => {
      const res = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        'attacker.com'
      );
      expect(res.status).toBe(200);
      expect(res.body).toContain('https://api.example.com/wfs');
      expect(res.body).not.toContain('attacker.com');
    });

    it('WFS 2.0.0 GetCapabilities uses configured absolute baseUrl and ignores Host header', async () => {
      const res = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        'attacker.com'
      );
      expect(res.status).toBe(200);
      expect(res.body).toContain('https://api.example.com/wfs');
      expect(res.body).not.toContain('attacker.com');
    });
  });

  describe('Relative baseUrl with trustedHosts allowlist', () => {
    const router = createWfsRouter({
      provider,
      baseUrl: '/wfs',
      trustedHosts: ['api.example.com', 'localhost:3000']
    });
    const client = createTestClient(router);

    beforeAll(async () => {
      await client.start();
    });

    afterAll(async () => {
      await client.stop();
    });

    it('WFS 1.1.0 does not reflect untrusted Host header', async () => {
      const res = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        'attacker.com'
      );
      expect(res.status).toBe(200);
      expect(res.body).not.toContain('attacker.com');
    });

    it('WFS 2.0.0 does not reflect untrusted Host header', async () => {
      const res = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        'attacker.com'
      );
      expect(res.status).toBe(200);
      expect(res.body).not.toContain('attacker.com');
    });

    it('WFS 1.1.0 reflects allowed Host header', async () => {
      const res = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        'api.example.com'
      );
      expect(res.status).toBe(200);
      expect(res.body).toContain('http://api.example.com');
      expect(res.body).not.toContain('attacker.com');
    });

    it('WFS 2.0.0 reflects allowed Host header', async () => {
      const res = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        'api.example.com'
      );
      expect(res.status).toBe(200);
      expect(res.body).toContain('http://api.example.com');
      expect(res.body).not.toContain('attacker.com');
    });

    it('WFS 1.1.0 and 2.0.0 match trusted hosts case-insensitively', async () => {
      const res110 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        'API.EXAMPLE.COM'
      );
      expect(res110.status).toBe(200);
      expect(res110.body).toContain('http://API.EXAMPLE.COM');

      const res200 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        'API.EXAMPLE.COM'
      );
      expect(res200.status).toBe(200);
      expect(res200.body).toContain('http://API.EXAMPLE.COM');
    });
  });

  describe('Relative baseUrl without trustedHosts (format validation)', () => {
    const router = createWfsRouter({
      provider,
      baseUrl: '/wfs'
    });
    const client = createTestClient(router);

    beforeAll(async () => {
      await client.start();
    });

    afterAll(async () => {
      await client.stop();
    });

    it('WFS 1.1.0 and 2.0.0 reject malformed host evil.com/x', async () => {
      const res110 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        'evil.com/x'
      );
      expect(res110.status).toBe(200);
      expect(res110.body).not.toContain('evil.com/x');
      expect(res110.body).not.toContain('evil.com');

      const res200 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        'evil.com/x'
      );
      expect(res200.status).toBe(200);
      expect(res200.body).not.toContain('evil.com/x');
      expect(res200.body).not.toContain('evil.com');
    });

    it('WFS 1.1.0 and 2.0.0 reject malformed host a@b.com', async () => {
      const res110 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        'a@b.com'
      );
      expect(res110.status).toBe(200);
      expect(res110.body).not.toContain('a@b.com');

      const res200 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        'a@b.com'
      );
      expect(res200.status).toBe(200);
      expect(res200.body).not.toContain('a@b.com');
    });

    it('WFS 1.1.0 and 2.0.0 accept valid format host when no allowlist is configured', async () => {
      const res110 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        'legit.example.com'
      );
      expect(res110.status).toBe(200);
      expect(res110.body).toContain('http://legit.example.com');

      const res200 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        'legit.example.com'
      );
      expect(res200.status).toBe(200);
      expect(res200.body).toContain('http://legit.example.com');
    });

    it('WFS 1.1.0 and 2.0.0 accept bracketed IPv6 literals with port', async () => {
      const res110 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=1.1.0',
        '[::1]:3000'
      );
      expect(res110.status).toBe(200);
      expect(res110.body).toContain('http://[::1]:3000');

      const res200 = await client.request(
        '/wfs?service=WFS&request=GetCapabilities&version=2.0.0',
        '[::1]:3000'
      );
      expect(res200.status).toBe(200);
      expect(res200.body).toContain('http://[::1]:3000');
    });
  });

  describe('Router creation warning', () => {
    it('logs warning once when baseUrl is relative and trustedHosts is not set', () => {
      const mockLogger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      createWfsRouter({
        provider,
        baseUrl: '/wfs',
        logger: mockLogger
      });

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('trustedHosts')
      );
    });

    it('does not log warning when trustedHosts is provided with relative baseUrl', () => {
      const mockLogger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      createWfsRouter({
        provider,
        baseUrl: '/wfs',
        trustedHosts: ['api.example.com'],
        logger: mockLogger
      });

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('does not log warning when baseUrl is absolute', () => {
      const mockLogger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      createWfsRouter({
        provider,
        baseUrl: 'https://api.example.com/wfs',
        logger: mockLogger
      });

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
